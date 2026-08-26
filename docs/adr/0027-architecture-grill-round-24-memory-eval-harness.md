# ADR-0027: Architecture Grill Round 24 — 记忆 Eval Harness：golden dataset + 门禁 + 本地 judge 报告通道

## Status

Accepted — 2026-08-27 (grill r24, Q1–Q7 全部记定)

## Context

记忆系统架构（MemTX 裁决 + quarantine + G019 衰减 + T0/C-prime）已站在业界 2026 年主流位置，短板不在功能，在度量和校准。之前每改 adjudication / decay / C-prime 逻辑，只能保证编译过+测试过，无法回答「记忆质量是提升了还是退化了」。业界共识（Hindsight/DeepEval/Langfuse/BuildPulse 多源交叉验证）：没有自家领域 golden dataset，任何记忆/检索改动都没有方向判断依据。本轮把现有纯函数测试升级为 golden dataset 化评测并接入 ship-gate 做阈值门禁（P0 级）；conflict 裁决深化（P1）与 decay 校准（P2）留给下一轮由该 eval harness 驱动。

## Decision

- **D1 评测范围（Q2: B）**：门禁评测链只走纯确定性纯函数路径（write/extraction 固定输入 stub → adjudicate → store → retrieve），全生命周期测试而非只测检索；LLM judge 不进 CI 门禁。UC Berkeley 2026（arXiv 2606.19544）实证 judge raw agreement 系统性高估判别力 33–41pp、有 consistency-bias 悖论，不可做守门人。
- **D2 本地 judge 通道（Q3: A）**：独立 nightly/手动报告脚本（非门禁），judge 为本地 DeepSeek（OpenAI 兼容 /v1/chat/completions，本项目端点 127.0.0.1:20128/v1）。硬约束：① DeepSeek 蒸馏级 32B 以上（8B 级评判力崩溃，SummEval 相关性腰斩 50%，arXiv 2510.27106）；② 上线前在 30–50 条人工标注 gold-set 上算 Cohen's κ ≥ 0.6 才能启用，之后每月+每换 rubric/模型复测；③ judge 与被评输出跨家族（防 self-preference，Panickssery 2024）；④ judge 错误「记 0 分不 crash」（llm-evalgate exit-code 分区契约）。此通道是唯一允许 fail-open 的域。
- **D3 落点形态（Q4: A）**：golden case 为带类型的 TS 数组 `packages/store/src/eval/golden-cases.ts`，runner 与 CLI 同包（pnpm -C packages/store eval）。case 字段与 adjudication 输入共用类型，接口变更由编译器强制同步。拒绝 JSON 数据文件（失类型校验）与独立 packages/eval 包（过度工程）。
- **D4 门禁指标与阈值（Q5: A+B）**：ship-gate 只卡三条确定性指标——① case 级生命周期通过率（必须 100%）；② supersession 成功率；③ quarantine 误判率。阈值 = 首跑实测基线 − margin，门禁只防回归不追指标优化。报告另外输出阶段归因（extract/adjudicate/store/retrieve），对应 futureagi per-rubric 主张。
- **D5 golden 集初始规格（Q6: A）**：20 条六分组——偏好变更矛盾（supersession）、时间过期事实（decay/valid_until）、secret 拒存、重复成功证据累积（C-prime）、quarantine 边界、topk 截断 stale（read 阶段）。每条含真实领域上下文，不追大（20 条压统计可分辨性底缘，D8 隔离机制同步建立）。
- **D6 ship-gate 集成形态（Q7: A）**：新增 memory-eval 一步，进 ship-gate gates 序列，产 `.ship-gate/eval-report.json` + `.ship-gate/eval-report.md`（沿用 ADR-0021 证据层三级约定），CI 归 ship-gate 现有 job 自动覆盖，失败时把失败 summary 贴 PR comment（futureagi 做法）。明确否决独立 turbo task 不进门禁（装饰性门禁反模式）与「本轮只建 runner」（与 D4 首跑基线自相矛盾）。
- **D7 fail-open/fail-closed 分域（Q7 加固 1）**：AGENTS.md 的 fail-open 只针对 anysearch hooks 层服务故障，不平移到 eval 门禁。确定性三指标 fail-closed 硬失败、绝不 rerun-pass（BuildPulse slot-machine 反模式）；LLM judge 通道 fail-open；judge 报错记 0 分不 crash。
- **D8 flaky case 隔离（Q7 加固 2）**：任一 case 环境性 flaky → 进 quarantine（带 30 天 TTL + 每周过期复评 + 续期上限 2 次），而不是删 case 或改阈值；报告带数据集指纹（llm-evalgate），防跨数据集比基线。复用记忆系统 quarantine 心智模型（ADR-0023）。
- **D9 基线刷新纪律（Q7 加固 3）**：首跑只能算校准起点；永不允许 CI 自动下调基线（一次下调就是静默 ratchet-down）；只在确认真实改进后经 review 提交；golden 集增删 case 时强制重校准并更新数据集指纹。
- **D10 报告保留周期（Q7 加固 4）**：基线 JSON 提交进 git（llm-eval-ci 报告即下一次基线）；`.ship-gate/` 保留最近 12 次发布证据；原始 JSONL 走 CI artifact 默认 90 天。基线本身永不删除。
- **D11 显式拒绝项（ponytail 边界）**：实体解析/知识图谱、cross-session identity、procedural memory（Mem0 自认 open problem）本轮暂缓；judge 门禁（fail-closed LLM）本轮明确拒绝；JSON fixtures / 独立 eval 包 / judge 进 ship-gate fail-closed 全部否决。

## Consequences

### 正面

- 记忆系统所有后续优化（decay 系数、裁决逻辑、新 provider）自此可度量回归；D8/D9/D10 环环绕住「基线不会静默漂移」。
- 与已有证据层（ADR-0021）、ship-gate（ADR-0020）、quarantine（ADR-0023）概念复用到底，零新抽象。
- judge 通道完全离线运行，无 API 费用；self-consistency 采样峰值温度 0.1，低温度 + 同例多次均值降方差。

### 代价与边界

- golden case 是 TS fixture，非工程师改不了（接受；团队全工程）。
- judge κ 校准需要人工标 30–50 条 gold-set，首轮须人肉标注。
- 20 条样本统计功效有限（min_detectable_effect 大），本案只作门禁不作百分比精度分析。
- 同族 self-preference 防御的代价：若未来改换用 DeepSeek 生成记忆数据，须同步换 judge 家族。

## Implementation Plan

1. `packages/store/src/eval/golden-cases.ts`：20 条六分组带类型 fixture（CaseSpec 类型：input / expectStage / expectOutcome / traceAssertion）。
2. `packages/store/src/eval/runner.ts`：纯函数 lifecycle runner（extract stub → adjudicate → store → retrieve），阶段归因枚举。
3. packages/store 加 CLI（pnpm -C packages/store eval），输出 JSON + markdown 报告 + 数据集指纹。
4. `scripts/eval-judge.mjs`：本地 DeepSeek OpenAI 兼容客户端，judge 错误记 0 分不 crash，nightly/manual 调用，不进 ship-gate。
5. ship-gate 加 memory-eval 步（读 runner 报告、卡 D4 三条阈值），门禁产物写 `.ship-gate/eval-report.json`+`.ship-gate/eval-report.md`。
6. 首跑校准：跑 50 次基线，观察 pass rate 分布，把阈值设在观测地板下，git 提交基线 JSON。
7. 测试闭环：三个新代码路径（golden runner、judge client、ship-gate step）各带断言测试，ship-gate FULL GREEN。
8. 首轮 30–50 条人工标注 gold-set → 算 Cohen's κ → ≥0.6 启用 judge 通道，否则调 rubric。

## Acceptance

- [ ] turbo check/test/build 6 绿；ship-gate 含 memory-eval 步全绿。
- [ ] 20 条 golden case 全 PASS；报告含阶段归因 + 数据集指纹 + 三指标。
- [ ] judge 空仓跑一次（judge 不挂时记 0 分不 crash）。
- [ ] CLI --help/doctor/pref review + mcp --help 存活。
- [ ] CONTEXT.md 新增 4 术语，End of Glossary 保留。

## Research Sources

- Hindsight/Vectorize: The Consolidation Problem in Agent Memory (2026-05-21) — https://hindsight.vectorize.io/blog/2026/05/21/agent-memory-consolidation
- Mem0: State of AI Agent Memory 2026 — https://mem0.ai/blog/state-of-ai-agent-memory-2026
- dreaming.press: Why Agent Memory Rots in Production — https://dreaming.press/posts/why-agent-memory-rots-in-production-four-failure-modes.html
- Supersede (arXiv 2606.27472) — https://arxiv.org/html/2606.27472v1
- Reliability without Validity: LLM-as-Judge (UC Berkeley, arXiv 2606.19544) — https://arxiv.org/html/2606.19544v1
- Rating Roulette (UIUC, arXiv 2510.27106) — https://arxiv.org/html/2510.27106v1
- MT-Bench (arXiv 2306.05685) — https://arxiv.org/abs/2306.05685
- G-Eval (EMNLP 2023) — https://aclanthology.org/anthology-files/pdf/emnlp/2023.emnlp-main.153.pdf
- Panickssery 2024 self-recognition/self-preference — https://arxiv.org/html/2404.13076
- Prometheus-Eval （本地 judge 蒸馏级） — https://github.com/prometheus-eval/prometheus-eval
- LLM-as-Judge Best Practices 2026 (FutureAGI) — https://futureagi.com/blog/llm-as-judge-best-practices-2026
- CI/CD LLM Eval with GitHub Actions (FutureAGI) — https://futureagi.com/blog/ci-cd-llm-eval-github-actions-2026
- BuildPulse: llm evals flaky tests CI — https://buildpulse.io/blog/llm-evals-flaky-tests-ci-for-ai
- QASkills: LLM evaluation CI/CD quality gates — https://qaskills.sh/blog/llm-evaluation-ci-cd-quality-gates
- Langfuse: LLM regression testing — https://langfuse.com/resources/engineering/llm-regression-testing
- Confident AI: Best AI evaluation tools for CI/CD — https://www.confident-ai.com/knowledge-base/compare/best-ai-evaluation-tools-for-ci-cd
- llm-evalgate — https://github.com/LesterALeong/llm-evalgate
- llm-eval-ci — https://github.com/omarnagy91/llm-eval-ci
- RAGAS vs DeepEval 2026 — https://qaskills.sh/blog/ragas-vs-deepeval-2026
- AWS GEDD Cohen's κ for LLM Judges — https://github.com/aws-samples/sample-GEDD/blob/main/grounded-evals/docs/cohens-kappa-for-llm-judges.md
- GitHub Actions artifacts retention — https://docs.github.com/en/organizations/managing-organization-settings/configuring-the-retention-period-for-github-actions-artifacts-and-logs-in-your-organization
