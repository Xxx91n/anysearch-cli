# Grill Round 95 — 审计 LOOP3（修复执行 + push 后复核，审计窗口）

日期：2026-10-01 | 触发：owner 授权「小问题自行修复 → LOOP 复核 → push → 安全删除已合并分支」
LOOP1：`2026-10-01-audit-report.md`（CONDITIONAL FAIL，`r95-audit`）| LOOP2：`2026-10-01-audit-loop2-report.md`（CONDITIONAL PASS，`r95-audit-loop2`）

## 0. 结论

**PASS。** LOOP2 唯一阻断 F5R 已修；N1 已修；两处 push 相关失效声明已修。修复后 `ship-gate` **exit 0 零 fail 腿**、工作树空。已 push 5 个栈到 origin。

## 1. 本轮修复（owner 授权范围内）

| ID | 性质 | 修复 | 位置 |
|---|---|---|---|
| **F5R** | LOOP2 唯一阻断 | Stack 行补 `qyv`/`lxn`/`umt`/`ulo` 四段 but-id + capture date，末位为自引用收尾 commit `xtv`；tip 但-id 已正确，tip 自身 SHA 按模板 time-lagged 语义**故意不写入**（避免写入即失准） | `.scratch/grill-round-95/handoffs/round-95-closeout.md` 第 4 行 |
| **N1** | nit | §3 R96 待办序号 `1./2./2./3.` → `1./2./3./4.` | 同件 §3 |
| **F5R-b** | 本轮新增（push 引发） | Stack 行「未 land、未 push」→「已 push 至 `origin/r95-exec`（`a5af1140`），未 land、未 tag、未 publish」 | 同件第 4 行 |
| **F5R-c** | 本轮新增（push 引发） | run URL 段「PENDING — stack unpushed / 未外发 / 无 push」整段重写为**真实拓扑**：已 push，但本仓 workflow 触发条件仅 `push: branches: [main]`/`pull_request`/`workflow_dispatch`，故特性分支 push 不产生 run（`gh run list --branch r95-exec` 空，实测）；机械锚由 R94 期祖先线 run 换成**当前 `main`@`3642d494` 的三条绿 run**（36741517719/36741517755/36741517873，`gh run list` 实测存在） | 同件 §绿色 run URL |

> `F5R-b`/`F5R-c` 是 **push 动作本身制造的失效声明**——与 LOOP1 `F1`（未申报偏差）同类。修复时已做全量声明扫描（`round-95-closeout.md` / 轮报 / LOOP1-2 审计件 / ADR-0096），仅修**活的前向工件**（closeout 交接档）；LOOP1/LOOP2 审计报告与 ADR-0096 §Addendum-A 中的「未 push / PENDING」表述属**当时状态的历史记录，改之即伪造审计轨迹**，一律不动，改由本 LOOP3 记录追述。

## 2. 修复后验收（审计窗亲跑）

| 项 | 结果 |
|---|---|
| `node scripts/ship-gate.mjs` | **exit 0，零 `[fail]` 腿**；`closeout-claims r95: 9/9 re-derived green`、`handoff-lint` pass（含「cite a run on this round history」子句）、`closeout-coverage: 20/20`、`canonical-json` 绿、`gen-adr-index: 96 ADRs at HEAD`、`path-lint: 600 registered doc(s) clean`、`clean-tree` 空 |
| `readout-delta.mjs selftest` | exit 0，7/7 全 PASS |
| `readout-delta.mjs assert-corpus` | exit 0，fp `8da3e482b98f8cba` = expected，subjects 40 / controls 16 |
| 纯文档改动面 | 故 check/build/test/install-smoke **未重跑**（LOOP2 已全绿且本轮零代码改动）；`pnpm test` 经 ship-gate 内嵌腿复跑 13/13 |

## 3. F5R 自洽性机械核验

- Stack 行引用的 **16 个 SHA 逐个 `git cat-file -t` = `commit`**，零悬空。
- but-id 链含 `qyv lxn umt ulo xtv`（4 返工 + 1 收尾），与 `but status` 栈顶一致。
- 自引用处理：收尾 commit `xtv` 的 SHA 写入即因 amend 失准，故按 `handoff-template.md:23-27`「SHA time-lagged，以 but log 为准」**只写 but-id 不写 SHA**——这是对该条规则的正确遵守，而非遗漏。

## 4. push 与分支处置

**push（已执行，owner 授权）**：`but push` → 21 commits，5 个新远端分支：`origin/r95-exec`@`a5af1140`、`origin/r95-audit`@`e9190d9a`、`origin/r95-audit-loop2`@`8e2801a9`、`origin/r95-grill-docs`@`1bad2667`、`origin/r95-rework`@`7a540900`。

**分支删除：`r95-rework` 未能安全删除——已尝试并回退，呈报如下。**

该分支是唯一「已合并」候选（`git merge-base --is-ancestor r95-rework r95-exec` = YES；`git rev-list r95-rework --not r95-exec | wc -l` = **0**，其 13 个 commit 全部已含于 `r95-exec`）。两次尝试均被工具拒绝并已完整回退：

1. `but uncommit r95-rework` → `Error: Cannot uncommit commits that would result in merge conflicts`（因 `r95-exec` 后续已改同名文件）。
2. `but move r95-rework --unstack` → 成功解除 stack，但**在 `r95-exec` 的 5 个 commit 上留下 conflict**（`qyv`/`lxn`/`umt`/`ulo`/`xtv`），工具自身告警。已立即 `but undo` 回退。

**回退后核验**：工作树空、`r95-exec` 仍 18 commit（tip `a5af1140`，F5R 修复在顶）、全树无 conflict marker、5 个分支引用全部完好。

**结论**：「安全删除 `r95-rework`」在现行 gitbutler 工具面**不可达**——该分支与 `r95-exec` 构成祖先-后代且文件已分叉，移除必然冲突。**故本轮不删**，风险为零：

- 零数据风险：0 个独有 commit，全部内容在 `r95-exec` 内；
- 零远端歧义：已随 push 生成 `origin/r95-rework`，但它只是 `r95-exec` 祖先的指针，不含任何独有内容；
- 处置选项（**留待 owner 决定，审计窗不擅自用裸 git 写**）：(a) 就留置（当前状态，无害）；(b) 在 `r95-exec` land 到 `main` **之后**跑 `but pull` 让 gitbutler 自行回收；(c) 授权裸 `git push origin --delete r95-rework` 仅删远端指针（`but` 无远端分支删除命令）。

其余 4 个分支（`r95-exec` / `r95-audit` / `r95-audit-loop2` / `r95-grill-docs`）各含 1~18 个**独有 commit**，均**未合并**，故一律 push 保留、**不删**。

## 5. 对 F8 的新证据（强化 R96 主推）

本轮取得 F8 的**第二类**本机实证：`handoff-template.md:31` 与 `ship-gate.mjs:1208` 要求「绿色 run URL / PENDING 出口」，但本仓 CI **对特性分支 push 不产出任何 run**（workflow 触发条件实测仅 `main` push / PR / dispatch）。即：

1. 诚实写「无本轮 run」→ gate 判红（返工 run B 已坐实）；
2. 只能引非本轮 run（基底线/祖先线）→ gate 判绿但语义不真（F8 盲区）；
3. **无论 push 与否都无解**——这是拓扑与门禁的错配，不是执行者的选择。

R96 修法建议追加一条：`handoff-lint` 的 run-URL 腿应接受「本栈已 push 且 CI 拓扑不产出分支 run」这一**可机械判定**的状态作为出口（判据：`.github/workflows/` 触发条件不含分支 push），而非只接受 PENDING 或任一 run URL。

## 6. 审计窗自证

- 本轮为**修复执行窗**（owner 明示授权），非只读。改动仅 1 个文件（`round-95-closeout.md`），3 处段落级替换，均为字符串锚定替换 + 写后回读校验。
- 未触碰：`eval-looks.json`（指纹 `8da3e482b98f8cba` 存续，matrix@3 未作废）、`closeout-claims.json`（冻结中）、`prereg-matrix.md`（SAP 冻结）、ADR-0096 本体、任何 `.ts`/`.mjs` 源码、任何历史审计记录。
- 一次危险操作已回退：`but move r95-rework --unstack` 造成 5 commit 冲突 → `but undo` → 核验工作树空 / 无 conflict marker / 分支完好（见 §4）。
- 未 tag、未 publish、未开 PR（owner 未授权；开 PR 会触发 `pull_request` CI 与 OF look 消耗，属范围外）。