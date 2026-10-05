<!-- state: unlanded r99-grill-ledger @ 2026-10-05 -->

# Handoff — Grill Round 99 → R99 实现轮任务书（正题：anchor:vocab-guards 扩域至全 scripts/）

- 日期：2026-10-05 | slug：`grill-round-99`
- **唯一事实源**：`.scratch/grill-round-99/decision-ledger.md`（D-001~D-003 全 current）
- 上轮收口：`.scratch/grill-round-98/handoffs/round-98-closeout.md`（dissolved 重锚完成）
- 审计交接：`.scratch/grill-round-98/handoffs/round-98-audit-handoff.md`（R100 候选三题在案）
- R98 立法：`docs/adr/0099-architecture-grill-round-98-fifth-morphology.md`

## §0 执行纪律（沿账）

- 全部 VC 走 GitButler（`but`）；push/land 须 owner 授权，范围外不扩权。
- 判定核纯净 / 薄壳不写判定 / 正反成对 fixture / fail-closed / 断言数只升不降。
- 立法先于实现 commit（Legislated-Before-Asserted）；每票收口前自对账覆盖 D 条，发现账本偏离须具名申报不静默。
- 数据源纪律：实现唯一依据=本伦账本，不从对话回忆补结论；账本未载的结论停下申报。
- 本任务书文首 state 标记在 land 后即失效——按重锚仪式改述（理由+审计+reauthored 计数）。

## T0 — 定锚 + 残留轨两票【覆盖 D-001 残留轨 + D-003 T0】

1. `.scratch/grill-round-99/goal.md` 落盘：正题名义（vocab-guards 扩域至全 scripts/）+ 范围外清单（本文末节）+ 风险登记三件——扩域首抓真 RED 双红纪律 / 受治面顶层零副作用立法 / vocab-registry 高摩擦=封闭通道设计意图。
2. **CI 观测注记**（R99 任务书 T0 残余闭环）：HEAD `b3ca0d51` 三跑已全绿——ci run 37195788023（4m28s）/ native-smoke 37195787979（49s）/ ship-gate 37195787971（6m57s）；前序 ship-gate 47s 红=自失效声明被抓的 fail-closed 实证。`GREEN:` run-URL 引用仍受 PR 拓扑边界约束，沿账不扩展。
3. **`anchor:ratchet-recount` 坐席关票**：前置 `node scripts/ship-gate.mjs` 复跑绿 → deferred registry `defer-r98-anchor-ratchet-recount-seat` status→closed → 探针升全量 kill（零代码改动）。**单变量验收场先落**——基线须在扩域混杂变更前的干净面上记录，否则 RED 归因不可分。证据 = 本地船闸日志路径 + run-URL 兑现不了时降级具名申报（本轮无 push/land）。

## T1 — 立法包【覆盖 D-001 正题定界+否决项+边界 / D-002 全部 / D-003 T1】

先于一切实现 commit 落盘：

- **ADR-0100 单件**，六个 Decision 条目：D1 正题定界与开放面扩表示范票合一 / D2 注册架构（vocab-registry 纯数据叶+逐模块分组+寄居判定核禁令）/ D3 扫面枚举（glob 顶层+封闭排除清单判据「无法命名空间注入」+顶层零副作用立法+漂移 info 降级）/ D4 证伪形态（逐模块注入同枚举面）/ D5 接口变更 `(ns,registry)` / D6 边界负向需求。
- **ADR 内必预写两块**：①扩域首抓真 RED 解读纪律（先注册后合入 / 作扩表 PR 自验收断言——立法=预写故障解读手册非发执照）；②四级迁移阶梯固化（1 registry additive 新建 → 2 签名泛化 `registry ?? 默认表` 向后兼容 → 3 CODE_GROUPS 迁出+消费点 blast-radius → 4 glob 枚举上线——**4 必须在 3 后**，半迁移态被枚举器执行顶层代码=不可归因 RED）。
- **CONTEXT「Grill Round 99 — Terms」词条区** ~7 条：Vocabulary Registry / Governed Scan Surface / Closed Exclusion List / Per-Module Falsification / Top-Level Zero-Effect Surface / Probe-Orphan Coverage / Three-Pin Adversarial Drill。

## T2 — 正题实现【覆盖 D-001 正题+顺手段落 / D-002 全部 / D-003 T2】

分支 `r99-vocab-expansion`，四级迁移阶梯按序执行：

1. `scripts/vocab-registry.mjs` 新建（纯数据叶：零 import、`Object.freeze`、逐模块分组 `{verdict, anchors, evalIntegrity, ...}`）；
2. `unregisteredCodeExports(ns)` → `(ns, registry)` 签名泛化（`registry ?? 默认表` 向后兼容，与 `env.registry` 参数化同构）；
3. CODE_GROUPS 迁出 verdict.mjs + `isKnownCode`/`unregisteredCodeExports` 全消费点 blast-radius 核对（破坏性一刀，可独立 revert）；
4. 薄壳 glob `scripts/*.mjs` 顶层（不递归，tau/ 不入域）→ 动态 import() 命名空间数组 → 纯核逐模块断言；封闭排除清单判据=「无法命名空间注入的文件」；
5. `probeVocabGuards` 逐模块改写 + 新证伪 fixture（每模块注入假导出断言点名；kill=每模块失真皆被抓 ∧ 真实导出零 finding）；
6. 三扫面外导出（`ANCHOR_RED_CODES`/`ANCHOR_SKIP_CODES`/`SHIP_OVERRIDE_REASON_CODES`）入册分组——先注册后合入，或作扩表 PR 自验收断言（双红纪律指定通道）；
7. 锚表 `anchor:vocab-guards` 条目 constraint/subject 描述更新为扩域语义。

**顺手段落并入本票验收段**（账目在 ADR 仍独立条目，自指钉①要求断言与消费面同 PR）：「探针无孤儿」反向覆盖断言 + 三钉对抗演练一组（探针名伪造→坐席伪造等对抗路径逐条验证，结果具名呈报）。验收电池复跑，断言数只升不降。

## T3 — 簿记【覆盖 D-003 T3】

- CHANGELOG r99 节 feat/fix/docs 分行（沿 R10 合规范式）；
- deferred registry 两票关闭：`defer-r98-anchor-open-surface-demo`（随扩域落地）/ `defer-r98-anchor-ratchet-recount-seat`（随 T0）；形态二 ratchet / no-pr / unpublished 沿账不动；关票证据=可复跑机器证据（本地门日志路径），无 run-URL 时降级具名申报；
- ADR index 再生成（0100 收录=全 100 件）——**必须在收口落盘前**（closeout-coverage 双向一致先例 defer-r71-shipgate-1g）；
- AGENTS.md 顶层零副作用摘要**只指向 ADR-0100 不复述全文**（防立法条目双落点漂移，ADR-0072 先例）。

## T4 — 收口【覆盖 D-003 T4】

轮报 + closeout（claims 用 verbatim 自证）+ R99→R100 `next-round.md` 轮回覆写 + 三态骨架（全绿 / 降格 / F-bug 承接）+ clearing 核验（栈空∨deferred 在册）+ land 后声明重锚核验。

## 范围外（沿账不扩展）

- 不重开评测矩阵 / 不动 r88 formally-declined / 不追写已冻结 claims / 不做发布-tag / 活体谓词仍只走 deferred / docs/adr 不入状态标记靶位 / 不裸删远端指针 / no-pr·unpublished 仍 deferred。
- B 残余（检测器自指第三轮）不作独立正题——已并入 T2 顺手段落，余量 R100 再议。
- `scripts/tau/` 子目录不入扫面域（顶层 glob 不递归）；递归入域留开放面后续票。
- 禁通用死代码检测 / 禁裸零引用出 RED / 禁注册表内封闭 modules 清单 / 禁代表模块抽样注入 / 禁 verdict 单点跨文件注册 / 禁锚腿自持守卫面（D-002 负向需求全沿用）。

## Suggested skills

- `gitbutler`（全部 VC；push/land 须 owner 授权）
- `domain-modeling`（ADR-0100 + CONTEXT 词条区）
- `tdd`（探针/fixture 先行，正反成对）
- `code-review`（破坏性重构与扩域复审）
- `neat-freak`（收口知识清点）
- `handoff`（R100 任务书生成）

## 工件索引

| 工件 | 路径 | 落票 |
|---|---|---|
| 账本 | `.scratch/grill-round-99/decision-ledger.md` | 已入库（r99-grill-ledger：lmo/lqu/oqp） |
| goal 定锚 | `.scratch/grill-round-99/goal.md` | T0 |
| 立法 | `docs/adr/0100-*.md` + `docs/adr/index.md` | T1/T3 |
| 注册表 | `scripts/vocab-registry.mjs` | T2 |
| 探针改写 | `scripts/enforcement-anchor-probes.mjs` | T2 |
| 锚表 | `docs/enforcement-anchors.json` | T2 |
| deferred | `docs/deferred-registry.json` | T0/T3 |
| 簿记 | `CHANGELOG.md` / `AGENTS.md` | T3 |
| 收口 | `.scratch/grill-round-99/handoffs/round-99-closeout.md` + next-round.md | T4 |
