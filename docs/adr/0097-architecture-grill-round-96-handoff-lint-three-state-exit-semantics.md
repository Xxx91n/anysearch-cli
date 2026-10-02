# ADR-0097: Grill Round 96 — handoff-lint 门禁假绿收口（三态受控出口语义 + 生效域迁移）

R96 为 F8 门禁假绿收口轮：`scripts/ship-gate.mjs` handoff-lint 腿的三缺陷（模板↔门禁 PENDING 冲突 / liveness 静默折叠+祖先性冒充 / CI 拓扑使必填字段物理不可满足）同属「门禁出口语义」一个设计面，一轮闭环（ADR-0029 单题性）。出口语义从「必填 URL 的存在性」重构为**三态受控判定**（GREEN / PENDING{封闭理由码} / RED）；判定核抽为纯模块，以真值表单测 + E2E 冒烟锁死；模板与门禁同轮同语法。

## Status

Accepted (grill round r96; 执行票序 T0→T6 per `.scratch/grill-round-96/handoffs/next-round.md`). Ledger: `.scratch/grill-round-96/decision-ledger.md` (D-001~D-005, all `current`). Goal: `.scratch/grill-round-96/goal.md`. Baseline anchor: `3642d49445e5a24eb77413fc05912329accaf9ac` (origin/main at round start).

**Anchor caveat (audit P5 / R9, added 2026-10-03; the file counts originally recorded
here were dropped by audit LOOP 2 finding F1 — see `.scratch/grill-round-96/reports/2026-10-03-audit-loop2-report.md` §5 F1):
this anchor does NOT isolate R96.** The execution branch is stacked on the unlanded
`r95-exec`, so any two-tree diff taken from a merge base carries R95's unlanded
work — including the first audit's suggested `7454ba4b..HEAD`, which narrows the
file set but does not isolate it. The GitButler workspace HEAD is a synthetic merge
of every applied independent stack (R96 exec, R96 grill docs, R95 exec/rework/grill
docs, and the audit windows themselves), and its composition changes whenever a
stack is added or amended. Two consequences, both stable:

1. **Round isolation fails for every two-tree diff** — no two-tree diff isolates a single round. Review R96 by the per-commit file set
   (`but status -fv`) or by a path-scoped diff; both are stack-independent.
2. **A file count measured from the workspace HEAD is valid only at the instant of
   measurement.** Do not record such a count as legislative text; it self-invalidates
   (the same shape as the R95 F5R lesson). If a count is wanted for a one-off note,
   carry it in the round report with its measurement command, not here.

Recorded here (not only in the round report) so the next reader does not repeat the
out-of-scope diff.

## Context

handoff-lint（ADR-0069）以「存在性 + 活体祖先性」判交接件的必填字段。R95 审计 F8 坐实三类假绿：

1. **F8-a 模板↔门禁冲突**：`docs/agents/handoff-template.md` 允许「PENDING — stack unpushed」的诚实写法，而门禁恒要求至少一条 `actions/runs/<id>` URL——两者语义互斥，诚实者恒红、不诚实者恒绿。
2. **F8-b 静默折叠 + 祖先性冒充**：`gh` / repo 不可用时该腿打印 `(liveness leg skipped)` 后仍报 pass；判定用 `merge-base --is-ancestor <sha> HEAD` 的**祖先性**冒充「本轮 run」的**等值/栈内成员性**，故 main 基线 run 天然满足；等值目标用裸 `rev-parse HEAD`，而 GitButler 下它是 workspace 合成 commit（自指悖论）。实测：R95 交接档以旁注形式的 main 基线 run 满足了门禁主字段。
3. **F8-c 拓扑不可满足**：三个 workflow 的触发器为 `push: branches: [main]` / `pull_request` / `workflow_dispatch`，特性分支 push 恒不产出 run（`gh run list --branch r95-exec` 空，实测）——「本轮 run URL」在特性分支上物理不可得。

三缺陷同源：出口把「不可证实」与「已证实为假」混为一谈，且把无法满足的必填项留作死结。

## Decision

### D1 — 出口语义：封闭三态 GREEN / PENDING{理由码} / RED

run-URL 字段改为**一条显式状态行**的受控语法（模板「绿色 run URL」节）：

- **GREEN**：`GREEN: <run URL>...`。门禁仅在**至少一条**引用 run 同时满足四条件时接受：`head_sha` 属于 `git rev-list origin/main..origin/<Stack 具名分支>`（栈内独有 commit 集，有界祖先性——main 基线 run 天然排除）∧ `conclusion=success` ∧ `workflow ∈ {ci, ship-gate}` ∧ repo 匹配本仓。否则 RED `green-claim-falsified`。
- **PENDING**：`PENDING: <code>`，code 取**封闭二元词表** `stack-unpushed` / `pushed-no-branch-runs`，谓词由门禁离线自证：前者=具名分支无 `origin/<branch>` ref；后者=ref 存在 ∧ 无 workflow 的 `on.push` 覆盖该分支（F8-c 的机械形态）。谓词与事实冲突 → RED `declaration-fact-conflict`；词表外或缺失理由码 → RED `pending-reason-out-of-vocabulary`。
- **RED**：门禁自判，永不手写。含声明-事实冲突、词表外理由、URL 在但提取不出 id、缺状态行。

**散文/旁注中的 URL 不再满足字段**（F8-b 的静默折叠在此封口）。不设第四态、不设 waived/time-boxed/doc-only 等人为豁免码——扩词表须改门禁代码（fail-closed，D-002①）。

### D2 — Stack 行：三要素分级校验 + 环境分级降级

`<branch> → <but-id> (<sha> @ <date>) → ...` 链逐元素机检：

1. 每 `but-id` ∈ `but status -fv` 解析集 → 否则 RED `but-id-not-resolved`；
2. 每 capture sha `git cat-file -t` = `commit` → 否则 RED `sha-not-commit`；
3. 链尾 sha ∈ `git rev-list origin/main..origin/<branch>`（**membership 非 tip 等值**，容忍 gate 晚跑新增 commit——即 F5R「缺尾」型的机械杀手）→ 否则 RED `chain-tail-not-in-branch`。

环境分级：本地全验（`but` 可执行 ∧ exit 0 ∧ workspace 属本仓）/ CI 及无 `but` 环境 **git 层校验照跑** + 显式降级码 `stack-unavailable` / `ref-unavailable` / `shallow-clone`。链元素可合法省略 sha（自引用收尾 commit / time-lagged capture），省略本身非违规。

`but status` 解析契约预写死：首 token=CLI id、commit 行以 change-id 或 sha 前缀开头、`(sha …)` 仅 informational；无 change-id 行与 capture sha 交叉验证本身非 RED。change-id 无 trailer 无 ref，唯一通道=现态解析——时限语义诚实标注（Known-Risk 1）。

### D3 — 回归锁形态：纯判定核 + 薄壳 + 真值表单测 + 薄 E2E

- **判定核** `scripts/handoff-lint-verdict.mjs`：输入=交接件文本 + 注入环境快照，输出=三态+理由码+标注。**核内禁** `spawnSync` / `fs` / `Date.now()` / `process.env`（采集全在壳层），故真值表可在无仓库、无网络、无时钟下穷举。
- **薄壳** `scripts/handoff-lint-shell.mjs`：只做「采→传→出口」三步，壳内不写判定分支；快照形状冻结（E2E 以同形状注入，形状漂移即红）。
- **真值表单测** `packages/store/test/handoff-lint-verdict.test.mjs`：OPA 允许+拒绝成对、降级成因各一、Stack 三要素 8 格全枚举、词表外必报错、空/缺字段/超长边界。
- **薄 E2E 冒烟** `packages/store/test/handoff-lint-e2e.test.mjs`：同一套 fixtures 走**完整壳层路径**（仅进程边界打桩），锁「判定对但接线错」型。
- fixtures 共用：`packages/store/test/fixtures/handoff-lint/`。**测试数为零=失败**（fail-on-empty 红线）；fixture/冒烟 exit 非零即 CI 失败；真实仓库手跑降级为发布前一次性人工验收（D-004）。

### D4 — 生效域迁移边界（非内容豁免）

新三态语法适用于 **round >= 96** 的 closeout；**round < 96** 按旧 presence-only 规则评（无活体核验）。判据=**轮次号可机检**（文件名），不是内容匹配；`EFFECTIVE_SCOPE_FLOOR = 96` 为 ADR 记录的常量，改动须 ADR（棘轮防篡改）。lint 靶位=最新含 closeout 的轮目录，故豁免自失效、零残留。

这是**生效域划定**，不是 grandfathering：不设别名映射、不改写已审计件、不接受轮内红窗（No-Grandfathering，CONTEXT.md「No-Grandfathering」词条；D-005①）。

### D5 — 同轮闭环与簿记

`docs/agents/handoff-template.md` 语法同步（T3）+ ADR-0097（本件）+ CONTEXT 词条区 + CHANGELOG r96 段 + `docs/deferred-registry.json` 补登记 F8 行（`status=closed`、`closed_by=ADR-0097`、`closed_by_adr_path`、`closed_at`、`evidence`、`opened_at` 记 R95 发现时点）同轮完成，`closed_by` 不得指向不存在的 ADR（Conditional-Ticket Purity：条件措辞在本 ADR 预注册，执行票只誊抄）。

### D6 — 收口件三态预写骨架（条件措辞预注册）

T6 收口交接按下列三态之一落笔，措辞取本件预注册文本（执行票只誊抄，禁临场拟）：

- **全绿**：`F8 三缺陷闭环；handoff-lint 腿三态判定落地；round 96 closeout 以新语法通过；验证电池全绿。`
- **降格**：`F8 三缺陷闭环；<具名腿> 因 <具名环境事实> 落 env-PENDING（非阻断，带降级码）；其余全绿。`
- **F-bug**：`F8 修复后仍见 <具名缺陷>；已按 <具名证据> 记账；未宣称闭环。`

## Known-Risks（轮前预写，均先于实现落地）

1. **`but status` 解析契约钉死 but 版本**：解析依赖 `but status -fv` 的行形（bullet + CLI id 首 token + change-id/date 列）。but 版本升级若改行形，元素 (i) 会退化为 `stack-unavailable`（env-PENDING，非误红）而非静默假绿——失效方向安全，但须在下次 but 升级时复核；契约测试（E2E §E）以冻结行文样本锚定。
2. **env-PENDING 非阻断政策**：CI 无 `but`、PR checkout 无 `origin/<branch>`，故环境降级在 CI 恒发生。政策=非阻断但**显式标注**（Observable Fail-Open）；反向风险是「降级成了常态出口」，监控锚=每次运行的 `[skip]` 行计数，异常升高须人工复核。
3. **新鲜度界初值**：`STACK_CAPTURE_MAX_AGE_DAYS = 45`（宽松可配，经 env 注入）。过紧会误产 PENDING、轮间反复 lint；过松使「早已失效」伪装「晚跑」。超龄仅落 annotation，**永不产生 RED**（RED 词表封闭于三码）——故该界是卫生信号而非判定。
4. **生效域自消退性**：round < 96 的 legacy 分支随轮次推进自然无人命中（lint 靶位=最新轮目录），最终可删；在删除前它是一段**有意的历史兼容**，不是待清理的豁免。
5. **`verification-unavailable:api-failed` 的语义边界**：该码覆盖「活体核验输入不可得」——含 gh API 失败与栈成员集不可得（未 fetch 具名 ref）。它是 D-002 封闭词表内的最贴近项，非精确命名；若未来需要区分，须走 ADR 扩词表。

## Execution Record & Outcome Completion

### 1. 票序与产物双锚表

| 票           | 类型 | 产物                                                                           |
| ------------ | ---- | ------------------------------------------------------------------------------ |
| T0 目标      | docs | `.scratch/grill-round-96/goal.md`（goal commit 先于一切实现 commit，时序自证） |
| T1 判定核    | feat | `scripts/handoff-lint-verdict.mjs` + 真值表单测 + 共用 fixtures                |
| T2 薄壳接线  | feat | `scripts/handoff-lint-shell.mjs` + `scripts/ship-gate.mjs` 腿改薄壳 + E2E 冒烟 |
| T3 模板同步  | docs | `docs/agents/handoff-template.md` 三态语法                                     |
| T4 验收实跑  | —    | 全量 check/build/test + ship-gate 读数（见轮报）                               |
| T5 簿记      | docs | 本 ADR + CONTEXT 词条区 + CHANGELOG r96 段 + registry F8 closed 行             |
| T6 轮报+交接 | docs | `.scratch/grill-round-96/reports/` + 收口交接（按 D6 三态骨架）                |

### 2. 词条区（CONTEXT.md `Grill Round 96 — Terms (ADR-0097)`）

`Three-State Exit Semantics` / `Verified-vs-Environment PENDING` / `Effective-Scope Boundary` / `Ancestry-vs-Membership Identity` / `Degradation-Cause Splitting`。

### 3. 回滚路径

三处可独立回滚：核（`handoff-lint-verdict.mjs`）、壳（`handoff-lint-shell.mjs`）、模板。回滚门禁=还原 ship-gate 腿至存在性判定；`EFFECTIVE_SCOPE_FLOOR` 下调即整体退回 legacy。回滚须 ADR（本件 Corrective Supersession 出口，不 Void）。

## Addendum A — R96 返工（审计 2026-10-03，R1~R10）

An independent audit window returned CONDITIONAL FAIL with four blockers (B1~~B4)
plus documentation and process findings. This addendum records the corrections the
rework made to the decisions above. D1~~D6 stay as legislated and are EXTENDED here
rather than rewritten (this round's ADR is still in flight, so the correction is
an in-place append; a landed ADR would take the Corrective Supersession exit).

### A1 — RED vocabulary completed (N2)

D1 named the RED outcome but not every code. The closed RED vocabularies are now
enumerated in the template's machine-readable block and in the template prose:

- run-URL leg: `run-url-section-missing` / `run-url-state-line-missing` /
  `run-url-state-ambiguous` / `run-url-unparseable` /
  `pending-reason-out-of-vocabulary` / `declaration-fact-conflict` /
  `green-claim-falsified`
- Stack leg: `stack-line-missing` / `stack-chain-empty` / `but-id-not-resolved` /
  `sha-not-commit` / `chain-tail-not-in-branch`

### A2 — Degradation vocabulary: cause split + advisory code (N1 / N3)

`VERIFICATION_UNAVAILABLE_CODES` gains `ref-unavailable`, so four causes are no
longer folded into `api-failed` (D-002 item 5 forbids one shared skip wording):

| code              | cause                                  |
| ----------------- | -------------------------------------- |
| `gh-missing`      | no `gh` binary                         |
| `repo-parse`      | the repo could not be resolved         |
| `ref-unavailable` | the origin-ref facts could not be read |
| `api-failed`      | the live API calls failed              |

`stale-capture` is registered as its own advisory vocabulary
(`STACK_ADVISORY_CODES`): never blocking, never reddening, but a governed code
rather than free-form annotation text.

### A3 — “A fact that could not be read proves nothing” (B1 / B2)

The PENDING self-verification layer now consults `env.git.ok` and
`env.workflows.ok` before reporting a declared reason as VERIFIED. An environment
that could not be read degrades to `verification-unavailable:*` instead of
`verifiedPending: true`. The same rule is applied to the GREEN path's membership
lookup and to the Stack leg's object-map lookup: an ABSENT fact map is a shape
gap (degrade), never an empty map (which would manufacture a false RED).

### A4 — The vocabularies are executable invariants (B3)

Every code is emitted through `emitCode(vocabulary, code)`, which throws when the
code is not in the governing constant, and `CODE_GROUPS` registers every
vocabulary so a constant cannot be orphaned. The template carries a
machine-readable vocabulary block that `packages/store/test/handoff-lint-e2e.test.mjs`
asserts set-equal to `CODE_GROUPS` in both directions — adding a code on either
side alone turns the suite red. That is what makes D1's “extending the vocabulary
requires a gate code change” enforceable rather than aspirational.

### A5 — Baseline anchor does not isolate R96 (P5)

See the Status caveat above: `3642d494` is origin/main, not R96's base, because
the execution branch is stacked on the unlanded `r95-exec`. Measured: `git diff
3642d494..HEAD` = 70 files; `7454ba4b..HEAD` = 63 files (still carries R95). No
two-tree diff isolates one round in this workspace — use the per-commit file set.

### A6 — Regression net widened (B4 / R4)

All twelve governed RED codes now have at least one fixture AND one unit-test
rejection case, and the closure sweep asserts that every emitted code belongs to
a vocabulary constant. Assertion counts rose (310 → 555 across the three suites);
no assertion was deleted to hit a number.
