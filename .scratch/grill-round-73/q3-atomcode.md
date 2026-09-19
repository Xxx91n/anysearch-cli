# R73 Q3 atomcode 调研存档

## 调研问题原文

Research question — upgrade posture for a preview-stage upstream dependency (DeepSeek Harness / @deepseek-ai/dsh), after a pinning strategy is already decided.

CONTEXT (verified facts):
- We are anysearch-cli; apps/dsh-plugin is a private, zero-runtime-dep Cordis bundle adapting dsh to our hooks layer. @deepseek-ai/* are type-only devDependencies — deliberately wired as a "compile-time churn alarm" (our ADR-0073): upstream API breakage must fail tsc loudly to force a human review point.
- Pinned version: 0.1.5-rc.2 = the current latest AND next dist-tag. Upstream also publishes an alpha channel: 0.1.6-alpha.1 (2026-09-15) and 0.1.6-alpha.2 (2026-09-17). Repo has minimumReleaseAge:2880 (48h), pnpm 11.24.0.
- A pinning decision is ALREADY MADE (not the question): exact-pin 4 direct devDeps + pnpm.overrides enumerating all 15 @deepseek-ai/dsh-* + cordis, single-version catalog point.
- Verified migration surface for 0.1.6-alpha.2 (we diffed the published .d.ts ourselves): 'agent/session-start' renamed to 'agent/created' — same serial awaited semantics, but payload widened: {agent, source: SessionStartSource /* fresh|resume|clear|compaction */, signal?}. Our adapter mounts 5 surfaces: agent/session-start (durable routing-card inject), ctx.systemPrompt section (service, unchanged), tools/pre-execute, tools/post-execute, tools/result — the last three signatures are byte-identical between rc.2 and alpha.2.
- The new 'source' field matters: our durable routing-card inject would double-inject on resume/clear/compaction events without a source guard.
- We have an "upgrade-diff rehearsal" procedure already: bump devDeps → tsc → expect RED on removed symbols → record post-mortem transcript → repin. It correctly caught the alpha.1 rename (that's how we know).
- The wider product goal: an information-specialized agent CLI; this adapter is host integration, not core product.

QUESTION: upgrade posture.
- A: stay pinned on 0.1.5-rc.2 (=latest stable), do NOT migrate now; record the known-delta (rename map + source-guard requirement + payload diff) into the upgrade-diff checklist; re-run the rehearsal per upstream release (expect RED = alarm works); deliberate bump only when upstream ships a stable/RC we intend to adopt or the bridge shows a functional gap.
- B: migrate now to 0.1.6-alpha.2 (rename + source guard immediately).
- C: dual-name compat shim (listen on both event names, tolerate either).
- D: pin + write a prepared-but-unapplied patch artifact for the migration.

RESEARCH ASKS:
1. Industry mental models for tracking preview/prerelease upstreams: Rust nightly/beta/stable channels, Chrome channels, Kubernetes API deprecation policy, VS Code proposed-API rules, TypeScript nightly, Renovate "failed upgrade PR as review point". For a dev-preview upstream shipping breaking changes between prereleases, what is the mature tracking posture — pin stable + scheduled rehearsals, track head, or dual-compat shims?
2. When is paying a migration cost early justified vs deferred (YAGNI vs "known-delta debt")? Any documented practices for "known-delta ledgers" / upgrade rehearsal pipelines in mature orgs?
3. Compat shims for renamed upstream APIs: when do dual-path shims pay off vs silently defeating break-loudly alarms? Evidence on shim rot.
4. Is there any ecosystem signal on DeepSeek Harness's release cadence / stability promise worth weighing (e.g. is 0.1.6 heading to rc soon, is alpha channel meant for external consumers)?
5. Anything wrong or incomplete in this framing.

Return: clear recommendation among A/B/C/D (or better variant), reasoning, and the industry analogies supporting it.


## 调研输出原文

[warning] 正在以管理员权限运行 — 模型可能可以访问系统文件。
研究专精模式启动 — default 级别调研，先三引擎并行发首轮查询（覆盖 Official/Comparative/Criticism/Currency/Community 五类角度）。第二轮：补 DeepSeek Harness 生态信号、TS nightly/Chrome 通道模型、shim 腐化证据。第三阶段：定点深挖 — 打开 6 个高价值原文核验（dsh 官方 changelog、DeepSeek-Harness GitHub、K8s 弃用政策、VS Code proposed API、TS semver/pinning、Endor Labs 依赖升级实践）。## Sufficiency Gate 自查

searches: 8（web_search×3 / tavily×3 / anysearch×2）| angles: Official（GitHub README、k8s 政策、VS Code 文档、TS 文档）、Comparative（Rust/Beta/Stable 渠道、Chrome 渠道、TS semver）、Criticism（shim/技术债、alpha 载荷问题）、Currency（dsh changelog 2026-09、Renovate/Endor 2026-07）、Community（dev.to、dshdocs 第三方指南）| full reads: 6 | gaps: ①"known-delta ledger"无正式命名实践，用近邻实践（k8s 升级预演、Renovate 证据包）替代；②0.1.6 是否即将 rc 无直接官方信号，只能从发布节奏推断；③shim rot 无定量研究，仅有定性技术债文献。

---

# 执行摘要（Tl;dr）

**推荐：A+（A 的强化版：A 的钉住+预演+已知增量账本，外加把 source-guard 修复写成“待命补丁”式的迁移说明——即吸收 D 的记录形态但拒绝 D 的 patch-file 工件，坚决否决 B 和 C）。** Confidence：**高**——押注依据全部来自已验证的事实（你们自己的 ADR-0073 设计意图 + 上游 README 明示 "THERE WILL BE COMPATIBILITY-BREAKING CHANGES" + 第三方 changelog 证实的 alpha→rc 批处理节奏），且与所有行业类比一致收敛。

---

# 对比矩阵（A / B / C / D）

| 方案 | 适配上游稳定性（developer preview、alpha 破坏性） | 保留 break-loudly 告警 | 迁移成本时机 | 备注 |
|---|---|---|---|---|
| **A+（推荐）** | ✅ 钉在 rc 稳定面，预演对齐 alpha 节奏 | ✅ 每次预演 RED 都是人工评审点 | 递延到 rc/stable 或功能缺口出现 | 与 k8s "alpha 随时可移除"心智完全一致 |
| B（立即迁 alpha.2） | ⚠️ 主动进 alpha 面——上游明确说这层不保证稳定 | ⚠️ 部分钝化（预告警变常态警） | 提前支付，可能为 0.1.6-rc.3 再付一次 | 违背 ADR-0073 立意：你们是类型-only 消费者，无 alpha 独有功能需求 |
| C（双名 shim） | 表面稳妥 | ❌ **直接击穿告警**：tsc 对 rename 不再红 | 无限递延 | 两个事件源双触发风险（session-start + created 同时挂载 = 双注入），需自行去重；shim 与你们 0 运行时依赖的单文件 bundle 冲突 |
| D（patch 工件） | ✅ | ✅ | 同 A | 唯一差别是工件形态；pnpm patch 指向 *已发布 tarball* 的修改，而你们 devDeps 是 **type-only**——无运行时面可 patch，工件会空转。降级为"迁移说明/待命 diff"写入 checklist 即可 |

---

# 分点结论

**1. 成熟组织对"pre-release 上游破坏性变更"的追踪姿态 = 钉稳定面 + 预演 + 递延采纳，而非跟踪 head 或双兼容 shim。** 多个独立类比收敛：
- **Kubernetes 弃用政策（官方，已读原文）**："Alpha API versions may be removed in any release without prior deprecation notice" —— 这是为什么 k8s 生态的标准姿势是工具化扫描（Pluto/kubent）+ CI 预检 + 有计划的升级窗口，而不是把 alpha API 用于生产或写 shim。你们"升级预演"程序就是 Pluto/kubent 的同构物。
- **Rust/rustup（官方，已读）**：预览期软件（nightly-only）的标准做法是 `rust-toolchain.toml` 精确 pin 到带日期的 revision 并提交进版本库——"pinned to a specific release … reflected in their source repository"。你们的 exact-pin + overrides 正是同一形态。
- **Chrome 渠道（官方博客/文档）**：Dev/Beta 是给"9–12 周预览"和 IT 团队测试 API/策略变更用的；生产消费者按 Stable 走。跟踪 alpha 通道是被明确定义为*测试活动*，不是*采纳活动*。
- **TypeScript（官方 + 已读 semver 文章）**：即使不破坏 semver 的编译器也会"almost always break some existing programs"，官方对策是 pinned per-project 版本 + 破坏性变更 wiki。对 TS nightly，微软自己的措辞是"advanced users who want to test"，明确不是让下游产品跟进。

**2. "Renovate 红色升级 PR = 评审点"是已文档化的成熟实践，且与你们现状同构。** dev.to（2026-07，已读）记录的"evidence-first upgrade workflow"：升级 PR 的价值不在执行迁移，而在*证明该迁移对本仓库是否存在*；Endor Labs（2026-07，已读）的分级节奏（安全补丁即时、minor 周批、major 进预定评审窗）同样是"高触面依赖 → 人工评审点"。你们的 RED-tsc 预演正是这个模式的手工版——**它已经在 alpha.1 上工作过一次，这是最强的实证：alarm works，不要修一个没坏的东西。**

**3. 提前迁移（B）在两种条件下才被证明正当，这里都不满足：** (a) 需要新 API 提供的功能（你们的 source-guard 恰恰说明新载荷是*风险*而非*收益*——你们需要它的唯一原因是"迁了才有，迁了就必须处理"）；(b) 上游已宣告 migration window 关闭（不适用——0.1.5-rc.2 仍是 latest+next 双标签的现行稳定面）。dshdocs changelog（已读）提供了反面教材：0.1.5-rc.1 一次性倾倒 11 项破坏性变更（其中多项被上游归在 "Chores" 下），alpha 通道变更密度为"22 天 14 版"——**现在采纳 alpha.2 很可能在 0.1.6-rc 时再付一次迁移成本**，典型 YAGNI 反例。

**4. C（双名 shim）在你们的架构下是三重反模式：**
- **击穿告警**：Dual-path listener 意味着 rename 不再让 tsc 变红——ADR-0073 的"compile-time churn alarm"被静默失效。这正是业界对 shim 的核心批评（baeldung/stackexchange shim 讨论，AnySearch 源）：shim 让"不兼容"从编译期错误降级为运行期隐患。
- **双注入 bug**：同时挂 `agent/session-start` 和 `agent/created` 两个事件源，在过渡期上游可能双发（或你们自己的 durable routing-card 需要跨事件去重）——你们已经预判了 `source` 字段的 double-inject 问题，shim 会把它复杂化一层。
- **shim rot**：shim 是经典技术债载体（Paddle、HBS 技术债文献）：上游删除旧名后 shim 变成永不触发的死代码，无人敢删。0 运行时依赖的 zero-dep bundle 更不该背这层。

**5. D 应降级吸收，不做 pnpm patch 工件。** pnpm patch 机制是给*运行时依赖 tarball* 打补丁的；`@deepseek-ai/*` 是 type-only devDeps，没有运行时面可 patch——一个 prepared-but-unapplied 的 patch 工件在你们这里会空转、腐烂、还要过 ship-gate pathlint。正确形态：**把迁移写成 checklist 条目**（rename map + source-guard 伪代码 + payload diff + 预期 RED 符号清单），放在 `.scratch/` 升级账本里，预演时直接照单施工。

**6. 上游节奏信号（问题 4）：** 已验证事实：README 原文 —— "DeepSeek Harness is in developer preview and iterating rapidly. **THERE WILL BE COMPATIBILITY-BREAKING CHANGES.**"（这是官方对"alpha 面不承诺稳定"的明示，等价于 k8s 的 alpha track 声明）。dshdocs（独立第三方，已读）显示历史节奏：alpha 批量积压 → rc 一次性吸收（0.1.5-rc.1 吸收 4 个 alpha 的 11 项破坏）；且 npm `latest` 标签**故意落后**于 `next`。推断（中置信）：0.1.6-rc 大概率在数周内出现并一次性带进 alpha.1/.2 的全部增量——这意味着**等 rc 再迁是信息量最大、成本最低的时点**：届时 delta 冻结、changelog 完整、且你们已有两轮预演数据。

---

# 最终建议（A+，三个动作）

1. **维持钉住 0.1.5-rc.2 不动**（latest+next 双标签 = 上游自己盖章的现行稳定面）。
2. **立即把已知增量写入升级账本**（`.scratch/` checklist）：rename map（`agent/session-start` → `agent/created`）、source-guard 要求（`fresh|resume|clear|compaction` 白名单，durable routing-card 仅对 `fresh` 注入，或按你们的语义定义）、payload diff、预期 RED 符号清单。这份账本就是 D 的正确形态——说明性工件而非 patch 工件。
3. **预演触发器**：每个上游 alpha 发布跑一次预演（期望 RED = 告警确认，只记录不施工）；**0.1.6-rc.1 发布时执行真实迁移**（施工 + source-guard + 重钉），或提前迁移仅当出现功能缺口/上游宣告弃用窗口关闭。

**对问题 5（框架缺口的回答）：** 你们的框架基本完整，缺两点：① 没写明"预演"和"采纳"是两个不同决策——应显式拆开（每次 release 预演 = 义务，采纳 = 触发条件驱动），否则预演会漂移成半采纳；② D 选项在 type-only 依赖上无操作对象，应从选项清单剔除；③ 补一条升级账本的"过期条款"——0.1.6-rc.1 实际发布后，账本必须与上游 changelog 对账一次再施工，防止账本本身 rot（这正是 k8s 生态"pluto 扫描要对着目标 k8s 版本跑"的教训）。

---

# 完整来源清单

| # | 标题 | URL | 角度 | 日期 | 贡献 |
|---|---|---|---|---|---|
| 1 | DeepSeek Harness README (GitHub) | github.com/deepseek-ai/DeepSeek-Harness | Official | 2026（活跃） | "developer preview / THERE WILL BE COMPATIBILITY-BREAKING CHANGES" 官方稳定性声明；MIT；dsh-plugin 生态 |
| 2 | dsh Changelog — 第三方深度指南 | dshdocs.com/guides/changelog/ | Currency | 2026-08/09 持续更新 | 22 天 14 版节奏；alpha→rc 批处理模式；rc.1 倾倒 11 项破坏；latest 标签故意落后 next |
| 3 | Kubernetes Deprecation Policy | kubernetes.io/docs/reference/deprecation-policy | Official | 常青 | "Alpha 可在任何版本无预警移除"——钉住+扫描+计划升级的依据 |
| 4 | VS Code Using Proposed API | code.visualstudio.com/api/advanced-topics/using-proposed-api | Official | 2026-09 更新 | proposed API 仅限 Insiders 本地开发、不入 Marketplace——预览面消费的边界范例 |
| 5 | Why TypeScript Doesn't Follow Strict Semver | learningtypescript.com/articles/why-typescript-doesnt-follow-strict-semantic-versioning | Comparative | 2023-07 | 编译器类工具几乎每版都有"破坏"，对策=per-project pin + 破坏性变更文档 |
| 6 | Automated Dependency Updates Done Right (Endor Labs) | endorlabs.com/learn/automated-dependency-updates | Currency/Official | 2026-07-31 | 分级升级节奏（major 进预定评审窗）、upgrade impact analysis、auto-merge 信任陷阱 |
| 7 | Upgrades don't have to be a blind trust exercise (dev.to) | dev.to/michaeltruong/upgrades-dont-have-to-be-a-blind-trust-exercise-13mj | Community | 2026-07-03 | "红色升级 PR 作为评审点"的一手实践记录；evidence-first 工作流 |
| 8 | Cargo Book 依赖解析 | doc.rust-lang.org/nightly/cargo/reference/resolver.html | Official | 常青 | lockfile 优先、min-publish-age、yanked 语义——rehearsal/lockfile 心智 |
| 9 | rustup overrides | rust-lang.github.io/rustup/overrides.html | Official | 常青 | nightly-only 软件 pin 到精确 revision 并提交——与你们 exact-pin 同构 |
| 10 | Chrome Release Channels (官方博客 + Dev 文档) | blog.chromium.org/2009/01/…; developer.chrome.com/docs/web-platform/chrome-release-channels | Official | 2009/2022 | 渠道模型：Dev/Beta = 预览测试面，Stable = 采纳面 |
| 11 | Shim 概念与模式讨论 | baeldung.com/cs/software-engineering-shim; stackoverflow.com/questions/9512690 | Criticism/Community | 2024 等 | shim 的兼容职责与 adapter 区分——shim 作为债务载体的定性证据 |
| 12 | 技术债文献（HBS、Paddle） | hbs.edu/ris/Publication%20Files/2016-JSS%20Technical%20Debt…; paddle.com/resources/technical-debt | Criticism | 2016/常青 | shim/兼容层 rot 的学术与实务定性证据 |

（#8–11 为搜索摘要级 + 部分原文；#1–7 均为 web_fetch 全文核验。）

# 信息缺口

- **0.1.6-rc 的预计时间**：无官方路线图声明，只能从"0.1.5 rc 与 alpha 相隔 ≤2 天"的历史节奏推断"数周内"——中置信。
- **"known-delta ledger"是否有正式命名实践**：未找到以此命名的公开方法论；用 k8s 升级预演 + Renovate evidence packet 作为近邻佐证。
- **shim rot 的定量数据**：只有定性文献，无计量研究（此缺口不影响结论方向——C 在你们场景被架构理由独立否决）。

继续此会话，运行：atomcode -p "…" --resume c733af09-90ca-48ee-809a-98acc3b86d90
