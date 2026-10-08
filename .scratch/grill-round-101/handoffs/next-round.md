# R101 任务书（由 R100 T4 生成）

> 本文件是 R101 的常驻任务书。形态按 ADR-0101 D7：正题开工前先评估 deferred 触发条件；每轮至多一个正题 + 残留轨清偿 + cohesive 顺手项；push/land 须 owner 授权窗。

## T0 — 残留轨清偿（先验义务，critical-path）

- **本栈 land 后同会话重锚**：R100 交付栈（r100-grill-ledger + r100-meta-cap-impl）land 上 origin/main 后，同会话完成 §5 双绑 post 段：① main push 三跑绿 + 落树 ship-gate 复跑；② `.scratch/grill-round-100/handoffs/round-100-closeout.md` Stack 行改述 dissolved 形态并记 land 后 main SHA——机械位 `node scripts/handoff-reanchor.mjs .scratch/grill-round-100/handoffs/round-100-closeout.md`。
- **清算坐席回落**：`defer-r100-stack-land-authorization` 随 land 关闭（defer-r98 先例）。

## T1 — 正题候选（立项评估序）

- **候选 A：`defer-r72-dsh-approval-channel` 前置**——R100 注记在档：trigger=依赖已解除可前置。开工前完成 ADR-0101 D7 触发条件评估（tarball 复验 + 依赖键面复核），触发成立即立项为正题。
- **候选 B：sunset N 值首应用裁决**——锚活性一行账 R100 首行全零；R101 评估各锚 prod-findings 计数语义（fixture kill 不计）并裁定 sunset N（连续零产出轮次上限）。规模偏小，宜作顺手项。
- **候选 C：AST 排除候选入册**——24 枚具名候选（`scan.candidates`）中择稳定者转 `EXCLUDED_PATHS` 正式条目；每转正一条带 paired fixture。

## 硬约束（沿用）

- 断言数只升不降（现基线 verdict 473 / e2e 450）；判定核纯净（observation 在 shell，verdict 无 I/O）；fail-closed（未采集=env-PENDING，矛盾=RED）。
- AST 前门：白名单扩充属修层动作（同判据入 ledger）；新模块携副作用→具名排除候选（info），携 codes→三分类裁决。
- closeout Stack 行活链三元素 + `PENDING: stack-unpushed`；禁预写 dissolved（未来日期即 RED）。
- 锚活性一行账随每轮 closeout 更新（`kind:"anchor-activity"` claim 机检逐字比对）。
- `LEGACY_SEAT_REVIEW_BY` = 2026-10-22：存量裸串坐席到期前须改述结构化或关票，到期即 `anchor-seat-expired` RED。

## 范围外（立项时裁定）

- `defer-r72-dsh-web-interactive-matrix` 主体（patchReload:live / browser-turn）——上游 .d.ts 键面缺席复核维持 defer。
- 第五形态新锚扩张——滤尺未触发不加新锚（ADR-0101 D2）。
