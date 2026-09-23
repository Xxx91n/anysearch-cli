# atomcode 调研存档 — R79 Q2 豁免域契约收敛方向（Codify vs Revert）

Date: 2026-09-23 · prompt: `q2-prompt.txt` · 引擎: Exa+AnySearch+知识库历史存档（Tavily 配额缺席）· Confidence: 高

## 1) 执行摘要（TL;DR）

**推荐方向 A（Codify），但以「显式立法+每条款钉一致性测试+风险披露」的完整形态执行，且 (d) 面顺带借 ESLint `reportUnusedDisableDirectives` 惯例补「失效标记」warn（辩证注：本仓 R78 已实装 stale-marker 棘轮且为 fail 级，更强）。** 四个豁免域中的三个（marker 覆盖围栏、locator 行、非阻断层静默）在 markdownlint/Vale/ESLint/gitleaks 四工业级工具全部有直接同构先例，实现行为是深思熟虑的设计而非 drift；唯一真正张力点（fence 内仓内路径豁免）存量实例=0，收紧实现只制造 transcript 保真损失+未来误报噪音，零实际收益——正是 IaC 领域「revert 未记录但有意为之的变更」经典反模式（AWS 官方博客："Automatically reverting a change without understanding why it was made can reintroduce the problem"）。

## 2) 分点结论

### 结论 1：豁免域契约的工业先例——豁免必须显式声明，「默认豁免」与「默认执法+声明豁免」两模式并存，本仓 marker 覆盖模式属后者 — Confidence: 高

| 工具 | 代码围栏内内容 | 行级豁免机制 | 豁免声明形态 |
|---|---|---|---|
| markdownlint | 默认执法，逐规则参数级豁免（MD010 `code_blocks:false`、`ignore_code_languages`） | `<!-- markdownlint-disable/restore -->` 行级/区间注释 | 显式注释，六层配置优先级内联注释最高 |
| Vale | **默认豁免**——markup-aware 解析器分离 code span/block，IgnoredScopes 默认含 tt/code/kbd | HTML 注释对禁用/恢复指定规则 | 显式注释 |
| ESLint | 无围栏概念 | `eslint-disable-line/-next-line`，可带 `-- reason` | 显式注释+`reportUnusedDisableDirectives`（默认 warn）猎杀失效豁免 |
| gitleaks | 无围栏；fixture/testdata 误报重灾区 | baseline、`.gitleaksignore`、inline `gitleaks:allow`、allowlist | 全显式、可审查、进版本库；"A baseline is not a pardon" |

关键判读：**没有一家用「静默豁免」**。本仓契约（marker 显式声明→覆盖整块围栏）形态上精确对应 markdownlint 的 `disable→fence→restore` 惯用例（md010 文档原例就是用 disable 注释包住含 tab 的围栏），也对应 gitleaks「豁免=被 lint+review 看见的 artifact」。问题从不是「该不该豁免」，而是「豁免域边界是否被文本如实记账」——现在没有，所以要立法。

### 结论 2：Codify vs Revert 判据=「哪一侧是被明确裁决过的意图记录」；本例三个豁免域全有实现侧正当理由，文本是未审视笼统字面→drift 在文本侧 — Confidence: 高

IaC/policy-as-code 成熟心智模型（Firefly、AWS、Pulumi 三源一致）：发现 drift 后第一步不是改，而是**归因（attribution）**——问差异是谁、为什么造成。AWS CloudFormation drift 官方指南警告：不了解成因就自动 revert 可能重新引入问题；Firefly 把 codify 作为与 revert 并列的一等 remediation 路径，选择依据=差异是「未授权漂移」还是「未记录的有意变更」。

逐面归因：
| 曲面 | 实现侧理由是否成立 | 归因结论 |
|---|---|---|
| (a) marker 覆盖围栏内整段跳过 | 成立——围栏内容=机器生成 transcript 摘录，证据保真优先；存量仓内路径实例=0，收紧无收益 | 实现是有意设计，文本漏记账 |
| (b) 未覆盖围栏内照常执法 | 一致无张力 | 无需动作 |
| (c) Stack: locator 行整行跳过 | 成立——locator 职责=指地点，仓根命名无法 repo-relative，**有活体实例** | 文本已开列 locator 豁免类，张力仅在实现顺带豁免行内其他模式——立法写明即可 |
| (d) `/x` info 在豁免域内继续产出 | **不成立**——噪音泄漏非设计 | 唯一实现侧应改的点 |

显式立法纪律惯例：NIST SP 800-53B tailoring——控制降级/豁免必须记录 rationale；policy-as-code 开源实现（rules.json 单一真源+一致性测试分歧即 CI 失败）=「分歧不许长期存在、朝单一真源解决」的机械保障。**Codify 正确形态=修订 ADR+测试钉死，不是代码注释里静默追认。**

### 结论 3：transcript/证据保真 vs 规则纯净——逐字摘录块降权/豁免是 secret-scanning 与 docs-lint 双向共识 — Confidence: 高

- gitleaks：testdata 目录+fixture path allowlist 是官方 README 与实践文献核心议题（qaskills 2026-08 指南整节讨论 fixtures 误报处置：「scope the allowlist by rule and path, add a description」——豁免要窄、要有描述）。
- Vale：`summary` scope 定义原文= "excluding headings, code spans, code blocks, and table cells"——逐字块天然不属于散文执法面。
- markdownlint MD010 rationale：code blocks 默认纳入是因 tab 处理有歧义，参数级 opt-out 一等公民——「围栏内内容是否执法」逐规则按其目标裁定，不是一刀切。
- 映射本例：path lint 规则目标=「交付文档里的路径引用可移植」，transcript 摘录里的路径是**证据内容不是引用**，改写即失真——与 gitleaks 不要求改写 fixture 里 token 形状同构。(a) 豁免有坚实先例；ADR 文本需补的只是把「fence 覆盖=全部检查跳过」写明。

### 结论 4：(d) 面与非阻断层——豁免域内非阻断提示应静默，借 ESLint 惯例反向补「失效标记检测」 — Confidence: 中高

- 静默侧先例：Vale lazy 求值（"skips the work when none does"）；markdownlint 在 code block 内不发「你在围栏里」类 meta 提示。`/x` info 存在意义=捕捉「疑似漏挂 marker 的仓外路径」，已豁免上下文里继续产出纯属噪音——与 R78 噪音校准同方向。
- 反向先例：ESLint `reportUnusedDisableDirectives`（默认 warn）猎杀「disable 了不会报错的行」的失效豁免注释。**辩证注（本仓核实）：stale-marker 棘轮 R78 已实装（detect.mjs fence 关闭处+行级两条腿）且为 fail 级=比 warn 更强——该建议已天然满足，豁免域扩大风险已有机械对冲。** gitleaks baseline 治理（"baseline count trends downward" 为 rollout exit criteria）同款心智。

## 3) 对比矩阵

| 项 | A（Codify 立法追认） | B（Revert 收紧实现） | C（逐面混裁） |
|---|---|---|---|
| 工业先例对齐 | fence 豁免=Vale/md010 惯用例；locator=locator 语义本位；全对齐 | 无先例要求改写 transcript 摘录；gitleaks 明确不要求改 fixture | 混裁无单一先例 |
| 存量成本 | 0（活体实例全在豁免域内） | 须改仓根命名 Stack: 行+未来 transcript 全失真 | ≈A |
| 未来误报噪音 | 不增；+stale-marker 后反降 | 围栏内仓内路径将持续 FP，重蹈「高误报规则被整条关闭」 | ≈A |
| 豁免域扩大风险 | 存在→一致性测试+季度审计+stale-marker 三重消化 | 无此风险 | 同 A 但每面单独论证成本高 |
| drift 记账纪律 | 显式立法+NIST tailoring rationale 吻合 | 收紧后 ADR 需写「为什么放弃保真」——写不出理由 | 立法负担同 A |

## 4) 推荐落法（A 的完整形态）

1. 修订 ADR-0072：显式开列三豁免域——①marker 覆盖围栏内全部检查跳过（transcript 证据保真）；②`Stack:` locator 行内仓内路径豁免（指地点语义+仓根无法 repo-relative）；③`/x` info 在①②上下文内静默。每条写 rationale（NIST tailoring）。
2. 每条款钉一致性测试（rules-as-tests 单一真源模式）防再漂移。
3. （本仓已实装）stale-marker 检测同构 ESLint `reportUnusedDisableDirectives`——豁免域扩大风险的机械对冲。
4. 诚实披露：ADR 写明豁免域扩大风险及三重缓解，风险登记进季度审计项。

## 5) 完整来源清单

| 标题 | URL | 角度 | 贡献 |
|---|---|---|---|
| Vale Scopes 官方文档 | docs.vale.sh/topics/scopes | Official | markup-aware 默认豁免 code span/block；lazy 求值 |
| ESLint Configure Rules | eslint.org/docs/latest/use/configure/rules | Official | inline disable 契约+reportUnusedDisableDirectives 默认 warn |
| markdownlint MD010 | github.com/DavidAnson/markdownlint doc/md010.md | Official | 围栏逐规则参数级豁免+disable/restore 包围围栏惯用例 |
| markdownlint Rules/README | github.com/DavidAnson/markdownlint | Official（摘要级） | 六层配置优先级、行级注释语法 |
| gitleaks README | github.com/gitleaks/gitleaks | Official | baseline/allowlist/.gitleaksignore/inline allow 四机制 |
| Secrets Scanning in CI with Gitleaks | qaskills.sh/blog/secrets-scanning-ci-gitleaks-baselines | Community | "baseline is not a pardon"；fixture allowlist 收窄纪律 |
| Firefly Terraform Drift Guide | firefly.ai/academy/terraform-drift-detection-guide | Comparative | codify 与 revert 并列 remediation；attribution 先于修复 |
| AWS CloudFormation drift 博客 | aws.amazon.com/blogs/devops/（摘要级） | Official | 「自动 revert 不明成因的变更会重新引入问题」 |
| R79 Q1/R71 Q2 调研存档 | 本地 ctx 知识库召回 | 前序调研 | policy-as-code 一致性测试先例；gitleaks baseline 治理=marker 机制设计源头 |

## 6) 信息缺口

- Tavily 配额耗尽，第三引擎由知识库历史调研顶替（采信层级=「历史已验」，未重开原文）。
- **markdownlint 无「仓内绝对路径」类规则直接对应物**（无路径语义规则）——(a)(c) 先例是**结构性同构**（围栏豁免、行级豁免机制）非规则级同构，本报告最强可攻击点，裁决记录如实标注。
- textlint 未覆盖（检索未命中其围栏处理文档），同属 markup-aware 阵营影响低。
