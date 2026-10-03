# Handoff — Grill Round 98 任务书（自造机检声明可机检 + R97 返工闭环 + 全栈清算续）

- 日期：2026-10-03 | slug：`grill-round-98`
- 上轮权威交接：`.scratch/grill-round-97/handoffs/round-97-audit-handoff.md`
- 上轮审计报告：`.scratch/grill-round-97/reports/2026-10-03-audit-report.md`（**先读这份**，含逐条证据）
- 上轮账本：`.scratch/grill-round-97/decision-ledger.md`（D-001~D-006）
- R97 任务书原件（存档）：`.scratch/grill-round-97/handoffs/round-97-task-book.md`

## §0 R97 审计结论（承上，下轮起点）

**验收电池全绿属实、零虚报**（check 8/8、build 5/5、test 13/13、真值表 357/0、E2E 270/0、8 包 tgz、ship-gate `REAL_GATE_EXIT=0` + green、CLI/MCP 测活、5 面适配器、memory-eval 126/126 —— 审计窗逐条亲跑复现）。
**但「D-001~D-006 全覆盖」被夸大**：T0/T6/T7 有 4 项未落，T3/T6 有装饰化弱化。

**分支态（2026-10-03 实测）**：`r97-selfcheckable` 已 push（`origin/r97-selfcheckable` = `a6c22612`），**未 land、未 PR、未 tag**。push 使收口件与审计交接件的 `unpushed` 声明失效，两处已按 R95 F5R 纪律重锚为 `unlanded stack` + `PENDING: pushed-no-branch-runs`（详见审计报告 §7）。审计工件另落三支：`r97-audit-loop1`(报告/交接/存档)、`r97-audit-reanchor`(收口件重锚，37 独有=当前最高栈顶)、`r98-grill-docs`(R98 任务书)。**未合并分支全账（14 分支 / 5 栈 / 43 commit 并集 / 可安全删除集合为空）见 §3。**

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
## §3 未合并分支全账（2026-10-03 实测，B 轨清算的唯一事实源）

### §3.1 结论先行：**可安全删除集合为空**

`git branch --merged origin/main` 实测仅返回 **`main`** 与 `gitbutler/target`。**R95/R96/R97/R98 无任何分支已合并进 main**，故「已合并 ⇒ 可安全删除」的集合**为空**。任何删除都会丢失未合并工作。本节把全部未合并面铺开，供 owner 裁量。

### §3.2 全分支台账（vs `origin/main` = `3642d494`，fetch 后实测）

| 分支 | SHA | 相对 main 独有 | 落后 main | 已 push | 已合并 main | 被谁包含 |
|---|---|---|---|---|---|---|
| `r95-grill-docs` | `1bad2667` | 1 | 0 | ✅ | ❌ | r96-grill-docs, r97-grill-docs, r98-grill-docs |
| `r95-audit` | `e9190d9a` | 1 | 0 | ✅ | ❌ | 仅自身（独立审计叶） |
| `r95-audit-loop2` | `9e406ee7` | 3 | 0 | ✅ | ❌ | 仅自身（独立审计叶） |
| `r95-exec` | `c089dd81` | **19** | 0 | ✅ | ❌ | r96-handoff-lint, r97-selfcheckable, r97-audit-reanchor |
| `r95-rework` | `7a540900` | 13 | 0 | ✅ | ❌ | **r95-exec, r96-handoff-lint, r97-selfcheckable, r97-audit-reanchor** |
| `r96-grill-docs` | `7454ba4b` | 2 | 0 | ✅ | ❌ | r97-grill-docs, r98-grill-docs |
| `r96-audit` | `1fdcf0ab` | 1 | 0 | ✅ | ❌ | r96-audit-loop2 |
| `r96-audit-loop2` | `464d6746` | 5 | 0 | ✅ | ❌ | 仅自身（独立审计叶） |
| `r96-handoff-lint` | `2ede90be` | **26** | 0 | ✅ | ❌ | r97-selfcheckable, r97-audit-reanchor |
| `r97-grill-docs` | `9eb35ea9` | 4 | 0 | ✅ | ❌ | r98-grill-docs |
| `r97-selfcheckable` | `a6c22612` | **36** | 0 | ✅ | ❌ | **r97-audit-reanchor** |
| `r97-audit-loop1` | `889123a0` | 1 | 0 | ✅ | ❌ | 仅自身（审计报告叶） |
| `r97-audit-reanchor` | `6579c672` | **37** | 0 | ✅ | ❌ | 仅自身（**当前最高栈顶**） |
| `r98-grill-docs` | `0967679d` | 5 | 0 | ✅ | ❌ | 仅自身（R98 任务书叶） |

全部 14 个分支 **均已 push 且 local/remote IN-SYNC**（无漂移），无 remote-only 悬挂 ref。
**未合并 commit 并集 = 43 个**（`origin/main..` 四个叶分支去重后）。`gitbutler/target` 落后 main 513、独有 0，非 land 候选。

### §3.3 栈结构（`but status` 实测，12 个 applied 分支 / 5 个栈）

```
r9  [r96-audit-loop2] ← 审计栈（含 r96-audit）
ud  [r96-audit]
di  [r95-audit-loop2] ← 审计栈（含 r95-audit）
it  [r95-audit]
ex  [r95-exec] ← 实现栈（19 独有）
ew  [r95-rework]          （被 r95-exec 完全包含）
ha  [r96-handoff-lint] ← 实现栈（26 独有）
se  [r97-selfcheckable] ← 实现栈（36 独有）
re  [r97-audit-reanchor] ← 实现栈（37 独有，已含 r97-selfcheckable 全链）
gr  [r98-grill-docs] ← grill-docs 栈（5 独有）
ri  [r97-grill-docs]
```

**关键事实**：`r97-audit-reanchor`(37) 已完整包含 `r97-selfcheckable`(36) —— 审计重锚 commit 叠在实现栈顶之上，land 时**以 `r97-audit-reanchor` 为栈顶即可覆盖全部 R97 实现+重锚**，不必单独 land 实现栈。

### §3.4 三类处置（owner 裁量，审计窗未执行任何一项）

| 类别 | 分支 | 事实依据 | 风险 |
|---|---|---|---|
| **A 冗余但不可安全删** | `r95-rework` | 相对 `r95-exec` 独有 **0**（`r95-exec..r95-rework` = 0），但相对 main 独有 13 | 删则丢 13 commit；R96 LOOP3 已实测 GitButler 工具面不可安全删除；R97 账本 D-004 明令「不裸删远端指针」→ **维持留置** |
| **B 审计叶（内容已被上层吸收或独立）** | `r95-audit`(1)、`r95-audit-loop2`(3)、`r96-audit-loop2`(5)、`r97-audit-loop1`(1) | 各含 1~5 个独立审计报告 commit，上层不包含（仅自身） | 这些是**审计证据**，删除即销毁历史审计记录；建议随栈 land 而非删除 |
| **C 实现栈（必须 land，不可删）** | `r95-exec`(19)、`r96-handoff-lint`(26)、`r97-selfcheckable`(36)、`r97-audit-reanchor`(37) | 全部未合并，是 R95~R97 全部交付物本体 | 删除=丢失三轮实现 |

### §3.5 若要真正清算，唯一路径是 land（须 owner 逐次授权）

1. `but land r97-audit-reanchor --whole-stack`（ff 形态）→ 覆盖 37 commit（含 R97 实现 + 重锚）；随后 `but pull` 回收已合流标签。
2. 依次 `but land r95-exec --whole-stack`（19）、`but land r96-handoff-lint --whole-stack`（26）。
3. 每次 land **立即使相关收口件/交接件的 `unlanded` 声明失效** → 必须按重锚仪式改述（`state: unlanded stack` → 改述；`PENDING: pushed-no-branch-runs` → 依 land 后真实拓扑改述）。本轮已演示该仪式（见审计报告 §7 与 `r97-audit-reanchor` commit）。
4. land 到 main 会**首次触发 `ci.yml`/`ship-gate.yml` 真实 run**（全仓 `on.push` 仅覆盖 `main`）—— 这是三态 GREEN 首次可兑现的路径。注意 ff-land 后 `origin/main..origin/<branch>` 为空 → 栈内 commit 集为空 → run-URL 字段仍只能 PENDING（ADR-0098 Known-Risk），GREEN 真兑现待 PR 拓扑。
5. `but land` 属 push origin/main 的外部授权动作，**未授权不执行**；本轮未执行。

### §3.6 其他开放项

- **GREEN 兑现**：三态 GREEN 至今无真实施跑证据（本仓 `ci.yml`/`ship-gate.yml`/`native-smoke.yml`/`release.yml`/`tau-python.yml` 的 `on.push` 均仅覆盖 `main`）。首个 land 后 closeout 应以 `GREEN:` 引用真 run。

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