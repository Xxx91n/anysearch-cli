# atomcode R80 Q4 调研存档 — 派生件新鲜度腿落点与覆盖面

> 调研时间：2026-09-23；引擎：Exa+AnySearch（Tavily 全程不可用）；问题原文见 q4-prompt.txt

searches: 10 | angles: Official/Comparative/Criticism/Currency/Community 全五类 | full reads: 8 | gaps: Tavily 缺席（双引擎覆盖）；「claims re-derivation」无专有工具名先例，属 fitness function+executable docs 组合推断

## 1) 执行摘要

工业界对「入库生成件/派生件的新鲜度」的成熟落点几乎一致——**生成→diff→exit-code 的 CI 闸是权威落点，pre-commit 只是提速便利，专职 scheduled job 是兜底而非主闸**（fern「gate the merge rather than the release」、gitlab-runner `check_generated_files`、photoview #1105、go 生态 `go generate ./... && git diff --exit-code` 全部同构）。对本仓三选项：**推荐 A（扩展 ship-gate step 1 家族）**，理由是 R79-F1 已实证「闸存在但覆盖面缺口」，A 是在已验证正确的 fail-closed 同构序列上补覆盖面，工程面最小、与 R80 票序 T3 直接咬合；B 被否因为 release-gate 只护 tag 前一刻，而 R74-F2~R79-F1 的病发面是**每次收口**；C 被否因为非闸化自律正是被 9 场审计中 4 场裁决证伪的机制。「声明计数重推导」可行边界：**有推导命令的注册进 closeout-coverage 信号面（机验），无推导器的叙述性声明（「为什么」「人审裁定」）留人验**。

## 2) 分点结论

**结论 1：生成件新鲜度的成熟执法落点 = CI 内「再生成+diff --exit-code」，且是唯一有保证的落点**
- Fern 指南核心论题："drift is a pipeline problem, not a discipline problem"——CI fail when change not reflected everywhere；"gating the merge rather than the release"。四种 drift 里 hand-written 内容漂移最难治——与本仓「记录的记录」病灶同构。
- gitlab-runner v17.11.3 Makefile 实物：go generate 后接 check_generated_files target 查 diff；Go 生态标准配方 `go generate ./... && git diff --exit-code`。
- photoview #942→#1105 闭环：社区从「要不要移出 git 跟踪」收敛到「CI 里 regenerate+通知 diff」。
- 失效模式：依赖人跑 generate（纪律问题）→漂移累积偏向乐观版本。

**结论 2：闸的合法位置在 merge gate，不在 release gate**
- datadef 分类：link check（PR 闸）、prose lint（error 级闸）、freshness gate（critical 页面才 block，其余 scheduled）、doc-update 配套规则（先 warn 后 fail，硬 fail 教人写垃圾编辑满足 bot）。
- 断言强度分档：索引新鲜度/CHANGELOG 条目在场=客观可修→闸；「声明是否真实」=机验代理信号+人验兜底。

**结论 3：pre-commit hook = 降 CI churn 的便利，不是保证**
- motlin：CI 检查才重要，pre-commit is just a convenience；双轨要求同版本产生 double accounting。
- HN：pre-commit just there to lower CI churn, not to guarantee anything。选项 C=把权威检查降级为便利层，工业界一致反对。

**结论 4：CHANGELOG/changeset 在场性 lint 有直接成熟先例**
- changesets 官方三档：bot 提示（非阻断）→CI `changeset status --since=main`（exit 1）→`--empty` changeset 显式豁免通道。
- 本仓映射：CHANGELOG 轮次条目在场断言应配**显式豁免字段**（no-changelog-entry: <理由>），否则闸教人写垃圾条目——与 datadef「hard fail invites token edits」交叉印证。
- release-please/semantic-release 生态从不做在场性 lint（生成器即单点）；本仓人写+门禁查在场=「单一事实源+门禁校验」列，失败模式「人忘改」正是本腿要根治的。

## 3) 对比矩阵

| 落点 | 例子 | 保证强度 | 失效模式 | 适合 |
|---|---|---|---|---|
| CI merge gate（regen+diff exit code） | gitlab-runner check_generated_files、fern check、changesets status --since、gen-adr-index --check | 强（不可绕） | 闸面没注册的派生件漏网（R79-F1 即此） | 一切入库派生件 |
| pre-commit hook | photoview husky 提案、pre-commit.com | 弱（--no-verify/未装即失效） | tragedy of the commons | 提速便利非权威 |
| 专职 freshness job（scheduled） | Terraform drift cron、frontmatter-validator | 中（异步发现晚于入库） | 发现时污染已扩散 | 外部世界变化非仓内漂移 |
| 收口自律（无闸） | — | 无 | 已被 4/9 败审实证 | 仅适合无法推导的人验面 |

三选项对比：A 采纳（R79 实证+业界模型一致）；B 否（release-gate 只护 tag 前一刻，病发面是每次收口；gate the merge rather than the release）；C 否（非闸化自律=复刻已四次失败的路径）。

## 4) 建议落地形态（A 选项内的粒度票内定输入）

1. **CHANGELOG 轮次条目在场断言**（新子步）：类 `changeset status --since=main` 语义——对当前轮次号断言 CHANGELOG.md 有对应条目；配显式豁免字段（`no-changelog-entry: <理由>`）防垃圾条目。
2. **声明注册面**：有机验命令的声明（如「27/27」计数）注册进 closeout-coverage 信号面，收口时重推导比对；声明与推导命令在同一次 diff 里变更（golden file「test 与 baseline 同 diff」原则）。
3. **闸强度分档**（datadef 分级）：在场性/计数这类客观可修的=fail；叙述一致性代理信号=可先 warn 一轮再升 fail，避免 token edits。

## 5) 「声明重推导」可行粒度边界

**值得机验化**（fitness function 客观性判据）：计数类声明（有推导命令或可重算的注册面）、符号/路径存在性（文档提及的脚本/文件/闸名是否在仓库实物中存在——dosu 符号级漂移形态）、日期/轮次号在场、结构化声明（frontmatter 式可解析字段）。

**只能留人验**（dosu/datadef 一致边界："not machine-checkable from the text alone"）：叙述性因果解释（「为什么这样裁」）、人审裁定记录本身、与外部未入库事实的对照（如 OIDC 配置是否正确）。这类留人验但**要求其引用的可机验部分已被机验**——即人验只验机器验不了的那一层。

## 6) 完整来源清单

| 标题 | URL | 角度 | 贡献 |
|---|---|---|---|
| Stopping schema drift (Fern) | buildwithfern.com/post/stopping-schema-drift-coupling-sdks-documentation-claude | Official/Comparative | drift is a pipeline problem、gate the merge、四类 drift |
| Documentation checks in CI (datadef) | datadef.io/guides/en/docs-checks-in-ci | Official | 闸强度分档、freshness gate、warn-vs-fail 教训 |
| How Fresh Are Your Docs (Dosu) | dosu.dev/blog/score-documentation-freshness-in-ci | Currency | 三信号、符号级漂移=声明重推导成熟形态、28.9% 过期引用 |
| Automating Changesets | changesets.dev/guide/automating | Official | 在场性三档+--empty 豁免通道 |
| changesets CLI README | github.com/changesets/changesets/blob/main/packages/cli/README.md | Official | --since CI check 及官方保留意见 |
| Golden File Management (qaskills) | qaskills.sh/blog/regression-testing-golden-file-management | Official/Criticism | baseline 与 test 同 diff、显式更新路径、反模式表 |
| Fitness Functions (InfoQ) | infoq.com/articles/fitness-functions-architecture/ | Official | 客观性判据（可测→机验，主观→人验） |
| Pre-Commit or CI/CD (motlin) | motlin.medium.com/pre-commit-or-ci-cd-5779d3a0e566 | Comparative/Criticism | pre-commit 双轨 double accounting、common tragedy |
| pre-commit vs. CI (switowski) | switowski.com/blog/pre-commit-vs-ci/ | Comparative | 毫秒级→pre-commit、慢→CI 分工规则 |
| Pre-commit hooks are broken (HN) | news.ycombinator.com/item?id=46398906 | Community | lower CI churn, not guarantee |
| photoview #942 | github.com/photoview/photoview/issues/942 | Community | 社区收敛到 CI regenerate+diff |
| gitlab-runner Makefile | gitlab.com/gitlab-org/gitlab-runner/-/blob/v17.11.3/Makefile | Official | check_generated_files 实物 |
| Go generate CI playbook | refontelearning.com/blog/go-1-27-adoption-playbook | Currency | go generate && git diff --exit-code 配方 |

## 7) 信息缺口

- Tavily 引擎全程额度不可用，三引擎降级为双引擎；但每条关键结论均有 ≥2 独立信源。
- 「声明计数重推导」无同名成熟工具/论文，属 fitness function+executable docs+dosu 符号漂移三族的组合推断——报告已标注为推断而非先例。
- gitlab-runner Makefile 与 refontelearning playbook 仅搜索摘要命中配方片段，未全文抓取（配方本身有 photoview/fern 两处全文交叉支撑）。
