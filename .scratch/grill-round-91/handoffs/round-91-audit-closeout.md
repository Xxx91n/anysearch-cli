# Round 91 审计收口交接 — dsh 售后验收轮（LOOP1–LOOP3 全记录）

**日期**: 2026-09-29
**编制**: 独立审计窗口（r91-audit lane）
**上游工件**: 轮报 .scratch/grill-round-91/reports/2026-09-29-report.md；收口 .scratch/grill-round-91/handoffs/round-91-closeout.md；任务书（终态已戳）.scratch/grill-round-91/handoffs/next-round.md；审计 LOOP1 reports/2026-09-29-audit.md、LOOP2 reports/2026-09-29-audit-loop2.md；ADR docs/adr/0092-architecture-grill-round-91-dsh-l3-smoke-closeout.md；返修窗口签发的系统临时目录 handoff-round-91.md。

## 审计三轮 LOOP 全记录

- **LOOP1**（reports/2026-09-29-audit.md）：硬验收四腿（编译/打包/启动测活/test 闭环）亲跑全绿复现；双轴评审（Standards/Spec）+ D-001~D-003 逐条核对；呈报 P1–P4 文书失真（sha 双锚悬挂／T6 待跑矛盾／T4d 归属／L3b 工具名预注册缺陷）+ P5–P10 低危与观察项。
- **LOOP2**（reports/2026-09-29-audit-loop2.md）：返修核销复核——P2/P3/P4/P5/P7 确认核销；P1/P6 部分核销（四文书 T5 行钉悬挂 21857563、轮报 L17「66 项」残留）；立法 M1/M2 微修规格与 LOOP3 最小复核清单。
- **LOOP3**：M1/M2 修毕（四文书 T5 行改「本批 (uts)」+ 轮报口径改「[pass]×65 [fail]×0」）并 amend 入 T5（uts，落笔时值 sha f0a8a9ca）；ship-gate --quick 复跑 [pass]×65 [fail]×0 + closeout-claims 8/8；21857563 与「66 项」全仓四文书零残留；evidence/ 与 closeout-claims.json 自原票后未被触碰。**审计通过，handoff 解除扣发。**

## 锚定纪律（下轮必读）

- **but-id 为唯一稳定锚**：kmv/wpr/ssl/otk/lvx/ppu/uts（r91 票序）+ upx/nok（审计件）。
- 文内 sha 均为落笔时值；reconcile/land 后以 main git log 为准。T5 行不钉 sha——T5 提交内部文书自钉自身 sha 在密码学上不可能（amend 必漂移），此教训已写入 ADR-0092 票序节注记。

## 关键终态

- 判词：F-bug（分支 C；环境根因 DEEPSEEK_API_KEY 缺失，非机制故障）；L3a established 当场可复现（dump-config 单行注册在位）；T3/TC 条件票未启不留痕。
- 硬验收六项（check/test/ship-gate/pack/dump-config/--json 探针）审计独立复跑全绿；closeout-claims 8/8。
- 治理：ADR-0092 D1 工具名已勘误为注册面实名（ans_search_web/ans_recall_memory/ans_query_knowledge/ans_research_web/ans_chat）；D4 两拍节奏（定义本轮完成，检查器接线登记 R92）；D3 WORKFLOW 判死（supersede 语义，GitButler skill 等价覆盖）。

## 挂账（R92 输入）

1. **readme-token-pin 断言检查器接入** scripts/ship-gate.mjs（两拍第二拍；R92 候选票已登记于 ADR-0092 D4）。
2. **DEEPSEEK_API_KEY 注入后复跑 T2**：按勘误实名 + 跑前定死诱导句（ADR-0092 D1 L3c-full 矩阵），N≤3，transcript/verdict 双工件落盘。
3. **defer-r72-dsh-approval-channel**：维持 defer（headless 无 answerer 实证，fail-closed）。
4. **npm deprecate 双空格修正**：待有发包权限账号亲触执行（备准命令在 evidence/t4b-deprecate.md）。
5. **观察项**：verify-observation.mjs 瞬时抖动（三跑 1 红 2 绿，spawn 型冒烟腿）；CI 祖先线 main tip 三跑全绿（ci 36546782541 / ship-gate 36546782344 / native-smoke 36546782634）。

## R92 建议主轴

readme-token 检查器接线（小票，两拍收口）+ DEEPSEEK_API_KEY 到位后 T2 复跑（条件票）+ 垂域死刑复核开庭候选（r88-candidate，R89 起明文排期；开庭建议以 R90/R91 两轮 dsh 线收口事实为背景证据）。

## Suggested skills

- gitbutler（but）：版本控制；本轮已实证 but land 直接落 target 的用法。
- grilling / to-spec / implement：R92 主轴标准流程。
- code-review / handoff：轮末双轴复核与交接。
- context-mode（ctx_*）：取证与文件读取首选面。

本文件签发于 land 之前；land 后各 sha 以 main git log 为准（but-id 锚不变）。
