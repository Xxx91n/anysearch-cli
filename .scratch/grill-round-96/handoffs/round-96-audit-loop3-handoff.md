# Handoff — R96 审计 LOOP 3（残留已修，门禁绿）→ **R97 grill 入口**

> **本件是下一次 grill（R97）的权威入口。** 优先级：LOOP3（本件）> LOOP2 > LOOP1 > `round-96-closeout.md`（轮级收口记录，不含审计结论）。
> 审计轨迹：`.scratch/grill-round-96/reports/2026-10-03-audit-report.md`（LOOP1，CONDITIONAL FAIL）→ `…-audit-loop2-report.md`（LOOP2，PASS）→ 本轮 LOOP3（残留修复 + 门禁复验）。

Stack（primary key = GitButler change-ids；SHA 为 capture 时值，time-lagged）：
`r96-audit-loop2` → xqx（LOOP2 报告 + LOOP2/LOOP1 交接件）
`r96-audit` → zky（LOOP1 报告 + LOOP1 交接件；已被 `r96-audit-loop2` 吸收为下段，非独立栈顶）
被审计对象：`r96-handoff-lint` → mwp → lqv → svk → lsp → ksz → zlr → lpu（7 commit，权威 SHA 以 `but log r96-handoff-lint` 为准）——叠于 `r95-exec` 之上
文档残留修复已 **amend 回各自提交**（F2/F3 + §10.2/§10.3 → `lpu`；F1 → `ksz`），**未新增 commit**，R96 仍是 7 个 commit

## 绿色 run URL（必填）

PENDING: stack-unpushed — 本审计窗的三个栈（`r96-audit-loop2` / `r96-audit` / `r96-handoff-lint` / `r96-grill-docs`）在写下本行时均无 `origin/<branch>` ref，谓词可离线自证：`git rev-parse --verify --quiet refs/remotes/origin/r96-audit-loop2` 非零。

> ⚠️ **push 后本行立即失效**：若本审计窗执行了 push，本行须按门禁可自证的谓词改述为 `PENDING: pushed-no-branch-runs`（ref 存在 ∧ 无 workflow 的 `on.push` 覆盖特性分支）。**这正是 R95 F5R 教训与 R97 候选正题本身。**

> 旁注（非本轮 run，不满足本字段）：共同基底 `3642d494` 的三条绿 run 仍是 main 基线 run，head_sha 不在栈成员集内 —— ADR-0097 三态语法下只作旁注。

## 已完成

### 1. LOOP 2 残留 4 项已全部处置（owner 授权审计窗顺手修，纯文档）

| 发现                                                                       | 处置                                                                                                                                                                                         |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **F1** ADR-0097 Anchor caveat 的实测文件数不可复现（记 70/63，实测 78/71） | **删数字、留不变量**：① 任何两树 diff 都无法隔离单轮；② 从 workspace HEAD 量出的文件数只在测量瞬间有效，不得作为立法文本（与 R95 F5R 同型）。权威方法改为逐 commit 文件集 / 路径 scoped diff |
| **F2** 轮报 §6.3 仍写「20 fixtures」                                       | 改 **27** 并注明返工前 20、新增 7 个覆盖 R1/R2/R4                                                                                                                                            |
| **F3** 轮报 §8 仍推荐用 `3642d494..r96-handoff-lint` 做双轴复核            | 改为「基线不要用任何两树 diff」+ 指向逐 commit 文件集 / 路径 scoped diff                                                                                                                     |
| **F4** 审计窗 LOOP1 交接件的 7 个 capture SHA 因返工 amend 全部失准        | 审计窗自行追述，but-id 链为主键不变                                                                                                                                                          |

### 2. LOOP 3 门禁复验：全绿

`node scripts/ship-gate.mjs` → **exit 0 / 541s / `[pass] ship gate green`**；claims **21/21** · canonical-json byte-identical · gen-adr-index 97 · closeout-coverage 21/21 · path-lint **612 docs 0 violation** · handoff-lint `exitKind=pass`（legacy GREEN + three-state PENDING）· turbo check 13/13、test 13/13、build 5/5。

### 3. 修复过程中被门禁当场抓住的一次真实回归（审计窗自申报，重要）

F1 改写 Anchor caveat 首句时写成 `No two-tree diff isolates a single round.`（首字母大写），使返工窗登记的机械锚 claim `r96-t5-adr-addendum-a`（`symbol` 类）token 失配，`ship-gate` step 1 立刻红。处置：**改回 ADR 措辞**（token 连续同行不折行），**不动 claims 文件**——它是返工窗登记的证据，审计窗无权为迁就自己的改写去改证据锚。修后 21/21 复绿。

### 4. R96 轮整体状态：可 land

B1~~B4 四项阻断真修复（LOOP2 逐条回读源码复核）；N1~~N4/N7/R5~R10 落地；P1/P2/P3 措辞纠正改掉了结论本身。返工净增 245 断言（310 → 555），**零删除**。

## 下一轮候选

### R97 正题建议（**强烈建议取这条**）：把「自造失效声明」立法为可机检类别

**这是同一族缺陷第 3 次出现**，且三次都靠人工审计抓到，没有一次是机器抓的：

| 轮次              | 形态                                                   | 为何机器抓不到                                       |
| ----------------- | ------------------------------------------------------ | ---------------------------------------------------- |
| R95 F5R           | push 动作本身使「未 push」声明失效                     | 文档层自造矛盾，无声明可机检                         |
| R96 P5 → LOOP2 F1 | ADR 立法段写入会自行失效的实测值（70/63 → 实测 78/71） | ADR 无「数值须带测量命令与复现锚」的规则             |
| R96 §10.3（本次） | 改写立法文本**静默打断钉在它上面的机械锚 claim**       | claims 只锚 token 存在，不锚「改写是否仍满足原语义」 |

**可机检的候选形态**（三选一或合并，交给 grill 裁）：

- **声明-动作一致性**：凡文档写「未 push / 未 land / 无 ref」，须存在对应机械锚（ref 查询命令）；push 后须自动失效或被显式追述。
- **立法数值的时效契约**：凡写进 ADR/CHANGELOG 的实测数值，须同段给出复现命令或权威查询；无者由门禁腿标红（**注意：这是内容规则，须先立法再机检，且要避免重演 F1 的措辞改写事故**）。
- **机械锚的语义锁**：claim 除 token 存在外，增「该 token 所在句必须仍是可执行不变量」的断言（对 ADR 关键句而言即：不得被改写为更弱的表述）。

**为什么值得单开一轮**：R96 把门禁腿修到位了（GREEN 成员性、封闭词表真守卫、OPA 拒绝侧覆盖），但**门的可信度上限取决于喂给它的声明是否诚实**，而这一层三轮全靠人盯。ADR-0029 单题性相容 —— 三次同属「声明可信度」一个设计面。

### 若不取该正题（备选，由 owner 选）

1. **F1/F2/F3 已在本轮收掉，无遗留。**
2. **三态语法 GREEN 分支的真实兑现仍未做过** —— land 后首个 closeout 应以 `GREEN:` 引用该轮真 run URL；此时 B1~B4 已修，GREEN 路径才真正有拒绝侧回归网，是第一次有意义的兑现观察。
3. **`verification-unavailable:api-failed` 覆盖的成因是否再细分**（ADR-0097 Known-Risk 5）。N1 已拆出 `ref-unavailable`，余下成因待裁。
4. 台账项（不越权立案）：上游 finding `--live` 重跑；fundamental×cn_code 新格；全语料契约体检。

## Known risks / deferred

### 版本控制现状（**下一位接手者必读**）

- **R96 未 land**：origin/main 仍在合并基点 `3642d494`，R96 的 7 个 commit 未进主线。
- **`r96-handoff-lint` 叠在 `r95-exec` 之上**（19 commit 未 land），R96 自身相对 `r95-exec` 独有 7 commit。**直接 land R96 会连带 R95 的 19 个 commit** —— 应先 `r95-exec` land main，再对本栈 `but pull` 重基。
- **「已合并分支」集合为空**：实测 `origin/main` 自合并基点以来新增 0 commit，**没有任何 R95/R96 分支已合并进 main**。故不存在可安全删除的已合并分支。语义上冗余但**未合并**的候选只有一个：`r95-rework`（相对 `r95-exec` 独有 0 commit，但相对 main 独有 13 commit）—— R95 LOOP3 已实测该分支在 GitButler 工具面下**不可安全删除**（`but uncommit` 报 merge conflicts 拒绝；`but move --unstack` 会在 `r95-exec` 上留 conflict，已 undo 回退）。风险为零但需 owner 决定，处置选项见 R95 LOOP3 交接件。
- **push 会使交接件的 `PENDING: stack-unpushed` 立即失效** —— 改述规则见本件「绿色 run URL」节的警告框。这是 F5R 同族，**不要留给下一个接手者发现**。

### 本审计窗自身失误（三起，均已当场自纠并记账）

1. LOOP1 claims harness 用 `===` 比较字符串与数字，把 5 条 `count` 类 claim 误报 FAIL。
2. LOOP2 首跑把 `turbo check build --force` 与三套测试**并发**执行，触发 `dsh-plugin`/`mcp` 构建 heap OOM（exit 9）；单独重跑 `EXIT=0 / 13/13`，系审计窗自身争用，**非工件缺陷**。
3. LOOP3 修 F1 时改写 ADR 措辞，打断了返工窗登记的 claim `r96-t5-adr-addendum-a` 机械锚（被 `ship-gate` step 1 当场抓住，已改回 ADR 措辞而非改证据锚）。

### 继承项（两轮复核后仍成立）

- **`but status -fv` 行形是解析契约**（ADR-0097 Known-Risk 1）：but 升级改行形会退化为 `stack-unavailable`（env-PENDING，非误红），须在下次 but 升级时复核。冻结样本锚在 `packages/store/test/handoff-lint-e2e.test.mjs`。
- **CI 恒为 env-PENDING 是设计内非阻断**；监控锚＝`[skip]` 行计数异常升高。
- **`EFFECTIVE_SCOPE_FLOOR = 96` 是棘轮**：下调即整体退回 legacy，改动须 ADR。
- **写 markdown/JSON 禁 `String.raw` 携 `\uXXXX` 转义序列**（R96 事故，轮报 §6.2.3）。
- **返工期写作者失误模式**：以 4 参调用 `rep()` 会静默吞掉源码行（两次），均由 fixture/单测当场抓住。若后续还有批量文本改写，**先跑测试再 amend**。

### 本审计窗未做（不追认）

- 未跑 CI 矩阵（本机不可代跑）。
- 未逐行复核 27 个 fixture 的语义正确性，只核三面覆盖计数与 `emitCode` 闸的存在性。
- 未独立复跑「守卫抛错负例」单测用例。
- 未核 ADR-0097 Addendum A 的 A1/A2 条文与代码逐码对应。

### Suggested skills

- `$grill-with-docs` — R97 若取「自造失效声明可机检类别」，需要 grill + 同步产出 ADR/CONTEXT 词条，正配此 skill。
- `$domain-modeling` — 该正题需新增术语（三次同族缺陷需要一个统一词条），按 CONTEXT 词条区纪律落账。
- `$implement` — 正题立法后的机检腿实现通道。
- `$gitbutler` — r95-exec land 后的重基、push、以及分支处置（一票一 commit；禁裸 git 写）。
- `$neat-freak` — 若只想收尾 R96 文档面，本件已列全部残留（当前为空）。

## 交接件自检

- [x] 引用已有工件（路径）而非复述：三份审计报告 / 轮报 §10.2/§10.3 / ADR-0097 / ledger / claims / 模板均以仓内相对路径引用。
- [x] 脱敏：无 key / 凭证 / PII。
- [x] suggested skills 已具名。
- [x] 与 `docs/agents/handoff-template.md` 同语法（ADR-0097 三态；Stack 行以 but-id 为主键）。
- [x] 交接焦点已按「残留已清 + R97 正题候选 + 版本控制现状」裁剪。
- [x] 权威性声明：本件明示优先级，避免下一位接手者读到过期交接。
