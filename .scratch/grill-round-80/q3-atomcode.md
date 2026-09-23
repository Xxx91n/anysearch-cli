# atomcode R80 Q3 调研存档 — dsh-plugin 首发路径（npm TP 新包 chicken-and-egg）

> 调研时间：2026-09-23；引擎：Exa+AnySearch+ctx 召回（Tavily 配额超限）；问题原文见 q3-prompt.txt

**Sufficiency Gate**: searches: 7 (Exa×3 + AnySearch×3 + ctx 召回) | angles: Official/Comparative/Criticism/Currency/Community 全五类 | full reads: 7 (docs.npmjs.com、npm/cli#8544、changesets CLI、Fern、adebayosegun、candidstartup、philna.sh) | gaps: 无重大缺口；TP 数量上限存在新旧文档冲突（结论 4）

## 1) 执行摘要（Tl;dr）

npm OIDC trusted publishing **不能用于包的首发**——trusted publisher 配置挂在包自身的 settings 页上，包不存在则无处配置（Confidence 高：npm 官方文档 + npm/cli#8544 + CircleCI/Fern 独立三源一致）。因此 A/B/C 三选项中**推荐 A（预首发）**：用户手动发 0.0.7（真实版本，非占位符）→ 配 TP → 0.0.8 起五包统一走 OIDC。B 的幂等跳过腿是自建机器且有版本碰撞坑，且 dsh-plugin 首发版本无论如何都拿不到 OIDC provenance，B 并不省事；C 把 pack 清单接入递延，净损失一轮。0.0.7 无 provenance 属**低级后果**，与 0.0.3 先例同类且已有 ADR-0064 D-006 记档。

## 2) 分点结论

**结论 1（问题 1）：OIDC TP 对尚不存在的包 = 不可行，官方明确排除首发场景。**
- npm 官方文档原文流程是「Navigate to your package settings」——配置入口在既有包的 Settings→Trusted publishing（docs.npmjs.com/trusted-publishers/，2026-09-03 更新）。
- npm/cli#8544（2025-08-31）官方团队回复：首发不走 OIDC 是 MVP 主动砍范围（"We determined to not have first publish available to limit scope… is on our minds"），PyPI 式预配置在评估中但未落地；issue 至今 Open。
- `npm trust` CLI 文档硬性前提："**Package must exist**: The package you're configuring must already exist on the npm registry"。CircleCI 官方指南同样要求 "npm package that has already been published at least once"。
- 社区通行解法正是「占位首发再配 TP」：azu/setup-npm-trusted-publish 工具专为此存在；Fern 官方文档直接给出 `0.0.0` 占位发布脚本；npm/cli#8544 评论区 "Many devs just make publish v0.0.1 as placeholder"。

**新包首发的官方支持自动化路径**：
| 路径 | 能否首发 | provenance | 安全后果 |
|---|---|---|---|
| 手动 `npm publish` + OTP | ✅ 唯一 TP 前置路径 | ❌（本地无 CI OIDC 环境） | 无长效密钥，风险最低 |
| Granular Access Token | ✅（granular token 不受 2025-12 classic token 吊销潮影响） | ✅ 可带 `--provenance` + repository 字段 | 90 天上限，需存 GitHub secret，可泄露需轮换 |
| OIDC trusted publishing | ❌ 包必须先存在 | ✅ 自动 | 无 secret，最优 |

**结论 2（问题 2）：monorepo 新包入列车的成熟模式 = 预首发，而非幂等跳过。**
- 预首发是 Fern、azu、candidstartup 三方共同实践——工业界默认。
- 幂等 publish 依赖 npm view 判存在：changesets#2164 实证坑（npm 12 改变 `npm info --json` 输出结构后存在性检测全坏→全包重发）；`npm publish` 非幂等（重发 E409），lerna `publish from-package` 才解决。自建 npm view 判存在=重蹈坑。
- 单独首发轨（C）存在于 lerna/changesets 的 --ignore 机制，但它是「排除」语义，本仓硬编码 pack 清单模式下等于维护两套清单。

**结论 3（问题 3）：推荐 A，否决理由如下。**
- **B 否决**：v0.0.8 tag 直接含 dsh-plugin 时，TP 未配置→publish 必然 ENEEDAUTH 失败；补救只能是①幂等跳过腿（自建 npm view 检测，见结论 2 踩坑）或②首发例外路径——而②实质就是 A 的手动首发，只是把它藏进失败重试里，把「确定性的一次手动操作」劣化为「一次必然失败的 CI+事后人工干预」，且 dsh-plugin 的 0.0.8 首发版拿不到 provenance（比 A 的 0.0.7 更晚覆盖起点）。版本碰撞风险（0.0.8 首发失败后该版本号永久作废，npm 不允许同版本重发）是硬伤。
- **C 否决（弱否决）**：技术上无害但零收益——pack 清单接入本身就是 R80 的产品腿内容，递延 R81 只是把同样的活搬到下一轮，且 v0.0.8 自动化面「五缺一」破坏 sync-bump 全仓同号的发布惯例整洁性。
- **A 推荐**：与 Fern/azu/candidstartup 的工业界心智模型完全一致——**真实版本手动预首发**优于占位包（0.0.7 不是空壳，keyword dsh-plugin 入目录、dsh 宿主可立即安装验证，兼容性追踪义务从真实版本起算）；TP 配置后 0.0.8 起五包统一 OIDC+自动 provenance，pack 清单一次性接入。

**结论 4（附）：TP 数量上限存在信源冲突，按官方文档取新值。** adebayosegun 博文（2026-03）与旧版文档说「每包仅一个 trusted publisher」，但 docs.npmjs.com（2026-09-03 更新版）说「up to 10 trusted publishers」。**以官方文档为准**（10 个），对本案无影响（单 workflow），但意味着 R66 时代「一包一 TP」的认知需更新。另注意 **2026-05-20 起新建 TP 配置须显式勾选 allowed actions，配置时勿漏勾 `npm publish`**。

## 3) 0.0.7 无 provenance 的后果等级评估

低级后果：与 0.0.3 先例同类（手动首发无云 runner OIDC 环境→无 sigstore provenance），ADR-0064 D-006 已记档为已知后果非缺陷；provenance 覆盖起点=0.0.8 起自动带上，与 sibling 包的覆盖起点同型。

## 4) 完整来源清单

| 来源 | URL | 角度 | 贡献 |
|---|---|---|---|
| npm 官方文档 Trusted publishing | https://docs.npmjs.com/trusted-publishers/ | Official | 配置入口在既有包设置页；自动 provenance 条件；10 TP 上限；2026-05-20 allowed-actions 变更 |
| npm/cli#8544 | https://github.com/npm/cli/issues/8544 | Official/Criticism | 官方确认首发不走 OIDC 是 MVP 砍范围，占位包解法 |
| npm trust CLI 文档 | https://docs.npmjs.com/cli/v11/commands/npm-trust/ | Official | "Package must exist" 硬性前提 |
| Changesets CLI 文档 | https://changesets.dev/guide/cli | Official | publish 内建存在性检查机制；accidental publishes 警示 |
| changesets#2164 | https://github.com/changesets/changesets/issues/2164 | Criticism | npm 12 下存在性检测全坏→全包重发的实证坑 |
| Fern 发布文档 | https://buildwithfern.com/learn/sdks/generators/typescript/publishing | Official | 官方背书「0.0.0 占位首发→配 TP」流程模板 |
| candidstartup 博文 | https://www.thecandidstartup.org/2026/01/26/bootstrapping-npm-provenance-github-actions.html | Community/Criticism | monorepo 接入 TP 三次试错实录；npm publish 非幂等；lerna from-package 解 |
| adebayosegun 博文 | https://www.adebayosegun.com/blog/changesets-and-trusted-publishing-on-git-hub-actions | Community | changesets+TP 完整流水线；token 路 provenance 替代方案 |
| philna.sh 博文 | https://philna.sh/blog/2026/01/28/trusted-publishing-npm/ | Community/Criticism | 实战坑位：--provenance 需显式、包级设置页位置、repository 字段 |
| azu/setup-npm-trusted-publish | https://github.com/azu/setup-npm-trusted-publish | Community | 专用占位首发工具，证明该模式的普遍性 |
| CircleCI 官方指南 | https://circleci.com/docs/guides/deploy/deploy-to-npm-registry/ | Official | "already been published at least once" 第三方独立确认 |
| toolchew 指南 | https://toolchew.com/en/how-to-publish-npm-package-2026/ | Community | "The first publish must use a token, not Trusted Publishing" |
| 上下文知识库（ctx 召回） | R63 Q5 / R66 D-005 / CONTEXT.md | Local | 本仓 TP pipeline 心智模型、「包成立后逐包配 TP」欠条先例、0.0.3 先例 |

## 5) 信息缺口

- npm/cli#8544 仍 Open，官方「新包 OIDC 预配置」何时落地无时间表——若 R81+ 期间落地，C 选项可能变优，但按当前 0.0.8 列车节奏不构成等待理由。
- pnpm `publish -r` 与 OIDC 的组合细节未深查（本仓 release.yml 是 npm 直发，pnpm 侧 publish 命令的存在性检查行为与 changesets 类似但未实测）——对本案 A 方案无影响。
- Tavily 引擎本次配额超限未参与交叉验证；核心结论均有 ≥3 个独立信源（含两个官方源），不影响置信度。
