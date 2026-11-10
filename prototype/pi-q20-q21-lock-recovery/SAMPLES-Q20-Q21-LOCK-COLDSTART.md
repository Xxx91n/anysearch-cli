# 本轮新增样例（运行前待确认）

分支：`prototype/pi-q20-q21-lock-recovery`（叠在 `prototype/pi-concurrency-reliability` 之上，未推送）

这份文件只做一件事：把本轮要跑的新增样例补完整，摆在这里等确认。**确认之前不运行任何样例、不改正式数据。** 上一轮"先跑再报"的做法本轮不重复。

---

## 0. 本轮要回答的四个问题

1. 真实模型能否按 Q20 执行：同一事实、同一对象、同一范围、同一时间才自动纠正；只替换被纠正的事实；对不上或证据不足时不覆盖，并把缺什么、该补查什么交回调用方。
2. 两个真实进程同时纠正同一条旧知识时，能否按 Q21 收敛：先阻止基于旧版本的写入，重读当前版本，最多重新判断一次；仍然冲突就返回双方材料和差异，不偷选一边、不静默丢证据、不无限重试。
3. 活任务会不会被错误抢锁：正常长任务超过测试过期时间仍受保护；同会话第二个进程继续等；持锁进程真被杀后能恢复；不产生假成功、损坏或重复写入。
4. 空库首次并发启动能否可靠完成：两个进程同时打开同一个全新数据库，重复 5 轮，每轮都启动成功、结构完整。

这是验证问题，不是正式实现、spec 或切票。样例通过也不能拿来宣称整体准确率。

---

## 1. 真实模型与参数（先报告，费用未知就报未知）

- Provider：`openai`
- 模型：`deepseek-v4.1-flash`
- 端点：`https://amr-link.open-design.ai/v1`，wire API：`chat`
- 密钥：只在进程环境里用，长度 39，不写进任何输出、日志、提交或证据文件
- 调用方式：`createLlmSession` + `createConsolidationSeams`（`summarize` / `verify` 都是真实模型直接返回，不用固定回答）
- 温度、最大输出等参数：不显式设置，用端点默认值；证据里记录每次调用和 provider 返回的 token
- 费用：这个自定义端点没有价格表，provider 也不返回美元金额。`costUsd=0` 只表示"未知"，**不表示免费**。证据里写 `costBasis="unknown"` 和缺少的价格项。
- 每次运行记录：调用次数、输入/输出/cache token、每个样例的提示词（截断保存）、判定结果。费用只能报"未知"。

样例材料是人为拟定的测试材料，不是线上事实，也不是论文实验题。"已核实的官方材料"只是本轮测试前提，用来验证后续处理，不证明现实中的来源核验能力。

---

## 2. 样例 A：真实模型执行 Q20

四个样例都用真实模型判断，不允许脚本写死 `sameFact` / `reliable`。每个样例一个独立临时库，互不污染。

### A1 明确纠正同一事实（正例，覆盖"替换被纠正的事实、保留其他事实"）

**旧知识（一条已生效的 semantic memory）**

> A 公司在线客服的服务时间为工作日（周一至周五）9:00—17:00。客服邮箱为 help@example.com。

**旧材料（3 条 episode，支撑上面这条旧知识）**

| 字段 | 值 |
|---|---|
| entity | `a-support-hours` |
| url | `https://a.example/support-hours-v1`、`...-v2`、`...-v3` |
| title | `A 公司客服时间（原官网页面 v1/v2/v3）` |
| snippet | `A 公司官网客服页面写明：在线客服工作日（周一至周五）9:00—17:00 提供服务，客服邮箱 help@example.com。` |
| source | `tavily` |

**新材料（1 条 episode）**

| 字段 | 值 |
|---|---|
| entity | `a-support-hours` |
| url | `https://a.example/notice-2026-11-01` |
| title | `A 公司客服时间更新通知（官方）` |
| snippet | `A 公司官方通知（2026-11-01 生效）：在线客服自 2026-11-01 起改为 7×24 小时全天候服务，替代原工作日（周一至周五）9:00—17:00 的安排。` |
| source | `tavily` |

**操作**：`consolidateMemory({ memoryIds: [新 episode id], allowSingleEvidence: true, preserveOnUpdate: true })`，注入真实模型 `summarize` / `classify` / `verify`。

**预期（判定标准）**

- `update=1`；旧 semantic row 关闭（`valid_until` 非空）且 `superseded_by` 指向新 row。
- 当前生效内容明确写 7×24 小时，且**不把旧 9:00—17:00 当成现在仍然有效的安排**；允许"替代了原 9:00—17:00"这种明确标注为历史/被替代的说法。
- 新内容保留 `help@example.com`。
- 3 条旧 episode 仍留在归档，只是 `superseded_by` 指向新 row；新材料也在归档，不删除。
- 报告能看出这次是"同一事实的纠正"，不是靠关键词碰运气。

### A2 对象不同（门店营业时间 vs 在线客服）

**旧知识**

> A 公司门店营业时间为每天 10:00—20:00。

**旧材料（3 条 episode）**

| 字段 | 值 |
|---|---|
| entity | `a-store-hours` |
| url | `https://a.example/store-v1`、`...-v2`、`...-v3` |
| title | `A 公司门店营业时间 v1/v2/v3` |
| snippet | `A 公司官网门店页面写明：门店营业时间为每天 10:00—20:00。` |
| source | `tavily` |

**新材料（1 条 episode）**

| 字段 | 值 |
|---|---|
| entity | `a-support-hours` |
| url | `https://a.example/support-now` |
| title | `A 公司在线客服时间说明` |
| snippet | `A 公司在线客服自 2026-11-01 起提供 7×24 小时全天候服务。` |
| source | `tavily` |

**操作**：同一个 `consolidateMemory` 调用，`allowSingleEvidence: true`，真实模型判断。

**预期**

- `update=0`，门店营业时间旧知识仍然生效。
- 真实模型判断 `sameFact=false`（新材料说的是在线客服，不是门店营业时间），报告里能看到这个判断和理由。
- 新材料保留在归档，不被当成门店营业时间的新结论，也不被删除。
- 报告要把旧知识原文、新材料原文/来源、模型判断理由一起交回，让调用方知道"对象对不上、需要补门店营业时间的材料"。不要求模型写出一条完美建议，但缺的信息必须看得见。

### A3 来源不足（论坛转述）

**旧知识**

> A 公司在线客服的服务时间为工作日（周一至周五）9:00—17:00。客服邮箱为 help@example.com。

**旧材料**：同 A1 的 3 条旧 episode。

**新材料（1 条 episode）**

| 字段 | 值 |
|---|---|
| entity | `a-support-hours` |
| url | `https://forum.example/thread-123` |
| title | `论坛帖子：A 公司客服是不是改时间了` |
| snippet | `论坛帖子称：听说 A 公司在线客服可能已改成全天在线，但发帖人不确定，也没有给出官方链接。` |
| source | `tavily` |

**操作**：同 A1。

**预期**

- `update=0`，旧知识仍然生效。
- 模型判断 `reliable=false`（转述、不确定、无官方来源），或者常规校验直接拒绝；报告里能看到理由。
- 不把"听说/可能"变成确定事实，也不删除这条材料。

### A4 一份旧材料多条事实，只改正其中一条

**旧知识**

> A 公司在线客服工作日（周一至周五）9:00—17:00 提供服务。客服邮箱为 help@example.com。公共假期暂停人工客服，仅保留自助服务。

**旧材料（3 条 episode）**

| 字段 | 值 |
|---|---|
| entity | `a-support-hours` |
| url | `https://a.example/support-facts-v1`、`...-v2`、`...-v3` |
| title | `A 公司客服说明 v1/v2/v3` |
| snippet | `A 公司官网写明：在线客服工作日（周一至周五）9:00—17:00 提供服务，客服邮箱 help@example.com，公共假期暂停人工客服、仅保留自助服务。` |
| source | `tavily` |

**新材料（1 条 episode）**

| 字段 | 值 |
|---|---|
| entity | `a-support-hours` |
| url | `https://a.example/notice-2026-11-01b` |
| title | `A 公司客服时间更新通知（官方）` |
| snippet | `A 公司官方通知（2026-11-01 生效）：在线客服改为 7×24 小时全天候服务，替代原工作日（周一至周五）9:00—17:00 安排。客服邮箱和公共假期的人工客服安排保持不变。` |
| source | `tavily` |

**预期**

- `update=1`，当前内容写 7×24 小时。
- 保留 `help@example.com` 和"公共假期暂停人工客服、仅保留自助服务"。
- 旧 9:00—17:00 不再作为当前安排；允许明确标注"替代了原 9:00—17:00"。

> 说明：A4 是 A1 的加强版，专门覆盖 Q20 的"只替换被纠正的事实"。如果用户认为 A1 的邮箱保留已经够了、不想多跑，可以删掉 A4；确认时请明说。

---

## 3. 样例 B：两个真实进程并发纠正同一条旧知识（Q21）

两个真实进程（两个独立 Node 进程，各自一个 SQLite 连接），共用一个临时库。计划阶段用一个文件屏障保证两边都先读到旧版本，之后才允许写。

**共同旧知识（一条生效的 semantic memory）**

> A 公司在线客服工作日（周一至周五）9:00—17:00 提供服务。客服邮箱为 help@example.com。

**共同旧材料（3 条 episode，属于一个 seed 会话）**

| 字段 | 值 |
|---|---|
| entity | `a-support-hours` |
| url | `https://a.example/support-hours-old-v1`、`...-v2`、`...-v3` |
| title | `A 公司客服时间（旧页面 v1/v2/v3）` |
| snippet | `A 公司官网客服页面写明：在线客服工作日（周一至周五）9:00—17:00 提供服务，客服邮箱 help@example.com。` |
| source | `tavily` |

### B1 两边依据同一份官方通知做同样更正

- 会话 alpha 的新材料：`https://a.example/notice-2026-11-01`，title `A 公司客服时间更新通知（官方）`，snippet `A 公司官方通知（2026-11-01 生效）：在线客服改为 7×24 小时全天候服务，替代原工作日（周一至周五）9:00—17:00 的安排。`，entity `a-support-hours`，source `tavily`。
- 会话 beta 的新材料：同一份通知的同一段文字，url 用 `https://a.example/notice-2026-11-01-copy`，title/snippet 与 alpha 完全一致，entity 仍是 `a-support-hours`。**故意不用同一个 url**：`saveResults` 写入时会把同 url 的旧记录 `valid_until` 关掉（`packages/store/src/time-decay.ts` 的 `invalidateOldRecords`），用同一个 url 会让 beta 的材料在入库阶段就被标成失效，干扰"两边材料都保留"的观察。两条记录文字相同、来源相同，代表同一份通知被两个会话分别取回。
- 两个进程都 `allowSingleEvidence: true`，都先 plan 到旧版本，再进写事务。

**预期**

- 最终只有 **1 次 update**，只有 **1 条生效 semantic row**；不存在两条互相矛盾的有效结论。
- 后提交的一方在写事务里发现旧版本已被关闭，回滚，重读当前版本，**最多重新判断一次**；识别出"已经有同样更正"后不再制造第二个版本。后提交方的报告里要能看到这件事（重试次数、最终 noop/skip、没有新版本）。
- 旧 row 的 `superseded_by` 与旧 episode 的 `superseded_by` 指向同一个新 row。
- 两边的材料都留在归档，不靠删除失败一方的证据来"解决"冲突。
- 受影响摘要的暂停记录指向唯一的新 row。
- 重试上限可数：后提交方最多 2 次真实模型判断（初次 + 重读后一次），不会无限重试。

### B2 两边材料互相冲突，重试一次后仍无法协调

- 会话 alpha 的新材料：同 B1 的官方通知（7×24 小时，2026-11-01 生效）。
- 会话 beta 的新材料：`https://b.example/notice-2`，title `A 公司客服时间通知（另一份）`，snippet `A 公司通知：在线客服仅在周末 10:00—18:00 提供服务。`，entity `a-support-hours`，source 仍为 `tavily`（与 alpha 来源地位相同，且没有生效日期、没有适用范围说明能解释两份通知的差异）。
- 两个进程同样先 plan 旧版本，再写。

**预期**

- 先写入的一方落地一次 update；后提交的一方被阻止覆盖，回滚后重读当前版本，再判断一次。
- 重读后仍然冲突时，后提交方**明确返回冲突**：双方材料原文、来源、当前生效内容、差异说明都在报告里；不静默选一边，不覆盖当前生效内容。
- 最终仍是 1 条生效 semantic row；两边材料都在归档；旧 row / 旧 episode 的版本关系与先写入的一方一致。
- 后提交方最多 2 次真实模型判断；不出现第三次重试或无限循环。

> 冲突如何处置（保留先写入版本 + 明确报冲突，等调用方查证）是 Q21 已确认的方向。本样例只验证"是否按这个方向收敛"，不替用户判断哪条结论为真。

---

## 4. 样例 C：锁的活任务保护与崩溃恢复

真实 MCP 进程 + 本地 OpenAI 兼容 SSE 端点，时间可控。测试用短过期时间，**不等于确定正式默认值**。

### C1 正常长任务超过测试过期时间，不被抢锁

- `ANS_PI_LOCK_STALE_MS=3000`，`ANS_PI_LOCK_TIMEOUT_MS=20000`。
- 进程 A：`sessionId = lock-live-<nonce>`，消息 `LOCK-A-START`；本地端点延迟 **6000ms** 才返回，A 的锁持有时间明显超过 3 秒过期线。
- 进程 B：同一 `sessionId`，在第 **4 秒** 发起消息 `LOCK-B-CONTINUE`，要求复述 A 的答案并追加自己的答案。
- 两个进程共用一个临时库和 PI 会话目录。

**预期**

- A、B 的 provider 请求**不重叠**：B 的请求开始时间不早于 A 的结束时间。仅因锁年龄超过 3 秒就抢锁的情况不能再出现。
- B 能接上 A 已经完成的会话记录，返回成功结构化结果，`sessionId` 一致。
- 同一个会话只有一份 PI JSONL；每一行都能解析；turn 记录是 2 条 user + 2 条 assistant，顺序正确；无重复写入。
- 结束后锁目录清空，不永久卡住。
- 记录 A 运行期间心跳/存活证据的时间点，证明锁在 3 秒后仍然有效。

### C2 持锁进程真正被杀后恢复（沿用上一轮有效检查，不删断言）

- 进程 A 请求 `LOCK-HANG`，端点只发一部分内容并保持连接，A 一直占锁。
- 进程 B 同一会话请求 `LOCK-B-AFTER-CRASH`，先等着。
- 约 1 秒后 SIGKILL A，同时断开它的 provider 连接。
- 断言：
  - B 能获取锁并完成，返回成功结果；
  - A 的请求以 transport error / 非成功结束，**不能记成成功**；
  - PI JSONL 里没有 `LOCK-HANG-PARTIAL`，B 的完成记录存在；
  - budget ledger 没有被杀请求的已花 token；
  - 锁目录最后清空；
  - JSONL 无损坏、无遗漏、无重复写入。

---

## 5. 样例 D：空库首次并发启动

- 临时目录里放一个**全新**数据库路径（不预先创建、不预先初始化，不能靠"先初始化再测"绕开本题）。
- 同一瞬间启动两个真实 MCP 进程，共用这个数据库和 PI 目录。
- 每个进程都要完成 MCP `initialize`，再成功调用 `tools/list`（只活着不算启动成功）。
- 每轮结束后检查：`PRAGMA integrity_check` 为 `ok`；关键表存在（`sessions`、`messages`、`retrieval_results`、`resume_anchors`、`budget_ledger`、`semantic_memories`、`access_events`、`entity_merge_log`、`edge_patterns`、`t0_preferences` 以及 FTS/触发器）；`journal_mode=wal`。
- **固定重复 5 轮**，每轮两个进程都启动成功、结构完整。
- 失败时不许吞错误假装成功：进程退出码非 0、initialize 失败、或 stderr 出现 `database is locked` 都要记录原始脱敏输出。
- 修复后允许有限次 SQLITE_BUSY 重试；重试耗尽仍然失败就如实抛错，不伪装成启动成功。

---

## 6. 判定口径

- 每条检查都记录：输入、操作、原始观察、通过/失败、证据文件位置。
- A 组四个样例是**单次判断样例**，不是准确率统计。通过只能说明"这几个样例这次做对了"，不能说"整体纠错准确率是 X%"。
- 真实模型有波动，同一冻结输入如果出现不一致，如实报告分布，不靠改样例或改断言把它抹平。
- 旧断言全部保留：上一轮 Q1 的串行、接续、JSONL 完整性、崩溃恢复、不假成功、异会话并行，以及 Q2 的旧断言，本轮不被替换、不被降低。
- 费用口径按 Q19：没调用=`not-called`，调用了但价格未知=`unknown`，有价目表估算=`price-estimate`，服务端返回=`provider-reported`。本轮自定义端点预期是 `unknown`，不填免费。

---

## 7. 计划的最小改动（**尚未实施**，随样例一起确认）

只列文件和行为，不贴大段代码。目的是让"必要调整"和样例一起被看见。

1. `packages/kernel/src/pi-runtime.ts`
   - `acquireFileLock()` 增加心跳续期：持锁期间定时刷新锁目录里的心跳文件；清理时停掉定时器。
   - 锁目录里记录持锁进程的 pid + hostname；同机且进程还活着时，不因心跳/锁年龄过期而抢锁；进程已死或跨机时才按过期时间判断。
   - 保留环境变量覆盖，测试用短期限；正式默认值不在本轮拍板。
2. `packages/store/src/session-store.ts`
   - 初始化阶段对 `SQLITE_BUSY` / `SQLITE_LOCKED` 做有限次、递增等待的重试（schema、WAL 切换、迁移、bootstrap）；重试耗尽仍抛原错误，不吞。
3. `packages/store/src/consolidate.ts`
   - `verifyDetails` / `staleDetails` 增加调用方需要的信息：旧知识原文、候选摘要、来源材料、判断理由；仍拒绝时明确列出"缺什么"。
   - 并发冲突改为 Q21 流程：写事务里发现目标 row 已变 → 回滚 → 重读当前版本 → **最多重新判断一次**；仍冲突则报告双方材料与差异，不写第二版。
   - 第一次写事务的回滚不能留下半写状态；重试期间的计数要能区分"已解决的重试"和"仍冲突"。
   - `dryRun` 仍然回滚、不落盘；是否会因重试产生额外模型费用，在证据里如实记录。
4. `packages/kernel/src/consolidation.ts`
   - 保持"同一对象/具体事项/适用范围/时间"判断，补上"缺什么材料"的可读理由；调用计数覆盖 summarize 和 verify。
5. `apps/mcp/src/tools/ans-chat.tool.ts`
   - 补 Q18 剩余缺口：`sessionId` 和 `memoryIds` **都没给**时直接报错，不能退回全库整理。非法 `memoryIds` 同样报错。
6. `apps/mcp/src/ans-chat-session.ts`、`apps/cli/src/commands/consolidate.ts`
   - 回传新增的冲突/拒绝明细与重试次数；`scope` 明确显示，不把"没给"写成"全库"。
7. 新增探针与证据：`prototype/pi-q20-q21-lock-recovery/` 下的 `probe-q20-real-model.ts`、`probe-q21-concurrent.*`、`probe-lock-live.mjs`、`probe-cold-start.mjs`，结果写 `out/*.json`。
8. 旧样例、旧探针、旧证据文件不动；上一轮代码不删。

---

## 8. 需要用户确认的内容

请明确回复：

1. 以上 A1–A4、B1–B2、C1–C2、D1 的**具体输入、来源、预期**是否确认？确认后才运行。
2. A4 是否保留（A1 已覆盖邮箱保留，A4 额外覆盖"一条旧知识里多条事实"）。
3. B1 的同 url 与不同 url：确认按"能共存就用同 url，不能就同文不同 url，证据写清"处理，还是坚持必须同 url？
4. 第 7 节的最小改动范围是否同意？特别是锁的心跳 + 同机 pid 存活判断、冲突重试一次、空库初始化重试。
5. 推送：交接文件写"本轮没有推送、PR、合并授权"，和你消息里的"push 到上游"冲突。我按交接文件**不推送**，等你确认后另行授权；如果现在就要推，请明说。

确认之后才进入运行阶段；结果出来再按题回传，不自动进 spec、切票或正式实现。
