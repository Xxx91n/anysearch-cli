# T0 合流转录 — 三栈+文档栈顺序落 main（2026-09-19）

## 落栈序列（but land --yes，直落 origin/main 线性史，无 merge commit）

| 序 | 栈 | commits | 落地后 main tip | 证据 |
|---|---|---|---|---|
| 1 | r71-audit | vxs+yut+tkv (3) | `3028a4a9` | 本地门绿（frozen install+check 8/8+test 13/13+ship-gate 60pass）|
| 2 | r72-grill | uzt..zmu (7) | `409723a7` | 同上全绿 + CI: ci 35448637659 / ship-gate 35448637516 / native-smoke 35448637523 全 success |
| 3 | r72-audit | lzr+unw (2) | `5f16c8e3` | 同上全绿 + CI: ci 35449008756(attempt2 success; attempt1 windows install-smoke runner 挂起无日志→cancel+rerun --failed 复绿) / ship-gate 35449008684 / native-smoke 35449008674 全 success |
| 4 | r73-grill | uur+nvy+qzq+wxl+qoq+qyl (6) | `dff7539b` | 同上全绿 + CI 35451319160/35451319130/35451319161（本文件入库时在途）|

## 前态存档

- `.scratch/grill-round-73/evidence/t0-pre-merge-but-status.txt`（全栈快照）
- `.scratch/grill-round-73/evidence/t0-pre-merge-stack-shas.txt`（13 commits 原 SHA 清单；landing rebase 后新 SHA 见 git log）

## PENDING 回填

- `.scratch/grill-round-72/handoffs/round-72-audit-handoff.md`：PENDING→LANDED+3 run URL（commit qoq→9d4259a4）
- `.scratch/grill-round-71/handoffs/round-71-audit-handoff.md`：补「绿色 run URL（必填）」段+3 run URL（同 commit）

## 合后遗留栈/分支清理候选（只列不删——D-007 红线，待用户确认）

1. `origin/r71-grill` 远端分支（tip d897707a）——`git merge-base --is-ancestor origin/r71-grill origin/main` 实证已完全并入 main，删除候选。
2. 本地 `main` 分支 ref——已随 land 同步至 dff7539b（GitButler target 簿记，正常状态，无需操作）。
3. 本地 `gitbutler/target`、`gitbutler/workspace` ref——GitButler 基础设施 ref，非清理对象。
4. 已落栈本地分支 r71-audit/r72-grill/r72-audit/r73-grill——`but land` 已自动移除本地 ref，无残留。
5. worktree：仅主工作区（本仓根），无遗留 worktree。
