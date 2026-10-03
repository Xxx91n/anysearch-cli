# Handoff — Grill Round 96 → R97（执行轮收口交接；ADR-0097 三态语法首件）

Stack（primary key = GitButler change-ids；SHA 为 capture 时值，time-lagged）：
r96-handoff-lint → mwp (`e77b35ef` @ 2026-10-03) → lqv (`6335a5c4` @ 2026-10-03) → svk (`f9bd4ce7` @ 2026-10-03) → lsp (`c9614157` @ 2026-10-03) → ksz (`513d7d51` @ 2026-10-03) → zlr (`3ccf3f00` @ 2026-10-03) → lpu（自引用收尾 commit；SHA time-lagged 故不写入，以 `but log` 为准）—— 本栈叠于 `r95-exec` 之上（**已 ff-land 上 `origin/main`，2026-10-03 `but land r97-audit-reanchor --whole-stack` 顺带收编，land 即删 `origin/r96-handoff-lint` ref；未 PR、未 tag**）；返工与残留修复均已 amend 回各自提交（未增新 commit），故上方 SHA 为 amend 后 capture 时值，与提交消息中的历史 SHA 不同——权威值以 `but log` 为准

## 已完成

F8 三缺陷在**三态骨架层面**闭环，且审计 B1/B2 同型残留已补齐：

- **F8-a（模板↔门禁 PENDING 冲突）**：模板与门禁同轮同语法（`GREEN:` / `PENDING:<code>` 单条状态行；散文/旁注 URL 不再满足字段）；词表双向锁（模板机器可读块 ↔ `CODE_GROUPS`，E2E 断言集相等）。
- **F8-b（静默折叠 + 祖先性冒充）**：祖先性冒充根除（「本轮 run」判等改为栈内成员性；`is-ancestor` 与裸 `rev-parse HEAD` 在 ship-gate 内计数=0）。**环境健康度校验已补**：run-URL 腿与 Stack 腿均先读 `env.git.ok` / `env.workflows.ok` / 事实图存在性，**未读到的事实不再被当作已证实**（B1/B2 修复，具名降级码 `verification-unavailable:ref-unavailable`）。
- **F8-c（CI 拓扑不可满足）**：由 `PENDING: pushed-no-branch-runs`（谓词=无 workflow 的 `on.push` 覆盖该分支）与 `PENDING: stack-unpushed` 承接，均为门禁离线自证的可机检状态。

回归锁：`packages/store/test/handoff-lint-verdict.test.mjs`（305 断言）+ `handoff-lint-e2e.test.mjs`（204）+ `closeout-coverage.test.mjs`（46）= **555 断言**（返工前 310）；12 个受治理 RED 码各有 ≥1 fixture 且 ≥1 单测拒绝用例。

**返工**：审计 CONDITIONAL FAIL（4 阻断 B1~~B4）已按 R1~~R10 逐票处置并 amend 回各自提交（未增新 commit），逐票证据与断言数变化见轮报 §10。

**表述纠正（审计 P1）**：不再宣称「永不静默」已全局成立——正确表述是「三态骨架落地 + GREEN 路径与祖先性根除成立 + PENDING 自证层的环境健康度校验已补齐」，且断言绿灯是**覆盖面**证据，不等于正确性（P3）。

## 绿色 run URL（必填）

PENDING: stack-unpushed — 2026-10-03 owner 授权 B 轨逐栈 land，本栈随 `r97-audit-reanchor` `--whole-stack` ff-land 上 `origin/main`，land 即删 `origin/r96-handoff-lint` ref —— 「无 origin ref」实测为真。GREEN 仍物理不可兑现：ff-land 后 `origin/main..origin/r96-handoff-lint` 为空，栈内 commit 集为空（ADR-0098 Known-Risk 5 边界），真 GREEN 兑现待 PR 拓扑。改述史：`stack-unpushed` →（2026-10-03 push）`pushed-no-branch-runs` →（2026-10-03 land，ref 删）回本码。**该失效同样由门禁以 `declaration-fact-conflict` 当场抓出**（land 后首次运行即报 `origin/r96-handoff-lint does not exist`）。

> 旁注（非本轮 run，**不满足本字段**）：共同基底 `3642d494`（= `main` HEAD）三条绿 run 实测存在——ci https://github.com/Xxx91n/anysearch-cli/actions/runs/36741517719 success、ship-gate https://github.com/Xxx91n/anysearch-cli/actions/runs/36741517755 success、native-smoke https://github.com/Xxx91n/anysearch-cli/actions/runs/36741517873 success（均 head_sha `3642d494`）。F8 修复前这类基线 run 会满足主字段（F8-b 假绿本体）；ADR-0097 三态语法下它们只是旁注。本仓 CI 拓扑另使特性分支 push 不产出 run（F8-c）。

生成：2026-10-03（返工版） | 轮次：R96 收口 | 轮报：`.scratch/grill-round-96/reports/2026-10-02-report.md`（含返工记录） | 审计：`.scratch/grill-round-96/reports/2026-10-03-audit-report.md` | 账本：`.scratch/grill-round-96/decision-ledger.md` | ADR：`docs/adr/0097-architecture-grill-round-96-handoff-lint-three-state-exit-semantics.md`（含 Addendum A） | claims：`.scratch/grill-round-96/closeout-claims.json`

## 下一轮候选

1. **r95 栈 land 与 r96 重基（owner）**：`r95-exec` land `main` 后对本分支 `but pull`；本栈已于 2026-10-03 push（`origin/r96-handoff-lint`），**直接 land R96 会连带 r95-exec 的 19 个未 land commit**，须先重基。land 后本件 `PENDING: pushed-no-branch-runs` 立即失效（R95 F5R 教训），须改述为真实拓扑。
2. **首次真实 GREEN 兑现观察**：三态 GREEN 路径仍无真实施跑证据（本轮只有 fixture 与 legacy 实测）。land 后首个 closeout 应以 `GREEN:` 引用该轮真 run URL——此时 GREEN 四合取项的拒绝侧已有回归网（R4 已补）。
3. **`verification-unavailable` 词表再评估**：`ref-unavailable` 已拆出（N1）；若未来 `api-failed` 仍需细分，走 ADR 扩词表。
4. backlog（台账项，不越权立案）：上游 finding `--live` 重跑；fundamental×cn_code 新格；全语料契约体检。

## Known risks / deferred

- **`but status -fv` 行形是解析契约**（ADR-0097 Known-Risk 1）：行形变更会退化为 `stack-unavailable`（env-PENDING，非误红）；冻结样本锚在 `packages/store/test/handoff-lint-e2e.test.mjs` §E。
- **CI 恒为 env-PENDING**（设计内非阻断）：监控锚＝`[skip]` 行计数异常升高。
- **`EFFECTIVE_SCOPE_FLOOR = 96` 是棘轮**：下调即整体退回 legacy，改动须 ADR。
- **本分支叠在 `r95-exec` 之上**：直接 land r96 会连带 r95 的 18 个 commit；且 ADR 的基线锚不隔离 R96（见 ADR Status 的 Anchor caveat）。
- **写 markdown/JSON 禁 `String.raw` 携 `\uXXXX` 转义序列**（R96 事故，轮报 §6.2.3）。
- 本机 env 残留：`ANYSEARCH_ENDPOINT=http://127.0.0.1:20128/v1/search`（死回环，R86 立法归用户侧，agent 不改）。
- 栈前快照（动栈前已备）：`%TEMP%/r96-scratch-snap-20261002-222848`（624M，含 .scratch 全量）。<!-- machine-local: §4.4 栈前快照落机器临时目录，仓外路径 @ 2026-10-02 -->
- **deferred**：三态 GREEN 的真实施跑（见「下一轮候选」2）。

## 复跑入口（每条一条命令）

- 真值表单测：`cd packages/store && node --import tsx --test test/handoff-lint-verdict.test.mjs`（预期 `305 passed, 0 failed`）。
- E2E 接线冒烟：`cd packages/store && node --import tsx --test test/handoff-lint-e2e.test.mjs`（预期 `204 passed, 0 failed`）。
- 既有腿未破：`cd packages/store && node --import tsx --test test/closeout-coverage.test.mjs`（预期 `46 passed, 0 failed`）。
- 全量 check/build：`pnpm -w turbo check build --force`（预期 `13 successful, 13 total`）。
- 门禁全跑：`node scripts/ship-gate.mjs`（预期 exit 0）。
- claims 复推：按 `.scratch/grill-round-96/closeout-claims.json` 逐条跑，预期全绿。

## Suggested skills（下一 agent 按需调用 Skill 工具）

- `$implement` — 续轮实现通道（tdd 于判定核 seam 天然成立）。
- `$gitbutler` — 叠栈分支的重基与 land（一票一 commit；禁裸 git 写）。
- `$code-review` — 对 R96 自有 commit 集做双轴复核（**不要用 `3642d494` 或 `7454ba4b` 作基线**，见 ADR Status 的 Anchor caveat）。
- `$domain-modeling` — 若 R97 新增术语，对齐 CONTEXT 词条区。
- `$handoff` — R97 收口交接。

## 交接件自检（handoff skill 要求）

- [x] 引用已有工件（路径）而非复述：轮报/审计/ADR/ledger/claims/测试均以路径引用。
- [x] 脱敏：无 key / 凭证 / PII（端点记源类不记值）。
- [x] suggested skills 已具名。
- [x] 与 `docs/agents/handoff-template.md` 同语法（ADR-0097 三态；Stack 三要素 + 单条状态行）。
- [x] 标题骨架与模板 Required header 逐项一致（`## 已完成` / `## 绿色 run URL（必填）` / `## 下一轮候选` / `## Known risks / deferred`）—— R6 修正。
