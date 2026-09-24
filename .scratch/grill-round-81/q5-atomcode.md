# R81 Q5 — 收口判据 atomcode 调研存档

Question 原文：.scratch/grill-round-81/q5-prompt.txt
Date: 2026-09-24 · atomcode（Confidence 高；Tavily 额度耗尽→双引擎，关键结论≥2 独立信源）

## 1) 执行摘要

提案 A「三段收口（取证/就绪/文书）」与工业界诊断型工作收口心智模型（spike DoD=决策级知识产物、postmortem 闭环=已证伪集+带主 action items、ADR 推荐/裁决分离）结构同构且覆盖良好；与 D-001~D-004 及 ADR-0081 先例无实质冲突。**推荐采纳 A + 两个补项**：(a) 文书段显式判据行「决策与推荐分离」；(b) 兜底段补「未测假设门控票携带原 H# 编号+Test 字段」。R1 skip 验收双格（已发包 skip/未发包不误判）已被提案 A 覆盖且可锚定业界 precondition-check 先例。

## 2) 分点结论

### Q1 — 诊断型 DoD vs 功能型 DoD

| 维度 | 功能型 DoD | 诊断型（spike/RCA/调研）DoD |
|---|---|---|
| 产物 | 可运行代码/特性 | 决策级知识：推荐书、证伪集、PoC、决策记录 |
| 验收 | 测试绿+行为正确 | 问题被回答（或超时降级：已知/未知边界书面化） |
| 时界 | 估算 | 硬 timebox（业界共识 1-3 天，GitScrum/Dojo/SelfMadePM 三源一致） |
| 完结判据 | 合并 | **决策已做出**（"Never deciding" 是头号反模式） |
| 后续工作 | 无 | 强制转出：实现票归下一轮（Lacey 规则） |

- Mountain Goat（Cohn 已读全文）：spike 产出 "building the knowledge that will allow them to deliver the new capability later"；timebox 结束即做决策，"that decision may be to invest more hours"——降级续接是合法出口。
- Dojo Consortium（已读全文）：spike "should follow a Definition of Done, with acceptance criteria, that can be demoed at the end of its timebox"——诊断轮同样要可验收 DoD。
- GitScrum（已读全文）：spike Output 标准件=written recommendation+pros/cons+go/no-go recommendation+estimated effort——与 D-002「诊断书+三分支推荐」逐项对应。
- selfmadepm：spike 头号失败=「完成调查但没捕获 findings」（两月后无人记得）——直接支撑取证段把假设清单+已证伪集书面化设为硬判据。

### Q2 — 三段收口充分性；业界强调项

三段结构充分，4 个业界强调项核对：
1. **知识沉淀质量**（selfmadepm/Dojo）：findings 落卡/落文档+链回原票。提案 A 取证段已含（T1a 实录+T1b 判定表+诊断书落盘）✅
2. **后续工单交接质量**（GitScrum/Dojo）："spike ends with backlog changes and a written record" 是三条铁律之三；后续票必须**具名**（票文名+验收面）。提案 A 文书段 next-round.md ✅，建议判据行明确每个 RESHAPE/未测假设对应**一个具名票**而非一条描述
3. **决策与推荐分离**（ADR 社区+D-003 内在约束）：ADR 捕获 "single decision and rationale"；spike 只产 recommendation（GitScrum "After spike: make the decision... Closure" 是 spike 之后的独立步骤）。D-003 已有此约束，**提案 A 文书段应升格为显式判据行**——主要补项
4. **no-go/降级形态**（incident.io SRE postmortem+Google SRE book）：action item "assigned to a single named owner with a specific due date... objectively verifiable"。提案 A 兜底同构 ✅；ADR-0081 no-go 先例续承 ✅

### Q3 — 验收幂等跳过补丁而不真实发包

- **precondition-check 幂等是标准形态**（valentinprugnaud.dev 已读全文 2026-07）：`npm view "$PKG" version >/dev/null 2>&1 && exit 0`；核心论点与 D-004 R1 完全一致："a security control you cannot safely retry gets disabled the first time it blocks a release at 2am"——验收锚=「同 tag 重跑做正确的事而非报错或双发」。
- **npm 官方确认无内建开关**（npm/rfcs#387 已读全文，2021 开至今 closed 未实现）：`npm publish --ignore-existing` 从未落地——前置 npm view 检查是业界唯一通行解，D-004 R1「npm view 前置 vs E403 容错为票内细节」有官方背书。
- **验收双格法**：(a) 对已发包实测 skip 分支；(b) 对未发包不误判（npm view 非零退出→正常 publish 继续）。提案 A 就绪段已含 ✅——无需模拟 registry，也不用 dry-run（npm/cli#4927 前轮已证）。
- staged publishing（npm 11.15+）不支持新包首发，与 dsh-plugin 首发不匹配，仅作背景记录不作推荐。

### Q4 — timebox 超时降级收口：未决 spike 必存产物

四源收敛同一清单：
1. Cohn：timebox 结束 "a decision is made"——降级本身必须是**决定**（续投/转票/放弃）非默认拖延
2. GitScrum "IF TIME RUNS OUT" 标准件：Stop→document→"What did you learn? What's still unknown? Enough to decide?"——最小集=已学到的+仍未知是否足够决策+下一步
3. selfmadepm：三选一 "extend, narrow the question, or accept the current level of uncertainty"——接受残余不确定性并书面化是合法终态
4. 本仓先例自洽（R68 D-003+D-003 条款 3）：已证伪集+未测假设+阻塞证据→下轮门控票

**映射结论**：提案 A 降级清单逐项对应，**再补一项即完整**——「每条未测假设带 Test 字段原样随票转移」（H1-H4 的 Supports/Conflicts/Test 已是 D-003 硬约束），即"无损续接"的可操作定义。

### Q5 — 提案 A 与账本/既有心智模型一致性核查

| 核查面 | 结论 |
|---|---|
| D-001 产品吸气轮+插曲协议 | ✅ 一致：取证段插曲证据「触发→transcript/未触发→如实记」与 D-004 条款 5 逐字对应 |
| D-002 主轴+三分支 | ✅ 一致：T3 诊断书含三分支推荐；修复码出域与 Lacey 约束一致 |
| D-003 五段式 | ✅ 一致：取证段 T0-T3 逐段映射；timebox 分配未变 |
| D-004 R1-R4 | ✅ 一致：就绪段 R1+双格验收；失败分级不进判据（属插曲执行域非收口域），正确 |
| ADR-0081 三段先例 | ✅ 同构承袭：R80 三段=取证/就绪/文书，同形迁移到诊断轮+多承袭 Time-Bound Exception 降级分支 |
| ship-gate 1u 新鲜度 | ✅ 「新声明须注册 closeout-claims」正确——诊断轮新增可推导声明（如种子化 grep 命中数）必须注册 |
| CONTEXT 词表 | ✅ 新词位存在：Spike-Gated/Blocking-Spike 已在词表；新词（如「已证伪集」正式化）落 CONTEXT 合规 |

**两个补项（非冲突）**：
- 补项 1（决策/推荐分离显式化）：文书段加判据行——「ADR-0082 持有裁决（Decision），诊断书只含推荐（Recommendation）；ADR-0082 的 Options Considered 必须引用诊断书三分支，不得另立未经验证的选项」
- 补项 2（降级 Test 随票）：兜底段加半句——「未测假设的门控票必须携带原 H# 编号+Test 字段」，R82 门控票可直接执行探针无需考古

## 3) 对比矩阵

| 项 | 提案 A 现状 | 业界标准 | 判定 |
|---|---|---|---|
| 知识产物书面化 | 取证段实录+判定表+诊断书 | findings 必须落文档（头号失败=未捕获） | ✅ 覆盖 |
| 推荐/决策分离 | D-003 有约束，提案 A 未显式 | ADR=single decision；spike 只产推荐 | ⚠️ 补判据行 |
| 后续工单具名交接 | next-round.md R82 立项项 | ends with backlog changes，票须具名可执行 | ✅ 覆盖（建议每 RESHAPE/未测假设对应具名票） |
| 幂等 skip 验收 | 双格（已发包 skip/未发包不误判） | precondition-check（npm view→exit 0），官方无内建开关 | ✅ 覆盖，业界同形 |
| 降级收口产物 | 已证伪集+未测假设+阻塞证据 | learned+still-unknown+enough-to-decide+Test 随票 | ⚠️ 补 Test 字段随票转移 |
| no-go 显式分支 | 超时降级+未验如实记 | SRE postmortem 可验证 action item | ✅ 覆盖 |

## 4) 完整来源清单

| 标题 | URL | 角度 | 贡献 |
|---|---|---|---|
| Spikes — Dojo Consortium | dojoconsortium.org/docs/work-decomposition/spikes/ | Official | spike DoD 须有 acceptance criteria、timebox 1-3 天、batching learning 反模式（已读全文） |
| Hardening the Release Pipeline | valentinprugnaud.dev/posts/2026/07/hardening-the-release-pipeline | Currency | 幂等 skip 实码+2am 论点+staged publishing 边界（已读全文） |
| Technical Spike Management — GitScrum | docs.gitscrum.com/en/best-practices/technical-spike-management | Comparative | spike vs feature 对比表、IF TIME RUNS OUT 标准件、recommendation→decision→closure 分离（已读全文） |
| SRE postmortem best practices — incident.io | incident.io/blog/sre-incident-postmortem-best-practices | Official/Criticism | action item 可验证性、contributing factors 优于单根因（已读全文） |
| Agile Spikes Deliver Knowledge — Mountain Goat | mountaingoatsoftware.com/agile/what-are-agile-spikes | Official | excess uncertainty、timebox 结束即决策、决策可为续投知识（已读全文） |
| npm rfcs #387 — publish --ignore-existing | github.com/npm/rfcs/issues/387 | Official/Criticism | npm 无内建幂等开关官方证据（已读全文） |
| How to Run a Spike — SelfMadePM | selfmadepm.com/blog/124-... | Community | 头号失败形态、超时三选一（摘要+双源旁证） |
| ctx 知识库 R81 Q2/Q3 前轮调研 | （本地索引） | 项目内 | sre.google/jamesshore/aqua 已读记录、Lacey、WSJF、npm/cli#4927 |

## 5) 信息缺口

- Tavily 引擎额度耗尽→双引擎交叉，关键结论均≥2 独立信源补偿
- 「未决 spike 降级产物」无权威单一标准文——清单由四源收敛而非单源引用（置信中高）
- staged publishing（npm stage publish）2026 新面只作背景核验，未实测与本仓 npm 版本兼容性——已排除为推荐项
