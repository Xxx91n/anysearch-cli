# Handoff — Grill Round 97 → R98（执行轮收口交接；ADR-0098 可机检类别首件）

Stack（dissolved @ 2026-10-03）—— 交付栈已 ff-land 上 `origin/main`（`but land r97-audit-reanchor --whole-stack`，ref 与但 ID 随 land 注销），链为 capture 时值，留作历史定位不再作但 ID 解析；本栈叠于 `r96-handoff-lint` 之上（R96 实现栈顶）；**未 PR、未 tag**；8 个 commit 无 amend：
r97-selfcheckable → upo (`b67ddbc8` @ 2026-10-03) → pnq (`f923be49` @ 2026-10-03) → spu (`5280704f` @ 2026-10-03) → vrt (`7b28eca7` @ 2026-10-03) → xvw (`fe87e8a4` @ 2026-10-03) → lop (`fb312b97` @ 2026-10-03) → lsz (`f2776a0f` @ 2026-10-03) → krl (`1aedaee3` @ 2026-10-03)

<!-- state: no-branch-runs r97-selfcheckable @ 2026-10-03 -->
<!-- re-anchor: 2026-10-03 owner 授权 push 后，原标记 `state: unpushed r97-selfcheckable` 立即失效（R95 F5R 纪律）。ref 已存在，故原谓词不再为真；按重锚仪式改述为「未 land」谓词（unlanded），该谓词当前仍为真：origin/main..origin/r97-selfcheckable 非空（36 commits 实测）。reauthored=1。 -->
<!-- re-anchor: 2026-10-03 owner 授权 B 轨逐栈 land，本栈随 r97-audit-reanchor 栈 ff-land 上 main，land 即删 `origin/r97-selfcheckable` ref。两处声明当场失效：①`unlanded` 标记——ref 删除使成员集不可读（env-PENDING），且谓词语义上已不成立（栈已合流），改述为 `no-branch-runs`（谓词实测为真：全仓 `on.push` 仅覆盖 `main`，该分支无 `pull_request`/`workflow_dispatch` 之外的可达 run 面）；②run-URL 码 `pushed-no-branch-runs`——ref 不存在即 `declaration-fact-conflict`，改述为 `stack-unpushed`（谓词实测为真：origin 无此 ref）。reauthored=2。 -->

## 已完成

R97 正题 A（自造失效声明可机检类别）实现闭环，B 轨（分支清算）仅预检未执行（land 需 owner 授权）：

- **T0**：`goal.md` 定锚 + B 轨预检（`zz` clean、`origin/main` = `3642d494` 零新增）；`but land` 未获授权未执行。发现：工作区为 5 栈而非单 lane，B 轨 `land --whole-stack` 语义待 owner 重裁。
- **T1**：ADR-0098 立法 + CONTEXT 10 词条 + 登记表常量（每词表项核验谓词/失效触发/环境需求/reuse 指针）。
- **T2**：形态一状态腿（单行标记解析 + 裸词扫描 + 三离线谓词 + 判定集成）+ 10 成对 fixtures + 自移靶位 + 报告/门禁两速分权；真值表 310→357、E2E 207→270。
- **T3**：claims 新增 `verbatim` kind（整句字节级 + 理由 + 重批计数）+ R97 首批 dogfood 双锚（门禁复验 2/2 绿）。
- **T4**：N5 修法（标记类放宽为单个非空白非制表符号 + 未知形状整体降级）+ E2E 三 glyph 全集 + ADR-0097 Known-Risk 1 原条目 errata。
- **T5**：模板状态声明位（语法家）+ ADR-0098 形态二内容规则全文。
- **T6**：CHANGELOG r97 节 + deferred 双票 + 收口条款 + ADR-0098 回填 + ADR 索引 98。

回归锁：真值表 357 断言 + E2E 270 断言 + 全量 `turbo run test` 13/13 任务绿；ship-gate 除收口覆盖外全腿绿（本件即补齐该缺口）。断言数为覆盖面证据，不等于正确性。

## 绿色 run URL（必填）

PENDING: stack-unpushed — 2026-10-03 owner 授权 B 轨逐栈 land，本栈随 `r97-audit-reanchor` `--whole-stack` ff-land 上 `origin/main`，land 即删 `origin/r97-selfcheckable` ref —— 「无 origin ref」实测为真。GREEN 仍物理不可兑现：ff-land 后 `origin/main..origin/r97-selfcheckable` 为空，栈内 commit 集为空，任何被引 run 的 `head_sha` 成员检查不可满足（ADR-0098 Known-Risk 5；R98 goal.md 风险②），真 GREEN 兑现待 PR 拓扑。改述史：本行最初为 `PENDING: stack-unpushed`（未 push）→ push 后改述 `pushed-no-branch-runs` → land 后再次改述回本码（ref 已删、谓词实测为真）。

## 下一轮候选

1. **B 轨清算（owner）**：5 栈现状下 `but land r96-audit-loop2 --whole-stack` 只收单栈；全栈 land 顺序与 `r95-rework` 回收须 owner 重裁。land 后本件两处声明同时失效，须改述。（已于 2026-10-03 执行：六段按授权序全 land，两处声明按重锚仪式改述，见文首 re-anchor 注记 #2。）
2. **GREEN 兑现观察**：三态 GREEN 仍无真实施跑证据；首个 land 后 closeout 应以 `GREEN:` 引用真 run。
3. **扩表示范票**（deferred 在册）：`no-pr`/`unpublished` 首张扩表即闭环验收。
4. **形态二 ratchet**（deferred 在册）：PENDING 位收敛后升 RED。

## Known risks / deferred

- **本分支叠在 `r96-handoff-lint` 之上**：实现依赖 R96 实现栈；B 轨 land 重排须带本栈重基。
- **CI 恒为 env-PENDING**（设计内非阻断）：监控锚＝`[skip]` 行计数异常升高。
- **deferred 双票在册**：形态二 ratchet 票 + 扩表示范票（`docs/deferred-registry.json`）。收口机械条目：栈空 ∨ deferred 在册——本轮以后者收口。
