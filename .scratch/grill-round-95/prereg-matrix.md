# R95 预注册判读矩阵 — anysearch/vertical-delta@1（matrix@3，commit 先于任何跑数）

- 登记时刻：T2（先于 T4 探针与 T5 全量跑数；SAP-先于-database-lock 时序）。时序自证：本 commit 的 parent 已含 T1 语料 diff（`git log --oneline` 可核：T0 goal → T1 语料 → 本件）。
- 权威源：decision-ledger.md D-001~D-005（全 current）；本件为机器执行视图。
- 唯一判读器：`.scratch/grill-round-85/readout-delta.mjs`（matrix@3 执行体：仅 EXPECTED_FP 滚动至新指纹 + 版本戳进位；G0–G4 闸序/flat-prior β 后验/效应量四字段/早停/单次终读逐字与 matrix@2 相同，机械面零改）。
- 输入指纹：`datasetFingerprint = 8da3e482b98f8cba`（sha256 over 排序后 `{id, v:e.vertical, x:e.expected.vertical, s:scope}` 取 hex16；eval-looks.json `live|both` 且 `expected.vertical≠undefined` 的 56 条切片）。

## 0. 语料分层定义（冻结事实，指纹钉死）

| 层 | 选择子 | n | 构成 |
|---|---|---|---|
| 处理层（subjects） | `expected.vertical.role === "subject"` | 40 | finance 10（param 5+sem 5）、academic/code/health 各 10（param 5+sem 5） |
| 对照层（controls） | `role === "control"` | 16 | 每域 4：3 携 spec + 1 无 spec（`ctrl-{f,a,c,h}10x`） |

- `paired`/`measured`/`unknown`/`structural missing` 定义逐字沿用 matrix@2（R85 prereg §0）。
- **vert-f1105 已于 T1 原位降格**：无 scope（移出可测集）、无 `expected.vertical`、无注入 spec；`tombstone` 载荷含 prior_scope/prior_spec/prior_expected_vertical。本轮读数不再覆盖该格（见 §7 可比性边界）。

## 1. 判定管线（固定顺序，先过的闸截断后序）

```
G0 输入完整闸 → G1 对照层装置闸 → G1b 处理层 provider 失败闸 → G2 覆盖闸 → G3 负向硬闸(2-of-4) → G4 方向轴
```

- **G0 输入完整**：`schema==="anysearch/vertical-delta@1"` 且 `datasetFingerprint===8da3e482b98f8cba`；失败→整轮 INCONCLUSIVE（原因=input-integrity），不进入任何判读。
- **G1 对照层装置闸（独立必要合取）**：`unmeasured > 8/16` 或 `nonTied ≥ 4/16` → 装置旗标 → INCONCLUSIVE（原因=instrument-flag）。诊断顺序沿用：unknown 缺失模式 → 方向一致性 → 对称噪音。
- **G1b 处理层 provider 失败闸（谓词锚，先于读数登记；禁临场拟，HARKing 窗口）**：iso 腿 `providersFailed` 含被测臂 → 该侧 unmeasured、格 `paired=false`/`verdict=unknown`（记 instrumentDown）；subject 层 `instrumentDown/n > 30%` → **INCONCLUSIVE（exit=instrument-flag）**。当前语料 n=40，判定阈 = floor(40×0.3) = 12 格。
- **G2 覆盖闸（处理层）**：`nPaired/40 ≥ 70%`（≥28）且 `unknown/40 ≤ 30%`（≤12）；不达标→INCONCLUSIVE（原因=coverage）。
- **G3 负向硬闸**：封闭域表 {finance, academic, code, health}；域 `worse−better ≥ 3` 记反向域；反向域 ≥2 → NO-GO。
- **G4 方向轴（处理层合并池）**：`b=Σbetter, w=Σworse`；flat 先验后验 `B~Beta(1+b), W~Beta(1+w)`，`P=P(B>W)`；池化 `armHostHit` 差=paired 行 on−off 均值。`P ≥ 0.8` 且池化 > 0 → GO；`P ≤ 0.5` 或池化 ≤ 0 → NO-GO；其余 → INCONCLUSIVE(direction-indeterminate)（附具名触发+量化锚，见 §6）。

## 2. 效应量四字段与副列

1. 净胜率=`(better−worse)/nPaired`；2. `P(better>worse)`；3. EL=`E[max(W−B,0)]`；4. rankDiff 中位=`rankOff−rankOn` 中位数（无可用值记 null）。
副列（只报告无否决权）：per-domain / per-stratum / truncation 注记 / `controlDegraded` / `armInFanoutSurvival`。

## 3. 读数法律角色（R95 立法条款，先于读数存在）

- **读数=复活条件③④的输入证据，非方向裁定**：本轮读数唯一法律角色是向 registry `r88-candidate-vertical-direction-redeliberation` 的复活条件③（cn_code 契约补齐，verifier=next matrix revision）与④（新评测矩阵修订版读数，verifier=readout-delta.mjs matrix revision）供证；**对 prefer-capable 加权轴无任何裁决权**。
- **即使 Δ 转正也不自动复活**：重议仍走 owner `anysearch-eval` 未来轮次（立案程序）；本轮不单边宣称方向复活。
- **探针/终读二分**：T4 容量探针为容量测量（TPM 形态与配额余量），非判读输入、不入 G 系闸、不产生终读档语义（T6 判读输入仅 T5 终读档一次）。

## 4. 早停规则与执行前置

- 调度序同 matrix@2：对照层 16 格先行全跑 → runner 内联装置旗标判定（仅停手机制，权威判定在 readout）→ 旗标即早停（处理层不跑，artifact 仅含对照层 rows + `instrumentFlag:true`）→ 否则处理层 `vdomain×stratum` 轮询交错；CONCURRENCY=4 维持。
- runner 崩溃/artifact 未产出=执行失败（允许修复重跑，未产出即未读数）；**artifact 一旦落盘即本轮唯一读件**。
- 执行前置（runner 内联断言）：`pnpm -C apps/cli build` 使 `.build-stamp.json` 的 commit==HEAD 且 dist 不旧于 src（stale dist 直接 assert 失败）。

## 5. 单次终读生效条款

- 本矩阵仅对**一次** readout 执行生效；二次读取/peek/中途读数改判 → 矩阵作废，本轮记 INCONCLUSIVE（protocol-breach）并如实呈报。
- canonical 路径 `.scratch/vertical-eval/delta.json`；T4 探针件走独立路径（受限切片指纹结构性不等），天然不可被误读。
- R86 期 canonical 旧档在 T5 覆写前按字节留档（复制 + sha256 记录入轮报），不作 R95 判读输入。

## 6. INCONCLUSIVE 具名触发模板（量化锚必填）

- 形如 `defer-r95-delta-<cause>-retry`：触发条件须带量化锚，例「配额恢复后同窗全量重跑，可分辨 |ΔarmHostHit|≳0.4，目标 nPaired≥28/40」。裸 INCONCLUSIVE 禁止。

## 7. 可比性边界声明（先于读数存在）

- 语料 57→56（vert-f1105 移出可测集）→ **分母类字段（n/nPaired/覆盖率/域内计数）不可与 R85/R86 直接比**；方向类四字段在「剔除同一格」口径下可作同向参照，非等价复现。
- R86 判读结论（NO-GO + F-3 判据勘误）不溯改；本轮读数并置呈报时须标注口径差异。

## 8. 功效注记

- n=40 下只可分辨 |ΔarmHostHit|≳0.4（Airbnb Power Guardrail 精神写入记录）；小于此的效应即使存在也不可判。

## 9. 出档映射

- GO → **不复活加权轴**；registry r88-candidate 仅追加 carried_log（条件④ verifier 工件快照路径）；ADR-0096 记读数角色条款兑现。
- NO-GO / INCONCLUSIVE → registry 同名 carried_log 追加 + 具名触发量化锚；ADR-0096 记过程与读数。
- 三记账（T7）：`defer-r86-anysearch-corpus-param-contract`→closed；上游「文档词表 vs validator」不一致立独立新 finding（含可机检验证信号）；r88-candidate status=formally-declined 不动。

## 10. 修订登记（matrix@3 — R95 T2/T3，先于读数）

- **触发**：D-002 语料修订（f1105 原位降格）→ 输入指纹滚动；matrix@2（R86 T4 G1b 修订体）机械面存续。
- **修订内容**：`EXPECTED_FP 7ac0a48e55cd7954 → 8da3e482b98f8cba`；版本戳 matrix@2 → matrix@3（readout 输出的 matrix 字段指向本件）。闸序/常量/后验积分/四字段/早停/单次终读逐字不变（git diff 可证：非注释改动仅 EXPECTED_FP 与 matrix 字符串两处）。
- **生效范围**：自 T5 起的判读执行；R85/R86 锁定读数（各自 readout-output.json）不溯改。
