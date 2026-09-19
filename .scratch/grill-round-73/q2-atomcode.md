# R73 Q2 atomcode 调研存档

## 调研问题原文

Research question — dependency pinning strategy against upstream drift in a pnpm 11.24.0 monorepo (anysearch-cli).

CONTEXT (verified facts, not assumptions):
- Package: apps/dsh-plugin — a private:true, zero-runtime-dependency Cordis bundle adapting DeepSeek Harness (dsh) to our hooks layer. All @deepseek-ai/* imports are type-only devDependencies by design ("compile-time churn alarm": upgrading dsh types must break tsc loudly, per our ADR-0073).
- Current devDeps: @deepseek-ai/cordis ^4.0.2, plus 4 dsh-* packages at ^0.1.5-rc.2 (dsh-agent, dsh-llm, dsh-system-prompt, dsh-tools). Runtime deps = {} by contract.
- pnpm-workspace.yaml already has an overrides: block (currently only zod), minimumReleaseAge: 2880 (minutes), pmOnFail: error, packageManager pnpm@11.24.0 pinned.
- Lockfile currently resolves all dsh-* to 0.1.5-rc.2 (= upstream latest dist-tag).

THE FAILURE WE OBSERVED (F7):
- Upstream published 0.1.6-alpha.1 which renamed event 'agent/session-start' → 'agent/created' (breaking our compile).
- A repin/regeneration test showed the tree drifting: 15 total @deepseek-ai/dsh-* packages exist in the tree (4 direct + 11 transitive), and EVERY ONE declares ^0.1.5-rc.2 internally — transitive packages re-resolve to 0.1.6-alpha.x on lockfile regeneration, producing a mixed-version tree with MessageId brand conflicts (tsc RED). Committed lockfile keeps fresh installs green, but any `pnpm up`/lockfile regen detonates.

CANDIDATE STRATEGIES:
- A (double lock): remove ^ from the 4 direct devDeps (exact 0.1.5-rc.2) AND add pnpm.overrides entries naming every @deepseek-ai/dsh-* package → 0.1.5-rc.2, plus cordis → 4.0.2.
- B: exact-pin the 4 direct devDeps only.
- C: pnpm.overrides only, keep ^ in package.json.
- D: rely on committed lockfile alone.

RESEARCH ASKS:
1. In pnpm 11.x, do pnpm-workspace.yaml `overrides` entries reliably force transitive dependencies of workspace devDependencies to the pinned version — including overriding semver ranges declared inside third-party packages? Any known caveats (peer-dependency resolution interactions, lockfile churn, overrides applying repo-wide to other workspace packages that might legitimately want different versions)?
2. Does pnpm overrides support name patterns/globs (e.g. `@deepseek-ai/dsh-*`), or must each of the ~15 package names be enumerated? Is there a cleaner mechanism for "pin an entire upstream family" (e.g. resolutions, pnpmfile hooks, catalogs)?
3. Industry mental models for pinning an unstable upstream dev-only dependency family: npm package.json `overrides`, yarn `resolutions`, cargo `[patch]`, go.mod `replace`, Dependabot/Renovate "pin then deliberately bump" workflows, lockfile-only discipline. What is the mature pattern for a preview-stage upstream that ships breaking changes between prereleases — and does the answer change when the pinned packages are devDependencies whose only purpose is compile-time API-surface alarms?
4. Should @deepseek-ai/cordis (^4.0.2, a separate stable-lineage framework package that hosts the Events declaration-merging interface) be pinned alongside, or does pinning it create unnecessary toil without closing the mixed-version hole?
5. Interaction with minimumReleaseAge:2880 — does pinning complement or conflict with a release-age gate? Does the age gate already prevent alpha drift in practice (alphas are <48h old at install time but not later)?
6. Any downside of exact-pinning devDeps we should know (Renovate/Dependabot compatibility, `pnpm up` behavior, audit tooling)?

Return: a clear recommendation among A/B/C/D (or a better-shaped variant), with reasoning, correctness notes on the pnpm mechanics, and the industry analogies that support it. Flag anything in the problem framing that is wrong or incomplete.


## 调研输出原文

[warning] 正在以管理员权限运行 — 模型可能可以访问系统文件。
I'll run this as a full research cycle: recall knowledge base first, then multi-angle searches across three engines, then verify key sources by reading them.知识库有 pnpm settings 相关历史索引，未覆盖 overrides 对传递依赖的强制细节。开始三引擎广泛搜索。继续定点深挖：读 pnpm 官方 dependency-resolution 文档全文与 glob 支持 issue，并补搜 minimumReleaseAge 对 prerelease 的行为与 Renovate/Dependabot 对精确版本的处理。继续补齐配额：读 glob issue 原文内容、搜 Renovate/Dependabot 对精确 pin 的行为，以及 pnpm overrides 通配符的现状讨论。补齐深挖配额：打开 Renovate pinning 官方立场文与 pnpm overrides 实战文，并补一搜 overrides 全仓库作用域的坑。补两个缺口：Exa 引擎交叉验证 + 打开 overrides 通配符讨论与 catalogs 文档原文。配额自查通过，进入综合输出。

---

## dsh 依赖族 pinning 策略调研报告

**Sufficiency Gate**: searches: 5 (Exa 1 / Tavily 3 / AnySearch 1) | angles: Official 官方(pnpm docs、npm RFC、Renovate docs)、Comparative 对比(Renovate pinning、ecosystem overrides 对比)、Criticism 批评(pnpm issue #5369、#7184、#10361)、Community 社区(konadu.dev、codenote.net、charpeni.com)、Currency 时效(2026 文章与 pnpm 11/12 文档) | full reads: 6 (pnpm dependency-resolution docs 全文、pnpm catalogs docs、GitHub issue #5369、discussion #9990、konadu.dev 全文、Renovate dependency-pinning 全文) | gaps: ① 未见 pnpm 11.x 专门针对「 prerelease dist-tag 混合树」的官方立场文；② overrides 是否在 *lockfile 重新生成*时（非普通 install）对 transitive 生效，文档直接陈述成立但无独立二源实测复现。

### 1) 执行摘要 (Tl;dr)

**推荐 A（双锁：直接 devDeps 去掉 `^` 精确 pin + overrides 逐名枚举 ~15 个 @deepseek-ai/dsh-* → 0.1.5-rc.2），Confidence 高。** pnpm 11 的 overrides 明确「override 依赖图中任何依赖（含 transitive 与 peer），忽略上游声明的 range」，且必须枚举包名——不支持通配符，catalog 只是单点维护不是通配机制。B/C/D 各留一个洞：B 管不住 11 个 transitive（正是 F7 爆炸点）、C 让 package.json 与 overrides 语义漂移、D 在任何 lockfile regen 时失效（已实证）。cordis 建议一并 pin（成本一行，收益是 Events declaration-merging 接口面稳定），minimumReleaseAge 2880 与 pin 是互补而非冗余。

### 2) 分点结论

**Q1 — overrides 对 transitive 的强制力与 caveat（Confidence 高，双源：pnpm 官方文档 + konadu.dev 实战 + DeepWiki/pnpm 自用 40+ overrides）**
- pnpm 官方原文：「instruct pnpm to override **any dependency in the dependency graph**, including peer dependencies」——即包括第三方包内部声明的 `^0.1.5-rc.2` 也会被改写成 pinned 版本。konadu.dev（2026-06）实战文与此一致：「force a single resolved version across the entire dependency graph, including transitive packages you do not control」，并用 `pnpm why` 验证了 3 层深的 transitive 被 pin 住。
- ⚠️ 关键 caveat（pnpm 11 特有）：**overrides 只能写在 root 的 pnpm-workspace.yaml**。pnpm 11 已停止读取 package.json 的 `pnpm.overrides` 字段，且是**静默忽略不报错**（konadu.dev 明确警告）——你们的 overrides 已在 pnpm-workspace.yaml，正确。
- ⚠️ 作用域是**全仓库 repo-wide**，不是 per-workspace-package：pnpm 文档明确 overrides 「can only be set at the root」，且 shared workspace lockfile 下 per-project 的解析设置会被忽略并报告。任何其他 workspace package 若将来想用不同 dsh 版本，会被同一把 override 按住。以 dsh-plugin 是唯一 dsh 消费者的现状，这是可接受的；将来出现第二个消费者时用 `parent>child` 选择器或 convergence override 解决。
- ⚠️ peer 交互：override 值是精确版本（非 range）时，如果 dsh 包之间有 peerDependencies，peer 会被 override 并**降级移入 dependencies**（文档：「Non-range specifiers … moved to dependencies」）。精确版本字符串属于非 range specifier——对 type-only 编译期依赖无运行时影响，但会在 node_modules 结构上产生可见变化，属预期内。
- lockfile churn：每次改 override 必须同时重新生成并提交 pnpm-lock.yaml，否则 CI `--frozen-lockfile` 在 specifier-mismatch 门口直接失败（konadu.dev 的「frozen lockfiles in CI」节）。这是纪律问题不是机制缺陷。

**Q2 — 通配符与「pin 整个上游家族」的机制（Confidence 高，双源：GitHub issue #5369 + npm RFC 0036 + pnpm 文档无任何通配语法）**
- **overrides key 不支持 glob**。pnpm issue #5369 实证：`resolutions` 里写 `apollo-server-express/**/graphql-tools` 直接抛 `ERR_PNPM_INVALID_OVERRIDE_SELECTOR`；npm RFC 0036 明确拒绝 glob 设计（「Using a nested object expression that does not support `**`…」并陈述了理由）；pnpm 当前文档的选择器语法只有 `pkg`、`pkg@range`、`parent>child` 三种，无任何通配。注意：Yarn 的 `resolutions` *支持* `**` 路径语法，这是三家的差异点，别混淆。
- 所以 **15 个包名必须逐个枚举**。更干净的替代不是通配，而是 **catalog + overrides 联动**：把 15 个版本号定义在 `catalog:` 里，package.json 写 `catalog:`、overrides 写 `catalog:` 引用——升级时只改 catalog 一处（官方文档专门为这个场景写了示例）。**这是 A 方案的改进形态：枚举仍不可免，但 15 个版本号收敛到 1 处，消除「package.json 和 overrides 改不同步」这一 A 的主要操作风险。**
- pnpmfile `readPackage` hook 也能实现全族改写（可用前缀匹配逻辑），但它是程序化方案，可审计性和声明性都差于 overrides，不推荐。
- 另一个值得注意的新机制：**convergence override**（`"pkg@": 精确版本`，pnpm 11.13+）——只重写「声明 range 满足该版本」的边。对本场景**不适用**：dsh-* 内部声明 `^0.1.5-rc.2`，prerelease 语义下 `^0.1.5-rc.2` 是否「满足」0.1.5-rc.2 取决于 range 语义细节，而你们要的是无条件钉死（连未来合法的 `^0.1.5-rc.3` 也先按住），普通 override 语义正合适。

**Q3 — 行业心智模型（Confidence 中高，源：Renovate 官方 pinning 立场文 + cargo/go/NuGet/CVE 应急惯例）**
- 主流模拟物：npm `overrides` / yarn `resolutions` / cargo `[patch]` / go.mod `replace` / NuGet CPM `CentralPackageTransitivePinningEnabled` / Maven `dependencyManagement`——**全部是「显式声明 + 无条件强制全树」语义**。没有一个主流生态提供「按上游家族前缀通配 pin」。
- 对 **prerelease 期上游**的成熟模式，Renovate 官方文给出了最贴近的表述：pin 的核心价值是「breaking release 不会自动进 main，而是变成一个**失败的 upgrade PR** 等你审」——把上游漂移从「静默爆炸」转为「显式评审点」。这正是你们 ADR-0073 的 compile-time churn alarm 的依赖层对应物。
- 「devDependency + 编译期告警」这个特殊点：**答案不变，反而加强 pin 的理由**。普通库担心 pin 导致用户侧 node_modules 重复安装——但 dsh-* 是 private bundle 的 devDeps，不发布、无下游消费者，Renovate 官方文对「app / 非 require()'d 包」的建议就是「**pin all types of dependencies for greatest reliability**」；对 devDeps 的建议也是「can use pinned dependencies」。你们的场景是双重满足。
- 反向提醒（社区共识，konadu.dev + supply-chain 文）：override 应视为**临时逃生舱、要带追踪票据**。但你们的情况不同——这不是等上游修 CVE 的临时 pin，而是「preview 上游不稳定期的主动治理」。建议在 overrides 块上写注释指明解锁条件（dsh 出 stable 后移除 overrides、恢复 `^` 或切 catalog range），避免 pin 无声地活过它的保质期。

**Q4 — cordis 是否一并 pin（建议：pin，Confidence 中）**
- cordis 是 Events declaration-merging 的宿主接口——`agent/created` 这类 MessageId 品牌类型恰好长在 cordis 的类型面上。0.1.6-alpha.1 的事件改名事故同时穿过 dsh 类型层和 cordis 接口层；只 pin dsh 不 pin cordis，等于给告警链路留一个 `^` 后门。cordis 是 stable lineage（4.x），pin 的 toil 极低（几乎不会有升级 PR 打扰），收益是声明合并面完全确定。成本收益明确成立。可单独评估：若 cordis 4.x 内部稳定且你们实际从未在升级时被动过，也可以留在 `^` 并依赖 tsc 报错兜底——这不是混合版本洞的一部分（它不解析 dsh-*），风险等级低一档。

**Q5 — 与 minimumReleaseAge:2880 的交互（互补，非冗余，Confidence 高）**
- age gate 是**install 时**的相对时间门：它挡的是「刚发布的版本立刻被装进来」。而 F7 的爆炸点不在 install 时——committed lockfile 里已经钉着 0.1.5-rc.2，下次 `pnpm up`/regen 时 0.1.6-alpha.1 早已超过 48 小时，age gate 毫无防备。**age gate 防供应链投毒（新鲜恶意版本），pin 防语义漂移（破坏性改名），二者威胁模型正交。**
- 一个真实的二阶细节：pnpm 11 起 `minimumReleaseAge` 显式配置时 `minimumReleaseAgeStrict` 默认 true——若 2880 分钟内整个 `^0.1.5-rc.2` range 里没有满足年龄的版本，解析直接失败。这正是你想要的（fail loudly），与 pin 的哲学一致。
- 另注意 `minimumReleaseAgeExclude` 支持 scope glob 但有 first-match bug 记录（tangled.org 复盘 + pnpm issue #10361）——不要试图用它反向豁免 dsh 族，保持现状即可。

**Q6 — 精确 pin devDeps 的代价（Confidence 高）**
- **Renovate**：完全兼容，且有专门的 `pin` rangeStrategy 和 pin-dedicated update type；精确版本是 Renovate 推荐用法而非边缘情况。Dependabot 同样支持。代价只是升级 PR 变多（Renovate 文档详述的 noise trade-off），可用分组（dsh 族 15 个包 group 成一个 PR——Renovate 官方文点名「all babel packages」这种同族分组正是你们要的形态）。
- **`pnpm up`**：`pnpm up` 默认尊重声明 range——精确版本下 `pnpm up` 不会动它（好事，这就是防 regen 漂移的机制）；要升得显式 `pnpm up dsh-agent@0.1.6` 或改 package.json。`pnpm up --latest` 会无视并推到最新——CI 里如果有人跑这个需要知道它连 override 也会一起重算（override 仍会按住版本，产生 stale-override 警告而非破坏）。
- audit 工具：无负面影响；`pnpm why`/`pnpm audit` 正常工作，且精确版本让 audit 范围确定。
- 唯一值得写的坑：**A 方案里 overrides 与 package.json 双处写同一个版本号**——用上面 Q2 的 catalog 形态消除这个双写。

### 3) 方案对比矩阵

| 方案 | 直接 deps 防漂移 | 11 个 transitive 防漂移 | lockfile regen 后存活 | 维护面 | 裁定 |
|---|---|---|---|---|---|
| **A 双锁 (+catalog 改形)** | ✅ 精确版本 | ✅ overrides 全树强制 | ✅ override 是解析输入不是缓存 | 15 名枚举，catalog 收敛到 1 处版本 | **✅ 推荐** |
| B 仅精确 pin 直接 deps | ✅ | ❌ 正是 F7 爆炸点 | ❌ transitive 随 regen 漂到 0.1.6-alpha | 最小 | ❌ 不够 |
| C 仅 overrides | ❌ package.json 仍宣称 ^，语义漂移、`pnpm outdated` 噪音 | ✅ | ✅ | 单处但声明失真 | ⚠️ 次选 |
| D 仅 committed lockfile | ✅（仅 frozen install） | ✅（仅 frozen install） | ❌ 任何 `pnpm up`/regen 即爆（已实证） | 零 | ❌ 已被 F7 证伪 |

### 4) 推荐落地形态（A 的 catalog 改形）

```yaml
# pnpm-workspace.yaml
catalog:
  # dsh preview family — compile-time churn alarm (ADR-0073)
  # 解锁条件：dsh 发布 stable 后移除 overrides、catalog 改回 range
  "@deepseek-ai/cordis": 4.0.2
  "@deepseek-ai/dsh-agent": 0.1.5-rc.2
  "@deepseek-ai/dsh-llm": 0.1.5-rc.2
  "@deepseek-ai/dsh-system-prompt": 0.1.5-rc.2
  "@deepseek-ai/dsh-tools": 0.1.5-rc.2
  # …其余 10 个 transitive dsh-* 逐名枚举，从 lockfile 现状取名字
overrides:
  "@deepseek-ai/cordis": "catalog:"
  "@deepseek-ai/dsh-agent": "catalog:"
  # …同上逐名
```
apps/dsh-plugin 的 devDeps 改为 `"@deepseek-ai/dsh-agent": "catalog:"` 等。改完 `pnpm install` 重新生成并**同一 commit 提交** pnpm-lock.yaml。

### 5) 问题框架修正

1. **「15 个包都要写进 overrides」隐含假设 transitive 名单静止**——dsh 下个版本若新增内部依赖包，它不在 overrides 里、其自身声明的 range 会漂移。缓解：CI 加一道守门（regen 后 `pnpm why @deepseek-ai/dsh-* --depth Infinity` 断言无混合版本），或在 ship-gate 里加 lockfile diff 检查新增 @deepseek-ai/* 条目。
2. **「compile-time churn alarm 由 `^` 语义保证」的前提本身已被 F7 打破**——`^0.1.5-rc.2` 对 prerelease 的 range 语义（node-semver 中 `^` 对 prerelease 只匹配同 [major,minor,patch,prerelease-id] 组合）意味着上游发 0.1.5-rc.3 时直接 deps 会静默吸收——真正想要的「升类型必须响铃」要求精确版本，B 的直觉是对的，只是不够。
3. **框架遗漏**：F7 混合树不只威胁编译——若 dsh 事件名在运行时字符串里出现（hooks 层的 matcher、事件注册表），runtime deps = {} 不保护这些字面量。pin 解决版本混合后，事件名迁移仍需一次显式 grep 确认无 `'agent/session-start'` 字面量残留。

### 6) 完整来源清单

| # | 标题 | URL | 角度 | 日期 | 贡献 |
|---|---|---|---|---|---|
| 1 | pnpm Dependency Resolution Settings（overrides/catalog/minimumReleaseAge 全文） | https://pnpm.io/settings/dependency-resolution | Official | 当前 12.x | overrides 全树强制语义、peer 行为、convergence override、catalog 联动、age gate 语义 |
| 2 | pnpm Catalogs 文档 | https://pnpm.io/catalogs | Official | 当前 | catalog: 可用于 devDependencies + overrides 的官方确认 |
| 3 | pnpm issue #5369 — glob in resolutions 报 ERR_PNPM_INVALID_OVERRIDE_SELECTOR | https://github.com/pnpm/pnpm/issues/5369 | Criticism | 2022-09 | overrides/resolutions 不支持 glob 的直接实证 |
| 4 | npm RFC 0036 — overrides 设计裁决 | https://github.com/npm/rfcs/blob/main/implemented/0036-overrides.md | Official | 已实施 | 拒绝 glob 的设计理由；overrides 仅 root 生效 |
| 5 | Fix a Transitive CVE with pnpm overrides | https://konadu.dev/pnpm-overrides-fix-transitive-dependency-vulnerability | Community | 2026-06-17 | pnpm 11 忽略 package.json pnpm.overrides 的静默失败警告；frozen-lockfile 必须同 commit；pnpm why 验证法 |
| 6 | Should you Pin your JavaScript Dependencies? — Renovate 官方 | https://docs.renovatebot.com/dependency-pinning/ | Official/Comparative | 当前 | app/非发布包应全 pin；devDeps 可 pin；pin 把破坏性更新转为可评审 PR |
| 7 | Renovate Configuration Options（rangeStrategy: pin） | https://docs.renovatebot.com/configuration-options | Official | 当前 | Renovate 对精确版本的一等支持 |
| 8 | pnpm issue #7184 — resolutions/overrides 在 shared-workspace-lockfile=false 下行为变化 | https://github.com/pnpm/pnpm/issues/7184 | Criticism | 2023 | overrides 作用域与 lockfile 模式交互的历史坑 |
| 9 | pnpm issue #10361 — minimumReleaseAgeExclude 在 --fix-lockfile 下不被尊重 | https://github.com/pnpm/pnpm/issues/10361 | Criticism | 2025-12 | age gate exclude 机制的可靠性边界 |
| 10 | minimumReleaseAgeExclude first-match bug 复盘 | https://tangled.org/aquati.cat/Monochromatic/blob/dac09d52780b631a9c2d66e9e4e9f2274911ab06/docs/troubleshooting/pnpm-minimum-release-age-exclude-first-match.md | Criticism | 近期 | exclude first-match 缺陷，支撑「别用 exclude 反向豁免 dsh 族」 |
