# Round-85 → next-round 审计交接（audit window 出品）

Stack (primary key = GitButler change-ids; branch `r85-grill`, base `7c94622f`):
`rku`→`ool`→`wws`→`npv`→`qsw`→`kut`→`xrm`→+审计修复 commit（本档随修）。栈已 `but land` 至 main 并 push。

## 审计裁决：PASS（签核建议）；审计 findings 用户授权小修已落（本窗直修）

审计方式=不信自述、全部亲跑：build（tsup CJS 10.69MB+DTS）/ pack（0.0.8.tgz 3,541,504B）/ CLI 活测（--version→0.0.8、--help、ship-gate step8/8b/9 MCP initialize+冒烟+fail-open 全绿）/ store 78/78 / tsc clean / PLAN 排演（16 ctl 前置+41 sub 严格轮转，指纹不变）/ assert-corpus PASS / selftest 6/6 / **readout 副本复算→与 readout-output.json 除 artifact 路径外逐字节一致** / ship-gate 9/9 绿含 "closeout-claims r85: 10/10 re-derived green"。

裁决链核验：wws commit 12:47:49 → delta.json 生成 12:53:21 → qsw 13:00——commit 先于读数实证成立；判读器确定性复算成立（EL=0.1667=对称先验 1/6 理论值）。

## 三元组（审计-checklist §3）

- 发现 N=11（9 findings + 2 文档失真 nit；外加 2 条「一致但不可独立证明」声明）
- 修复 M=9（审计窗获用户授权直修小项，详见下）
- 遗留 K=2：finding 8（judge-call 级结构债，判读器升复用工件时再收）+ verified-by 人签认位（非 agent 代签）

## Findings 处置（逐条）

### Spec 轴（矩阵/账本注册项的缺漏与弱化）
1. ✅ 已修 per-domain/per-stratum 副列缺 `armHostHit on·off`：判读器 `side()` 补 `armHostHit{on,off}`（增量、闸序零改、selftest 6/6 复绿）；本轮数值经独立 post-verdict 提取补录 decision-record「审计勘误补录」段（readout-output.json 为锁定读件不再生——纪律遵守）。
2. ✅ 已修 `armInFanout` 存活率：判读器补 `armInFanoutSurvival` 顶字段；decision-record 补录实测值（处理层 0/41，含对照 0/53·0/57，4 无 spec 格结构性 null）。
3. ✅ 已修 功效注记 |Δ|≳0.4 补录 decision-record。
4. ✅ 已修 closeout-claims 注册矩阵阈值：+2 条 symbol 声明（prereg 文本钉版 9 token + 判读器实现常量钉版 8 token），10→12 条，本地全 token 命中复核绿。
5. ✅ 已修 CI 区间账本歧义：decision-record 勘误声明（判读权威归先于读数落盘的 D-002 矩阵；全 tied 下区间退化；启用区间须先修矩阵注册字段）。
6. ✅ 说明（非缺陷）：G1 诊断序落 id 列表——旗标未触发，空列表即缺失模式步的记录形，decision-record 已补说明。

### Standards 轴
7. ✅ 已修 readout-delta.mjs 死导入 `writeFileSync`/`tmpdir`。
8. ⏸ 遗留（judge call）：tally 重复/`finish()` 8 参/verdict 裸字符串——一次性脚本语境，判读器升复用工件时收，进清障轮候场。
9. ✅ 已修 `artifact` 字段改 `relative(ROOT,…)`（下轮生效；本轮锁定件不改）。

### 文档失真 nit（已修）
- ✅ report Stack 行→「7 commits：rku/ool/wws/npv/qsw/kut/xrm」、基→`7c94622f`（acaaccb3 失效说明随文）。
- ✅ 纹理措辞精确形已修 report + decision-record 勘误段双落（isoOn 53/53 排定格口径）。
- ✅ 附修：`mnarSuspect` ≥50% 阈值的未注册操作化在判读器内注释声明。

## 一致但不可独立证明（如实呈报）
- 「单次终读/无 peek」：时间链一致、无重读痕迹，属制度性声明。
- decision-record `verified-by` 仍 `pending human audit sign-off`——人签认位，非 agent 代签。

## 过程违规检查
零发现：commit 先于读数/无 p 值/INCONCLUSIVE 路径未启用（NO-GO 终局立 ADR 合规）/工件分级正确（决策件入库、delta.json+降格件 gitignore 本地通道）/ANYSEARCH_ENDPOINT 未录未代改/#1764 未代发/加权未碰/清障离面未碰/boy-scout 零搭车。

## 下一个 grill 方向指示

**推荐=清障轮**（承接 closeout 候选 B，吸并候选 A 作最高优先项）：
1. `defer-r85-anysearch-arm-providersfailed` 根因（携钥 iso 路径 / `ANS_PROVIDERS=anysearch` 名义匹配 / 上游当日失效三候选）——prefer-capable 问复活的前置，臂级测量不通则 delta 腿永远读装置零数据；
2. 判读矩阵声明#4 修订案（measured 操作化补 provider-failure 第三形态；findings 1–5 勘误已于审计窗修复落地）；
3. 旧候场项承继：empty-endpoint/a03/a06/a08/engine coalesce/canonicalizeVertical 边角/MCP 缩进/control 口径。

## suggested skills

implement / domain-modeling / neat-freak / research（atomcode-research 串行单飞）/ code-review / handoff；版本控制一律 `but`（gitbutler skill）。
