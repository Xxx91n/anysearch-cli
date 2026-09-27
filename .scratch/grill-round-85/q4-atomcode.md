[warning] 正在以管理员权限运行 — 模型可能可以访问系统文件。
知识库无直接命中历史调研，转入联网三引擎调研。先广泛搜索四个子问题。继续第二阶段：定点深挖官方文档与高价值原文。继续定点深挖：补足 web_fetch 配额与三引擎交叉验证。继续补齐缺口：配额受限 A/B 实验调度（GRE 官方论文）与 MNAR/截断偏差交叉验证。最后补一轮：LakeFS/DVC 官方文档印证工件驻留分级惯例。searches: 9+ | angles: Official / Comparative / Criticism / Currency / Community（五类全覆盖）| full reads: 7 篇独立 URL（DVC 官方文档、lakeFS 官方博客、Schneide 博客、Code with Jason、Catalog of Bias、dev.to DVC+MLflow 实践、QASkills 隔离流程全文；ACM DL 403 未读不计）| gaps: GRE 2018 原文被 403 拦截（改由摘要+SIGCOMM 2003 全文+Tavily 交叉佐证）；lakeFS how-it-works 页 404（改用官方博客全文）

---

## R85 Q4 细节包裁决调研报告（模式：default）

### 1) 执行摘要（Tl;dr）

**推荐细节包 A（三项均采纳），Confidence：①中高 ②高 ③高 ④高。** ①域轮询交错（vdomain×stratum 轮转）符合公平排队与「部分完成运行信息量」双线证据：业界在受限预算下默认用轮询/分层交错保证早截断时的覆盖代表性，而优先级序仅在「有可靠先验胜率预测」时才优于随机/轮询序——预注册 evidence-only 轮恰恰不允许用未注册先验做优先级，故轮询是唯一不引入未注册决策自由的选项；②DVC 官方惯例（元数据/指针入 Git、大数据件外置对象存储、双写关联）直接支持「prereg-matrix/decision-record 入库 + delta.json 驻本地」的分级；③Boy-scout「同面」在受限轮的操作化共识是 **campsite 级 = 你亲手触碰的文件/diff 邻接面**，且必须独立 commit、绝不跨文件搭车——包 A 的封闭清单与「离面项一律留清障轮」正合业界主流；④部分截断运行的处置取决于缺失机制：轮询交错使截断近似 MAR（可保留已格数据判读但记注记），若某域被系统性排后则是结构性 MNAR（catalogofbias 明示低估/高估风险）——这正是包 A①与 A④互为因果的闭环。

### 2) 分点结论

**①调度序：域轮询交错 ✅（Confidence 中高）**
- 公平排队文献（Stratified Round Robin，SIGCOMM 2003 / IEEE/ACM ToN 2006，已读全文 PDF）确立分层轮询在 O(1) 复杂度下提供与流数无关的公平界——映射到本仓即「每域在截断前获得近似均等的条目配额」，null 格均布四域。
- 受限预算 A/B 实验调度研究（KDD 2018 GRE 系论文，ACM 403 但摘要+SIGCOMM 全文+Tavily 双源）：**贪婪优先级序只有在使用有据可依的预测特征（历史点击、ERR/DCG）时才超过「自然/随机序」**（最高 +342%，无先验时只有 Explore 型探索可 +43~190%）。预注册轮禁 peeking、禁未注册先验 ⇒ 优先级序没有合法输入，轮询是信息论上最中性的默认。
- CI 侧旁证（qaskills.sh 隔离流程全文已读）：隔离条「shadow lane 继续跑、不阻塞主信号」的做法印证「对照条只跑 off 对」+「对照层先行仪器探针早停」的既有设计——调度序变更不应触碰这层，包 A 恰好只动处理层。
- **风险注记**：轮询交错使截断近似 MAR 的前提是**轮转在配额耗尽时对四域同时生效**——即截断点落在轮内而非轮间。runner 已是 per-entry 四趟交错，与轮询天然兼容；需在预注册件里明确「截断时最后一轮未完成域的 null 计为 structural missing 并入 unknown 格」，而非当作有效 null。

**②工件驻留分级 ✅（Confidence 高）**
- DVC 官方文档（已读全文）：「This metadata can be put in Git in lieu of large files」——**指针/元数据入 Git、大件外置、`dvc add` 自动更新 .gitignore**。这是业界最成熟的「代码入库+数据外化+元数据双写」范式，直接映射为本仓「prereg-matrix/decision-record（小、需审计轨）入库提交 + delta.json（大、可再生）走机器本地通道 + gitignore 白名单行」。
- lakeFS 官方博客（已读全文）：commit hash 是 source of truth，下游工具记录**引用**而非复制数据——本仓 decision-record 里应记 delta.json 的路径+指纹（语料指纹断言已有），而非把数据件本身入库。
- 备选 B「工件全机器本地」的缺陷：预注册件（T1 票序要求 commit 先于读数）若不入库，就失去不可变审计轨——DVC/lakeFS 双源都把「版本化审计」列为入库元数据的核心收益，且本仓 D-001 完成判据本身是「registry 注记变更+决策记录落盘」，全本地会使完成判据不可验证。

**③Boy-scout 同面封闭 ✅（Confidence 高）**
- Code with Jason（已读全文）：Boy-scout 隐含范围是「**campsite 级 = 你的 feature 途经的营地**」，park 级清理是需要团队立项的项目；混合 feature 与 refactor 的 PR「更难 review、无法单独回滚」——推荐**完全独立的 PR/commit**（Kent Beck 式：先重构后改动，或干脆后置）。
- Schneide 博客（已读全文）：实践中用 `BSR:` 前缀独立 commit 标记无关清理，review 时可 cherry-pick 或由 reviewer 裁量——印证「触到才修+独立 commit」可行；评论区亦指出跨文件顺手修会污染 commit 原子性评价。
- dev.to/Reddit/Community 多源一致：「never mix behavior changes with cleanups」「cleanup 限于你正在工作的文件」（Accesto：*the campground, not an entire forest*）。
- **映射到包 A**：「runner 触碰面」= 本轮 diff 实际改动的文件/函数（argv 序列化重复、kill-timer、fakeSink、marked 遮蔽、isVerticalEntry 三法并存——这五个都在 runner 同面）；empty-endpoint/a03/a06/a08/engine coalesce 属 park 级，留清障轮正确。操作化定义建议写死为：**「同面 = 本轮改动 hunk 所在文件内的、与改动函数有直接调用/定义邻接关系的 smell；跨文件即使同目录也不算同面」**——比「按文件」更严、比「按 diff-hunk 邻接」更可执行，且与三源（campsite 隐含范围 + 独立 commit 纪律 + 文件级限制）都相容。

**④截断处置：分层应对而非一刀切（Confidence 高）**
- Catalog of Bias（牛津 CEBM，已读全文）：因无效/资源原因早停（对应配额耗尽）**本身不引入偏倚**（"bias is unlikely to be introduced by stopping"），偏倚来自**停止机制与结果相关**。关键推论：配额耗尽若**与域无关**（轮询保证），已格数据可进判读（truncation-aware）；若**与域相关**（某域被排后），其 null 是 MNAR/结构性缺失，必须降格或装 INCONCLUSIVE 旗标。
- Rubin 分类框架（van Buuren 教材+Tang 2018 双源）：MNAR 需对缺失机制建模才可识别——evidence-only 轮不可能合法建模 ⇒ 排后域的数据只能显式标记不可用。
- 因此包 A①（轮询保 null 均布）正是 A④ 的前置条件：**调度序选中立轮询后，截断即近似 MCAR/MAR，已完成格保留进判读 + 四字段记录加一行 truncation 注记（记录截断时各域完成格数）**；仅当覆盖闸（nPaired≥70%、unknown≤30%）本身因截断不达标时，走既有的 INCONCLUSIVE hold——无需新增第五出口。

### 3) 对比矩阵

| 项 | 轮询交错（包A①） | 优先级序（备选B方向） | 原序（现状） |
|---|---|---|---|
| 截断代表性 | 四域近似均布，null 近 MAR | 无先验时=隐式未注册决策 | 语料原序=某域系统性排后→MNAR |
| 预注册相容性 | 高（无需引入新自由度） | 低（优先级需先验来源，无法注册） | 高但偏倚风险大 |
| 实现成本 | 低（runner 已 per-entry 交错） | 高（需注册预测特征） | 零 |
| 业界先例 | SRR/DRR 公平排队、CI 轮询调度 | 仅当有历史点击/效果数据（KDD'18 GRE） | 无文献支持 |

| 项 | 决策件入库（包A②） | 全机器本地（备选B） |
|---|---|---|
| 审计轨 | git 版本化，T1 可验证 commit 先于读数 | 无法证明预注册时序 |
| 业界映射 | DVC 元数据入 Git / lakeFS commit 指针 | 无主流先例（可再生件才外置） |
| 完成判据 | registry 注记变更可核查 | 判据悬空 |

| 项 | 同面=hunk 邻接（建议） | 同面=整文件 | 同面=同目录 |
|---|---|---|---|
| Boy-scout 原旨契合 | 最高（campsite=途经地） | 偏宽（风险：顺手改不相干函数） | park 级越界 |
| Review 争议风险 | 最低（独立 commit 可过滤） | 中 | 高（scope creep） |

### 4) 完整来源清单

1. Stratified Round Robin (SIGCOMM 2003 全文 PDF) — https://conferences2.sigcomm.org/sigcomm/2003/papers/p239-ramabhadran.pdf — Official — 分层轮询公平界 O(1)，支撑①
2. 同文期刊版 IEEE/ACM ToN 2006 — https://dl.acm.org/doi/10.1109/TNET.2006.886287 — Official（摘要级）— 交叉验证①
3. 受限预算实验调度（KDD'18，GRE，摘要+Tavily 佐证）— https://dl.acm.org/doi/10.1145/3219819.3219878 — Official — 优先级序仅在有用预测特征时胜出，支撑①
4. DVC 官方文档 Versioning Data and Models — https://doc.dvc.org/example-scenarios/versioning-data-and-models — Official — 元数据入 Git/大件外置，支撑②
5. lakeFS×MLflow 官方博客（2025-06-26）— https://lakefs.io/blog/git-like-data-versioning-meets-mlops-lakefs-with-mlflow-datachain-neptune-quilt/ — Official — commit hash 即 source of truth，支撑②
6. dev.to DVC+MLflow 实践（2025-02-01）— https://dev.to/aws-builders/ml-done-right-versioning-datasets-and-models-with-dvc-mlflow-4p3f — Community — `.dvc`+gitignore 双写惯例实证，支撑②
7. Code with Jason: Why the Boy Scout Rule is insufficient (2018-12-17) — https://www.codewithjason.com/boy-scout-rule-insufficient — Criticism — campsite/park 二分+独立 PR 纪律，支撑③
8. Schneide Blog: boy scout rule and git in practice (2022-01-13) — https://schneide.blog/2022/01/13/the-boy-scout-rule-and-git-in-practice — Community — BSR: 前缀独立 commit 先例，支撑③
9. QASkills: CI Flaky Test Auto Quarantine Workflow (2026-08-07，全文) — https://qaskills.sh/blog/ci-flaky-test-auto-quarantine-workflow — Currency — shadow lane/隔离不阻塞主信号的旁证，支撑①
10. Catalog of Bias: Early Stopping Bias — https://catalogofbias.org/biases/early-stopping-bias — Official — 操作性早停≠偏倚、与结果相关才偏倚，支撑④
11. van Buuren《Flexible Imputation》MCAR/MAR/MNAR 章 — https://stefvanbuuren.name/fimd/sec-MCAR.html — Official — Rubin 框架，支撑④
12. Tang 2018 非可忽略缺失统计推断 — https://www.tandfonline.com/doi/full/10.1080/24754269.2018.1522481 — Official — MNAR 需建模缺失机制，支撑④
13. Reddit r/programming: Why the Boy Scout Rule Is Insufficient — https://www.reddit.com/r/programming/comments/a72807/why_the_boy_scout_rule_is_insufficient — Community — 独立 PR 共识，支撑③

### 5) 信息缺口

- KDD'18 GRE 论文全文被 ACM 403 拦截，「贪婪序需预测先验才优于随机序」的精确实验条件仅由摘要+SIGCOMM 全文类比+Tavily 摘要三方拼合，未读到原文 Fig 对比表；对结论方向无影响（包 A 本就不选贪婪序），但若 T1 预注册时需引用精确数字，建议走 arXiv 镜像补读。
- lakeFS 官方 how-it-works 文档页 404，驻留分级仅由官方博客+DVC 官方文档双源支撑（已满足双源门槛）。
- 未找到与「per-domain 副列 + 2-of-4 否决闸」同构的公开先例——该设计是本仓自创，业界只能提供原则性支持（公平性/MAR），无法提供直接同构验证；建议在 ADR-0086 中如实记为仓内首创设计而非业界移植。

继续此会话，运行：atomcode -p "…" --resume 1734ad11-25bc-42af-a84b-ae67dbeaeef0
