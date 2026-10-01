# ADR-0096: Grill Round 95 — 评测矩阵修订轮（corpus unfreezing + G1b 判读音义固化 + tombstone 墓碑机制 + matrix@3 单次终读 INCONCLUSIVE-instrument）

R95 为评测矩阵修订轮：执行 registry `defer-r86-anysearch-corpus-param-contract` 自带 `review_cadence="next matrix revision"` 的核销路径——vert-f1105 原位降格（墓碑理由码受控）+ 判读器指纹/版本戳滚动 + delta 腿重跑产修订版读数（复活条件③④的输入证据，非方向裁定）。 Prefer-capable 加权轴维持 formally-declined，本轮不单边宣称方向复活。

## Status

Accepted (grill round r95; 执行票序 T1→T8 per `.scratch/grill-round-95/handoffs/next-round.md`). Ledger: `.scratch/grill-round-95/decision-ledger.md` (D-001~D-005, all `current`). Prereg: `.scratch/grill-round-95/prereg-matrix.md` (matrix@3, committed at T2 before any run). Evidence root: `.scratch/grill-round-95/evidence/`.

## Context

registry `defer-r86-anysearch-corpus-param-contract` 自 R86 起 open：语料格 vert-f1105 欠上游 tag 必填 `cn_code`（`finance.fundamental`），两轮确定性复跑 isError；语料指纹 `7ac0a48e55cd7954` 冻结期内不可修。R95 Q2 取证（atomcode 深调 + 具名活查）收敛：validator 按 tag 级索要 `cn_code`，与词表文档 per-type 规则（`cn_code` 只对 A 股类型必填）不一致——属运行期校验层漂移，文档未漂移（同日 `get_sub_domains` 与 2026-09-26 存档逐字一致）。

## Decision

### D1 — 语料修订形态：原位降格 + 墓碑理由码受控词表

vert-f1105 原位降格为 `unmeasured-by-design`（同 id、同数组位；语料 diff 仅此一格）：移出可测集（`golden.scopes` 除名，live 切片 57→56）。降格是显式声明非静默移除：`tombstone` 块载 `reason_code` + `prior_scope/prior_spec/prior_expected_vertical` 载荷留档。

墓碑理由码为受控词表值（本次唯一值 `upstream-validator-vs-doc-mismatch`），常量源 `TOMBSTONE_REASON_CODES`（`packages/store/src/eval/docs-golden.ts`）+ `validateDocsGoldenEntry` 交叉规则（墓碑行不得携 `expected.vertical`/注入 spec）+ kernel 作用域豁免断言 + store 测试负例（自由文本理由码被 validator 拒绝）四层机检。词表扩展是语料治理行为（ADR+registry），非内联编辑。

否决的替代形态：B（同 id 换芯）违数据集版本治理共识（格语义实质变更须新 id+旧格 deprecate）；D（全语料契约体检）违 ADR-0029（登记为 backlog 候选，独立轮次）；新增 scope 枚举值违既有封闭词表断言（kernel D-006 面）且语义偷换。

### D2 — 判读器修订幅度：仅指纹与版本戳

`readout-delta.mjs` 升 matrix@3 执行体：`EXPECTED_FP 7ac0a48e55cd7954→8da3e482b98f8cba` + `out.matrix=grill-round-95/prereg-matrix@3`。G0–G4 闸序（含 G1b）、flat-prior β 后验（固定 8192 网格）、效应量四字段、早停、单次终读逐字不变。selftest 一处 index 驱动 fixture 随 n=41→40 重调（`indeterminate` 判例 P=0.658 落回 indeterminate 带；意图保持，闸序/常量零改）+ 7/7 全绿。

### D3 — 读数法律角色：复活条件③④的输入证据，非方向裁定

本轮读数唯一法律角色是向 `r88-candidate-vertical-direction-redeliberation` 的条件③（cn_code 契约补齐）与④（新矩阵读数）供证；对加权轴无裁决权。即使 Δ 转正，重议仍走 owner `anysearch-eval` 未来轮次立案。探针/终读二分：T4 容量探针是容量测量（TPM 形态与配额余量），非判读输入。

### D4 — 执行环境裁量：匿名层 + 配额边界兑现 G1b 分支

匿名层逐次覆写（子进程 env 透传；执行级修正：board 速记值需补完整 MCP 路径 `/mcp`，见 T4 读数档）。T4 探针 16 调用零 nudge → 同窗全量；终读档中段起系统性 `permanent-auth`（122 腿）→ 触发 T5 预注册「中段 nudge→不硬跑」分支：T6 单次终读落 **INCONCLUSIVE/instrument-flag**（G1b：主体层 instrumentDown 30/40 > 30%；探针读数作量化锚）。不跨日分桶合并、不缩范围终读（G2 制度性自败）。B 升级路径（用户侧）：复活私有端点或供有效 key → 兑现后声明式环境一次干净全量跑（判据同 R86 T5）。

### D5 — 台账落账三记账

① `defer-r86-anysearch-corpus-param-contract`→closed（字段集照 r87-f3 先例：status/closed_by=ADR-0096/closed_by_adr_path/closed_at/evidence 追加兑现记录；carried_log append-only）。② 上游「文档词表 vs validator」不一致独立立 finding（`finding-r95-upstream-validator-vs-doc-vocab-mismatch`，禁并入旧条 reopen；evidence 带可机检验证信号 `evidence/verify-validator-vs-doc.ts`，离线断言文档侧 + `--live` 复放断言）。③ `r88-candidate-vertical-direction-redeliberation` 仅追加 carried_log（四字段集 id/owner/trigger_rule/at + 条件③④ verifier 工件快照路径），**status=formally-declined 不动**，解释权属 owner 未来轮次。backlog 登记不入本轮 diff：fundamental×cn_code 新格立案、全语料契约一致性体检（独立轮次候选）。

### D6 — 收口件形态：ADR-0096 + CONTEXT 词条区 + 轮报 + 交接

CONTEXT.md 追加 `## Grill Round 95 — Terms (ADR-0096)` 词条区（账本派生七词条，见 Execution Record §5）。T7/T8 同轮闭环：registry closed_by 指向本文件实物；两 commit 同轮完成。

## Known-Risks（轮前预写三项，均先于读数存在）

1. **与 R85/R86 可比性边界**：语料 57→56 致分母类字段（n/nPaired/覆盖率/域内计数）不可直接比；方向类四字段仅在「剔除同一格」口径下可作同向参照（prereg §7）。
2. **墓碑理由码受控词表**：`TOMBSTONE_REASON_CODES` 常量唯一源 + 四层机检；词表扩展须 ADR+registry（T1 报告回报，禁内联增词）。
3. **G1b→INCONCLUSIVE-instrument 谓词锚已写进 T2**（prereg §1 谓词锚，禁临场拟；HARKing 窗口封口）：本轮读数恰兑现该分支（instrumentDown 30/40），非事后解释。

## Execution Record & Outcome Completion

### 1. 终读判词

- **判读结论**：`INCONCLUSIVE` / `instrument-flag`（matrix@3 单次终读；二次读取/peek 作废）。
- 闸迹：G0 过（指纹吻合）→ G1 过（对照层 unmeasured 4/16 ≤ 8，nonTied 0；未测 4 格=设计内 bogus 对照拒收）→ **G1b 截断**（instrumentDown 30/40，maxDown=12）。
- 报告级四字段（10 paired 副列证据，非判读输入）：netWinRate=0.1，P(better>worse)=0.7164，EL=0.0451，rankDiff 中位=0。覆盖：nPaired 10/40，unknown 30/40（配额边界所致，非方向证据）。

### 2. 票序与 commit 双锚表（待 T7/T8 落笔补全 but-id 与 sha）

| 票 | but-id | 类型 | 产物 |
|---|---|---|---|
| T0 目标 | `trx` | docs | `goal.md` |
| T1 语料修订 | `pnw` | feat | 语料墓碑 + `TOMBSTONE_REASON_CODES` + validator/test 机检；store/kernel 全量绿 |
| T2 预注册 | `rsk` | docs | `prereg-matrix.md`（parent 含 T1 diff） |
| T3 判读器 | `lyz` | fix | matrix@3 执行体 + selftest 7/7 |
| T4 探针 | `xut` | evidence | attempt1/attempt2 工件 + 读数档 |
| T5 终读档 | `znn` | evidence | canonical 档 + 腿级归因档 |
| T6 单次终读 | `oql` | readout | `readout-output.json`（INCONCLUSIVE/instrument-flag） |
| T7 台账 | （补） | docs | registry：contract→closed + 新 finding + r88 carried_log |
| T8 收口 | （补） | docs | 本 ADR + index + CONTEXT 词条 + CHANGELOG r95 段 + 轮报 + 交接 |

### 3. 复活条件③④供证装箱（owner 未来轮次开箱）

- 条件③（cn_code 契约补齐）：`eval-looks.json` vert-f1105 tombstone（prior_scope=live，墓碑理由码受控）+ `defer-r86-anysearch-corpus-param-contract`→closed（本轮）。
- 条件④（新矩阵读数）：`evidence/vertical-delta-r95-terminal.json`（sha256 `28f509fb345923633de0fd67e20f60978a95828491648295305f746570eada0b`）+ `readout-output.json`（out.matrix=`grill-round-95/prereg-matrix@3`，INCONCLUSIVE/instrument-flag）。

### 4. Backlog 候选（登记，不入本轮 diff）

- fundamental×cn_code 新格立案（同 id 换芯禁令→须新 id；下一语料轮）。
- 全语料契约一致性体检（独立轮次，ADR-0029）。

### 5. CONTEXT.md 追加词条区（草稿，T8 落笔）

Tombstone Reason Code / Evidence-Role Annotation / Matrix Version Stamp / Probe-vs-Terminal Tiering / Protocol Amendment Ordering / Finding-vs-Disposition Separation / Machine-Checkable Verification Signal（与 carried_log/Single-Terminal Read/instrument-flag/Exploratory Region/Snapshot-vs-Live/Resurrection-Condition Controllability 对齐，禁重复）。

## Consequences

- 语料可测集 57→56 为冻结事实：任何 lane 不得再选 vert-f1105（无 scope）；未来 lane 须跳过 tombstone 行。
- 受控词表单一源头确立后，同类降格沿用，不得另立平行载体。
- 读数角色条款成为未来轮次的引用锚（方向裁定权在 owner，不在读数）。
