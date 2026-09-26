# atomcode 调研存档 — R84-Q7 audit-rework 批次去向（2026-09-26）

> 原问题存档：q7-prompt.txt。本件为 atomcode stdout 忠实重组（ctx 索引节拼合）。裁决建议：(A) 耦合分流。

## 1) 执行摘要（Tl;dr）

**推荐方案 (A) 耦合分流，Confidence：高。** A-02/A-04 定义的是 eval 断言键（expected.vertical/params_keys/degraded）将冻结进 golden 的**被测语义本身**——契约测试成熟惯例：断言只能落在消费方真正依赖且已被立法的承诺上，未定义行为不得成为断言对象（Pact 官方 Golden Rule+Postel 原则）；语义前置按 TDD 心智属「红-绿循环的 Red 步骤」天然属主票。A-05/A-07 是已披露/文档级收口，复核行足矣；A-03/A-06/A-08 与 eval 腿零耦合，整批挂 registry 清障轮符合「too small to track separately vs. must have a ticket」边界判据。(C) 整批 defer 代价判断成立：断言冻结偶然行为=TDD 同义反复/实现耦合反模式直接形态，延后=断言面上线时语义仍未立法，回归信号从此失真。

## 2) 分点结论

### ① 「断言面下不得有未立法语义」有直接工业惯例支撑——支持前置语义立法

- Pact 官方消费者测试文档（已读原文）：「Only make assertions about things that will affect the consumer if they change」「Only assert on formats or constraints that your consumer actually depends on」——断言合法域=**已被双方理解为承诺的行为**，不是 provider 当前恰好返回什么。QASkills 2026 Pact 指南：「The contract encodes real coupling, not aspirational schema completeness」。
- Pact 规范 V3 README（已读原文）失败模式哲学：「err on the side of being more strict now, because it will break fewer things to be looser later」——语义歧义应在断言固化前先收紧立法。这正是 A-02 处境：现在不立法，golden.entries 冻结的是三种入口各自偶然行为。
- 对应 A-04：Pact 对「provider 未处理的状态」惯例=**验证直接失败**而非静默通过——未立法行为不得进入断言绿灯。空 sub_domain_params:{} 上 wire 若不先定义，params_keys 断言=给偶然行为盖章。

### ② 「断言冻结偶然行为」在 EDD/TDD 文献是命名反模式——佐证 (C) 代价判断

- ctx 知识库（TDD 技能，两份独立副本交叉一致）：**Tautological**（断言按实现方式重算期望值，构造上永真）与 **Implementation-coupled**（重构即碎但行为未变）是头号反模式；期望值必须来自独立真理源。语义未立法时写下的断言恰构造出这两类伪测试。
- Braintrust EDD 文：EDD 前提=「eval correctly captures quality」——eval 即工作规格，规格（语义）缺失时 eval 不能充当 oracle。web.dev EDD 教程同样把「Define the problem like an API contract」放在 eval 系统搭建之前。
- pathtosenior EDD 踩坑文反面案例：跳过失败模式分类直接自动化评估→指标空洞（失配变双重失败却不指向修复）——对应 A-04 空参语义悬置就写 params_keys 断言的后果。

### ③ 审计发现 triage：按「与被测路径可达性/耦合度」分流是安全审计工业标准——直接支持三类分流

- 安全审计成熟做法（Orca/Backslash/site-health-audit P1-P4 rubric）：triage 核心轴不是严重度而是 **reachability**——「Reachability is what shrinks a five-figure finding count to a two-figure action list」「Policy gates block only the reachable, exploitable tiers and route the rest to backlog」。映射本仓：eval 断言路径可达=前置耦合类升主票；文档/披露层可达=收口复核；断言路径不可达=backlog/清障轮。
- GitLab 安全 triage 文档：confirm-or-dismiss 逐项按风险路由，反对整批一刀切；Orca 两大失败模式「Fix everything（工作量淹死）」与「Defer remediation（风险敞口留存）」分别对应 (B) 与 (C)。

### ④ 「前置修复并入主票」vs「辅轴/延后」边界判据——两条成熟判据都指向 (A)

- Boy-scout 边界（refactoring.fm+marktinderholt 已读原文）：顺带修复合适判据=「很小（5-10 分钟）+本来就要触碰该代码+可无限期等待」；Tinderholt：「If you're fixing a bug, fix the bug… Don't sneak in unrelated cleanups. Flag it. Log it. Open a separate ticket.」——A-02/A-04 是语义立法+实现对齐+断言设计三件事互相咬合，工作量与决策密度超 boy-scout 阈值，且不做主票就不能安全落地断言→并入主票（作 Red 阶段非独立辅轴）。A-03/A-06/A-08 满足「零耦合+可等待→单独挂账」。
- 边界判据一句话：**「该发现不修，主票验收标准是否失真？」失真→前置并入主票；不失真但属同文件收口→复核行；完全不影响→清障轮**。与 Pact「若移除这个测试场景是否有某类 provider 变更会漏检」判据同构。

### ⑤ 两源分歧记录：boy-scout 规则的支持面

- refactoring.fm 评论区反方声音（「小顺带清理不该要求开票」）——分歧在团队规模与评审带宽，不改变本案结论：A-02/A-04 非小清理（跨三入口语义决策）不适用 boy-scout 豁免；A-03/A-06/A-08 走 registry 不违反该方立场（即「flag it, log it」）。

## 3) 对比矩阵

| 方案 | 断言面完整性 | 范围纪律（ADR-0029） | 返工批次体积 | 行业先例 |
|---|---|---|---|---|
| (A) 耦合分流 | ✅ 断言实现前语义已立法，golden 冻结承诺 | ✅ 主票只含耦合项，清障独立成轮，合 one-grill-one-topic | 中（主票+2 项前置） | Pact+AppSec reachability+boy-scout 边界三源 |
| (B) TE 式整批辅轴 | ⚠️ 语义立法与断言实现分票，时序缝隙=冻结偶然行为 | ⚠️ 无耦合项强行并轮稀释主题 | 大 | Orca「fix everything」失败模式 |
| (C) 整批 defer R85 | ❌ 断言面上线时语义空洞留存 | ✅ 最保守 | 零 | Orca「defer remediation」+TDD 同义反复反模式 |

## 4) 对 (A) 的落地注记（结合仓内 ADR-0029/0080 语境）

- **A-02 立法建议具体形态**：援引 Pact robustness 条款方向反用——对**配置输入**（composition 边界）应 fail-fast 而非 fail-open：MCP 入口 AJV 拒收已是正确行为，立法应使 CLI/TOML 两入口对齐「拒收并报错」或三入口统一「忽略并显式 warn」，关键是 golden 断言只允许依赖立法后的那一种行为——属主票 Red 阶段语义决策非实现细节。
- **A-04**：空参语义立法后 params_keys 断言才有独立真理源（立法文档/类型定义），否则满足 tautological 形态（期望值来自实现自身的偶然输出）。
- **A-05/A-07 复核行**：与 ADR-0084 已披露内容对账即可，无需独立工作项——符合 Origami Risk「closing an issue should require evidence」最低闭环形态。
- **A-03/A-06/A-08 registry**：符合「需票但可等待」判据，挂清障轮与既有 refactor-commit+CHANGELOG 惯例一致。

## 5) 完整来源清单

| # | 标题 | URL | 角度 | 日期 | 贡献 |
|---|---|---|---|---|---|
| 1 | Writing Consumer tests（Pact 官方） | docs.pact.io/consumer | Official | 长期文档 | Golden Rule：只断言影响消费方的承诺；provider 未建态=验证失败 |
| 2 | Pact Specification V3/V4 README | github.com/pact-foundation/pact-specification | Official | — | 「先严后松」哲学；robustness 条款；未处理 provider state 语义 |
| 3 | Pact Contract Testing Complete Guide 2026 | qaskills.sh/blog/pact-contract-testing-guide-2026 | Comparative/Currency | 2026 | 「contract encodes real coupling, not aspirational schema completeness」 |
| 4 | What is eval-driven development（Braintrust） | braintrust.dev/articles/eval-driven-development | Official/Currency | 2026-02-18 | Evals as specifications；eval-as-oracle 前提=规格先在 |
| 5 | Evaluation-driven development（web.dev） | web.dev/learn/ai/evaluation-driven-development | Official/Currency | 2026-01-29 | 「Define the problem like an API contract」先于 eval 系统搭建 |
| 6 | Mistakes I Made Approaching EDD | pathtosenior.substack.com/p/mistakes-i-made-approaching-eval | Criticism/Community | 2026-02-19 | 跳过失败模式分类→指标空洞反面案例 |
| 7 | Boy scout maintenance（refactoring.fm） | refactoring.fm/p/boy-scout-maintenance-icap-framework | Community/Criticism | 2023-10-02 | boy-scout 适用边界：很小+可等待；评论区反方声音 |
| 8 | PRs Are Conversations, Not Todo Lists | marktinderholt.com/.../pr-conversations.html | Community/Criticism | 2025-05-23 | 「fix the bug, ship the feature；unrelated cleanup→separate ticket」 |
| 9 | Assigning Severity Labels to Audit Findings | site-health-audit.com/.../assigning-severity-labels-to-audit-findings/ | Official/Currency | 2026-07-05 | 确定性 triage rubric；reachability gate「track, batch-fix」层 |
| 10 | From Findings to Fixes（Orca） | orca.security/resources/blog/application-security-prioritization-remediation-triage | Official/Currency | — | 两大失败模式：fix everything/defer remediation |
| 11 | Triage（GitLab Docs） | docs.gitlab.com/user/application_security/triage | Official | — | confirm-or-dismiss 逐项 triage 反对整批 |
| 12 | Triage a backlog（Codex Security） | learn.chatgpt.com/docs/security/plugin/triage-backlog | Official/Currency | — | finding=unproven claim 按证据分流 |
| 13 | Pact Consumer Docs（规则清单版） | 同 #1 页面后半 | Official | — | 「Avoid over-constraining the provider」判据 |
| 14 | 从 Audit Findings to Action（Origami Risk） | origamireference.../from-audit-findings-to-action | Official | 2026-02-02 | 审计发现→可追踪 issue 最低闭环字段 |
| 15 | 本仓 ctx 知识库：TDD 反模式/R83 审计登记/ADR-0028/CONTEXT 页族断言层 | 本地 | 本地证据 | — | 断言冻结偶然行为=命名反模式；断言粒度锚定被测方稳定承诺原则 |

## 6) 信息缺口

- 未找到「断言面下语义空洞」作独立命名的工业术语——本结论由 Pact「只断言所依赖承诺」+TDD 同义反复反模式+EDD「eval 即规格」三源交叉合成，非单一逐字先例。
- 审计 triage 的「按耦合度分流」在传统内审文献以风险为核心轴、未显式讨论「与当前工作流耦合度」维；耦合轴直接先例来自 AppSec reachability 分流，属类比映射而非同域惯例。
- AnySearch 垂直域（academic/legal）未检出直接讨论「eval assertion 语义前置排序」的论文；arXiv 2411.13768（LLM 评测运营）摘要命中未深读，若需学术背书可作 R85 补充。

**searches**: 6（Exa×2/Tavily×2/AnySearch×2）| full reads: 6+qaskills extract | angles: Official/Criticism/Comparative/Currency/Community 五类覆盖