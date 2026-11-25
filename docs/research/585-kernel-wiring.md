# 内核接线取证：consolidate 怎么被触发 / 同 URL 重抓旧行怎么办

调研日期：2026-11-25。所有「行号」都是亲眼读过的代码位置；结论后面标注「验证」表示看过原代码，标注「推断」表示根据代码结构推导、没有逐行盯到。

---

## A. consolidate 平时到底怎么被触发、多久跑一次

### A.1 先把两个「consolidate」分清——它们同名但完全是两码事

代码里有两个叫 consolidate 的东西，**这不是推测，是事实**：

1. **`MemoryPipeline.consolidate()`**（`packages/kernel/src/memory-pipeline.ts:1396`）：会话内的**滚动压缩**，产物写进 `resume_anchors` 表，anchor_type 是 `rolling_summary` / `l2_recall`（`memory-pipeline.ts:1599`、`memory-pipeline.ts:1770`）。它**不写 `semantic_memories`**，跟长期知识库没关系，只是把会话历史压缩成滚动摘要、防止上下文爆炸。
2. **`store.consolidateMemory()`**（`packages/store/src/session-store.ts:1695`，实现在 `packages/store/src/consolidate.ts:768`）：这才是**把材料整理进 `semantic_memories` 长期知识库**的那个。它**只能被外部手动喊**，内核不会自己发起。

下面 A.2–A.4 说的 consolidate 都是第 2 个（进长期知识库的那个）。

### A.2 手动触发路径（验证）

**MCP 路径**（`apps/mcp/src/tools/ans-chat.tool.ts`）：

- `ans_chat` 工具带一个 `operation` 参数，取值 `"chat"` 或 `"consolidate"`，默认 chat（schema 描述见 `packages/kernel/src/tool-schemas.ts:119-120`）。
- operation=consolidate 时的入参（`ans-chat.tool.ts:299-309`）：`sessionId`（此时语义变成「要整理哪个会话的材料」）、`memoryIds`（指定材料 id 列表）、`allowSingleEvidence`、`dryRun`。
- **必须显式给 scope**：`resolveConsolidateScope({sessionId, memoryIds})`（`ans-chat.tool.ts:325-333`），scope 缺失或畸形直接拒绝，绝不退化成「整理全库」。
- 然后调 `store.consolidateMemory({dryRun, scope, allowSingleEvidence}, seams)`（`ans-chat.tool.ts:405-417`），seams 里是 summarize/classify/verify/verifyFinal/judgeEntityAlias 五个缝。

**CLI 路径**（`apps/cli/src/commands/consolidate.ts`）：

- `ans consolidate --session ID | --memory ID`，`--dry-run|--apply`，`--limit N`（help 文本 `consolidate.ts:46-104`）。
- 同样强制显式 scope；走同一个 `resolveConsolidateScope` 和 `createConsolidationSeams`，两条入口共享同一套规则（文件头注释 `consolidate.ts:1-8`）。

### A.3 每次对话后自动跑的那个，不是它（验证）

`pi-runtime.ts` 的 finishTurn 包装（1316 行起，亲读 1316-1365）：

- 每一轮对话结束后，**自动**执行三行：`gate.evaluate` → `gate.applyTo` → `this.pipeline.consolidate(enriched, totalTokens, hasRetrievalEvidence)`（`pi-runtime.ts:1331-1363`）。这里调的是 **A.1 里的第 1 个**——MemoryPipeline 的滚动压缩。
- 这个自动 consolidate 干什么（`memory-pipeline.ts:1394-1680`）：
  - **rolling summary**：两个触发条件任一成立才干活——上下文占用 token 超水位线（默认 128k，`memory-pipeline.ts:584` 的 `triggerLowWatermark = totalTokens > LOW_WATERMARK_TOKENS`），**或者本轮有搜索证据且消息数 >4**（`triggerPostSearch = hasRetrievalEvidence && messages.length > 4`，`memory-pipeline.ts:585`）。都不满足直接 `skip`（`memory-pipeline.ts:587-589`）。触发后是**后台 fire-and-forget** 的一次 `generateSummaryWithUsage` 模型调用，写完存进 `resume_anchors` 表 anchor_type=`rolling_summary`（`memory-pipeline.ts:1597-1604`）。reuse 判决（`adjudicateReuseCompress`，`memory-pipeline.ts:1640`）可能再加一次模型调用。超时上限 90 秒（`BACKGROUND_SUMMARY_TIMEOUT_MS = 90_000`，`memory-pipeline.ts:41`）。
  - **l2_recall**：只要本轮最后一次搜索工具的 query 长度 >3，就**每轮都跑**（`memory-pipeline.ts:1700-1777`）——拿 query 去 FTS 检索记忆库 top5，拼成不超过 1500 字的文本块，存 `l2_recall` anchor。可能带一次 query rewrite 的 LLM 调用（`llmRewriteFn` 可选缝，没有就跳过）。
- **关键区分（验证）**：这一整套产物都进 `resume_anchors`，是「这个会话的回忆便签」，供 inject() 塞回下一轮 prompt 用。它**从不动 `semantic_memories`**。所以「每次对话后自动整理」这个说法只对滚动摘要成立，对长期知识库不成立。

### A.4 PI（内部 agent）会不会自己发起 consolidate（验证）

**不会。** 依据：

- PI 能用的工具 = search 工具 + `this.opts.tools`（`pi-runtime.ts:925-937`：`const allTools = [searchTool, ...(this.opts.tools || [])]`）。
- 两个生产调用方 `apps/cli/src/commands/chat.ts:270` 和 `apps/mcp/src/tools/ans-chat.tool.ts:608` 构造 PiAgentRuntime 时**都没传 `tools`**（亲读两处构造参数），所以 PI 手里只有搜索工具。
- 全仓库 grep `consolidateMemory` 的非测试调用方只有：`apps/cli` 的 consolidate 命令、`apps/mcp` 的 ans_chat(operation=consolidate)、eval runner（`packages/store/src/eval/runner.ts:512`，测试驱动）。

**结论：进 semantic_memories 的整理永远是外部手动喊的——要么人敲 `ans consolidate`，要么宿主 AI 通过 MCP 调 `ans_chat operation=consolidate`。PI 搜完索不会自动整理进长期知识库。**

### A.5 跑一次 consolidate 的成本（验证 + 推断）

模型调用按簇（entity 聚簇）计。从 `consolidate.ts` 亲读：

| 调用 | 何时发生 | 次数 |
|---|---|---|
| `summarize`（总结簇材料） | 每个触发的簇 | 1 次（`consolidate.ts:1175`） |
| `classify`（逐条 claim 忠实度门） | **不是模型调用**——`classifyClaim` 是确定性打分（BM25 重叠+jaccard+cosine+entity，无 LLM，`packages/kernel/src/attribution.ts:170` 起） | 0 次模型调用 |
| `verify`（同事实/可靠性校验） | 簇内容跟已有知识行同主题（jaccard>0.4 或 cosine noop 区）或单证据纠正时 | 0-1 次（`consolidate.ts:1287` 附近 `runCorrectionCheck`） |
| `summarize`（merge：旧知识+新证据合并重写） | verify 判定是 correction 后 | +1 次（`consolidate.ts:1444`） |
| `verifyFinal`（终检：旧事实保住没、改动落实没、有无夹带） | merge 成功后 | +1 次（`consolidate.ts:1467`） |
| `judgeEntityAlias`（跨文字实体判定） | 只在材料里出现跨文字名对（中英文同一公司等）时 | 不定，通常 0（`consolidate.ts:1070`） |
| 并发撞车重判 | 罕见（别的会话抢先改了同一行） | 最多 +verify/summarize/verifyFinal 各 1（`consolidate.ts:1600` 起注释说明 at most one re-judge） |

**典型一簇：1-4 次模型调用**（纯新增 1 次；纠正已有知识 4 次）。embedding 另外算（embedText，小模型/接口）。

**触发门槛**（验证，`consolidate.ts:1154-1163`）：
- 每簇至少 **3 条活材料**（`CLUSTER_MIN = 3`，`consolidate.ts:33`），除非 `--single-evidence`（1 条材料只允许纠正、不许新建）。
- 还要过「老化门槛」：最老材料超过该 tier 半衰期 tau，**或者**平均访问次数 ≤1（`consolidate.ts:1159-1163`）。新抓的热乎材料如果访问多，簇甚至不触发——不触发就没有 summarize 调用，零成本。

**今天的输入规模**：材料就是 `retrieval_results` 里的行，`snippet` 列是搜索引擎给的摘要（exa/tavily 之类，一般几十到几百字）。每簇 3 条起步，所以 summarize 的输入大概是「3-N 条 × 每条几百字」的量级，几千字封顶。`dry-run` 也照跑模型调用（CLI help 明说「It can still call the model and cost money」）。

**频率总结**：consolidate（进知识库的）不自动跑，跑多少次完全取决于外部喊多少次。每次对话后自动跑的只有滚动摘要和 l2_recall，成本是每轮 0-2 次后台模型调用，且与知识库无关。

---

## B. 同 URL 重抓/重搜时，旧行到底怎么被处理

### B.1 `invalidateOldRecords` 精确行为（验证）

`packages/store/src/time-decay.ts:133-145`，全文很短：

```sql
UPDATE retrieval_results SET valid_until = datetime('now')
WHERE url = ? AND id != ? AND valid_until IS NULL
```

调用点在 `saveResultsWithIds`（`session-store.ts:1343`）：每 INSERT 完一行新结果，拿**这行的 url** 把**所有同 url 的旧行**的 `valid_until` 打成当前时间。

逐条回答：

1. **触发条件**：只看 `url` 相等。**不看 session**（SQL 里没有 session_id 条件）、不看 entity、不看谁写的。**全局同 URL 的旧行全部作废**，包括别的会话写的、别的任务写的。注意传入的参数名叫 `entityKey`，但实际传的是 `r.url`（`session-store.ts:1343`），SQL 匹配的也是 `url` 列——`time-decay.ts:138` 的注释自己承认「entity matching is URL-based for MVP」。
2. **「作废」写什么**：只写 `valid_until = 当前时间`。一行 SQL，没有别的字段。`superseded_by` **不动**（那是 consolidate 纠正传播用的另一个机制，见下）。行本体不删，snippet/title 原样留着。
3. **已经作废的行不会再被打**：`valid_until IS NULL` 条件保证幂等。刚插入的新行自己被 `id != ?` 排除。

### B.2 作废的后果（验证）

所有召回路径的 SQL 都带同一份过滤（亲读）：

- FTS 召回 `searchAllResults`（`session-store.ts:811`）：`valid_until IS NULL AND quarantine IS NULL AND archived = 0 AND superseded_by IS NULL`
- 向量臂（`session-store.ts:1646`）：同样四个条件
- 融合后活性复查（`session-store.ts:1225-1231`）：再过滤一遍
- 实体臂（`session-store.ts:2841`）、最近记录查询（`session-store.ts:2723`）：同样

**所以 `valid_until` 一打，这行立刻从所有召回消失**（行还在表里，FTS 索引里也还有它的词，但 SQL JOIN 后的 WHERE 把它滤掉了）。

**consolidate 还能不能读到它？能。** consolidate 的扫描 WHERE 是 `entity IS NOT NULL AND quarantine IS NULL AND archived = 0`（`consolidate.ts:1039`）——**故意不滤 valid_until**，注释（`consolidate.ts:1033-1035`）写明：「Cluster scan INCLUDES superseded rows (valid_until NOT NULL): same-entity writes soft-close the prior version immediately, so episodic history *is* the closed-row set」。即：作废行是历史证据，整理时仍然作为材料参与。但注意 consolidate 后续的批次门槛只数 `superseded_by IS NULL` 的活材料（`consolidate.ts:1150`），而 **valid_until 作废 ≠ superseded_by**——被 invalidateOldRecords 作废的行 `superseded_by` 仍是 NULL，所以在 consolidate 眼里它仍是「活材料」计数。（这是两个字段语义分裂的地方，见 B.5 的坑。）

### B.3 关键场景推演：先搜后抓（snippet → 整页）

前提事实（验证）：`retrieval_results` 表有 `snippet` 列和 `fetched` 布尔列（`schema.sql` retrieval_results 定义），`saveResults` 写入的是 `title`+`snippet`（`session-store.ts:804` 的 INSERT 语句：`session_id, url, title, snippet, source, rrf_score, entity, source_label, trace_id`——**fetched 列根本没写**， FTS 索引也只索引 title+snippet）。仓库里目前**没有 web_fetch 工具**（全仓 grep web_fetch 无产品代码命中；`fetched` 列存在但没有写入路径用它——推断：是预留列）。

推演「整页正文入库走 saveResultsWithIds 同一条路」的方案（即把正文塞进 snippet 或新增列、按结果 INSERT 新行）：

1. 昨天：`search exa.com/xxx` → INSERT 行1（id=100，snippet=搜索摘要），`invalidateOldRecords` 跑一遍但库里没有同 URL 旧行，无操作。
2. 今天：fetch 抓了 `exa.com/xxx` 整页 → INSERT 行2（id=101，正文进 snippet 或某列）→ `invalidateOldRecords(db, "exa.com/xxx", 101)` 执行 → **行1 的 valid_until 被打上时间戳，立即退出所有召回**。
3. 后果：行1 的搜索摘要召回没了，行2 正文接管召回。如果这是设计意图（新版取代旧版），行为正确。
4. **但要小心**：行1 虽然退出召回，consolidate 扫簇时它仍是「活材料」（`superseded_by` 是 NULL）——它和行2 的内容会被当作**两条独立证据**一起喂给 summarize。同一来源的摘要+正文被算成「两条独立材料」，CLUSTER_MIN=3 的门槛更容易被同一来源灌水冲过。（推断：这是簇计数的一个实际偏差，代码没有按 URL 去重的逻辑——扫描 SELECT 没有任何 dedupe，见 `consolidate.ts:1050-1054`。）
5. 如果方案是「**正文就地 UPDATE 进同一行**」（不 INSERT 新行、直接改行1）：那么 `invalidateOldRecords` 根本不会被触发（它只在 INSERT 后跑），行1 保持存活，自然没有作废问题。**但是另一个坑**：FTS 索引不同步——schema 里 `retrieval_results` 只有 INSERT 和 DELETE 触发器（`schema.sql` retrieval_ai / retrieval_ad），**没有 UPDATE 触发器**。就地 UPDATE 正文后，FTS 索引里还是旧的 snippet 文本，新正文里的词**永远搜不中**（验证：schema.sql 亲读，retrieval_au 不存在；对比 messages 表是三个触发器齐全的）。除非入库时手动重建该行 FTS（`INSERT INTO retrieval_results_fts(retrieval_results_fts, rowid...) VALUES('delete',...)` 再重插），否则正文入库对关键词召回等于没入。

### B.4 反向场景：先抓整页，后搜到同 URL（验证逻辑推演）

1. 昨天：fetch `exa.com/xxx` → 行1（id=100，snippet/正文列里是整页正文），存活。
2. 今天：搜索引擎又返回 `exa.com/xxx` → INSERT 行2（id=101，只有几百字摘要）→ `invalidateOldRecords` 执行 → **行1（带整页正文的那行）valid_until 被打，正文立刻退出所有召回**。
3. **这就是个坑，而且是现实高频场景**：搜索引擎结果列表里出现已抓过的 URL 再正常不过。每重搜一次，带正文的行就被最新的 snippet-only 行顶掉作废。正文永远活不过下一次同 URL 的搜索。
4. 注意 INSERT 行2 时还会再踩一脚：将来再有人 fetch 同 URL 入行3，行2 也被作废——循环往复，库里同 URL 的行越积越多，每行都是尸体，只有最新一行活着。存储倒是小事，但 consolidate 扫簇时会把这堆尸体全当「活材料」（它们的 `superseded_by` 全是 NULL），同一 URL 的内容被重复计数、重复喂给 summarize——**既浪费模型输入 token，又让单来源材料伪造成多源证据**。（计数部分为推断：扫描无去重是验证，「伪造多源证据影响纠正/新建决策」是顺着 CLUSTER_MIN 逻辑推的。）

**缓解存在吗**：`adjudicateMemory`（`session-store.ts:1354`）那条写路径是「同 entity 才作废、且只在同 session 内查重」（1368 行 SQL 带 `session_id = ?` 条件），但它只被 eval runner 用，生产搜索/抓取的入库路径全是 `saveResults` → 全局 URL 作废。**没有按 source/fetched 区分「这条新行该不该顶掉旧行」的逻辑**（验证：`invalidateOldRecords` 没有任何条件分支）。

### B.5 quarantine 是什么（验证）

列是后来 ALTER 补的：`retrieval_results.quarantine TEXT`（`session-store.ts:690`，注释写明「(Q3=A): equal-weight conflict quarantine — candidates held for user review at next interaction」）。是 TEXT 不是布尔——值即隔离原因。三种值：

1. **`equal_conflict`**：`adjudicateMemory` 写路径里，证据分 <0.6 且非 user 直写的记忆，不直接录用，打 `quarantine='equal_conflict'` 挂起等人工审（`session-store.ts:1402-1416`）。**但 adjudicateMemory 生产环境没有调用方**（只有 eval runner 用），所以这条路径实际是闲置的。
2. **`entity_unresolved`**（常量 `UNRESOLVED_ENTITY_MARK`，`packages/store/src/entity-alias.ts:408`）：#277 跨文字实体判定时，一条材料里的名字无法确定属于哪个对象（比如中英名对不上），就打这个标——宁可不召回，也不挂到错的对象上（`entity-alias.ts:410-420` 注释原话）。配套有评审出口：`resolveUnresolvedEntityMemory(id, "keep"|"drop")`（`session-store.ts:2451-2460`），keep 清除隔离回归召回，drop 打成 `resolved_drop` 永久排除。
3. **`resolved_drop`**：人工评审后的永久排除态（`session-store.ts:3030` 及 2458）。

隔离效果：**所有召回路径 SQL 都滤 `quarantine IS NULL`**（B.2 列出的每一处），consolidate 扫描也滤（`consolidate.ts:1039`）——隔离行即不进召回也不进整理，但行本体保留可评审，不是删除。

### B.6 字段语义总结（一张表）

| 字段 | 谁写它 | 效果 |
|---|---|---|
| `valid_until` | `invalidateOldRecords`（同 URL 新行 INSERT 时）、`adjudicateMemory` 的 temporal supersede、实体合并 | 退出召回；consolidate **仍扫描** |
| `superseded_by` | consolidate 纠正落锤时（`consolidate.ts:988`：被打败的材料的旧知识行号） | 退出召回；consolidate 扫描但**不计入批次门槛**（`consolidate.ts:1150` liveEps 过滤） |
| `quarantine` | adjudicateMemory(equal_conflict)、linkCrossScript(entity_unresolved)、人工评审(resolved_drop) | 退出召回**和** consolidate 扫描 |
| `archived` | scanArchive/applyArchive 的软遗忘（`consolidate.ts:1938`） | 全部排除，可 undo |

两个「作废」机制并存且语义不同：`valid_until` 是写路径的粗暴 URL 顶号（不管内容是不是更新更好），`superseded_by` 是知识层面的精细退休（consolidate 判定纠正后才会打）。**它们互不同步**——被 URL 顶号作废的行不会自动获得 `superseded_by`，所以 consolidate 眼里它们还是活证据。

---

## 对「整页正文存进内部库」方案的直接含义

1. **成本频率不用怕**：consolidate 进知识库是手动触发的，喂整页不会让它跑得更勤；真正每次对话都跑的滚动摘要/l2_recall 不吃 retrieval_results 的全文，吃的是消息列表和 FTS top5 截断 1500 字。但材料变长会**直接放大每次 consolidate 的 summarize 输入**（每簇每条材料从几百字变几千上万字）。
2. **INSERT 新行方案有现成但粗糙的顶号机制**：同 URL 旧行自动作废，方向对；但 (a) 不分青红皂白——snippet 行也能顶掉正文行（B.4 的坑）；(b) 作废旧行在 consolidate 里仍是活材料计数，同 URL 多版本灌水簇门槛。
3. **就地 UPDATE 方案绕开顶号，但踩 FTS 不更新**：retrieval_results 没有 UPDATE 触发器，正文改动对关键词召回 invisible，需要手工维护 FTS 删除+重插。
4. 无论哪条路，都要决定「snippet-only 新行遇到已有正文行时怎么办」——现在的代码对这个问题**没有答案**，`invalidateOldRecords` 一视同仁全杀。
