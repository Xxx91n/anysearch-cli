# Handoff — Grill Round 96 审计窗 → 修复窗 / R97

Stack（primary key = GitButler change-ids；SHA 为 capture 时值，time-lagged）：
`r96-audit` → zky（自引用收尾 commit：审计报告 + 本件；SHA 为自引用值，按 handoff-template「SHA time-lagged，以 but log 为准」不写入）
被审计对象栈（LOOP 1 捕获值；**SHA 已于返工 amend 后全部失准 —— 现 tip 为 `b734f25d` / `842478ed` / `68bd1634` …，权威值以 `but log r96-handoff-lint` 为准**）：`r96-handoff-lint` → mwp → lqv → svk → lsp → ksz → zlr → lpu（自引用收尾）——but-id 链为主键，7 个 commit 的**顺序与归属未变**；该栈叠于 `r95-exec` 之上（未 push、未 PR、未 tag）

## 绿色 run URL（必填）

PENDING: pushed-no-branch-runs — `origin/r96-audit` 的 ref **存在**（2026-10-03 由 owner 授权 push 后实测），但本仓 `.github/workflows` 的 `on.push` 仅覆盖 `main`，特性分支 push 不产出任何 run，故本审计窗无本轮 run（ADR-0097 F8-c 谓词，门禁离线自证）。未 land、未 PR、未 tag。**本行原为 `PENDING: stack-unpushed`（审计窗当时未 push），push 后按 R95 F5R 纪律改述。**

> 旁注（非本轮 run，不满足本字段）：共同基底 `3642d494` 的三条绿 run（ci / ship-gate / native-smoke）在本审计窗实跑 ship-gate 时仍为绿，但它们是 main 基线 run，head_sha 不在 `origin/main..origin/r96-audit` 的成员集内——ADR-0097 三态语法下它们只是旁注，正是 F8-b 假绿的原始形态。

## 已完成

**审计报告**：`.scratch/grill-round-96/reports/2026-10-03-audit-report.md`（下称「审计报告」）

**结论：CONDITIONAL FAIL —— 硬验收 12/12 复现为绿，但坐实 4 项阻断缺陷。**

### 1. 硬验收亲跑复现（不信自述）

轮报 §1 的 12 项读数**全部由审计窗在本机实跑复现，零虚报**：`turbo check build --force`（13/13、0 cached、EXIT=0）、三测试（138 / 126 / 46，exit 0）、`node scripts/ship-gate.mjs`（EXIT=0、828s、9 步全绿、末行 `ship gate green`）、打包 8/8、tarball shape + bin target、MCP initialize `server=anysearch v0.1.0`、T0 smoke alive、fail-open boot ok、memory-eval 126/126 且指纹 `4a529f6fbe2096c8` 吻合、gen-adr-index 97 ADRs、closeout-coverage 21/21 floor 76、claims 15/15（自建 harness 独立复推）。逐项命令与读数见审计报告 §1 表格。

### 2. 4 项阻断缺陷（均经审计窗回读源码逐行确认）

| #   | 缺陷                                                                    | 位置                                                                                        | 性质                            |
| --- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------- |
| B1  | git 不可用时 `PENDING: stack-unpushed` 被谎报为**已证实**               | `scripts/handoff-lint-verdict.mjs:244`+`:246-254`；`scripts/handoff-lint-shell.mjs:172-185` | **F8-b 同型残留**               |
| B2  | workflow 读取失败时 `PENDING: pushed-no-branch-runs` 被谎报为**已证实** | `shell.mjs:146-149`；`verdict.mjs:257`+`:264-268`                                           | **F8-b 同型残留**               |
| B3  | 5/7「封闭词表」常量为装饰性，零守卫                                     | `verdict.mjs:40/43/50/53/56-64`                                                             | ADR-0097 fail-closed 主张无守卫 |
| B4  | 4 个 RED 分支三面零覆盖；6 个 RED 码零单测覆盖                          | `verdict.mjs:213/220/273/276/327`                                                           | D-004 OPA 配对未兑现            |

机理摘要：B1 壳层 `if (gitOk)` 失败时 `branchRefs` 留 `{}`（非 `null`），判定核 `:247` 判 `refs === null` 为假 → `:254` 落 `verifiedPending: true`，且判定核全程未读快照里已存在的 `env.git.ok`。B2 壳层 catch 后返回 `{ok:false, pushBranches:[]}`，判定核只判 `wf === null` 不读 `wf.ok` → 由空数组算出「无覆盖」并落 `verifiedPending: true`。两者都把**不可证实**报成**已证实**——恰是 F8-b 被立法根除的同一形态。潜伏触发（仅环境失效时），但门禁恰恰只在环境失效时才必须不 over-claim。

### 3. 双轴 code-review（Standards + Spec，子代理并行 + 审计窗逐条复核）

- **Standards**：无代码硬伤；2 处文档化标准未满足——ADR-0069 缺指向 ADR-0097 的双向指针行（`grep -c 0097 docs/adr/0069-*.md` = 0，而 `docs/deferred-registry.json:5` 的 note 明文要求「pointer line lives in the old ADR」）、模板 `:18-20` 列表续行顶格脱钩。6 项基线坏味，其中 Primitive Obsession 与 B3 同源。
- **Spec**：纯度、GREEN 成员性判定（零 `is-ancestor`）、词表二元封闭、新鲜度仅 annotation、`EFFECTIVE_SCOPE_FLOOR=96` 文件名机检、快照同形——**六项均核验为绿**。缺失/部分 = B3/B4 + N1；未要求的行为 = N2/N3；实现看似对而实不对 = B1/B2 + N4/N5。
- **已剔除的子代理误报 1 条**（audit-checklist「零 r96/0097 出现」→ 实测 `:231` 有 1 处偶发提及）、降级 1 条（GREEN repo 合取项绕过 → 真实 run 恒有 `repository.full_name`，理论缺口非可利用绕过）。逐条见审计报告 §4.3。

### 4. 过程违规呈报（审计窗不代追认）

- **P1 轮报 §0/§3「F8 三缺陷闭环」不成立**。§3 原文「环境不可得时改 env-PENDING + 具名降级码，**永不静默**」被 B1/B2 直接推翻。正确表述：GREEN 路径与祖先性根除成立；**PENDING 自证层的环境健康度校验缺失**。
- **P2 轮报 §5「15/15 绿……非形式走过」自评不成立**。15 条 claims 全为 `symbol`/`count`/`path` 三种最弱形式，**结构上无一条能捕获 B1~B4**（`count` 类无法表达「谓词缺失」，`symbol` 类只查 token 在不在文件里，无 claim 覆盖「分支无测试」）。claims 15/15 事实为真，但证明力远低于自评。
- **P3 「验证电池全绿」与「闭环」并置产生因果暗示**。310 断言 + 15 claims 全绿与 4 项阻断并存，绿灯来自覆盖面而非正确性；轮报未声明覆盖边界。**这是本轮最值得记账的过程问题。**
- **P5 ADR-0097 的 baseline anchor 不隔离 R96**。ADR `:7` 记 `3642d494…(origin/main at round start)`，但该分支叠在 `r95-exec` 上（轮报 §6.2.2 已具名申报），故 `git diff 3642d494..HEAD` 会扫进 R95 的 18 个 commit。**该纠正只写在轮报 §6.3，ADR 与收口件均未载**——本审计窗两个子代理的初次 diff 都因此越界，已改用 `7454ba4b..HEAD` 重做。
- **P4 / P6 / P7 / P8 不追究**：「GREEN 分支真实兑现」未做（轮报自认，审计窗不追认完成）；叠栈、`$handoff` 落盘偏离、`String.raw` 写入事故——均已具名申报且处理正确。

### 5. 建议处置

**打回原修复窗口返工**（审计窗未动手改任何实现文件）。返工票 R1~R10 与逐票完成判据见审计报告 §7。**无论谁修，修完必须重跑审计报告 §1 的同一套 12 项验收**，外加三测试与 `node scripts/ship-gate.mjs`。断言数因 R3/R4 **应当上升**——**不得为凑 138/126 而删断言**；若下降须说明删了哪条覆盖、为何。

## 下一轮候选

### R97 首要待办（owner 裁定后）

1. **先清 R1~R10，再谈 R97 正题。** B1/B2 与本轮被修的 F8-b 同型；带它们 land 等于让「门禁假绿收口轮」的产物本身带上同类假绿。这是 R97 的自然第一票，且与 ADR-0029 单题性相容（仍是「门禁出口语义」一个设计面）。
2. **R1/R2 的修法须在 grill 里裁一刀**（不预设）：壳层失败时置 `null`（形状语义：null=不可得）vs 判定核加 `env.git.ok`/`wf.ok` 守卫（判定语义）。前者更贴 D-004「快照形状定死」，后者改动面更小。**不要两者都做**。
3. **B3 的修法裁形**：加真值表断言（发出 ⊆ 常量，最小）vs 把码的发出收敛为经常量断言的唯一出口（更彻底但 diff 大）。若选前者，须一并解决 §5-N3 指出的「标注串带 `run-url:`/`stack:` 前缀，永远不等于裸词表条目」——否则断言写不出来。
4. **N2 需要 ADR 动作而非仅改码**：4 个未立法 RED 码 + `stale-capture` 标注要么入 ADR-0097 与模板，要么并入既有码。这是 ADR-0097 D5 生效域边界之外的**词表**边界，性质上属于 ADR-0097 的 Corrective Supersession 出口（ADR 已预留此出口，见其 §3 回滚路径），不 Void。
5. **R97 正题候选（待 owner 选）**：`verification-unavailable:api-failed` 是否细分（ADR-0097 Known-Risk 5 自登记项，且审计发现其**漏记**了 B1 的 git-down 成因）；或另起新题。

### 长期观察项（继承自 R96，本窗复核后仍成立）

- **三态语法 GREEN 分支的真实兑现仍未做过**（P4）。land 后首个 closeout 应以 `GREEN:` 引用该轮真 run URL，作为 GREEN 合取项的首次实战——**且此时 B4 已修，GREEN 路径才真有拒绝侧回归网**。
- **`but status -fv` 行形是解析契约**（ADR-0097 Known-Risk 1）：but 升级改行形会退化为 `stack-unavailable`（env-PENDING，非误红），但须在下次 but 升级时复核。冻结样本锚在 `packages/store/test/handoff-lint-e2e.test.mjs` §E。
- **CI 恒为 env-PENDING 是设计内非阻断**；监控锚＝`[skip]` 行计数异常升高。
- **`EFFECTIVE_SCOPE_FLOOR = 96` 是棘轮**：下调即整体退回 legacy，改动须 ADR。
- **r95 栈 land 与 r96 重基**：r95-exec land `main` 后对本栈 `but pull`；land 后收口件的 `PENDING: stack-unpushed` 立即失效，须改述为真实拓扑（R95 F5R 教训）。
- **本分支叠在 `r95-exec` 之上**：直接 land r96 会连带 r95 的 18 个 commit。
- **写 markdown/JSON 禁 `String.raw` 携 `\uXXXX` 转义序列**（R96 事故，轮报 §6.2.3）。

## Known risks / deferred

### 本审计窗自身边界（不追认）

- 未跑 CI 矩阵（本机不可代跑；轮报 §1.1 已诚实标注同一边界）。
- 未逐行复核 20 个 fixture 的语义正确性，只核三面覆盖计数。
- 未核 `docs/adr/0069` 全文，只核其 `0097` 指针缺失与 D3 表述过时。
- **一处自身失误已自纠并记录**：首轮 claims 复推 harness 用 `===` 比较字符串与数字，把 5 条 `count` 类 claim 误报 FAIL（`actual=0 expect=0`）。经确认是我方 harness 类型比较缺陷、非工件缺陷，改正后 15/15 全绿。记此以免下个审计窗重复踩坑。

### 继承自 R96 的未了事项

- `verification-unavailable:api-failed` 是否细分（ADR-0097 Known-Risk 5）——审计新增证据：该码现覆盖 4 种成因，而 Known-Risk 5 只预登记了 2 种，**`:248` 的 git-down 成因未被 ADR 记录**。
- 本机 env 残留：`ANYSEARCH_ENDPOINT` 指向死回环（R86 立法归用户侧，agent 不改）。

### 台账项（不越权立案）

- 上游 finding `--live` 重跑；fundamental×cn_code 新格；全语料契约体检。

### Suggested skills

- `$implement` — R1~R10 返工通道（tdd 于判定核 seam 天然成立）。
- `$gitbutler` — 叠栈分支的重基与 land（一票一 commit；禁裸 git 写）。
- `$domain-modeling` — N2/N3 的词表边界属 ADR-0097 Corrective Supersession，需按该出口落账。
- `$code-review` — 返工后对 `7454ba4b..r96-audit` 做双轴复核（**注意用 `7454ba4b` 而非 ADR 所记的 `3642d494` 作基线，见 P5**）。
- `$handoff` — 返工收口交接。

## 交接件自检

- [x] 引用已有工件（路径）而非复述：审计报告 / ADR-0097 / ledger / claims / 轮报 / 收口件 / 模板均以仓内相对路径引用。
- [x] 脱敏：无 key / 凭证 / PII（端点仅记源类不记值）。
- [x] suggested skills 已具名。
- [x] 与 `docs/agents/handoff-template.md` 同语法（ADR-0097 三态；Stack 行三要素 + 单条状态行）。
- [x] 交接焦点已按返工清单 + R97 候选裁剪。
