Executed 1 commands (80 lines, 11.8KB). Indexed 8 sections. Searched 5 queries.

## Commands

- atomcode-q4: `atomcode -p "背景：D:\\Aworker\\anysearch-cli（信息专精 Agent CLI，npm latest=0.0.5，5 个真实宿主验证，69 篇 ADR）。本轮 R69=GitHub 门面/README 双语化主题，已裁决：双语形态=README.md 英文主件+README.zh-CN.md 中文伴生互链（决策账本 D:\\Aworker\\anysearch-cli\\.scratch\\grill-round-69\\decision-ledger.md 的 D-001~D-003）。当前 README 312 行，其中 56% 是工程审计内容（Known limitations 节约 100 行、Architecture decisions 节约 76 行 ADR 目录），且公共文档泄漏机器本地证据路径（D:/Aworker/...）。待裁决问题=README 信息架构选型：A=重构（limitations 全文迁 docs/limitations.md 仅留 top-3 摘要、ADR 目录改为指针、清机器路径）/B=全保留仅重排/C=极简重写…`

## Indexed Sections

- atomcode-q4 (1.6KB)
- atomcode-q4 > 1) 执行摘要（Tl;dr） (0.7KB)
- atomcode-q4 > 2) 分点结论 (1) (2.9KB)
- atomcode-q4 > 2) 分点结论 (2) (1.9KB)
- atomcode-q4 > 3) 方案对比矩阵 (0.7KB)
- atomcode-q4 > 4) 推荐与落地要点 (1.5KB)
- atomcode-q4 > 5) 完整来源清单 (1.7KB)
- atomcode-q4 > 6) 信息缺口 (0.7KB)

## README information architecture recommendation

### atomcode-q4 > 2) 分点结论 (1)
## 2) 分点结论

**结论 1：README 的角色 = 登录页/认知漏斗顶端，不是工程档案**（Confidence 高，三源交叉：GitHub Docs [官方]："A README should only contain information necessary for developers to get started using and contributing"; Archbee [对比/惯例]："Keep README as a clear landing page with overview, Quick Start, and prominent links — move details to dedicated docs"; DEV 15-sections [社区]："the README is meant to be the entry point, not the entire manual — trying to cover too much will only make it harder to read"）。当前 README 56% 是审计内容，违反的是比例而非存在。

**结论 2：工程诚实性必须在 README 有“可见的存在”，但形态是摘要+指针，不是全文**（Confidence 高）。这是本次辩证的核心：诚实性文档的张力不靠“砍”解决，靠**分层**解决。
- claude-skill-judge-readme 评分轴第 8 条 "Honesty about limitations — gaps surfaced, not hidden" + 第 6 条 "Progressive disclosure — can each audience stop at the section they need" —— 两者是**同时成立的**：诚实性要求可见，渐进披露要求分层；
- 搜索到的 README 最佳实践汇总（banger-readme research）明确列出 "Disclose known limitations / State what the project does NOT do / Say when NOT to use this project" 为必需，但这些惯例文的范例全是**表格或列表级摘要**（性能天花板一行、平台限制一行），没有先例要求 100 行全文内联。
- 因此：**Known limitations 保留为 top-3 摘要表 + "Full limitations: docs/limitations.md" 链接**，正是工业界折中的标准落法。全删（C）会破坏 ADR-0062 D4 的"must not cosmetize the unreleased state"裁决；全保留（B）违反渐进披露。

**结论 3：ADR 目录的工业惯例是“docs/adr/ 自带 index，README 一行指针”**（Confidence 高）。ADR 实践文献（hidekazu-konishi ADR 运维文、architectviewmaster、MADR 官方）一致惯例：`docs/adr/` 下维护 index（README.md 或 index.md），供工程师扫描；主 README 与 ADR 的关系是**链接可达**，不是目录复制。README 里 76 行 ADR 目录是双重维护负担（与 `docs/adr/` index 漂移），且对这个规模的目录，"Architecture decisions: see [docs/adr/](docs/adr/) — 69 ADRs, indexed" 一行即可。A 方案"改为指针"与惯例完全一致；B 方案保留目录是维护负债。

**结论 4：机器本地证据路径泄漏是硬伤，任何方案都必须清**（Confidence 高，无需外部佐证）。`D;C:\Program Files\Git\Aworker\...` 这类路径泄漏对公共文档是纯负资产（信息泄漏 + 渲染破碎 + 不可复现证据的伪诚实）。GitHub Docs 对相对链接的惯例（"Relative links are easier for users who clone; absolute links may not work in clones"）直接支持改用仓库相对路径或删除机器特定证据。这不是 A/B/C 的分歧点，是共识项。

### atomcode-q4
# atomcode-q4

$ atomcode -p "背景：D:\\Aworker\\anysearch-cli（信息专精 Agent CLI，npm latest=0.0.5，5 个真实宿主验证，69 篇 ADR）。本轮 R69=GitHub 门面/README 双语化主题，已裁决：双语形态=README.md 英文主件+README.zh-CN.md 中文伴生互链（决策账本 D:\\Aworker\\anysearch-cli\\.scratch\\grill-round-69\\decision-ledger.md 的 D-001~D-003）。当前 README 312 行，其中 56% 是工程审计内容（Known limitations 节约 100 行、Architecture decisions 节约 76 行 ADR 目录），且公共文档泄漏机器本地证据路径（D:/Aworker/...）。待裁决问题=README 信息架构选型：A=重构（limitations 全文迁 docs/limitations.md 仅留 top-3 摘要、ADR 目录改为指针、清机器路径）/B=全保留仅重排/C=极简重写…

先读本地材料：账本 current 记录、ADR 0062、CONTEXT.md 词表。本地材料已读完（账本 D-001/D-003、ADR-0062 D4、CONTEXT.md 词表）。先召回知识库，同时启动三引擎多角度检索。继续第二阶段：定点补搜双语惯例、ADR 呈现惯例、徽章惯例，并抓原文验证。第三阶段：定点深挖，打开高价值原文核验（GitHub 官方 README 指南、art-of-readme、双语 README 先例、ADR 索引惯例、翻译 SSOT 实践、徽章惯例）。补齐深挖：art-of-readme 原文（换源）、翻译 SSOT 实践文、ADR 索引惯例文、README 章节最佳实践文。配额已达标（searches: 7 | angles: Official / Comparative / Criticism / Community | full reads: 6 | gaps: 成熟项目 README 长度统计缺一手数据，用 GitHub 官方文档 + 多源惯例弥补）。综合输出如下。

### atomcode-q4 > 5) 完整来源清单
## 5) 完整来源清单

| 标题 | URL | 角度 | 日期 | 贡献 |
|---|---|---|---|---|
| About READMEs — GitHub Docs | docs.github.com/.../about-readmes | Official | 常青 | README 只放入门必需；相对链接惯例 |
| Tips for Creating Great README Docs — Archbee | archbee.com/blog/readme-creating-tips | Official/惯例 | 2026-08-26 | "landing page + move details to dedicated docs" |
| spec-kit PR #3740 — zh-CN README | github.com/github/spec-kit/pull/3740 | Official | 2026-07-28 | 双语 EN 主+zh-CN 伴生+switcher 的官方仓先例 |
| Keeping Translated OSS Docs Fresh with SSOT and CI | dev.to/loach2009/... | Community/时效 | 2026-09-10 | canonical/translation 显式声明 + CI 防漂移 |
| ADR Templates and Operational Patterns | hidekazu-konishi.com/entry/architecture_decision_records... | Official/实践 | 2026-05-08 | ADR index 归属 docs/adr、可发现性运维 |
| claude-skill-judge-readme | github.com/techiejd/claude-skill-judge-readme | Community | — | 诚实性轴 + 渐进披露轴同时成立的评分框架 |
| README best-practices research（banger-readme） | github.com/kerryhatcher/banger-readme/blob/main/docs/readme-best-practices-research.md | Community/汇总 | — | "Disclose limitations" 惯例分类 |
| 15 Essential Sections Every README Needs | dev.to/georgekobaidze/... | Community | 2026-04 | entry point not the manual；评论区佐证迁 docs |
| README badges best practices | daily.dev/blog/readme-badges-github-best-practices | Community | 2024-03 | 徽章位置/真实性惯例 |
| 本地：readme-crafter quality-checklist（知识库已索引） | 本地 skill | 工艺基线 | — | Evidence Integrity Test：徽章/证据真实性验收 |

## known limitations docs migration convention

### atomcode-q4 > 4) 推荐与落地要点
## 4) 推荐与落地要点

**推荐 A**，具体裁决建议：
1. **Known limitations**：README 留 top-3 摘要表（out-of-domain abstain 修复中 / macOS 未测 / tavily AbortSignal）+ 一行链接 `docs/limitations.md`（全文迁出）；这正是 ADR-0062 D4 "honest known-limitations + detail compresses behind links" 的原文意图，A 是对 D4 的**忠实执行**而非偏离。
2. **Architecture decisions**：README 删 76 行目录，改为一段"Design rationale"（2-3 句概括核心决策：垂直领域/abstain-first/fail-open）+ 指向 `docs/adr/` 的链接；ADR index 的 SSOT 归 `docs/adr/`。
3. **机器路径**：全部清除或改仓库相对路径；不可复现的本地证据从公共文档降级到 `.scratch/` 审计链。
4. **双语**：按 D-003 + spec-kit 惯例执行；README.md 声明为 canonical，zh-CN 件顶部声明派生关系；同步漂移验收用“两文件 heading 结构 1:1 + 链接/代码块 byte-identical”检查（spec-kit PR 的验证方式）。
5. **保留不动**：verified-hosts 表、徽章行、Quickstart——这些是 Proof/How-to-use，属于用户向内容的正确部分。

**辩证提醒（反向论点已考虑）**：B 的合理内核是“诚实性内容迁出后容易被遗忘更新”——arXiv README 维护研究确认 outdated docs 是最频繁痛点。缓解办法是把 docs/limitations.md 纳入 ship-gate 的文档同步检查项（与现有 ship-gate 惯例一致），而不是用“塞回 README”来对抗遗忘——塞回只是让过期更可见，不能让更新更勤。

### atomcode-q4 > 1) 执行摘要（Tl;dr）
## 1) 执行摘要（Tl;dr）

**推荐方案 A（重构迁出），但对 C 保持警惕、对 B 的动机部分承认。** Confidence：**高**。理由：GitHub 官方明确“README 只放上手必需信息，长文档归 docs"；多源一致确认 Known limitations 应保留在 README 但以**摘要+链接**形态（诚实性不等于全文内联）；69 篇 ADR 目录 76 行放在 README 属于已确立的 ADR 治理惯例之外的例外——ADR 索引惯例是"docs/adr/ 内部维护 index"，README 只留一行指针。同时 D-001/D-003 与 ADR-0062 D4 的既有裁决（用户向 quickstart + honest limitations + ADR index preserved）与 A 方案完全兼容，与 B/C 冲突。

### atomcode-q4 > 2) 分点结论 (1)
## 2) 分点结论

**结论 1：README 的角色 = 登录页/认知漏斗顶端，不是工程档案**（Confidence 高，三源交叉：GitHub Docs [官方]："A README should only contain information necessary for developers to get started using and contributing"; Archbee [对比/惯例]："Keep README as a clear landing page with overview, Quick Start, and prominent links — move details to dedicated docs"; DEV 15-sections [社区]："the README is meant to be the entry point, not the entire manual — trying to cover too much will only make it harder to read"）。当前 README 56% 是审计内容，违反的是比例而非存在。

**结论 2：工程诚实性必须在 README 有“可见的存在”，但形态是摘要+指针，不是全文**（Confidence 高）。这是本次辩证的核心：诚实性文档的张力不靠“砍”解决，靠**分层**解决。
- claude-skill-judge-readme 评分轴第 8 条 "Honesty about limitations — gaps surfaced, not hidden" + 第 6 条 "Progressive disclosure — can each audience stop at the section they need" —— 两者是**同时成立的**：诚实性要求可见，渐进披露要求分层；
- 搜索到的 README 最佳实践汇总（banger-readme research）明确列出 "Disclose known limitations / State what the project does NOT do / Say when NOT to use this project" 为必需，但这些惯例文的范例全是**表格或列表级摘要**（性能天花板一行、平台限制一行），没有先例要求 100 行全文内联。
- 因此：**Known limitations 保留为 top-3 摘要表 + "Full limitations: docs/limitations.md" 链接**，正是工业界折中的标准落法。全删（C）会破坏 ADR-0062 D4 的"must not cosmetize the unreleased state"裁决；全保留（B）违反渐进披露。

**结论 3：ADR 目录的工业惯例是“docs/adr/ 自带 index，README 一行指针”**（Confidence 高）。ADR 实践文献（hidekazu-konishi ADR 运维文、architectviewmaster、MADR 官方）一致惯例：`docs/adr/` 下维护 index（README.md 或 index.md），供工程师扫描；主 README 与 ADR 的关系是**链接可达**，不是目录复制。README 里 76 行 ADR 目录是双重维护负担（与 `docs/adr/` index 漂移），且对这个规模的目录，"Architecture decisions: see [docs/adr/](docs/adr/) — 69 ADRs, indexed" 一行即可。A 方案"改为指针"与惯例完全一致；B 方案保留目录是维护负债。

**结论 4：机器本地证据路径泄漏是硬伤，任何方案都必须清**（Confidence 高，无需外部佐证）。`D;C:\Program Files\Git\Aworker\...` 这类路径泄漏对公共文档是纯负资产（信息泄漏 + 渲染破碎 + 不可复现证据的伪诚实）。GitHub Docs 对相对链接的惯例（"Relative links are easier for users who clone; absolute links may not work in clones"）直接支持改用仓库相对路径或删除机器特定证据。这不是 A/B/C 的分歧点，是共识项。

## bilingual README maintenance pattern

### atomcode-q4 > 5) 完整来源清单
## 5) 完整来源清单

| 标题 | URL | 角度 | 日期 | 贡献 |
|---|---|---|---|---|
| About READMEs — GitHub Docs | docs.github.com/.../about-readmes | Official | 常青 | README 只放入门必需；相对链接惯例 |
| Tips for Creating Great README Docs — Archbee | archbee.com/blog/readme-creating-tips | Official/惯例 | 2026-08-26 | "landing page + move details to dedicated docs" |
| spec-kit PR #3740 — zh-CN README | github.com/github/spec-kit/pull/3740 | Official | 2026-07-28 | 双语 EN 主+zh-CN 伴生+switcher 的官方仓先例 |
| Keeping Translated OSS Docs Fresh with SSOT and CI | dev.to/loach2009/... | Community/时效 | 2026-09-10 | canonical/translation 显式声明 + CI 防漂移 |
| ADR Templates and Operational Patterns | hidekazu-konishi.com/entry/architecture_decision_records... | Official/实践 | 2026-05-08 | ADR index 归属 docs/adr、可发现性运维 |
| claude-skill-judge-readme | github.com/techiejd/claude-skill-judge-readme | Community | — | 诚实性轴 + 渐进披露轴同时成立的评分框架 |
| README best-practices research（banger-readme） | github.com/kerryhatcher/banger-readme/blob/main/docs/readme-best-practices-research.md | Community/汇总 | — | "Disclose limitations" 惯例分类 |
| 15 Essential Sections Every README Needs | dev.to/georgekobaidze/... | Community | 2026-04 | entry point not the manual；评论区佐证迁 docs |
| README badges best practices | daily.dev/blog/readme-badges-github-best-practices | Community | 2024-03 | 徽章位置/真实性惯例 |
| 本地：readme-crafter quality-checklist（知识库已索引） | 本地 skill | 工艺基线 | — | Evidence Integrity Test：徽章/证据真实性验收 |

### atomcode-q4 > 2) 分点结论 (2)
**结论 5：双语形态的维护惯例支持 A 且给 D-003 的“两文件内容等价同步”约束提供了更优落地**（Confidence 中高）。三源交叉：
- spec-kit PR #3740（github 官方仓，2026-07 合并）：`README.zh-CN.md` + 双文件顶部 language switcher，翻译"hand-crafted, structurally 1:1"，代码块/徽章/链接 byte-identical，仅翻 prose——与 D-003 裁决完全同构；
- ppt-skills PR #4：明确否定单文件互排（"dense and makes neither audience's scan clean"），确认 EN 主 + `README.zh-CN.md` + 一行 switcher 是 "the standard i18n README pattern"；
- dev.to SSOT+CI 实践文（2026-09）：双语维护的最优解是**显式声明 canonical**（README.md 为主件 SSOT，zh-CN 为派生件），翻译件标注 "translation, canonical: README.md" 并链接回来；进阶做法是用 CI 检测翻译过期（记录 canonical revision）。
- **落地建议**：主件顶部 `[English](README.md) | [简体中文](README.zh-CN.md)` switcher；伴生件顶部声明"本文为翻译，规范以 README.md 为准”；A 方案迁出 limitations/ADR 到 docs 后，双语同步面从 312 行收敛到 ~150 行用户向内容，**同步漂移风险直接减半**——这是 A 相对 B 在双语维护维度上的隐藏收益。

**结论 6：徽章与 verified-hosts 表的惯例**（Confidence 中）。badges 惯例（daily.dev README badges best practices + shields.io）：徽章放在标题正下方，只放**动态可验证**徽章（npm version、CI status、license）——这与知识库已索引的 readme-crafter "Evidence Integrity Test" 一致（badge 必须指向真实端点）。对 anysearch-cli：npm latest=0.0.5 + 5 宿主验证都是真实可验证证据，可做徽章/表格；verified-hosts 表保留在 README 是对的——它就是“Proof"区（beautify-github-readme 的阅读序位 2），属于用户采纳决策信息，不是工程审计信息。

### atomcode-q4
# atomcode-q4

$ atomcode -p "背景：D:\\Aworker\\anysearch-cli（信息专精 Agent CLI，npm latest=0.0.5，5 个真实宿主验证，69 篇 ADR）。本轮 R69=GitHub 门面/README 双语化主题，已裁决：双语形态=README.md 英文主件+README.zh-CN.md 中文伴生互链（决策账本 D:\\Aworker\\anysearch-cli\\.scratch\\grill-round-69\\decision-ledger.md 的 D-001~D-003）。当前 README 312 行，其中 56% 是工程审计内容（Known limitations 节约 100 行、Architecture decisions 节约 76 行 ADR 目录），且公共文档泄漏机器本地证据路径（D:/Aworker/...）。待裁决问题=README 信息架构选型：A=重构（limitations 全文迁 docs/limitations.md 仅留 top-3 摘要、ADR 目录改为指针、清机器路径）/B=全保留仅重排/C=极简重写…

先读本地材料：账本 current 记录、ADR 0062、CONTEXT.md 词表。本地材料已读完（账本 D-001/D-003、ADR-0062 D4、CONTEXT.md 词表）。先召回知识库，同时启动三引擎多角度检索。继续第二阶段：定点补搜双语惯例、ADR 呈现惯例、徽章惯例，并抓原文验证。第三阶段：定点深挖，打开高价值原文核验（GitHub 官方 README 指南、art-of-readme、双语 README 先例、ADR 索引惯例、翻译 SSOT 实践、徽章惯例）。补齐深挖：art-of-readme 原文（换源）、翻译 SSOT 实践文、ADR 索引惯例文、README 章节最佳实践文。配额已达标（searches: 7 | angles: Official / Comparative / Criticism / Community | full reads: 6 | gaps: 成熟项目 README 长度统计缺一手数据，用 GitHub 官方文档 + 多源惯例弥补）。综合输出如下。

## engineering honesty user-facing tension

### atomcode-q4 > 2) 分点结论 (1)
## 2) 分点结论

**结论 1：README 的角色 = 登录页/认知漏斗顶端，不是工程档案**（Confidence 高，三源交叉：GitHub Docs [官方]："A README should only contain information necessary for developers to get started using and contributing"; Archbee [对比/惯例]："Keep README as a clear landing page with overview, Quick Start, and prominent links — move details to dedicated docs"; DEV 15-sections [社区]："the README is meant to be the entry point, not the entire manual — trying to cover too much will only make it harder to read"）。当前 README 56% 是审计内容，违反的是比例而非存在。

**结论 2：工程诚实性必须在 README 有“可见的存在”，但形态是摘要+指针，不是全文**（Confidence 高）。这是本次辩证的核心：诚实性文档的张力不靠“砍”解决，靠**分层**解决。
- claude-skill-judge-readme 评分轴第 8 条 "Honesty about limitations — gaps surfaced, not hidden" + 第 6 条 "Progressive disclosure — can each audience stop at the section they need" —— 两者是**同时成立的**：诚实性要求可见，渐进披露要求分层；
- 搜索到的 README 最佳实践汇总（banger-readme research）明确列出 "Disclose known limitations / State what the project does NOT do / Say when NOT to use this project" 为必需，但这些惯例文的范例全是**表格或列表级摘要**（性能天花板一行、平台限制一行），没有先例要求 100 行全文内联。
- 因此：**Known limitations 保留为 top-3 摘要表 + "Full limitations: docs/limitations.md" 链接**，正是工业界折中的标准落法。全删（C）会破坏 ADR-0062 D4 的"must not cosmetize the unreleased state"裁决；全保留（B）违反渐进披露。

**结论 3：ADR 目录的工业惯例是“docs/adr/ 自带 index，README 一行指针”**（Confidence 高）。ADR 实践文献（hidekazu-konishi ADR 运维文、architectviewmaster、MADR 官方）一致惯例：`docs/adr/` 下维护 index（README.md 或 index.md），供工程师扫描；主 README 与 ADR 的关系是**链接可达**，不是目录复制。README 里 76 行 ADR 目录是双重维护负担（与 `docs/adr/` index 漂移），且对这个规模的目录，"Architecture decisions: see [docs/adr/](docs/adr/) — 69 ADRs, indexed" 一行即可。A 方案"改为指针"与惯例完全一致；B 方案保留目录是维护负债。

**结论 4：机器本地证据路径泄漏是硬伤，任何方案都必须清**（Confidence 高，无需外部佐证）。`D;C:\Program Files\Git\Aworker\...` 这类路径泄漏对公共文档是纯负资产（信息泄漏 + 渲染破碎 + 不可复现证据的伪诚实）。GitHub Docs 对相对链接的惯例（"Relative links are easier for users who clone; absolute links may not work in clones"）直接支持改用仓库相对路径或删除机器特定证据。这不是 A/B/C 的分歧点，是共识项。

## badges verified hosts presentation

### atomcode-q4 > 2) 分点结论 (2)
**结论 5：双语形态的维护惯例支持 A 且给 D-003 的“两文件内容等价同步”约束提供了更优落地**（Confidence 中高）。三源交叉：
- spec-kit PR #3740（github 官方仓，2026-07 合并）：`README.zh-CN.md` + 双文件顶部 language switcher，翻译"hand-crafted, structurally 1:1"，代码块/徽章/链接 byte-identical，仅翻 prose——与 D-003 裁决完全同构；
- ppt-skills PR #4：明确否定单文件互排（"dense and makes neither audience's scan clean"），确认 EN 主 + `README.zh-CN.md` + 一行 switcher 是 "the standard i18n README pattern"；
- dev.to SSOT+CI 实践文（2026-09）：双语维护的最优解是**显式声明 canonical**（README.md 为主件 SSOT，zh-CN 为派生件），翻译件标注 "translation, canonical: README.md" 并链接回来；进阶做法是用 CI 检测翻译过期（记录 canonical revision）。
- **落地建议**：主件顶部 `[English](README.md) | [简体中文](README.zh-CN.md)` switcher；伴生件顶部声明"本文为翻译，规范以 README.md 为准”；A 方案迁出 limitations/ADR 到 docs 后，双语同步面从 312 行收敛到 ~150 行用户向内容，**同步漂移风险直接减半**——这是 A 相对 B 在双语维护维度上的隐藏收益。

**结论 6：徽章与 verified-hosts 表的惯例**（Confidence 中）。badges 惯例（daily.dev README badges best practices + shields.io）：徽章放在标题正下方，只放**动态可验证**徽章（npm version、CI status、license）——这与知识库已索引的 readme-crafter "Evidence Integrity Test" 一致（badge 必须指向真实端点）。对 anysearch-cli：npm latest=0.0.5 + 5 宿主验证都是真实可验证证据，可做徽章/表格；verified-hosts 表保留在 README 是对的——它就是“Proof"区（beautify-github-readme 的阅读序位 2），属于用户采纳决策信息，不是工程审计信息。

### atomcode-q4 > 4) 推荐与落地要点
## 4) 推荐与落地要点

**推荐 A**，具体裁决建议：
1. **Known limitations**：README 留 top-3 摘要表（out-of-domain abstain 修复中 / macOS 未测 / tavily AbortSignal）+ 一行链接 `docs/limitations.md`（全文迁出）；这正是 ADR-0062 D4 "honest known-limitations + detail compresses behind links" 的原文意图，A 是对 D4 的**忠实执行**而非偏离。
2. **Architecture decisions**：README 删 76 行目录，改为一段"Design rationale"（2-3 句概括核心决策：垂直领域/abstain-first/fail-open）+ 指向 `docs/adr/` 的链接；ADR index 的 SSOT 归 `docs/adr/`。
3. **机器路径**：全部清除或改仓库相对路径；不可复现的本地证据从公共文档降级到 `.scratch/` 审计链。
4. **双语**：按 D-003 + spec-kit 惯例执行；README.md 声明为 canonical，zh-CN 件顶部声明派生关系；同步漂移验收用“两文件 heading 结构 1:1 + 链接/代码块 byte-identical”检查（spec-kit PR 的验证方式）。
5. **保留不动**：verified-hosts 表、徽章行、Quickstart——这些是 Proof/How-to-use，属于用户向内容的正确部分。

**辩证提醒（反向论点已考虑）**：B 的合理内核是“诚实性内容迁出后容易被遗忘更新”——arXiv README 维护研究确认 outdated docs 是最频繁痛点。缓解办法是把 docs/limitations.md 纳入 ship-gate 的文档同步检查项（与现有 ship-gate 惯例一致），而不是用“塞回 README”来对抗遗忘——塞回只是让过期更可见，不能让更新更勤。

### atomcode-q4 > 5) 完整来源清单
## 5) 完整来源清单

| 标题 | URL | 角度 | 日期 | 贡献 |
|---|---|---|---|---|
| About READMEs — GitHub Docs | docs.github.com/.../about-readmes | Official | 常青 | README 只放入门必需；相对链接惯例 |
| Tips for Creating Great README Docs — Archbee | archbee.com/blog/readme-creating-tips | Official/惯例 | 2026-08-26 | "landing page + move details to dedicated docs" |
| spec-kit PR #3740 — zh-CN README | github.com/github/spec-kit/pull/3740 | Official | 2026-07-28 | 双语 EN 主+zh-CN 伴生+switcher 的官方仓先例 |
| Keeping Translated OSS Docs Fresh with SSOT and CI | dev.to/loach2009/... | Community/时效 | 2026-09-10 | canonical/translation 显式声明 + CI 防漂移 |
| ADR Templates and Operational Patterns | hidekazu-konishi.com/entry/architecture_decision_records... | Official/实践 | 2026-05-08 | ADR index 归属 docs/adr、可发现性运维 |
| claude-skill-judge-readme | github.com/techiejd/claude-skill-judge-readme | Community | — | 诚实性轴 + 渐进披露轴同时成立的评分框架 |
| README best-practices research（banger-readme） | github.com/kerryhatcher/banger-readme/blob/main/docs/readme-best-practices-research.md | Community/汇总 | — | "Disclose limitations" 惯例分类 |
| 15 Essential Sections Every README Needs | dev.to/georgekobaidze/... | Community | 2026-04 | entry point not the manual；评论区佐证迁 docs |
| README badges best practices | daily.dev/blog/readme-badges-github-best-practices | Community | 2024-03 | 徽章位置/真实性惯例 |
| 本地：readme-crafter quality-checklist（知识库已索引） | 本地 skill | 工艺基线 | — | Evidence Integrity Test：徽章/证据真实性验收 |


> **Tip:** Results are scoped to this batch only. To search across all indexed sources, use `ctx_search(queries: [...])` or call ctx_batch_execute with `query_scope: "global"`.

Searchable terms for follow-up: anysearch-cli, art-of-readme, claude-skill-judge-readme, hidekazu-konishi, byte-identical, verified-hosts, readme-crafter, architecture, banger-readme, quickstart, translation, community, dedicated, cosmetize, practices, integrity, atomcode, official, audience, research, disclose, switcher, evidence, aworker, scratch, archbee, landing, details, latest, 全保留仅重排, honest, manual, badges, d-001, links, entry, point, daily, proof, full