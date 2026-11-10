# 本轮新增样例（运行前固定）

固定时间：2026-11-10。先写这份文件并提交，再运行探针。运行后不得改样例或断言来迎合结果；失败照实报告。

本轮只回答三件事：跨进程同会话、两会话同时改同一条旧知识、真实模型单证据纠错。
上一轮已确认的样例（`prototype/pi-esm-full-sdk/SAMPLES-Q2-Q3.md`）继续沿用，这里只列新增部分。

---

## Q1 两个真实进程使用同一会话

### 运行环境（三个变体共用）

- 两个真实进程：`node apps/mcp/dist/index.js --transport stdio`（已构建的 ESM MCP 服务），各自独立的 stdio 客户端。
- 共用：同一个 `ANS_DB_PATH`（同一 SQLite 文件）、同一个 `ANS_PI_SESSION_DIR`（同一 PI JSONL 目录）。
- Provider：本地 OpenAI 兼容 SSE 端点，受控回答；服务端记录每次请求的开始/结束时间、请求体摘要。不访问外网。
- 同一个 `sessionId` 用固定字符串（探针内加随机后缀），不是每次重新 mint。

### S1 同会话串行 + 后一个接上前一个已完成记录

输入：
1. 进程 A，`ans_chat { sessionId: "q1-shared-<nonce>", message: "Q1-A-START. Reply with exactly: Q1-A-ANSWER-<nonce>." }`
2. 等 provider 记录到 A 的请求开始后，约 300ms，进程 B，同一 sessionId：
   `ans_chat { sessionId: "q1-shared-<nonce>", message: "Q1-B-CONTINUE. Restate the previous answer verbatim, then add: Q1-B-ANSWER-<nonce>." }`
3. Provider 对 A/B 都在 1200ms 后流式返回；回答文本包含各自标记。

判定：
- 同会话两次 provider 请求**不重叠**（A 的结束时间 ≤ B 的开始时间）。
- B 的请求体里能看到 A 已完成回答 `Q1-A-ANSWER-<nonce>`（说明 B 读到了 A 写下的会话记录）。
- 两次调用都拿到结构化结果，`sessionId` 不变。

预期：通过。现有代码有进程内队列（无效）+ 跨进程文件锁；本样例验证后者真能串行并续接。

### S2 会话文件完整、无损坏、无遗漏、无重复

输入：S1 完成后读取 `ANS_PI_SESSION_DIR`。

判定：
- 该 sessionId 只有 **一个** JSONL 文件。
- 每一行都能 `JSON.parse`，没有半截行。
- 整个文件中 `Q1-A-ANSWER-<nonce>` 出现 1 次、`Q1-B-ANSWER-<nonce>` 出现 1 次。
- 两次调用后文件行数严格增加，旧行前缀不变（追加写，不重写历史）。

预期：通过。

### S3 持锁进程异常退出后的恢复（不永久卡住）

输入：
1. 两个进程启动时设置 `ANS_PI_LOCK_STALE_MS=3000`、`ANS_PI_LOCK_TIMEOUT_MS=15000`（本轮新增的可测旋钮；默认仍是 10 分钟 / 120 秒）。
2. 进程 A，`sessionId: "q1-crash-<nonce>"`，message 含 `Q1-HANG`。Provider 收到后只发开始片段，永不结束（人为挂住，让 A 持锁）。
3. 约 500ms 后进程 B，同一 sessionId，message 含 `Q1-B-AFTER-CRASH`。
4. 约 800ms 时 SIGKILL 进程 A。

判定：
- B 在锁过期窗口内拿到锁并成功返回，没有出现永久 busy。
- 恢复后 B 的 provider 请求正常完成，B 的 JSONL 追加合法。
- 锁目录最终被清掉（或过期清理后不存在）。

预期：通过（前提是把过期时间做成可测；默认 10 分钟只意味着“会恢复”，不意味着“立刻恢复”）。

### S4 中断的请求不能被记录成成功完成

输入：同 S3 中被 kill 的 A。

判定：
- A 的 MCP 客户端没有收到任何 `tools/call` 成功结果（子进程死亡/连接断开）。
- JSONL 中没有 A 的完成回答标记，也没有 `Q1-HANG-COMPLETE` 这种成功尾巴。
- SQLite `budget_ledger` 里该 session 没有把这次请求记为已结算成功（`spent_tokens` 不因被杀请求增加）。若发现“预留未释放”，单独列出，不算成功记录。

预期：通过（只要求“不假成功”；预留泄漏是另一个问题，照实列出）。

### S5 不同会话仍能并行

输入：
- 两个进程，各自不同 sessionId：`q1-par-a-<nonce>` / `q1-par-b-<nonce>`。
- 两次 provider 请求都延迟 1200ms，同时发起。

判定：provider 日志中两次请求的时间区间有真实重叠（> 0ms）；两个 sessionId 各写各的 JSONL 文件。

预期：通过。

---

## Q2 两个会话同时纠正同一条旧知识

### 固定数据

- 旧知识（一条已有 live semantic row）：
  `Business hours are Monday to Friday 9-5.`
  它的 `source_episode_ids` 指向 3 条旧材料（同一 entity `support-hours`）。
- 会话 ALPHA 的 3 条新材料，共同 entity `support-hours`：
  `Support hours are now 24/7, no longer Monday to Friday 9-5. (ALPHA update v1)`
- 会话 OMEGA 的 3 条新材料，共同 entity `support-hours`：
  `Support hours are now 10:00-18:00 on weekends, no longer Monday to Friday 9-5. (OMEGA update v1)`
- 两边的 summarize seam 都是受控回答（ALPHA 返回第一句，OMEGA 返回第二句）；classify 返回 supported。
- 两个真实进程各自开一个 `SqliteSessionStore` 连接，共用同一个 DB 文件。
- 两个进程在 **plan 完成后、写事务开始前** 经过同一个文件屏障，确保两边都先读到旧版本，再允许提交。

### S0 现有行为复现（先看问题）

用原型开关 `ANS_PROTOTYPE_CONSOLIDATE_GUARD=0` 关闭并发守卫，跑上述场景。

预期（当前代码的实际行为）：
- 两边都报告 `update=1`，都认为自己的更新成功。
- 最终 live semantic row 有 **两条互相矛盾** 的结论（24/7 和周末 10-18 同时有效）。
- 旧行 `superseded_by` 只指向后写入的一条，先写入的更新关系被覆盖丢失。
- 旧材料被两次 `superseded_by` 写，最后一次覆盖前一次。

这是预期缺陷复现，不是通过项；记录实际结果。

### S1 原型修复后的并发冲突行为

同一场景，开关默认开启（`ANS_PROTOTYPE_CONSOLIDATE_GUARD=1`）。

判定：
- 两边 **不是都成功**：恰好一边 `update=1`，另一边明确报告并发冲突（`staleUpdates=1` / `conflict` 计数增加）。
- 最终只有 **一条** live semantic row，不存在两条互相矛盾的有效结论。
- 旧行 `valid_until` 非空，`superseded_by` 指向真正写入的新行。
- 旧材料只被真正生效的那次更新 retire，`superseded_by` 指向同一个新行。
- 受影响摘要只在真正生效的更新上被暂停（`summariesNeedingRefresh` 与 winner 一致）；失败一侧不产生第二条互斥版本关系。
- 失败一侧的新材料仍在库里（没有被删），只是没有被提升为知识；照实报告。

冲突处理选项（本轮不选哪条结论为真，只列出实际情况）：
1. 明确报告冲突并丢弃后提交的更新（原型当前选择，最小安全行为）。
2. 冲突时重新读取当前版本，重新规划一次，再把两边差异交给上层。
3. 按 entity 串行整理（整理期间对同一 entity 加锁），代价是牺牲部分并行。
4. 由用户/上层裁决哪条结论为真，系统只负责保留两份候选和版本关系。

### S2 无效整理范围必须报错，不能退回全库

输入：真实 MCP 进程，`ans_chat { operation: "consolidate", sessionId: "bad id with spaces" }`。

判定：返回 tool error（`isError: true`），错误文本说明 sessionId 不合法；不得悄悄改成全库整理，不得返回 add/update 计数。

预期：通过（本轮补的代码缺口）。

---

## Q3 真实模型下的单证据纠错可靠性

### 模型与参数（先报告）

- 真实端点。模型参数从环境读取并如实回传：`ANS_LLM_PROVIDER` / `ANS_LLM_MODEL` / `ANS_LLM_BASE_URL` / `ANS_LLM_API`；密钥只报告长度，不落盘。
- 每个 case 使用真实模型生成摘要；判定仍走仓库现有的确定性 gate 与 update 规则。
- 费用口径：该自定义端点没有价格表，provider 也不返回美元费用。**不得写成免费**；报告“已调用但费用未知（无价格配置）”。

### R1 主样例：同一件事被改正

当前知识：
`Business hours are Monday to Friday 9-5. Support email is help@example.com.`
新材料（单条，来源：官方支持页）：
`Official update: Support hours are now 24/7, no longer Monday to Friday 9-5. Effective 2026-11-01.`
调用：`consolidateMemory({ memoryIds: [新材料 id], allowSingleEvidence: true })`。

判定：
- `update=1`，旧行关闭并 `superseded_by` 指向新行。
- 真实模型生成的摘要明确是 24/7，不把 9-5 当作当前事实。
- 旧材料被 retire；旧行仍可查。

预期：通过。

### R2 只是发布时间/页面更新，内容没变

当前知识：同上。
新材料（单条）：
`Published 2026-11-01. Business hours are Monday to Friday 9-5. The page was republished with a new date.`
判定：`update=0`；不得因为“更新”字样把旧知识改掉。任何分类（skip/add/noop）都可以，只要不覆盖旧知识。

预期：通过。

### R3 有否定词，但说的是另一件事

当前知识：
`Business hours are Monday to Friday 9-5.`
新材料（单条）：
`Holiday business hours are not Monday to Friday 9-5; the office is closed on public holidays.`
判定：**不得**更新“常规营业时间”这条旧知识。正确行为是跳过或另建一条“节假日营业时间”的新知识。

预期（预先声明的缺陷）：现有单证据分支只看“任意否定词 + 文字重合”，很可能把节假日特例误当成对常规时间的纠正（`update=1`）。若复现，则原型修复后重跑；若没复现，也照实记录。

### R4 新材料可信度不足

当前知识：同上。
新材料（单条，匿名论坛转述）：
`Someone on a forum says support might be 24/7 now, but the poster is not certain and gives no official source.`
判定：`update=0`；不得用一条不确定转述覆盖可靠结论。

预期（预先声明的缺陷）：现有 gate 只校验“摘要是否被这段材料支持”，不确定转述照样能通过；很可能误更新。若复现，原型修复后重跑。

### R5 一份旧材料包含多条事实，只改其中一条

当前知识：
`Business hours are Monday to Friday 9-5. Support email is help@example.com. The office is closed on public holidays.`
新材料（单条）：
`Support hours are now 24/7, no longer Monday to Friday 9-5.`
判定：
- `update=1`。
- 新知识保留邮箱 `help@example.com` 和“公共假日关闭”两条仍有效的事实，只替换营业时间。
- 被替换的旧材料可追查，历史原文不删。

预期（预先声明的缺陷）：现有更新只拿“新材料”重新生成摘要，很可能丢掉旧行里的另外两条事实。若复现，原型修复后重跑。

---

## 通过/失败口径

- Q1/Q2 的流程行为可以用受控回答。
- Q3 的语义判断必须由真实模型完成；固定回答不得代替。
- 失败项按“发现问题 / 原型修复后通过 / 尚未验证”三类写，不把修复前的失败算成通过。
- 不得删除既有有效断言或降低标准。
