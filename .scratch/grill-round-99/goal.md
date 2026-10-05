# Goal — Grill Round 99

- **正题：`anchor:vocab-guards` 扩域至全 `scripts/`**——与 T2 开放面扩表示范票合一，封闭扩表通道首演（扩域条目携证伪 fixture 准入表 = 自指钉①验收场；runner 对不可解析 probe 即 `anchor-unresolvable` RED）（D-001 正题）。
- **顺手段落（并入 T2 验收段，非平行正题）**：①「探针无孤儿」反向覆盖断言——probe 模块导出无孤儿探针；②三钉对抗演练一组——探针名伪造 → 坐席伪造等对抗路径逐条验证，结果具名呈报（D-001 / D-003 T2）。
- **残留轨沿账**：T0 CI 观测注记（HEAD b3ca0d51 三跑全绿）；`anchor:ratchet-recount` 坐席关票（零代码改动，单变量验收场先落）（D-001 / D-003 T0）。
- 唯一事实源：`.scratch/grill-round-99/decision-ledger.md`（D-001~D-003 全 current）。
- 单题性守恒：正题名义归 vocab-guards 扩域；顺手段落以 cohesive item 入 ADR 非平行正题（ADR-0029）。

## 范围外（抄 next-round §范围外，不扩展）

- 不重开评测矩阵 / 不动 r88 formally-declined / 不追写已冻结 claims / 不做发布-tag / 活体谓词仍只走 deferred / docs/adr 不入状态标记靶位 / 不裸删远端指针 / no-pr·unpublished 仍 deferred。
- B 残余（检测器自指第三轮）不作独立正题——已并入 T2 顺手段落，余量 R100 再议。
- `scripts/tau/` 子目录不入扫面域（顶层 glob 不递归）；递归入域留开放面后续票。
- 禁通用死代码检测 / 禁裸零引用出 RED / 禁注册表内封闭 modules 清单 / 禁代表模块抽样注入 / 禁 verdict 单点跨文件注册 / 禁锚腿自持守卫面（D-002 负向需求全沿用）。

## 风险登记（三件）

1. **扩域首抓真 RED 双红纪律**——扩域落地当轮预计首抓真 RED（3 个扫面外导出：`scripts/enforcement-anchors.mjs` 的 `ANCHOR_RED_CODES`/`ANCHOR_SKIP_CODES`、`scripts/eval-integrity-contract.mjs` 的 `SHIP_OVERRIDE_REASON_CODES`）；按 ADR-0099 Consequences 预写的双红解读纪律处理（先注册后合入，或作扩表 PR 自身验收断言），禁误读 flaky。
2. **受治面顶层零副作用立法**——glob + import 会执行扫面内 .mjs 顶层代码；无纪律则枚举器成新故障面。实现期立法项非约定俗成。
3. **vocab-registry 高摩擦 = 封闭通道设计意图**——注册表高摩擦（新词表须改门禁代码）是设计意图（ADR-0099 Known-Risk 1 缓解同构），非可用性缺陷。

## T0 执行窗状态（2026-10-05 实测）

- 本轮无 push/land（owner 授权窗未开）；VC 全走 GitButler，分支 `r99-vocab-expansion` 与 `r99-grill-ledger` 并行互不影响。
- 单变量基线：`node scripts/ship-gate.mjs` 在扩域混杂变更前的干净面复跑，日志见报告证据段（本地路径 + 具名申报）。
- 坐席关票：`defer-r98-anchor-ratchet-recount-seat` status→closed（零代码改动），探针升全量 kill 判定。

no-changelog-entry: r99 簿记件随 T3 落地（CHANGELOG r99 节 feat/fix/docs 分行=R10 合规自证），pre-land 闸门先于簿记
