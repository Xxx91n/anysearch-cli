# `.temp/` 会话残留处置方案（#182 / T7 of #175）

Date: 2026-11-05. Scope: issue #182 的仓库仓务动作二——`.temp/` 会话残留处置。
**本文件是处置方案，不是执行记录。所有删除性动作均标注「需用户单独授权」，
本票（及本实现窗口）不执行任何删除、移动或改写。**

## 背景与边界

#182 要求对 `.temp/` 会话残留（#15/#16 调查工件、CI 日志取证、land 前备份、评审快照）
逐项给出删 / 档 / 留方案。删除性动作执行前须用户单独授权；未授权项保持原状。

**重要事实**：在归档本方案的检出树（`main@4f87306`）中，`.temp/` 目录**不存在**——
`git log --all -- .temp/` 无任何历史、`git status` 无该条目、`ls .temp/` 报
`No such file or directory`。即这些残留**从未进入版本库**，是会话/本地临时工件。
因此本方案按 #182 / #175 描述的**类别**枚举并给出建议处置；执行前须由用户在
各自环境中**核实实际存在性**，再就删除项单独授权。

> 依据 #175「待裁决」：".temp/ 会话残留的删除授权：T7 执行时单独请示（含 land 前
> 备份的处置口径）。"——本方案即该「单独请示」的书面载体；删除未经用户明确授权不执行。

---

## Item A — #15 / #16 调查工件

### Evidence（类别级；实际工件未在检出树出现）

- #15（api.anysearch.com 归属确认）结论已落 `packages/retriever/src/providers/anysearch.ts`
  注释块 `DEFERRED → CONFIRMED`（2026-11-04），并登记于 CHANGELOG（#15 段）与
  `docs/limitations.md`。
- #16（better-sqlite3 macOS exit-time mutex crash）结论已落
  `.github/workflows/ship-gate.yml` 矩阵剪除 + `docs/limitations.md` + 审计 S1/S2
  修复（PR #174，已 MERGED）。
- 因此 #15/#16 的「调查工件」（探针脚本、取证草稿、比对截图等）价值已被代码与文档
  吸收，属可重建的会话过程产物。

### Verdict: **delete（需用户单独授权）**；重建成本为零

理由：结论已固化为代码注释 + CHANGELOG + limitations，调查中间产物无独立留存价值；
若日后需复核，证据链在 issue #15 / #16 与对应 PR 中仍可追溯。如用户要求「留底」，
退路是 `move` 至已 gitignore 的 `.scratch/`（同 repo-hygiene-t2 的 Item A 口径）。

---

## Item B — CI 日志取证

### Evidence（类别级）

- 指在 macOS ship-gate 崩溃（#16）等事件中抓取的 CI run 日志 / 局部转储，用于离线
  取证（如 `eval-gate.test.ts` 捕获子进程被杀、`libc++abi` "mutex lock failed" 签名）。
- GitHub Actions 运行历史本身可保留（取决于组织 retention 策略），本地副本为冗余。

### Verdict: **delete（需用户单独授权）**

理由：CI 日志可由 run URL / run id 重新拉取；任何已被 issue / CHANGELOG / 审计评论
引用的证据无需在本地留存副本。若某条证据**仅**存在于本地副本且尚未被引用，应先
回填到对应 issue / PR 评论，再删除本地副本（避免证据随删丢失）。

---

## Item C — land 前备份

### Evidence（类别级）

- 指 PR land（合并）前对受影响文件 / 分支态做的本地或临时备份，用于 land 失败回滚。
- 当前已位于 `main@4f87306`（多个相关 PR 已 MERGED 并稳定），land 动作已完成。

### Verdict: **delete（需用户单独授权），但须先核验引用 PR 已合并且稳定**

理由：land 成功且稳定后，回滚备份即成为过期冗余。执行前逐项确认该备份对应的 PR
已在 `main` 且通过对应验收（如 ship-gate 绿、CHANGELOG 已落账）；任一引用 PR
尚未合并或存在回滚需求的，该项**改为 keep** 直至 land 确认。这正是 #175 所述
「含 land 前备份的处置口径」的落点。

---

## Item D — 评审快照

### Evidence（类别级）

- 指 code review / CodeRabbit 处理过程中保存的快照（如评审前文件态、diff 快照、
  评审线程离线副本），供返修对照。
- 评审线程本身存活于 GitHub PR / issue，快照为本地冗余副本。

### Verdict: **delete（需用户单独授权）**

理由：评审历史在 GitHub 可追溯，本地快照无独立留存价值。若某快照关联**尚未关闭**
的评审线程且含未迁移的上下文，应先迁移到线程评论，再删除本地快照。

---

## 汇总

| 项 | 类别 | 建议处置 | 删除授权 | 执行前核验 |
|----|------|----------|----------|------------|
| A | #15/#16 调查工件 | delete（或留底 move 至 `.scratch/`） | 需用户单独授权 | 确认结论已固化于代码/CHANGELOG/limitations |
| B | CI 日志取证 | delete | 需用户单独授权 | 仅本地持有的证据先回填 issue/PR |
| C | land 前备份 | delete（引用 PR 未合并且需回滚则 keep） | 需用户单独授权 | 确认引用 PR 已合并且稳定 |
| D | 评审快照 | delete | 需用户单独授权 | 关联未关闭线程的上下文先迁移 |

## Execution checklist（for the driver/user — 本票不执行）

1. **核实存在性**：在各自环境中确认 `.temp/` 及各子项实际存在（本检出树中不存在）。
2. **逐项授权删除**：对 A/B/C/D 中确认删除的条目，取得用户明确授权后执行
   `rm -rf` / `mv`；未授权项保持原状。
3. **C 项先核验 land**：删除 land 前备份前，确认其引用的 PR 已在 `main` 且验收通过。
4. **证据回填**：B/D 中仅本地持有的证据，先回填到对应 issue / PR 评论，再删本地副本。
5. **关闭 #182**：删除授权全部落实（或用户决定留底）后，关闭 #182；本方案随 #182 PR
   一并落 `main`，作为处置决策的可追溯记录。
