# Round-85 → next-round 交接

Stack (primary key = GitButler change-ids; branch `r85-grill`, base `7c94622f`):
`rku`（grill 定稿 4 裁决）→ `ool`（T0 哨戒实录+锐评核账归档）→ `wws`（T1 预注册矩阵+判读器+指纹钉版，先于任何读数）→ `npv`（T2 runner instrument-health ordering）→ `qsw`（T3 决策记录+判读输出档）→ `kut`（T4 ADR-0086+index+registry 三联+closeout-claims）。

主题：delta 腿全量重跑 + prefer-capable 前置判读（evidence-only 轮）——**已终局：NO-GO**。

## 裁决（单次终读，锁定不改判）

- **NO-GO / direction-negative**：b=0 w=0 → P=0.500≤0.5 且池化 Δ=0≤0 双肢同中；净胜率 0 / EL 0.1667 / rankDiff 中位 null
- 覆盖全绿：nPaired 41/41、unknown 0、对照层 16/16 腿级可达、controlDegraded=0、无早停无截断
- 判读链：`.scratch/grill-round-85/readout-delta.mjs`（矩阵 `prereg-matrix.md`，输出档 `readout-output.json`，决策记录 `decision-record.md`）

## ⚠️ 下一轮必读 — 证据纹理异常（本轮最重要残余事实）

**NO-GO 的成因是装置级零数据，非「测得零增益」**：anysearch 臂 isolated+fanout 全程 `providersFailed=["anysearch"]`、臂列 n=0、`armInFanout=false`（57/57 格含对照层）；fused 命中由其余 provider 承载。携钥运行下该 provider 路径当日全程失效（R84 匿名跑曾见真臂数据+其后额度死，失败形态同构）。

- 已挂账：`defer-r85-anysearch-arm-providersfailed`（清障候选，owner anysearch-retriever）——**prefer-capable 问复活的前置**
- 已自认残余：prereg 声明#4 的 measured 操作化=腿级 JSON 可达性，未覆盖 provider 级失败形态——矩阵修订候选已入 ADR-0086 Consequences
- 候选根因方向（未坐实，清障轮查）：携钥 iso 路径/`ANS_PROVIDERS=anysearch` 名义匹配/上游 provider 当日失效

## 已完成

- **T0**：哨戒实录 `reports/2026-09-27-t0-watch.md`——dsh 钉版 rc.1 在役、upstream rc.2 已越龄期闸（无 rc.3+）、CI 三绿、#1764 OPEN 趋僵不代发、锐评第七轮四处方核账归档、WORKFLOW.md §4.2 第 9 次缺位核销
- **T1**：预注册件（矩阵全量：G0–G4/早停本体/四字段/2-of-4 封闭表/三设计声明+#4 操作化/功效 |Δ|≳0.4/单次终读条款）+确定性判读器（assert-corpus|selftest|readout；betacf 精确后验无 RNG）——**commit 先于读数**
- **T2**：runner 排序改动（对照前置探针+域轮询+PLAN 面+hadVerticalSpec，sampling 协议不变）；语料指纹 `7ac0a48e55cd7954` 跑前断言 PASS；降格件归档 `delta-2026-09-26.degraded.json` 不删；全量跑批一次跑成产新 `delta.json`
- **T3**：判读器单次终读→NO-GO；decision-record 全字段+operator/verified-by 签认栏（**pending human audit sign-off**）
- **T4**：registry 三联（r83 核销附判词 / r84 核销 / r85 新挂）；ADR-0086 立+index 入册（gen-adr-index --check 绿）；closeout-claims 10 条
- **验收面**：cli build ✓ / pack tgz ✓ / runner live ✓ / store 单测 78/78 ✓ / selftest 6/6 ✓

## 残留呈报

- `decision-record.md` operator/verified-by 字段留「pending human audit sign-off」——人签认未落
- dsh rc.2 已越龄期闸成合格候选：repin 裁决不属哨戒域，归独立票（上游家族重推导面见 R83 TE1 惯例）
- #1764 用户侧 OPEN 续挂不代发；ANYSEARCH_ENDPOINT 用户域未录未改
- 清障轮候场新增项=provider-failure 面（上节）；旧候场项（empty-endpoint/a03/a06/a08/engine coalesce/canonicalizeVertical/MCP 缩进/control 口径）承继不动

## 绿色 run URL

本栈未 push（规则：不 push 不 PR）——**PENDING — stack unpushed**。验收全为本地实录（命令+输出见 `reports/2026-09-27-report.md`）。承继基线 run（head_sha=栈基祖先 7c94622f 所在 push @2026-09-26T17:57Z）：

- https://github.com/Xxx91n/anysearch-cli/actions/runs/36260827764 —— ci success
- https://github.com/Xxx91n/anysearch-cli/actions/runs/36260827772 —— ship-gate success
- https://github.com/Xxx91n/anysearch-cli/actions/runs/36260827830 —— native-smoke success

## 下一轮候选

- **候选 A（若证据纹理反转预期）**：解 `defer-r85-anysearch-arm-providersfailed`（provider-failure 根因+修复）→ 之后 delta 腿才可测真臂，prefer-capable 问方能复活重读
- **候选 B**：清障轮（候场项集合+本轮新发 provider 面+矩阵声明#4 修订案）
- **候选 C**：征集下一轮主题

## suggested skills

implement / domain-modeling / neat-freak / research（atomcode-research，串行单飞）/ code-review / handoff；版本控制一律 `but`（gitbutler skill）
