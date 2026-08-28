# ADR-0031 (grill r28): Entity Link Layer — Two-Table Entity Index + RRF Third Arm + FSL-Style Three-Tier Dedup

- Date: 2026-08-28
- Status: Accepted (grill r28, Q1-Q6 全用户确认；atomcode 四轮到主题锁调研，会话 4e347ad7)

## Status
Accepted. Supersedes nothing; complements ADR-0022 (consumer answer mode), ADR-0023 (retrieval deepening), ADR-0027/0028 (eval harness + gates), ADR-0029 (scope discipline), ADR-0030 (freshness factor + bi-temporal write path). This round opens the entity/relational dimension of the memory本体.

## Context

The store layer keeps memories as flat FTS5 rows (`retrieval_results`) with a session-scoped `entity` column that is URL-level only (schema.sql comment: "entity key for bi-temporal invalidation (URL for MVP)"). There is no `entities` table, no cross-session entity aggregation, and no entity-aware retrieval signal — "what do we know about X" and multi-hop queries are structurally unanswerable.

Four atomcode research rounds (11+ web_fetches per round, Mem0/Zep/Graphiti/Neo4j agent-memory/Cognee/Letta/basic-memory/claude-mem/local sqlite 系 cross-checked) converged: the post-2026 industry consensus is that an entity/identity layer is the next mandatory pillar after retrieval + freshness + eval (Mem0 v3 2026-04 elevates entity linking to a first-class third signal, LoCoMo 71.4→92.5; Zep 凭时间 KG 在 DMR/LongMemEval 双基准反超 MemGPT). Single-user local implementations (Mem0 OSS v3, claude-mem, sqlite 系) all stop at "entity collection + boost" — not a traversable graph.

## Decision

### D1 (Q1): Entity Link Layer is the next architecture topic
立项实体链接层（Entity-Centric Memory）。排除候选并记录：语义向量检索（CONTEXT STALE 立场警示 + native 依赖风险，留给向量入场独立轮）；跨会话蒸馏（学术前沿，多跳写时合并实测成功率 35%，且 consolidateState+adjudicateMemory 已覆盖最接近工程形态）；时间线溯源查询（并入本层检索面，不独立成轮）；多作用域命名空间（本地单用户场景弱，与定位不符）。

### D2 (Q2): Rules-first extraction with LLM fallback（双层抽取）
抽取层 = 窄而高精度的规则层（URL/域名、PascalCase/camelCase 标识符、@mention、引号短语、已知实体回查）先行，LLM 结构化抽取仅作补缺（规则零命中或置信不足时触发），复用既有 fire-and-forget 时序 + IR_CUSTOM_INSTRUCTIONS + evidence gate（evidence>=0.6 或 source=user）+ secret guard + budget_ledger 计量，fail-open。规则层命中率遥测进 eval 报告，<0.5 告警（fastCRW 阈值）。context-mode 无实体别名/触发词机制，不可复用（仅 trigram 容错可借鉴）。排除纯 LLM（Zep/Sentra 证 LLM ingest 是主导循环成本；Mem0 OSS v3 自己把实体信号降级为 spaCy 廉价层）与纯规则（开放集实体规则闭不上，GLiNER/生成式 NER 评测双证）。

### D3 (Q2/Q3): Data model — two tables, bi-temporal reused, five mandated fillings
schema 新增两表：`entities(id ULID, canonical_name, entity_type, aliases JSON, created_at, valid_until, meta)`（全局、跨会话）+ `memory_entity(entity_id, retrieval_result_id FK, evidence, source, start_pos, end_pos, created_at)`（桥接会话级证据行，关联唯一约束保幂等——"unique relation edges keep maintenance idempotent"）。现有 `retrieval_results.entity` 列降级为快速键，supersede 查询改走实体表。五个必带补缺：跨会话 bridging、去重幂等、entity_type 类型语义、关联幂等、eval 基线先行。SQL/PGQ 标准立场：property graph = 关系表上的只读图视图，本两表即为合法图底子；Zep 分层同构（retrieval_results 行 = episode 层，entities = semantic 层）。排除：三元组边表（Zep 托管形态，谓词抽取质量是本地最大风险，留后续独立轮）；JSON 列（不可索引 → RRF 实体信号失去存储支撑，跨会话聚合死亡）。

### D4 (Q4): Retrieval — RRF third arm with three mandatory patches
实体匹配作为独立候选臂参与既有 `retriever/rrf.ts`（k=60 纯函数）融合。补丁一 条件激活：规则层无实体命中时 entity 臂不参与融合（VLDB 2026 weakest-link / Gini temporal-arm 先例）。补丁二 臂权重：初始 FTS 1.0 / entity 0.5，不做不对称域间调参（TOIS 2023 证跨域不迁移）。补丁三 臂级陈旧防护：臂内 WHERE valid_until IS NULL AND quarantine IS NULL，臂内排序用纯匹配强度（不二次乘 freshness），pinned 语义仅 FTS 臂内生效。排除后置乘法 boost（乘出 clamp [0.3,1.5] 校准带 + 陈旧实体行系统性抬升，正面攻击 ADR-0030 成果）与前置硬过滤（抽取失败 = 召回全灭）。Mem0 用 boost 不构成反证（其候选池=semantic，我们候选池=FTS5 本身）。

### D5 (Q5): Dedup — three-tier match with FSL three-state gates + five mandated fillings
规范化（lowercase/去标点/类型后缀）→ blocking（trigram 候选生成，FTS5 内建 tokenizer，SQLite 3.34+ 零 native 依赖）→ 三级匹配：精确 → 前缀 → trigram 容错，双阈值三态（合并 / 待审 SAME_AS / 新建，Fellegi-Sunter 1969 最优性定理：固定错误率下最小化待审集）。五个必带补缺：①类型门（合并决策必须 consult entity_type，Neo4j match_same_type_only；Mem0 #5438 单阈值 0.95 无类型门把 Apple 公司/水果、Mercury 行星/元素、Jordan 国家/球员全错并）；②合并留痕可逆——新增 `entity_merge_log(from_id, to_id, canonical_before, canonical_after, method, threshold, created_at)`，被并实体走 valid_until 关闭、memory_entity 重定向留 provenance（Mnemoverse 审计：六系统无一能撤销合并——行业空白，我们领先点）；③阈值源自错误预算：eval 台先定义"同名不同义/变体同义"两类 golden case 后 derive，不抄 0.95；④blocking 度量 PC/PQ 进遥测；⑤aliases 数组（命中 alias 精确直过，跳过模糊层）。排除：严格精确匹配（GraphRAG 是被点名批评的失败先例）；embedding 向量消歧（cosine 无频率权重 Newcombe 1959 + sqlite-vec native 依赖，留向量入场独立轮）。

### D6 (Q6): One ADR, seven ordered implementation steps
一轮落盘全部决策，实施按序分 commit，每步独立 test 闭环，可在任一步安全停止：
1. eval 台加实体中心/跨会话聚合 golden cases（含"同名不同义"/"变体同义"两类）——验收前提基线先行
2. `entities` + `memory_entity` + `entity_merge_log` 三表 schema 迁移（含 entity_type、aliases、valid_until 语义）
3. 规则抽取层（窄而高精度）挂 consolidate 时序
4. LLM 补缺层（复用 IR_CUSTOM_INSTRUCTIONS + evidence gate + secret guard + budget_ledger，fail-open）
5. 三级匹配去重 + entity_merge_log 可逆合并
6. RRF 第三臂（条件激活 + 权重 0.5 + 臂级陈旧防护）
7. 命中率遥测进 eval 报告 + ship-gate 全绿验收

Deferred（明确推迟，不回滚决策）：实体类型受控词汇表、边/谓词表、向量消歧、GLiNER 编码器中间层（若 eval 显示规则层覆盖不足）、时间线查询 API。

## Consequences

- Positive: 实体中心与一跳多跳查询从"结构性答不了"变为"可答"；抽取/去重/检索三个面各自有独立 test 闭环与遥测；可逆合并是行业空白领先点；与 ADR-0023/0027/0030 心智模型完全同构（RRF 并列臂 + eval 先行 + bi-temporal 失效），零新范式。
- Negative: entities 全局表的治理（分裂/误并）成为新运维面，靠 D5 五补缺 + 遥测兜底；LLM 补缺层引入低频但非零的 token 成本（budget_ledger 计量）；trigram 相似度分数需自建映射公式（落地第一实现决策）。
- Follow-ups: 关系边表（B 形态）单独立轮；向量消歧与 GLiNER 中间层待 eval 证据；规则层命中率 <0.5 时回到 fastCRW 建议重新评估双层。

## Implementation Plan

See D6. Each step ships as its own commit with its own test closure; step 1 is a hard prerequisite (no entity code before the eval baseline exists).

## Acceptance

1. golden cases 含实体中心 + 跨会话聚合 + 同名不同义 + 变体同义四类断言，memory-eval 全绿
2. schema 迁移可重入（idempotent）；三表创建 + 既有六表无损
3. 规则层对结构化标识符（URL/@mention/引号短语/标识符）精确命中；LLM 补缺层 fail-open（断网/无 key 时规则层结果保留）
4. 三级匹配单测：精确/前缀/trigram 各档命中与拒绝；类型门拦截同名不同义；entity_merge_log 可撤销
5. RRF 第三臂：无实体命中时臂缺席；有实体命中时召回含跨会话聚合行；臂内 valid_until/quarantine 过滤生效
6. 命中率遥测字段出现在 eval 报告中
7. 全门禁绿：turbo check 6/6、turbo build、store+kernel tests、ship-gate --quick、CLI --help 存活

## Research Sources

1. Mem0 OSS v2→v3 migration（图后端移除 ~4000 行；{collection}_entities；实体=boost 非 recall expander）— https://docs.mem0.ai/migration/oss-v2-to-v3
2. Mem0 Graph Memory docs — https://docs.mem0.ai/platform/features/graph-memory
3. Mem0 issue #5438（单阈值 0.95 无类型门失败案例）— https://github.com/mem0ai/mem0/issues/5438
4. Zep: A Temporal KG Architecture for Agent Memory — https://arxiv.org/html/2501.13956v1
5. Graphiti searching（15 recipes；RRF/MMR/node-distance）— https://help.getzep.com/graphiti/working-with-data/searching
6. Zep engineering blog（ LLM ingest 主导循环成本 / 六 prompt 拆分）— https://blog.getzep.com/llm-rag-knowledge-graphs-faster-and-more-dynamic
7. Neo4j agent-memory entity extraction（LLM as fallback；GLiNER 80-90% 免费）— https://neo4j.com/labs/agent-memory/how-to/entity-extraction/
8. Neo4j entity resolution & deduplication（0.95/0.85/fuzzy + 类型门 + aliases + SAME_AS）— https://neo4j.com/labs/agent-memory/explanation/resolution-deduplication/
9. Mnemoverse audit（六系统无错误率/无撤销；blocking=top-k 窗口）— https://mnemoverse.com/docs/library/agent-memory-deduplication
10. PostgreSQL SQL/PGQ property graphs（数据仍在表里）— https://www.postgresql.org/docs/devel/ddl-property-graphs.html
11. Agent Memory Atlas: Hybrid Retrieval Fusion（融合模式图；条件激活）— https://neoneye.github.io/agent-memory-atlas/patterns/hybrid-retrieval-fusion/
12. Hindsight TEMPR 四臂检索 — https://deepwiki.com/vectorize-io/hindsight/3.4-retrieval-system-(tempr-multi-strategy)
13. Elasticsearch RRF 官方文档 — https://www.elastic.co/docs/reference/elasticsearch/rest-apis/reciprocal-rank-fusion
14. OpenSearch score-ranker（臂权重 weights 数组）— https://docs.opensearch.org/latest/search-plugins/search-pipelines/score-ranker-processor/
15. mnemon ADR-0002（weighted RRF + quoted-entity 3×；FTS 88.9→Hybrid 91.7）— https://raw.githubusercontent.com/nikitacometa/mnemon-memory-mcp/main/docs/adr/0002-hybrid-retrieval-rrf.md
16. Bruch et al. TOIS 2023 融合函数分析（CC 9 数据集胜 RRF；域间不迁移）— https://ar5iv.labs.arxiv.org/html/2210.11934
17. Cormack et al. 2009 RRF 原文 — https://cormack.uwaterloo.ca/cormacksigir09-rrf
18. VLDB 2026 Balancing the Blend（weakest-link）— https://www.vldb.org/pvldb/vol19/p1715-gao.pdf
19. Fellegi-Sunter 谱系（Record linkage）— https://en.wikipedia.org/wiki/Record_linkage
20. Splink（FS 模型 + SQLite/DuckDB 后端）— https://moj-analytical-services.github.io/splink/index.html
21. Papadakis blocking 综述（PC/PQ/RR）— https://helios2.mi.parisdescartes.fr/~themisp/publications/csur20-blockingfiltering.pdf
22. GLiNER（零样本 NER 超 ChatGPT；bi-encoder 130x）— https://arxiv.org/abs/2311.08526
23. fastCRW: LLM Extraction vs Regex Parsing（混合经济学警钟；命中率<0.5 阈值）— https://fastcrw.com/blog/llm-extraction-vs-regex-parsing
24. claude-mem database architecture（92.4k★ 本地系无实体表）— https://docs.claude-mem.ai/architecture/database
25. agentos MEMORY_STORAGE（knowledge_nodes/edges，无 bi-temporal）— https://github.com/framerslab/agentos/blob/8ff7a38e/docs/memory/MEMORY_STORAGE.md
26. bakebake/agent-memory（本地 SQLite entity index + unique edges 幂等）— https://github.com/bakebakebakebake/agent-memory
27. SQLite FTS5 trigram tokenizer — https://www.sqlite.org/fts5.html
28. NVIDIA NeMo Curator 去重三级 — https://docs.nvidia.com/nemo/curator/curate-text/process-data/deduplication
29. Mem0 Memory Retrieval Strategies（三信号并行融合）— https://mem0.ai/blog/memory-retrieval-strategies-for-ai-agents
30. 本地一手：schema.sql / session-store.ts / memory-pipeline.ts / retriever/rrf.ts / time-decay.ts / golden-cases.ts
