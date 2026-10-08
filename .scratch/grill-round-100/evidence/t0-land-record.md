# R100 T0 — 绿门清偿 land 记录（义务瓣首演：land⇒同会话重锚 commit）

- 日期：2026-10-08（T0 执行窗）
- 修复栈：`r100-green-repair`（独立栈，不叠 r100-grill-ledger）
- push：origin/r100-green-repair @ `8d1854e2`（2026-10-08）
- CI 观测（land 前置，candidate 合并树）：ship-gate run 37712802985 = success（ubuntu+windows 双绿；macos EXPERIMENT 非阻断）；ci run 37712808007 = success。触发式=workflow_dispatch on pushed ref。
- land：`but land r100-green-repair` ff-land 上 origin/main——tip 992412d6 → `8d1854e2`（父已为 tip，真 ff，SHA 未重写）；origin/r100-green-repair 随 land 自动注销（GitButler landed-branch cleanup，非裸删远端指针）。
- 修复内容：.scratch/grill-round-99/handoffs/round-99-closeout.md Stack 行——活链改述 `Stack（dissolved @ 2026-10-06）`；六枚 capture SHA（e9b888d4/16205b9d/9ffdfc47/759fe259/1d759e81/e5d40d8d）留散文史料逐条对应原条目；`<!-- re-anchor: 2026-10-08 ... -->` 记改述仪式。
- post-land main tip 重验（公开树，pre/post 断言对象不同不可互替）：land push 触发 main push 三跑——ci 37713569426 / ship-gate 37713569449 / native-smoke 37713569413；本地 `node scripts/ship-gate.mjs` 复跑（结果见下）。
- 判例遵守：未用 `time-lagged-capture` 词表项（equivalent-mutant 处死）、未用 but-id 主键放宽（R98 Avoid 条款）；dissolved 改述逐条对应原 Stack 条目、closeout-coverage 双向一致。

## 本地复跑记录

- main push 三跑全绿：ci 37713569426 success (4m51s) / ship-gate 37713569449 success (8m37s, ubuntu+windows) / native-smoke 37713569413 success (39s) —— 公开树 post-land 重验 GREEN。
- 本地 `node scripts/ship-gate.mjs` 全量复跑 = `[pass] ship gate green`（9/9；handoff-lint 1g: r99 closeout [three-state] PENDING=dissolved 栈腿 GREEN + run-url stack-unpushed 预期 PENDING；anchors 1j 5/5 consumer-verified；eval 126/126；pack+stdio/fail-open 活测绿）。环境修复：packages/retriever/node_modules 局部断链（@sinclair/typebox 缺席）经 rm+pnpm install 重建，非代码缺陷（CI 全新安装同步绿）。
