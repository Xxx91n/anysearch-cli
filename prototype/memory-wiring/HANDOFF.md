# 交接：记忆接线原型（给原 grill 窗口）

- 日期：2026-11-10
- 状态：用户已确认这批结论，可以拿回原窗口继续 grill / 规划。
- 原型分支：`prototype/memory-wiring-probe`
- 原型提交：`e20d0881`（本文件单独一个后续提交）
- 上游地址：https://github.com/Xxx91n/anysearch-cli/tree/prototype/memory-wiring-probe/prototype/memory-wiring
- 原型**不合并**到主干；分支只做证据保存。

## 一句话结论

自动回忆和额外补搜没有真正参与回答；“压缩”没有减少实际输入，只是往最新提问后面追加摘要；
项目级实验钉的 0.1.2 版 `ans_chat` 完全没有记忆接线，所以“记忆”这一臂目前是空的。

## 已确认的结论

### 1. 自动回忆、补搜、reuse 判定

当前产品源码（基线 `2fa3452c`，PI 0.84.2）实际读取的是旧消息格式，真实 PI 消息对不上：

| 位置 | 代码读的 | PI 0.84.2 实际给的 | 结果 |
|---|---|---|---|
| `packages/kernel/src/sufficiency-gate.ts` | 用户消息里的 `tool_result` 块 | 独立的 `toolResult` 消息 | 补搜判断找不到目标，直接返回空 |
| `packages/kernel/src/memory-pipeline.ts` 的缺口提炼 | `role:"tool"` | `role:"toolResult"` | 缺口文本 0 字符 |
| 同文件的自动回忆 | `tool_use` + `.input.query` | `toolCall` + `.arguments` | 没有调用存储检索，没有写自动回忆记录 |
| 同文件的 reuse 判定 | `text/text` 事件 | `text_delta/delta` | 模型回 `reuse` 被当成空文本，默认 `compress` |
| `packages/kernel/src/pi-runtime.ts` | `ctx.lastToolName/toolName` | `ctx.message/toolResults/context/newMessages` | “这一轮搜索过”始终为假 |

走通的是搜索工具本身、恢复摘要（`[Recovery Digest]`）和滚动摘要（`rolling_summary`）。

### 2. “压缩”没有减少输入

摘要保存后只是追加到最新用户消息后面，旧消息一条不删。真机两轮 `ans chat`：

- 第一轮主请求输入 token：459 → 10,786 → 17,263；旧工具结果字符数 32,799 → 53,691，仍在。
- 同一次运行里，摘要调用耗时 12–27 秒，赶不上下一条主请求；第二次调用才看到 `[Session Memory]`。
- 第一次调用额外 3 次摘要请求：输入 7,901 token、输出 5,221 token；第二次调用还有 1 次摘要请求（进程结束时用量未记全）。
- 服务商缓存确实有效：同一轮内 `cacheRead` 384 → 10,752；第二次调用首个请求 `cacheRead` 512。
- 没有客户端复用：每次 `ans chat` / `ans_chat` 都新建 Agent，不带上一轮历史；跨调用只靠摘要和恢复摘要。
- 没有历史资料复用：原始工具结果不再发送，只发摘要和恢复摘要。

### 3. 项目级实验用不上记忆

- 论文仓 `bin/project-run.mjs` 的注释说“项目级保留 `recall_memory`”，但实际启动配置
  `lib/arm-profiles.mjs` 只放行 `ans_chat`。
- 用 `lib/mcp-tool-filter.mjs --allow ans_chat` 启动产品 MCP，宿主看到的工具只有
  `["ans_chat"]`；不过滤时是 `["search_web","research_web","recall_memory","query_knowledge","ans_chat"]`。
  对 `recall_memory` 的调用在过滤层就被回绝。
- 各阶段确实共用一个数据库：`project-run.mjs` 一次运行只建一个临时库，把 `ANS_DB_PATH` 放进
  同一个 `env`，grill / spec / implement 三个阶段的所有 `dsh` 调用都带它。
- 但“同一个库”不等于“同一段会话”：论文仓钉的 `@anysearch-cli/mcp` 0.1.2 的 `ans_chat`
  不建 `MemoryPipeline`，不读 `sessionId` 入参，也不返回 `sessionId`。
- 已有 r19 题目级 g3/g5 会话日志：**1,139 次 `ans_chat`，0 次带 `sessionId`**；
  173 + 110 个请求头里都没有 `recall_memory`。
- 结论：之前通过 `ans_chat` 查到的资料，后续阶段取不回。工作目录里的文件（`SPEC.md` 等）
  仍然跨阶段保留，能读；断的只是“用记忆取回检索资料”这条路。

### 4. 最小修复的边界

用内存里的适配器（不改产品源码）验证：

- `toolResult` 折成旧 `role:"tool"`：缺口提炼恢复。
- 折成旧 `user/tool_result` 块：补搜恢复，`hasRetrievalEvidence=true`，发生 1 次补搜。
- `toolCall/arguments` 折成 `tool_use/input`：自动回忆恢复，写入自动回忆记录。
- `text_delta` 映射成旧 `text` 事件：`reuse` 恢复识别。
- 回合上下文改读 `toolResults[].toolName`：能判断“这一轮搜索过”。

**但补搜结果仍然进不了下一轮模型请求。** `shouldStopAfterTurn` 只能返回布尔值，
`gate.applyTo()` 生成的新数组不会写回 Agent 状态。0.84.2 有 `prepareNextTurn(context)` 可以
替换下一轮上下文，但产品没有接。这需要新增接线，不是改几个字段名。

另一个隐藏门槛：自动回忆要求 `hasRetrievalEvidence && messages.length > 4`。一次搜索回合
只有 3 条消息（user / tool call / toolResult），所以即使形状全修好、水位没超，也不会触发；
要两轮工具调用（5 条消息）或超过水位才行。

## 未决问题（原窗口需要继续处理）

1. **项目级用哪一版产品**：现在钉的 0.1.2 没有记忆接线，直接跑“记忆”臂是空的。要么先修产品、
   发版、重新钉版，要么调整实验叙事。这是用户的决定，原型不替用户选。
2. **产品修复范围**：消息形状、事件名、回合上下文取工具名，这三类是最小修复；补搜结果进入
   下一轮还需要 `prepareNextTurn` 新接线。是否做、什么时候做，不在本原型范围。
3. **“压缩”的语义**：当前是“追加摘要”，不是“替换旧上下文”。要不要改成真正替换、替换多少、
   怎么计量，需要另开设计与实验。
4. **项目级实验还没跑**：只验证了它的配置和已有题目级日志，没有跑完整 `project-run.mjs`
   （数小时并写正式实验目录）。
5. **真机测试条件**：压缩用水位 `fraction=0.01` 并声明 10 万 token 窗口，只改触发时点；真机
   走的是机器上已有的 0.1.2 `apps/cli/dist`；`but push` 没回显 pre-push 全量测试日志，只有
   推送退出码 0 和远端提交号。
6. **PI 1.5.0 未验证**：本次固定 0.84.2；交接里列的新版总结函数和回合结束接口变化没有碰。

## 对产品行为和实验的影响

- r19 题目级 g3/g5 里，`ans_chat` 没有记忆能力。任何把结果差异归因于“记忆”的说法都不成立；
  只能归因于搜索/工具/宿主行为。
- 项目级“记忆”对照目前会是空的：没有 `recall_memory`、没有 `sessionId` 回传、自动回忆也断。
- 成本核算要算上摘要调用：它不减少输入，反而增加一次独立的、重新序列化整段对话的请求。
- 恢复摘要能跨调用保留“上次搜索了什么、结果够不够”，但它不是资料本体，不能替代原始工具结果。

## 运行方式

前置：Node 22.15+（本机 24.22.1）；仓库已 `pnpm install --ignore-scripts`；真机脚本需要
`ANS_LLM_*`、`TAVILY_API_KEY`、`EXA_API_KEY`、`ANYSEARCH_API_KEY`（只用环境变量，不写盘）。

```bash
# 1) 确定性探针：真实 pi-agent-core Agent + 真实产品源码，无网络
node --import tsx prototype/memory-wiring/probe.ts

# 2) 真机两轮：production `ans chat` + 本地计量代理，会写临时库/临时域
node prototype/memory-wiring/probe-real.mjs

# 3) 论文臂的 MCP 工具面：过滤 vs 不过滤
#    默认找 D:/Aworker/research/ALL/.../eval-r19；可用 PROBE_FILTER / PROBE_MCP 覆盖
node prototype/memory-wiring/probe-mcp-tools.mjs

# 4) 已有 r19 题目级会话日志统计（只读 ~/.dsh/sessions）
node prototype/memory-wiring/probe-q3-sessions.mjs
```

四条命令都实际跑过，退出码 0。真机临时目录留在 `D:/Windows/Temp/anysearch-probe-real`，可重复跑。

## 证据索引

- `README.md`：完整说明、表格、条件与限制。
- `out/probe-sim.json`：Q1/Q2/Q5 的确定性探针原始结果。
- `out/probe-real.json`：真机两轮请求、用量、缓存读、数据库记录、两轮输出。
- `out/probe-mcp-tools.json`：过滤前后工具列表、`recall_memory` 回绝结果。
- `out/probe-q3-sessions.json`：g3/g5 调用次数、`sessionId` 回传次数、请求头工具面。
- 版本：产品基线 `2fa3452c`；PI `0.84.2`；论文仓 `gov-closeout` `89664e5f`；
  论文仓钉的 MCP `0.1.2`；真机 CLI 构建 `0.1.2`。
