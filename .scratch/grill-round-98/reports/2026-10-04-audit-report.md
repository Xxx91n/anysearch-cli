# Grill Round 98 审计报告 — CONDITIONAL FAIL（2 项阻断返工 + 7 项次要）

- 日期：2026-10-04 | 审计窗：独立复核窗口（只出报告，不动手修）
- 审计对象：`.scratch/grill-round-98/reports/2026-10-04-report.md` + `handoffs/round-98-closeout.md` + 实现栈 `r98-anchor-detector`（but-commit 集 `186e3f10`…`249f0a80`，merge-base = `5eba7ca0` = origin/main）
- 唯一事实源对账：`.scratch/grill-round-98/decision-ledger.md`（D-001~D-004）+ `goal.md` + `.scratch/grill-round-97/handoffs/next-round.md`（R98 任务书）

## §0 结论先行

**轮报自述全绿属实、零虚报**——硬验收电池逐条亲跑复现一致（§1）。但双轴评审与逐条核对命中 **2 项阻断级缺陷**，均落在正题自身产物上且属本形态自指实例：

1. **F-1【阻断】enforcement-anchors 腿未注册为 step——模块顶层裸块执行**。实证三重：(a) 代码：`scripts/ship-gate.mjs:1246-1250` 为顶层裸块，不在任何 `step*` 函数内、不在 IIFE 调用序列（`:2095-2136`）；(b) 行为：`node scripts/ship-gate.mjs --override`（缺 reason 应直接 exit 2）实测先完整跑完锚腿 6 行输出才打印 usage error——锚腿在模块求值期先于参数校验、先于 `reportStep("step_0_invariants")` 执行；(c) 证据：本轮全新 report.json（finished 2026-10-04T03:24:29Z，exit=pass）`entries` 中锚腿结果 **0 条**——`report()` 的 `currentStep===null` 守卫把该腿全部结果丢弃，L1 证据契约（ADR-0021 D4「collect every report entry」）在通过路径上即违约；锚 RED 路径 `fail()` 会写出 `entries:[]` 的空证据文件。D-003「与 lint 腿平级注册」字面条文未兑现（无 step* 函数 / 无 reportStep / 无 step N/9 banner / 注释自标 `1h` 与 stepReadmeParity「step 1h/9」撞号）。轮报 §4 自报的 `exitIfCoverageRed` 崩溃修复只归位了被吞并的 `}`，腿本体仍错置——修复验证只看了退出码与 E2E，未看宿主结构契约。

2. **F-2【阻断】锚注册表空表/畸形即 vacuous pass——fail-open**。`scripts/enforcement-anchors.mjs:28` `Array.isArray(reg.anchors) ? reg.anchors : []`：`{"version":1}`（缺 anchors 键）或 `anchors:[]` → 「0/0 anchors consumer-verified」`exitKind=pass`。仓内先例是同型硬约束：`closeout-claims` 零条目 = fail（「surface must be non-vacuous」，ship-gate.mjs:790）、`governedListViolation` 空表即违例。检测器被「清空表」即可整体退役——正是本形态要杀的装饰声明（宣称有检测、实为空转）。E2E 自身失效覆盖四格（unresolvable/不杀/坐席/不可读）独缺「空表」格。

次要发现与过程观察见 §4/§5；D-001~D-004 逐条核对见 §3。

## §1 硬验收亲跑结果（不信自述，逐项复现）

| 项 | 轮报声明 | 审计实测 | 结论 |
|---|---|---|---|
| 真值表 | 444/0 | `node packages/store/test/handoff-lint-verdict.test.mjs` → **444 passed, 0 failed** | ✅ |
| E2E | 360/0 | `node packages/store/test/handoff-lint-e2e.test.mjs` → **360 passed, 0 failed** | ✅ |
| 断言数只升 | 357→444 / 270→360 | 基线 357/270（R97 审计已验）→ 现 444/360；中间档 `git archive 500fd30f` 重放 E2E=**351**——ADR「351→360」= T3 增量、轮报「270→360」= 全轮增量，两数同真不矛盾 | ✅ |
| ship-gate | REAL_GATE_EXIT=0 + green | 本窗实跑 `node scripts/ship-gate.mjs` → **exit 0 / ship gate green** | ✅ |
| 锚腿 | 5/5 consumer-verified | 独立调用 `runEnforcementAnchors` → 5/5（ratchet-recount [info][pending-seat] verified early） | ✅ 数值；⚠️ 见 F-1 证据缺席 |
| check/test/build | 8/8、13/13、5/5 | report.json step_2_turbo pass=3（三 turbo 命令全 exit 0） | ✅ |
| 8 包 tgz | pack+shape+smoke+dual | 输出可见 8 包全 pass + `npm install --prefix smoke ok` + peer-optional dual-install | ✅ |
| memory-eval | 126/126 | 输出可见 `126/126 PASS, fingerprint=4a529f6fbe2096c8` | ✅ |
| CLI/MCP 测活 | pass | `MCP initialize: server=anysearch v0.1.0` + observation round-trip + fail-open boot | ✅ |
| handoff-lint | 1G/3P | report.json：`1 GREEN / 3 PENDING across 4 closeout doc(s)`；r98 件 `PENDING {run-url:stack-unpushed \| stack:ref-unavailable}` 与自述一致 | ✅ |
| closeout-coverage | 23/23 @76 | report.json：`23 registered / 23 completed round(s) at floor 76` | ✅ |
| deferred 票 | 三新票 entries 48 | `entries=48`、末四枚 = defer-r97-demo + 三枚 r98 新票；`pending_anchors=["anchor:ratchet-recount"]`、`pending_predicates=["no-pr","unpublished"]`、`covers=["r98-anchor-detector"]` | ✅ |
| B 轨 land | origin/main 3642d494→5eba7ca0 | `git log origin/main` 顶=5eba7ca0（r95-audit 件，六栈 land 序与 D-001(c) 登记一致）；工作树净 | ✅ |
| 首次 CI | ship-gate 红被抓出 | `gh run list --branch main`：5eba7ca0 ship-gate **failure** 1m1s / ci success / native-smoke success | ✅（注意：main 上该红至今未消——修复在未 land 栈内，等 R99 授权；goal.md 风险登记①已预写） |

## §2 声明 → 证据 → 结论 对照表（关键声明逐条）

| # | 轮报/交接声明 | 审计证据 | 结论 |
|---|---|---|---|
| C1 | enforcement-anchors 腿「与 handoff-lint 平级注册」 | F-1 三重实证（顶层裸块 / 先参数校验执行 / report.json 零条目） | ❌ **弱化跑偏**——腿在跑、退出语义 fail-closed，但注册面+证据面双失 |
| C2 | 两枚自指钉生效（无 fixture 不准入表 / 不杀即 RED） | runner `:88-94` unresolvable→fail、`:113-116` not-killed→fail；E2E §N 四格 | ✅ 钉生效；但同族第三面「空表」漏网（F-2） |
| C3 | `env.registry ?? STATE_PREDICATE_REGISTRY` 参数化 | `verdict.mjs` effectiveRegistry/livePredicates；shell collectSnapshot 同模式；probe 经 env 注入失真 | ✅ |
| C4 | `pending_anchors` 坐席字段（执行不豁免、skip 非 fail） | collectDeferred 挂接 + runner `:106-112` 坐席仍执行探针、killed→[info]、未杀→skip；registry 实测 open 票挂接 | ✅ |
| C5 | R1~R8/R10 全清零 | R1 branchCollected+env-PENDING / R8 bullet-column 收窄 / R4 resolveReuse 消费 / R3 STATE_BARE_RES 派生 / R5 claims-verbatim 抽取+recount 上表面 / R6 assessClearingLeg / R7 pendingPredicates 挂接 / R2 补网（uncollected 对/清算三态/PENDING 位/词表双向锁 :281-285）/ R10 CHANGELOG 分行 | ✅ 逐条实物在案 |
| C6 | ADR-0099 + CONTEXT 九词条 + index 99 | 三件实物逐读吻合（词条 9 枚、index 0099 收录 99 ADRs） | ✅ |
| C7 | CHANGELOG 分行 | Added(8)/Fixed(6)/Docs(4) 属实；**「Deferred 分行」不成立**——r98 节无 `### Deferred` 子节（历代轮次每节皆有，含「无。」占位）；deferred 票折进 Docs 条；且 Docs 条写「两新票」实际三票 | ⚠️ 弱化+自述偏差 |
| C8 | 检测器自身四格失效覆盖 | e2e.mjs:371-401 unresolvable/不杀/坐席/不可读四格在案；空表格缺（F-2） | ✅ 四格在案，覆盖不全 |
| C9 | `exitIfCoverageRed` 回归已修 amend | :1199 定义、:1207/:1238 调用均在 stepHandoffCloseoutLint 内；锚块在其后 | ✅ 症状修复；⚠️ 同根结构病因未除（F-1） |
| C10 | Stack dissolved 语法面 | parseStackLine `:158-160` 变体 + assessStackLeg 三分支 + 模板语法家登记 + r96/r97 收口件已重锚 dissolved | ✅（范围争议见 §4-N4：判 cohesive 正当，非 creep） |
| C11 | 判定核纯净 | verdict.mjs 全文无 spawnSync/fs/Date.now/process.env/require | ✅ |
| C12 | 报告「6 commits」 | 栈实有 7 but-commit（skn…ksm）；收口 Stack 行 6 枚至 pmz——自指末位 capture-lag 属模板容忍约定 | ◻️ 观察（非违规） |
| C13 | CI 首红「本地重锚后转绿」 | main 上 ship-gate run 至今红（修复在未 land 栈）；goal.md 风险①已预写 | ✅ 属实在案（残留风险明示） |

## §3 D-001~D-004 逐条核对

- **D-001**：(a) 正题第五形态落地 ✅（闭表+行为探针+ratchet 坐席先 PENDING）；(b) 返工先修后检 ✅（commit 序 a31039b4/500fd30f 先于 bfaaa47d/c35354e3，断言只升）；(c) land 授权窗兑现 ✅（origin/main 推进、重锚件 skn、CI 首红如实呈报）。禁项核对：判据边界、无通用死代码、单题性 ✅。
- **D-002**：行为消费验证为主 ✅（4/5 探针真消费）；静态前检不独立出 RED ✅（info only）——但 `countReferences` 自指自证（subject 必在注册表内）致前检结构性死亡（§4-N2，弱化非违规）；封闭 schema ✅（实现为 ADR 精化后五字段，对账本四字段属裁定内扩写）；两钉生效 ✅；全程三元组 ✅；观察者最小化 ✅。**减分**：probeVocabGuards 自卫式（§4-N3）、空表 vacuous pass（F-2）。
- **D-003**：独立自检腿 **未兑现注册面**（F-1）；`env.registry` 参数化 ✅；5 锚 ✅；禁项：未并入 lint ✅、非单测套件 ✅、无 monkeypatch/源码复制 ✅、双红后果入 Consequences ✅、开放面仍禁（KR-1+deferred 票）✅。
- **D-004**：票序 T0→T5 ✅；簿记大体兑现（index/CHANGELOG/deferred/claims verbatim）；**C7 分行自述偏差**；deferred 实落三票 vs 账本「两新票」——第三票（stack-land-authorization）为 R6 机检所需，呈报口径已如实写「三新票」不构成静默 creep ✅；T5 收口三态骨架+清算机检首次兑现 ✅。

## §4 次要发现（非阻断，呈报不修）

- **N1**（F-3）`countReferences` 结构性死亡：扫描域含 `docs/enforcement-anchors.json` 自身，subject 恒 ≥1 引用——info 行永不可达，前检零信号（两轴独立命中同点）。
- **N2**（F-4）`probeVocabGuards` 自卫式：`unregistered` 判定核在探针内部署、失真注向拷贝命名空间——kill 由探针自产而非生产消费方产出；`real.length===0` 每次 run 仍维持不变量故降级为弱化。
- **N3** `PROBE_TABLE`（probes.mjs:114-120）：runner 从不查询的手工映射——装饰性双源，恰为本形态标本；注释自承「human-facing index」。
- **N4** dissolved 判定边：hand-built env 中 `branchRefs[b]` 存在而 `stackBranchMembers[b]` 缺席 → GREEN（应 conflict/PENDING）；生产采集器形状下不可达，仅注入 env 可构造——fail-open 方向与 S-1 禁令同型，建议补 branchRefs 交叉校验或登记 Known-Risk。
- **N5** `state-bare-word-in-code-exempt.json` 内部 `name`/`description` 残留复制（`state-unpushed-verified`），fixture 经目录扫描实载有效，字段误导属 hygiene。
- **N6** 锚码未入受控词表：`anchor-unresolvable`/`anchor-not-consumed` 为 msg 子串，无 emitCode/CODE_GROUPS 登记；ADR 称「封闭 RED 码」但封闭面仅靠 E2E `msg.includes` 断言。
- **N7** `probeRatchetRecount` good-case 依赖真 `docs/deferred-registry.json` 含 `"version"`——生产数据耦合，关坐席后同名字段改名将无关红；`resolveReuse` 管线前缀只校验不调用（last=producer 为设计），坐席标注 `[pending-seat]`/`[pending-anchor]` 两形并存；e2e floor `>160` 未随 360 抬升——均 nit 级。

## §5 过程违规呈报（不追认）

1. 锚腿以裸块混入船闸文件——「薄壳只做采→传→出口」纪律下，新腿应走 step*+IIFE 注册通道；F-1 属实现期结构违规，报告自述「腿已注册」不成立。
2. 轮报 C7「Deferred 分行」/ Docs 条「两新票」与实物不符——簿记自述两处失真。
3. 无其他违规：commit 序合规、授权窗合规、断言只升、无静默 while-at-it 编辑、账本偏离有具名申报。

## §6 返工要求（打回原修复窗口）+ 重跑清单

**必修复（阻断）**

- **F-1**：将锚腿收为 `stepEnforcementAnchors()`（或并入 `stepHandoffCloseoutLint` 末段的同级调用），在 IIFE `stepHandoffCloseoutLint()` 之后注册 `reportStep("step_1_6_enforcement_anchors")` 并调用；消除 `1h` 撞号注释。验收：锚腿结果进 `.ship-gate/report.json` entries（pass 与 fail 两路径各验一次）；`--override` 等 usage-error 路径不再先跑探针；RED 路径 report.json 非空。
- **F-2**：`loadAnchorRegistry`/`runEnforcementAnchors` 增非空校验——`anchors` 缺键/非数组/空表 → fail-closed（对齐 closeout-claims「non-vacuous」先例）；E2E §N 补第五格（空表→RED）。断言只升。

**建议同批修（弱化项，可留 deferred 票但须具名）**

- N1 前检自证排除注册表自身文件（或在登记处注明结构性失效 + 理由）；N2 评估将 unregistered 判定核移入消费方或如实改写锚 constraint 表述；N4 dissolved 分支补 branchRefs 交叉校验；C7 CHANGELOG 补 `### Deferred` 子节并更正「三新票」；N5 fixture 元数据更正。

**重跑清单（修完同一套）**

1. `node packages/store/test/handoff-lint-verdict.test.mjs`（≥444，断言只升）
2. `node packages/store/test/handoff-lint-e2e.test.mjs`（≥360）
3. `node scripts/ship-gate.mjs` 全量 → exit 0 + green；**另验** report.json entries 含锚腿条目
4. `node scripts/ship-gate.mjs --override`（usage-error 顺序回归锚）
5. 锚腿失真反演抽查（空表→RED 新格）
6. 复核 CHANGELOG/deferred/closeout 自述与实物一致

— 审计窗只出报告，未改任何实现文件；本件为审计工件独立成支，不入实现栈。
