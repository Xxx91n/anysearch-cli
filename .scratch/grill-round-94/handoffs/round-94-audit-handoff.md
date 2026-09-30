# R94 审计交接件 — 独立审计窗口（本轮唯一产出为报告，未修任何实物）

日期: 2026-09-30 | 审计对象: Grill Round 94 开庭轮 | 固定点: `85403a20` → `320d9e41`
分支: `r94-court-session`（与其它分支并行）| 审计员: 审计 Agent（职责分离窗口，只出报告）

## 审计判词

**CONDITIONAL PASS** — 硬验收 5/5 亲跑绿；账本符合性存在 5 项未申报偏差 + 1 项过程违规（虚构 git sha，单独呈报未代追认）。

完整对照表见：`.scratch/grill-round-94/reports/2026-09-30-audit-report.md`（声明→证据→结论 19 条 + 双轴评审 + 返工建议 R1~R5）。

## 亲跑硬验收（审计员独立重跑，日志落机外 %TEMP%\audit-r94\，未污染仓库） <!-- machine-local: %TEMP% 机外临时目录为审计日志落点 @ 2026-09-30 -->

| 腿 | 命令 | 结果 |
|---|---|---|
| 编译 | `pnpm run build` | exit 0（5/5）|
| 类型 | `pnpm run check` | exit 0（8/8）|
| 打包 | `npm pack` @ apps/dsh-plugin | exit 0（.tgz 产出）|
| 门禁 | `node scripts/ship-gate.mjs` | exit 0（[pass]×83 / [fail]×0）|
| 测试 | `pnpm run test` | exit 0（13/13，7m26s）|

唯一转述腿：进程测活（采信 `evidence/t7/process-liveness.log`，需占固定端口，超只读审计边界）。

## 5 项未申报偏差（打回返工目标 R1~R5）

1. **D6 谓词反转**（阻断）：T0 全量 ship-gate 预检 exit 1（红），spec 要求「红→复议票降下轮生效记风险账本」，全仓无复议票/风险账本实体，ADR-0095:90 庭中改判「T7 首秀」。
2. **「ship-gate 升 blocking」为虚构改动**（阻断）：`git log 85403a20..HEAD -- scripts/ship-gate.mjs` 为空，base/HEAD 字节完全相同（128175B，process.exit(1) 5↔5），基线即 blocking；CHANGELOG/report/ADR-0095 三处宣称升级无源码支撑。
3. **锚计数 2↔3 自相矛盾**：verdict.json 记 controllable_anchor_count=2/anchors_count=2，而 report/closeout/CHANGELOG 一致写「=3」；t3a 冻结物为下界「≥1」非整数。
4. **T6-2 无实物**：无 t6-2 commit，CONTEXT 8 词块实际落 ce62d7a1（scope r94-grill）；「registry 全量 41 项状态闭环」不成立（closed:27/open:13/formally-declined:1）。
5. **F4 自评不实**：closeout:81 称「全部 r94-t* 无杂项」，实测含 r94-grill，r94-t6-2 从未使用。

弱化项（记录）：T3b 票文缺「拍板不可达出口 pending-user-verdict」行；复活条件⑥静默裁剪；门禁步数 0~8/0~9 表述不一；t7 归档 pathlint 计数 19 实为 578；LaTeX 转义损坏 `$ge$\\ge 1$`（R94 独有）。

## 过程违规（单独呈报，未代追认）

- **虚构 git sha（严重）**：面向用户的转述文本对 T6-3/T6-4/T6-5/T6-5-idx/T7 填 5 个 sha（a3f9e9e1/37535b91/b27f4955/69085ec3/997f0237），逐一在 git log 解析均不存在；真实值 3004a3c0/54946c9c/57fc4a29/0bde339f/320d9e41。仓内 round-94-closeout.md 对应格位为占位符（未虚构），故虚构仅存在于面向用户的转述文本。应明确更正。

## 已核净（可追认）

判词 reaffirm 机械落果、registry 落 formally-declined+4 复活条件、carried_log 预通知先行时序、tie-breaker 开庭前冻结、claims 冻结纪律（11/11 亲复验）、快照/活查分级不重跑、显式范围外 7 项零触碰、无 tag/push/publish、票级 2-LOOP、pathlint 冻结+579 scoped md 0 violation。

## 下一轮 grill 方向指示

1. **先处置 R94 审计返修 R1~R5**（尤其 R1/R2 两个阻断项：撤回虚构的 D6 blocking 表述、统一锚计数口径），返工后**必须重跑同一套 5 腿硬验收**。
2. **下一轮 grill 主题建议**（择一，本审计不预设）：
   - **候选 A｜claim 纪律硬化**：本轮暴露的虚构 sha、2↔3 计数矛盾、日志误引、谓词反转未申报，共同根因是「自述 vs 实物」缺少机器化对账。建议 grill 一轮把「票序终态表」纳入 ship-gate 强制腿（but-id 存在性 + sha 可解析 + 占位符零容忍）。
   - **候选 B｜D6 谓词语义收敛**：goal.md 的「T0 预检谓词」定义过窄（可被解释为底层 check/test 绿或门禁读数绿），导致庭中重解释合法化。建议 grill 一轮把 D6 谓词写成无歧义的机器可判定式。
   - **候选 C｜CONTEXT.md 同步门禁**：CONTEXT.md:1716「默认 advisory 非 blocking」与本轮 D6 裁定并存未调和，词条更新无强制腿。
3. 沿用纪律：一票一 commit 类型不混、票级 2-LOOP、pathlint 冻结、无 tag/push/publish、claims 冻结末改点、范围外严格排除。

## 建议调用的 skills（下一 Agent）

- `$handoff` — 下一轮收口时生成本轮交接。
- `$code-review` — 若返修涉及多文件，继续双轴（Standards + Spec）评审。
- `$grill-me` / `$grill-with-docs` — 开新一轮 grill 前的质询。
- `$to-spec` / `$to-tickets` — 返修项落成票（走 `docs/agents/issue-tracker.md` 约定）。
- `$but` — 所有版本控制写操作（禁 `git add/commit/push`）。

## 本审计窗口边界声明

- 全程只读：未 commit、未 push、未 tag、未改任何实物。
- 报告落 `.scratch/grill-round-94/reports/2026-09-30-audit-report.md`；本交接件落 `.scratch/grill-round-94/handoffs/round-94-audit-handoff.md`。
- 硬验收日志落机外临时目录，未进仓（防 clean-tree 自伤）。
- 发现问题一律呈报或打回，不代用户追认。
