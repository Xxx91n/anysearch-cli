# Handoff — Grill Round 99 任务书（R98 收口承接：push/land 授权窗 + 锚坐席关闭票 + 开放面扩表）

- 日期：2026-10-04 | slug：`grill-round-99`
- **唯一事实源**：`.scratch/grill-round-98/decision-ledger.md`（D-001~D-004 全 current，R98 已兑现）
- 上轮收口：`.scratch/grill-round-98/handoffs/round-98-closeout.md`
- R98 轮报：`.scratch/grill-round-98/reports/2026-10-04-report.md`
- R98 立法：`docs/adr/0099-architecture-grill-round-98-fifth-morphology.md`

## §0 执行纪律（沿账）

- 全部 VC 操作走 GitButler；`but push`/`but land` 须 owner 授权，范围外不扩权。
- 判定核纯净 / 薄壳不写判定 / 正反成对 fixture / fail-closed / 断言数只升不降。
- 每票收口前自对账覆盖 D 条；发现账本偏离须具名申报，不静默。

## T0 — push/land 授权窗（owner 批准后执行）【已于 2026-10-04 R98 LOOP1.5 会话内执行：owner 授权 `but land` 两栈 ff-land 上 origin/main（实现栈至 `365b675b`、审计栈至 `ea1ae539`）；closeout/审计交接声明按重锚仪式改述 dissolved+`no-branch-runs`；`defer-r98-stack-land-authorization` 已闭。本票剩余仅「真实 CI run 观测」——首个可能兑现 `GREEN:` run-URL 的窗口待 CI 回传。】

`r98-anchor-detector` 未 push 未 land（R98 收口残留分支，`defer-r98-stack-land-authorization` 在册）。

1. owner 授权后：`but push r98-anchor-detector` → 观测真实 CI run（首个可能兑现 `GREEN:` run-URL 的窗口——PR 拓扑生效前提）→ `but land` → `but pull`。
2. land/push 使 R98 收口件声明当场失效（`unpushed` 标记 + `PENDING: stack-unpushed` 码），按重锚仪式改述；`defer-r98-stack-land-authorization` 票随 land 关闭。
3. 前置闸门 `node scripts/ship-gate.mjs` 复跑绿后才执行 VC 动作。

## T1 — 锚坐席关闭票【ratchet 语义兑现】

`defer-r98-anchor-ratchet-recount-seat`：坐席锚 `anchor:ratchet-recount` 当前执行探针但 skip 非 fail。关闭票（status→closed/resolved）即自动升全量 kill 判定——零代码改动，本票关闭即验收场。

## T2 — 开放面扩表示范票（可选窗口）

`defer-r98-anchor-open-surface-demo`：首张锚扩表即闭环验收——新锚条目须携证伪 fixture 方准入表（自指钉①），runner 对不可解析 probe 即 `anchor-unresolvable` RED。本轮若无新锚候选可继续挂账。

## 三态骨架（收口裁决）

- **全绿路径**：T0 授权执行且首 CI run 绿 + T1 关票后 `anchor:ratchet-recount` 全量 kill 过 + 验收电池复跑绿 → R99 GREEN。
- **降格路径**：T0 未获授权 → 收口件沿用 `PENDING: stack-unpushed` + dissolved 核验（R98 语法面先例）；栈残留须 deferred 在册否则 clearing RED。
- **F-bug 承接**：检测器上线后发现存量装饰（某锚不杀）→ 具名申报 + 先修后检（R98 T1 先例），禁降格判据。

## 范围外（沿账不扩展）

不重开评测矩阵、不动 r88 formally-declined、不追写已冻结 claims、不做发布/tag、活体谓词仍只走 deferred、docs/adr 不入状态标记靶位、不裸删远端指针。
