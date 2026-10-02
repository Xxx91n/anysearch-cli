# R96 Goal — F8 门禁假绿收口轮

生成: 2026-10-02 | 轮次: R96 | 分支: r96-handoff-lint
账本: .scratch/grill-round-96/decision-ledger.md（D-001~D-005 全 current，唯一事实源）

## 正题边界（D-001）

R96 正题 = F8 门禁假绿收口，专修 `scripts/ship-gate.mjs` handoff-lint 腿三缺陷。三缺陷同属「门禁出口语义」一个设计面，一轮闭环（ADR-0029 单题性）：

- **F8-a 模板↔门禁 PENDING 冲突**：`docs/agents/handoff-template.md` 允许「PENDING — stack unpushed」诚实写法，而门禁 `scripts/ship-gate.mjs` L1205-1208 恒要求「绿色 run URL」段 + 至少一条 `actions/runs/<id>` URL——模板与门禁语义互斥。
- **F8-b liveness 静默折叠 + 祖先性冒充**：gh/repo 不可用时该腿静默降级（`report("pass", ... "(liveness leg skipped)")`），且用 `merge-base --is-ancestor sha HEAD` 的**祖先性**冒充「本轮 run」的**等值/栈内成员性**；等值目标用裸 `rev-parse HEAD`（GitButler workspace 合成 commit，自指悖论）。
- **F8-c CI 拓扑使必填字段物理不可满足**：三 workflow 触发器 = main push / PR / dispatch，特性分支 push 恒不产出 run → 交接件无论 push 与否都无「本轮 run URL」可填。

## 票序 T0→T6

| 票 | 内容 | 覆盖 D-xxx |
|----|------|-----------|
| T0 | 轮内 goal 定锚（本件）+ 首个 commit 时序自证 | D-001, D-005 |
| T1 | 判定核纯模块 `scripts/handoff-lint-verdict.mjs` + 真值表单测 + fixtures | D-002, D-003, D-004, D-005 |
| T2 | `scripts/ship-gate.mjs` handoff-lint 腿改薄壳 + E2E 冒烟 | D-002, D-003, D-004 |
| T3 | `docs/agents/handoff-template.md` 语法同步 | D-002, D-003, D-005 |
| T4 | 验收实跑 + claims 抽查 dogfooding | D-001, D-004 |
| T5 | 簿记同轮闭环（ADR-0097 + CONTEXT 词条 + CHANGELOG + registry） | D-005 |
| T6 | 轮报 + 收口交接 | D-005 |

## 范围外（D-001 约束集，不入题）

- r95-rework 分支处置、上游 finding --live 重跑、fundamental×cn_code 新格、全语料体检：台账项不入题。
- 不重开评测矩阵（R95 读数=证据非裁定）；不动 r88 formally-declined。
- `closeout-claims.json` / `readout-output.json` 冻结不追写；不代持/改凭证。
- PENDING 词表外扩（waived/time-boxed/doc-only 等人为豁免码）永久禁——扩词表须改门禁代码（fail-closed）。
- 迁移规则的别名映射/改写已审计件/接受轮内红窗三备选已否决。

## 环境事实（已实证，勿重查）

- CI 三 workflow（ci / ship-gate / native-smoke）触发器 = main push + PR + dispatch；特性分支 push 恒无 run（`gh run list --branch r95-exec` 空，实测）。
- `ship-gate.yml` 已 `fetch-depth: 0`。
- but-id 无 trailer 无 ref，唯一通道 = `but status` 现态解析。
- GitButler 下 `rev-parse HEAD` = workspace 合成 commit，禁作 run head_sha 等值目标。
- handoff-lint 靶 = 文件名含 closeout/closure 的交接件；next-round 任务书豁免。
- `closeout-claims.json` 与 `readout-output.json` 为冻结件不追写。
- WORKFLOW.md §4.2 全盘搜索确认不存在（R60/R70/R75/R77/R78/R79 等八次先例核销），以 gitbutler SKILL + 全局 but 协议等价覆盖。

## 版本控制纪律

- 一票一 commit；全部写操作走 `but`（新开 r96-handoff-lint 分支，与既有 5 栈并行互不干扰）；禁裸 git 写命令；不 push 不 PR 无 tag。
- pathlint 冻结：committed markdown 一律仓内相对路径（machine-local 路径须带 governed marker）。
