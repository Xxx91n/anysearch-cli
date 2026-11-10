# 原型：记忆流水线接线探针

这是一次一次性原型，用来回答交接文件里的三个问题。**不是产品代码，不合并。**
分支：`prototype/memory-wiring-probe`。

## 运行环境

- 产品仓：`D:\Aworker\anysearch-cli`，基线 `2fa3452c`（工作区从 `cbe923e4` 之后的提交）。
- 产品源码导入：`@earendil-works/pi-agent-core` 0.84.2、`@earendil-works/pi-ai` 0.84.2。
- 论文仓：`D:\Aworker\research\ALL`（`gov-closeout`，`89664e5f`），只读。
- 真机路径：机器上已有的 `apps/cli/dist`（0.1.2）和 `ans` 的 `chat` 命令；模型走本机环境里的 `ANS_LLM_*`，不落盘、不打印。
- 真机代理只记请求/响应的用量和消息统计，不记请求头、不记密钥。

## 复现命令（全部已实际跑过，退出码 0）

```bash
node --import tsx prototype/memory-wiring/probe.ts          # 确定性探针：真实 Agent + 真实源码
node prototype/memory-wiring/probe-mcp-tools.mjs            # 论文臂的 MCP 工具面
node prototype/memory-wiring/probe-q3-sessions.mjs          # 已有 r19 题目级会话日志统计（只读）
node prototype/memory-wiring/probe-real.mjs                 # 真机两轮 ans chat + 计量代理
```

结果在 `out/`。`probe-real.mjs` 会建临时库、临时域、临时 `DSH_HOME` 之外的目录，跑完保留在
`D:/Windows/Temp/anysearch-probe-real`，可重复跑。

---

## 问题 1：自动回忆和额外补搜，是否真的参与了回答？

**答案：在当前 HEAD 上，自动回忆、补搜、reuse 判定都没有真正参与。** 走通的是搜索工具本身、
恢复摘要（recovery digest）和滚动摘要（rolling summary）。

确定性探针让真实的 pi-agent-core Agent 跑两轮：第一轮模型发出 `search` 工具调用，工具返回真实
`toolResult` 消息；第二轮新开一个 Agent，只带新的用户问题。真实消息形状是：

- 工具调用：`assistant.content[].type = "toolCall"`，参数在 `.arguments`
- 工具结果：独立消息 `role = "toolResult"`，结果文本在 `content[0].text`
- 文本流事件：`text_delta` / `text_end`

代码实际读取的是旧形状：`tool_use` / `input.query`、`role: "tool"`、`text/text`。

| 步骤 | 真实运行结果 | 原因 |
|---|---|---|
| `shouldStopAfterTurn` | 执行 | 每轮结束都调用 |
| `gate.evaluate(messages)` | 执行但直接返回空 | 只在 `role:"user"` 的 `tool_result` 块里找目标；真实结果是独立 `toolResult` 消息 |
| `distillGap()` | 跳过，`text` 长度 0 | 只认 `role:"tool"` |
| 自动回忆（L2） | **没有调用** `searchMemory`/`searchMemoryMulti`，数据库里没有 `l2_recall` | 只认 `tool_use` + `.input.query` |
| `reuse` 判定 | **识别错**：真实 `text_delta: "reuse"` 被当成空文本，默认返回 `compress` | 只累加 `event.type === "text"` |
| 补搜 | 没有发生（`retriever` 只被搜索工具调用 1 次） | 目标找不到，gate 提前返回 |
| 滚动摘要 | 执行，写入了 `rolling_summary` | 水位触发不依赖消息形状 |
| 恢复摘要 | 执行，真机下一次调用注入了 `[Recovery Digest]` | 独立的 #189 路径 |

对应证据：`out/probe-sim.json` 的 `Q1-1`、`Q1-2`、`Q1-3`、`Q1-4`。
真机数据库里同样只有 `sufficiency`、`consolidation_state`、`rolling_summary`，没有 `l2_recall`
（`out/probe-real.json` 的 `anchors`）。

## 问题 2：当前“压缩”有没有减少实际输入？

**答案：没有减少。摘要是追加到最新用户消息后面的，旧消息一条不删；同一次运行里下一条请求
反而更大。真机上摘要还常常赶不上下一条请求，慢半拍。**

真机两轮 `ans chat`（临时库、临时域、`ANS_SESSION_ID=probe-session`）：

第一轮 6 个模型请求：

| 请求 | 消息数 | 字符数 | 输入 token | 缓存读 | 说明 |
|---|---:|---:|---:|---:|---|
| 1 | 2 | 169 | 459 | 384 | 首问 |
| 2 | 5 | 32,799 | 10,786 | 384 | 工具结果完整进入 |
| 3 | 2 | 6,276 | 1,698 | 0 | **摘要调用** |
| 4 | 7 | 53,691 | 17,263 | 10,752 | 旧工具结果仍完整 |
| 5 | 2 | 13,951 | 3,705 | 2,048 | **摘要调用** |
| 6 | 2 | 9,118 | 2,498 | 0 | **摘要调用** |

- 旧工具结果没有被替换或截断：请求 4 的字符数继续增长。
- 同一次运行里，请求 4 没有看到 `[Session Memory]`；摘要调用耗时 12–27 秒，输给了下一条请求。
- 第二次 `ans chat` 的首个请求只有 2 条消息，但带 `[Session Memory]`：输入 1,636 token，
  缓存读 512，总字符 4,405。它没有旧工具结果，只有摘要 + 恢复摘要。
- 额外费用：第一轮 3 次摘要调用合计 **输入 7,901 token、输出 5,221 token**；第二轮还有 1 次
  摘要调用（进程结束时用量没记全，`usage: null`）。
- 缓存分开看：
  - 服务商输入缓存：同一轮内 `cacheRead` 从 384 升到 10,752，说明前缀缓存有效。
  - 摘要请求故意不复用缓存（`cacheRetention: "none"`，新 sessionId），实测 `cacheRead` 0 / 2,048。
  - 客户端复用：没有。每次 `ans chat` / `ans_chat` 都新建 Agent，不带上一轮历史；跨调用只有锚点。
  - 历史资料复用：只有摘要和恢复摘要，原始工具结果不再发送。

证据：`out/probe-real.json`；确定性探针 `out/probe-sim.json` 的 `Q2-1`、`Q2-2`、`Q2-3`。

## 问题 3：完整 grill 项目级实验能否用上预定的记忆能力？

**答案：不能。** 论文仓的 `bin/project-run.mjs` 说明写着“项目级保留 `recall_memory`”，但实际
启动配置只放行 `ans_chat`；而被钉死的 `@anysearch-cli/mcp` 0.1.2 的 `ans_chat` 既不建
`MemoryPipeline`，也完全不读 `sessionId` 入参，更不返回 `sessionId`。

1. **宿主看得到哪些工具**：用论文仓的 `lib/mcp-tool-filter.mjs --allow ans_chat` 启动产品
   MCP，`tools/list` 只有 `["ans_chat"]`；不过滤时是
   `["search_web","research_web","recall_memory","query_knowledge","ans_chat"]`。
   对 `recall_memory` 的调用在过滤层就被本地回绝：`tool not available in this arm`。
   证据：`out/probe-mcp-tools.json`。
2. **是不是同一个数据库**：是。`project-run.mjs` 一次运行只建一个临时库，把
   `ANS_DB_PATH` 写进同一个 `env`，grill / spec / implement 三个阶段的所有 `dsh` 调用都带它
   （`bin/project-run.mjs:51-53,58,68,72,75`）。但“同一个库”不等于“同一段会话”。
3. **`sessionId` 有没有传回**：没有。
   - 论文仓钉的 0.1.2 处理函数只取 `message`，不传 `store/sessionId`，也不返回句柄。
   - 已有 r19 题目级 g3/g5 日志里，**1,139 次 `ans_chat` 调用，0 次带 `sessionId`**；
     173 + 110 个请求头里都没有 `recall_memory`。
     证据：`out/probe-q3-sessions.json`。
4. **之前写入的资料能不能取回**：不能。
   - `recall_memory` 被过滤掉。
   - `sessionId` 不传回，每次调用都是新会话。
   - 自动回忆本身在 HEAD 上也断了（问题 1）。

补充：工作目录里的文件（`SPEC.md` 等）仍然跨阶段保留，能读；断的是“通过 `ans_chat` 记忆
取回检索资料”这条路。

## 问题 1 第 5 小问：最小临时调整能恢复多少？

全部用内存里的适配器完成，没有改产品源码：

| 适配 | 结果 |
|---|---|
| `toolResult` → 旧 `role:"tool"` | `distillGap` 恢复：0 → 2,402 字符 / 2 条结果 |
| `toolResult` → 旧 `user/tool_result` 块 | gate 找到目标，补搜恢复：`hasRetrievalEvidence=true`，1 次 reround |
| `toolCall/arguments` → `tool_use/input` | L2 恢复：调用 `searchMemoryMulti`，写入 `l2_recall` |
| `text_delta` → 旧 `text` 事件 | `reuse` 恢复识别 |
| 回合上下文改读 `toolResults[].toolName` | 能判断“这一轮搜索过”（真实上下文字段是 `message/toolResults/context/newMessages`） |

**但补搜结果仍然进不了下一次主模型请求**：`shouldStopAfterTurn` 只能返回布尔值，
`gate.applyTo()` 生成的新数组不会被写回 Agent 状态。0.84.2 有 `prepareNextTurn(context)`
可以替换下一轮的上下文，但产品没有接。也就是说，消息形状可以最小修复；把补搜资料真正送进
下一次请求，需要新增接线，不是改几个字段名。

另外，L2 回忆还多一道门槛：`consolidateState` 要求 `hasRetrievalEvidence && messages.length > 4`。
一次搜索回合只有 3 条消息（user/tool call/toolResult），所以即使形状全修好、水位没超，也
不会触发；要两轮工具调用（5 条消息）或超过水位才行。证据：`Q5-7`。

---

## 还没做完 / 条件不足

- **没有跑项目级实验本身**：一次完整 `project-run.mjs` 要数小时，还会写正式实验目录；这次
  只验证了它的配置和已有题目级会话日志。
- **论文仓钉的 0.1.2 和产品 HEAD 不是同一份代码**：0.1.2 的 `ans_chat` 根本没有记忆接线；
  HEAD 已经补上了 MCP 会话句柄和 MemoryPipeline，但宿主仍然不回传 `sessionId`，L2 仍然断。
  项目级实验如果要评估“记忆”，先要决定用哪一版、是否重新钉版。
- **真机压缩用了人为降低的水位**（`fraction=0.01`，并声明窗口 100,000）。生产默认是
  128,000 / 绝对下限 50,000。降低的只是触发时点；摘要追加、不删旧消息的行为与水位无关。
- **真机路径用的是机器上已有的 `apps/cli/dist`**，不是本次从源码重建的包；版本仍是 0.1.2。
  确定性探针直接导入 HEAD 源码，两者结论一致。
- **缓存只观察到服务商侧**：计量代理能看到 `cacheRead`；客户端是否复用、历史资料是否复用，
  靠“每次新建 Agent、只注入锚点”的代码事实判断，没有单独的客户端缓存层。
- 网址大小写、主机末尾点、PI 1.5.0 升级等交接里列为暂存的问题，这次没有碰。
- 现有仓库测试大量使用旧消息/旧事件形状（`pi-runtime.test.ts` 的 `{"type":"text"}`），
  所以它们通过不能证明真实 PI 流程有效。
