# Grill Round 98 审计 LOOP1 复核报告 — PASS（两阻断真修复；残留已于 LOOP1.5 清零）

- 日期：2026-10-04 | 审计窗：独立复核（只出报告，不动手修）
- 复核对象：LOOP1 返修 commit `sml`（`r98-anchor-detector`，git `5362be96`，9 files +131/-35，工作树净）
- 前置件：`reports/2026-10-04-audit-report.md`（LOOP0 CONDITIONAL FAIL 两阻断）

## §0 结论

**两阻断均为真修复非采信自述**：结构、行为、证据三面逐一亲验（§1）。次要项除 N6 半修外全部兑现。断言只升：真值表 444→**445/0**、E2E 360→**363/0**（本窗实跑）。全量船闸本窗复跑 `REAL_GATE_EXIT=0` + green（check/test/build/8 包/126 eval/MCP 测活全过），`report.json` 现含 `step_1_6_enforcement_anchors` **7 条结果**（原 0）。原残留 3 项（§3）：R-1/R-2 已按 owner 指示本窗闭环（§6，断言只升 E2E 363→368），R-3 为合规观察项。

## §1 阻断复核（声明 → 证据 → 结论）

| # | 返修声明 | 审计亲验证据 | 结论 |
|---|---|---|---|
| F-1a | 裸块→`stepEnforcementAnchors()` 注册 | `ship-gate.mjs:1248-1254` 函数化（`reportStep("step_1_6_enforcement_anchors")` + `step 1j/9` banner，自标式同 stepValidateDomains 先例）；IIFE 调用点在 `stepValidateDomains()` 后（`:2114`）、`--quick` 分支外——每次 run 必跑 | ✅ |
| F-1b | usage-error 顺序回归 | 本窗实跑 `node scripts/ship-gate.mjs --override`（缺 reason）：usage error **先行**、零探针输出（原抢跑 6 行） | ✅ |
| F-1c | report.json 证据面 | 本窗全量实跑后读 `.ship-gate/report.json`：`step_1_6_enforcement_anchors` 在列、7 条结果（banner+5 锚+汇总），exit=pass | ✅（注：§4b 写「6 行」，实测 7——见 R-2） |
| F-2a | 空表/缺键 fail-closed | `loadAnchorRegistry` 非数组→`anchors:null`；`!Array.isArray \|\| length===0` → `anchor-registry-empty`（`:89-105`） | ✅ |
| F-2b | 真实文件级反演 | 本窗建 temp root 三例：`{}`→`anchor-registry-empty`（no array）；`{"anchors":[]}`→`anchor-registry-empty`（empty list）；文件缺席→`anchor-registry-unreadable`——三形分流各中其码 | ✅ |
| F-2c | E2E 第五格 | `handoff-lint-e2e.test.mjs:402-408` emptyArr+noKey 双形 + 码断言 | ✅ |

## §2 次要项复核

| # | 声明 | 证据 | 结论 |
|---|---|---|---|
| N1 | 前检排除注册表自身 | `enforcement-anchors.mjs:53,70` `path.resolve(p)===registryFile` 跳过——结构性死亡解除（自证引用不再计） | ✅（残余语义弱化：docs 散文引用仍计，info-only 可接受） |
| N2 | unregisteredCodeExports 生产单源 | `verdict.mjs:150-160` 生产导出；探针消费失真命名空间 + 真值表 `:141` 消费实模块（+1 断言=445） | ✅ |
| N3 | PROBE_TABLE 删除 | diff 确认整块移除，grep 零残留 | ✅ |
| N4 | dissolved 补 branchRefs 交叉校验 | `verdict.mjs:590-611`：members=null+ref 在场→conflict（语义复核：dissolved 宣称 ref 缺席，ref 在场即矛盾，与成员可读性无关——非误红）；ref 缺席→GREEN；未采集→PENDING 不变。生产采集器 `stackBranchMembers`/`branchRefs` 写入关系复核无新洞 | ✅ |
| N5 | fixture 元数据 | name/description 更正为 bare-word 本义 | ✅ |
| C7 | CHANGELOG `### Deferred` + 三新票 | r98 节 Deferred 子节三票在列；Docs 条「三新票」更正；Fixed 条补 LOOP1 返修行 | ✅ |
| N6 | ANCHOR_RED_CODES/ANCHOR_SKIP_CODES 封闭码 | 常量已立（`enforcement-anchors.mjs:28-34`）且 msg 均携码——**但全仓 grep 除声明处外零消费**（发射仍字面量、无 emitCode 类守卫、无测试断言常量本体）；另此二 `*_CODES` 导出落在 vocab-guards 探针扫描域（仅 verdictModule）之外——同族弱化半修 | ⚠️ **半修→残留 R-1** |
| N7 | `[pending-anchor]` 统一 / floor 160→350 / ratchet 探针锚定 BEGIN ADR-INDEX | 输出实测 `[pending-anchor]`；e2e `passed > 350`；探针 good-case 改锚 `docs/adr/index.md` `<!-- BEGIN ADR-INDEX`（契约面，生产耦合解除） | ✅ |

## §3 残留（不阻断，具名呈报）——LOOP1.5 已闭环

- **R-1（弱化）→ 已闭**：`ANCHOR_RED_CODES`/`ANCHOR_SKIP_CODES` 原零消费（发射字面量、无守卫、无断言），N6 半修例。本窗按处置建议最小消费闭环——发射端 8 处码 token 全部改引用常量表（`enforcement-anchors.mjs:36-39` 解构），e2e §N 补「每 RED 行必携 `ANCHOR_RED_CODES` 注册码」断言（5 轮逐轮断言）。`*_CODES` 守卫扩域（scripts/ 全目录）仍留 R99/R100 扩表候选（衔接 `defer-r98-anchor-open-surface-demo`）。
- **R-2（文档级）→ 已闭**：轮报 §4b「6 行」更正为 7；§4c 补写（返修后全量船闸实跑证据段）。
- **R-3（观察）**：`--quick` 亦执行锚腿（在 quick 分支外注册）——与 D-003「每次 run 常数级成本」一致，合规非缺陷。

## §4 验收电池复跑（本窗独立，不信返修自述）

| 项 | 实测 |
|---|---|
| 真值表 | **445 passed, 0 failed** |
| E2E | **363 passed, 0 failed**（断言只升 360→363） |
| ship-gate 全量 | **exit 0 / ship gate green**（check/test/build/tgz/smoke/eval 126/MCP 全过；report.json 锚腿 7 条） |
| 锚腿独立 | 5/5 consumer-verified；`[pending-anchor]` 统一 |
| `--override` | usage error 先行，零探针输出 |
| 空表反演 | `{}`/`[]`/缺件三形 → 对应码 fail |

## §5 判定

**PASS**（先例 R96 LOOP2「PASS/阻断真修复+文档级残留」同格）。R-1/R-2 已按 owner 指示在本窗直接闭环（小项直接修——§3），无遗留阻断或可移交缺陷；唯一结转项为 R-1 衍生候选「`*_CODES` 守卫扩域」——非缺陷，是开放面扩表的天然首张票（已挂 `defer-r98-anchor-open-surface-demo`）。

## §6 LOOP1.5 残留闭环（2026-10-04，owner 指示「小问题直接修复」）

| 项 | 修法 | 证据 |
|---|---|---|
| R-1 | 发射端解构常量表（`CODE_UNREADABLE/EMPTY/UNRESOLVABLE/NOT_CONSUMED/PENDING_ANCHOR`）替换全部字面量；e2e §N 补携码守卫断言 ×5 | `enforcement-anchors.mjs:36-39` + 全部 msg 引用；`handoff-lint-e2e.test.mjs:410-417` |
| R-2 | 「6 行」→7；§4c 补写 | `2026-10-04-report.md` §4b/§4c |

修复落 `r98-anchor-detector`（新 commit），电池复跑见 §4 同项（断言只升 E2E 363→368）。

— 审计窗原只出报告；§6 闭环改动经 owner 明示授权（「小问题直接修复」），与 §1~§4 复核证据一并入账。
