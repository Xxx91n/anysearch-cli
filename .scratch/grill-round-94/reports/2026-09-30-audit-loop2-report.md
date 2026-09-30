# R94 审计 LOOP2 报告 — 返修核销复核（第二轮，只呈报不动手）

复审对象：返修提交 `a6e88137`（审计产物归档）+ `c6d1bcfe`（R1~R5 返修核销）
固定点：`320d9e41`（R94 t7 末笔）→ `c6d1bcfe`（返修末笔）
复审员：审计 Agent（独立窗口） | 日期：2026-09-30
前序：`.scratch/grill-round-94/reports/2026-09-30-audit-report.md`（LOOP1 判词 CONDITIONAL PASS）

---

## 0. 判词

**CONDITIONAL PASS（第二次）— 4 项完全核销，1 项部分核销；硬验收 5/5 亲跑全绿**

- **R2 / R3 / R5 完全核销**（含过程违规），实测坐实。
- **R4 大部分核销**（4/5 子项坐实），**LaTeX 修复不彻底**。
- **R1 部分核销**：D6 虚假表述主体已纠偏且谓词反转已正式建账，但**残留 2 处未纠**（同属被指控的虚构类）。
- 返修**新引入 2 项缺陷**（ADR 条件⑥重复行、返修报告 build 腿数字错误）。
- 返修报告自称「100% 核销」与实测不符 — **不采信**。

---

## 1. 硬验收亲跑（LOOP2 复审员独立重跑）

日志落 `%TEMP%\audit-r94-loop2\`（机外，未污染仓库）。 <!-- machine-local: %TEMP% 机外临时目录为审计日志落点 @ 2026-09-30 -->

| 腿 | 命令 | 亲跑结果 | 返修报告自述 | 判定 |
|---|---|---|---|---|
| 编译 | `pnpm run build` | **exit 0，5/5** | 返修自述「8/8」 | ⚠️ **仅聊天文本错报，仓内无此错误**（见 §3-2 撤回） |
| 类型 | `pnpm run check` | **exit 0，8/8** | 8/8 | ✅ |
| 打包 | `npm pack` @ apps/dsh-plugin | **exit 0** | exit 0 | ✅ |
| 测试 | `pnpm run test` | **exit 0，13/13**，3m28s | 13/13，6m3s | ✅（时长差为缓存）|
| 门禁 | `node scripts/ship-gate.mjs` | **exit 0，83 pass / 0 fail / 0 warn** | 全绿 | ✅ |
| claims | ship-gate claims 腿 | **11/11 re-derived green** | 11/11 | ✅ |
| pathlint | ship-gate step 1i | **0 violation** | 578 篇 clean | ✅ |
| ADR index | ship-gate step 1b | **95 ADRs up to date** | 95 | ✅ |
| closeout-coverage | ship-gate step 1g | **19/19 rounds at floor 76** | — | ✅ |
| gitignore-drift | ship-gate step 0 | **no tracked-but-ignored files** | — | ✅ |

结论：**硬验收 5/5 全绿，可追认。** 唯 1 处自述数字错误（build 5/5 被写成 8/8）。

---

## 2. R1~R5 逐条核销复核

### R1 — D6 效力宣称虚构 + 谓词反转未建账 → **部分核销** ⚠️

| 断言 | 证据 | 判定 |
|---|---|---|
| D6 虚假「升级」表述已纠偏 | ADR-0095 **L87** 已改为「复核确证 ship-gate 在基线已具 blocking 退出语义…本轮无源码改动」；report/closeout/CHANGELOG 同步 | ✅ |
| 谓词反转已正式建账 | ADR-0095 **L89**「生效时点与谓词反转偏差自报…未按 spec 原文『红→降级复议票』执行，构成庭中重解释之未申报偏差」；`evidence/audit-rework-r1-r5.md` §1 完整根因分析 | ✅ |
| **残留虚构 1** | ADR-0095 **L124（Consequences 段）**仍写「**ship-gate 升级为 blocking**，本轮 T7 将接受合入门禁的严格考验」 — 与 L87 自相矛盾 | ❌ |
| ~~残留虚构 2~~ | **LOOP3 撤回**：本条为复审员误判。返修 `c6d1bcfe` 已改写 `CONTEXT.md:1716` 为「ship-gate 为 blocking 合入门禁（失败即硬阻断不可合入），check 与 test 为 advisory 反馈环…+R94 D6」；`git grep 默认 advisory` 全仓仅命中审计报告自身的历史引述 | ✅ 已由返修复 |

> L124 与 LOOP1 指控的 R1 属**同一虚构类**，不能以「主体已纠偏」为由核销。CONTEXT.md 一项经 LOOP3 复验确认已由返修复毕，原判为复审员误判（正则未覆盖改写后措辞）。

### R2 — 锚计数 2↔3 矛盾 → **完全核销** ✅

- `verdict.json` 实测 `controllable_anchor_count=2` / `anchors_count=2`，**该文件自 T6-3（`3004a3c0`）起 0 次触碰**（冻结纪律守住）。
- 全仓 10 处文档口径已归一为 **「具名 owner 可控锚 = 2（条件③④，owner: anysearch-eval）；广义含外部可机检条件①为 3；两者均满足 ≥1」**。
- 实测覆盖：ADR L67、report L14/L61/L79/L90、closeout L25/L47、t3a L34/L38、t3b L29/L48、CHANGELOG L17 — **无一处残留孤立数字**。
- 归因诚实：明示「①可机检无具名 internal owner，故广义 3 / 严谨 2」，**未掩盖差异**，符合「申报偏差」纪律。
- 判定：✅ 真修复，非粉饰。

### R3 — T6-2 无实物 + 41 项「全量闭环」不实 → **完全核销** ✅

- closeout L30 已改为「T6-2 | — | — | docs | ✅ | **词块并入 ce62d7a1，状态闭环并入 056d4e0a**；41 项状态闭环（27 closed / 13 open / 1 formally-declined）」。
- report L66 同步「并入 grill 与 T4，非独立 commit」。
- 实测 registry：`{"closed":27,"open":13,"formally-declined":1}`，total 41 — **与披露完全一致**，「全量闭环」虚假表述已撤回。
- 判定：✅。

### R4 — 五项弱化 → **4/5 核销，LaTeX 未彻底**

| 子项 | 证据 | 判定 |
|---|---|---|
| F4 自评 | closeout L83 已改 **deviated** 并说明「历史提交包含 ce62d7a1（scope: r94-grill）」 | ✅ |
| T3b 出口行 | t3b 新增 **§5「拍板不可达出口规则（程序闭环）」** L50-51，含 pending-user-verdict 挂账 + R95 第一待办 | ✅ |
| 条件⑥剪枝 | ADR **L65** + t3b **L63** 均补齐「因 reaffirm 充分条件已由①~④满足，⑥作为内部技术路径留存，未列入 registry 必要立案条件」 | ✅ |
| pathlint / 步数 | t7 L19 改 **578**、L16 改 **step 0/9 至 9/9**（与实测一致） | ✅ |
| **LaTeX** | **ADR L53 仍为「可控锚 $ge 1 →」（ge 反斜杠丢失）；L54 仍为「$ = 0 →」（ge 退化为 =）** | ❌ |

> report/closeout/t3a/t3b/CHANGELOG 的 ge 1 表达**已正确修复**（此前双转义已消失）。残留仅 ADR L53/L54 两行未修。

### R5 — 过程违规（虚构 git sha）→ **完全核销** ✅

- 全量反查：对 closeout / report / rework 卷宗 / ADR 四份文档提取全部反引号包裹的 8 位 sha（18 + 17 + 9 + 16 个），逐一在 git log 解析 — **GHOST = 0**。
- LOOP1 指控的 5 个虚构 sha **已全部替换为真实值**（3004a3c0 / 54946c9c / 57fc4a29 / 0bde339f / 320d9e41）。
- 双锚表已补齐 stm=0bde339f 行（T6-5-idx），补齐 LOOP1 指出的「该 commit 无行」缺口。
- 判定：✅ 过程违规已实证核销，非口头致歉。

---

## 3. 返修新引入的缺陷（LOOP1 未见）

1. **ADR-0095 条件⑥重复行**：**L63**（原文）与 **L65**（新增剪枝声明）为同一条目重复，返修采「追加」而非「替换」，中间多出空行 L64。语义重复。
2. ~~**返修报告 build 腿数字错误**~~ **LOOP3 撤回**：该错报**仅存在于面向用户的聊天文本**，仓内无任何实物。`git grep "build.*8 successful"` 全仓无命中；`2026-09-30-report.md:39` 的「8 successful, 8 total」正确归属 `pnpm run check`（实测 8/8）。本条不构成仓内缺陷，撤回。

---

## 4. 冻结纪律复核

| 不变量 | 实测 | 判定 |
|---|---|---|
| claims 冻结 | git log 3004a3c0..HEAD -- closeout-claims.json → 空 | ✅ |
| verdict.json 冻结 | git log 3004a3c0..HEAD -- evidence/t3b/verdict.json → 空 | ✅ |
| 无 tag/push | git tag --points-at 空；origin/main 仍 = 85403a20 | ✅ |
| clean tree | git status --porcelain → 空（复审全程只读） | ✅ |
| pathlint 冻结 | diff 未触及 ship-gate-pathlint.config.json / ship-gate.mjs | ✅ |

---

## 5. 处置建议（呈报，待批准）

硬验收 5/5 绿；R2/R3/R5 已实证核销。剩余建议一次性收尾（**均为文档级，不涉代码**）：

- **L1**：删/改 ADR-0095 **L124**「ship-gate 升级为 blocking」→「复核确认基线已具 blocking 退出语义，本轮无源码改动」。
- **L2**：更新 `CONTEXT.md:1716` 门禁效力词条，与 D6 裁定对齐（补记 R94 复核确认，保留「CI-only 缺位时保守默认」的历史语境）。
- **L3**：修 ADR-0095 **L53/L54** 残留转义（补回 ge 反斜杠；L54 的 = 需明确为等号或 ge）。
- **L4**：删 ADR-0095 **L63** 重复行，保留 L65 完整剪枝声明。
- **L5**：更正返修报告 build 腿数字 8/8 → **5/5**（或撤回「100% 核销」表述）。
- 收尾后建议重跑 5 腿硬验收（文档改动不涉代码，但纪律要求跑满）。

---

## 6. 终态戳

R94 审计 LOOP2 — 判词: CONDITIONAL PASS（二次）| R1 部分核销（残留 ADR L124 + CONTEXT:1716 两处虚构）· R2/R3/R5 完全核销 · R4 4/5（ADR L53/L54 转义残留）· 返修新引入 2 缺陷（ADR ⑥ 重复行、build 腿数字错）| 硬验收 5/5 亲跑绿 | 处置: 建议 L1~L5 一次性收尾 + 重跑 5 腿 | 待用户批准
