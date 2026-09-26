# atomcode 调研存档 — R84-Q2 评测面落点形态（2026-09-26）

> 原问题存档：q2-prompt.txt。本件为 atomcode stdout 忠实重组（ctx 索引节拼合）。

## 1) 执行摘要（Tl;dr）

**推荐 A（双层扩展现有族谱），Confidence 高**。业界成熟心智模型是「**一套 dataset 治理面（versioning/fingerprint/quarantine），多个断言层（suite/dimension 分层）**」——Langfuse、Braintrust、prodinit 等一致主张 dataset 按 component/behavior 分 *scope* 但共用同一套维护/版本/基线纪律，而非每轴另起一套治理设施。B（平行新面）会复制 fingerprint/quarantine/ship-gate 三套机械，正是治理漂移的经典失败模式；C（纯报告腿）违反「数据集变更须指纹钉定」的共识——没有持久金标的 delta 证据件不可复现、不可归因（aievals：“无数据集哈希的结果不可证伪”）。

## 2) 分点结论

**① 金标版本治理的成熟形制 = 内容哈希钉定 + 不可变版本 + 结果行三哈希溯源**（aievals.co 官方指南，全文核验）
- dataset 用内容哈希（sort_keys + sort lines 的 SHA-256 截 12 hex）而非 git commit SHA 钉定；每个 eval 结果行必须携带 dataset hash + system hash + judge hash 三元组，“拒绝任何不显示这三者的 leaderboard”。git commit 不是正确哈希（改 README 也变）。
- 编号版本不可变（golden_v1.jsonl→v2 是显式 dated decision），版本内 append-only。**与仓内现状（eval-looks.json 单文件账册 + 16-hex fingerprint + quarantine shrink-only 棘轮）同构**，仓内纪律已达业界成熟线，无需新增设施——垂域条目进现有账册即自动继承。

**② 「复用 vs 平行新建」：业界默认 = 同一治理面、多 scope/多 suite，而非每轴一套账册**（Langfuse 官方 golden dataset 指南，全文核验）
- Langfuse 原文：“Scope: one dataset per component or behavior… You will end up with several datasets, each answering one question”——但这些 datasets 共享同一项目的 trace 溯源、同一维护流程（schema validation、dedup、item versioning、freshness 元数据）、同一基线对照机制（“running one experiment per version against the same pinned dataset version and reading score deltas against a designated baseline”）。
- prodinit 四层 eval stack（unit/reference/rubric/behavioral）是同一失败模式分类学下的**分层断言面**，全部挂在同一 golden dataset 治理上；其三大结构性失败之一恰是“golden datasets that have silently rotted”——多一套独立账册就多一处静默腐烂点。
- 映射到仓内：looks 账册已有 domain 字段 + scopes(live|both|offline) + provenance + stability_class，**垂域条目只需新增断言键与打标，不需要第二本账册**。B 方案的“自有账册+自有断言注册面”在文献里找不到正面先例，反而制造双 fingerprint/双 quarantine 棘轮的对账负担。

**③ 对比型评测（arm-vs-arm）在离线金标框架中的落法：三段式流水线，offline 金标先筛、delta 报告出证据、interleaving 留在线层**（Airbnb 工程博客全文核验 + Netflix/Amazon 交叉）
- Airbnb 三阶段：“standard offline evaluation on the ranker with NDCG → rankers with reasonable results move on to online evaluation with interleaving → promising ones go on for the A/B test”。即：离线金标框架里做的是**绝对分 + 双臂各自得分后的 delta 对照**，interleaving 本质是在线用户行为方法（team-draft/balanced interleaving 需要点击信号），**不应进离线确定性门禁**——仓内“interleaving 记 ADR 远期出口”与此完全一致。
- 离线侧的成熟落法是**共享 query、双臂分别跑、delta 报告**（Airbnb: “reading score deltas against a designated baseline”；Amazon Science: interleaving 的价值是敏感性 10–100×，但那是 within-subject 在线设计）。成对条目（paired items）用于 prompt/model 级 paired-CI，对“垂域臂 vs general 臂”这种臂级对比，**同一批 golden query 双臂执行 + 逐臂断言 + delta 证据件**是标准形制——恰好是 A 方案“证据层双臂 delta 证据件”的形状。
- Netflix 数据点：interleaving 比 A/B 敏感 100×+；Airbnb：与 A/B 结论 82% 一致、0.5% 时间达标。这支持把 interleaving 定位为“远期在线出口”而非本轮离线腿。

**④ drift/quarantine：append-mostly + 续期而非静默删**（dev.to drift 文 + Langfuse 全文核验）
- 金标集 decay 是“静默属性”：domain shift / distribution shift / feature drift 三类，pass rate 平但世界变了。对策是 append-mostly log + 条目带日期元数据（仓内 harvestedAt + stability_class 已具备）+ 定期对生产分布做 drift 检测（MMD/embedding 属可选增强）。
- 新增失败案例进金标 = 业界第一采集来源（“if a class of input has ever caused an incident, it belongs in the dataset”）；垂域臂首采的失败对（vertical miss / general hit）正是这种 incident-derived 条目，internal-dogfood provenance 惯例吻合。

**⑤ LLM judge 定位：辅助建集与报告通道，不进确定性门禁**（prodinit 全文 + 仓内 ADR-0027 D1 先例）
- prodinit：judge 层（rubric evals）需要校准，GPT-4 judge 专家域一致率降到 60–68%；其 CI 门禁示例虽 gate 在 rubric 回归上，但仓内 ADR-0027 D1 已裁定“judge-in-CI-gate”是 anti-pattern。本轮维持 judge 只进建集辅助（label 候选/聚类）与报告（delta 报告附 judge 评语），与 aievals“judge hash 独立钉定、结果行三元组溯源”的治理位一致——judge 是结果行的溯源维度之一，不是门禁位。

## 3) 对比矩阵：三落点形态

| 项 | (A) 双层扩展现有族谱 | (B) 平行新面 | (C) 纯报告腿 |
|---|---|---|---|
| 治理面（fingerprint/quarantine/ship-gate） | 复用单套，垂域条目自动继承 | 复制三套机械，双账册对账 | 无持久金标，无指纹 |
| 业界先例 | Langfuse/Braintrust/prodinit：同一治理面、多 scope/分层断言 | 无正面先例；多账册=多腐烂点（prodinit 失败模式 2） | 仅适合一次性审计，不可复现（aievals：无哈希结果不可证伪） |
| delta 证据件可归因性 | 数据集哈希+臂标识+judge 标识三元组溯源 | 可归因但跨账册比较正是 fingerprint 纪律要防的坑 | 无基线版本，不可归因 |
| 契约层（离线确定性） | looks 新增 expected.vertical + verticalHit + degraded 语义，编译器强制同步（ADR-0027 D11 惯例） | 独立 schema，与 store API 同步性靠人肉 | 不存在 |
| 维护成本 | 条目级增量 | 新模块 + 新 runner + 新 gate 断言 | 最低但一次性 |
| 主要风险 | looks 条目结构膨胀，需 domain 打标防混 scope | 设施重复 + 漂移面翻倍 | 证据不沉淀，R84 候选 A（prefer-capable 调参）无前置数据可用 |

## 4) 完整来源清单

（索引节 2.1KB；正文引用：aievals.co 金标治理指南/Langfuse golden dataset 指南/prodinit 四层 eval stack 复盘/Airbnb interleaving 工程博客/Netflix interleaving techblog/Amazon Science/dev.to drift 文/Hamel Husain & Shreya Shankar LLM Evals FAQ（原文 404 未读）/Braintrust；尾部截断，以正文引用为准。）

## 5) 信息缺口

- 未找到“每轴一套账册”失败模式的**直接**一手叙述（业界默认到没写反面，只能从 prodinit 失败模式 2 反推）；如需可补查 monorepo 测试套件治理文献。
- Hamel Husain & Shreya Shankar LLM Evals FAQ 原文（hamel.dev）两路径均 404，judge 纪律部分依赖二手转述 + 仓内 ADR 先例。
- 垂域臂对比的“成对条目 vs 共享 query 双臂”之争，文献给的是 prompt 级 paired-CI 与臂级 NDCG delta 两种尺度，**query 级检索质量对比的最小样本量/显著性实践未深挖**——若 R84 要给 delta 定门禁阈值需另轮调研。

## 最终推荐

采纳 **A**。契约层：looks 账册新增 expected.vertical{domain,sub_domain,paramsKeys} + verticalHit + degraded 语义（offline 确定性跑，沿用 ADR-0027 D11 typed TS / 编译器同步惯例）；证据层：垂域质量差条目入 golden.entries（live-scoped、domain 打标、任务类分层、internal-dogfood provenance），双臂共享同一批 query 分别断言、delta 证据件携带 dataset fingerprint + 臂标识溯源，quarantine/fingerprint/ship-gate 惯例直接接管；LLM judge 只进建集辅助与报告；interleaving 记 ADR 远期在线出口（Airbnb 三段式背书）。
