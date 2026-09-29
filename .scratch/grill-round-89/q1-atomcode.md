# R89 Q1 atomcode 调研存档（ctx_batch_execute 输出原文，含索引节重排）

> carrier: `ctx_batch_execute(label=atomcode)`；cmd: `atomcode -p "$(cat .scratch/grill-round-89/q1-prompt.txt)"`
> 运行元：searches 9（web_search×5、anysearch×4、tavily×1 失败改双引擎）| angles 五类全覆盖 | full reads 6 篇 | resume-id 7d084147-5e5e-485b-a43f-3e7dc7bc6a73

## 1) 执行摘要（TL;DR）

**推荐 A【dsh 上游线轮】**，但把轮内正题定义为「**0.2.0 线 breaking-surface 调研 + repin 时机裁决 + r72 两票随裁决定形**」，而非直接 repin。Confidence：**高**——「上游大版本线首目击即开调研窗口、采纳动作分层延后」是 Renovate/Tuist/Android 官方共同背书的成熟心智模型，且与贵仓 R77 已立法的 Adoption Stability Gate / Respect-and-Schedule 完全同构（知识库召回命中，两源交叉）。

## 2) 分点结论

**① 信号触发型窗口期做调研是工业惯例，rc.1 首目击正是开窗时机。** Renovate 官方最佳实践明确「Read the changelogs regularly, you'll get a feel for the direction of the upstream project」「Update to new major versions in good time」——持续贴近上游使 major 迁移更容易（docs.renovatebot.com/upgrade-best-practices）。Android 官方升级策略同样建议「Testing upgrades to pre-release (alpha, beta, RC) versions can help readiness when stable releases are available」（搜索摘要，原文抓取被重定向拦截——此为唯一单源结论）。**贵仓 upgrade-ledger 的 L0 元数据哨→L1 静态探针→L2 安装彩排三层恰好就是这个模型的立法化版本**，rc.1 在架 = L1 探针的合法开跑条件。

**② repin 至 rc 还是等 stable：工业默认是「等 stable，rc 期只 soak」。** Tuist 官方渠道文档给出了最完整的可引用判据：rc 是 explicit opt-in、stable 才 default-resolved；推荐策略三步=「pin to stable line → 下一 minor 在 rc 通道 soak → 迁 pin 到新 stable」。Renovate 的 `:ignoreUnstable` 预设同构：不自动跳到 prerelease，除非当前版本已在同一 major.minor.patch 的 unstable 线上（GitHub discussion #19375 全文核验，且讨论中反复强调 **0.x.y 本质上等同 major**——贵仓 0.1.7→0.2.0 跳线正是此类）。Rust internals 2026-01 讨论从语言生态层面证实 prerelease 对共享依赖的兼容性风险是结构性的。**但注意反向锚点**：贵仓现役版本本就是 0.1.7-rc.1（同一 0.x unstable 家族内跳线），Renovate 的「已在 unstable 才跟 unstable」例外条款在此**部分适用**——这使「rc→rc 平移」并非无先例可依，而是一个真正的票内裁决点。

**③ 同域纳编符合「same subsystem → combine」的分批心智模型。** 工业界的 PR-batching 判据（Generous-Corp/pulp 的 pr-batching skill 原文）：「Same subsystem. One context, one adoption note, one revert」→ 合并；「One depends on the other. If B only compiles because of A, they were always one change」→ 必然合并。r72 两票的解法确实**依赖** repin 裁决结果（0.2.0 若改工具注册面，native-tools 注册方案的落点就变了）——按此判据它们本就是同一变更。Renovate 的 `group:monorepos` 预设（同上游家族单 PR）是同一模型的自动化版本（docs.renovatebot.com/noise-reduction 全文核验）。且这**不违反** ADR-0029 单主题纪律：三者同落「dsh 集成面」，恰是 R88 D-001 拒绝的「广义清债」（跨主题捞票）的反面。

**④ 反对 A 的最强论据（辩证检验）**：「0.2.0 变化面可能小 + r72 两票是 deferred 设计债而非触发债，轮体量偏薄、且 rc 期裁决可能一轮后立刻被 rc.2/stable 推翻重裁」。检验后**不成立为否决项，但成立为约束**：(a) 薄轮问题有先例解法——把轮内交付物定为「L1 探针 transcript + 迁移面 diff + repin 时机裁决 + r72 两票的解法定形（或维持 defer 并注明依赖已解除/未解除）」，这是 Renovate pending→passing 状态机同构的合法轮体；(b) 「被 rc.2 推翻」风险恰好被贵仓 R77 已立法的**alarm 跟随发布、adoption 跟随稳定度**分层吸收——调研结论不随 rc.N 递增失效，只有采纳决策会，而采纳决策本就该押后；(c) 真正需要警惕的是另一种失败模式：rc 期做过重的设计承诺。Canary war story（johal.in，2026-04）证明「staging 等价≠生产安全」，映射到此处=「rc.1 diff 等价≠stable 面」。约束即：r72 两票若在轮内**只定形不实现**，则零风险；若实现，必须走 L2 安装彩排 expected-RED 闸。

## 3) 对比矩阵

| 项 | 信号状态 | 工业模型对应 | 轮体量 | 裁决 |
|---|---|---|---|---|
| A dsh 上游线 | rc.1 首目击（具名触发已发生） | signal-triggered window + rc-soak 分层采纳 + monorepo-group batching | 调研+裁决+两票定形，中等偏实 | **推荐** |
| B 评测面 | 无新触发（quarantine 基建全备等填充） | maintenance-window 主动偿债 | 薄 | 顺延/次票 |
| C 垂域重议 | 重开条件未达 | no-signal-no-action（ignoreUnstable 同构） | — | 候审不复活 |
| D 另指 | — | — | — | 无更优者 |

## 4) 完整来源清单

| # | 标题 | URL | 角度 | 日期 | 贡献 |
|---|---|---|---|---|---|
| 1 | Renovate — Upgrade best practices | https://docs.renovatebot.com/upgrade-best-practices/ | Official | 持续更新 | major 及时跟进、changelog 常读、minimumReleaseAge 14 天闸 |
| 2 | Renovate — Noise reduction（分组 pros/cons） | https://docs.renovatebot.com/noise-reduction/ | Official | 持续更新 | monorepo 同族单 PR 惯例 + 分组的四条代价（佐证 A 的纳编需控轮内风险） |
| 3 | Renovate discussion #19375（ignoreUnstable 与 0.x=breaking） | https://github.com/renovatebot/renovate/discussions/19375 | Official/Community | 2023 | 0.x.y 实质 major；unstable 跟随条件=已在同 unstable 线 |
| 4 | Tuist — Release channels | https://tuist.dev/en/docs/cli/release-channels | Official | 持续更新 | rc soak→stable promote 三步策略，rc-vs-stable 最完整官方判据 |
| 5 | Rust Internals — Prerelease versions aren't usable for shared dependencies | https://internals.rust-lang.org/t/prerelease-versions-arent-usable-for-shared-dependencies/23948 | Community/Criticism | 2026-01 | prerelease 共享依赖的结构性风险 |
| 6 | Jsonic — Dependabot vs Renovate | https://jsonic.io/guides/dependabot-vs-renovate | Comparative | 2026-05-15 | major 锁定两侧语法；分组/调度/automerge 对比矩阵 |
| 7 | johal.in — Canary deployment war story | https://johal.in/war-story-canary-deployment-that-broke-our-api | Criticism | 2026-04-29 | 「预发等价≠生产安全」→ rc.1 diff 等价≠stable 面 |
| 8 | Teamhub — What is a Release Candidate | https://teamhub.com（截断，FTS 可回溯） | Concept | — | rc 定义 |
| — | Android 官方升级策略 | developer.android.com（抓取被重定向拦截，单源） | Official | — | rc 期测试提升 stable 就绪度 |
| — | Generous-Corp/pulp pr-batching skill | （知识库召回） | Community | — | same-subsystem/dependency 合并判据 |
| — | 本仓 R77 upgrade-ledger / Adoption Stability Gate / Respect-and-Schedule | （知识库召回，仓内先例） | Internal | — | alarm 跟发布、adoption 跟稳定度分层 |

## 5) 信息缺口

- dsh 0.2.0-rc.1 的实际 changelog / .d.ts diff 不可公网核验——需 R89 轮内跑 L1 探针补齐（这正是 A 轮正题）。
- 「同一 unstable 家族内 rc→rc 平移」缺乏独立第二先例（Renovate 例外条款是最近似锚点，单源）。
- Tavily 引擎本任务全程配额超限，第三引擎交叉依赖 AnySearch+Exa 完成，未达三引擎全绿。
