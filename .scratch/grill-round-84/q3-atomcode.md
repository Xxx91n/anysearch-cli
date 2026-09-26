# atomcode 调研存档 — R84-Q3 垂域金标语料构建法（2026-09-26）

> 原问题存档：q3-prompt.txt。本件为 atomcode stdout 忠实重组（ctx 索引节拼合）。裁决建议：A，含两处修正。

## Sufficiency Gate

searches: 7（web_search×2 + tavily×3 + anysearch×2）| angles: Official/Comparative/Criticism/Currency/Community 全五类 | full reads: 6（arxiv 2604.20763、arxiv 2506.13023、langfuse、samuelochoa、qaskills、tianpan）| gaps: 垂直搜索域词表场景的专属实践（非通用 RAG）无直接先例，系类比迁移；对照查询的量化占比无权威定值。

## 1) 执行摘要（Tl;dr）

**推荐 A（分层子集+构建式语料），Confidence 高。** 全 17 域薄铺（B）违背「覆盖失败模式而非凑平铺」的共识——3 条/域既无统计意义也无失败模式覆盖力；单域深挖（C）把评测面塌缩到参数最丰富的 finance，恰好测不出「出枚举静默回退 general」这类跨域契约行为；纯等待 dogfood（D）与工业共识正面冲突——「真实查询是金，合成是 bootstrap 而非最终答案」，但 2026 年多信源一致认为**冷启动阶段构建式语料+后续采集替换**是标准路径。A 的三判据选域、三类查询分层、混合来源设计均与成熟心智模型同构。

两处建议修正：(1) 对照查询应升级为**一等断言类**（含跨域特异性条目，这正是 AnySearch 上游「出枚举静默回退 general」已知容错行为的直接测试面）；(2) A 中「真 dogfood 有则采」应写成**采集通道常驻**而非一次性——语料成熟后以 incident-derived/采集条目为主干、构建条目退为 bootstrap 层，比例随时间翻转。

## 2) 分点结论

### 2.1 覆盖域选择：分层选域是共识，三判据高度同构（Confidence 高）

- Scale AI 2026 论文（arxiv 2604.20763）把检索评测形式化为统计估计问题：启发式拼凑的 query 集有系统性覆盖缺口，且**覆盖最薄的语义区域恰是检索表现最差的地方**，聚合指标因此系统性高估——按结构分层（stratified estimation）构建而非全域均摊。
- 三判据各自有对应物：参数丰富度≈API 测试界「parameter coverage 是契约覆盖核心维度」（totalshiftleft.ai：path/query/body 参数×valid/missing/invalid/boundary 最低分维度）；差似然≈Langfuse/QASkills「每类曾引发 incident 的输入必须在集内」；用户画像≈persona-based testing 与 tianpan「wild eval 应保留真实用户语域」。建议给「差似然」加代理判据：**上游语义已知风险点**（出枚举静默回退、sub_domain/params 拒绝压力）——已实测出的行为是最廉价的差似然证据。
- B（17 域薄铺）双重失败：3 条/域低于任何最小有效样本下限（共识单切片 20-50 起），对照查询在 3 条总盘里放不下。C（finance 单域）覆盖塌缩：薄覆盖区=失败高发区，跳过的 16 域恰成盲区。

### 2.2 对照查询（control/contrast）：一等公民，形制「expected=空/拒绝/不命中」（Confidence 高，双引擎交叉）

- Samuel Ochoa RAG 评测指南（全文已读）：negative examples 四类——out-of-scope 查询、语料无答案查询、越权查询、正确答案是「不知道」的查询，期望行为=**空结果或拒绝而非幻觉**。垂域翻译：垂域 A 的查询期望命中垂域 A 结构；相邻域 B 的易混淆查询期望不落入 A 的误召回或回退。
- Drel 边界测试框架（tavily 摘要已核验）：三类边界查询——按名直取越界内容、语义越界查询、重构查询——期望一律「不返回越界内容」。
- 落点含义：对照条目应有独立断言键（如 expected.vertical=null 或 mustNotHit/degraded=general-fallback 断言），否则与垂域条目共用断言通道时特异性失败会被 verticalHit 的通过所掩盖。仓内契约层断言键设计天然容纳。

### 2.3 构建式 vs 采集式混合：silver→gold 晋级+provenance 标注是成熟惯例（Confidence 高）

- Google《A Practical Guide for Evaluating LLMs》（arxiv 2506.13023，全文已读）：三条语料获取路径并存——benchmark 分析、human-annotated golden、synthetic silver——「silver 合成草稿+人工评审晋级 gold」是 Google 级实践。Maxim 指南同构，治理字段建议携带 reviewer/audit trail/provenance。
- Langfuse golden dataset 指南（全文已读）：**真实 trace 优先、CSV/合成第二；合成条目必须经与真实条目同等严格的评审，否则稀释 golden 信任基础**；production failure 持续转为条目（“items arriving this way are candidates, not yet golden”）；数据集是 append-mostly log 带时间戳元数据——与仓内 provenance{type,ref,harvestedAt}+incident-derived append-mostly 惯例逐字对应。
- tianpan.co 批评文（全文已读）：同族生成→同族偏差有论文级证据（SILENCER、self-bias benchmark），缓解法=**跨家族生成**。操作含义：建集辅助用与被测/上游不同的模型家族，且 LLM judge 只进辅助与报告。
- DeepEval 三级来源优先序（curated→production→synthetic）与 samuelochoa fast-start recipe（合成 bootstrap→真实替换）共同支撑三源设计：**dogfood 首窗稀薄不是拒绝构建式的理由，恰是其适用场景**；采集通道保留为常驻观测项，语料随真实流量成熟而翻转主干。

### 2.4 最小有效样本量：总量 ≥50 落在共识带，分配按失败模式覆盖非均摊（Confidence 中高）

- 多源共识带（cameronrwolfe/galtea/samuelochoa/qaskills/langfuse 交叉）：~50 条捕捉明显回归；100-200 检测有意义改进；250+ 才支撑 ±5% 置信区间级统计断言。**≥50 条做确定性门禁落在「足够」区间**。
- 两个共识细节：(1) **per-stratum 报告**是核心价值——聚合分不动而某切片塌掉是常态，每域 12-17 条应再按三类查询分层内部核算，某类对照条目全灭应可见；(2) QASkills sizing 表建议首版 40-60 core+15-25 edge——若 ≥50 中对照类只占零头，应上调总盘到 ~60-70 保证对照类有独立可判读条目数（建议 ≥12-15）。域间分配不必均摊：三判据得分高的域多配。

## 3) 对比矩阵（四方案）

| 项 | 覆盖力 | 统计有效性 | 冷启动可行性 | 长期演化 | 裁决 |
|---|---|---|---|---|---|
| A 分层子集+构建式 | 3-4 域三判据优选，失败模式覆盖充分 | 每域 12-17 条达「抓回归」级，per-stratum 可读 | 高（撰写+LLM 辅助即产） | dogfood 采集通道常驻，主干可随流量翻转 | ✅ 推荐 |
| B 全 17 域薄铺 | 广而浅，3 条/域放不下对照查询 | 低于最小样本共识带 | 中 | 薄铺难维护、难分层报告 | ❌ |
| C finance 深挖 | 单域充分，16 域盲区（含静默回退行为不可测） | 单域强但外推无效 | 高 | 覆盖塌缩难补 | ❌ |
| D 纯等 dogfood | 真分布但遥遥无期 | — | 不可行（垂域落地<48h） | 理想终点而非起点 | ❌（并入 A 作常驻通道） |

## 4) 来源清单

| # | 标题 | URL | 角度 | 日期 | 贡献 |
|---|---|---|---|---|---|
| 1 | Coverage, Not Averages: Semantic Stratification for Trustworthy Retrieval Evaluation (Scale AI) | arxiv.org/html/2604.20763 | Official/学术 | 2026-04-22 | 分层评测形式化：薄覆盖区=失败高发区，聚合指标高估 |
| 2 | A Practical Guide for Evaluating LLMs and LLM-Reliant Systems (Google) | arxiv.org/html/2506.13023v1 | Official/学术 | 2025-06-16 | 5D 原则；golden/silver 双轨；n≈246（95%CI±5%）样本量公式 |
| 3 | Golden dataset evaluation (Langfuse) | langfuse.com/resources/engineering/golden-dataset-evaluation | Official | 2026 | trace 优先+合成补充；候选→golden 评审晋级；append-mostly+版本化——与仓内惯例逐字同构 |
| 4 | Building eval datasets (Samuel Ochoa) | samuelochoa.com/expertise/rag/eval/building-eval-datasets | Official/实践 | 2026-04-18 | negative examples 四类形制；来源五分类；样本量阶梯；合成 bootstrap→真实替换 |
| 5 | How to Build a Golden Dataset for LLM Evaluation (QASkills) | qaskills.sh/blog/golden-dataset-llm-evaluation-guide | Community/实践 | 2026-07-07 | sizing 表：首版 40-60 core+15-25 edge |
| 6 | tianpan.co 合成偏差批评文 | tianpan.co | Criticism | — | SILENCER/self-bias：同族生成同族偏差，跨家族生成缓解 |
| 7 | Drel 边界测试框架 | （tavily 摘要核验） | 实践 | — | 三类边界查询期望「不返回越界内容」 |
| 8 | totalshiftleft.ai 参数覆盖 | totalshiftleft.ai | 实践 | — | parameter coverage=契约覆盖核心维度 |
| 9 | DeepEval 文档 | deepeval.com | Official | — | 三级来源优先序 curated→production→synthetic |
| 10 | camerorwolfe/galtea 样本量 | （交叉引用） | Community | — | 50 抓回归/100-200 测改进/250+ 统计断言 |

（注：来源表按索引节+正文引用重组，Maxim 指南于正文引用。）

## 5) 信息缺口

- 垂直搜索域词表场景的专属实践（非通用 RAG）无直接先例，系类比迁移；
- 对照查询的量化占比无权威定值（调研建议按 sizing 表下限给足 ~12-15）。

## 最终推荐

采纳 A（含两处修正）：对照查询升级为一等断言类（独立断言键测跨域特异性——直测上游静默回退行为）；采集通道常驻（silver→gold 晋级，构建条目随流量成熟退为 bootstrap 层）。细化：per-stratum 内部核算报告；对照类条目 ≥12-15（总盘可上调 ~60-70）；LLM 建集辅助用跨家族模型；域间按三判据得分非均摊。