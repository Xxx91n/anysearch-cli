[warning] 正在以管理员权限运行 — 模型可能可以访问系统文件。
先查知识库召回，再启动三引擎广泛搜索。知识库已有部分相关材料（ADR-0069/0074、评测复现报告）。现在启动第一阶段三引擎广泛搜索。继续第二阶段补齐其余板块的搜索角度。继续第二阶段：定点深挖已锁定的高价值原文，并补两个角度的搜索。继续深挖：SRM 早停先例、lakeFS/数据冻结归档惯例、ADR 立档边界原文核验。补最后两次核验读取，然后综合输出。**Sufficiency Gate**: searches: 7（Exa×2、Tavily×2、AnySearch×3）| angles: Official / Comparative / Criticism / Currency / Community 全五类 | full reads: 6（atticusli、MSR ExP、AWS ADR、MMM prereg memo、GrowthBook SRM、PMC run-in 综述）+ 知识库召回（本仓 ADR-0069/0074、评测复现报告）| gaps: GxP 环境下「裁决脚本签名」无直接先例文（由 21 CFR Part 11/audit trail 原则外推）；A/A-test-as-instrument-probe 的“早停省配额”特例无逐字先例（由 SRM 检查时点文献外推）。

# R85 Q3 调研报告：证据生产轮/判读轮的工序心智模型

## 1) 执行摘要（Tl;dr）

**推荐票序 A（T0 哨戒 → T1 预注册落盘 commit → T2 重跑（对照层先行）→ T3 判读（脚本化）→ T4 收口）**，置信度**高**。三个争议设计点的业界判定：**「对照层先行早停」= 有成熟心智模型支撑（SRM/仪器健康检查先于读数是平台级硬惯例），但注意它不是标准先例的“省配额早停”，而是微软/GrowthBook 的“失败即隐藏效应读数”闸门——语义兼容，方向正确；「判读脚本化」= 高度符合审计敏感环境惯例（确定性计算 + 审计可重建是 Part 11/GxP 的核心要求），置信度高；「INCONCLUSIVE 不立 ADR」= **部分正确但需修正**：终局性 ADR 只记 GO/NO-GO 是对的，但 INCONCLUSIVE 必须落**决策记录**（具名触发）而非无声留 open——业界对“决定不做某决定”也要求记录其理由（AWS：Rejected ADR 要附 reason 以防重复讨论）。

## 2) 分点结论

### Q1 预注册件的字段与生效时点 —— 置信度：高

- **临床先例（最严格）**：ECTU SOP 明文规定 SAP 的冻结时点 = **数据库锁定（database lock）之前**，有正式期中分析则须在期中分析前冻结，并建议提前约 6 个月定稿；数据锁定前的修改要出**新版本 SAP**，锁定后的修改必须在统计报告中逐条 justify 并注明“after database lock”[S1]。FDA E9 落地指南同样要求 primary analysis 必须 **planned a priori**、写入 protocol 且先于试验开始 [S2]。注意临床的冻结锚点是“数据采集完成后、分析前”（database lock），不是“采集前”——采集前是 protocol，采集后分析前是 SAP。
- **实验平台先例（贴近你的场景）**：MMM 预注册 memo 模板（2026-06 版）给出现代 experiment-plan 的字段集：experiment id / 日期 / owner、**方向性可证伪假设、唯一 primary estimand、设计、power 计算（含 power-ceiling 检查）、stopping rule（预注册“禁止计划外 peeking”）、decision rule（“若 X 则 Y”三分表——包括“若区间宽到无法区分怎么办”）、sign-off**；并明文：启动后的一切变更 = amendment，须 dated + justified + logged，never silently applied [S3]。社区模板同构：hypothesis / primary metric / guardrails / sample size / decision framework，launch 前锁定 [S4]。
- **对你的 D-002 矩阵**：字段结构（覆盖闸/方向轴/负向硬闸/四字段双读/功效注记/三分出口）与业界模板**逐项同构**——decision-rule 三分表尤其精确对应你的 GO/NO-GO/INCONCLUSIVE；“若无法区分”对应你的 INCONCLUSIVE 出口，业界要求它**预注册时就写明**，而你已立法“INCONCLUSIVE 必附具名下触发”——方向一致且比多数社区模板更严。
- **commit 时点**：临床的“finalised and approved **before** database lock”+ 版本化改 journal 化，直接映射到你的 T1（预注册件 commit 先于 T2 读数）——这是最严格先例（GxP）的做法，你的票序 A 把 T1 排在 T2 前正是对齐。备选 B（预注册与重跑并票）在临床语义下等价于“边采数据边写 SAP”，被 ECTU SOP 4.7 明文禁止类比的时序——**B 确实违硬约束**。

### Q2 对照层先行 / 仪器健康探针 —— 置信度：高（做法成熟）/ 中（“早停省配额”这个动机是新组合）

- **先于读数的健康检查是平台硬惯例**：微软 ExP 官方：**every A/B test must first pass SRM test before being analyzed for its effects**——SRM 检查在 ship-decision 分析**开始前**跑，触发即“hide the treatment-effect readout and investigate” [S5][S6]。GrowthBook 对每个实验**自动**跑 SRM/balance 检查，Health Tab 单独存在 [S7]。Atticus Li 总结的最佳实践清单：“**Show the check before treatment effects, not beside them**”“Run A/A tests to detect shared allocation or telemetry failures”“Record stop/investigate/salvage/rerun rules **before launch**” [S8]。Convert 建议启动后 48 小时内先做首次 SRM 检查、在任何转化数据有意义之前 [S9]。DoorDash 有实验健康检查告警系统，失衡 24 小时内通知 [S10]。
- **临床对应物**：run-in period——入组后、随机化前的统一处理期，用于剔除不合规/数据采集失败者，先验证流程再进入正式对照 [S11][S12]。
- **评估你的设计**：「对照层先行作仪器健康探针」的心智模型完全成立——你的对照层独立闸（non-tied≥4/16 或 unknown>8/16 → 整轮 INCONCLUSIVE）正是 SRM 检查的配对版。**一个精确性修正**：业界先例的语义是“探针失败→**该读数不可信**（早停、修复后重跑）”，而不是“探针通过→继续读”之外还兼省配额的工具。你的双重动机（健康闸 + 早停省配额）在工程上是 SRM-first + 免费副产物，不违先例；但 runner 改动（control 前置排序位）应写成**仪器语义**而非**配额语义**——否则未来有人质疑“为了省配额改变采集顺序是否引入次序偏差”。四趟交错 isoOn/isoOff 结构不变、只是条目调度顺序前置，扰动面是执行顺序而非分组，先例（A/A test 先于 A/B 上线验证 assignment 通道 [S7]）支持这个排序。

### Q3 数据冻结与工件归档 —— 置信度：高

- **冻结 = 不可变快照 + 指针**：lakeFS 把数据湖变成 versioned immutable timeline，zero-copy branch、atomic commit、tag for golden datasets，“tamper-proof history for comparisons, audits and rollbacks” [S13][S14]。DVC 官方迁移文：**every commit is immutable; pin one and your inputs can't drift**，`git_sha` 把数据版本绑回产生它的代码 [S15]。lakeFS 文档明文：对象存储**immutable 使用，anything uploaded is never changed or overridden**——删除只经显式 GC [S14]。
- **临床对应**：Warwick SOP——data snapshot 明确命名+存储以供“**reconstruction of analyses and timelines**”的 audit trail；final dataset 有防编辑防删除保护（restricted access）；解锁须走 T47 表单+QA 审批，改动全部留痕 [S16]。
- **评估你的设计**：语料冻结 fingerprint 断言（7ac0a48e）= 业界“pin commit + fingerprint 绑定输入”的标准做法；**存量降格件归档不删** = lakeFS immutability + 临床 audit-trail reconstruction 的一致要求——归档（rename/move + 保留）优于覆盖，你的选择正确。「重跑覆盖旧件」的反面即业界共识：覆盖会毁掉 reconstruct timeline 的能力，append-mostly 或 archive-rename 均可，关键是**旧件可达且不可被新件顶替**。

### Q4 判读工序机器化 —— 置信度：中高（原则有直接先例，“签名”环节是外推）

- **确定性计算 + 审计可重建是 GxP 硬要求**：21 CFR Part 11 及 GxP 数据完整性文献：audit trail 必须 computer generated、secure、always on、**no user can modify audit trail events**；UCLA 验证模板要求 audit log 记录“user / reason / previous value / new value / date-time”——即每次状态变更可重建 [S17][S18]。「机器算不人手算」恰好把“人手算”这个最大不可审计环节消掉：人算无 audit trail、无 deterministic reproduction。
- **临床读出语义**：SAP 定好分析、统计报告须 justify 一切偏离 [S1]——对应你的“确定性脚本按矩阵查表出裁决 + decision-record.md 落四字段”。脚本= SAP 的机械化执行，输出 = 统计报告的记录。
- **注意**：合规先例并不豁免**人的问责**——Part 11 的核心之一是 electronic signature / accountable individuals [S17]。所以脚本出裁决后，decision record 仍应留**人签认字段**（谁验收了这次判读），纯脚本无签认在 GxP 语义下不闭环。你已有“完成=registry 注记变更+决策记录落盘”，建议 decision-record 加一行 operator/verified-by。

### Q5 收口工序与 ADR 边界 —— 置信度：中高

- **ADR 立档边界**：AWS 明文 ADR 覆盖“every architecturally significant decision”；**Rejected 的 ADR 也要记录 reason 以防止未来重复讨论** [S19]；Microsoft Learn：ADR 是 **append-only log**，decision changed 就写新纪录 supersede，“A decision that's made but never recorded will likely be forgotten, leading to repeated debates” [S20]；ozimmer 批评清单：不记 alternatives 的不是 decision record [S21]。
- **推论到你的三分出口**：
  - **GO / NO-GO 立 ADR** ✓——两者都是架构上显著的终局决策（加权实施 vs 核销），且 NO-GO 附判词正对应“rejected 也要写 reason”。
  - **INCONCLUSIVE 不立 ADR**——**大体正确**：它不是架构决策，没有产生“选择了一个方案”的记录义务（ozimmer：没有选择就没有 decision record [S21]）。但业界边界要求它**不可静默**：AWS 对 rejected 要留 reason 防重复讨论，MMM memo 要求 amendment 全部 logged [S3]。你的“留 open + 具名触发”正是这个语义——**留 open 必须是 registry 上的显式状态迁移 + 具名触发条件，而非默认遗忘**。建议在 registry 中把 INCONCLUSIVE 视为**显式状态**（hold + trigger），下轮启动时该触发条件成为入口检查项——这就是“哨戒续班”的机器可执行形态。
  - **go/kill/hold 记录义务**：go→ADR + 挂账转具名跟进票（你已有）；kill→核销附判词（对应 AWS rejected+reason）；hold→registry 状态 + 具名触发 + 功效注记（你的 n 下 |Δ|≳0.4 分辨限就是触发条件的量化锚）。
- **哨戒续班**：业界对应是持续性数据质量监控（DoorDash 健康告警 [S10]、GrowthBook 每次 analysis 自动跑 [S7]）——T0 哨卫项作为长期班次而非一次性任务，与先例一致。

## 3) 对比矩阵：三个设计点

| 设计点 | 业界先例 | 判定 | 风险/修正 |
|---|---|---|---|
| 对照层先行早停 | SRM check before effect readout（微软 ExP 硬门 [S5][S6]；GrowthBook 自动化 [S7]）；run-in period [S11] | **成立**，方向正确 | 叙事须写“仪器健康语义”而非“省配额语义”，避免次序偏差质疑；早停规则须在预注册件（T1）里写明，不可 T2 现场决定 |
| 判读脚本化 | GxP audit trail / deterministic operational checks [S17][S18]；SAP 预注册分析机械化 [S1] | **成立**，比人读数更合规 | 脚本+矩阵+输入指纹须在 T1 commit（先于读数），否则脚本本身可被指“事后写”；decision record 加人签认字段 |
| INCONCLUSIVE 不立 ADR | AWS：rejected 也记 reason 防重复讨论 [S19]；ozimmer：无选择无 decision record [S21] | **大体正确**，边界正确 | 不可静默：registry 显式状态（hold+具名触发）替代 ADR；触发条件要量化锚（你的 \|Δ\|≳0.4 功效注记可充当） |

## 4) 票序推荐与理由

**推荐 A，三处加固**：

1. **A 优于 B/C/D**：B（预注册与重跑并票）直接违反临床 SAP 时序先例（SAP finalised before database lock / before interim analysis [S1]，FDA：primary analysis planned a priori [S2]）——这不是风格选择而是有效性硬约束；并票会让“预注册先于读数”失去 commit 可证性。
2. **T1 加固**：预注册件（prereg-matrix.md）除全矩阵外，**写入早停规则本身**（“对照层 fail→早停”这条）——业界要求 stop/investigate/salvage/rerun rules 先于 launch 记录 [S8][S3]。若早停规则只存在于 T2 的 runner 改动说明，它就是“未注册的中途规则”。
3. **T2 加固**：runner 的 control 前置排序位改动 commit 信息里注明“instrument-health ordering, no sampling-protocol change”——把动机钉在仪器语义上。
4. **T4 加固**：INCONCLUSIVE 出口的“具名触发”建议带量化锚（功效注记的 |Δ|≳0.4 + n 条件），使下轮票可直接以触发条件满足与否作 go/no-go 入口检查——这是 hold 状态机的机器可执行形态。

## 5) 完整来源清单

| # | 标题 | URL | 角度 | 贡献 |
|---|---|---|---|---|
| S1 | ECTU SOP ST_04 Statistical Analysis Plans v8.0（Edinburgh） | usher.ed.ac.uk/.../ECTU_SOP_ST_04...pdf | Official | SAP 冻结时点=database lock 前；版本化；偏离 justify |
| S2 | FDA Guidance: Statistical Principles for Clinical Trials（E9 落地） | fda.gov/media/71336/download | Official | primary analysis planned a priori |
| S3 | MMM Framework — Experiment Pre-Registration Memo | redam94.github.io/mmm-framework/artifacts/preregistration-memo.html | Official/模板 | 预注册字段全清单；decision rule 三分表；amendment 纪律 |
| S4 | Experiment Pre-Registration 模板生态 | experimenthq.io / pmread.org（搜索验证） | Community | 现代实验模板同构性 |
| S5 | Diagnosing Sample Ratio Mismatch in A/B Testing（Microsoft ExP） | microsoft.com/en-us/research/articles/...（**已全文读**） | Official | every A/B test must first pass SRM before analyzed |
| S6 | SRM: bad randomization ruins everything（Atticus Li, 2026-04/07） | atticusli.com/...（**已全文读**） | Comparative/Best practice | check before effects, not beside；stop rules before launch |
| S7 | GrowthBook SRM 五型诊断 | growthbook.io/blog/sample-ratio-mismatch（**已全文读**） | Official | A/A 先行验证 assignment；自动 SRM 检查 |
| S8 | Convert.com SRM 指南 | convert.com/blog/a-b-testing/sample-ratio-mismatch-srm-guide | Comparative | 48h 内首检时点；平台横评（Optimizely/Statsig/Split） |
| S9 | DoorDash 实验 SRM 告警 | careersatdoordash.com/blog/... | Community/Industry | 24h 健康告警系统 |
| S10 | Run-in periods in RCTs（Laursen 2019, PMC6377048，**tavily_extract 全文**） | pmc.ncbi.nlm.nih.gov/articles/PMC6377048/ | Official/Academic | 随机化前统一处理期的临床先例 |
| S11 | lakeFS internals / glossary | docs.lakefs.io/concepts/internals | Official | immutable 对象存储；显式 GC 才删 |
| S12 | lakeFS: immutable timeline / zero-copy | lakefs.io/blog/bound-by-physics... | Official | tamper-proof history for audits |
| S13 | DVC→lakeFS 迁移（dvc.org 官方博客） | dvc.org/blog/migrate-dvc-to-lakefs | Official | commit immutable + git_sha 绑定 |
| S14 | Warwick SOP15 数据快照/锁定 | （S1 搜索高亮内嵌） | Official | snapshot 命名→audit reconstruction；解锁留痕 |
| S15 | FDA Part 11 guidance | fda.gov/media/75414/download | Official | audit trail/validation/e-signature 框架 |
| S16 | GxP 数据完整性 + UCLA Part 11 验证模板 | researchgo.ucla.edu/printpdf/193 | Official | audit log 字段（user/reason/prev/new/dt） |
| S17 | AWS Prescriptive Guidance: ADR process（**已全文读**） | docs.aws.amazon.com/.../adr-process.html | Official | rejected 也记 reason；immutable+supersede |
| S18 | Microsoft Learn: Maintain an ADR（搜索验证） | learn.microsoft.com/.../architecture-decision-record | Official | append-only；未记录的决定会被遗忘 |
| S19 | Ten Common Mistakes in ADRs（ozimmer, 2026-09） | ozimmer.ch/practices/2026/09/12/ADRMistakes.html | Criticism | 无 alternatives 记录 ≠ decision record |
| S20 | 知识库召回：本仓评测复现报告（date-freeze/provenance 目录惯例） | ctx_search（batch 自身报告） | 内部 | 冻结窗口复现、runs/<ts>-<sha> 归档先例已在仓内立法 |

## 6) 信息缺口

1. **“判读脚本输出签名”**无逐字先例文——Part 11 讲 e-signature 和 audit trail，但“脚本输出 + hash 签名”的组合是本仓 ADR-0074 式治理创新，属外推而非引用。
2. **A/A-test 作为省配额早停探针**：A/A 先行有先例（GrowthBook/微软），但“先跑 off 对照以省配额”这个具体动机是新的——建议预注册件里如实写“探针语义 + 配额副产物”，不宣称业界标配。
3. 搜索摘要中的 ECTU/FDA PDF 均为官方一手文件的高亮片段（非全文抓取），字段结论以多源交叉（SOP + 模板 + 落地指南）互相印证，单源细节（如“提前 6 个月建议”）引用时保留原文条件。

继续此会话，运行：atomcode -p "…" --resume 651936d8-feba-4c56-b1b7-08ebeaaa1cc2
