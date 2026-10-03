# Handoff — Grill Round 97 → R98（执行轮收口交接；ADR-0098 可机检类别首件）

Stack（primary key = GitButler change-ids；SHA 为 capture 时值，time-lagged）：
r97-selfcheckable → upo (`b67ddbc8` @ 2026-10-03) → pnq (`f923be49` @ 2026-10-03) → spu (`5280704f` @ 2026-10-03) → vrt (`7b28eca7` @ 2026-10-03) → xvw (`fe87e8a4` @ 2026-10-03) → lop (`fb312b97` @ 2026-10-03) → lsz (`f2776a0f` @ 2026-10-03) → krl (`1aedaee3` @ 2026-10-03) —— 本栈叠于 `r96-handoff-lint` 之上（R96 实现栈顶）；**已 push、未 land、未 PR、未 tag**（owner 授权后 2026-10-03 push，`origin/r97-selfcheckable` = `a6c22612` 实测存在）；8 个 commit 无 amend，SHA 为初写时值；权威值以 `but log r97-selfcheckable` 为准

<!-- state: unlanded stack @ 2026-10-03 -->
<!-- re-anchor: 2026-10-03 owner 授权 push 后，原标记 `state: unpushed r97-selfcheckable` 立即失效（R95 F5R 纪律）。ref 已存在，故原谓词不再为真；按重锚仪式改述为「未 land」谓词（unlanded），该谓词当前仍为真：origin/main..origin/r97-selfcheckable 非空（36 commits 实测）。reauthored=1。 -->

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

PENDING: pushed-no-branch-runs — `origin/r97-selfcheckable` 的 ref **存在**（owner 授权后 2026-10-03 push，`git rev-parse --verify refs/remotes/origin/r97-selfcheckable` = `a6c22612` 实测），但本仓 `.github/workflows` 的 `on.push` 仅覆盖 `main`（ci.yml / ship-gate.yml / native-smoke.yml / release.yml / tau-python.yml 均为 `branches: [main]`），特性分支 push 不产出任何 run —— 故「本轮 run URL」在特性分支上物理不可得（ADR-0097 F8-c 谓词，门禁离线自证）。取得本轮 run 须 land 到 `main` 或开 PR。**本行原为 `PENDING: stack-unpushed`（审计窗当时未 push），push 后立即失效并按 R95 F5R 纪律改述**——与 R96 四处改述同型。

## 下一轮候选

1. **B 轨清算（owner）**：5 栈现状下 `but land r96-audit-loop2 --whole-stack` 只收单栈；全栈 land 顺序与 `r95-rework` 回收须 owner 重裁。land 后本件两处声明同时失效，须改述。
2. **GREEN 兑现观察**：三态 GREEN 仍无真实施跑证据；首个 land 后 closeout 应以 `GREEN:` 引用真 run。
3. **扩表示范票**（deferred 在册）：`no-pr`/`unpublished` 首张扩表即闭环验收。
4. **形态二 ratchet**（deferred 在册）：PENDING 位收敛后升 RED。

## Known risks / deferred

- **本分支叠在 `r96-handoff-lint` 之上**：实现依赖 R96 实现栈；B 轨 land 重排须带本栈重基。
- **CI 恒为 env-PENDING**（设计内非阻断）：监控锚＝`[skip]` 行计数异常升高。
- **deferred 双票在册**：形态二 ratchet 票 + 扩表示范票（`docs/deferred-registry.json`）。收口机械条目：栈空 ∨ deferred 在册——本轮以后者收口。
