# Round-86 → next-round 交接

Stack (primary key = GitButler change-ids; branch `r86-green-gate-ship`, 叠于 `r86-grill`(lzr 档案面)，基座 origin/main tip):
`kry`（T0 哨戒实录+核账归档）→ `ylk`（T1 红门修复：证据指纹清单+claim 改指+audit-checklist 硬项+CHANGELOG r86）→ `mpq`（T2 判别实验第一批：ProviderErrorClass 通道+P0 探针+P3 dist 新鲜度断言）→ `pxs`（T4 判读器 matrix@2+勘误+registry 注记）→ `knp`（T3 quota-nudge 具名化+P2 raw 探针）→ `qnq`（T5 全绿臂复跑+真测量版 NO-GO+registry 三联+r86 decision-record）→ `uuw`（T6 v0.1.0 钉版+ADR-0087+claims 20）→ `zwy`（收官报告）→ `pln`（adr-index 规范化）。

主题：fix-r86-green-gate-ship——绿门装船轮：装船前置的根因判别与绿门发布——**已终局：NO-GO（真测量版）+ v0.1.0 钉版就位**。

## 裁决（matrix@2 单次终读，锁定）

- **NO-GO / direction-negative**：b=5 w=10 t=25 u=1，nPaired 40/41 → P=0.0378≤0.5；净胜率 −0.125 / EL 0.297 / rankDiff 中位 0
- 判读链：`.scratch/grill-round-85/readout-delta.mjs`（matrix@2 执行体）→ `.scratch/grill-round-86/readout-output.json` + `decision-record.md`
- 判据记账：iso providersFailed=∅ 字面未达（残余 5 腿=确定性上游契约拒收：4 设计内 bogus 对照 + vert-f1105 欠 cn_code）；装置性失败=∅；非空覆盖 97.6%✓

## 根因链（probe-matrix.md 全文）

R85 全灭 = **env 层双重缺陷**（ANYSEARCH_ENDPOINT 指 loopback 死路由 + ANYSEARCH_API_KEY invalid）——上游匿名实测存活，非臂死。匿名配额边界=auto-provisioning 凭证签发文本（已具名 permanent-auth）。env 修正归用户侧不代办。

## 已完成

- **T0**：哨戒实录 reports/t0-watch-2026-09-27.md
- **T1**：指纹清单模式修红门（claims path 断言不再指 gitignore 通道）+audit 硬项+双平台门绿实证
- **T2**：错误类别通道端到端（contract→engine→cli→delta 行）+两探针 fixture+P3 dist 断言（双侧实证咬人）
- **T3**：quota-nudge 检出归 permanent-auth+defer-r84 空串 POSIX 修复+iso 5/5 复活判据
- **T4**：matrix@2（G1b+unmeasured 语义，selftest 7/7 含假平格回归锁）+decision-record/ADR-0086 勘误+manifest 扩展（delta.json 指纹留存+覆盖披露）
- **T5**：原指纹复跑（声明式环境：公开默认端点+上游自签发凭证）→ 真测量 NO-GO
- **T6**：registry 四联（2 核销+2 新挂）+ADR-0087+CONTEXT 校对（九词已在位）+claims 20+0.1.0 全包钉版
- **验收面**：pnpm -r check 8/8 ✓ / pnpm -r test 8 包全绿 ✓ / ship-gate --quick EXIT=0 ✓ / build+pack ✓ / MCP initialize+fail-open boot ✓

## 残留呈报

- **v0.1.0 tag 推送/npm publish 未发**——外部生产动作待授权（release.yml 触发面：tag push v* 或 workflow_dispatch pre-tag）
- 用户侧 env 修正（endpoint 指向死路由+失效 key）归用户——defer-r86-anysearch-anon-quota-nudge 挂账
- vert-f1105 欠 cn_code——语料冻结期不可修，defer-r86-anysearch-corpus-param-contract 挂账
- delta.json 原件被 R86 冒烟覆盖——manifest 记指纹留存+disposition 披露；冒烟必设 ANS_VERTICAL_DELTA_OUT 教训落档
- 上游配额武装测量法（自签发凭证）依赖 upstream 匿名 provisioning 契约——该面变动则重测

## 绿色 run URL

- ci: https://github.com/Xxx91n/anysearch-cli/actions/runs/36321125532（T5 后终态推送 sha 26712823，dispatch）
- ship-gate: https://github.com/Xxx91n/anysearch-cli/actions/runs/36321221663（终态 sha 16f22aff：ubuntu-latest✓ + windows-latest✓ 双腿绿；首轮 36321121603 因本文件缺位主动取消不重报）
- 早期 T1 态绿证：ci 36316042170 / ship-gate 36316038577（sha ff273624）
- 本机全量：node scripts/ship-gate.mjs --quick EXIT=0（win32）
