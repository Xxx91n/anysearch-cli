<!-- state: unlanded r99-vocab-expansion @ 2026-10-05 -->

# Handoff — Grill Round 99 → R100 任务书（候选：递归入域 / 坐席 loophole / B 残余）

- 日期：2026-10-05 | slug：`grill-round-99`
- **唯一事实源**：`.scratch/grill-round-99/decision-ledger.md`（D-001~D-003 全 current）
- R99 收口：`.scratch/grill-round-99/handoffs/round-99-closeout.md`；轮报：`.scratch/grill-round-99/reports/2026-10-05-report.md`
- R99 立法：`docs/adr/0100-architecture-grill-round-99-vocab-guards-open-surface-expansion.md`

## §0 执行纪律（沿账）

- 全部 VC 走 GitButler（`but`）；push/land 须 owner 授权，范围外不扩权。
- 判定核纯净 / 薄壳不写判定 / 正反成对 fixture / fail-closed / 断言数只升不降。
- 立法先于实现 commit；每票收口前自对账覆盖 D 条；账本偏离须具名申报不静默。
- 数据源纪律：实现唯一依据=本轮账本，不从对话回忆补结论。

## 候选主题（R100 开庭裁定）

1. **递归入域**：`scripts/tau/` 子目录入 vocab-guards 扫面域（R99 顶层 glob 不递归的后续票）；需重新评估 tau/ 顶层零副作用与排除清单。
2. **坐席 loophole 收敛**：R99 四钉演练具名发现——open seat 可掩盖装饰锚；候选立法=坐席锚的探针不杀时出 info+限期或降格。
3. **B 残余（检测器自指第三轮）**：R99 已并入顺手段落，余量 R100 再议。

## 范围外（沿账不扩展）

- 不重开评测矩阵 / 不动 r88 formally-declined / 不追写已冻结 claims / 不做发布-tag / 活体谓词仍只走 deferred / docs/adr 不入状态标记靶位 / 不裸删远端指针 / no-pr·unpublished 仍 deferred。

## Suggested skills

- `gitbutler`（全部 VC；push/land 须 owner 授权）
- `tdd`（探针/fixture 先行，正反成对）
- `code-review`（扩域复审）
- `handoff`（R100 任务书生成）
