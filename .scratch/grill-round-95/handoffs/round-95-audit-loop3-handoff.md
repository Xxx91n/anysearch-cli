# Handoff — Grill Round 95 审计 LOOP3 → R96（PASS，本件为最新权威交接）

> **本件取代** `.scratch/grill-round-95/handoffs/round-95-audit-loop2-handoff.md`（该件写于 push 之前，仍载「残留 F5R / stack unpushed」，已失效）。
> 本件与 LOOP2 交接同时取代 `round-95-audit-handoff.md`（LOOP1）。历史件一律不改写——改之即伪造审计轨迹。

Stack（primary key = GitButler change-ids；SHA 为 capture 时值，time-lagged，以 `but log` 为准）：
  **交付栈** `r95-exec` → `trx` … `wzw` → `qyv` … `ulo` → `xtv`（F5R+N1 修复）→ `ttz`（push 后失效声明订正）—— 已 push，tip 以 `git rev-parse origin/r95-exec` 为准
  **审计栈** `r95-audit`（LOOP1，`kqq`）· `r95-audit-loop2`（LOOP2 `lus` + LOOP3 `ktq`）—— 已 push
  本件所在分支：`r95-audit-loop2`，tip 以 `git rev-parse origin/r95-audit-loop2` 为准（自引用，故不写死值）

## 绿色 run URL（必填）

**本分支无 CI run —— 本仓 CI 拓扑不产出特性分支 run。** `.github/workflows/` 的 `ci.yml` / `ship-gate.yml` / `native-smoke.yml` 触发条件均为 `push: branches: [main]` 或 `pull_request` 或 `workflow_dispatch`（实测）。故 `r95-exec` / `r95-audit-loop2` 均无 run（`gh run list --branch r95-exec` → 空）。要取得 run 须 land 到 `main` 或开 PR。

门禁证据为**本机实测**（非 CI），LOOP3 独立复跑：`node scripts/ship-gate.mjs` → **exit 0 零 fail 腿**（`closeout-claims r95: 9/9 re-derived green`、`handoff-lint` pass、`closeout-coverage: 20/20`、`canonical-json` 绿、`gen-adr-index: 96 ADRs at HEAD`、`path-lint` 零 fail、`clean-tree` 空）；selftest 7/7；assert-corpus fp `8da3e482b98f8cba`。

> 机械锚（非本分支 run；`handoff-lint` 腿所需）：共同基底 `3642d494`（= `main` HEAD）三条绿 run 实测存在——ci https://github.com/Xxx91n/anysearch-cli/actions/runs/36741517719 success、ship-gate https://github.com/Xxx91n/anysearch-cli/actions/runs/36741517755 success、native-smoke https://github.com/Xxx91n/anysearch-cli/actions/runs/36741517873 success。**其性质为基底线而非本轮 run**——`handoff-lint` 仍判绿即 F8 盲区，见 §3。

## 0. 一句话

R95 三轮审计闭环：LOOP1 CONDITIONAL FAIL（5 阻断）→ 返工 → LOOP2 CONDITIONAL PASS（残留 1）→ 修复 + push → **LOOP3 PASS**。工程实质与全部回归锁自始为绿；三次发现的失效面全在**声明准确性与证据可核性**，已逐条补齐。

## 1. 本轮（LOOP3）做了什么

| ID | 修法 |
|---|---|
| F5R | Stack 行补 `qyv`/`lxn`/`umt`/`ulo` 四段 but-id + capture date，末位自引用收尾 commit `xtv`。16 个引用 SHA 逐个 `git cat-file -t` = `commit` 零悬空 |
| N1 | 交接档 §3 序号 `1./2./2./3.` → `1./2./3./4.` |
| F5R-b/c | **push 动作本身**制造的失效声明（「未 push / 未外发 / stack unpushed」）改述为真实 CI 拓扑；机械锚由 R94 期祖先线 run 换成当前 `main`@`3642d494` 三条绿 run |

自引用处理两处，均为遵守模板而非遗漏：收尾 commit 只写 but-id 不写 SHA（写入即因 amend 失准）；push sha 改为指向 `git rev-parse origin/r95-exec` 而不断言相等（下一 commit 即令其失准）。

## 2. 未了事项（留 owner，非本窗可决）

- **分支 `r95-rework` 处置待决**：唯一「已合并」候选（`is-ancestor` = YES，`rev-list r95-rework --not r95-exec` = 0），但**现行 gitbutler 工具面下删不掉**——`but uncommit` 报 merge conflicts 拒绝；`but move --unstack` 在 `r95-exec` 的 5 个 commit 上留 conflict，已 `but undo` 回退并核验（工作树空 / 无 conflict marker / commit 完好）。**风险为零**（0 独有 commit）。三选一：
  - **(a)** 就留置（当前状态，无害，推荐）
  - **(b)** `r95-exec` land `main` **之后**跑 `but pull`，让 gitbutler 自行回收
  - **(c)** 授权裸 `git push origin --delete r95-rework` 仅删远端指针（`but` 无远端分支删除命令）
- **claims 内容级抽查未做**：9 条 claim 仅验证「能复推绿」，未逐条比对断言内容与工件是否相符。新制度首轮，建议 R96 或专项轮抽查。
- `main` 未 land（未开 PR，未获授权；开 PR 会触发 `pull_request` CI 与 OF look 消耗）。

## 3. R96 方向指示（下一 grill 正题）

**主推且唯一推荐：门禁假绿收口（F8）。** 三轮审计已把它从「一处判断」升级为**三类可机械复现的实证**，面窄、修法明确、修完可自证：

1. **模板与门禁直接冲突**（返工 run B 实测 exit 1 坐实）：`handoff-template.md:31` 说未推送就写 PENDING；`ship-gate.mjs:1208` 对 run URL 无 PENDING 豁免（ids 为空即判红）。诚实写法必红。
2. **liveness 腿静默降级**（LOOP2 实测）：gh 在 PATH 上但门禁输出 `liveness leg skipped: gh/repo unavailable`，`checkedLiveness=false`（`ship-gate.mjs:1188/1200/1224`）⇒ run URL **未活体核验**，「祖先线/基底线 run 被当本轮 run」在离线环境必然放过（LOOP2/LOOP3 各一次）。
3. **CI 拓扑使问题无解**（LOOP3 新增）：特性分支 push 不产出任何 run ⇒ 「绿色 run URL」这一交接必备字段对未落地分支**在物理上无法诚实满足**。这已不是执行者的选择问题，是拓扑与门禁的错配。

建议修法（三条均可离线机械判定）：
- 让 **PENDING 成为机械可接受出口**，消除模板/门禁冲突；
- **Stack 行强制 but-id 存在性**（本轮 F5R 即此类，本可被门禁拦下）；
- run-URL 腿接受「**已 push 且 CI 拓扑不产出分支 run**」为合法出口，判据读 `.github/workflows/` 触发条件是否含分支 push（不依赖 gh 活性）。

**备选（需用户侧先兑现，非 agent 可代办）**：B 路径检查（私有端点 `127.0.0.1:20128` 或有效 key → 干净全量跑）；`finding-r95-upstream-validator-vs-doc-vocab-mismatch` 的 `--live` 重跑（配额恢复后）；`fundamental×cn_code` 新格与全语料契约体检独立立案。

> **不建议** R96 重开评测矩阵：R95 读数是 input evidence 非方向裁定（ADR-0096 D3），方向裁定权归 owner `anysearch-eval`，agent 不得代裁。

## 4. 交接件索引（全部仓内相对路径）

- 本窗（最新）：`.scratch/grill-round-95/handoffs/round-95-audit-loop3-handoff.md`（本件）
- LOOP3 报告：`.scratch/grill-round-95/reports/2026-10-01-audit-loop3-report.md`
- LOOP2：`reports/2026-10-01-audit-loop2-report.md` · `handoffs/round-95-audit-loop2-handoff.md`（已失效，被本件取代）
- LOOP1：`reports/2026-10-01-audit-report.md` · `handoffs/round-95-audit-handoff.md`（已失效）
- R95 交付：`reports/2026-10-01-report.md`（含 §9 返工批次）· `handoffs/round-95-closeout.md`（含 §3 R96 待办）
- 立法：`docs/adr/0096-architecture-grill-round-95-eval-matrix-revision-closeout.md` §Addendum-A（F1~F8 裁定）· 台账 `.scratch/grill-round-95/decision-ledger.md`（D-001~D-005）· 预注册 `prereg-matrix.md`（SAP 冻结）

## 5. 坑位（接手先读）

- `pnpm check`/`pnpm build` 默认命中 turbo 缓存（`FULL TURBO`）⇒ **验收必须加 `--force`**，否则假绿。
- `readout-output.json` 是 matrix@3 单次终读原件：**禁止二次 readout/peek**（矩阵作废）。指纹 `8da3e482b98f8cba` 已实证绑定 `eval-looks.json`（regen 字节同一）——**任何改动该文件字节的动作都会使 matrix@3 作废**。
- `closeout-claims.json` 已冻结（登记 commit `a24684de` 后未再改动）⇒ **不得追写 claims**；门禁为只读复证。
- `verify-validator-vs-doc.ts` **必须** `cd packages/store` 再跑（仓根跑报 `ERR_MODULE_NOT_FOUND: tsx`）。
- `readout-delta.mjs` 物理位置在 `grill-round-85/`（非 r95），改它等于改前轮工件，须在 ADR-0096 补注。
- `ANYSEARCH_ENDPOINT` 须给完整 MCP 路径（`https://api.anysearch.com/mcp`）；裸 origin 致 `initialize 404`。本机 env 残留死回环 `127.0.0.1:20128` —— 用户侧事项，agent 不改、不持凭证。
- push 后任何「未 push / 未外发」表述**立即失效**——三轮审计中这类自造失效声明出现过两次（F1、F5R-b/c），改文档前先扫全量声明。

## 6. Suggested skills

- `$but` — 全部版本控制写操作；R96 新开分支（勿复用 `r95-exec`），与现有 5 个栈并行；禁裸 git 写。
- `$code-review` — R96 改 `scripts/ship-gate.mjs`（F8 门禁收口）后按 Standards/Spec 双轴评审；治理工具改动务必双轴。
- `$diagnosing-bugs` — F8 修法若致 `handoff-lint` 行为漂移（例如新出口误放行），按诊断循环走而非直接改断言。
- `$domain-modeling` — 若 R96 为「已 push 无 branch run」这一新状态立 CONTEXT 词条。
- `$neat-freak` — R96 轮末收尾（claims 内容级抽查、`r95-rework` 处置落地、文档与代码对齐）。
- `$handoff` — R96 收口交接（引用已有工件路径，不复述）。

## 7. 自检

- [x] 完整仓内路径已给出（§4 索引 + 全文引用）
- [x] 引用已有工件而非复述内容
- [x] 脱敏：无 key / 凭证 / PII（端点仅记源类不记值）
- [x] Stack 行含 but-id + capture date 且**对自身 tip 不作失准断言**
- [x] 绿色 run URL 字段非空，诚实标注「本分支无 run」及其物理成因
- [x] 下一 grill 方向已指示（§3，含三类实证与三条可机械判定修法）
- [x] 明示取代关系，避免接手者读到失效的 LOOP1/LOOP2 交接