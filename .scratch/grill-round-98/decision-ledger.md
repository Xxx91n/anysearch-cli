# R98 Decision Ledger（grill-round-98）

> 唯一事实源。每条：ID / 原问题 / 用户原回答原文 / 规范化需求 / 显式约束·负向需求 / 状态（current/revised/stale/deferred）。
> 恢复上下文权威入口：`.scratch/grill-round-97/handoffs/next-round.md`（R98 任务书）+ `.scratch/grill-round-97/reports/2026-10-03-audit-report.md`（R97 独立审计）。

## D-001 — R98 范围定界与 land 授权窗（正题：自造机检声明第五形态 + 前置义务轨返工 + B 轨逐栈 land）

- **原问题**：R98 本轮构成三子项——(a) 正题是否采纳任务书建议的「自造机检声明」第五形态立法；(b) R97 审计返工票 R1~R8/R10 的定位；(c) B 轨 land 授权窗口与执行路径。
- **用户原回答原文**：「采纳」（用户前置倾向「我偏向a+b+c」，经 atomcode 深调呈报 + 拓扑误读辩证修正后确认）
- **规范化需求**：
  - **正题（a）= 自造机检声明第五形态立法**：判据 = 「ADR 宣称机器约束 ∧ 实现零消费 → RED」；首版 RED 面收窄为注册表条目 + reuse 指针两类结构化锚，ratchet 计数类先落 PENDING（与形态二「先 PENDING 后 ratchet 升 RED」既定模式同构）；只检注册表 schema 面，不做通用死代码检测；检测器自身断言须有真实 fixture 消费（自指负担，四个同型实例恰为样本）。
  - **前置义务轨（b）**：R1~R8/R10 显式入 goal.md 为前置轨——先修 → 重跑同一套验收电池（check 8/8、build 5/5、test 13/13、真值表 357/0、E2E 270/0、8 包 tgz、ship-gate REAL_GATE_EXIT=0+green、CLI/MCP 测活、5 面适配器断言、memory-eval 126/126）→ 断言数只升不降（R96 审计 P5 教训）；R3/R5/R4 兼作正题 dogfooding 样本；R6 优先补码而非降格（降格将构成 R97 D-002 revised，避免账本连锁改写）。
  - **B 轨 land（c）**：owner 授权后在本轮实现 commit 前逐栈执行——`but land r97-audit-reanchor --whole-stack`（ff，37c 覆盖 R97 实现+重锚；r95-rework 在同栈随 land 由 but pull 回收）→ `but pull` → 依次 land 余栈（grill-docs 栈顶 r98-grill-ledger 6c / r97-audit-ledger 2c / r96-audit-loop2 4c / r95-audit-loop2 3c / r95-audit 1c）；每次 land 后 `but pull` reconcile 余栈保持 ff 性；land 前 `node scripts/ship-gate.mjs` 复跑由裁量升为必做前置闸门；每次 land 使相关 unlanded 声明失效 → 按已立法重锚仪式改述；goal.md 风险登记：①首次真实 CI run 可能首红 ②ff-land 后 run-URL 仍只能 PENDING（ADR-0098 Known-Risk 5，GREEN 兑现待 PR 拓扑）③land 绕过 review 检查，替代保证=审计电池+首次 CI run。
  - **R97 D-002 事实更新承接**（显式注记非裁定推翻）：land 对象栈顶 r96-audit-loop2 → r97-audit-reanchor（多栈实测：`but status` 中 `├╯` 为栈分隔符，实现车道顶为 reanchor；呈报期「单一栈/r97-audit-ledger 全清零」为误读已更正）；land 时序窗口「R97 实现期前」顺延为「R98 实现期前」（审计 P-4 偏离的迟来履行，纠偏非二次偏离）；机制 / ff 形态 / but pull 回收 / 未授权不执行四项沿用不动。
- **显式约束·负向需求**：①单题性守恒——正题名义归第五形态立法，返工轨以「前置义务轨」名义入 goal 非平行正题（ADR-0029 同子系统 cohesive items 合规；四个装饰件与第五形态同属声明-兑现缺口一主题）；②grill 期不动源码——land 属实现期 T0 动作，授权在案但执行窗口在实现期开工前；③返工判据——先修后检（检测器上线瞬间存量违规为零或有显式 baseline），禁「立法即开局四红」；④判据边界——禁裸「零引用 → RED」（防误伤声明为散文契约的文档性数据）；禁通用死代码检测；⑤已否项：拆三轮（B 轨窗口失效 + R3/R5 失同批收敛）/ 四形态全 RED（开局四红违清算义务）/ 只出报告不开门禁（重蹈 S-1 弱化）/ 实现后 land（丢零冲突窗口）/ 继续积压（与 trunk-based 相悖）；⑥范围外沿用 R97 清单不扩展（不重开评测矩阵、不动 r88 formally-declined、不追写已冻结 claims、不做发布/tag、活体谓词仍只走 deferred、docs/adr 不入状态标记靶位、不裸删远端指针、仓外技能文档缺口须单独授权）。
- **状态**：current
