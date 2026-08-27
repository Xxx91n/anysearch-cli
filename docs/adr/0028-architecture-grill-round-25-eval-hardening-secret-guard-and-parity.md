# ADR-0028: Architecture Grill Round 25 — eval 硬化三连：margin 整数化 / 检索 rank gate / read 侧 secret 防线 + 难度分层 + task parity

## Status

Accepted — 2026-08-27 (grill r25, Q1–Q6 全部记定，均为 A 选项)

## Context

round63 atomcode 外部审计在 ADR-0027 eval harness 上点出 6 个缺口，round64 已修 ①（gate mutation 自证）+ ⑥（temporal 组 case 缺失），本 round 处理剩余：② margin=0 且基线满分时连续容差参数无取值空间（supersession 分母 n=11，单 op 抖动 9.1pp）；③ 检索 op 无二值以上的排序分辨率（stale_topk 靠 includes/excludes 粗表达）；④ 写路径 `SECRET_RE` 只挂 `adjudicateMemory` 一处，`saveResults`/`saveAnchor`/`append` 三入口无检查，retrieve 侧零过滤，sc_* 只测写路径；⑤ golden set 无难度分层、无 unanswerable 负例，`ss_pref_change`/`ss_api_docs_version`/`ss_user_then_provider` 三条 query 与存储 title 逐字相同（mem0 点名的 query-style 过拟合）；⑥（本 round 编号 Q5）`turbo run check` 名义 6 包实际 3 包（kernel/retriever/store 缺 check task）。另：Q2 审计流程短缺四项（安全评审轴 / diff 规模纪律 / 评审指标 / 冲突仲裁者）。

## Decision

- **D1 margin 整数化 + 校准地板 + WARN 三态（Q1: A）**：gate 语义从「baseline − 连续 margin」改为「整数 op 允许数」——baseline JSON 的 margin 字段存整数 allowance（如 supersession 允许挂 0/11），地板 = `(expected − k)/expected`。新增 `--calibrate` 模式跑 50 次取每指标观测最小值再减 1 op 作硬地板写回 baseline（CI 永不改写，延续 ADR-0027 D9）。报告层打印 per-metric MDE 警告与 Wilson CI；当 `margin < MDE` 时该指标 verdict 从 FAIL 降为 WARN（贴 PR 不阻断，llm-evalgate 模式）。**不上 Holm/BH 多重比较校正**——TFX/llm-evalgate/statgate/sigeval 全部 per-metric 独立阈值零校正；预注册指标数写入报告即可（aievals.co 口径）。
- **D2 检索 rank 断言（Q2: A）**：search op 新增 `expectRankOf: { title, maxRank }` 整数断言（per-case，进 gate）；报告层同时输出 rank-of-relevant 与换算 MRR 仅供观察。**不上 qrels/分级 nDCG**——单相关文档场景 MRR=MAP（arXiv 2510.21440），rank 整数已含全部排序信号；n=20 的聚合 MRR 噪声 ~19pp 不进 gate（llm-evalgate MDE 表）。
- **D3 secret 四层同补（Q3: A）**：① `SECRET_RE` 提取为共享 `containsSecret`（加 `i` 标志 + JSON 转义还原 + 空白折叠 + 长度上限的 base64 候选解码），挂到全部 4 个写入口（adjudicateMemory/saveResults/saveAnchor/append）；② `searchMemory`/`searchMemoryMulti` 出口 filter 一次；③ golden set 加 8 条负例切片（literal / case-mixed / AWS AKIA / PEM 小写 / base64 / JSON 转义 / 空白拼接 / 全角同形），其中全角同形与截断两片标注「已知盲区」与同 GitHub push protection("Some")口径；④ runner 加 `seed` op 直插 DB 支持「写已绕过」前提。零新依赖。
- **D4 难度分层 + unanswerable + paraphrase（Q4: A）**：case 新增 `difficulty: core|hard|adversarial` 元数据（按层报 pass rate，不进 gate）；加 4 条 unanswerable 负例（near-answer distractor，判分 = `expectEmpty`），并配双向 gate（answerable 侧假拒率指标，防全拒耍赖，qaskills 模式）；`ss_pref_change` 等 3 条过拟合 case 各加 1 个轻 paraphrase 变体（语序/词形级，**必须配正向断言**，galtea Variant 模式）；重 paraphrase 只进报告不进 gate（FTS5 词面检索下真失败，留待检索升级）。n: 20 → ~28,fingerprint 自动翻转即重校准触发（ADR-0027 D8/D9 既有机制）。
- **D5 check task parity（Q5: A）**：kernel/retriever/store 三包各加 `"check": "tsc --noEmit"`(6/6)；新增零依赖 `scripts/task-parity.mjs`（读 turbo.json + 各 package.json，通用任务 check/test 每包必实现，豁免集显式为空），挂进 ship-gate step 1。turbo skip-if-absent 是官方 feature(PR #1226 拒改），业界答案是「契约在管道、实现靠门禁」（Rush 默认严格 + ignoreMissingScript 逃生阀的等价物）。
- **D6 审计章程（Q6: A）**：新建 `docs/agents/audit-checklist.md`（≤60 行）固化四项：① 安全评审轴独立走 code-vulnscan/perseus，不被 ponytail review 顺带；② diff >500 行或 >5 文件自动拆轮；③ 每轮审计产出 「发现 N / 修复 M / 遗留 K」三元组写进 handoff；④ 冲突仲裁序 = ADR > AGENTS.md > skill 实现现状 > 个人偏好，冲突即停手问用户。
- **D7 显式拒绝项（ponytail 边界）**：Holm/BH 校正（family=2~3 预注册指标，evalci 所示场景不适用）；qrels/分级 nDCG 进 gate；Presidio 级 DLP 库；检索层换 embedding（重 paraphrase 失败因而只报告）；Rush/Nx 迁移；judge 进 gate（重申 ADR-0027 D2）。

## Consequences

### 正面

margin 死机制被整数允许数消灭，容差带最小粒度 = 1 op（9.1pp），与 n=11 的分辨率自洽；stale_topk 从粗断言升级为可读 rank 契约；secret 防线的真实盲区（三无检查写入口）被封死，且 mem0 系「retrievable by design」立场之上加了 retrieve 兜底；golden set 开始测「用户能否检索到」而非「FTS5 能否跑」;CI 覆盖假 6 包真 3 包漂移有门禁；审计流程可复制、可被下次外部审计对账。

### 代价与边界

base64/同形/截断变体检测是尽力而为（GitHub 官方也只承诺 "Some")，已文档化；《--calibrate》50 次跑首次执行前先检查 runtime 预算（幂等、可中断、可续）；task-parity 豁免集为空意味着新包未实现 check/test 时 ship-gate 直接红——这是特性。

## Implementation Plan

1. baseline JSON margin 字段类型改为整数 allowance + gate.ts 语义切换；新增 `--calibrate` 模式。
2. 报告层加 MDE 表 + Wilson CI + family size;`margin < MDE` → WARN 三态。
3. `containsSecret` 共享模块 + 4 写入口 + 2 检索出口接线；runner 加 `seed` op。
4. golden-cases:+8 secret 负例切片、+4 unanswerable(near-answer distractor)、+3 轻 paraphrase 变体、全量 `difficulty` 标注；runner 支持 `expectEmpty`/`expectRankOf`;answerable 假拒率进报告。
5. kernel/retriever/store 补 check script;`scripts/task-parity.mjs` + ship-gate step 1 挂载。
6. `docs/agents/audit-checklist.md` 新建。
7. CONTEXT.md +5 术语（End of Glossary 保留）。
8. 全量验收：store 14 suite 绿 + ship-gate FULL GREEN + CLI 存活。

## Acceptance

- [ ] gate 整数 allowance 语义生效；`--calibrate` 写出应季地板；报告含 MDE/Wilson/family-size；构造 margin<MDE 场景验证 WARN 态。
- [ ] `expectRankOf` 断言存在且 stale_topk 组改用它；变更排序代码人为降 rank 时 gate exit 1。
- [ ] 4 写入口 + 2 检索出口均过 `containsSecret`;8 负例切片红→绿（先 seed 绕过入库再断言检索 0 命中）。
- [ ] 4 条 unanswerable 全 expectEmpty 通过；answerable 侧假拒率出现在报告；3 条轻 paraphrase 变体正向断言通过。
- [ ] `turbo run check` = 6/6;`task-parity.mjs` 挂进 ship-gate step 1；模拟缺 check 脚本的包 → ship-gate 红。
- [ ] `docs/agents/audit-checklist.md` 存在且含四轴。
- [ ] CONTEXT.md +5 术语，含 _Avoid_ 行，*End of Glossary* 保留；编译/打包/进程存活全绿。

## Research Sources

- llm-evalgate（github.com/LesterALeong/llm-evalgate）—— RegressionGate(threshold+require_significance)、power warning、WARN 不阻断、MDE(n=60)=0.145
- statgate（github.com/yashchimata/statgate）—— 非劣性 margin 语义、SHIP/BLOCK/INCONCLUSIVE 三态、"margin of zero demands proof of strict improvement"
- sigeval（nikolas-sapa）—— Wilson CI 下限 vs 阈值，stdlib-only 10 行 Wilson
- aievals.co "Multiple comparisons: Bonferroni vs BH-FDR"(2026-05-29)—— gate 轴零校正 / scorecard 轴才校正；15 指标 @α=0.05 → 54% 假阳性算术
- evalci（arXiv 2607.04429）—— correction="holm"/"fdr_bh"，多模型×多 benchmark 场景专用
- Anthropic "A statistical approach to model evaluations"(2024-11,arXiv 2411.00640)—— Recommendation #5 power analysis、配对差异检验
- FutureAGI "Statistical Significance in LLM Eval Runs"(2026-08-05)—— MDE 表（200→10pp / 500→6.6pp）
- statsforevals（Ian Arawjo）"Which Method?" —— Wilson★ / Clopper-Pearson 保守 / 配对 N<50 用 Bayesian
- R `power.prop.test` 官方文档 —— (0.9→1.0) 需 n=71/组，(0.9→0.85) 需 683/组
- NIST trec_eval（github.com/usnistgov/trec_eval）—— qrels 格式、m_ndcg.c(J&K 2002,DCG=Σgain/log2(rank+1))
- Smucker/Allan/Carterette SIGIR 2009 —— 小 topic 数检验分歧、推荐 randomization
- Carterette SIGIR 2008 —— 多 query + 浅 pool 优于少 query + 深 pool，工作量降 95%
- nlpcitations "Measuring Search Effectiveness by Hand"(2026-04)—— 20–50 query 够基线；二进制分级够 P@K/MRR
- dataaihub "Retrieval Evaluation Guide"(2026-07)—— 50–200 对；单相关→MRR，多相关→nDCG
- arXiv 2510.21440 —— "With one relevant passage, MRR equals MAP"
- mem0 docs + issue #5507(2026-06-12)—— "retrievable by design"；检索侧治理提案 closed as not planned
- LiteLLM litellm_content_filter —— post_call regex + BLOCK/MASK + prebuilt patterns
- gitleaks 官方博客/README —— regex + entropy + base64 decode + allowlist、generic rule 允许 0–20 间隙
- GitHub secret scanning supported patterns —— base64 支持仅为 "Some"(官方定标)
- ACL 2026 Findings Back-Reveal（aclanthology 2026.findings-acl.1257）—— 检索/记忆工具调用本身就是外泄通道
- OWASP LLM Top 10 2025 —— LLM02 升至 #2；数据消毒 + 限制数据源缓解口径
- hindsight.vectorize.io "10 things"(2026-07-31)—— 第 7 条 Security:"Feed it a secret/PII; check what got stored and who can read it"
- mem0 "Understanding Memory Benchmark"(2026-06-05)—— "Overfitting to query style ... probes reuse almost identical wording";noisy paraphrased probes
- LongMemEval（arXiv 2410.10813 / github.com/xiaowu0162/longmemeval）—— `_abs` 后缀、30 条 false-premise、retrieval 层跳过 abstention
- UAEval4RAG（arXiv 2412.12300,ACL 2025 Salesforce)—— 六类 unanswerable taxonomy、unanswered/acceptable ratio
- SQuAD 2.0（arXiv 1806.03822）—— 50k 对抗负例、abstain 判分、86%→66% F1
- qaskills "Testing RAG No-Answer and Abstention"(2026-07-13)—— answerable=false 结构化标志、min-coverage/max-false-refusal 双向 gate、near-answer distractor
- galtea Test Case 文档 —— Variant 字段（original/paraphrased/incorrect)
- arXiv 2509.04013(Udine,2025-09)—— 34 LLM paraphrase 后绝对分数显著下降
- turborepo 官方 configuration 文档 + PR #1226("will not be changing the default behavior")+ #6552 —— skip-if-absent 为设计行为，Transit Node 保留
- Microsoft Rush 官方文档 —— 默认严格报错 + `ignoreMissingScript` 按 phase 豁免
- Nx #19857 / pnpm #6844 / Yarn v1#6739 —— 生态对照：均静默跳过或以 feature request 形态挂起
- Bazel —— target 必须 BUILD 声明，声明=现实，结构上无漂移可能
