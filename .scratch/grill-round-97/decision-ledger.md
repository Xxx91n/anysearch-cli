# R97 Decision Ledger（grill-round-97）

> 唯一事实源。每条：ID / 原问题 / 用户原回答原文 / 规范化需求 / 显式约束·负向需求 / 状态（current/revised/stale/deferred）。
> 恢复上下文权威入口：`.scratch/grill-round-96/handoffs/round-96-audit-loop3-handoff.md`。

## D-001 — R97 范围定界（正题 A：自造失效声明可机检类别 + 并行处置轨 B：未合并分支清算）

- **原问题**：R97 这一轮正题选什么？（A 自造失效声明立法为可机检类别 / B 未合并分支清算轮 / C N5 专项票 / D 其他）
- **用户原回答原文**：「A+B」
- **规范化需求**：R97 采用双轨构成——
  - **正题面 A（立法/设计面）**：把「自造失效声明」立法为可机检类别。同族缺陷第三次出现且刚被门禁首次机器捕获（push 后 `PENDING{stack-unpushed}` 被 `declaration-fact-conflict` 当场抓出、Stack 链尾 SHA 被 `chain-tail-not-in-branch` 抓出）；前两次全靠人工审计（R95 F5R push 自造失效 / R96 P5→LOOP2 F1 ADR 写入即失准的实测值 / R96 §10.3 改写立法文本静默打断机械锚 claim）。候选可机检形态（声明-动作一致性 / 立法数值时效契约 / 机械锚语义锁）的取舍与边界留后续问题裁定。
  - **并行处置轨 B（一次性 VC 处置）**：解决上轮未合并分支积压——origin/main 自合并基点 `3642d494` 起 0 commit 新增；全工作区单一栈车道（顶→底：r96-audit-loop2 → r96-audit → r95-audit-loop2 → r95-audit → r96-handoff-lint → r95-exec → r95-rework → r96-grill-docs → r95-grill-docs → 基底）；r95-rework 处置三选一已登记（留置 / land 后 but pull 回收 / 授权裸 git push --delete 仅删远端指针）。B 的裁量与时序留后续问题。
- **显式约束·负向需求**：①单题性守恒——正题名义归 A（ADR-0029），B 以「并行处置轨」身份存在；B 是否产立法面（栈合流纪律类词条）另由专门问题裁定，默认不产；②grill 期不动手修源码——含 N5（`parseButStatusIds` 漏 U+25D0 `◐` 标记致 Stack 腿假红），其归属（正题内子票 / 独立票 / 台账）留后续问题；③B 的一切 land / 删 ref 动作属外部授权操作（push main、origin 删指针），裁量归 owner，grill 只定型方案与时序，未授权不执行；④范围外沿用：不重开评测矩阵、不动 r88 formally-declined、不追写已冻结 claims 工件、不代持/改凭证、不做发布/tag；⑤双轨交汇点明示——B 处置现场（「未 push / 未 land」声明的失效史）正是 A 类缺陷的最大实物样本，A 的立法须兼容 B 处置产生的状态迁移。
- **状态**：current
