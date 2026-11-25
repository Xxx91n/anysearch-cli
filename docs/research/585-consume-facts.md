# 585：材料怎么被消费 —— 事实清单

面向决策：「web_fetch 抓回来的网页正文，将来怎么进内部知识库」。这份文档回答：今天什么都不改，一份正文在这条管线上会被怎样消费、在哪里被截断。

所有事实都标注了代码位置或实测证据。「推测」单独标明。术语对照 GLOSSARY.md，代码名放括号里。

---

## 1. consolidate 怎么选材料、喂什么给模型、写回哪几列

### 1.1 scope：材料 id 还是会话 id

两个都可以，但材料 id 永远赢。规则在 `packages/store/src/consolidate.ts` 的 `resolveConsolidateScope`（约 409–495 行）：

- 传了 `memoryIds` → 按这串材料 id 选，**只读这些行**；就算同时传了 `sessionId`，也只记录在报告里、不参与选择（`sessionIdNotApplied`，consolidate.ts:255–280）。
- 没传 `memoryIds`、传了 `sessionId`/`sessionIds` → 按会话选（`WHERE session_id IN (...)`, consolidate.ts:1047–1052）。
- 两个都不给 → 直接报错「拒绝整理全库」（consolidate.ts:493–495）。不存在「忘了传就整理全部」这种事。
- 选完之后再叠三个过滤：`entity IS NOT NULL`、`quarantine IS NULL`、`archived = 0`（consolidate.ts:1032）。

补充一个容易看漏的：扫描**包含已被替代的行**（`superseded_by` 不空的也读），因为更新链需要历史，但「整簇全是已替代材料」会被跳过不整理（`supersededClusterSkipped`，consolidate.ts:1135–1142）；批量门槛（CLUSTER_MIN=3）只数未替代的「活」材料（consolidate.ts:1154，CLUSTER_MIN 定义在 consolidate.ts:36）。

### 1.2 读到材料后，拿哪一段喂模型

**只喂三样：title、snippet、url。** 没有别的字段——因为表里根本没有正文列。

证据链：

1. `retrieval_results` 表结构（`packages/store/src/schema.sql` 约 105–130 行）：列只有 `url / title / snippet / source / rrf_score / fetched / created_at / valid_until / pinned / entity / archived / source_label / trace_id / superseded_by`。**没有 content/body/text/fulltext 列**。FTS5 索引也只建 `title, snippet` 两个字段（schema.sql 里 `retrieval_results_fts` 定义，约 138 行）。
2. consolidate 的扫描 SQL（consolidate.ts:1046–1050）：`SELECT id, entity, title, snippet, url, ...`，只取这些列。
3. 组证据对象（consolidate.ts:1174–1176）：`evidence = { title, snippet, url }`。
4. 喂给模型的格式（`packages/kernel/src/consolidation.ts:577–578`）：`evidenceLines` 把每条材料渲染成一行 `[N] title - snippet (url)`，拼在 `CONSOLIDATION_SUMMARY_PROMPT` 后面发给模型。

**结论（核心问题的答案）：consolidate 今天能看到的最长材料 = snippet 字段的上限 4000 字符。** 这个上限在哪：

- 搜索入库前统一过 `sanitizeRetrieved`（`packages/retriever/src/content-trust.ts:131`）：`snippet: sanitizeText(input.snippet).slice(0, 4000)`。schema 层同样钉死 `snippet: Type.String({ maxLength: 4000 })`（content-trust.ts:36）。
- 引擎里每条提供商结果进融合前都过这道净化（`packages/kernel/src/engine.ts:555–567`）。
- 注意 4000 是「每条材料」的上限，不是整簇。一簇有 N 条材料，模型最多看到 N × 4000 字符再加 N 条 title/url——但每条本身永远不会超过 4000。
- **实际上限更低**：Exa 适配器请求的就是 `contents.text.maxCharacters: 500`（`packages/retriever/src/providers/exa.ts:45`），免费档的 highlight 拼起来也截到 500 字符（`packages/retriever/src/providers/exa-mcp.ts:162`）。也就是说今天库里大部分材料的 snippet 只有几百字，4000 只是管道的天花板，不是常态。

「如果材料只有 500 字 snippet，模型整理出来的知识上限在哪」——模型只能对这 500 字做摘要，`CONSOLIDATION_SUMMARY_PROMPT`（kernel/consolidation.ts:173–181）明确要求「Only state facts directly supported by the episodes. No speculation.」。所以知识的密度上限就是 snippet 的密度上限：500 字 highlight 里没写的事实，永远不会进入长期知识。**这是亲眼验证的代码事实，不是推测。**

### 1.3 模型输出怎么变成长久知识

写进 `semantic_memories` 表，插入语句在 consolidate.ts:967–969（`writeUpdateRow`）和 consolidate.ts:1377–1380（`insert`）：

```
INSERT INTO semantic_memories (content, source_episode_ids, salience, confidence, embedding)
VALUES (?, ?, ?, ?, ?)
```

各列含义（schema.sql 里 `semantic_memories` 定义，约 437 行）：

- `content`：模型产出的合并摘要文本（UPDATE 路径会二次调用 summarize，把旧知识当一条 `CURRENT KNOWLEDGE` 证据塞进去重新合并，consolidate.ts:1420–1435）。
- `source_episode_ids`：JSON 数组，记下这行知识是哪些 `retrieval_results.id` 喂出来的。
- `salience`：`clusterSalience` = min(1, 0.4 + 0.1 × 活材料数)（consolidate.ts:38–40）。
- `confidence`：fidelity 门禁给的置信度；门禁缺席或拿不准就是 LOW_CONFIDENCE=0.2（consolidate.ts:36、1189–1205）。
- `embedding`：向量（可空，算不出来照样入库，dedup 退化为 jaccard 文本重叠）。

UPDATE（纠正）路径额外动作（`writeUpdateRow`，consolidate.ts:962–1005）：

- 新行写入后，旧行 `valid_until` 打上时间、`superseded_by` 指向新行 —— 软关闭，不删。
- 旧行名下的材料（`retrieval_results` 行）`superseded_by` 指向新知识行 —— 材料还在，但退出「当前事实」召回。
- 同事务里跑 `suspendSummariesForCorrection`：凡「摘要来源」（summary_sources）记录里读过被替换知识/材料的摘要，全部挂起、停止注入。

### 1.4 跨范围更新、单证据纠正、并发冲突的实际行为

**跨范围更新**：去重比较的对象是**全库所有活知识行**，不只是本次 scope 里的（consolidate.ts:1215–1217 注释明说「shared knowledge is correctable by reliable new material」）。撞上别会话的旧结论并替换是**允许的**，但报告里 `updates[].withinScope=false` 并列出 `outsideScopeMaterialIds`（consolidate.ts:305–320、1560–1570）。

**单证据纠正**：`allowSingleEvidence` 是 opt-in。开了之后，一簇只有 1 条活材料也能走纠正，但**只能 update 已有知识、不能 add 新知识**——找不到可纠正的活行就跳过（`singleEvidenceSkipped`，consolidate.ts:1297–1320）。而且必须过两道模型判官：纠正关系检查（verify，`CORRECTION_CHECK_PROMPT`）+ 终稿检查（verifyFinal，`FINAL_CONTENT_CHECK_PROMPT`），没配判官一律拒绝替换。判官说不清的（relation=different/unclear/reliable=false）旧内容原样保留，拒因和材料一起交还调用方（`verifyDetails`，consolidate.ts:1100–1127）。

**并发冲突**（#262/D11，consolidate.ts:1604–1880 的 `resolveCollisions`）：写入时发现目标行已被别的会话换掉，本次的替换**整体扣下**（绝不复用为死版本生成的合并文本），事务提交后统一处理：重读知识链的活头（`liveHeadOf`，summary-sources.ts:319），**最多重判一次**：

- 重判说「纠正已经在新版本里了」→ 不建新版本，本方材料并入现版本来源集（resolution="duplicate"）。
- 重判仍接受纠正 → 对着**最新版本**重新合并一次（re-merge），过同样的终稿检查，再写；写之前目标又动了 → 报未解决冲突，**不做第三次判断**。
- 重判拒绝 → 报未解决冲突，两边材料、当前内容、原因、下一步全交还调用方。「谁先写不算谁对」，冲突双方证据都在报告里。

模型调用一律不放在 `BEGIN IMMEDIATE` 里跑（预算账本走同一个连接会死锁）——这是冲突解决阶段独立于主事务的原因（consolidate.ts:1606 注释）。

---

## 2. 召回链路：四个名字各是什么、走哪些表、RRF/衰减/注入

### 2.1 入口身份

| 名字 | 是什么 |
|---|---|
| `recall_memory` | **对外 MCP 工具**（`apps/mcp/src/tools/recall-memory.tool.ts`），宿主 agent 可以直接调 |
| `query_knowledge` | **对外 MCP 工具**（`apps/mcp/src/tools/query-knowledge.tool.ts`），走 RAG 适配器注册表 |
| `searchMemory` | **内部函数**，`SessionStore` 类的方法（`packages/store/src/session-store.ts:1150`），是上面两个工具共同的底层召回面 |
| `searchMemoryMulti` | **内部函数**，`SessionStore` 的方法（session-store.ts:1270），多查询变体版。只在 MemoryPipeline 的 L2 冷路径用（`packages/kernel/src/memory-pipeline.ts:1708–1710`），**没有对外 MCP 入口** |

### 2.2 召回哪些表

`searchMemory`（session-store.ts:1150–1268）一次召回最多五条「臂」（arm），全部 RRF 合并：

| 臂 | 查的表 | 权重 |
|---|---|---|
| fts | `retrieval_results`（经 `retrieval_results_fts`，BM25） | 1.0 |
| entity | `entities` + `memory_entity` → 回到 `retrieval_results` | 0.5 |
| vector | `memory_embeddings`（JS 全扫 cosine） → `retrieval_results` | 0.5 |
| relation | `edges`（对象关系边一跳） → `retrieval_results` | 0.5 |
| semantic | **`semantic_memories`**（关键词 FTS + 向量两条道合并） | 0.5 |

证据：臂列表和权重在 session-store.ts:1203–1212；权重表在 `packages/retriever/src/fusion-registry.ts:34`（`memory: { fts: 1.0, entity: 0.5, vector: 0.5, relation: 0.5, semantic: 0.5 }`）。缺席的臂不占列表（「conditional activation」）。

**编码细节**：知识行的 rowid 用负数表示（`rowid: -r.id`，session-store.ts:1759），材料的 rowid 是正数——这样两个表的 id 空间不撞车，下游靠正负号区分「材料」还是「知识」。

`query_knowledge` 的底层：RAG 适配器 `fts`（`packages/kernel/src/rag-adapter.ts:143`），就是包了一层 `store.searchMemory`。也就是说它读的表和 recall_memory 完全一样，差别只在输出格式和过滤。注意：domain 没配 `rag.adapter = "fts"` 时，query_knowledge 直接返回「无可查询知识适配器」（query-knowledge.tool.ts:57–64）。

### 2.3 RRF 怎么合并

纯函数在 `packages/retriever/src/rrf.ts:16–30`：每个文档在每条臂里的名次换成 `weight / (k + rank + 1)`，跨臂累加，按总分排序。k=60（`fusion-registry.ts:24`）。同一臂内去重防双计。这是教科书 RRF，没什么花哨的。

### 2.4 时间衰减怎么算

两层：

1. **SQL 内的 UDF** `freshness_factor`（`packages/store/src/time-decay.ts:108–128`）：注册成 SQLite 函数，FTS 臂的 rank 就是 `freshness_factor(bm25, created_at, last_accessed, access_count, title, url, query, pinned)`（session-store.ts:811 的 `searchAllResults` SQL）。
2. **因子构成**（time-decay.ts:79–104）：
   - 年龄衰减：`exp(-ageDays / tau)`，tau 按内容分级——news 7 天、docs 30 天、evergreen 90 天（`TAU_TIER`，time-decay.ts:8–12；分级靠 URL/标题关键词，`classifyTier`），地板 0.3。
   - 访问近因加成：最多 +0.35，半衰期 7 天。
   - 访问频率加成：每次访问 +0.03，封顶 +0.15。
   - 总分带 [0.3, 1.5]；`pinned=1` 恒为 1.0；查询是 evergreen 型（「什么是/定义/how does」）时跳过年龄衰减但保留访问加成。

注意：衰减只是**排序偏置，不是过滤**——旧材料不会被衰减删掉。真正的「失效」靠写路径的 `valid_until` 软关闭和 consolidate 的 `superseded_by`（time-decay.ts:130 的注释明说这个设计）。

### 2.5 注入对话上下文时长什么样、每条占多少字

这里要分清**两条完全不同的路**——这是本文最容易搞混的地方：

**路 A：MCP 工具对外返回（recall_memory）**。结果 JSON 里 `internal[].content` **每条截到 200 字符**（recall-memory.tool.ts:83：`content: h.content.slice(0, 200)`），项目索引侧的 `snippet` 同样 200 字符（recall-memory.tool.ts:95）。也就是说宿主 agent 通过 recall_memory 拿到的**不是完整材料**，每条只有 200 字。知识行（负 rowid）也一样走这个截断。

**路 B：ans_chat 对话内的记忆注入（MemoryPipeline.inject）**。每轮在最新用户消息尾部追加几块文本，各有独立字数预算（`packages/kernel/src/memory-pipeline.ts:1056` 注释里点名这四个数）：

| 块 | 标签 | 预算 |
|---|---|---|
| RAG Context（fts 适配器召回） | `[RAG Context]` | 整块 4000 字符（`RAG_BLOCK_MAX_CHARS`，rag-adapter.ts:58），**每条命中截 600 字符**（`RAG_HIT_MAX_CHARS`，rag-adapter.ts:64），默认最多 5 条 |
| Recovery Digest | `[Recovery Digest]` | 600 字符 |
| Session Memory（L1 滚动摘要） | `[Session Memory]` | 4000 字符（`SUMMARY_INJECT_MAX_CHARS`，summary-rebuild.ts:88） |
| Research Recall（L2 召回块） | `[Research Recall]` | **1500 字符**（`RECALL_INJECT_MAX_CHARS`，summary-rebuild.ts:91） |

渲染函数 `renderSummaryBlock`（summary-rebuild.ts:116–126）是唯一知道块形状的地方。L2 召回块的素材在写入 anchor 时就按同一个 1500 预算装：第一条命中必入（超长也截进来），后续命中要么整条进来要么不进，进来的才记入 `sources`（memory-pipeline.ts:1727–1762）——这是「摘要来源」诚实的代价。

---

## 3. 内容信任边界：净化、4000 上限、5 万字正文的逐步推演

### 3.1 净化做了什么

`sanitizeText`（content-trust.ts:97–108）是一个不动点循环：NFC 规范化 → 删零宽字符族（U+200B–U+200F、U+202A–U+202E 等）→ 删 Unicode tag 字符（U+E0000–E007F）→ 删双向覆盖符，循环到不再变化。它**只做结构清洗，不做语义注入检测**——「像指令的散文」原样放行，schema 合法才是闸门（content-trust.ts:117 注释原话）。

`sanitizeRetrieved`（content-trust.ts:120–140）在上面基础上按字段截断：url 2048、title 500、**snippet 4000**、entity 2048。超长或含不可见字符会标记 `suspicious`，但不拒绝。

此外还有两个「默认拒绝」类闸门：写库前 `containsSecret` 检查（session-store.ts:1337），读出时再过一遍（session-store.ts:1246）；`assertJudgmentInput` 守 LLM 判断输入（fail-closed，GLOSSARY 的「默认拒绝」条）。

### 3.2 4000 是每条还是总共

**两个 4000 都存在，别混**：

- **每条材料 snippet 上限 4000 字符**（content-trust.ts:131）——这是入库前的截断。
- **L1 摘要注入块上限 4000 / RAG 注入块上限 4000**——这是注入侧的预算，和材料本身无关。
- 另一个相关截断：compression 的 gap 蒸馏把**所有新搜索结果拼起来再截 4000**（memory-pipeline.ts:455：`results.map(r => r.snippet).join("\n\n").slice(0, 4000)`）——也就是说**一次压缩喂给摘要模型的「新材料总量」封顶 4000 字符**。

### 3.3 一篇 5 万字正文按今天的管线会怎样（逐步推演）

前提：系统自己**没有任何抓正文的能力**（docs/limitations.md:401 明说「ans cannot read a page」是事实，Exa 的 `web_fetch_exa` 故意没接线）。所以推演两种来源：

**情形 A：正文作为某条结果的 snippet 进库**（假设某种渠道把它塞进了搜索结果）：
1. 引擎融合前过 `sanitizeRetrieved` → snippet 截到 **4000 字符**，剩下 46000 字当场丢弃（engine.ts:555–567 → content-trust.ts:131）。丢弃是静默的，只在 `trustSuspicious` 里留个标记。
2. 入库 `retrieval_results.snippet`，最长 4000。
3. consolidate 整理：模型看到的就是这 4000 字 + title + url。
4. 产出知识行进 `semantic_memories.content`，长度由模型摘要决定（提示词要求「one short, factual paragraph」），通常几百字。
5. 召回时：宿主经 recall_memory 每条只看到 200 字符；ans_chat 内经注入块每条最多 600 字符（RAG）或挤进 1500 总预算（L2 召回块）。

**情形 B：宿主 agent 自己抓了正文，粘贴进 ans_chat 的 message**：
1. `message` 字段 schema 只有 `minLength: 1`，**没有上限**（tool-schemas.ts:107–110，AnsChatInput）。所以 5 万字可以原样发进去。
2. 正文进入 PI 的会话记录、参与当轮对话——模型确实能读到（受模型上下文窗口限制；窗口快满时触发 L0 压缩，见第 4 节）。
3. **但正文不会因此进入长期库**：写 `retrieval_results` 的唯一路径是搜索结果（`saveResults`，search-web.tool.ts:137）。聊天内容写进的是 PI 会话记录和 `messages` 表，不是调研资料库。
4. 对话里如果发生压缩，摘要模型看的「新材料」是搜索工具的输出，不是用户粘贴的正文（gap 蒸馏只认 toolName 含 "search" 的工具结果，memory-pipeline.ts:417）。
5. 结论：粘贴正文 = **当轮有效、事后无痕**（除了会话记录本身）。limitations.md 说的「fetch it yourself and hand the body to ans_chat」这条路**作为一次性问答走得通，作为知识入库走不通**——这是代码事实，不是推测。

---

## 4. 三层记忆（L0/L1/L2）各存什么、谁写谁读、summary_sources 怎么引用

依据：memory-pipeline.ts 头注释（「L0/L1/L2 memory pipeline logic」）、GLOSSARY 的「三层记忆」条、docs/mcp-server.md:448。

### L0：会话内临时记忆（上下文压缩）

- **存什么**：PI 库自己管的压缩上下文——上下文快满时把较早对话压成摘要，原始记录留在 PI 会话文件（GLOSSARY「上下文压缩」条）。
- **水位**：`consolidateState` 纯函数决定是否压缩，低水位默认 128000 token 或按真实窗口的 fraction（memory-pipeline.ts:534–560；`FALLBACK_LOW_WATERMARK_TOKENS`）。压缩预留 `COMPACTION_RESERVE_TOKENS = 16384`（memory-pipeline.ts:33）。
- **谁写谁读**：PI SDK 内部（`pi-runtime`/`memory-pipeline` 触发），外部不直接可见。

### L1：对话中的记忆注入（滚动摘要）

- **存什么**：`resume_anchors` 表里 `anchor_type='rolling_summary'` 的行，payload 是 `{summary, ...}`。五段式结构（已验证证据/开放假设/弃用来源/关键数字/工具调用状态），由后台摘要模型滚动生成（「reuse vs compress」由 `adjudicateReuseCompress` 判定，memory-pipeline.ts:466+）。
- **谁写**：MemoryPipeline.consolidate 的后台任务（fire-and-forget，90 秒超时），写入是 `saveAnchor` 追加。
- **谁读**：MemoryPipeline.inject，渲染成 `[Session Memory]` 块贴到最新用户消息尾，上限 4000 字符。
- **摘要来源**：写入时通过 `readSummarySourcesForWrite`（memory-pipeline.ts:152–224）记录依赖。

### L2：本地长期库（FTS 冷召回）

两层含义：

1. **库本身**：`retrieval_results`（材料）+ `semantic_memories`（知识）+ 实体/边/向量等侧表，就是前面召回链路的全部内容。写：**只有 `search_web` 自动入库**（research_web 不入库）+ `consolidate` 整理。读：`recall_memory`/`query_knowledge`/注入。
2. **L2 召回 anchor**：`resume_anchors` 里 `anchor_type='l2_recall'` 的行，payload 是 `{query, variants, hits, sources}`。写：MemoryPipeline.consolidate 的冷路径——找最近一次搜索调用的 query，经 `rewriteQuery` 出多变体，跑 `searchMemoryMulti(variants, 5)`，把命中按 1500 预算拼装（memory-pipeline.ts:1686–1768）。读：inject 渲染成 `[Research Recall]` 块，1500 上限。

### summary_sources 怎么引用 retrieval_results 的行 id

这是「正文进库后摘要血缘怎么记」的现行机制，直接决定新方案要不要改它：

- 表结构（schema.sql `summary_sources`）：`(session_id, anchor_type, anchor_id, source_kind, source_id)`。`source_kind` 二选一：**`'material'` → 直接引用 `retrieval_results.id`；`'knowledge'` → 引用 `semantic_memories.id`**。`anchor_id` 指向 `resume_anchors` 的行，所以**老版本摘要各自保留自己的依赖列表**，新摘要不会覆盖旧的血缘。
- 正向（写入时怎么知道读了哪些行）：两条桥——
  - **按行 id**：搜索结果带着 `archiveRowId`（搜索路径在 pi-runtime 里 `stampArchiveRowIds` 打上的），经 `resolveSummarySourcesFromReads` 精确记到行（memory-pipeline.ts:158–204）。注释明说为什么 id 优先：「一个 URL 可以既有一行退休的老行又有一行活的新行，只有 id 说得出摘要读的是哪个版本」。
  - **按 URL 兜底**：`resolveSummarySourcesFromUrls`（老路径，url 在 retrieval_results 上有索引，schema.sql 里 `idx_retrieval_results_url`）。
  - **recall_memory 的命中**：工具输出里的 `rowid`（正=材料、负=知识）由 `collectRecallSourceRefs` 从对话记录里收回来（memory-pipeline.ts:225–248）——因为摘要模型看得到 recall_memory 的结果，不记这条血缘的话纠正那行材料时永远挂不起这条摘要。
  - 继承：新摘要还会继承上一版摘要的 sources（`summarySourcesForAnchor`）。
- 反向（纠正时怎么找到受害摘要）：`suspendSummariesForCorrection` 按 `(source_kind, source_id)` 反查（`idx_summary_sources_lookup` 索引，schema.sql），在替换知识的同一个事务里把摘要挂起（summary-sources.ts:261+）。挂起只是停止注入，原文永不删改（GLOSSARY「摘要暂停」条）。

**对正文进库的含义**：这套血缘**只记行 id，不管行里有多少字**。如果正文将来进库（不管是 snippet 变长还是新开列/表），只要它还是一个 `retrieval_results.id` 能指到的行，血缘机制原样适用；如果正文单独放一张新表，就得决定它算不算 `source_kind='material'` 的一种——这是设计决策点，不是现有代码能回答的。

---

## 5. 外部宿主面：MCP 暴露什么、谁能读到什么

### 5.1 暴露的工具

MCP server 一共 5 个工具（`apps/mcp/src/tools/index.ts:22–28`）：`search_web`、`research_web`、`recall_memory`、`query_knowledge`、`ans_chat`。**全部可被外部宿主 agent 调用**，没有内外之分。docs/mcp-server.md 也明说：「handle 不是安全边界，store 就是隔离单位——能连上 server 的客户端就能读整个调研资料库」。

- `recall_memory`：能调。返回库内容，但**每条内容截 200 字符**（见 2.5）。
- `query_knowledge`：能调，但只在 domain 配了 `rag.adapter="fts"` 时才真查；返回的是 RAG 块格式（每条命中 600 字符、整块 4000 上限）。
- `ans_chat`：能调，operation 分 chat / consolidate（`memoryIds`/`sessionId` 决定整理范围，见第 1 节）。

**关键事实**：如果正文进了长期知识库，外部宿主 agent 能不能通过 recall_memory 间接读到正文内容？——**今天读不到正文，连正文存在都不可能**（库里没有正文列）；就算正文以某种方式进了 snippet（4000 上限），recall_memory 输出每条也只给 200 字符。能读到的最多是 consolidate 整理后的知识行 content 的前 200 字符。所以「正文进库 = 外部可经 recall 读到正文」这个担心/期望，**按今天的输出截断设计不成立**——除非同时改 recall_memory 的 200 字符截断。这点是代码事实。

### 5.2 ans_chat 粘贴正文验证

limitations.md:401 的说法：「need a page's full text, fetch it yourself and hand the body to ans_chat」。验证结果：

- **输入侧没有字数上限**：`AnsChatInput.message` 只有 `minLength: 1`（tool-schemas.ts:107–110），AJV 不拦长文。handler 侧也没有对 message 长度的额外截断（ans-chat.tool.ts 里 message 原样进 agent loop；唯一的长度截断在别处：L2 query 取搜索入参、RAG query 截 400 字符——都不碰用户消息本身）。
- **真正的上限是模型上下文窗口**：`ANS_LLM_CONTEXT_WINDOW` 或模型 catalog 窗口。窗口快满时 L0 压缩会把较早内容（包括粘贴的正文）压成摘要——**压缩后正文细节就只剩摘要了**。
- **所以这条路今天「走得通」但只走一半**：模型当轮能读全文（窗口够大的话），但正文**不会进任何长期存储**——`retrieval_results` 唯一的写入者是搜索结果（`saveResults`），粘贴进聊天的文本没有任何路径进库。想让这 5 万字变成以后能召回的知识，今天没有任何机制。
- 字数上限的诚实的回答：**schema 层无上限；实际上限 = 模型上下文窗口 − 系统提示和其他注入**；超过即被 L0 压缩消化掉细节。

---

## 6. 完整走查：内部 agent 用 fetch 抓了一篇 3 万字正文，今天能走的路

前提设定：某个宿主 agent（Claude Code 之类）用自己的 web_fetch 能力抓了 3 万字正文，想让 anysearch 系统消费它。逐路推演：

### 路 1：粘贴进 `ans_chat` 当上下文

- 进得了：message 无上限 ✔
- 模型当轮读得到（窗口内）✔
- **断点**：对话结束后正文只留在 PI 会话记录里；不进 `retrieval_results`、不进 `semantic_memories`、不参与任何将来的召回。窗口满了还会被压缩成摘要，细节丢失。
- 结局：**一次性消费，零沉淀**。

### 路 2：指望它变成搜索结果进库

- 根本走不通：入库只有两个口子，内容都必须来自搜索引擎的结果包，不接受外部喂料：一是 MCP `search_web` 的自动索引（search-web.tool.ts:137）；二是 `ans_chat` 循环内部发起的搜索，经 `indexSearchResults` 统一写入（pi-runtime.ts:186–203，#259 之后 ans_chat 内搜索也进共享档案）。`research_web` 通篇没有 saveResults——研究模式的结果不进库，实测确认。store 里确实有一条带裁决的写路径 `adjudicateMemory`（session-store.ts:1354 起，能写 `retrieval_results`、支持 `source: "user"` 直写），但它的调用点**只有 eval runner**（eval/runner.ts:338）——没有任何 MCP 工具、CLI 命令或宿主钩子调它。能力存在，门面不存在。

### 路 3：正文塞进 `recall_memory`/`query_knowledge` 的查询串

- 无意义：这俩是查询入口不是写入入口。查询本身超过 400 字符的部分在 RAG 路还会被截掉（`RAG_QUERY_MAX_CHARS`，rag-adapter.ts:61）。

### 路 4：正文经 consolidate 变知识

- 走不通：consolidate 只读 `retrieval_results` 里已有的行（scope 只能选库内材料 id 或会话 id），正文不在库里就永远进不了它的视野。这是个死循环：进库要靠搜索，搜索结果又不是正文。

### 路 5：宿主 agent 把正文「转述」成搜索查询，靠 search_web 找回同一篇

- 这是今天唯一**间接**能沉淀的路：search_web 走 Exa/Tavily 搜索，结果自动入库。
- **断点**：入库的是搜索引擎给的 highlight——Exa 侧请求的就是 maxCharacters 500（exa.ts:45），免费档 highlight 拼装后也截 500（exa-mcp.ts:162）。即使拿到全文页，入库 snippet 也就几百字；就算某家给了长文本，sanitizeRetrieved 还会再截到 4000。
- 之后 consolidate 整理出的知识上限 = 这几百字的信息量。
- 召回时宿主再经 recall_memory 看，每条又只剩 200 字符。
- 结局：3 万字 → 500~4000 字入库 → 几百字知识 → 200 字符/条的对外窗口。**每一步都有名有姓的截断**。

### 汇总表

| 步骤 | 截断点 | 数值 | 证据 |
|---|---|---|---|
| 搜索引擎取材 | Exa text maxCharacters / highlight 截断 | 500 字符/条 | exa.ts:45, exa-mcp.ts:162 |
| 入库前净化 | sanitizeRetrieved snippet | 4000 字符/条 | content-trust.ts:131 |
| 压缩喂模型 | gap 蒸馏总量 | 4000 字符/次 | memory-pipeline.ts:455 |
| consolidate 喂模型 | 每条材料 snippet | ≤4000 字符/条（实际多为 ~500） | consolidate.ts:1174, kernel/consolidation.ts:577 |
| 知识产出 | 模型摘要「one short paragraph」 | 无硬上限，实践几百字 | kernel/consolidation.ts:174 |
| recall_memory 输出 | content / snippet 截断 | **200 字符/条** | recall-memory.tool.ts:83,95 |
| RAG 注入块 | 每条命中 / 整块 | 600 / 4000 字符 | rag-adapter.ts:58,64 |
| L1 摘要注入 | `[Session Memory]` 块 | 4000 字符 | summary-rebuild.ts:88 |
| L2 召回注入 | `[Research Recall]` 块 | 1500 字符（总量） | summary-rebuild.ts:91 |

---

## 对这个决策意味着什么（大白话总结）

今天这条管子从头到尾都是按「搜索结果摘要」设计的，**没有一寸是给正文准备的**：

1. **库里根本没有放正文的地方**。`retrieval_results` 只有 url/title/snippet 三样文本字段，snippet 封顶 4000，实际进来的多是 Exa 给的 500 字 highlight。正文进库第一件事是 schema 决策：加列还是开新表。
2. **consolidate 的知识上限就是 snippet 上限**。模型只能对入库的那几百到四千字做摘要，提示词还明确禁止超出材料的发挥。正文不进库，整理出来的知识永远只有「摘要的摘要」。就算正文进了库，现在的证据渲染格式（`[N] title - snippet (url)`）也只读 snippet 字段——消费侧要改的不只是存储。
3. **对外窗口比库里更窄**。recall_memory 每条只吐 200 字符，RAG 注入每条 600、L2 召回块总共 1500。就算 4000 字正文原样进了库，外部宿主 agent 通过现有工具也只会看到碎片。要不要让宿主读到更多、以什么形式读，是个独立的产品决策。
4. **「粘贴正文给 ans_chat」这条路今天是一次性的**：当轮能读，事后无痕。limitations.md 把它写成了 workaround，但它解决不了「沉淀」。
5. **血缘机制（summary_sources）是现成的、按行 id 记的**，不看内容长短。正文进库后只要还能用行 id 指到，摘要血缘、纠正挂起这套东西原样能用——这是整条链上唯一不需要为正文改设计的部分。
6. 别忽略两个隐藏闸门：压缩蒸馏一次总共只吃 4000 字新材料；知识写入前有成对的模型判官（纠正关系 + 终稿检查），判官 absent/拒绝时知识行照样写但置信度 0.2、纠正一律不落——正文再长也绕不过这道质量门。

一句话：**今天的管线是「highlight 进、知识碎片出」；让正文进库不是加一个抓取工具的事，是要同时动 schema、consolidate 的取证面、召回输出的截断策略三处，而血缘和纠正机制可以原样继承。**
