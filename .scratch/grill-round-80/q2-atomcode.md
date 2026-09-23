# atomcode R80 Q2 调研存档 — 票序结构与 E6 裁决对发布事件的阻塞语义

> 调研时间：2026-09-23；引擎：Exa+AnySearch（Tavily 配额超限）；问题原文见 q2-prompt.txt

**Sufficiency Gate**：searches: 7（web_search×2 + anysearch batch×2 + ctx_search×2 + R80 Q1 历史召回）| angles: Official / Comparative / Criticism / Currency / Community | full reads: 6（cybersecurity101、decryptiondigest、innolution、grcopilot、supplychainsecurityhandbook、atlassian）+ ctx 知识库 6 条历史索引 | gaps: 无中文一手信源；hardening sprint 反面案例复用 Q1 信源

## 1) 执行摘要 (Tl;dr)

**Q2b：推荐 γ（条件阻塞）附强制到期条款——即业界「time-bound exception + compensating controls」标准形态；α 是其缺省分支，β 在护栏技术可行且廉价的前提下违反 NIST SP 800-53B 补偿控制门槛。** Confidence：高——「gate verdict 阻塞 / gate improvement 不阻塞」的分界在发布治理一手文献中有一致表述：release gate 的判定输出是 {pass, remediation, release hold, risk-acceptance decision}，而加固工程不是 release criteria 的一部分（supplychainsecurityhandbook + SLA-gating 文献双源）。

**Q2a：推荐原案 T0→T1→T2→T3→T4 顺位，仅微调：T2 产品备货中「与 E6 无关的机械部分」（release.yml 加 dsh-plugin、版本 bump、文档 checklist 核对）可提前与 T0 并行**，因为它们不依赖 E6 结论。Confidence：高——Ken Rubin 的 backlog 排序六因子中，本票序由 dependency（T2 发布前必须过 T1 结论）+ risk（E6 结论先于 publish）+ value（换气轮出货）三因子共同决定，原案顺位正确。

## 2) 分点结论

### 结论 1：「verdict 阻塞 / improvement 不阻塞」是发布治理的标准分界 — Confidence: 高

- **一手框架**：发布治理实践把 release gate 定义为 pipeline 内嵌的判定点——证据缺失/过期/不可验证时产出「exception, remediation action, release hold, rejection, or risk-acceptance decision before signing」（supplychainsecurityhandbook.com，已读原文）。注意其枚举：**决策（含 risk-acceptance decision）与工程整改（remediation action）是两个并列输出**——前者可当场闭合、允许放行；后者进 backlog，不拦发布。
- **旁证（DevSecOps SLA-gating 文献）**：gate 的合法三态是 pass/warn/block，判定依据是「evidence present + exception not expired」——加固工程（把 warn 变 pass 的能力建设）从不进 gate criteria。原文原话：「the gate blocks promotion until evidence is present」，而非 until hardening is complete。
- **交叉验证**：R80 Q1 历史召回（SLSA v1.1 verifying-artifacts 一手规范）同样指出 verification 在 publish 时点判定，peripheral 的 hardening 是独立 track。

### 结论 2：条件阻塞（γ）的判据来自 risk-acceptance expiration 三源一致 — Confidence: 高

三篇独立原文（cybersecurity101 glossary、decryptiondigest practitioner guide、grcopilot guide）+ anysearch 多条命中给出完全一致的五要件：**① 精确 policy citation ② justification（「未排期」不算）③ 已验证运转的 compensating controls ④ 具名且有权威的 acceptor ⑤ 固定到期日（90 天为通行上限，续期需更高审批层级 + 新证据）**。关键条款：

- 「Open-ended exceptions are not exceptions; they are undeclared policy changes」（grcopilot）。
- 「Renewal should require fresh evidence, not a copied approval」（cybersecurity101）——γ 的「否则记档放行」分支必须写死到期日与复验触发条件，否则等于 α 的静默永续。
- 「40% of organizations that conduct exception audits find exceptions that have expired without review」（decryptiondigest）——记档而不设到期机制是统计上的常态失败模式。
- **分级审批**：有已验证补偿控制的低残差例外走 Tier 1（安全负责人可批），无补偿控制的高残差才升 Tier 2（业务负责人）——E6 案例中 lockfile review 纪律 + GHSA-q6j5-fjx5-2mc3 已记档属于 Tier 1 形态，不需阻塞发布。

**对本仓映射**：γ 的触发条件应写为可核验的具体事件（lockfile 在册已含闸内未成熟版本 / 回放可投毒构建产物 / pnpm trustLockfile 验证腿实测未覆盖），而非裁量判断——这与 pnpm #10438/#11583/#11878 修复时间线一致：上游机器腿可能已天然覆盖，实测（T1）就是验证这个假设。

### 结论 3：β（无条件阻塞）否决理由 — Confidence: 高

β 违反 NIST SP 800-53B 补偿控制门槛（护栏廉价可行时，已验证补偿控制+到期例外是合标形态）；verdict/improvement 混淆；换气轮被吞、治理自催化。

### 结论 4：票序（Q2a）— risk-first 在混合轮中的正确形态是「风险结论先于不可逆动作」，不是「风险工程先于一切」 — Confidence: 高

- Ken Rubin（innolution 原文）：backlog 排序六因子 = value, cost, knowledge, dependency, resources, risk；其规则是「attack the high-risk items before they attack me」——示例是**先做买知识的实验再做功能**，即 risk-first 的正确产物是「先 T1 实验/决策」，不是「先建护栏工程」。T0 取证 → T1 E6 实验+三选一正是「buy knowledge first」。
- Atlassian 原文佐证：sprint backlog 排序基于 business value + dependencies + risk + urgency 四因子混合。
- T1 的三选一裁决是 T2 发布的 dependency（发布判定面需要 E6 结论），故 T1 先于 T2；T2 先于 T3（工程 commit 不阻塞出货）；T4 文书收口殿后。
- 备选「产品先行（先货后闸）」否决理由：E6 结论是 0.0.8 验收面的一部分，publish 是不可逆外部动作；在闸内执法未实测前 publish=在无验证结论下放行——违反 verdict 先行语义。备选「合票」否决理由：与发布验收面异轨，合并即 Q1 已否决的杂物筐模式（ADR-0029 scope discipline 同判）。

## 3) 对比矩阵 — Q2b 三选项

| 选项 | 业界模型评价 | 关键风险 | 裁决 |
|---|---|---|---|
| α 不阻塞，纯记档放行 | 合法形态之一，但缺到期条款时即「undeclared policy change」 | 记档成为永久漏洞（40% 审计过期例外未复审） | 不单独采纳，并入 γ 缺省分支 |
| β 阻塞等护栏 | 违反 NIST 补偿控制门槛（护栏廉价可行）；verdict/improvement 混淆 | 换气轮被吞、治理自催化 | 否 |
| **γ 条件阻塞 + 强制到期** | **标准 time-bound exception + compensating controls + 分级审批形态**；三源一致 | 触发条件若写成裁量而非可核验事件，会退化回 α | **推荐，附五要件记档** |

## 4) 对 R80 的落仓建议

1. **Q2a 采纳原案顺位**，微调为：T0 取证 ∥ T2-机械部分（release.yml 编辑、版本 bump）并行 → T1 E6 实验+裁决 → T2 收尾 → T3 → T4。护栏工程（T3 位次的实质工程）无论裁决结果如何都归 R81 独立成轮。
2. **Q2b 采纳 γ**，且 ADR 中写死：(a) 可核验的阻塞触发条件列表（非裁量）；(b) 放行分支的到期日（≤90 天，即 R81+1 轮内必须复验）+ 复验触发事件（pnpm 上游修复落地 / lockfile 变更 / 新 GHSA）；(c) 续期需升级审批——对应本仓治理即需新 grill 轮立项而非自动滚记档。
3. **关键联动**：T1 实测应优先验证「pnpm 11.3+ trustLockfile 验证腿是否已天然覆盖」——若成立，γ 的放行依据从「补偿控制」升级为「上游机器腿已闭合」，连记档例外都降级为 CI 断言依赖声明。

## 完整来源清单

| # | 标题 | URL | 角度 | 贡献 |
|---|---|---|---|---|
| 1 | Secure Development and Release Governance | supplychainsecurityhandbook.com/practices-controls/secure-development-release-governance/ | Official | gate 输出五态枚举：verdict/remediation 分立；SSDF PS.2/RV.1 映射 |
| 2 | Risk acceptance expiration (glossary) | cybersecurity101.net/glossary/risk-acceptance-expiration/ | Official | 到期三型（date/condition/event）、复验五问、rubber-stamp 失败模式 |
| 3 | Security Policy Exception Process | decryptiondigest.com/blog/security-policy-exception-process | Official/Criticism | 五要件 + 90 天上限 + 两级审批 + 40% 过期例外统计 |
| 4 | Policy exceptions and risk acceptance | grcopilot.app/blog/policy-exceptions-and-risk-acceptance | Official | exception vs risk acceptance 区分；「open-ended = silent policy change」 |
| 5 | Managing Risk Via the Product Backlog (Ken Rubin) | innolution.com/blog/agile-risk-management-managing-risk-via-the-product-backlog/ | Official | backlog 排序六因子；risk-first=买知识先行 |
| 6 | Product backlog vs sprint backlog | atlassian.com/agile/project-management/sprint-backlog-product-backlog | Comparative | value/dependency/risk/urgency 混合排序因子 |
| 7 | SLA-Based Release Gating（Exa 摘要核验） | 供应链安全手册同系文献 | Official | gate 三态 pass/warn/block；blocked-by-evidence 而非 blocked-by-hardening |
| 8 | R80 Q1 历史召回（SLSA v1.1 / pnpm 11.3 / GHSA-q6j5-fjx5-2mc3 / NIST SP 800-53B） | slsa.dev, pnpm.io, github.com/pnpm | Official/Currency | 三选一上游机器腿先例；补偿控制判据 |
| 9 | viso.group / securityexceptions.com / cybersilo.tech（anysearch 摘要级） | — | Community | exception register 共识佐证 |

## 信息缺口

- 「gate improvement 不阻塞」无 ISO/厂商一字千金级原文，属多源实践归纳（但 supplychainsecurityhandbook 的输出枚举已是准一手）。
- npm trusted publishing 首发的手工 publish 窗口期内 lockfile 闸语义无专门文献——按结论 1 的框架直接套用即可，属应用而非缺口。
- 90 天上限在 npm 小版本节奏（0.0.8→0.0.9）下是否恰当，需按本仓发布频率裁量。
