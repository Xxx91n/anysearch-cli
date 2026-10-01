# Handoff — Grill Round 95 审计 LOOP2 → 收尾窗（CONDITIONAL PASS，残留 1 项）

Stack（primary key = GitButler change-ids；SHA 为 capture 时值，time-lagged）：
  `r95-exec` → `qyv` (`a24684de` @ 2026-10-01) → `lxn` (`199f3e72` @ 2026-10-01) → `umt` (`1b7bc809` @ 2026-10-01) → `ulo` (`9cac80c1` @ 2026-10-01) —— 返工 4 commit，即 `r95-exec` tip，未 land、未 push
  被复核的原 13 commit 栈（`trx`…`wzw`，末项 `7a540900`）已全部包含于 `r95-exec`，其 Stack 行见 `.scratch/grill-round-95/handoffs/round-95-closeout.md` 第 3-4 行
  审计件自身：分支 `r95-audit-loop2`，LOOP2 报告 + 本件（but-id 见 `but log r95-audit-loop2`；本件自引用故不写入自身 but-id，避免 amend 后失稳）

## 绿色 run URL（必填）

**PENDING — stack unpushed。** R95 全部提交（含返工 4 commit）未外发（无 push / tag / publish，纪律内），故无本轮 CI run 可引。
门禁证据为**本机实测**，非 CI：`node scripts/ship-gate.mjs` → **exit 0 零 fail 腿**（LOOP2 审计窗独立复跑；含 `closeout-claims r95: 9/9 registered claims re-derived green`、`handoff-lint` pass、`closeout-coverage: 20/20`、`canonical-json` 绿、`path-lint: 598 registered doc(s) clean`、`clean-tree` 空）。
> 旁注（不作本轮 run）：祖先线 CI 实证已发表于 `.scratch/grill-round-95/handoffs/round-95-closeout.md`，该件同时记录了「模板 PENDING 出口 vs gate 强制 run URL」冲突的本机实证（F8）。

生成：2026-10-01 | 轮次：R95 审计 LOOP2 | LOOP2 报告：`.scratch/grill-round-95/reports/2026-10-01-audit-loop2-report.md`（分支 `r95-audit-loop2`）
LOOP1 报告：`.scratch/grill-round-95/reports/2026-10-01-audit-report.md` | LOOP1 交接：`.scratch/grill-round-95/handoffs/round-95-audit-handoff.md`（分支 `r95-audit`）
被审件：`reports/2026-10-01-report.md`、`handoffs/round-95-closeout.md`、`decision-ledger.md`（D-001~D-005）| 返工裁定：`docs/adr/0096-…-closeout.md` §Addendum-A

## 0. 一句话

LOOP2 判 **CONDITIONAL PASS**：F1~F8 八项全部处置到位，七项经审计窗独立取证证实（含 F3 指纹悬崖规避 + 机检 bite-check 4/4）；**残留 1 项 F5R**（交接档 Stack 行自称 tip 却短 4 个返工 commit），**单行文档修复**。返工未回改任何审计产物，claims 冻结完整，224 调用无须重跑。

## 1. 收尾窗唯一待办（单行）

| ID | 位置 | 缺陷 | 修法 |
|---|---|---|---|
| **F5R** | `.scratch/grill-round-95/handoffs/round-95-closeout.md` 第 4 行 | Stack 行枚举 `trx…wzw`（末项 `wzw (7a540900)`）后接「即 `r95-exec` tip」，但实际 tip = `9cac80c1` = `ulo`，短 4 个 commit；模板主键字段对自身 tip 不准 | 行末补 `→ qyv (a24684de @ 2026-10-01) → lxn (199f3e72 @ 2026-10-01) → umt (1b7bc809 @ 2026-10-01) → ulo (9cac80c1 @ 2026-10-01)`；或删「即 r95-exec tip」措辞 |

**最小验收（纯文档行，不需重跑 check/build/test/在线腿）**：
1. `node scripts/ship-gate.mjs` → 期望 exit 0，`handoff-lint`/`path-lint` 仍绿
2. `git status --porcelain` → 期望空

## 2. 不得追认事项（呈报 owner，审计窗不代追认）

- **N1** 交接档 §3 序号畸形（`1./2./2./3.`，缺 `4.`；markdown 渲染自动重排故视觉正常）——nit。
- **N2** 孤立分支 `r95-rework`（tip=`7a540900`，13 commits，已全部包含于 `r95-exec`）——hygiene，建议清理或具名保留意图。
- **N3** `handoff-lint` liveness 腿静默降级（本机 gh 在 PATH 但 gate 报 gh/repo unavailable ⇒ 本轮 pass **未活体核验 run URL**）——**强化 F8**，归 R96 主推。
- **N4** claims 仅验证「能复推绿」（9/9），未逐条比对断言**内容**是否与工件相符——建议 R96 或 claims 专项轮做内容级抽查。

## 3. R96 方向指示（下一 grill 正题候选）

**主推：门禁假绿收口（F8）—— R96 就做这个。** 理由已被 LOOP2 坐实到源码级：

1. `scripts/ship-gate.mjs` 行 1208 对 run URL **无 PENDING 豁免**，与 `docs/agents/handoff-template.md:31`「未推送即写 PENDING」**直接冲突**——诚实写法会被门禁判红（返工 run B 实测 exit 1 坐实）。
2. liveness 腿在 gh/network 不可用时**显式 skip**（行 1188/1200/1224），即「祖先线 run URL 被当本轮 run」这一盲区在离线环境**必然放过**（LOOP2 实测：gh 在 PATH 仍被 skip）。
3. 面窄、有明确 fail-closed 修法、可机械证明：
   - 让 PENDING 成为**机械可接受**的出口（消除模板与门禁冲突）；
   - Stack 行**强制 but-id 存在性**（本轮 F5R 即此类，本可被门禁拦下）；
   - 「URL 是否本轮 run」做**可离线判定**（比对 head_sha 是否为本栈祖先/自身），不依赖 gh 活性。

**备选（需用户侧先兑现，非 agent 可代办）**：B 路径检查（私有端点 `127.0.0.1:20128` 或有效 key → 干净全量跑）；`finding-r95-upstream-validator-vs-doc-vocab-mismatch` 的 `--live` 重跑（配额恢复后）；`fundamental×cn_code` 新格与全语料契约体检独立立案。

> **不建议** R96 重开评测矩阵：R95 读数是 input evidence 非方向裁定（ADR-0096 D3），方向裁定权归 owner `anysearch-eval`，agent 不得代裁。

## 4. 已排除的怀疑（勿重复排查）

stack 重挂载（`r95-exec` 含全部 17 commits，已证否）· F3 指纹悬崖（regen 字节同一，已解除）· F3 机检不过咬（bite-check 4/4，基线不过度拒绝）· claims 冻结后追写（`git diff a24684de..r95-exec` 为空）· 预注册被追改（`prereg-matrix.md` 未被触碰）· ADR-0096 本体被改写（numstat 15/0 纯追加）· 审计产物被回改（`kqq` 两件 diff 为空）。

## 5. 坑位（接手先读）

- `verify-validator-vs-doc.ts` **必须** `cd packages/store` 再跑（仓根跑报 `ERR_MODULE_NOT_FOUND: tsx`）。
- `pnpm check`/`pnpm build` 默认命中 turbo 缓存（`FULL TURBO`）⇒ **验收必须加 `--force`**，否则是假绿。
- `readout-output.json` 是 matrix@3 单次终读原件：**禁止二次 readout/peek**（矩阵作废）。指纹 `8da3e482b98f8cba` 已实证与 `eval-looks.json` 绑定（regen 字节同一）——**任何改动 eval-looks.json 字节的动作都会使 matrix@3 作废**。
- `closeout-claims.json` 已冻结（登记 commit `a24684de` 后未再改动）⇒ **不得追写 claims**；门禁为只读复证。
- `readout-delta.mjs` 物理位置在 `grill-round-85/`（非 r95），改它等于改前轮工件，须在 ADR-0096 补注。
- `ANYSEARCH_ENDPOINT` 须给完整 MCP 路径（`https://api.anysearch.com/mcp`）；裸 origin 致 `initialize 404`。本机 env 残留死回环 `127.0.0.1:20128` —— 用户侧事项，agent 不改、不持凭证。

## 6. Suggested skills

- `$but` — 全部版本控制写操作；收尾新开分支（建议 `r95-close`），与 `r95-exec`/`r95-audit`/`r95-audit-loop2` 并行互不影响；禁裸 git 写。
- `$code-review` — R96 若改 `scripts/ship-gate.mjs`（F8 门禁收口），按 Standards/Spec 双轴评审；改动面窄但属治理工具，务必双轴。
- `$diagnosing-bugs` — F8 修复若致 `handoff-lint` 行为漂移，按诊断循环走而非直接改断言。
- `$neat-freak` — R95 轮末收尾（claims 内容级抽查 N4、`r95-rework` 残留分支清理 N2、文档与代码对齐）。
- `$handoff` — 收尾交接（引用已有工件路径，不复述）。

## 7. 自检

- [x] 引用已有工件（路径）而非复述
- [x] 脱敏：无 key / 凭证 / PII（端点仅记源类不记值）
- [x] Stack 行含 but-id 链 + capture date，且**对自身 tip 准确**（不重复 F5R 错误）
- [x] 绿色 run URL 显式写 PENDING（未推送）
- [x] 职责分离：审计窗只出报告，**未动手修**