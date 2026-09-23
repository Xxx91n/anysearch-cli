# atomcode R80 Q1 调研存档 — 发布轮 × 供应链执法的双轨裁决

> 调研时间：2026-09-23；引擎：Exa+AnySearch（Tavily 配额超限降级，关键结论 ≥2 独立信源）；问题原文见 q1-prompt.txt

**Sufficiency Gate** — searches: 7（web_search×4 + anysearch×2 + tavily×1[配额超限失败，已用 anysearch 补位]）| angles: Official / Comparative / Criticism / Community | full reads: 7（slsa.dev、pnpm.io/blog、beefed.ai、sre.google ch8、pnpm GHSA advisory、docs.gitscrum.com、zenergytechnologies）| gaps: SAFe 官方 PI 内聚判据原文未直读（用二手引用补位）；tavily 引擎因配额未参与（双引擎交叉已达成）

## 1) 执行摘要 (Tl;dr)

**推荐 C 的收窄变体：双轨同轮，但以「发布就绪验收面」为唯一凝聚轴**——即把 R80 定界为「release readiness 轮」，其内容为：dsh-plugin 发布备货 + 0.0.8 列车备货 + **仅作为发布前置闸的** lockfile 最小必要执法（钉版实测 + 决策记档，不含自建护栏工程）。E6 护栏的完整工程落地（自建/引用上游/记档三选一中的重选项）**不进 R80**，递延 R81 独立成轮。**Confidence: 高**——「发布即含供应链闸」在 SLSA/Google SRE/release-train 三条独立心智模型中均有一手支撑；但「双轨=杂物筐」的警告同样成立，区别仅在执法是**嵌在发布闸内**（同轨合法）还是**并行工程项目**（异轨，须拆）。

## 2) 对比矩阵 — 四选项裁决

| 选项 | 业界模型评价 | 关键风险 | 裁决 |
|---|---|---|---|
| A 换气轮（发布+ride-along） | 合法：release readiness 天然含供应链闸（SLSA: verification 在 publish 时点） | 若护栏决策被挤压成空转，E6 缺口继续裸奔 | 部分采纳（并入 C） |
| B 交接原案（纯 lockfile 执法） | 可行但浪费：发布闸不执法，刚发的 0.0.8 货不带闸 | 四轮零进货后继续压货架 | 否（时序倒置） |
| **C 双轨同轮（收窄版）** | **支持**：hardening/release-readiness sprint 是公认形态，SAFe release train 即含 hardening endgame | 越过「闸内最小执法」边界即滑向杂物筐 | **推荐，附边界** |
| D 纯治理收尾 | 锐评警告成立：第五轮治理自催化 | 货架五轮零进货 | 否 |

## 3) 分点结论

**(1) 发布轮与供应链执法在成熟实践中确实常合为同一验收面，且执法位置就在发布时点。**
- SLSA v1.1 规范一手原文（slsa.dev/spec/v1.1/verifying-artifacts，已读）：verification 的推荐架构首选「package ecosystem at **upload time**」——即完整性校验被设计为**发布动作的内嵌步骤**，而非独立迭代。"Verifying within the registry at **publication time** is also valuable" 是规范原话。
- Google SRE Book ch8 Release Engineering（sre.google，已读）：release engineer 的职责定义就是 "all the steps required to release software—from source code repository to build rules to testing, packaging, and deployment"——**构建一致性、hermetic build、可重复性**（即 lockfile 执法的同族控制）被归入 release engineering 本体，不设独立学科。
- release train 实践（beefed.ai，已读）：每个 "passenger" 的登车验收清单里 "Security scan completed" 是一等公民条款——安全闸是登车条件，不是另一班火车。
- **反向限定**：这些模型的共同点是执法内容=**闸**（checklist 一行、pass/fail），而非**工程项目**。自建护栏工具是工程项目，不属于闸。

**(2) 内聚判据：业界用「共享验收面」区分同轨与 scope creep，与贵仓 R79 三判据同构。**
- 共享验收面判据成立时同轨合理：E6 的 lockfile 执法直接决定 0.0.8 发布列车的登车资格（钉版 11.24.0 的 trustLockfile 实测结论是发布前置条件）——同一闸、同一 pass/fail、同一发布事件验收。这恰好命中 R79 内聚三判据的第三条「共享验收面」。
- 越界信号（Criticism 角度，hardening sprint 文献，zenergytechnologies + Medium Serious Scrum，已读其一）：hardening sprint 被社区长期批评的核心恰是「get out of jail free card」——把本应在常规轨道完成的工作推迟打包，且内容漂移（gold plating）。映射到 R80：**lockfile 执法若从「闸内验证」膨胀为「自建护栏开发」**，就是业界批评的那个反模式。
- 社区实践（GitScrum，已读）：安全工作常规占 sprint 15-25% 容量、proactive hardening 按 P2 正常排期——「安全项与产品项同 sprint」本身是业界常态而非反模式；反模式清单里与之相关的只有 "Security requirements added post-development"（事后加塞），而 R80 恰是**前置**。

**(3) 本仓情境的具体推荐与理由。**
- **推荐 R80 = C 收窄版**：主题定界词应为「发布就绪（release readiness）」而非「双轨」。内容三条腿：
  1. dsh-plugin 0.0.8 发布备货（publish/tag 扳机留用户）——货架终结四轮零进货；
  2. E6 trustLockfile 钉版实测收口 + 三选一**决策**记档（决策是闸的一部分）；
  3. 派生件新鲜度腿作为发布验收的机验前置（CHANGELOG/adr-index 是发布列车的随车文件，属同一验收面）。
- **递延 R81**：若三选一裁决为「自建护栏」→ 那是独立工程轮（与 hardening-sprint 批评中的内容漂移同构，独轮防漂移）。
- **被否选项理由**：
  - **B 否**：时序倒置。SLSA 的 verification-first 架构意味着先执法后发布才能让发布的货物带闸；先发布后执法=发出的 0.0.8 是不带闸的货，四轮治理的产出反而在换气轮被稀释。且 B 把已记档兜底的安全缺口当成整轮主题，违反「兜底已存在则不阻塞」的最小执法原则。
  - **D 否**：第五轮治理自催化，正是锐评警告的路径；9 场审计 4 场打回的教训是治理产出无货架对冲，组织信任耗散。
  - **纯 A 否（若不带执法）**：A 的 ride-along 设计把护栏决策降格为实验腿注释，等于闸形同虚设地放行列车——与 SLSA "verification SHOULD" 精神不符，也浪费了发布轮给执法提供的天然强制力。
- **张力裁决的核心一句**：C 构成杂物筐的判据是「两条轨是否共享同一个 pass/fail 事件」。lockfile 钉版实测的结论决定 0.0.8 能否装车 → 共享 → 同轮合法；自建护栏工程不决定本轮发布 → 不共享 → 独轮。

**(4) 关键事实交叉验证记录**（每条 ≥2 独立信源）：
- trustLockfile 语义（default false、跳过 verification pass）：pnpm 官方 blog 11.3（已读原文）+ pnpm PR #11878（搜索摘要）一致。
- pnpm lockfile 完整性 fail-open 的真实风险：GHSA-q6j5-fjx5-2mc3 官方 advisory（已读原文，CVE-2026-50021，if(integrity) guard）+ GitLab Advisory CVE-2025-69263（搜索摘要）一致——印证贵仓把 lockfile 执法当真缺口是对的，但 advisory 同时确认「已记档补偿控制 + 兜底」是该严重度（Moderate 6.8、攻击复杂度 High）下的业界可接受过渡态，支持「闸内最小执法、工程递延」。
- 知识库召回：ctx_search 命中本仓 R63 首发判据调研（SLSA 证明/验证分离、Google SRE ch8 均已在档）与 R79 内聚三判据条目——本轮结论与其一致并补强。

## 4) 完整来源清单

| # | 标题 | URL | 角度 | 贡献 |
|---|---|---|---|---|
| 1 | SLSA v1.1 Verifying Artifacts（官方规范） | https://slsa.dev/spec/v1.1/verifying-artifacts | Official | verification 首选 upload-time 架构；publication-time 校验原话 |
| 2 | pnpm 11.3 release notes（官方） | https://pnpm.io/blog/releases/11.3 | Official | trustLockfile 语义、default false、staged publishing |
| 3 | Google SRE Book ch8 Release Engineering | https://sre.google/sre-book/release-engineering/ | Official | release engineering 含 hermetic build/一致性/可重复性本体定义 |
| 4 | pnpm GHSA-q6j5-fjx5-2mc3 advisory | https://github.com/pnpm/pnpm/security/advisories/GHSA-q6j5-fjx5-2mc3 | Official/Criticism | lockfile fail-open 实锤、CVSS 6.8 Moderate、补偿控制合理性 |
| 5 | Release Train Orchestration | https://beefed.ai/en/release-train-orchestration | Comparative | passenger 登车清单含 security scan；闸内执法心智 |
| 6 | GitScrum: Security Work in Sprints | https://docs.gitscrum.com/en/best-practices/how-to-manage-security-projects-with-development-sprints | Community | 安全 15-25% 容量常态、反模式清单 |
| 7 | Hardening Sprints: The Good, Bad, Ugly | https://www.zenergytechnologies.com/blog/agile/hardening-sprints-good-bad-ugly | Criticism | get-out-of-jail-free 反模式=内容漂移警告的业界原型 |
| 8 | pnpm PR #11878 / CVE-2025-69263 (GitLab Advisory) | https://github.com/pnpm/pnpm/pull/11878 + https://advisories.gitlab.com/npm/pnpm/CVE-2025-69263/ | Currency | 交叉验证 trustLockfile 与 CVE 时间线（摘要级） |
| 9 | SAFe Agile Release Train | https://framework.scaledagile.com/agile-release-train | Comparative | PI/ART cadence 模型（摘要级） |

## 5) 信息缺口

- SAFe 官方对「PI 内」安全闸与功能项同轨的成文判据未直读原文（二手 + zenergy 引用补位）；但三条一手模型已充分支撑主结论。
- Tavily 引擎因月度配额耗尽未参与，三引擎降级为双引擎 + 知识库召回；关键结论均有 ≥2 独立信源，不受影响。
- 「npm publish 对 rc 线宿主的兼容性追踪义务」未专项调研（属 A 选项内部执行细节，不影响主题定界裁决）。
