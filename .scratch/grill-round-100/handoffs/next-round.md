<!-- state: unlanded r100-grill-ledger @ 2026-10-08 -->

# Handoff — Grill Round 100 → R100 实现轮任务书（正题=ADR-0101 元验证封顶 / T0 绿门清偿 critical-path）

- 日期：2026-10-08 | slug：`grill-round-100`
- **唯一事实源**：`.scratch/grill-round-100/decision-ledger.md`（D-001~D-005 全 current）——实现唯一依据=本账本，不从对话回忆补结论。
- 前序交接：`.scratch/grill-round-99/handoffs/`（next-round.md / round-99-closeout.md【含六死 SHA，T0 修复靶位】/ round-99-audit-handoff.md）
- 锐评源件：`.codex-tmp/锐评.md`（第十轮，辩证已吸收：绿门先行+元验证封顶+产品票触发器）

## §0 执行纪律（沿账+本轮新增）

- 全部 VC 走 GitButler（`but`）；**push/land 须 owner 授权窗**——T0 开工即具名申请。
- 判定核纯净 / 薄壳不写判定 / 正反成对 fixture / fail-closed / 断言数只升不降（463/394 基数）。
- 立法先于实现 commit；立法文本可在 T0 授权等待期并行起草，commit/land 不得早于绿门修复。
- **红基禁落账**：T0 未 land 复绿前，任何后续 commit 不落地（stop-the-line）。
- 每票收口前自对账覆盖 D 条；账本偏离须具名申报不静默。

## T0 — 定锚 + 绿门清偿（critical-path 死锁）【覆盖 D-001④/D-002①②④⑤/D-005①⑥】

1. `.scratch/grill-round-100/goal.md`——全做形态名义+范围外+风险登记（滤尺首演自审/tau 排除首演/坐席迁移窗口/land 授权挂点）。
2. **绿门修复独立栈 `r100-green-repair`**：R99 closeout Stack 行六死 SHA（e9b888d4/16205b9d/9ffdfc47/759fe259/1d759e81/e5d40d8d）改述 `Stack（dissolved @ <改述日>）`——逐条对应原条目、capture 值留散文史料、closeout-coverage 双向一致。
3. 序列：owner 授权→push→CI 观测→land→`but pull`→同会话重锚 commit→`node scripts/ship-gate.mjs` 复跑绿→**此后才开 T1**。
4. 禁项：不用 time-lagged-capture 词表项、不用 but-id 主键放宽（滤尺首演判例已处死）；绿门修复独立成栈但不独立成立法票。

## T1 — 立法包 ADR-0101 + CONTEXT 词条【覆盖 D-001②③⑤⑥⑦⑧⑨/D-003 全条/D-004①~⑦】

1. `docs/adr/0101-*.md`，粒度=「能否被独立 supersede」：
   - **Context**：R100 轮次构成（全做形态记账——原 D1 降格）。
   - **Decision（约五件）**：D2 封顶滤尺三交集（kill-oracle fails 字段+sunset+fraud-vs-style tier 保留）；D3 修层/新层判据（「删掉它哪个既有检查在哪条产品故障漏报」）；D5 坐席 Addendum（修层：结构化 {anchor,reason,seated_at,review_by}+masking info+到期 RED+双读迁移）；D6 tau 递归+AST 前门（三分类+RED 拆双支+窄违规集）；D7 负向边界+deferred 触发器修订（approval-channel T+1 激活条件「连续 N 轮 ship-gate 全绿∧正题关闭」+滞留≤2 轮升候选正题）。
   - **Consequences**：`stack-orphaned-by-land` 滤尺首演判例（equivalent-mutant 处死 time-lagged-capture/but-id 放宽）+T0 修复引用+sunset N 值留空（首适用时裁）。
2. CONTEXT「Grill Round 100 — Terms」候选 ~7：Meta-Cap Filter / Kill Oracle（fails）/ Audit Tier（info 档）/ Sunset Ledger（锚活性一行账）/ Stack-Orphaned-by-Land / Seat Deadline（坐席限期）/ Masking-Surfaced。

## T2 — 正题实现：3 PR 切片（expand-contract 对位）【覆盖 D-002③/D-003①~⑥/D-004①~⑥/D-005③】

- **PR-A schema 迁移**（expand+migrate）：anchors.json `fails` 条件必填+**存量 5 锚回填**（滤尺回审首演——指不出故障即发现）+`tier:red|info`（默认 red）+`pending_anchors∩tier:info=RED` 互斥+坐席结构化+**双读窗口**（旧串 `seated_at:null`→迁移日设限无豁免）+runner/探针消费方。
- **PR-B 检测层**（可拆 B1/B2）：`stack-orphaned-by-land` 谓词+成对 fixture+RED 码 vocab-registry 扩表 ∥ tau 递归 `scripts/**/*.mjs`+AST 前门（{可验证声明∧副作用}→RED；{存在性不可机验}→独立具名 RED；{副作用∧无codes}→具名排除+info）+`tau-scan.mjs` 排除通道首演（spawn launcher 双命中）。
- **PR-C 义务步**（contract，land 后置）：§5 审计签字绑点扩 post-land main tip 重验+sunset 一行账机位（closeout claims 段）+`handoff-reanchor` 一键脚本（改述+记 land SHA+落签字）+**T3 簿记并入**。
- 约束：AST 纯静态禁运行模块、typescript API 不引新依赖、masking info 须具名、fixture kill 不计活性、检测瓣谓词过自家滤尺。

## T3 — 簿记（并入 PR-C）【覆盖 D-005④】

- CHANGELOG r100 节（feat/fix/docs 分行）+deferred-registry defer-r72 触发器修订注记（不激活不新挂账）+ADR index 再生成（101 件）+AGENTS.md 指向式摘要（不复述 ADR-0101 条文）。

## T4 — 收口【覆盖 D-001/D-005⑤⑥】

- 轮报 `reports/2026-10-XX-report.md`+verbatim claims/closeout+R100→R101 next-round.md+三态+clearing 核验。
- **锚活性一行账首行**（sunset 机位首演）：`锚活性 @ R100: anchor:<id> prod-findings=N last-real-RED=Rxx | …`（5 锚逐枚，只计生产 finding）。
- **closeout Stack 行=活链三元素**+`PENDING: stack-unpushed`（禁预写 dissolved——未来日期即 RED）；land 后同会话重锚 commit=义务瓣立法痕迹首演；若 T4 时 land 已完成则写 dissolved（判据=写行时刻事实）。

## 范围外（沿账不扩展）

- 不重开评测矩阵 / 不动 formally-declined / 不追写冻结 claims / 不发布不打 tag / 活体谓词仍走 deferred / 不裸删远端指针 / no-pr·unpublished 语义不动 / approval-channel 本轮仍 deferred（仅触发器注记）/ 激活它须独立票+混合轮具名申报+R99 否决覆写入账。
- 锐评处方四（owner OTP/弃用文案双空格）属 user 侧动作，备忘不代决。

## Suggested skills

- `gitbutler`（全部 VC；land/push 须 owner 授权窗）
- `tdd`（谓词/fixture 先行，正反成对）
- `code-review`（schema 迁移与消费方同 PR 复审；AST 判定域误报复审）
- `domain-modeling`（ADR-0101 条文与 CONTEXT 词条落笔）
- `handoff`（R101 任务书生成）

## 工件索引

- 账本：`.scratch/grill-round-100/decision-ledger.md`（D-001~D-005）
- 修复靶位：`.scratch/grill-round-99/handoffs/round-99-closeout.md` Stack 行（六死 SHA）
- 判定源码：`scripts/handoff-lint-verdict.mjs`（dissolved :584-633/sha-not-commit :663-666/STACK_RED_CODES :87-90）
- 注册表：`docs/enforcement-anchors.json`（5 锚待回填 fails）/`docs/deferred-registry.json`（pending_anchors :1202/defer-r72）
- 扫描面：`scripts/vocab-scan.mjs`（glob 顶层→递归）/`scripts/vocab-registry.mjs`
- 排除首演：`scripts/tau/tau-scan.mjs`（spawn launcher 实案）
