# Handoff — Grill Round 98 任务书（自造机检声明可机检 + R97 返工闭环 + 全栈清算续）

- 日期：2026-10-03 | slug：`grill-round-98`
- 上轮权威交接：`.scratch/grill-round-97/handoffs/round-97-audit-handoff.md`
- 上轮审计报告：`.scratch/grill-round-97/reports/2026-10-03-audit-report.md`（**先读这份**，含逐条证据）
- 上轮账本：`.scratch/grill-round-97/decision-ledger.md`（D-001~D-006）
- R97 任务书原件（存档）：`.scratch/grill-round-97/handoffs/round-97-task-book.md`

## §0 R97 审计结论（承上，下轮起点）

**验收电池全绿属实、零虚报**（check 8/8、build 5/5、test 13/13、真值表 357/0、E2E 270/0、8 包 tgz、ship-gate `REAL_GATE_EXIT=0` + green、CLI/MCP 测活、5 面适配器、memory-eval 126/126 —— 审计窗逐条亲跑复现）。
**但「D-001~D-006 全覆盖」被夸大**：T0/T6/T7 有 4 项未落，T3/T6 有装饰化弱化。

**分支态（2026-10-03 实测）**：`r97-selfcheckable` 已 push（`origin/r97-selfcheckable` = `a6c22612`），**未 land、未 PR、未 tag**。push 使收口件与审计交接件的 `unpushed` 声明失效，两处已按 R95 F5R 纪律重锚为 `unlanded stack` + `PENDING: pushed-no-branch-runs`（详见审计报告 §7）。

## §1 正题建议：自造机检声明（第五形态）

R97 立了「自造**失效**声明」。审计发现的四个弱化项形态同型——**都在 ADR 里被写成机器约束，实现层却是装饰件**：

| 弱化项 | ADR 宣称 | 实现实际 |
|---|---|---|
| 注册表常量 `STATE_PREDICATE_REGISTRY` | 「扩表须改此常量」 | 全仓仅 1 处引用 = 自身声明，零消费方（S-5） |
| `reuse` 指针 | 「触发器实现变更须同步走扩表流程」 | 字符串无解析无校验，`grep '\.reuse'` 零消费（P-9） |
| ratchet 重批计数 | 「ratchet 可见的重批计数」 | 仅 `Number.isInteger` 校验，无 recount/无比对/无上表面（P-6） |
| 裸词英文枚举 | 「封闭枚举」 | `STATE_BARE_RES` 与 `STATE_PREDICATES` 双源硬编码，扩表漏改即漏扫（P-8） |

**正题建议**：把「声明某约束已被机器兑现」本身立法为可机检类别——**每个注册表条目必须存在真实消费方，否则 RED**（装饰件检测器）。这是「自造失效声明」的同族第五形态：**自造机检声明**（宣称有机器保障，实为散文）。

## §2 返工票（承 R97 审计，须先于 R98 正题实现）

| 票 | 内容 | 来源 |
|---|---|---|
| R1 | **S-1 假绿方向**：报告级全量扫对未采集分支出 GREEN → 应 env-PENDING | 审计 S-1 [HARD] |
| R2 | **S-2** 裸词扫描的代码 span/fence 豁免补断言 | 审计 S-2 [HARD] |
| R3 | **P-8** 裸词英文枚举单源化（否则扩表漏改即漏扫，违背 fail-closed 自指收敛） | 审计 P-8 |
| R4 | **P-9** `reuse` 指针加机器保障 | 审计 P-9 |
| R5 | **P-6** ratchet 补 recount 比对/上表面，否则 T3「ratchet」声明降格 | 审计 P-6 |
| R6 | **P-2** 收口清算义务「栈空 ∨ deferred 在册」补码，或把 D-002「可机检」降格为「流程条款」 | 审计 P-2 |
| R7 | **P-3** 形态二 PENDING 位挂接（ADR-0098 D5 写「以 PENDING 位挂接」但无码，立法与实现不符） | 审计 P-3 |
| R8 | **P-7** N5 放宽后误降级方向（符号开头 detail 行 → degraded → Stack 元素静默失效 fail-open） | 审计 P-7 |
| R9 | **P-1 已闭合**：`next-round.md` 已轮回覆写为本件，R97 任务书原件存档 `round-97-task-book.md` | 审计 P-1 |
| R10 | **P-5** CHANGELOG 按 feat/fix/docs 分行（errata 归 docs） | 审计 P-5 |

**返工完成判据**：R1~R8、R10 修完后**必须重跑同一套验收**（check 8/8、build 5/5、test 13/13、真值表 357/0、E2E 270/0、8 包 tgz、ship-gate `REAL_GATE_EXIT=0`+green、CLI/MCP 测活、5 面适配器断言、memory-eval 126/126）。**断言数应上升，不得为凑数删断言**（R96 审计 P5 教训）。
## §3 待 owner 裁量的开放项

1. **B 轨全栈清算**：实测 `git branch --merged origin/main` 仅返回 `main` + `gitbutler/target` —— **R95/R96/R97 无任何分支已合并进 main**（各分支 uniqueVsMain：r97-selfcheckable 36 / r96-handoff-lint 26 / r95-exec 19 / r95-rework 13 / r96-audit-loop2 5 …）。故「已合并可安全删除」集合**为空**。`but land r97-selfcheckable --whole-stack` 会连带 r96/r95 栈共 36 commit 一并 land，须 owner 拍板。
2. **r95-rework 处置**：相对 `r95-exec` 独有 0 commit（语义冗余），相对 main 独有 13。R96 LOOP3 已实测 GitButler 工具面不可安全删除；R97 账本 D-004 明令「不裸删远端指针」。维持留置。
3. **GREEN 兑现**：三态 GREEN 至今无真实施跑证据（本仓 `ci.yml`/`ship-gate.yml`/`native-smoke.yml`/`release.yml`/`tau-python.yml` 的 `on.push` 均仅覆盖 `main`）。首个 land 后 closeout 应以 `GREEN:` 引用真 run。

## §4 范围外（显式负向清单，沿用 R97 不扩展）

- 不重开评测矩阵修订、不动 r88 formally-declined、不追写已冻结 claims 工件、不做发布/tag。
- 活体谓词 `no-pr`/`unpublished` 仍只走 deferred 扩表示范票，不实现。
- `docs/adr` 权威档不入状态标记 lint 靶位（形态二地盘，防双重管辖）。
- 不裸删任何远端指针。
- gitbutler 技能文档缺口回写（`but land` 未收录）= 仓外 user 级文件，轮外 chore，须 owner 单独授权。

## §5 suggested skills

- R1~R8：`tdd`（成对 fixture）+ `diagnosing-bugs`（R1/R8 是方向性缺陷）。
- §1 正题：`domain-modeling`（类别立法）+ `to-spec`。
- 版本控制：`gitbutler`。
- 收口：`handoff`、`neat-freak`。

## §6 工件索引

- 判定核：`scripts/handoff-lint-verdict.mjs` | 壳：`scripts/handoff-lint-shell.mjs` | 门禁：`scripts/ship-gate.mjs`
- 单测：`packages/store/test/handoff-lint-verdict.test.mjs`（357 断言）/ `handoff-lint-e2e.test.mjs`（270 断言）
- fixtures：`packages/store/test/fixtures/handoff-lint/`（37 个，含 10 个 state-* 成对）
- ADR：`docs/adr/0098-architecture-grill-round-97-selfcheckable-declarations.md`（R97 立法）/ `0097-*.md`（含 Known-Risk 1 errata）
- 模板：`docs/agents/handoff-template.md` | registry：`docs/deferred-registry.json`
- 审计证据日志：`.scratch/audit-r97/{check,build,test2,gate2}.log`