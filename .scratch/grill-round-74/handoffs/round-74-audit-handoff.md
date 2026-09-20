# Round-74 审计收口交接 — audit 窗口（2026-09-20）

Stack (primary key = GitButler change-ids; SHAs are time-lagged):
`r74-grill` → `zwu`(9690c9cd)→`plo`(7d78bb19)→`ort`(f1b95acc)→`szz`(d4a67e02)→`xst`(45fac87f)→`tyu`(b842bc96)→`qks`(c8d32940)→`slx`(80d02c16 返工)→`oyl`(ceb9ab2e 回填)→`smt`(b26172a9 pathlint)
并行栈 `r74-audit` → `krv`(5024f809 首轮审计)→`pws`(55273ab1 marker)→本轮复审件（报告+本交接）

## 审计裁决链

1. **首轮**：`reports/2026-09-20-audit.md` —— 裁决**不通过**：F1 硬（hero.svg 误写 MIT，实 Apache-2.0）+F2 实质（Date 列迁移半截+三处"日期已迁专文"伪述）+F3 中（r71-grill 列报过期）+F4-F10 轻。返工要求：`handoffs/round-74-audit-rework.md`。
2. **返工**：`slx` 单票处置 F1-F10（Apache-2.0 文案+证据图重截/三专文补日期 09-16·17·17/列报核销/cold 补回/off-list 解绑/计数订正/contrast 补迁）；`oyl` 回填返工记录节；`smt` 补 pathlint。
3. **复审**：`reports/2026-09-20-audit-r2.md` —— 裁决**通过**：F1-F10 逐项实物核销；同一套验收复跑 9/9 绿（pathlint 268、pack×8、memory-eval 126/126、proof 逐字、abstain 逐字）。

## 绿色 run URL

本栈未推——**本轮 run `PENDING — stack unpushed`**（本地 `node scripts/ship-gate.mjs --quick` 9/9 绿）。
本历史最新绿 run（r73-audit landed 栈，head_sha `d8090887` = HEAD 祖先，全 success）：

- ci: https://github.com/Xxx91n/anysearch-cli/actions/runs/35483715645
- ship-gate: https://github.com/Xxx91n/anysearch-cli/actions/runs/35483715664
- native-smoke: https://github.com/Xxx91n/anysearch-cli/actions/runs/35483715643

push 后回填本轮 run URL。

## 下一轮候选（grill 方向指示）

- **R75 首选**：栈推 + 合流 housekeeping 非 grill 轮——用户确认后 `but push r74-grill`（r74-audit 随行），回填 run URL 再落 main（沿用 Sequential Stack Landing 因果序，CONTEXT.md 词块已载）。
- **r75 主题候选 A（内容债）**：`defer-r71-transformers-undeclared-dep` 或 `defer-r71-shipgate-1g-coverage`——registry 内最老的代码侧续债，证据链在 `.scratch/grill-round-71/`。
- **r75 主题候选 B（生态）**：`defer-r72-dsh-*` 三件套（npm publish/native tools/web interactive matrix）——dsh 上游 0.1.6 哨戒 `defer-r73-dsh-event-rename` 触发器同上包。
- **r75 主题候选 C（视觉延伸）**：`defer-r74-logo-bitmap-matrix`——唯 imagegen/渲染导出链可用时才成立（SVG 源件 `assets/readme/logo.svg` 就位）；不可用则保持 deferred。
- 持续项：proof 块 transcript 属日期性证据，输出契约变更时需重捕获（ADR-0075 Negative 段）。

## Known risks / 记档

- GitButler 索引漂移处置法已入 closeout Known risks（`git reset HEAD` 调和，后续轮复用）。
- 审计文件自身也曾踩 pathlint（临时域目录裸路径）——凡在报告内引本机临时路径，同行须带 `<!-- machine-local: reason @ YYYY-MM-DD -->`。
- proof 块复跑说明：审计复跑以临时 `cold` 域 toml 证 abstain 逐字，比"信报告"强一档，后续审计可沿用此法。

## Suggested skills

`$implement`（续作驱动）· `$handoff`（收口交接）· `$code-review`（双轴复审）· `$but`（栈操作）· `readme-crafter`/`beautify-github-readme`/`repo-logo`（视觉层再迭代）· `$atomcode-research`（联网调研）。

无秘密值落档；全部引用为库内相对路径。
