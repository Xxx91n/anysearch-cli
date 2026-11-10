# 交接 — 跨进程会话 / 并发纠正 / 真实模型纠错

状态：三题已实跑，结果等用户确认。**不要自动进入 spec、切票、正式实现或合并。**

## 分支与提交

- 分支：`prototype/pi-concurrency-reliability`（已推上游；无 PR、未合并）
- 栈底：`prototype/pi-esm-full-sdk`（上一轮已确认的原型）
- 本轮提交：
  - `50b7217f` 冻结新增样例（先提交、后跑）
  - `94d60ae9` 原型实现 + Q1/Q2/Q3 探针
  - `3f0cd8e6` Q3 稳定性与旧事实保留的最终证据
  - 本交接文件所在提交：本分支最新提交
- 环境：Node v24.22.1，pnpm 11.24.0，PI 依赖仍是 `@earendil-works/pi-coding-agent@1.5.1`。

## 三题结论

| 题 | 结论 | 证据 |
|---|---|---|
| Q1 两个真实进程同一会话 | **通过**（主流程）；另发现空库首次并发启动会丢一个进程 | `out/q1-cross-process.json` |
| Q2 两个会话同时纠正同一条旧知识 | **原实现不安全，已复现；原型修复后行为安全，冲突策略待用户拍板** | `out/q2-concurrent.json` |
| Q3 真实模型单证据纠错 | **不通过（可靠性未建立）**：同一输入重复跑结果不一致；接受更新时旧事实仍留在当前知识里 | `out/q3-real-model.json` |

---

## Q1：两个独立进程共用同一会话

做法：两个真实 `apps/mcp/dist/index.js --transport stdio` 进程，共用一个 SQLite 文件和一个 `ANS_PI_SESSION_DIR`，同一 `sessionId`。Provider 是本地 OpenAI 兼容 SSE 端点，只用于控制时序，不访问外网。

### 通过的部分

- **串行**：A 的 provider 请求 `1794319876139→…877353`，B 的请求 `…877741→…878950`；B 在 A 结束后约 388ms 才开始，没有重叠。
- **接续**：B 的请求体里带有 A 已完成的 `Q1-A-ANSWER-<nonce>`，说明 B 从共享 PI 记录读到了 A 的结果。
- **会话文件**：该 sessionId 只有一个 JSONL；每一行都能解析；2 条 user + 2 条 assistant，按顺序各写一次。A 的标记在原始文本里出现两次，是因为样例要求 B 逐字复述 A 的答案，不是重复写。
- **异常退出恢复**：A 在持有文件锁时被 SIGKILL；B 等待锁过期后成功完成，耗时 3.639s（测试把 `ANS_PI_LOCK_STALE_MS` 设为 3000，超时 15000）。锁目录最终被清掉，没有永久卡死。
- **中断不假成功**：被杀请求的 MCP 客户端只拿到 `MCP process exited (code=null, signal=SIGKILL)`；JSONL 里没有 `Q1-HANG-PARTIAL`；该 session 的 `budget_ledger` 没有记录已花费（`ledger: []`）。
- **不同会话并行**：`q1-par-a` 的请求 `…897146→…898352`，`q1-par-b` 的 `…897158→…898367`，真实重叠约 1.2s；两个 session 各写各的 JSONL。

### 发现的问题（未修复）

- **空库首次并发启动会丢进程。** 两个 MCP 进程在同一秒启动、共用同一个**全新空 DB** 时，4 次诊断里 1 次有一个进程退出：stderr 为 `anysearch MCP server error: database is locked`，退出码 1。单独复跑一次也复现了同样错误。
- 这不是会话锁的问题，是数据库首次建表/切 WAL 的启动竞争。DB 已初始化后不受影响。本轮没有修复，因为这不是预先声明的缺陷，且涉及 store 启动重试策略；先在报告中记录。
- 恢复依赖过期时间：默认 10 分钟后才清死锁，下一次请求最多再等 120 秒。也就是说“不会永久卡死”，但默认情况下不是“立刻恢复”。本轮为了实测加了环境变量旋钮（见“临时改动”）。

---

## Q2：两个会话同时纠正同一条旧知识

固定数据：旧知识 `Business hours are Monday to Friday 9-5.`；会话 ALPHA 与 OMEGA 各有 3 条材料，都要把它分别改成 `24/7` 和 `周末 10:00-18:00`。两个真实进程各开一个 SQLite 连接；两边都在 plan 完成后过同一个文件屏障，确保都先读到旧版本，再允许写。

### 修复前（`ANS_PROTOTYPE_CONSOLIDATE_GUARD=0`）：复现了不安全行为

- ALPHA 和 OMEGA **都报告 `update=1`**，都以为自己的更新成功。
- 最终留下 **两条同时有效的矛盾结论**：
  - `Support hours are now 10:00-18:00 on weekends, no longer Monday to Friday 9-5.`
  - `Support hours are now 24/7, no longer Monday to Friday 9-5.`
- 版本关系互相打架：旧 semantic row 的 `superseded_by` 只指向后写入的一条（例如 3），而旧材料被先写入的一方标成指向 2。也就是说“旧结论被谁替代”在两个地方说法不一致。
- 摘要暂停记录也出现两套不同 `invalidatedBy`，后续重建会拿到互相冲突的失效来源。

这直接说明：只靠 `BEGIN IMMEDIATE` 事务不够，因为扫描和 LLM 计划都在事务外，提交时没有检查“我计划修改的那一行还是不是当前版本”。

### 原型修复后（默认开启守卫）

在同一场景下：

- 恰好一边 `update=1`，另一边 `staleUpdates=1`、`conflict=1`，明确报告“我计划改的旧版本已经被别人关闭”。
- 最终只有 **一条** live semantic row。
- 旧行 `valid_until` 非空，`superseded_by` 指向真正写入的新行；3 条旧材料的 `superseded_by` 全部指向同一个新行。
- 受影响摘要只按生效的那次更新暂停一次，`invalidatedBy` 与 winner 一致。
- 失败一方的新材料仍在库里（没删），只是没有升级成知识。

### 需要用户拍板

原型选择的是“后提交者明确报冲突并丢弃这次更新”。其他可行策略：

1. 明确报冲突并丢弃（当前原型）。
2. 冲突时重新读取当前版本，重新规划一次，再把两边差异上报。
3. 按 entity 串行整理（整理期间锁住同一 entity）。
4. 不自动选哪条为真，保留两份候选和版本关系，交用户/上层裁决。

本轮**没有自行决定哪条结论为真**，只把实际结果和选项列出。

### 顺带补的接口缺口

`ans_chat(operation="consolidate", sessionId="bad id with spaces")` 现在返回 tool error：

> ans_chat consolidate: sessionId must be 1..128 visible ASCII characters; refusing an invalid scope (no full-archive fallback).

不再悄悄退回全库整理。结果里也回显了 `scope`（session / memory / full-archive）。

---

## Q3：真实模型下的单证据纠错

### 模型与参数

- provider/model：`openai` / `deepseek-v4.1-flash`
- 端点：`https://amr-link.open-design.ai/v1`，`api=chat`
- 密钥只记录长度 39，不落盘。
- **费用**：该自定义端点没有价格表，provider 也不返回美元金额。证据里 `costUsd=0` 但 `costBasis="unknown"`，并明确有 `consolidation cost (price unknown)`。**不能把它说成免费。**
- 最后一次完整探针自身：35 次真实模型调用，输入 2,441、输出 19,476、cacheRead 4,352、总计 26,269 tokens。本轮为调通探针跑了多轮，早期轮次没有逐笔落盘；按每轮约 2 万 tokens 粗估，整轮实跑大约 14 万 tokens。

### 五类边界的结果（最后一次完整运行）

| case | 固定输入 | 当前实现（无新检查） | 原型修复后（真实模型检查 + 保留旧事实） |
|---|---|---|---|
| R1 同一件事被改正 | 旧 Business hours，新 Support hours 24/7 | 这次 `conflict=1`（gate 拒了），以前多次 `update=1` | 这次 `verifyRejected=1`（判成不同主题）；以前多次 `update=1` |
| R2 只是页面/日期更新 | 内容仍是 9-5，只改发布日期 | 不更新 | 不更新（`sameFact=false`） |
| R3 否定词谈另一件事 | 节假日营业时间 | **误更新（缺陷复现）** | 拒绝（`sameFact=false`，理由“holiday special case”） |
| R4 低可信转述 | 论坛帖子“可能 24/7，不确定” | gate 直接拒绝（`conflict=1`） | 拒绝（`sameFact=false` / `reliable=false`） |
| R5 多条事实只改一条 | 旧知识含营业时间、邮箱、节假日关闭 | `update=1`，新知识只剩 24/7，邮箱和节假日事实丢失（缺陷复现） | 这次 `update=1`，但新知识仍保留 `Business hours are Monday to Friday 9-5`，与 24/7 并存 |

### 最关键的结果：不可重复

同一冻结输入，修复后路径各重复 3 次：

- R1：`update, update, refuse`（2 次接受、1 次拒绝）
- R5：`refuse, refuse, update`（1 次接受、2 次拒绝）

拒绝理由高度一致：真实模型把 `Support hours` 和旧知识里的 `Business hours` 判成**不同主题/范围**。接受更新时，合并摘要又把旧 `Business hours` 当作另一条事实保留下来，形成“旧 9-5 仍然有效 + 新 24/7”的并存文本。

所以 Q3 的结论是：**真实模型的单证据纠错目前不可靠。** 不是“合并代码不会保留事实”这么简单，而是“同一事实”的判断本身在同一输入上不稳定；一旦它认为不是同一件事，旧事实就会以另一条事实的身份留下。

### 仍然通过的部分

- R2、R3、R4 三个边界在修复后路径都正确拒绝，且没有误改旧知识。
- R3 的缺陷在旧路径上稳定复现，说明新增的真实模型检查确实挡住了它。
- R4 旧路径本身就没误更新（gate 拒绝），没有观察到“低可信转述覆盖可靠结论”。
- 用脚本化检查器（`sameFact=true, reliable=true`）隔离机制后，真实模型生成的合并摘要在部分运行里能保留邮箱和节假日事实；但它也会在同一输入的其他运行里保留旧营业时间。机制能工作，但不稳定。

### 认为需要改样例还是改实现

冻结样例里旧知识写 `Business hours`，新材料写 `Support hours`。真实模型多次把它们判成不同主题。这可能是**样例措辞歧义**，也可能是**模型判断过严**。按交接规则，本轮没有改样例，也没有为了让它通过而改提示词。需要用户决定：

- 若认定它们就是同一件事：应把冻结样例的旧知识改成 `Support hours are Monday to Friday 9-5.`（或统一措辞），再重跑。**这是样例变更，需要重新确认。**
- 若真实模型应能跨这种同义措辞判断：需要更明确的“同一事实”契约（例如引入实体/服务名上下文），并接受额外的判断成本。

---

## 临时改动（原型专属，需在正式规格里决定去留）

1. **跨进程锁旋钮**：`ANS_PI_LOCK_STALE_MS`、`ANS_PI_LOCK_TIMEOUT_MS`。默认仍是 10 分钟 / 120 秒，行为不变；探针用它把崩溃恢复压到 3 秒。
2. **并发守卫**：`consolidateMemoryRun` 在写事务里重新检查目标行仍是 live 且内容未变；不一致就 `staleUpdates++` 并跳过写入。`ANS_PROTOTYPE_CONSOLIDATE_GUARD=0` 可复现修复前行为。
3. **plan 屏障（仅探针）**：`ConsolidateOptions.planBarrier`，只用于让两个进程在写事务前对齐计划阶段，不是产品接口。
4. **真实模型纠错检查**：新增 `ConsolidateVerifyFn`，单证据更新前让真实模型回答 `sameFact` / `reliable`。CLI 和 MCP 共用。
5. **单证据路径绕过确定性 gate**：有 verifier 时，不再用“摘要对同一批材料”的循环 gate；改为由 verifier 决定。理由：纠正摘要本身就包含否定词，旧 gate 会把它误读成反证。批量更新仍走原 gate。
6. **更新时保留旧事实**：UPDATE 前再把 `CURRENT KNOWLEDGE` 作为一条证据重新生成摘要；`ANS_PROTOTYPE_PRESERVE_ON_UPDATE=0` 可关闭。
7. **否定极性**：`classifyClaim` 和 consolidation 的 contradiction 改为“极性不一致才算矛盾”。同极性否定（新材料也含 `no longer`）不再被当成反证。
8. **摘要重建按来源选材**：`getLiveKnowledgeDigest` 增加 `sessionId` / `includeSemanticIds`，只取本会话材料产生的知识，避免把全库最新资料塞进某个会话的摘要。
9. **费用口径**：`ConsolidationUsage.costBasis` 区分 `not-called` / `unknown` / `price-estimate` / `provider-reported`。当前自定义端点是 `unknown`。
10. **整理范围**：MCP 收到非法 `sessionId` 直接报错；结果回显 `scope`。

## 验证命令与退出码

```bash
PNPM_CONFIG_MINIMUM_RELEASE_AGE=0 pnpm -r check   # exit 0
PNPM_CONFIG_MINIMUM_RELEASE_AGE=0 pnpm -r test    # exit 0（全 8 包通过）
PNPM_CONFIG_MINIMUM_RELEASE_AGE=0 pnpm -r build   # exit 0

node prototype/pi-concurrency-reliability/probe-q1-cross-process.mjs   # exit 0，14 项检查；冷启动诊断 1/4 丢进程
node --import tsx prototype/pi-concurrency-reliability/probe-q2-concurrent.ts  # exit 0，5 项
node --import tsx prototype/pi-concurrency-reliability/probe-q3-real-model.ts   # exit 1，16 项里 7 项失败
```

Q3 的失败项：`R1:fixed`、`R1:current`、`R1-mechanics`、`R5:fixed`、`R5-mechanics`、`R1-stability`、`R5-stability`。这些失败是结论的一部分，没有删除断言或降低标准。

## 新增样例与确认流程

- 新增样例在跑之前已经写入并提交：`prototype/pi-concurrency-reliability/SAMPLES-Q1-Q3.md`（提交 `50b7217f`）。
- 交接要求“新增样例先展示给用户确认，再运行”。本次是在自主执行模式下完成的，**没有在运行前拿到用户确认**；只做到了“先冻结、后运行、不改样例迎合结果”。用户确认时应先看这份样例文件，再决定是否接受这些输入。
- 上一轮固定样例继续沿用，没有改动。

## 未决问题（给原大脑窗口）

1. **Q3 样例措辞**：`Business hours` vs `Support hours` 是否算同一事实？改样例还是加强“同一事实”判断，需要用户决定。
2. **Q3 可靠性门槛**：真实模型同一输入 3 次里 1–2 次改变决定，这样的纠错能否上线？要不要多次投票、阈值、人工确认或只做“建议”不自动写？
3. **Q2 冲突策略**：丢弃+报冲突、重读重规划、按 entity 串行、人工裁决，选哪一种。
4. **空库并发启动**：两个进程同时首次启动共用空库会有一个报 `database is locked` 退出。是否在 store 初始化加 SQLITE_BUSY 重试，还是要求启动顺序。
5. **死锁恢复时间**：默认 10 分钟过期 + 120 秒等待。想要多快的恢复？是否把旋钮变成正式配置。
6. **成本**：自定义端点没有价格表，当前只能报“未知”。要不要引入价格配置以得到估算费用；Q19 的四种口径已区分，但没有真实服务端费用可验。
7. **单证据绕过确定性 gate**：为了纠正摘要不被误判，有 verifier 时跳过了原 gate。正式实现是否接受这个分层，还是需要统一的判定器。
8. **原任务要求保留**：摘要重建现在按会话来源选材，但 anchor 里没有存“原任务要求”的文本；真正保留任务要求还需要一个来源。
9. **正式落地范围**：CAS 守卫、verify seam、极性修复、costBasis、scope 报错、摘要来源选材，哪些进 spec/ticket。

## 建议使用的技能

- 回到原窗口先 `/grill-with-docs`；确认样例措辞与冲突策略后，再 `/to-spec` → `/to-tickets`。
- 落地阶段 `/implement`（内含 `/tdd`、`/code-review`）。
- 版本控制用 `but`；**没有明确指令不要 push / PR / merge**。
