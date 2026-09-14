# 深调研报告：docs 域 golden 集执行器形态（A/B/C/D 裁决）

> atomcode · 2026-09-14 · grill-round-62（审计 F4/F5 收口）
> Sufficiency Gate：searches: 10（Exa 2 + Tavily 3 + AnySearch batch 4 + 知识库召回 1）| angles: Official / Comparative / Criticism / Currency / Community 全五类 | full reads: 6（langfuse、martinfowler、claudelab、pytest-test-categories、pactflow、qaskills）+ 本地实物 14 份 | gaps: AnySearch 对 “VCR 批评” 语义检索噪声大（已用 Exa/Tavily + 原文双源补齐）；node:test tags 官方文档未直接抓取（ADR-0057 D4 已引且仓内 test/online/ 实物已核）。

### atomcode > 2) 分点结论 (1)
## 2) 分点结论

**结论 1：金案例的两种语义不是设计瑕疵，是测试金字塔的固有分层，工业界标准答案就是双层。（Confidence 高）**
Langfuse 官方 golden dataset 指南与 Inngest 的 offline/online eval 对比给出同一心智模型：offline eval（固定数据集 + CI 前置门禁，抓已知回归）与 online/实测层（真实流量/真实依赖，测 offline 只能近似的东西）**覆盖不同风险、不是竞争对手**，“大多数团队应该两个都跑”。qaskills 进一步指出 golden case 的 expected 可以是 `expected_behavior`（“必须弃答”）而非唯一标准答案——本仓库 `verdict:answer|abstain` 正是这个形态。双层与账本无冲突。

**结论 2：离线层必须是 stub 注入（B 的一半），且注入缝已经写好——但绝不能“按 expected 构造 stub 响应”，那是循环论证。（Confidence 高）**
`packages/kernel/test/domain-filter.test.ts` 已用 `mockProvider(id, urls, capable)` 走通完整缝：能力协商、post-gate 拦截、`metadata.abstain` 结构、双 audit 事件、outcome:abstain 维度，9 组断言全部覆盖 g0007/g0013/g0014 的 abstain 语义。离线 golden runner 的正确形态是：stub provider 返回**独立于 expected 的**场景化响应（如“provider 返回 10 条域外结果”= bc0001 的 observed 现场），断言引擎产出 expected.verdict——证的是**管道契约**（provider 给 X 则 verdict 必须 Y）。若反过来按 expected 构造响应再断言 expected，套件变成“自证预言”，恰是 Speedscale《Your Mock Is Lying》批判的“a test of our beliefs about the world, run against a copy of those same beliefs——它永远免费地同意自己”。B 方案（只离线）的全部 11 条 mustHit answer 条目都会落入这个循环。

**结论 3：must-hit 现场真实性只有 live 可证，stub/VCR 都结构性不可替代。（Confidence 高）**
“pnpm.io/settings 是否真的出现在检索结果里”是外部世界的属性。VCR 录制回放录到的是过去某一天的快照：claudelab 生产模式文的原话——快照"frozen in time, so it lies to your tests... Tests stay green while production breaks — the worst possible failure mode"；agent-vcr 分析补刀：HTTP 层回放"never let your tool code actually run, so tests stop reflecting reality"。对一个核心承诺就是“真打真实 web”的检索 CLI，D 方案等于把产品测成录制机的回放器。反方向（C 只 live）则把 11 条 answer + 3 条 abstain 全部绑到第三方限速端点的可用性上，违反 ADR-0057 D4 hermetic-by-default 决策，且 ship-gate 本身以 `--offline` 运行（ADR-0060 D7）。

**结论 4：VCR 的合法位置不在 golden 执行器，而恰是本仓库已经采用的“捕获一次、人工修剪、版本化 fixture”形态——即 A 的离线层而非 D。（Confidence 高）**
WireMock 官方最佳实践与 Speedscale 修正清单收敛于同一模型：录制仅用于 bootstrap，"capture fixtures from real responses so they were **true at least once**, and record when"；然后"**a scheduled contract test against the real dependency is the only thing that notices when reality moves**"（= live 层）。bc0001 的 observed 块（10 条域外结果、topHost 腾讯云）就是天然的"true at least once"夹具来源。D 作为主执行器被否，但其精神已被 A 的 stub 夹具吸收。

## 5) 账本冲突显式声明

| 决策 | 关系 | 说明 |
|---|---|---|
| R62 D-001（current） | **正向对齐** | D 项点名“golden 执行器落地（审计 F4）"，A′ 即其实现 |
| R62 D-002/D-003/D-004（current） | 无交互 | 安装炸弹/teardown/install-smoke 与本裁决不同面；D-004 提到“no-results 契约留 stub 单测层（挂 R61 判据 3 golden）"——A′ 离线层正是该挂点 |
| R62 D-005（current） | **正向对齐** | ④ 断言 ci.yml test-online job 存在且含 test:online 步 = live 层的 CI 家已被门禁钉死；g0013 标 stub-arm 闭 F5 与 ② 的显式白名单自律同风格 |
| R61 D-003（current） | **账本内授权** | 判据 3 原文 "stub provider, offline-runnable per ADR-0057 D4"——A 的离线层就是该判据的执行器化；must-abstain 与 must-hit 成对 = g0007↔g0012 结构，A′ 双层各自兑现 |
| ADR-0057 D4 / ADR-0060 D7 | **正向对齐** | hermetic-by-default + test:online 分层先例原样复用；"coverage moved out of the offline suite is re-established, not dropped, behind test:online" 正是 live 层的存在理由 |
| ADR-0062 Out-of-scope | 正向对齐 | "golden.expected offline executor (audit F4): next round candidate"——本轮即下一轮 |
| ADR-0061 D5 诚实契约 | 正向对齐 | live 层保住 "mustHit URL 可复访" 的诚实语义，B/D 均削弱它 |

**无任何 current 决策被本推荐推翻或需要 revised 标注。**

## 6) 完整来源清单

| # | 标题 | 域名 | 角度 | 贡献 |
|---|---|---|---|---|
| 1 | Golden dataset evaluation（Langfuse 官方指南） | langfuse.com | Official | golden 集生命周期、CI 门禁、drift 治理 |
| 2 | Online vs Offline AI Evals | inngest.com | Official/Comparative | 双层“覆盖不同风险、应同时跑”的权威表述 |
| 3 | The Practical Test Pyramid | martinfowler.com | Official | 金字塔分层 + contract/stub 层定位 |
| 4 | Replay-Driven Testing for Claude API | claudelab.net | Criticism/Community | VCR 快照撒谎、SDK 升级断带、CI 禁录制的守卫模式 |
| 5 | agent-vcr / decision-replay 分析（Exa 高亮） | — | Criticism | "HTTP 回放下工具代码不跑，测试不再反映现实" |
| 6 | Your Mock Is Lying | speedscale.com | Criticism | stub 自证循环 + "nightly contract test 是唯一能发现现实移动的东西" |
| 7 | pytest-test-categories | github.com | Official | scope 标记治理：显式分类、无逃生舱、严格强制 |
| 8 | What is contract testing | pactflow.io | Official | stub 注入与 provider 验证的分工 |
| 9 | WireMock service virtualization | dev.to | Community | 录制仅 bootstrap、修剪为消费方期望、防契约漂移 |
| 10 | Golden Dataset for LLM Evaluation | qaskills.sh | Official/Comparative | expected_behavior 形态、失败回灌、CI gate |
| 11 | Flaky Tests in CI/CD | contextqa.com | Criticism | live 第三方套件独立标记、低频运行 |
| 12 | Integration tests for third-party APIs | axelhodler (Medium) | Community | live 测试定时跑、消费侧永不打真 API |
| 本地 | decision-ledger r61/r62、ADR-0027/0028/0057/0060/0061/0062、eval-looks.json、eval-docs-golden.test.ts、domain-filter.test.ts、eval/cli.ts、golden-cases.ts、ci.yml、ship-gate.mjs | — | 实物 | 全部账本冲突判定与缝位证据 |

### atomcode
# atomcode

$ atomcode -p '深调研并给出推荐：本仓库 anysearch-cli 的 docs 域 golden 集（根目录 eval-looks.json，schema anysearch/docs-golden@1，14 条 entry 含 expected.verdict=answer|abstain、mustHitHosts、mustHitUrls、minResults、provenance、dimensions）目前无执行器——packages/store/test/eval-docs-golden.test.ts 只做 schema/出处/锚点结构断言，expected 从不被任何 runner 跑（审计 F4）。金案例有两种语义：管道正确性（provider 给 X 则 verdict 必须 Y，stub 可证）与现场真实性（docs 域真打 pnpm.io，只有 live 可证）。候选：A) 两层执行器——离线阻塞层 golden runner 按 expected 构造 stub provider 响应喂引擎断言结构契约 + entry 加 scope:stub|liv…

我先定位仓库并读取账本、ADR 与 golden 集相关实物，再进入外部调研。仓库在 `D:/Aworker/anysearch-cli`。先看目录结构定位全部目标文件。继续读取 golden 集实物与测试现状。继续读取 golden 相关 JSON、coverage manifest、badcases 与 CONTEXT.md、ADR 相关段。bash 被只读模式拦截，改用 read_file 继续读实物。继续读实物：eval/cli.ts、golden-cases.ts/runner.ts 形态、kernel 域过滤 stub 测试。继续读本地实物：docs-golden schema、eval CLI、golden-cases/runner 形态。继续读 eval/cli.ts 主流程与 golden-cases.ts 的分组/排除面结构。继续读取账本指名的六篇 ADR 相关段。继续读取 ADR-0057、0060、0061、0062。继续读取 ADR-0061/0062 与 test:online 相关实物。本地账本与 ADR 主体已读完。补读 round-62 其余提问记录与 test:online 实物形态，然后进入外部调研。本地实物已读齐。现在先检索知识库证伪"无相关内容"，同时启动三引擎外部调研（分层执行器 / VCR 回放 / stub 注入 / scope 标记治理）。Tavily 第一发命中有限，扩大三引擎并行检索：hermetic 分层、golden 集执行器、VCR 批评面、scope 标记治理。AnySearch 对 VCR 批评的检索命中噪声，换 Exa/Tavily 补角度，并开始定点抓取原文。继续定点深挖：抓取分层评测、契约测试、录制回放的原文证据。继续补足配额：抓取 VCR 批评原文、hermetic 测试与 scope 标记治理的原文。继续补足配额：再抓取两处原文（contract-testing 的 stub 注入心智模型 + offline/online eval CI 门禁先例），随后综合裁决。本地实物与外部证据已齐，现做最后两条补强检索（live executor 先例、stub 注入契约测试对比），随后输出综合结论。# 深调研报告：docs 域 golden 集执行器形态（A/B/C/D 裁决）

## 7) 信息缺口

- AnySearch 对 "VCR 批评" 语义检索噪声大（已用 Exa/Tavily + 原文双源补齐）。
- node:test tags 官方文档未直接抓取（ADR-0057 D4 已引且仓内 test/online/ 实物已核）。
