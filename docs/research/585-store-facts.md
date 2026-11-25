# 调研资料库与长期知识库：存储事实全记录（#585）

为「web_fetch 抓回来的网页正文将来怎么进内部知识库」这个决策取证。
术语对照 `GLOSSARY.md`：调研资料库 = `retrieval_results` 表；长期知识 = `semantic_memories` 表；项目索引 = `ProjectIndexStore`（另一套库，物理分开）。

所有「实测」都是本机用 better-sqlite3 13.0.3 建同构表跑出来的，实验脚本实跑后已删，数字原样抄在下面。

---

## 1. `schema.sql` 精读（`packages/store/src/schema.sql`）

### 1.1 `retrieval_results`（调研资料库）每一列

`schema.sql:87-108`，外加 `session-store.ts` 里靠 `ALTER TABLE` 补进老库的列：

| 列 | 类型 | 干什么 |
|---|---|---|
| `id` | INTEGER 自增主键 | 行号，FTS 外键靠它 |
| `session_id` | TEXT，外键 `sessions(id)`，级联删 | 哪个会话存的 |
| `url` | TEXT NOT NULL | 来源网址；也被当对象键用（`entity` 缺省就是它，`session-store.ts:1340`） |
| `title` | TEXT | 标题 |
| `snippet` | TEXT | 正文摘要。**实际就是搜索引擎给的 500 字以内的片段**，不是整页正文（见第 3 节） |
| `source` | TEXT | 哪家信息源给的（provider id），`schema.sql:93` 注释原文 |
| `rrf_score` | REAL | 写入时永远是 NULL（`session-store.ts:1340` 实参直接写死 `null`） |
| `fetched` | BOOLEAN DEFAULT 0 | **没人写、没人读**（见第 2 节考古） |
| `created_at` | TEXT | 入库时间 |
| `valid_until` | TEXT | 失效时间戳，NULL=还有效。双时态软关闭（`schema.sql:98`） |
| `pinned` | BOOLEAN | 钉住不走时间衰减 |
| `entity` | TEXT | 对象键，默认=URL |
| `archived` | INTEGER | 软归档，1=所有读路径都排除 |
| `source_label` / `trace_id` | TEXT | 来源可不可信的标签 / 关联 id |
| `superseded_by` | INTEGER | 被哪条新行替代了；行不删、但不再出现在「当前事实」召回里（`schema.sql:104-107`） |
| 老库 ALTER 补的 | `last_accessed`、`access_count`、`quarantine`、`evidence` | 见 `session-store.ts:682-713`，新库建表时就在，老库靠 ALTER |

**注意：`quarantine` 和 `evidence` 不在 `schema.sql` 里**，只有运行时的 ALTER 会给它们补上（`session-store.ts:690-692`）。新库是先跑 `schema.sql` 再跑 ALTER 段，所以最终形状两边一致。

### 1.2 `retrieval_results` 的 FTS5 表

`schema.sql:118-124`：

```
CREATE VIRTUAL TABLE retrieval_results_fts USING fts5(
  session_id UNINDEXED, title, snippet,
  content='retrieval_results', content_rowid='id'
);
```

- **tokenizer：默认的 unicode61**。建表语句里没有 `tokenize=` 参数，FTS5 的默认就是 unicode61。全仓没有第二处建 FTS 表的写法（项目索引同样是默认，`project-index-store.ts:67-76`）。
- **进 FTS 的列只有 `title` 和 `snippet`**，`session_id` 标了 UNINDEXED（进表但不建索引，只作过滤）。**url、正文（也不存在正文列）都不在索引里**。
- 用的是 external-content 模式（`content='retrieval_results'`）：FTS 表不重复存原文，只存索引；读的时候 JOIN 回原表。
- 同步靠触发器：**只有 INSERT（`retrieval_ai`，`schema.sql:126-129`）和 DELETE（`retrieval_ad`，`schema.sql:131-134`）两个触发器，没有 UPDATE 触发器**。对照看：`messages_fts` 和 `semantic_memories_fts` 都有三个触发器（INSERT/DELETE/UPDATE，见 `schema.sql:69-84`、`508-521`）。也就是说：`retrieval_results` 如果 UPDATE 了 title/snippet，FTS 索引不会跟着更新。目前读路径 UPDATE 的都是 `valid_until`、`last_accessed` 这类非索引列，所以没出事，但这是有意或无意埋下的坑。
- **BM25 打分**：查询侧用 `bm25(retrieval_results_fts)`，外面再套一个 `freshness_factor` 时间衰减 UDF（`session-store.ts:811`）。

### 1.3 `semantic_memories`（长期知识）表

`schema.sql:479-493`：

| 列 | 干什么 |
|---|---|
| `content` | **知识正文本身**——这是整理出来的结论，整段文字直接存这一列，没有单独的「全文列」之外的拆分 |
| `source_episode_ids` | JSON 数组，记着这条知识是从哪些 `retrieval_results` 行熬出来的 |
| `salience` / `confidence` | 0-1 的显著度/置信度，置信度 0.2 表示「保真门不在或说不清」 |
| `access_count` / `last_accessed` | 被召回的次数/上次时间 |
| `embedding` | BLOB，向量（Float32Array 字节），没嵌入前是 NULL |
| `created_at` / `valid_until` | 双时态，NULL=活着 |
| `superseded_by` | INTEGER，替代关系：UPDATE 操作时旧行软关闭（写 `valid_until`）+ 写上替代它的新行 id。落地代码在 `consolidate.ts:980`：`UPDATE semantic_memories SET valid_until=datetime('now'), superseded_by=? WHERE id=?`；新材料侧同时写 `retrieval_results.superseded_by`（`consolidate.ts:988`）。旧行永远不删，所以替代链双向可查 |

FTS：`semantic_memories_fts` 只索引 `content` 一列（`schema.sql:502-506`），同样 external-content、同样默认 unicode61、三个触发器齐全（INSERT/DELETE/UPDATE，`schema.sql:508-521`）。

---

## 2. `fetched` 列考古：从第一天就在，从来没被用过

证据链：

- `fetched BOOLEAN DEFAULT 0` 出现在 schema.sql 的**第一个版本**里。schema.sql 这个文件诞生于 commit `5b22ddc5`「feat: Step 3 kernel split — 3 packages + 5 seams + ADR-0004」（2026-08-18 18:06，仓库历史上第 5 个 commit，之前只有脚手架）。命令：`git log -S 'fetched' --all`，命中只有两个 commit：`5b22ddc5`（新建）和 `6f9d0d09`「feat(G010): CLI composition root」。
- `5b22ddc5` 的 commit message 说 schema.sql 的设计意图是「FTS5 external content table + triggers + bm25() ranking, WAL mode」，**一个字没提 fetched**。同期 `.scratch/kernel-split-architecture/issues/03-session-store-fts5.md`（已被后来的 commit `5593fe05` 从治理层拆除删掉，此处从 git 历史里捞出）也只写了 FTS5 外部内容表、会话隔离，没提 fetched。
- 全仓现状（`grep -rn '\bfetched\b' packages apps providers --include='*.ts' --include='*.sql'`，排除 test/dist/node_modules）：**没有任何一行代码写或读这一列**。命中的全是注释——`kernel/src/memory-pipeline.ts:69`「the archive row this result was fetched into」（英语「被抓取」的普通用法，不是列名）、`summary-rebuild.ts:696`、`summary-sources.ts:365` 同理。
- 写入 SQL 实锤：`session-store.ts:804` 的 INSERT 列清单里**没有 fetched**，它永远是默认值 0。

结论（推测成分标注）：**`fetched` 是建表第一天就预留的「这条结果的整页正文抓回来没有」标志位**。名字加当时的注释习惯（`source TEXT -- provider id` 这种）都指向这个意图：snippet 是搜索引擎给的片段，将来可能把整页抓回来，`fetched` 就是记这件事的。但整页抓取功能从头到尾没有实现过，这个列就空了 3 个月（2026-08-18 至今）。为什么没人用——因为抓整页正文的路径（web_fetch）在这个仓里根本不存在（见第 3 节末尾），没有写入者，自然没有读取者。这段意图推断有据但无实锤文档，标**推测**；「没人写没人读」是**实证**。

---

## 3. 谁往 `retrieval_results` 写数据

全仓调用点（排除测试）：

| 调用点 | 位置 | 写的 snippet 是什么 | 什么时候触发 |
|---|---|---|---|
| 主写入 SQL | `packages/store/src/session-store.ts:804`（saveResult 预编译语句）→ 执行在 `saveResultsWithIds` `session-store.ts:1331-1347` | 传进来啥写啥 | — |
| MCP `search_web` 工具自动落库 | `apps/mcp/src/tools/search-web.tool.ts:137` | `envelope.results` 的 snippet | **搜索完自动落库**：一次搜索成功返回、且调用方没取消，就建个新 session 写进去（`search-web.tool.ts:130-138`，注释原文「Auto-index into session store (best-effort, fail-open)」）。取消的搜索不写（#209） |
| kernel 内部搜索（ans_chat 里的 agent 循环 + 证据不够再搜一轮） | `packages/kernel/src/pi-runtime.ts:287` 调 `indexSearchResults`（`pi-runtime.ts:187-212`） | 同上 | 每次 agent 内部搜索后。注释明说设计动机（`pi-runtime.ts:176-181`）：#259 之前只有独立 `search_web` 写，ans_chat 内部的搜索对后续轮次和其他会话不可见 |
| 整理/纠错写新材料 | `adjudicateMemory`，`session-store.ts:1354` 起 | 调用方给的 snippet | `consolidate` 流程里写新材料时 |
| eval runner 的种子数据 | `packages/store/src/eval/runner.ts:416` | fixture 里给的 | 评测专用 |

**snippet 的真实内容就是搜索引擎给的 500 字片段**，三处证据：

- Exa：`providers/exa.ts:54` `snippet: ((r as any).text ?? "").slice(0, 500)`，且请求时就只要 500 字符（`exa.ts:45` `contents: { text: { maxCharacters: 500 } }`）；exa-mcp 变体用 `highlights` 拼接，同样截 500（`exa-mcp.ts:162`）。
- Tavily：`providers/tavily.ts:53` `snippet: r.content.slice(0, 500)`。
- anysearch 通道：`providers/anysearch.ts:106` `snippet.slice(0, 500)`。

所以「500 字 highlight」的说法属实：入库的就是供应商给的、且被本地再截一刀的 500 字符片段。**全仓没有任何一条路径往 retrieval_results 写过整页正文**。

**`fetched` 列：零个写入点**（见第 2 节）。

**web_fetch 在仓里的现状**：grep 全仓 `web_fetch|WebFetch|webfetch`（packages+apps，排除 test）——**零命中**。钩子只认 anysearch 自己的工具名（`apps/plugin/src/hooks/core.ts:41`：`/(?:^|_|__)(?:search_web|research_web|recall_memory|query_knowledge|ans_chat)$/`）。也就是说宿主 agent 用 WebFetch 抓回来的网页正文，目前**进不了任何一套库**，既不进调研资料库也不进项目索引。这正是这个决策要解决的问题。

写入时的伴随动作（`session-store.ts:1331-1347`）：带密钥的内容整条跳过（containsSecret 检查）；同 URL 的旧行立刻写 `valid_until` 关闭（invalidateOldRecords）；写 FTS 靠触发器自动。向量嵌入（memory_embeddings）只在 adjudicateMemory 路径做（`session-store.ts:1628-1636`，文本=title+snippet），saveResults 路径不嵌。

---

## 4. FTS5 中文行为：实测

### 4.1 为什么 FTS 对中文不可靠（代码里的原话）

`session-store.ts:1792-1796` 注释原文：

> a LIKE rung for CJK, because `fts5EscapeQuery` strips non-ASCII (a pure Chinese query becomes `""`), and the default unicode61 tokenizer glues a whole Chinese run into one token, so `"客服邮箱"` could never MATCH it. The LIKE rung is the only path that finds a Chinese fact without vectors.

两层问题：(a) 查询侧，`fts5EscapeQuery` 的清洗正则 `/[^A-Za-z0-9]+/g`（`fts5.ts:11`）把所有非 ASCII 字符换成空格——纯中文查询直接变空串；(b) 索引侧，unicode61 把一整段连续中文粘成一个 token。所以中文召回靠 LIKE 全表扫（`session-store.ts:1868` 起的 CJK rung，把中文长串切成重叠小片做 `%片%` 匹配）。

### 4.2 实测：unicode61 到底怎么切中文（实跑）

插入一行：`客服邮箱为 help@example.com，工作时间为北京时间早九点到晚六点。`（建表方式与 schema.sql 完全一致，不指定 tokenizer）。fts5vocab 里实际切出来的 token：

```
len=16  "工作时间为北京时间早九点到晚六点"     ← 16个汉字粘成1个token
len=7   "example"
len=5   "客服邮箱为"                           ← 中文夹英文，中文run自成token
len=4   "help"
len=3   "com"
```

**中文靠 ASCII 标点（半角逗号句号）和英文字符当切分点，两个切分点之间的所有汉字粘成一个超长 token。全角标点（，。）也被当切分点。**

### 4.3 实测：中文 MATCH 查询命中率（实跑）

同一行数据上：

| 查询 | 命中 |
|---|---|
| `MATCH '"客服邮箱"'` | **0 行**（词在原文里，但token是「客服邮箱为」，不等于它） |
| `MATCH '"客服邮箱为helpexamplecom工作时间为北京时间早九点到晚六点"'` | 0 行 |
| `MATCH help` | 1 行 |
| `MATCH example` | 1 行 |
| `MATCH 人工*`（前缀，在token开头） | 1 行 |
| `MATCH 智能*`（在token中段） | 0 行 |
| `MATCH '"人工智能"'`（整词精确） | 0 行 |
| `MATCH '"金融风控场景"'`（5万字整页库里，原文多次出现该词） | **0 行** |

结论实证：**unicode61 下中文 FTS 查询，只有「恰好是一段文字的开头前缀」才能命中，词在句子中间的永远查不到**。等于中文内容进了 FTS 索引也是白进——索引建了，但没有任何正常查询方式能查到。

对照实验：trigram tokenizer（`tokenize='trigram'`）下同样的数据，`MATCH '"智能客服"'` 命中 1 行、`'"人工智能"'` 命中 1 行——trigram 能查中文（但最短查询单位 3 字，`"客服"` 两字查不到）。

### 4.4 体积实测（实跑，数字原样）

实验 2b：100 篇 x 5 万字中文整页 + 10 篇英文整页，external-content FTS5（与 schema 同构）：

```
插入 100 篇 5 万字中文耗时: 1095 ms（含 FTS 索引）
正文字节总量: 13.9 MB（中文 UTF-8 每字 3 字节）
库文件总大小: 14.9 MB
库/正文比: 1.07x
MATCH "智能客服" => 命中 0 行, 1ms
MATCH machine   => 命中 10 行, 2ms
LIKE '%智能客服%' => 命中 100 行, 16ms（全表扫）
```

中文索引膨胀只有 7%，因为整个中文 run 才一个 token——**索引几乎没建什么东西，这正是它查不到的原因的一体两面**。

实验 3a：100 篇 x 5 万字符英文整页（unicode61）：

```
插入耗时: 129 ms
正文字节: 4.8 MB  库文件: 6.3 MB  比例: 1.33x
索引净开销约: 1.6 MB（占正文 33%）
```

实验 2c 对照组：100 篇 x 500 字 snippet（现在的形态）：

```
插入耗时: 22 ms
库文件大小: 288 KB
膨胀倍数对比整页组: 53x（100篇5万字整页 vs 100篇500字snippet）
```

---

## 5. 体积算账

一篇网页正文典型 1 万~10 万字。中文 UTF-8 每字 3 字节，5 万字中文 ≈ 150 KB（实测 100 篇共 13.9 MB，平均每篇 139 KB）。

| 方案 | 100 篇的库文件 | 说明 |
|---|---|---|
| 只存 500 字 snippet（现状） | **288 KB** | 实测 |
| 存 5 万字中文整页进 FTS（unicode61） | **14.9 MB**（53 倍） | 实测；其中索引开销只占正文 7%，但**这索引对中文查询是废的** |
| 存 5 万字英文整页进 FTS（unicode61） | 索引净开销占正文 **33%** | 实测 |

所以单看体积，unicode61 下「中文整页进 FTS」的膨胀比英文小——但这个「小」是假便宜：索引里基本没有可用 token。如果用 trigram（中文唯一靠谱的 FTS 方案），每个汉字位置产生一个三元组 token，索引开销会显著高于 33%（粗估 50-100%，未实测，**推测**）；而且 FTS5 没有增量压缩，正文本身就已经占大头。

---

## 6. 依赖面：改表哪些测试会动

直接 INSERT 或读 `retrieval_results` 形状的测试/fixture：

- **`packages/store/test/fixtures/knowledge-ranking-cases.json`**：注意——它喂的是 `semantic_memories` 表不是 retrieval_results（`eval-knowledge-ranking.ts:24` 直接 INSERT semantic_memories）。它绑的是**知识表 + searchMemory 召回行为**，不动 retrieval_results。但如果正文进 FTS 改变了 searchMemory 的排序/命中，这个评测（nDCG/MRR/Recall@10 三组不退、混合组 nDCG 必须升，`docs/knowledge-ranking.md`）会跟着变。
- **`packages/store/src/eval/runner.ts:416`**：eval 固件的 seed 操作用固定列清单 INSERT retrieval_results（session_id/url/title/snippet/source/rrf_score/entity）。**加一列不影响它**（列名清单是显式的）；但如果新列 NOT NULL 无默认值就会炸。
- 直接 INSERT retrieval_results 的测试（`grep` 计数）：`access-chain-*.test.ts`（4 个文件）、`consolidate-forget.test.ts`、`fk-restore-after-migration.test.ts`、`pre-migration-backup.test.ts`、`summary-sources.test.ts` 等约 8 个文件，另有 30 个测试文件以某种方式提及 retrieval_results。
- `coldstart-race.test.ts:63` 和 `coldstart-locks.test.ts:102`：点名 `retrieval_results_fts` 表必须存在——改 FTS 表结构（比如换 tokenizer、加列）要重建这张虚表，冷启动测试会第一个发现老库不兼容。
- **`migration-backup.ts` / pre-migration backup 机制**：改 schema 会触发迁移前备份流程（`store_meta`/`store_layout` 水位线，`schema.sql:12-25`），这是已有机制，不算破坏。
- `access-chain-fixtures.ts`：fixture 里手写 DDL，外键引用 retrieval_results(id)——表本身在就行。
- `eval-docs-golden.test.ts`、`eval-abstain.test.ts` 等 golden 测试：走 searchMemory 召回行为断言。正文进 FTS 若改变命中集合，这些最容易红。

**加一列**：基本安全（所有 INSERT 都用显式列清单）。**正文进 FTS / 换 tokenizer**：影响面大——老库的 retrieval_results_fts 是 CREATE VIRTUAL TABLE IF NOT EXISTS，已有数据库打开时不会重建索引，新结构只对新库生效，需要迁移路径；且 unicode61 切出来的老 token 和新 tokenizer 不兼容，必须整表重建 FTS（`INSERT INTO fts(fts) VALUES('rebuild')`），中英文混合库的旧行不重建就查不到。

---

## 7. 项目索引（ProjectIndexStore）对比

`apps/plugin/src/store/project-index-store.ts`：

- **物理上是另一个 SQLite 库**，和用户级调研资料库分开（文件头注释 `project-index-store.ts:1-3`：「physically separate from SessionStore」）。用户级一个库，靠 `project_path` 列分项目；默认只读本项目，跨项目要显式给项目列表（`search()` 方法 `project-index-store.ts:136-138`：不给项目直接抛错）。
- 表结构：`project_index` 表（`project-index-store.ts:54-65`）列：project_path / tool_name / query_hash / title / url / snippet / source / content_hash / created_at。**没有正文列，只有 snippet**。
- FTS：`project_index_fts`（`project-index-store.ts:67-76`）索引 title/url/snippet/source 四列（比调研资料库多索引了 url 和 source），同样默认 unicode61、external-content，三个触发器齐全（INSERT/DELETE/UPDATE 都有，`78-93`）。
- **钩子写入时是截断的，不是全文**：`apps/plugin/src/hooks/distill.ts:47` `snippet: (r.snippet || "").slice(0, 500)`——钩子把工具输出里每条的 snippet 再截到 500 字。服务端不再截（`server/index.ts:463` 原样转存）。而且钩子只处理 anysearch 自家工具的输出（`isAnsTool`），别的工具（包括宿主自己的 WebFetch）根本不产生 index entries。
- 触发时机：后置工作（follow-up）——钩子进程把蒸馏结果通过 IPC 发给长驻钩子服务，服务里登记一条 `origin='follow-up'` 任务再写库（`post-work.ts`、`server/index.ts:451-483`）。

**两套库分工现状**（对照 GLOSSARY「两套数据库」）：内部记忆（SessionStore 的库）存调研材料+长期知识，先查它；项目索引存的是「这个项目里跑过的搜索的工具输出」，作为补充，不够再查。两边存的都是 snippet 级片段，**没有任何一边存网页正文**。

---

## 8. 对这个决策意味着什么（大白话总结）

**现在的事实**：整个系统里没有任何地方存网页正文。搜索引擎给的 500 字片段进了调研资料库，整理后熬成知识进 semantic_memories，项目索引也是 500 字截断的片段。web_fetch 抓回来的整页正文目前哪儿都去不了——钩子的工具名过滤器根本不认它。

**fetched 列**是建表第一天就预留的「这页抓过整页没有」的标志，空了三个月没人用。它还在表里，如果将来真做整页抓取，这个列的名字和意图正好对口，可以用起来——但用之前要承认它现在是纯粹的死列，别指望它有任何现成数据。

**关于「正文进 FTS」的硬事实**：
1. 现状的 unicode61 tokenizer 对中文是废的——实测中文词 MATCH 命中率 0%，连续中文被粘成一个超长 token。中文整页进现有 FTS 索引=白花 7% 的索引空间换一个永远查不到的索引。这不是猜测，是实跑出来的。
2. 英文正文进 FTS 是划算的：索引膨胀 33%，插入快（100 篇 x 5 万字符共 129ms），MATCH 毫秒级。
3. 中文要能 FTS 查，得换 trigram tokenizer（实测能查，但最短查询 3 字），代价是索引膨胀预计比 unicode61 英文还高，且要重建所有老库的 FTS 表。或者干脆中文继续走 LIKE 全表扫——实测 15 MB 的库里 LIKE '%智能客服%' 全表扫才 16ms，库不大时这条路完全够用，仓里现在就是这么干的。
4. 体积上，100 篇 5 万字中文整页 15 MB——对一个本地个人知识库来说不算大，真正的问题不是存不下，是查了查不到。

**一句话**：存储层的坑位是现成的（retrieval_results 表加个正文列、或者用回 fetched 标志位都行，INSERT 全是显式列清单不怕加列）；难的是检索层——中文全文检索靠现在的 FTS 配置死路一条，要么接受 LIKE 全表扫（库小够用），要么换 trigram 并重建索引，要么靠向量那条手臂兜底。
