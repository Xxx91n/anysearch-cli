# 深调研报告：eval-gate 离线降级 verdict 语义（declared exclusion vs data-absent）

> atomcode q5 · 2026-09-14 · grill-round-62 Q5
> Sufficiency：searches 6（Exa×3/Tavily×2/AnySearch×3）；angles 五类；full reads 6（pytest、Spinnaker Kayenta、Argo Rollouts、GitHub required-checks、emmer.dev、FirstMate）；本地证据链完整闭合

## 1) 执行摘要（Tl;dr）

**推荐 A（declared-exclusion → SKIP/deferred 语义，verdict 只由实跑臂决定）作为主裁决，B 的"可计数降级标注"降格为报告字段而非 exit 语义**——这恰好就是本仓库现状已实现的行为，与账本 current 决策零冲突、与 ADR-0060 D7 / ADR-0043 D3 / CONTEXT.md:841 逐字吻合。**但必须先纠正前提性事实错误：题设"离线腿按定义永红、gate 自咬 exit 1"在当前代码上不成立**——已提交的 `.ship-gate/eval-report.json`（2026-09-14 生成）显示 `gate.verdict="warn" / exitCode=0`，data-absent 不进 streak、不进 failures，r61 审计 ship-gate 日志第 7 步全绿（126/126）。Confidence：高。

## 2) 前提核验（逐环证伪）

| 环节 | 题设 | 代码实况 | 证据 |
|---|---|---|---|
| 离线排除 vector-arm | ✅ | ✅ 属实 | golden-cases.ts:921 `OFFLINE_EXCLUDED_GROUPS=["semantic"]`；runner.ts:912-956 过滤 run slice、fingerprint 保全集、排除写 `observational.offlineExcludedGroups`（never silent） |
| C1/C2/C3 判 data-absent | ✅ | ✅ 属实 | switch-machine.ts:85 `dataAbsent = rows===0 \|\| units===0`；skip-ledger 实物 12 条 "data-absent (structural)" |
| data-absent → gate FAIL exit 1 | ❌ | **不成立** | decideSwitch（switch-machine.ts:198）对 dataAbsent 返回 S0 hold（record:true 但 to=from，非失败）；recordSkips（skip-ledger.ts:192-197）data-absent 把 consecutiveWarn 重置为 0 永不进 3-streak；evaluateGate failures 不含 switch-state 项 |
| 阻塞步跑 eval --offline | ⚠️ 半对 | ship-gate.yml:119 的 eval 在 path-filtered 独立 signal job（非 merge gate）；真阻塞的 eval 是 ship-gate.mjs step 7，同样 --offline | ship-gate.yml:71-73 注释；mjs:1034 |
| 测试断言 FAIL | ❌ | eval-gate.test.ts:86-94 断言 --offline CLI exit 0 且 rep.gate.exitCode===0 | 无"预期 FAIL"断言 |
| 离线腿永红 | ❌ | 实跑绿 | eval-report.json `verdict=warn, exitCode=0`；audit-r61-shipgate.log "memory-eval: 126/126 cases PASS … ship gate green" |

**结论**：该"门禁自咬"是 ADR-0043 Context 记录的 SP-F-01 事故类（硬编码零导致 streak 无界增长、ship-gate exit 1），已被 r110/ADR-0043 D3 的 data-absent 契约结构性关闭。当前代码 embodies 的正是候选 A：被排除维度不产生 gate failure、verdict 由实跑臂决定、降级以 stderr + offlineExcludedGroups + data-absent reasonCode 三处可观测标注。若某处观察到离线腿红，最可能路径是 **exit 12 族**（fingerprint mismatch / baseline 缺 allowance / fixture MANIFEST 缺失打 no-fixtures 标记，cli.ts:376），而非 declared-exclusion 路径。

**CI 红归因修正**：ship-gate 三 OS 红 = docs-g0007 provenance（三 OS 同款）+ macOS libc++abi mutex 崩溃杀死 eval-gate 子进程（exit null → 测试 exit-0 断言挂，F-16 已知族）。eval-gate 的 declared-exclusion 路径无 CI 红责任。

## 3) 工业界心智模型调研（declared exclusion vs data-absent）

**结论一：SKIP 语义——声明性排除是"条件不满足不运行"，不是失败。** pytest 官方文档（已读原文）：skip = 外部资源不可用时"skip running the test altogether"；skip 与 xfail 分界清晰。vector-arm 离线排除属前者（依赖外部资源=真实 embedding 模型）。

**结论二：data-absent 的成熟心智模型是三分 verdict，不是二分。** Argo Rollouts 官方：runs 分 Successful/**Failed/Inconclusive**，对应 continue/abort/**pause**——数据不足是第三态（hold）。Spinnaker Kayenta（已读原文）给最精细二层区分：

| Kayenta 机制 | 语义 | 对应本题 |
|---|---|---|
| `Nodata`（mustHaveData=false） | "excluded from group score calculations (doesn't hurt or help)"，仅计入 50% NODATA 总阈值 | declared exclusion：vector-arm 被声明排除→永不红 |
| `NodataFailMetric`（mustHaveData=true） | 缺数据**计为失败** | 反事实：required arm 在线跑无数据→才该红 |
| 50% NODATA rule | 缺席比例过高本身自动 fail（score=0） | 防"全部缺席假装通过"的整体兜底 |

即：**"被声明排除"与"必需但缺席"是两个不同 reasonCode，前者永不红，后者才红**——与本仓库 data-absent（结构性缺席 skip 不 streak）vs gate-not-met（计数 streak）的同构区分一致（ADR-0043 D3）。

**结论三：SKIP==绿 的信任陷阱（对 B/D 的批评面）。** GitHub 官方把 skipped 计为绿（"Successful check statuses are success, skipped, and neutral"）；emmer.dev/FirstMate 批评 skipped==success 的信任侵蚀——"能被跳过的必需检查不是必需检查"。B 的 PASS+degraded 会丢失 warn 通道、比现状信息更少；D 直接弱化 126-case 确定性回归+fingerprint 门禁。

## 4) 候选对比矩阵

| 候选 | verdict 语义 | 工业对应 | 优点 | 弊端 | 裁决 |
|---|---|---|---|---|---|
| **A** declared-exclusion→SKIP/deferred | 三态 pass/warn/deferred-excluded（不红） | pytest skip + Kayenta Nodata(false) + Argo Inconclusive-hold | 语义精确；降级可观测；与实跑臂 verdict 正交 | 需防"排除面无声扩大"（整体 NODATA 阈值兜底） | ✅ **推荐，且已是现状** |
| B verdict=PASS+degraded=[…] | 二值化 | GitHub skipped==success | 降级可计数 | 丢 warn 通道；skipped==pass 信任侵蚀有实证批评；比现状信息更少 | ❌ 标注部分降格为报告字段（现状已有） |
| C 改测试断言 FAIL 为文档化 | 永红 | Chromium TestExpectations WONTFIX | 零改动 | 阻塞命令永红=狼来了逼出 bypass；违反 CONTEXT.md:841 与 ADR-0060 D7；且测试现状断言的就是 exit 0 | ❌ |
| D ship-gate 摘 eval --offline | skipped | GitHub path-filter | 消红 | 违反 "deterministic checks always block"；弱化 126-case+fingerprint 门禁 | ❌ |

## 5) 残余真实决策（本轮可选硬化项）

唯一值得裁决的硬化：**Kayenta 50% NODATA 规则的同构物**——给 OFFLINE_EXCLUDED_GROUPS 加"整体缺席上限"哨兵（如 excluded 组占比超过阈值 → gate 红），防"排除面无声扩大把门禁掏空"。规模：一行占比断言 + 阈值常量。非必须——当前排除面是编译期常量（golden-cases.ts:921），已被 ship-gate 静态断言钉住。

## 6) 与账本 current 决策的冲突检查

- R62 D-001~D-004：无冲突（D-004 的"断言锚结构化字段"与本结论同向）。
- R61 D-001~D-005：无冲突——本结论是对"离线红根因"的归因修正，不动 R61 任何契约。
- ADR-0060 D7 / ADR-0043 D3：正向对齐——本报告证实其分层/data-absent 契约已正确实现。
- **无需 revised 标记**：Q5 题设错误不构成账本冲突，只修正 grill 的事实基线。

## 7) 完整来源清单

| 标题 | 角度 | 贡献 |
|---|---|---|
| pytest 官方文档 skip/xfail | Official | SKIP=条件不满足不运行的权威定义 |
| Spinnaker Kayenta 官方文档（已读原文） | Official | Nodata(mustHaveData) 二分 + 50% NODATA 兜底——本题最精细对应 |
| Argo Rollouts analysis 官方 | Official | Successful/Failed/Inconclusive 三分 verdict |
| GitHub required-checks 官方 | Official | skipped==success 语义原文 |
| emmer.dev（required checks 批评） | Criticism | skipped==pass 信任侵蚀论证 |
| FirstMate | Comparative | deterministic checks always block 原则 |
| Chromium TestExpectations WONTFIX 惯例 | Community | C 方案的反面参照 |
| 本地 | 实物 | eval-report.json、audit-r61-shipgate.log、switch-machine.ts、skip-ledger.ts、golden-cases.ts、eval-gate.test.ts、ship-gate.yml/mjs、ADR-0043/0060、CONTEXT.md:841 |

## 8) 信息缺口

1. rui 本地 Windows 复现的 "CLI exit 1" 未定位到精确路径（exit 12 族嫌疑最大：fingerprint/baseline/fixture-manifest）；若属实跑 red，需在修复票里按 exit code 落归因断言。
2. macOS 原生崩溃是否影响除 eval-gate 外的其他长测试（CI 日志显示 access-chain-telemetry/verify 同挂）。
