# ADR-0029: Architecture Grill Round 26 — LLM-as-judge 人工标注校准 + eval 运行预算守卫

## Status
Accepted — 2026-08-27 (grill r26, Q1-Q7 全部记定)

## Context
ADR-0027 D2 定了 judge 通道（本地 DeepSeek、跨家族、fail-open、记 0 不 crash）以及「κ ≥ 0.6 才能启用」的硬约束，但校准流程本身从未落地——judge 一直处于「未校准报告」状态（handoff r66 显式遗留第一项）。业界（Galileo/FutureAGI/LangChain/Arize 2026 交叉验证）将 LLM-as-judge 人工校准视为必装基座：不校准的 judge 分数「内部自洽、外部无意义」。同时 r66 遗留两件低风险伴随项：eval 超时+CI 路径触发（业界「CI eval >15min 工程师开始跳过」红线）、删 `--write-baseline` 别名（handoff「期一轮」承诺到期）。

## Decision

- **D1 校准集独立 holdout（Q2: A）**：新建 `packages/store/src/eval/calibration-cases.ts`（冻结 TS fixture，与 `golden-cases.ts` 物理分离、独立 schema `anysearch/calibration-set@1` + 独立 fingerprint）。30–50 条人工标注样本从真实 judge 样本流（retrieve 阶段 query+title+snippet）分层抽样另写，覆盖六组 failure mode + 负例；负例偏多分配（arXiv 2511.21140 自适应公式，测 specificity）。**拒绝**从 golden 集抽样（pigeonhole：校准集=测试集的自认可回路，Braintrust holdout / Twine second holdout golden set）。
- **D2 κ 门禁 = percentile bootstrap CI 下界 ≥ 0.6（Q3: A）**：Cohen's κ（2 raters：人 vs judge）+ 5000 次 percentile bootstrap，门禁取 CI 下界；点估计陪同报告但不作判据（n=30–50 时 CI 宽可达 ~0.4，BMC 2016 证明 asymptotic CI 不可用）。报告双报 raw agreement + Gwet's AC1（防 kappa paradox，正例偏多常态）并注明 annotator 数（单人标注 = 「judge vs 单个人」，诚实限制）。exit 契约：0 = 达标可启用；1 = 未达 CI 下界（人审信号，非 ship-gate 阻断，延续 ADR-0027 D7 judge fail-open 域）。
- **D3 校准产物形态（Q4: A）**：冻结校准集 = TS fixture（类型安全、编译器强制同步，延续 ADR-0027 D3「拒绝 JSON 失类型」对 golden 的同款理由）；judge 运行产物 = JSON/JSONL 报告走 `.ship-gate/` 先例。**明确不并入** `golden-cases.ts`：行为 spec 与标注数据生命周期不同（Langfuse/LangSmith/Braintrust 均分开版本化），并集会让标注改动误冲刷 gate 指纹。
- **D4 重校准触发器 + 快照六元组（Q5: A）**：触发器 = 月度例行 + rubric 变更锁旧集重抽样（FutureAGI「lock rubric and resample」）+ judge 模型/厂商版本变更即时复测（Galileo：provider 静默更新是隐藏漂移源）。快照钉死六元组：`rubricHash + judgeVersion + datasetFingerprint + annotator + annotatedAt + κ 决策（值+CI 下界）`，进 git 版本化（tianpan.co「two clocks」/opentrain「judge version pinned」）。**不做**在线漂移监控（无生产流量，Deepchecks/Galileo 的分布变平告警本地无从挂起，YAGNI）。
- **D5 eval 运行预算守卫 + CI 路径触发（Q6: A 伴随项 a，正式决策）**：①本地 eval/--calibrate 挂硬超时（aloknecessary 15min 红线，FutureAGI「>10min 即 merge and apologize」），超时即 exit 非零；② ship-gate.yml 的 eval job 加 `paths:` 过滤——仅 packages/store/**、scripts/eval-judge.mjs 及相关 eval 路径变更才触发（Galtea 三触发路径：model 配置/prompt/检索配置）。明确重申：ADR-0027 D2「judge 不进 gate」不被本决策侵蚀——预算守卫保护的是确定性 eval 链，不是给 LLM 开门。
- **D6 显式拒绝项（ponytail 边界，Q6: A 护栏 + 惯例）**：①**decay(G019) gate 本轮拒收**——衰减/失效/TTL 三语义未定（Zep bi-temporal invalidate-not-delete vs Mem0 retrieval-time rerank 分歧未收敛），学术批评未消化（EMem arXiv 2602.11243：简单 baseline 胜复杂结构），需独立研究轮；归入「while-you're-at-it」反模式。②1–5 Likert 升级（Rating Roulette：judge 在 Likert 上自一致性「几乎任意」；Berkeley arXiv 2606.19544：exact-match 高估 33–41pp）。③四厂商托管 UI 照搬（LangSmith Align 等是流程方法论的托管化，本地零后端自建即合）。④alias 删除不进 Decision（见 Implementation Plan step 7：chore 身份，兑现 handoff r66「期一轮」承诺，SemVer 废弃窗口已满，Jaeger N+2/Superset 集中清除先例）。

## Consequences

### 正面
- judge 首次拥有可验证的「上岗证」：κ CI 下界达标前，报告通道继续可用但明确标记未校准；达标后月度+变更触发复测，尺自身被钉死。
- eval 管道获得业界标准的运行时纪律（超时+路径触发），与校准落地后 judge 的月度复测节奏因果耦合——校准创造了预算守卫的需求。
- 校准集与 gate 集物理分离，杜绝 judge 被调优成「能过 gate 的尺子」。

### 代价与边界
- 一次性人力：30–50 条人工标注（1–2 人半天到一天）；单人标注的统计局限靠 CI 下界门禁对冲，报告注明。
- 校准样本需从真实 retrieve 输出抽样——依赖积累的真实查询样本流；样本不足时按组渐进补齐。
- --calibrate 50-run 本就 ~74s，超时阈值须定在基线之上（建议 600s 硬上限，远高于 74s，留出增长空间）。

## Implementation Plan
1. `packages/store/src/eval/calibration-cases.ts`：CalibrationCase 类型 + calibrationSet 对象（schema/fingerprint/rubric 对象/annotators 字段），条目含 humanRelevant + note；初始落 ≥30 条，从真实 judge 样本流分层抽样。
2. `scripts/eval-calibrate.mjs`：join judge report × 人工标注 → Cohen's κ + Gwet AC1 + raw agreement + percentile bootstrap CI（5000 次）→ exit 0/1 + 写 `.ship-gate/calibration-report.json`（含六元组快照）。零依赖纯函数，风格对齐 gate.ts。
3. `scripts/eval-judge.mjs`：report schema 补 `rubricHash + judgeVersion` 字段（D4 快照前置）。
4. 本地超时守卫：eval CLI 入口加硬超时（默认 600s，env 可调），超时 exit 非零。
5. `.github/workflows/ship-gate.yml`：eval job 加 `paths:` 过滤。
6. 测试：calibrate 表驱动单测（合成 2×2 表：全一致 κ=1、随机 κ≈0、全不一致 κ<0、bootstrap CI 含真值）；超时守卫单测（慢桩 → 非零退出）。
7. **chore（不进 Decision）**：删 `cli.ts` 的 `--write-baseline` 别名分支（独立 refactor commit）+ CHANGELOG `Removed` 条目——兑现 handoff r66「期一轮」。
8. AGENTS.md + CONTEXT.md 落 scope 纪律（Q6 附加）：AGENTS.md 一句话常驻原则；CONTEXT.md 术语条目背书；审查机制维持 audit-checklist.md。

## Acceptance
- [ ] calibration-cases.ts 落盘 ≥30 条（分层覆盖 + 负例偏多），独立 schema + fingerprint，编译期类型与 golden 同步演进。
- [ ] eval-calibrate.mjs 三合成场景单测全过；真实标注数据跑通后输出 κ/AC1/CI 下界/raw agreement + 六元组快照；未达标 exit 1 且不阻断 ship-gate。
- [ ] eval-judge.mjs report 补 rubricHash + judgeVersion；judge 报告与校准报告指纹可互相锚定。
- [ ] 硬超时生效：注入慢桩验证 exit≠0；ship-gate.yml paths 过滤生效（改 docs 不触发 eval job）。
- [ ] --write-baseline 别名删除 + CHANGELOG Removed 条目；rg 全仓无残留。
- [ ] CONTEXT.md +3 术语（Calibration Holdout / Kappa CI Lower Bound / Scope Discipline），含 _Avoid_，End of Glossary 保留。
- [ ] 全绿：turbo check 6/6、ship-gate --quick PASS、CLI --help 存活。

## Research Sources
- 校准集 holdout：Braintrust holdout guide、Twine golden dataset（hidden canary + second holdout）、opentrain readiness checklist、arXiv 2511.21140（自适应分配公式 + 校准集 essential）。
- 标注形态：UIUC Rating Roulette（arXiv 2510.27106）、UC Berkeley Reliability without Validity（arXiv 2606.19544）、LangSmith annotation queues（A/B/E 二元）、Arize ClassificationTemplate、FutureAGI best practices 2026（pairwise > absolute）。
- κ 统计：BMC Med Res Methodol 2016（bootstrap CI，asymptotic 不可用）、mbrenndoerfer IAA 教程、peterbaumgartner bootstrap IRR 实证（n=100 CI 宽 0.4）、Galileo（κ+raw 双报 + Gwet AC2）、Scale AI kappa paradox。
- 快照/触发器：tianpan.co LLM-as-Judge Drift（two clocks）、opentrain judge version pinned、Galileo recalibrate-on-model-swap、FutureAGI 月度校准 + 60–90 天漂移、Deepchecks 分数分布变平信号。
- 预算守卫：aloknecessary llm-evaluation-in-production（15min 红线 + 硬超时代码）、FutureAGI eval gates in GitHub Actions（>10min merge-and-apologize，PR/nightly 双层）、Galtea CI 三触发路径、tech-insider 2026（paths 过滤 + 成本预算）。
- scope 纪律：Hivel PR 反 bundling、mesrai While-You're-At-It 反模式、Pramida Tumma AI Scope Creep、Sapegin 原子 PR 判定、K8s deprecation Rule 5a/5b/6、Jaeger #2113 N+2、Apache Superset 集中清除废弃、keep-a-changelog Removed 分类、SemVer 废弃窗口。

## Post-landing audit note (r67, 2026-08-28)

- step 7（删 `--write-baseline` 别名）随 feat commit `210f629` 一并提交，未按实施计划独立 chore commit。历史已定格，显式记录偏差（scope discipline: deviations stay explicit）；后续轮次不回溯拆 commit。
- 审计修复（同轮落地）：删 `po===1` 放行通道（退化 cohort 现在 fail）、`--judge-report` 死参数从 Usage 删除、fingerprint 补 run 时对标注子集现算 `fingerprintLive`、超时测试锁死 exit 124 + TIMEOUT 文案 + 新增非法 `EVAL_TIMEOUT_MS`（exit 2）用例、CI path 正则锚定 `.mjs$`、secret 组 #2 字面 key 改占位符。
