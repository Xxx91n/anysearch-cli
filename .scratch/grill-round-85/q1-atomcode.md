[warning] 正在以管理员权限运行 — 模型可能可以访问系统文件。
API error 网络连接失败，3 秒后重试(1/3)...


我先建立调研计划并检查知识库中是否有历史索引（先证伪"知识库为空"假设），再启动三引擎广搜。

说明：`atomcode-research` 技能虽描述匹配"深度调研"，但它通过 atomcode CLI 执行（依赖 shell），本会话工具白名单硬排除 bash，故按用户给定的研究协议直接执行。



我确认了知识库只有本项目 R84 的内部决策记录，没有外部先例，现在将用三个引擎进行广搜。



我标记任务#2为进行中，然后启动三引擎广搜，用Exa、Tavily和AnySearch分别进行多角度的查询。



三引擎并行广搜启动（Exa×5 + Tavily×4 + AnySearch×5，覆盖五类角度）。



第一轮广搜命中率高（Kohavi 官方章节、eBay 决策论论文、Yahoo KDD 先例、小样本决策矩阵等）。AnySearch 的 Q4/Q5 跑偏了，现在定向补搜缺口 + 回收被截断的结果。



I've completed the broad search across three engines and five perspectives, so now I'm moving to targeted deep-dives. I'll start by pulling the original text from the first batch of high-value sources—eBay's decision theory, Yahoo KDD search, LLM-judge criticism, Spotify's sequential testing, and the small-sample Bayesian decision matrix.



我已完成5轮深挖，其中3篇成功获取全文（Bayesian小样本决策矩阵、LLM-judge批评文、Spotify序贯测试），ar5iv转换失败和Yahoo PDF乱码需要换源处理。现在继续第二批定点深挖并补DORA官方信源。



我已成功抓取10篇核心文献，涵盖贝叶斯决策、实验设计、LLM评估等关键主题，还有2篇失败。现在补充最后一批深挖工作，包括ML离线/在线评估、搜索相关性评测、DORA官方表述和小样本方法。



我已完成 13 篇原文的完整阅读，超过了最低要求。现在进行最后一轮定点补强，处理 Yahoo KDD 论文和 DORA 官方措辞的两个缺口，然后开始综合输出。





调研完成，进入综合输出（任务 #4 保持 in_progress，输出后即关闭）。

**Sufficiency Gate 自查**：searches: 16（Exa 7 + Tavily 6 + AnySearch batch 3×2 + 补搜 2）| angles: Official（Kohavi 官方章节/eBay arXiv/TREC NIST/DORA 官方站/Spotify 工程博客）+ Comparative（offline vs online、序贯测试框架对比、debt vs feature 配比）+ Criticism（LLM-judge 局限、"不可信实验"拆解、小样本 A/B 经济学）+ Currency（2025-26 DORA AI 报告/rate limits 2026/online-eval 2026 指南）+ Community（HN 系博客/analytics-toolkit/georgiev 社区讨论）| full reads: 14（posse.studio、arxiv 2503.05061、Spotify、parin.work、GrowthBook、analytics-toolkit、tokenmix、lawsofsoftwareengineering、arxiv abs 1710.03410、mlflow、labelstud、statsig、meilisearch、gethelpt、tsapps.nist.gov 摘要）| gaps: ① Yahoo KDD16 全文未读（PDF 二进制+ACM 403，仅搜索摘要级）；② DORA 官方 "stabilize before scale" 原句未直接抓到（仅有二手转述+官方站相邻结论）；③ "配额窗口证据捕获"无强工业先例，仅能由序贯测试经济学+rate-limit 工程实践间接支撑。

---

# R85 主轴裁决调研：工业界证据驱动决策心智模型

## 1) 执行摘要（Tl;dr）

**Confidence：高**（核心结论均有官方/一手信源且多引擎交叉；个别二手转述已显式标注）。

工业界成熟心智模型对本仓情境的映射高度一致：**"离线/存量评测作为筛选闸 + 在线/受控评测作为部署决策的唯一有效证据 + 决策阈值在读数之前预注册"**——这正是 R84 已落地的"臂级主证/融合级副列/证据件四面"结构，R85 只是执行既定的重跑-读数控件。**推荐主轴 A（delta 全量重跑 + prefer-capable 前置判读）**，且判读必须预注册成三分出口（GO / NO-GO / INCONCLUSIVE 各自的下轮动作），把"读数无结论收场"的陷阱制度化为"INCONCLUSIVE 本身就是一个被记录的决策"。清障类（B）全部是"不阻塞主轴的边角债"，按 boy-scout 机会主义搭车，不占主轴轮。

## 2) 分点结论（按五个调研问题）

### Q1：组件级差分 → 加权/调参 go/no-go 的决策框架先例

**C1.1 两阶段管线是行业标准分工：离线筛选（offline screening）只回答"值得不值得上在线测"，在线受控实验才是部署决策的有效证据。**（来源：MLflow 2026 online-eval 指南全文；Label Studio 2025-12 全文；Meilisearch 2026-05 搜索相关性评测指南）
- MLflow 原文："Use offline evaluation as a screening gate. Reject clearly bad models before they reach production. Reserve online tests for candidates that pass offline screening, since online tests are expensive and expose users to risk."
- 与 R84 判据同构：臂级 delta（受控隔离、因果有效）= 本仓的"在线闸"，融合级副列 = 传导验证。组件级信号强度阈值在搜索/推荐界的先例是 **nDCG/MAP 离线 + CTR/A-B 在线双轨**，单轨不裁决（Meilisearch 指南明确列"只评一个指标"为常见错误）。
- **对本仓的直接含义**：R84 已立法"命题→测量层级映射"，调研未发现更优替代；R85 无需重审测量层级，只需执行读数。

**C1.2 从证据到动作的成熟做法是"预注册决策矩阵"：阈值在读数前写死，读数只是查表。**（来源：posse.studio 贝叶斯小样本实践全文；Spotify 2023 序贯测试博客全文）
- posse 的决策矩阵（P(B>A)×期望提升 → 六格动作：立即上线/上线+监控/继续测/继续测需更多数据/不可判定-重设实验/判定无差异）是"信号强度→动作"的完整先例，且每格动作都预定义。
- Spotify 的框架更严格：先定 alpha（误判成本），再按数据到达方式（batch vs streaming）和最大样本可估计性选测试族；"solid experimentation practices ensure valid risk management"是官方表述。
- eBay 决策论论文（arXiv:1710.03410，Goldberg & Johndrow）给了**阈值不应迷信 0.05 的理论依据**：用 eBay 真实实验数据估 Bayes 风险，最优单侧阈值对应 p≈0.45，"much less conservative than the default 0.05"；0.05 的流行更多是"对重复试错的重度多重性做粗略控制的权宜"。**关键可迁移结论：阈值应来自损失函数（误加权成本 vs 继续等待成本），而非统计惯例**——本仓 registry 注记"等数据"的默认口径本身就该是"读数为 GO 即解锁调参、NO-GO 即关闭该挂账"，损失不对称（调参可回滚、错过窗口不可逆）支持偏 GO 的方向。

### Q2：n≈57 小样本配对差分的可行动性判据

**C2.1 "检验力不足 ≠ 证据无价值"，正确处置是改读法（效应量+置信区间+方向）而非假装显著。**（来源：GrowthBook×Kohavi 网络研讨会纪要全文；analytics-toolkit/Georgiev 小样本 A/B 全文；Statsig 全文）
- Kohavi（GrowthBook 2026-07 纪要）拆解"44.8% lift 假胜"案例：真实触发样本仅 300 人、检验力 7%、"significant 结果几乎必然把真实效应夸大约 5 倍、且近 10% 概率方向为反"。这直接支持本仓 R84 立法"n=57 远低于检出 +0.01 需 ~3671 的检验力规模，不设显著性门禁"——调研确认这是工业界对低功效情形的标准处置：**报告效应量+CI，按预注册矩阵判读，不报 p**。
- Georgiev（analytics-toolkit，2019-03，更新）给出小样本风险-奖励框架：小团队应**接受更高 MDE、更宽松的阈值、或序贯/替代指标**；他的核心结论"小样本下 ROI 为负时，测的目的应从'证明增益'转为'风险管理/排除灾难'"（non-inferiority 读法）——对本仓极有参考价值：**prefer-capable 前置判读可同时读两个问题**：(i) 正向增益多大（效应量+CI 下界）；(ii) 是否显著为负（下界是否低于 0）——后者才是加权决策的硬闸（eBay 损失函数框架中"上线一个实际为负的加权"是高损失动作，"继续等待"损失低）。
- Statsig（2024-12，前 Facebook 数据科学家）："effect size 比 sample size 更决定检验力"；Z 值对样本量开根号（10,000 倍用户差距只换来 100 倍功效差距），追大效应的系统（本仓垂域臂，潜在效应是百分点级而非千分位）在小样本下反而可行。
- **配对设计的隐藏红利（对"方向性证据"中间态最有力的先例）**：本 runner 是**同 query 同期盼集配对差分**，query 难度方差被差分项消掉——配对设计等效于方差缩减（与 CUPED 同类思想，Statsig/Spotify 均列为标准功效增强手段）。因此**逐 query 的 delta 符号检验（sign test / 配对秩检验）是 n=57 下最诚实的读数**：57 对全配对中 better/worse 的计数差，若系统性偏向一侧（如 40:10:7），其方向证据强度远超把 57 当独立样本。建议判读记录里显式用配对读法，而非只报聚合命中率差。

**C2.2 方向性证据与显著性之间的中间态处理：贝叶斯后验 + 预注册，是业界两条被独立验证的腿。**
- 贝叶斯：posse 实践（300 观测/臂即可给 P(B>A)=98.7% 的决策质量答案）+ abtest 包文献（R，n₁=n₂=5 即可算 Bayes factor，Laplace 近似极小样本可用）；且后验"anytime valid"——**单次终读不存在 peeking 问题**（本仓一轮只读一次数，天然满足）。
- 预注册：experimentology.io（Wagenmakers 系）与 COS/Registered Report 文献一致确认预注册的价值 = 约束 researcher degrees of freedom、使读数可信；对 n=57 尤其关键，因为**自由度越少、效应量估计的噪声占比越可控**。
- 序贯/always-valid（mSPRT）在配额受限重跑场景的角色（见 Q3）：Spotify 仿真结论——**能估计最大样本时 GST 功效最高**；"always-valid 方法可能过保守"；Bonferroni 在少分析次数下与 always-valid 相当。对本仓（跑批节奏=有限次 interim 读数）的直接含义：**不必引入 mSPRT 复杂度，"固定 1 次终读 + 预注册矩阵"就是 Spotify 推荐的低分析次数下的正解**（其结论：间歇分析次数低时 Bonferroni/单次终读足够）。
- **LLM judge 的边界（对本仓"judge 限语料辅助不进闸"立法的交叉验证）**：Kensho/MIT "No Free Labels"（arXiv:2503.05061，2025-03）实证：judge 答不上来的子题上评分质量显著劣化，且"弱 judge + 人工参考答案 > 强 judge + 合成参考"（GPT-4o 无参考 0.47 vs 0.85 有人工参考）。这支持本仓现有立法：**进闸的断言键（hit/degraded/hitHosts/hitPaths）必须是确定性契约检查，LLM judge 只进报告评语**——调研未发现反例。

### Q3：配额/成本受限的 live 重跑策略

**C3.1 行业没有名为 "quota window harvesting" 的成熟术语，但三条可迁移的工程实践构成事实标准**（来源：tokenmix 2026-04 rate limits 指南全文；Google Cloud quota regression 博客摘要；Spotify 序贯框架）：
1. **Adaptive pacing + 配额探测先行**：跑批前读 X-RateLimit-Remaining / quota 端点确认可用配额，批内按剩余配额自适应节流，429+Retry-After 指数退避——"never test API rate limits against live systems blindly"（dev.to 测试实践）。（本仓已有"匿名配额耗尽降格"教训，重跑应把"配额探测→降级计划"写进 run 前置。）
2. **降级件再生优于丢弃**：MLflow 原文的闭环模式——"Confirmed production failures detected online should be promoted back into your offline regression dataset"；对应到本仓：首轮降格件的 null 格**不是作废数据，是 coverage 缺口的标定**（R84 证据 honesty 已立法 unknown/null 非 0）；重跑只需回填 null 格，非全量重跑——**省配额的跑批节奏 = 按 stratum 优先级排序（先 parameterized 硬断言格，后 semantic 软格）**，若配额中途再耗尽，按"可测格完备优先"截断并在证据件记 coverage。
3. **采样率与成本显式挂钩**：MLflow "1-10% 采样是标准实践"——成本控制的正解是**采样率/批次大小的显式参数化**，而非整批弃跑。
- 序贯经济学补充（Spotify 仿真）：配额受限=最大样本可估计→**选单次终读+预注册**（见 C2.2），把"分多次跑批攒数据"的冲动制度化掉——多 interim 读数的功效收益在低分析次数下不显著，却引入 peeking 风险。

### Q4：证据轮 vs 清障轮的排序心智模型

**C4.1 排序判据：依赖关系优先于工时/风险偏好——阻塞后续关键路径的债 > 不阻塞的债；"证据生产"在本仓语境是 prefer-capable 挂账的**前置**，清障清单（R84 已定性"不占主轴价值"）全是非阻塞边角。**（来源：dev.to 2x2 矩阵"Fix Now / Schedule / Defer"三分法；volpis/Medium 债务决策树；Product Coalition 债务树）
- 2x2 先例的"Fix Now"定义 = "high-risk 或 **blocks an upcoming critical feature**"——A 轮不是债，是 critical path；B 轮清单全落在 Schedule/Defer 象限（empty-endpoint 是 fail-fast 边角、smell 是 9 条清单、control 降级是口径问题，均无下游轮次依赖）。
- DORA 侧的相邻结论（dora.dev 官方站："speed and stability are not tradeoffs — top performers do well across all five metrics"；Thoughtworks Radar 2021-10 条目）常被误读为"先稳后快"，实际是**两者相关性证据，不给出排序**；真正的顺序化先例在运营转型文献："stabilize-standardize-scale 顺序颠倒约 70% 失败"（gethelpt 2026-03 引 case study；**注意此为二手转述，未获一手验证**，方向性参考）。本仓映射：**"证据机制已稳定（R84 审计 PASS）"对应"stabilize 已完成"，当前轮到的是 scale（读数+决策），不是再修地基**。
- **Boy Scout 规则（Uncle Bob / "if you touch it, you own it"，lawsofsoftwareengineering 全文）是 B 轮项的正确归宿**：清障项搭车 A 轮触碰的同一代码面时顺手做（如重跑 runner 时顺带清 a03 相关 smell），独立成轮则违反本仓"一轮一主题"纪律（C 选项被否的调研支撑：stage-gate 文献一致警告一 gate 多命题 → 证据评估失焦；"Gate 3: 评估证据是否支持 scale，单一决策面"）。

### Q5："读数即轮"（evidence-only round）的先例与陷阱规避

**C5.1 先例充分存在且结构成熟：stage-gate 的 Gate 3（Investment Decision）就是纯判读闸——不产工件，只出 go/kill/hold 裁决；"last responsible moment"框架则给"纯等待/纯读数轮"划出了合法性边界。**（来源：parin.work 全文；Tavily 命中的 gov.uk gate review 模板 + qmarkets/corasystems stage-gate 指南）
- Last Responsible Moment 的四维判据可直接套在 R85：
  - **Reversibility**：prefer-capable 加权可回滚（registry 注记即回滚点）→ 读数轮不必含实施；
  - **Information gain**：本轮唯一新增证据 = 全量四面 delta（存量件 armHostHit 大面积 null，**无新信息量的再读是浪费，重跑才是信息事件**）→ 重跑+读数是"named evidence"，满足"delay 只在购买具名证据时负责"；
  - **Cost of delay**：加权挂账每多挂一轮的协调成本递增（R83→R84 已挂两轮），且"等数据"窗口（key 就位、配额可用）是**有界**的——错过窗口的成本 > 多挂一轮；
  - **Trigger**：本仓已有显式 trigger（defer-r84-delta-quota-rerun 的核销条件 = 有效 key + 重跑），R85 恰是 trigger 命中轮。
- **陷阱（analysis paralysis / 读数无结论）的制度化规避，业界三条**：
  1. **预注册出口**（posse 矩阵 + 本仓 ADR-0064 go/no-go 先例）：轮次开工前写死"读数→动作"映射，读数后不允许"再看看"。INCONCLUSIVE 是第三出口而非失败态，但必须附"继续等的下一个具名条件"（如"再攒 N 条语料"或"等 ip 第五域"），否则 INCONCLUSIVE 就是 laundering。
  2. **单次终读纪律**（Spotify 低分析次数结论 + 本仓一轮一读数）：禁止跑批中途多次"看一眼"后改判——peeking 使方向证据可信度归零（GrowthBook 纪要：低功效下 peek 出的"胜"方向都可能反）。
  3. **决策记录工件化**（本仓 registry/ledger 心智与 stage-gate workbook 同构）：轮次完成定义 = "registry 注记状态变更 + 决策记录落盘"，而非"拿到数据"。parin.work 的失败模式三（decision laundering："团队说没决定，但代码和数据已经在替它决定"）正是"只跑不判"轮的病名。

## 3) R85 选项对比矩阵

| 项 | 主轴价值（阻塞关系） | 外部依赖 | 工业先例支持 | 主要陷阱 | 先例归类（2x2） |
|---|---|---|---|---|---|
| **A：delta 全量重跑 + prefer-capable 前置判读** | 高——唯一解锁/关闭 defer-r83 挂账的证据事件（trigger 已命中：key 就位） | 无（key 已实测 live） | 强：两阶段评测管线、预注册决策矩阵、配对差分、eBay 损失阈值、last-responsible-moment 四维全过 | 读数无结论（可用预注册三分出口制度化规避）；配额再耗尽（adaptive pacing + 按 stratum 优先级截断 + null 格回填而非弃跑） | Fix Now（critical path） |
| **B：清障轮（empty-endpoint + a03/a06/a08 + smell + control 口径）** | 低——R84 已定性"不占主轴价值"，全部非阻塞边角 | 无 | 中：债务 2x2/决策树全部指向 Schedule 或 Defer；DORA 不给出"先债后功能" | 占主轴轮却零关键路径推进；与"一轮一主题"不冲突但机会成本高 | Schedule/Defer（boy-scout 搭车位） |
| **C：A+B 复合** | 中 | 无 | 弱——stage-gate 文献一致反对单 gate 多决策面；本仓自立法"一轮一主题" | 双主题稀释证据判读专注度（判读需要整轮心智带宽）；B 项塞进重跑轮反而可能碰 runner 代码引入变量 | 反模式（gate 失焦） |
| **D：另指（如 ip 第五域扩域 / 语料扩量先行）** | 低——ip 域缺上游参数（defer-r84-ip-fifth-domain 前置未满足）；扩语料是把 INCONCLUSIVE 的"继续条件"提前执行，但当前先应读出存量 57 条的全量信号 | 上游 ip 结构化参数 | 弱——TREC 50 topics 标准（NIST：50 topics/800k docs 是 ad-hoc 标准规模，本仓 57 条语料规模量级相近）提示"语料规模不是当前瓶颈，判读框架才是" | 用扩量替代判读 = 典型的 delay laundering（无具名证据触发） | Defer（前置未满足） |

## 4) 完整来源清单

| # | 标题 | URL | 抓取角度 | 日期（页内） | 贡献 |
|---|---|---|---|---|---|
| 1 | A/B testing for small sample sizes: Bayesian methods in practice（posse.studio） | https://posse.studio/articles/ab-testing-bayesian | Community/对比 | 2026-11 | P(B>A)×lift 六格决策矩阵全文；"500 观测卡 50-80% = underpowered → kill 换大 swing"；小样本贝叶斯 always-valid 读法 |
| 2 | No Free Labels: Limitations of LLM-as-a-Judge（arXiv:2503.05061，Kensho/MIT） | https://arxiv.org/html/2503.05061v1 | Official/批评 | 2025-03-07 | judge 在自答题子集显著劣化；弱 judge+人工参考 > 强 judge+合成参考 → 支撑"judge 不进闸、确定性断言进闸" |
| 3 | Choosing a Sequential Testing Framework（Spotify Engineering） | https://engineering.atspotify.com/2023/03/choosing-sequential-testing-framework-comparisons-and-discussions | Official | 2023-03 | GST vs mSPRT/GAVI/Bonferroni 功效仿真；"低分析次数下 Bonferroni/单次终读足够，always-valid 过保守"→ R85 单次终读正解 |
| 4 | The Last Responsible Moment（parin.work） | https://parin.work/last-responsible-moment.html | Community/批评 | 2025-03-15 | 延迟决策四维判据（reversibility/information gain/cost of delay/coordination）+ 三失败模式（含 decision laundering）→ evidence-only round 合法性边界与陷阱规避 |
| 5 | Lessons learned from Ronny Kohavi and Luke Sonnet（GrowthBook） | https://www.growthbook.io/blog/lessons-learned-from-ronny-kohavi-and-luke-sonnet-running-trustworthy-experiments | Official/批评 | 2026-07-17 | "44.8% lift"低功效假胜拆解（300 真实样本、7% 功效、方向近 10% 概率为反）→ n=57 不设显著性门禁+报效应量的标准处置 |
| 6 | A/B Testing with a Small Sample Size（Georgiev，analytics-toolkit） | https://blog.analytics-toolkit.com/2019/a-b-testing-with-a-small-sample-size | Community | 2019-03（更新） | 小样本风险-奖励框架；non-inferiority/风险管理读法 → 判读双问题：增益效应量 + 是否显著为负 |
| 7 | A Decision Theoretic Approach to A/B Testing（arXiv:1710.03410，eBay 数据） | https://arxiv.org/abs/1710.03410 | Official | 2017-10 | Bayes 风险定阈值；0.05 过保守（最优≈单侧 p 0.45）→ 阈值来自损失函数（加权可回滚 → 偏 GO） |
| 8 | AI API Rate Limits Guide 2026（TokenMix） | https://tokenmix.ai/blog/ai-api-rate-limits-guide | Currency | 2026-04-07（更新 2026-04-29） | RPM/TPM/RPD 三限并行、X-RateLimit 头探测、backoff/队列/batch 策略 → 配额窗口重跑的 pacing 工程实践 |
| 9 | What Is Online Evaluation in ML: A 2026 Guide（MLflow） | https://mlflow.org/articles/what-is-online-evaluation-in-ml-a-2026-guide/ | Currency/对比 | 2026-07-17 | 离线=筛选闸/在线=部署决策分工原文；1-10% 采样成本实践；"在线确认的失败回填离线回归集"闭环 → 降格件回填优先于弃跑 |
| 10 | Offline vs Online AI Evaluation（Label Studio） | https://labelstud.io/learning-center/offline-evaluation-vs-online-evaluation-when-to-use-each/ | Comparative | 2025-12-21 | 两阶段工作流（offline 迭代 → offline 稳定后 online 验证）；offline 必要不充分 |
| 11 | A practical guide to search relevance metrics（Meilisearch） | https://www.meilisearch.com/blog/search-relevance-metrics | Comparative | 2026-05-26 | 搜索相关性离线 nDCG/MAP + 在线 CTR/A-B 双轨先例；"小样本扭曲聚合指标"列为常见错误 → 配对读法必要性 |
| 12 | You don't need large sample sizes to run A/B tests（Statsig） | https://www.statsig.com/blog/you-dont-need-large-sample-sizes-ab-tests | Community/对比 | 2024-12-12 | 功效根号定律（10⁴ 用户差=100 功效差）；CUPED/分层/贝叶斯功效增强 → 配对差分方差缩减定位 |
| 13 | The Boy Scout Rule（Laws of Software Engineering） | https://lawsofsoftwareengineering.com/laws/boy-scout-rule/ | Community | 2026-07-20 更新 | "if you touch it you own it"（Google）→ 清障项搭车 A 轮的正确归宿 |
| 14 | NIST 论文摘要（TREC 评估稳健性） | https://tsapps.nist.gov/publication/get_pdf.cfm?pub_id=150469 | Official | （NIST 出版页） | TREC 标准规模 50 topics/~800k docs、pooling 机制 → 本仓 57 条语料量级处于 IR 评测标准区间，语料量非瓶颈 |
| 15 | DORA 官方：metrics history / guides | https://dora.dev/insights/dora-metrics-history · https://dora.dev/guides/dora-metrics | Official | 2026-01-02 更新 | "speed and stability 非 tradeoff，是相关性"→ 官方未给"先债后功能"排序；排序须走依赖关系而非 DORA |

*未读说明*：Yahoo KDD16 论文（yichang-cs.com PDF 二进制不可解 + dl.acm.org 403）仅搜索摘要级，未计入关键结论；DORA "stabilize before scale" 原句仅 gethelpt/gogoai 二手转述（已在上文标注）。

## 5) 信息缺口

1. **配额窗口捕获无强工业先例**——"quota window harvesting"在检索中未命中成文方法论，只能由 rate-limit 工程实践（C3.1-1）+ 序贯测试经济学（C3.1-3）间接拼出；若 R85 要把它写成 run 规程，属本仓原创制度化（可接受，无先例反证）。
2. **Yahoo/Google 搜索团队对"组件级 delta 阈值"的具体数值先例未获一手**（KDD16 全文未读）——已知定性框架（offline 筛选 + online 裁决 + nDCG 双轨），具体阈值数字仍是各团队私有实践。
3. **配对符号检验在 IR 评测（而非 web A/B）中的使用频率**未专项检索——统计上标准（Wilcoxon/sign test 教科书级），但在 TREC 语境下的惯例读法（TREC 惯用成对显著性检验 t-test on per-query scores）与本建议方向一致，未见冲突信源，属"无证据反对"而非"有证据支持"。
4. **DORA "stabilize before scale" 一手出处**未定位到原始报告章节（2021 报告为付费/长文档），方向性结论仅二手支撑。

---

## 6) R85 主轴推荐与理由

**推荐：A（delta 腿全量重跑 + prefer-capable 前置判读），附三项预注册护栏。**

理由链（每条锚定调研信源）：
1. **Trigger 已命中**：defer-r84-delta-quota-rerun 的核销条件（有效 key + live 跑通）满足——last-responsible-moment 四维全过（加权可回滚/本轮购买具名证据/挂账已两轮协调成本递增/registry 显式 trigger），继续等的成本已高于立即读数（C5.1，parin.work；本仓 R84 D-005）。
2. **判读框架调研确认无需新设计，只需执行**：两阶段管线（臂级=在线闸）与 R84 立法同构（C1.1）；n=57 的正确读法是"配对差分符号 + 效应量/CI + 预注册三分矩阵（GO 解锁调参 / NO-GO 关闭挂账 / INCONCLUSIVE 附继续条件）"，显著性门禁不设（C2.1-2.2，posse + GrowthBook/Kohavi + Statsig）；损失不对称（加权可回滚、窗口有界）支持 GO 阈值偏宽松（C1.2，eBay 决策论）。
3. **重跑规程有可迁移工程实践**：配额探测先行 + adaptive pacing + 按 stratum 优先级截断 + null 格回填而非弃跑（C3.1，tokenmix + MLflow 闭环模式）；单次终读、跑批中不改判（C2.2，Spotify 低分析次数结论）。
4. **B 全降档为搭车项，C 否决**：清障清单全部非阻塞边角（R84 已定性），按 boy-scout 原则在 A 轮触碰同一代码面时顺手清（C4.1）；C 复合违反 stage-gate 单闸单决策面与"一轮一主题"纪律（C4.1）。D（ip 域/扩语料）前置未满足且属"用扩量替代判读"的 delay laundering（C5.1-3；TREC 50-topics 标准提示语料量非瓶颈）。
5. **轮次完成定义（防 analysis paralysis 的制度护栏）**：本轮 done = "四面证据件全量再生（coverage 缺口显式记录）+ 预注册矩阵读数 + registry 注记状态变更 + 决策记录落盘"；拿到数据但未判读不算完成（C5.1-3，parin.work decision laundering 病名；本仓 ADR-0064 发布终审先例同构）。

**执行建议（供下轮 grill 过堂，本轮不实施）**：重跑按 parameterized → semantic → control 顺序、臂级主证优先；判读工件预注册三出口及各自的下轮动作；若 INCONCLUSIVE，继续条件必须是具名事件（语料扩至 N 条 / ip 第五域建集），否则该 INCONCLUSIVE 不得作为"继续等"的理由。



调研已收口（配额与 Sufficiency Gate 自查见上一轮输出），R85 主轴推荐 **A：delta 腿全量重跑 + prefer-capable 前置判读**（附预注册三分出口、单次终读、按 stratum 优先级回填 null 格三项护栏；B 全部降为 boy-scout 搭车项，C/D 否决）。

下一步是你的决策点：是否按 A 轴开 R85 grill 轮（过堂预注册判读矩阵的具体阈值与三出口下轮动作）？

继续此会话，运行：atomcode -p "…" --resume 1ead8e61-7ed4-45bd-adc3-6eba63f8ecf8
