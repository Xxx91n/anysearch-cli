# Round-86 → next-round 交接（审计窗产出）

Stack (primary key = GitButler change-ids; SHAs are time-lagged):
  r86-green-gate-ship（kry→ylk→mpq→pxs→knp→qnq→uuw→zwy→pln→lqx→xuo，叠 r86-grill/lzr，基座 527c8172）
  + r86-audit（审计工件层：audit-r86-2026-09-27.md + 本交接）

主题：fix-r86-green-gate-ship 已终局（NO-GO 真测量版 + v0.1.0 钉版就位）；审计窗判 **PASS（附发现）**。

## 已完成

- R86 T0-T6 全程落地（见 reports/2026-09-27-report.md 与 round-86-closeout.md）
- 审计窗独立复证：pnpm -r check 8/8 · pnpm -r test 全绿 · build+pack 8 tgz · ship-gate --quick EXIT=0（干净树）· MCP initialize/fail-open/dist 三平面测活 · claims 20/20 双向 re-derived · selftest 7/7+assert-corpus 指纹一致 · CI 四 run gh 复核 success · v0.1.0 全包钉版且 tag 未推
- 审计全程报告：.scratch/grill-round-86/reports/audit-r86-2026-09-27.md（29 行声明→证据→结论对照表 + F-1~F-7 分级发现 + D-001..D-005 逐条核对 + LOOP-2 复查节）
- LOOP-2 复查（返工后）：验收面复跑持续全绿；远端 ship-gate 36323691083/ci 36323694503 双腿复核 success；「全部收口」「pack 3 tgz」「账本更新」三处呈报与实物不符已记
- LOOP-3 复查（返修 `xur`/25b728ab 后）：**F-1/F-2 修复实证闭合**（rerun 档五指纹复算全 MATCH+manifest judgeConfigCurrent 双 MATCH+delta current 改指 T5 原件；closeout 必填节补齐）；验收复跑全绿；远端 ship-gate 36328590233/ci 36328594782@25b728ab 双腿 success——**审计终判 PASS**
- 裁决维持：NO-GO/direction-negative（真测量版，P=0.0378、netWinRate=-0.125、EL=0.297、nPaired 40/41）；iso providersFailed=∅ 字面判据未达已如实记账（F-3 呈报裁量）

## 绿色 run URL（必填）

- ci: https://github.com/Xxx91n/anysearch-cli/actions/runs/36321125532 （success @26712823，gh 复核）
- ship-gate: https://github.com/Xxx91n/anysearch-cli/actions/runs/36321221663 （success @16f22aff；ubuntu-latest✓+windows-latest✓+memory-eval✓；macos-spillover failure=显式 non-blocking 实验腿）
- T1 态绿证: ci 36316042170 / ship-gate 36316038577（success @ff273624）
- 本机：node scripts/ship-gate.mjs --quick EXIT=0（win32，2026-09-27 审计窗复跑）

## 下一轮候选

1. ~~F-1/F-2 文档返工~~ **已闭合**（xur/25b728ab：reports/rerun-2026-09-27.md 全量指纹登记 + manifest judgeConfigCurrent + closeout 必填节——审计 LOOP-3 sha256 复算一致）。
2. **F-6 refactor 候场**（独立 refactor commit，遵 ADR-0029）：probe-anysearch-mcp-raw.ts `??`→`|| undefined` 一致化 + sanitize 对称遮 endpoint；探针版本字面量漂移护栏；CHANGELOG Unreleased r84/r85 旧段归位；endpoint/Iso 判定三处重复收敛。
3. **F-3 裁量待办**：iso providersFailed=∅ 字面判据未达 vs 语义判据（装置性失败=∅）——用户裁定：改判据表述、追加语料解冻后复测条件、或维持现状记账。
4. **发布授权**：v0.1.0 tag push / npm publish（release.yml tag v* 或 workflow_dispatch pre-tag）——外部生产动作待用户授权后执行。
5. **defer 新票跟进**：defer-r86-anysearch-corpus-param-contract（语料解冻期修 cn_code）；defer-r86-anysearch-anon-quota-nudge（用户侧 env 修正回执核销）。

## Known risks / deferred

- 上游配额武装测量法（自签发凭证）依赖 upstream 匿名 provisioning 契约——该面变动则重测
- vert-f1105 欠 cn_code：语料冻结期不可修（defer-r86-anysearch-corpus-param-contract 在册）
- 用户侧 env 修正（endpoint 死路由+失效 key）归用户——agent 不代办
- delta.json 原件两度覆盖（T2 冒烟+T5 复跑）——manifest 留存 originalSha256+disposition；冒烟必设 ANS_VERTICAL_DELTA_OUT 教训落档
- F-6 软化面：dist-assert git 缺席 WARN 续跑；raw 探针 sanitize 不对称；探针版本字面量下次升版漂移
- 过程违规（已呈报不追认）：commit 序 T3/T4 对调；defer-r84 修复并车入 feature commit

## Suggested skills

- $implement——F-1/F-2 返工项执行
- grilling——F-3 判据裁量 + F-4/F-5 过程违规裁量
- domain-modeling——rerun 档/matrix@2 指纹登记术语一致性
- neat-freak——F-6 refactor 候场清障（独立 commit）
- $handoff——下轮收口
