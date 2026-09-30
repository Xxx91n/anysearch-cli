# R93 审计收口 — L3 修复续轮【换模三跑】（dsh-l3-smoke-kimi-rerun）

日期: 2026-09-30 | 审计对象: 轮报 `2026-09-30-report.md` + 收口交接件 `round-93-closeout.md` + ADR-0094 + 交接 `r93-handoff-next-round.md`（11 坑位）  
基底: `c1917205` | 分支: `r93-l3-rerun` | 审计角色: 只出报告不动手修

## 审计判词

**打回返修（HOLD）** — 硬验收亲跑全绿、判词一致、D-001~D-003 / ADR D1–D8 主规格均满足；
但 F1+F2 两项中等发现经用户裁定**打回原修复窗口返工**（2026-09-30）。
handoff **扣发**，待返修核销 + 同一套硬验收重跑全绿后方可签发（仿 R92 先例）。

## 1. 硬验收重跑（审计员亲跑，不信报告自述）

| 验收项 | 亲跑命令 | 亲跑结果 | 对照报告声明 | 结论 |
|---|---|---|---|---|
| 编译 | `pnpm run build` | ✅ exit 0，Tasks 5/5 | 5 successful, 5 total | **一致** |
| 打包 | `npm pack`（apps/dsh-plugin） | ✅ `anysearch-cli-dsh-plugin-0.1.0.tgz` 29.3kB，shasum `89b160dc…` | 29269B，shasum `89b160dc…` | **一致** |
| 启动测活 | node plugin + mcp http:3001 | ✅ LISTENING；initialize 200；tools/list 200 返 5 工具带 inputSchema | 两进程 LISTENING；initialize/tools-list 200；5 工具 | **一致** |
| 类型门 | `pnpm run check`（对 evidence 复核） | evidence: Tasks 8/8 | 8 successful, 8 total | **一致** |
| test 闭环 | `pnpm run test`（对 evidence 复核） | evidence: Tasks 13/13 | 13 successful, 13 total | **一致** |
| 门禁全链 | `node scripts/ship-gate.mjs`（对 evidence 复核） | evidence: **83 pass / 0 fail / 0 warn**；亲测 token 全绿 | 83 pass / 0 fail / 0 warn | **一致** |
| ADR index | `node scripts/gen-adr-index.mjs --check` | ✅ `up to date (94 ADRs at HEAD)` | 94 ADRs at HEAD | **一致** |

## 2. 声明 → 证据 → 结论 对照表

| # | 声明（来源） | 实物证据（审计员核验） | 结论 |
|---|---|---|---|
| 1 | 判词 `established-via-fallback`，`branch_label=A`（轮报/收口/ADR/交接） | `t2-verdict.json` 原文一致；L3a established / L3b established-via-fallback / L3c-min established；L3c-full/L3d/L3e not-established（非判据） | **属实** |
| 2 | T2 三跑：冻结模型 Kimi-K2-Instruct-0905、profile r93-kimi、N=3 串行全绿 | dump-config 可见 featherless + agent-default-model → 0905 + contextWindow 32768；transcript 三跑 exit 0/0/0，各 1 ans_search_web | **属实** |
| 3 | L3c-min 收窄判据 ans_* only，无幻觉调用污染 | verdict 字段 `l3c_min_scope: ans_* only`；ans_tool_call_events=3 | **属实** |
| 4 | 换臂 0 次，F-bug 复盘闸未武装 | verdict `arm_switches: 0`，`fbug_review_gate: not-armed`（≥2 才武装） | **属实** |
| 5 | 凭证泄漏探针双查 0 命中 | 审计员独立重扫 37 文件：明文 0 命中；`64a88ea6` 仅 6 处合法元数据引用 | **属实** |
| 6 | T-B 未启（谓词 verdict==F-bug 为假） | verdict `t_b_triggered: false` + 谓词求值原文；ADR 内容白名单零触碰 | **属实** |
| 7 | T3 README 双语版本 B 誊抄 | README.md:227 / zh:217 逐字含 `established-via-fallback: [L3b]` + tool_call 侧证注；版本 token 0.1.7-rc.2 | **属实** |
| 8 | T4 readme-token-pin 机器腿真跑非 shadow | evidence/t4/t4-machine-leg.md 记「真实机器腿」；claims 两条 kind=readme-token-pin 带 `dsh --version` 命令 | **属实** |
| 9 | T5 纯备准（credential-scope），外发未执行 | t5-deprecate.md：npm whoami E401 分型；6 条备准命令备妥；0 代跑 | **属实** |
| 10 | r88-candidate sunset 条款写入 | deferred-registry：`deadline: R95 之前必须开庭`、`pre_notification_obligation`、`owner: anysearch-eval`、`sunset_clause` 引 D4、carried_log 已记 | **属实** |
| 11 | closeout-claims 13/13 re-derived green | ship-gate.log 确为 13/13；**但实物 claims 已是 14 条**（第 14 条 r93-report-closeout 于 T6/T7 commit 登记，未被已归档门禁日志复证） | **部分属实**（见发现 F1） |
| 12 | 一票一 commit 类型不混 | r93 全部 commit 前缀 docs/evidence/chore 与票类型对应；仅 7a1e8dd0 chore 改 ADR docs 面轻微相抵 | **基本属实**（见发现 F3） |
| 13 | 无 tag / push / publish | git tag 仅历史 v0.0.3–v0.1.0-rc.0；AHEAD_OF_ORIGIN 18 未推；工作区 clean | **属实** |
| 14 | ADR-0094 D1–D8 完整立法 | 18 个结构标记（D1.1–D1.7/D2–D8/Status/Consequences/范围外/票序节）全在位；gen-adr-index 94 新鲜 | **属实** |
| 15 | 票序终态 T0–T7 完成、TC 未触发 | git log 时序与票序吻合（T6④ CHANGELOG 前置有记账）；TC 窗口 T0 定死无 0.2.0 stable | **属实** |
| 16 | 过程违规自报 3 项 + WORKFLOW.md 缺位 | 三项均见轮报「过程违规自报」；审计员确认 T6④ 依赖倒序合法、终态戳 lane 边界合法、token 漂移已修 | **属实，呈报不追认** |

## 3. D-xxx 逐条核对（账本 D-001/D-002/D-003 → ADR D1–D8）

| 规格 | 实现证据 | 结论 |
|---|---|---|
| D-001 主轴（三跑+rider+sunset+凭证+禁项） | 见对照表 #2/#7/#8/#9/#10/#13 | **满足** |
| D-002 执行设计（D1.1 注入面 / D1.2 三腿收窄 / D1.5 签名闭集 / D1.6 换臂硬顶 / D8 非目标） | dump-config + verdict 字段 + ADR 原文 + arm_switches=0 | **满足** |
| D-003 票序与 commit（T-B 互斥谓词 / T3 誊抄 / T4 两态 / T5 分型 / T6 收口） | git log + verdict 谓词求值 + README + t5-evidence | **满足** |
| ADR D2 判词门控转向票 | 谓词假不启，白名单零触碰 | **满足** |
| ADR D3 README 形态调和 | 四列 + 版本 B 状态列 + 版本 token 对齐 | **满足** |
| ADR D4 r88 sunset | registry 字段齐全 | **满足** |
| ADR D5 权限缺口三型 | credential-scope 分型 + fallback 字段 | **满足** |
| ADR D6 证据效力 advisory | 收口件显式登记 R94 复核 | **满足**（口径本身待 R94 裁定，属挂账） |
| ADR D7 票序节双锚 | **T6 轮报 / T7 门禁两行仍为「待补」** | **弱化**（见发现 F2） |
| ADR D8 Known-Non-Goals | 入册不测不修 | **满足** |

## 4. 发现与处置建议

| ID | 严重度 | 发现 | 证据 | 建议处置 |
|---|---|---|---|---|
| **F1** | 中 | closeout-claims 实物 **14 条**，已归档 ship-gate 日志仅复证 **13/13**；第 14 条 `r93-report-closeout` 的 token 审计员亲验在位，但缺门禁复证闭环 | closeout-claims.json vs ship-gate.log:31；commit `0aa05822`/`1ad09e8d` | **打回**补跑 ship-gate 或补归档 14/14 日志；重跑清单见 §5 |
| **F2** | 中 | ADR-0094:267-268 票序节「T6 轮报+终态戳」「T7 门禁+审计」残留「**待补**」，与轮报逐票终态（but-id 齐备、ship-gate 83/0/0）不一致 | ADR-0094 L267-268 vs 轮报「逐票终态」 | **打回**回填两行 but-id 与实证索引；与 F1 同一返修窗 |
| **F3** | 低 | commit `7a1e8dd0` 标 `chore` 却改 ADR-0094 正文（docs 面），与 D7「一票一 commit 类型不混」轻微相抵 | git log subject + diff 面 | **呈报**：可接受（T7 类型在 D7 表为「—」）或下轮纪律收紧 |
| **F4** | 低 | commit `f5a828a9` scope 写 `r93-grill`，其余为 `r93-l3-rerun`，命名不一致 | git log subject | **呈报**：历史记录，不改写 |
| **F5** | 低 | T6⑥「常驻债词汇归一」无独立证据节可寻 | 收口批六节 vs 实物 | **呈报**：若未做则移入 R94 挂账 |

## 5. 打回返修清单（F1+F2，若批准）

1. 回填 ADR-0094 票序节 L267-268：T6 行写入 but-id（轮报所载 `pqu zqq zus ksp syy` 等）+ 实证索引；T7 行写入 ship-gate 83/0/0 + 日志路径。
2. 重跑 `node scripts/ship-gate.mjs`，归档新日志使 closeout-claims 显示 **14/14**（或说明第 14 条登记于门禁后并补验）。
3. 重跑硬验收同一套：`pnpm run build` → `npm pack` → 启动测活 →（如代码面动过）`pnpm run check` / `pnpm run test` → `ship-gate` → `gen-adr-index --check`。
4. 若只动 ADR 文本与证据日志，build/pack/启动可标注「无代码面变更，快速复验」，但 ship-gate 与 adr-index 必须真跑。

## 6. 过程违规呈报（不替用户追认）

R93 自报 3 项 + 审计员独立发现 2 项，**均不在审计窗口内消化**：

| # | 事项 | 性质 | 审计意见 |
|---|---|---|---|
| P1 | T6④ CHANGELOG 前置于 T4 机器腿 | 工程顺序依赖（ship-gate:776 fail() 早退），非绕过 | **可接受**，已有双处记账 |
| P2 | 终态戳未写入 next-round.md（lane 边界） | 并行 lane 保护，避免重排他 lane | **可接受**，改落轮报+ADR |
| P3 | T4 首跑 token 字面量漂移 1 处 | 已逐字校正转绿，属检查器设计意图 | **已闭合** |
| P4 | WORKFLOW.md 缺位（第 8 次先例核销） | 历史缺位，以 GitButler skill 等价覆盖 | **沿例**，呈报知悉 |
| P5 | F1 claims 14 vs 门禁 13/13 | 证据链闭环缺口 | **待处置**（打回项） |
| P6 | F2 ADR 票序节待补残留 | 立法件自有票账未终态回写 | **待处置**（打回项） |

## 7. 双轴评审摘要（子代理并行取证）

- **Standards 轴**：PASS_WITH_NOTES — pathlint/markers/claims schema/CHANGELOG/ADR 结构/凭证卫生全过；F2/F3/F4 为风险项。
- **Spec 轴**：PASS_WITH_NOTES — D-001~D-003 与 D1–D8 主规格满足、判词六处一字不差；F2/F5 为弱化项。

## 8. 版本控制状态

- 工作区 clean（审计窗口零改动）；无 tag/push/publish。
- 审计件本文件为 docs 面新增，待用户批准处置后由修复窗或本窗（获准时）落 commit。

---
审计员: MiMo audit agent | 依据: code-review skill（Standards+Spec 双轴）+ 硬验收亲跑 + 仓库实物抽查

## 9. 处置裁定（用户 2026-09-30）

**裁定：打回原修复窗口返工。**

- **返修窗口**：R93 修复窗（分支 `r93-l3-rerun`）— 负责人待用户点名。
- **返修范围**：仅 F1 + F2（见 §5 打回返修清单）；F3/F4/F5 维持呈报不改写。
- **handoff 状态**：**扣发**。本文件即为打回凭据；返修核销前不得签发 `round-93-audit-closeout` 后继交接。
- **重跑义务**：修完必须重跑 §1 同一套硬验收（build / pack / 启动测活 / check / test / ship-gate / gen-adr-index --check）。
  若仅动 ADR 文本与证据日志、无代码面变更，build/pack/启动可快速复验，但 **ship-gate 与 gen-adr-index 必须真跑**，且 ship-gate 须输出 **closeout-claims r93: 14/14**（或等价闭环证明）。
- **返修后复审**：审计窗按本文件 §2 对照表 + §5 清单逐项核销，再决定 handoff 签发。

### 打回凭据摘要（供修复窗直接执行）

1. `docs/adr/0094-*.md` L267-268：将「待补」替换为真实 but-id 与实证索引
   - T6 轮报+终态戳 → but-id 见轮报逐票终态（`pqu` `zqq` `zus` `ksp` `syy` 等）+ `reports/2026-09-30-report.md`
   - T7 门禁+审计 → ship-gate 83 pass / 0 fail / 0 warn + `evidence/t7/ship-gate.log`
2. 重跑 `node scripts/ship-gate.mjs`，归档日志使 closeout-claims 腿输出 **14/14**；
   或若认定第 14 条登记于门禁之后属合法，则须在轮报/收口件显式记账并补一次门禁复证。
3. 同一套硬验收重跑全绿后，在本文件追加「返修核销」节，审计窗复审放行 handoff。
