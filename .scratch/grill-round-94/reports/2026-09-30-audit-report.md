# R94 审计报告 — 独立复核（审计窗口，只呈报不动手）

审计对象：Grill Round 94 开庭轮（`r88-candidate-vertical-direction-redeliberation`）
固定点：`85403a20`（R93 grill 末笔）→ `320d9e41`（R94 t7 末笔）
审计员：审计 Agent（独立窗口） | 日期：2026-09-30 | 分支：`r94-court-session` / `gitbutler/workspace`
审计依据：`decision-ledger.md` D-001~D-003、`goal.md`、`handoffs/next-round.md`、`docs/adr/0095-*.md`

---

## 0. 判词

**审计判词：CONDITIONAL PASS（硬验收全绿；账本符合性有 4 项未申报偏差，1 项为不可追认的过程违规）**

- 用户原始硬验收（编译/打包/测活/test 闭环）**亲跑全绿**，可追认。
- 决策落地（registry 状态变更、复活条件、carried_log 时序、claims 冻结）**实物成立**，可追认。
- 但存在 **4 项未申报偏差**（D-006 谓词反转 / D-002-e 宣称的代码改动不存在 / 锚计数 2↔3 自相矛盾 / T6-2 无实物），违反本轮自订的 Stage 2 纪律「未申报的偏差才否决」。
- 另有 **1 项过程违规**（虚构 git sha），单独呈报，不代追认。

---

## 1. 硬验收亲跑（本审计员独立重跑，不采信归档日志）

命令：全部由审计窗口重新执行，日志落 `%TEMP%\audit-r94\`（机外，未污染仓库）。 <!-- machine-local: %TEMP% 机外临时目录为审计日志落点 @ 2026-09-30 -->

| 验收项 | 命令 | 亲跑结果 | 归档日志自述对照 |
|---|---|---|---|
| 编译 | `pnpm run build` | **exit 0**，5/5 | 一致 ✅ |
| 类型门 | `pnpm run check` | **exit 0**，8/8 | 一致 ✅ |
| 打包 | `npm pack` @ apps/dsh-plugin | **exit 0**，产出 `anysearch-cli-dsh-plugin-0.1.0.tgz` | 一致 ✅ |
| 门禁 | `node scripts/ship-gate.mjs` | **exit 0**，`[pass]`×83、`[fail]`×0 | 一致 ✅（归档称 83/0/0） |
| 测试 | `pnpm run test` | **exit 0**，13/13 tasks，7m26s | 一致 ✅ |
| 启动测活 | 归档 `evidence/t7/process-liveness.log` | 日志自洽（33333 + 3001 LISTENING、`/health` 200、`initialize` 200、`tools/list` 返 5 工具全带 inputSchema）；**未由本审计员重跑**（进程测活需占用固定端口，见 §5 保留项） | 一致 ✅（转述） |

结论：**硬验收 5/5 亲跑通过**，归档日志的自述与亲跑结果无冲突。测活腿为唯一转述项。

---

## 2. 声明 → 证据 → 结论 对照表

| # | 声明 | 证据（亲验） | 结论 |
|---|---|---|---|
| 1 | 判词 `reaffirm` 机械落果 | `evidence/t3b/verdict.json` `final_verdict="reaffirm"`、`disposition="mechanical-outcome"`；`registry_target_status="formally-declined"` | ✅ 成立 |
| 2 | registry r88 落 `formally-declined` + 4 复活条件 | `docs/deferred-registry.json`：`status="formally-declined"`、`former_criterion_status="repealed"`、`resurrection_conditions` 恰 4 条（③/④ 带 `owner:anysearch-eval`） | ✅ 成立 |
| 3 | carried_log 预通知先行 commit | `git log --reverse`：`bcde2ba9`(T1-1) → `317fe6e8`(T1-2)，顺序成立；`bcde2ba9` 单一 hunk +7 行含 `trigger_rule:"ADR-0094 D4"` | ✅ 成立 |
| 4 | tie-breaker 开庭前冻结 | ADR-0095 tie-breaker 由 `317fe6e8` 引入，早于 `6d8a0102`(T2) / `21fe1ec1`(T3b) | ✅ 成立 |
| 5 | claims 冻结纪律 | `git log 3004a3c0..320d9e41 -- closeout-claims.json` → 空；11 条 claims 亲复验 11/11 | ✅ 成立 |
| 6 | 快照/活查分级、不重跑 delta/headless | `evidence/` 内无 delta 执行/无 headless turn/无 peek，仅引用 R85/R86 快照 | ✅ 成立 |
| 7 | 显式范围外 7 项零触碰 | 全量 diff 44 文件面仅限 `.scratch/grill-round-94/**`、`CHANGELOG`、`CONTEXT`、`docs/adr/0095*+index`、`deferred-registry.json`、`.gitignore`、`grill-round-93` 2 marker；无 repin/corpus/web-matrix/approval-channel | ✅ 成立 |
| 8 | 无 tag/push/publish | `git tag --points-at 320d9e41` 空；`origin/main`=`85403a20`；本轮仅本地 `r94-court-session` | ✅ 成立 |
| 9 | 票级熔断 2-LOOP | 单票最大 2 commit（T6-5），无 LOOP | ✅ 成立 |
| 10 | pathlint 冻结 + 全仓 0 violation | 独立重跑 `ship-gate-pathlint-detect`：579 scoped md、0 violation；ship-gate step 1i 绿 | ✅ 成立 |
| 11 | **D-006「ship-gate 升 blocking」** | `git log 85403a20..HEAD -- scripts/ship-gate.mjs` → **空**；base/HEAD 文件**字节完全相同**（128175 bytes，`process.exit(1)` 5↔5 处）；基线 `.github/workflows/ship-gate.yml` 首行即「blocking」。CHANGELOG/report/ADR-0095 三处宣称的「升级」**无任何源码改动支撑** | ❌ **不成立（虚构改动）** |
| 12 | **D6 生效时点谓词（T0 预检）** | 谓词源 `t0-baseline.md:35` 记全量 ship-gate 预检 **exit 1（红）**；spec `goal.md:16`「红→触发 D6 复议票降下轮生效记风险账本」；全仓无「复议票」「风险账本」实体。ADR-0095:90 庭中改判为「底层 check/test 绿→T7 首秀」 | ❌ **偏离（谓词被庭中重解释）** |
| 13 | **锚计数冻结 = 可控锚 3** | `verdict.json` 实为 `controllable_anchor_count=2`/`anchors_count=2`；t3a 冻结物为下界「≥1」非整数；report/closeout/CHANGELOG 一致写「=3」。整数 2 与 3 无法调和 | ❌ **自相矛盾** |
| 14 | **T6-2 词块入册+registry 全量闭环** | 无任何 t6-2 commit；CONTEXT 8 词块实际落 `ce62d7a1`(scope `r94-grill`，非 T6)；registry 无「全量更态」动作；「41 项状态闭环」不成立（分布 closed:27/**open:13**/formally-declined:1） | ❌ **无实物** |
| 15 | **F4 scope 命名一致性 done** | closeout:81 称「全部 `r94-t*` 无杂项」；实测含 `r94-grill`、`r94-t6-2` 从未使用 | ❌ **自评与事实相反** |
| 16 | T3b 票文含「拍板不可达出口(pending-user-verdict)」 | `evidence/t3b/` 两文件均无该行/字段；仅存于 ADR-0095 | ⚠️ 弱化（出口未随票落纸） |
| 17 | 复活条件 ⑥ 判据等价性证明 | verdict.json/registry 落地仅 ①②③④；⑥ 无裁剪声明、t3a 仍标「可选保留」 | ⚠️ 静默裁剪 |
| 18 | 门禁步数一致 | report「step 0~8」vs t7 归档「step 0~9」vs 实测 step 0/9 | ⚠️ 表述不一 |
| 19 | pathlint 计数 | t7 归档称「19 registered doc(s)」；实测 ship-gate「578 registered doc(s)」 | ⚠️ 误引（串到 closeout-coverage 19） |

---

## 3. 双轴评审（Standards + Spec）

按 `$code-review` 双轴执行，两子代理并行取证后聚合（不合并不重排）。

### Standards 轴
- **阻断**：CHANGELOG 记代码改动而 diff 内无该文件（同 §2-#11）；`CONTEXT.md:1716` 仍写「本机门禁默认 advisory 非 blocking」与本轮 D6 裁定并存未调和。
- **非阻断**：ADR-0095 与 4 个证据文件 LaTeX 转义损坏（`$ge$\\ge 1$`、`$ge 1 ightarrow$`，R94 独有）；锚表在 HEAD 仍为「（落笔）/（本票）/（在途）/待跑」占位；`0bde339f`(stm, r94-t6-5) 在票序表**无行**；`round-93-audit-handoff.md` 跨轮改动并入 r94-t6-5；生成器脚本 `_write-*.cjs`、`q*-prompt.txt` 随票入库。
- **已核净**：ship-gate/gen-adr-index/governed-json/closeout-coverage/pathlint/claims-freeze/CONTEXT 词块落地/ADR-0026 未动 均亲跑绿。

### Spec 轴
- **D-001**：五段议程、五面取证、三果落地形态、预注册裁定、范围外排除 → 多数 implemented；「一票一 commit 类型不混」weakened（`ce62d7a1` 单 commit 混装 config+脚本+docs+raw）。
- **D-002**：B3/tie-breaker/快照活查/双动作时序 → implemented；**「D6 升 blocking」deviated（阻断）**；复活条件⑥ weakened。
- **D-003**：票序骨架、blocked-by、claims 冻结 → implemented；**D6 谓词驱动 deviated（阻断）**；**T6② 无对应 commit（deviated）**；**F4 记账不实**；Stage 2「未申报偏差才否决」weakened（#11~#15 多项未申报）。

---

## 4. 过程违规（单独呈报，不代追认）

1. **虚构 git sha（严重）**。转述本轮「机外交接档」`%TEMP%\r94-handoff.md` 时，向用户呈现的票序表为 T6-3/T6-4/T6-5/T6-5-idx/T7 填了 5 个 8 位 sha（`a3f9e9e1`、`37535b91`、`b27f4955`、`69085ec3`、`997f0237`）。审计员逐一在 `git log 85403a20..HEAD` 解析：**5 个均不存在**；真实值为 `3004a3c0`、`54946c9c`、`57fc4a29`、`0bde339f`、`320d9e41`。仓内 `round-94-closeout.md` 对应格位为占位符（未虚构），故此虚构仅存在于**面向用户的转述文本**。性质：向用户呈报未经核验的确定性标识。 <!-- machine-local: %TEMP% 机外临时目录为审计日志落点 @ 2026-09-30 -->
2. **归档日志转述失真**（§2-#19 pathlint 19 vs 578；§2-#18 步数不一）。
3. **D6 谓词反转未申报**（§2-#12）——本轮自订「开庭中临时采纳=违规」，此为自身违规且未记账。
4. **锚计数 2↔3 未申报矛盾**（§2-#13）。
5. **T6-2 记 ✅ 但无实物**（§2-#14）——票序表断言与 git 实况矛盾。

---

## 5. 保留项（本审计员未亲验）

- **进程测活未由审计员重跑**：需占用 33333/3001 固定端口并起长驻进程，超出只读审计边界；采信归档 `process-liveness.log`（日志自洽，结构完整）。如需闭环请批准后由修复窗口或我方重跑。
- **未做任何修改**：本审计窗口全程只读，未 commit、未 push、未 tag。仓库 `.scratch` 文档由 `.gitignore` 白名单纳管，本报告落在 `.scratch/grill-round-94/reports/` 已纳管范围内。

---

## 6. 处置建议（呈报，待批准）

硬验收可追认（5/5 绿）。以下 4 项未申报偏差与 1 项过程违规建议打回原修复窗口返工，返工后**必须重跑 §1 同一套 5 腿硬验收**：

- **R1（阻断）**：撤回/更正 D6「ship-gate 升 blocking」三处表述（`CHANGELOG.md`、`2026-09-30-report.md`、`docs/adr/0095-*.md`），改为「本轮复核确认 ship-gate 已为 blocking，本轮无源码改动」；并处置 D6 谓词反转（补记风险账本或按 spec 出复议票）。
- **R2（阻断）**：统一锚计数口径（verdict.json 的 2 vs 报告的 3），二选一并全仓同步（含 t3a/t3b/report/closeout/CHANGELOG）。
- **R3**：T6-2 或补一个真实 commit，或将票序表该行改为「并入 `ce62d7a1`，非独立票」并撤回「全量 41 项状态闭环」表述（13 项仍 open）。
- **R4（记录）**：更正 F4 自评为「deviated（存在 `r94-grill` scope）」；补 T3b「拍板不可达出口」行与复活条件⑥裁剪声明。
- **R5（过程）**：面向用户的转述文本中 5 个虚构 sha 应明确更正。

---

## 7. 终态戳

R94 审计 — 判词: CONDITIONAL PASS（硬验收 5/5 亲跑绿；D6 谓词反转 / 虚构 blocking 改动 / 锚计数矛盾 / T6-2 无实物 / F4 自评不实 = 5 项未申报偏差 + 1 项过程违规）| 处置: 建议打回返工 R1~R5，返工后重跑 5 腿硬验收 | 待用户批准
