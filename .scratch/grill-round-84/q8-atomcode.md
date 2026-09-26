# atomcode 调研存档 — R84-Q8 轮结构与收口判据（2026-09-26）

> 原问题存档：q8-prompt.txt。本件为 atomcode stdout 忠实重组（ctx 索引节拼合）。裁决建议：(A) 原序 T0→T4 不调序+收口判据维持拟议并补两处业界细节。

## 1) 执行摘要（Tl;dr）

**置信度：高**（多源交叉验证+官方/一线实践指南一致；缺大规模公司内部排序一手案例故非满分）。工业界成熟心智模型明确支持「契约/schema 先于语料、语料先于 runner」：schema 是语料条目的「合同」，runner 是消费语料的「管道」，倒置产生空跑或返工。R84 的 T1（契约层+语义前置）→T2（语料构建）→T3（runner）排序与业界五阶段序（定义目标→schema 化语料→scorer/断言→runner→CI/收口）**完全同构，照原序执行**；收口判据方面，业界对「eval leg 建成」的标准形态是**四件套齐=schema 在+语料达量且分层覆盖+runner 跑通+证据件（per-case 结果+阈值+样本量）产出**，R84 拟议判据比业界常见水平**略严但方向正确**，建议维持。

## 2) 分点结论

### ① schema=合同论——「looks schema 断言键是语料条目容器」的业界同构

- agent-axiom（规范附录）：最小条目形制=task/input/expected_outcomes/risk_class——正是「schema 断言键作语料条目容器」的同构物。
- tech-insider（2026-08）：语料文件要像数据库迁移一样对待——「reviewed, versioned, never edited silently；语料悄悄漂移是评测管线悄然失效的最常见原因之一」——支持 T2 语料需 provenance+版本化纪律。

### ② 两个已知陷阱与 R84 的对应关系

- **「runner 先于语料」=空跑**：hashorn 指出 runner 应极简（「Don't over-engineer it」），其全部价值来自消费 eval set——没有达量语料的 runner 只能验证管道不报错，产出无信息量证据件。
- **「语料先于 schema」=返工**：agent-axiom 列举的失败形态（「JSON 无稳定结构、ground truth/期望/审阅注释混在一个字段」）正是无 schema 先行时语料构建的典型结局；agent-axiom 引 OpenAI SWE-Bench Pro 审计（731 任务中自动管线标 200 个坏、人工标 249 个坏）证明**语料本身需质检与缺陷分类**——支持 R84 的 LLM 跨家族辅助+人工抽审设计。

### ③ 语料规模业界基准 vs R84 的 60-70 条

- 业界起步建议跨度大但方向一致：hashorn「30 条起步」、tech-insider「15-20 条起步」、ai-tldr「首 launch 50-100 条、成熟 500+」、learnersink「100-500 条，>500 边际价值骤降」、digitalapplied「20-50 条即可当日完成资格审查」。**R84 的 60-70 条落在「首 launch 充分」区间上沿**，质量/覆盖>数量是共识（「80 个好样本胜过 500 个同质 happy-path」）——60-70 条合理不需加量。
- 分层配比先例：hashorn 给出 60-70% happy path/20-25% edge/10-15% adversarial+全量历史失败回归——R84「三类分层+对照类≥12-15」与之同构（12-15/60-70≈20% 落在 10-25% 类比带内）。

### ④ 「eval leg 建成」验收标准——业界形态 vs R84 拟议判据

业界标准四件套：(a) schema 化语料在版本库（agent-axiom、tech-insider）；(b) 语料达量且分层覆盖 failure modes（hashorn/ai-tldr）；(c) runner 全量跑通且跨 run 一致（galtea：「同一 judge、同一 rubric、同一温度，harness 变了分数不可比」）；(d) 证据件=per-case 结果+显式分母+阈值+基线 delta（ai-tldr：「每个 rate 报告分子分母」；agent-axiom：「保留分母、不得静默剔除 timeout、未知成本记为 unknown 而非零」）。R84 拟议收口判据比业界常见水平略严但方向正确。

### ⑤ 配对 delta（D-004）的先例支持

ai-tldr：成熟管线应「加置信区间或 paired bootstrap，报告 win/tie/loss，配对 judge 比较要换序检测位置偏置」；galtea：从 Likert 转二元、与专家判定校准（Pearson r>0.7）。R84「分层断言+配对 delta」正是 paired design 标准形。

## 3) 对比矩阵：三种排序方案

| 排序方案 | 典型出处 | 优势 | 已知风险 | 对 R84 适配度 |
|---|---|---|---|---|
| 契约/schema→语料→runner（T1→T2→T3） | agent-axiom、ai-tldr、tech-insider | 断言即合同，语料一次成型；runner 落地即有完整消费面 | 前期设计成本高，schema 过早固化可能限制语料多样性 | 高（仓内 looks schema 本就是条目容器非绿地） |
| 语料→schema→runner | 小团队实践（agent-axiom 列反面） | 起步快 | 返工实证：无结构语料→对比模糊→门禁不可自动化→重构 | 低 |
| runner→语料 | 无主流倡导，demo 驱动团队 | 管道早验证 | 空跑价值≈0；证据件无分母无意义 | 低 |

## 4) 对 R84-Q8 的裁决建议

- **(A) 采纳原序 T0→T4，不做调序（否 B）**：T1 契约层（断言键 schema+A-02/A-04 语义前置）在 T2 语料之前是业界主流序，仓内实物依赖（语料须用 schema 落断言、runner 须消费立法后语义）硬性要求此序；T0 哨戒续班并行不占主轴，符合「哨戒与主线并行」惯例。
- **(C) 收口判据维持拟议方案，仅补两处业界细节**：① delta 证据件中所有 unknown/未达量字段记 null/unknown 而非 0（agent-axiom 铁律防 Goodhart）；② 首窗语料若某分层稀薄，按 ai-tldr 惯例在证据件里记 coverage 缺口而非删层——正对应拟议的「首窗稀薄诚实记」。
- **(D) 无另指**：唯一开放风险——业界无 R84 这种「双层（臂级+融合级）+垂域四轴」完全同构先例，D-005 融合级副列属仓内自创形制，判据从严（如实降格档）是对的。

## 5) 完整来源清单

| # | 标题 | URL | 角度 | 日期 | 贡献 |
|---|---|---|---|---|---|
| 1 | Eval Dataset Schema and Grading Contract (agent-axiom) | agent-axiom.github.io/agent-arch/en/appendix/eval-schema/ | Official/规范 | — | schema=合同论、最小条目形制、语料质检（SWE-Bench Pro 审计）、unknown≠zero 证据合同 |
| 2 | How to Build an LLM Evaluation Suite (AI/TLDR) | ai-tldr.dev/learn/evaluation-safety/evaluation-basics/how-to-build-eval-suite/ | Comparative/方法 | 2026-06-12 | 五阶段顺序模型、50-100 起步量、paired delta 与分母报告 |
| 3 | LLM eval pipeline 12 steps (Tech Insider) | tech-insider.org/how-to-build-llm-evaluation-pipeline-2026 | Currency/实践 | 2026-08-05 | 语料=迁移级版本纪律、分层测试先确定性后 judge |
| 4 | Building Your First LLM Evaluation Harness (Hashorn) | hashorn.com/blog/building-your-first-llm-evaluation-harness | Community/实践 | 2026-04-06 | runner 极简原则、60-70/20-25/10-15 分层配比、常见错误清单 |
| 5 | The complete guide for LLM evaluations 2026 (Galtea) | galtea.ai/blog/llm-evaluation-complete-guide | Criticism/陷阱 | 2026 | harness 跨 run 一致性、held-out 防 Goodhart、校准判据 |
| 6 | Evaluation best practices（OpenAI 官方） | developers.openai.com/api/docs/guides/evaluation-best-practices | Official | 当前版 | 判别式评测设计、judge 与人工标注一致性升级路径 |
| 7 | Dataset evaluation（AWS Bedrock AgentCore 官方） | docs.aws.amazon.com/bedrock-agentcore/latest/devguide/dataset-evaluations.html | Official | public preview | 双 runner 共享同一 dataset schema+ground truth 形制官方实现 |

## 6) 信息缺口

- 大厂（Google/Anthropic/Waymo 级）内部「评测基建排序」一手工程复盘未公开可得，仅有招聘 JD 侧证（语料与 harness 并列为核心资产）；本报告以多源实践指南+规范附录交叉补偿。
- 「对照类≥12-15」精确数字无业界先例直接对应——业界只有分层占比（10-25% 类比），该数字是仓内自定，无法外部验证，只能靠首轮实测反馈校准。