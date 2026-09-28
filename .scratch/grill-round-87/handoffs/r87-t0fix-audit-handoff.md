# R87 T0 修复审计 → 下一窗交接 — 2026-09-28

Stack: r87-release-closeout（wtm）+ r87-grill（mss），基座 origin/main = cfb0fff7；本档为记账件（publish 后随批落地，不入制品 commit）。
审计报告全文：`.scratch/grill-round-87/reports/r87-t0fix-audit-2026-09-28.md`（声明→证据→结论 19 行对照表+D-xxx 核对+双轴评审，勿重复抄录）。

## 审计结论

修复本体 **PASS**：ship-gate --quick 复跑 EXIT=0（0 fail；handoff-lint/freshness 豁免/memory-eval 126/126/8 包打包/MCP v0.1.0 initialize+fail-open+packaged smoke 逐字命中）。6/6 孤儿 sha 与三 run 结论经 gh api+merge-base 独立重现。门禁零弱化、无推送无 tag、无敏感值。

## 接手状态

- 本地两栈待用户推 main：`r87-release-closeout`(wtm=closeout +2 行勘误）、`r87-grill`(mss=档案 11 文件+`.gitignore` 纳管+goal.md `no-changelog-entry:` 豁免）。
- 未提交：`.scratch/grill-round-87/reports/`（t0-watch+本审计报告）——记账件纪律，T6 批落。
- 远端 main 仍 cfb0fff7；无本地/远端 v0.1.0 tag。

## 下一窗动作序（T1→T6，遵 decision-ledger + next-round.md，除下列修订）

1. **先落 R-1 勘误批注**（可并入本次推 main 前的同栈小 commit，docs 面不触门禁）：goal.md:10 / decision-ledger D-002·D-003 / next-round.md:3·9·27 的「tag 挂 cfb0fff7」字面锚已物理不可达（post-tag 断言五族对 tagged sha 不可变检查，cfb0fff7 ship-gate check 红）——脚注重钉为「tag 挂 wtm+mss 落栈后的 main tip，推后待 CI 复绿再签」。**需用户对此语义锚追认**（字面→语义的账本修订）。
2. 用户推 main 两栈 → 等落栈后新 tip 的 ci+ship-gate+native-smoke 全绿（实物 gh run list，勿凭假设）。
3. T1 `gh workflow run release.yml -f runPurpose=pre-tag` → 等 ledger commit 双腿绿。
4. T2 呈报用户：`git tag v0.1.0 <落栈后 main tip>` + `git push origin v0.1.0`——**sha 取落栈后实测 tip，非 cfb0fff7**（本地现无 tag，需先建）。
5. T3 发布后实物验证（npm view dist-tags/integrity、tarball 拆包验 /mcp 在列 /v1/search 不在、净机 install-smoke、dsh-plugin 陌生人安装、**publish job OIDC 日志显式核验**）→ reports/post-release-verify-*.md。
6. T4 deprecate：`npm deprecate "@anysearch-cli/cli@<0.1.0" "Deprecated: bundled anysearch provider used a dead endpoint (route 404). Fixed in 0.1.0 — upgrade."`（T3 全绿后）。
7. T5 记账件批：F-3 判据表述勘误+defer-r86×2 注记+R88 候选登记；**删去 pr-1764-comment Status 勘误项（幻影——R86 T4 已核销，commit 23de57a2）；顺手修正 t0-watch 行 39**。
8. T6 收口：registry+ADR-0088+closeout-claims+CHANGELOG 已知缺陷段（落 0.1.0 段下）+提交 reports/ 记账件。

## 遗留注意

- 本地 gate 在 reports/ 未提交期间必红 step-0 clean-tree（假象，CI 无此态）；签名重验以落栈后 CI 为准。
- mss commit message 未披露 .gitignore hunk（nit，不追改）。
- 「第三次踩红签字」史述未独立复核（低实质）。

## 下一个 grill 方向指示（R88 候选，供裁决非定案）

- 正题候选 A：**F-6 refactor 施工轮**（probe-mcp-raw ??/|| 一致化+sanitize 对称+版本字面量护栏+CHANGELOG 归位；独立 refactor commit，遵 ADR-0029）。
- 正题候选 B：垂域方向重议轮（prefer-capable 具名重开条件 |ΔarmHostHit|≳0.4 未达，保持候审）。
- 随档新材料：孤儿 SHA 子类三连发（R79→R85→R87）→ 审计签字 checklist 硬项「签字 sha 门绿需在最终落栈 sha 重验」+ closeout 绿证引用纪律（引落栈后 main SHA run）——可挂 ADR-0088 或独立治理项。
- 哨戒续班：dsh rc.2 已越龄期闸（repin 裁决域外）、llm-init SSE flake、#1764 OPEN。

## Suggested skills

`but`（推栈/落栈）、`grilling`（T1 判读+裁决纪律）、`domain-modeling`（Deprecation Precision/Two-Piece Bleed Kit）、`handoff`、`neat-freak`（记账批）。审计窗惯例：发现问题打回修复窗或呈报用户，不动手修。
