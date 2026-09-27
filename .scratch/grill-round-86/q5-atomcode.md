# Q5 atomcode 调研存档 — 装船工序、披露惯例与版本学

调研时间：2026-09-27 · 问题原文见 q5-prompt.txt

## 1) 执行摘要（TL;DR）

**推荐方案 A 七票序，T4（判读器语义修正+记分簿诚实化）保持在 T5 复跑之前，且推荐 B1 作为不可复活分支**（置信度高）。核心依据：业界标准 pipeline 形态正是「门修复→根因判别→验证→文档/记分→发布」，文档修正放在复跑前是因记分簿描述的判读语义必须与复跑所用判读器一致（判定者先于被判定物修订）。B1 的本质是「ship with known issue」的标准发布形态：正确性修复与上游健康正交，fail-open 一等降级态=架构自带的 kill-switch/feature-flag 降级等价物。

## 2) 分点结论

**2.1 工序排序：A 七票序是标准 pipeline 形态（置信度高）。** 持续交付标准形态=gate 修复→验证→发布；「a quality gate that can be skipped is not a gate」（minware/CI gate 惯例：failing gate 后强行 deploy 是经典反模式）。Nautobot 官方 release checklist 一手印证 T1→T4→T6 顺序：先 verify CI build status，再文档修订与 release notes 准备，最后 publish——文档与记分修正属 release preparation 阶段，位于发布前而非发布后。dionysopoulos 反面案例同样支持「门绿实证才推进」：修复存在但未发布、披露不显眼=三重失败。

**2.2 T4 放在 T5（复跑）之前是唯一自洽排法（置信度高）。** (a) 判读器语义修正改变「什么算绿」的定义——复跑必须用修正后的判读器跑，否则复跑结果需按旧口径二次重算，违反「旧件不复算」原则；(b) release checklist 惯例（Nautobot、linear-cli）把 documentation/CHANGELOG 修订作为 tag 前硬项（"ALWAYS update CHANGELOG BEFORE creating tag"）。唯一反例场景「先复跑再写判词」不成立——R85 判词诚实化降级不依赖复跑结果，是既有判词的口径修正。

**2.3 「ship with known issue」有强先例与成熟披露惯例（置信度高）。** Ubuntu 25.10/Debian trixie/Visual Studio 2026 的 release notes 都有正式 Known Issues 节，惯例为每条 known issue 配 workaround+影响范围+修复状态（Good Docs 模板：known issue=不会在本发布解决的技术问题，须披露）。anysearch 臂维持 fail-open 一等降级态=Unleash 分类的 kill switch 型 flag（gracefully degrade system functionality，永久性）——feature flag 惯例明确认可的降级组件装船形态。dionysopoulos 案例给出披露位置纪律：不能只写进 blog/ADR，必须在用户会撞到的地方（README/CLI 输出/装船判词）显著呈现——本仓库即 closeout-claims 与 ADR 均须明确「anysearch 上游不可达→fail-open 返回空结果」为已知降级，而非埋在变更列表。

**2.4 版本学：v0.0.9 patch 切版正确，但有一个前提（置信度高）。** semver 2.0.0：PATCH=backward compatible bug fixes；MINOR=新增向后兼容功能。MCP 迁移是死端点正确性修复→patch；但批次含垂域贯通（新功能面）按 Conventional Commits 应判 MINOR。豁免条款：0.y.z 为 initial development「anything MAY change」，0.x 阶段区分放宽（release-please 默认 bump-minor-pre-major:false 即 feat 也只 bump patch）。建议：坚持「fix 语义优先」叙事用 0.0.9 合理；想向下游信号「本次含新能力（垂域贯通）」用 0.1.0 更诚实——0.y.z 内 0.0.x→0.1.0 是「首个可感知功能集」常见信号位。一票可选项，不阻塞。

**2.5 批次风险（matrix 注）**：六轮积压一次装船有风险（Big Bang Release 反模式：归因困难、回滚含糊），靠判别链+回滚预案缓解；B2 押后使批次继续膨胀风险更大。

## 3) 对比矩阵

| 项 | A 七票序（含 B1） | B2（押后等上游） | C/D |
|---|---|---|---|
| 工序惯例符合度 | ✅ 标准形态 | ⚠️ 违「fix 尽快发布」无判例 | 视排法 |
| 正确性与上游解耦 | ✅ 正交成立 | ❌ 可用性转嫁为正确性阻塞 | — |
| 披露合法性 | ✅ known-issue+fail-open caveat 惯例完备 | ✅（多等无意义周期） | — |
| 版本学 | ✅ 0.y.z patch 合规（可选 0.1.0） | 同左 | — |
| 批次风险 | ⚠️ 有，靠判别链+回滚预案缓解 | ⚠️ 批次继续膨胀风险更大 | — |
| 主要代价 | 记分簿与 closeout 须承载 caveat 叙事 | 已坏路径继续伤害用户 | 不明 |

## 4) 完整来源清单

| # | 标题 | URL | 贡献 |
|---|---|---|---|
| ① | Nautobot Release Checklist | docs.nautobot.com/projects/core/en/stable/development/core/release-checklist/ | 一手 checklist 顺序：verify CI→文档/RN→publish，T4 前置直接先例 |
| ② | Release Readiness Pass（skillspool） | skillspool.org | release readiness 工序 |
| ④ | The Good Docs Release Notes 模板 | thegooddocsproject.dev/template/release-notes | Known Issues 节定义与披露义务 |
| ⑤ | Ubuntu 25.10 RN / Debian trixie RN / VS2026 RN | documentation.ubuntu.com/release-notes/25.10/ 等 | 「任何 release 都有 known issues」发行版级先例 |
| ⑥ | Unleash feature flags / LaunchDarkly release mgmt | docs.getunleash.io/concepts/feature-flags | kill switch=gracefully degrade，永久 flag 类型——fail-open 降级态映射 |
| ⑦ | Conventional Commits 1.0.0 / semver 2.0.0 | conventionalcommits.org、semver.org | fix→PATCH、feat→MINOR；0.y.z 豁免 |
| ⑧ | How (not) to handle an impactful bug — Dionysopoulos | dionysopoulos.me/how-not-to-handle-an-impactful-bug.html | 修复存在不发布反面案例；披露位置纪律；patch 紧急发版流程 |
| ⑨ | Big Bang Release 反模式 — minware | minware.com/guide/anti-patterns/big-bang-release | 批次风险判据：归因困难、回滚含糊、flag 化缓解 |
| ⑩ | Release Train 概念 — DevOpsSchool | devopsschool.org/blog/release-train | 低频批次发布的合法替代 |

## 5) 信息缺口

（见原报告 — 主要为 upstream-dead 时下游发布的逐字判例有限，以 kill-switch/known-issue 惯例类推支撑）
