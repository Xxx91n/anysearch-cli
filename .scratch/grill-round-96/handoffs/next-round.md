# Handoff — Grill Round 96 任务书（R96 F8 门禁假绿收口轮）

生成: 2026-10-02 | 轮次: R96 | 账本: .scratch/grill-round-96/decision-ledger.md（D-001~D-005 全 current）
前链: .scratch/grill-round-95/handoffs/round-95-audit-loop3-handoff.md（R95 LOOP3 PASS；F8 defer 入 R96） | registry: docs/deferred-registry.json

## 0. 数据源与纪律

- 本任务书唯一数据源=R96 账本 5 条 current 记录；实现裁量与账本冲突时以账本为准并回报，不得静默改向。
- 沿用纪律：一票一 commit、but 写操作（新开 r96-* 分支，与既有 5 栈并行互不干扰）、pathlint 冻结（committed markdown 一律仓内相对路径）、无 tag/publish。
- ADR-0029 一轮一题：本轮=F8 门禁假绿收口——ship-gate.mjs handoff-lint 腿三缺陷（模板↔门禁 PENDING 冲突 / liveness 静默折叠+祖先性冒充 / CI 拓扑使必填字段物理不可满足）同属「门禁出口语义」一个设计面，一轮闭环。
- 环境事实（已实证，勿重查）：CI 三 workflow（ci/ship-gate/native-smoke）触发器=main push+PR+dispatch，特性分支 push 恒无 run；ship-gate.yml 已 fetch-depth:0；but-id 无 trailer 无 ref，唯一通道=but status 现态解析；GitButler 下 rev-parse HEAD=workspace 合成 commit，禁止作 run head_sha 等值目标；handoff-lint 靶=文件名含 closeout/closure 的交接件，next-round 任务书豁免；closeout-claims.json 与 readout-output.json 为冻结件不追写。

## 1. 任务表（T0→T6 执行序）

### T0 轮内 goal 定锚【覆盖 D-001, D-005】
- 写 .scratch/grill-round-96/goal.md 并落首个 commit：正题边界、T0→T6 票序、范围外清单（见 §2）、环境事实（§0 段全列）。
- 时序自证：goal commit 先于一切实现 commit。

### T1 判定核模块+真值表单测【覆盖 D-002, D-003, D-004, D-005】
- 新建 scripts/handoff-lint-verdict.mjs 纯模块：输入=交接件文本+注入环境快照（git/gh/but 观测值），输出=三态+理由码+标注；核内禁 spawnSync/fs/Date.now()/process.env（采集全在壳层）。
- run-URL 字段判定（D-002）：GREEN=≥1 引用 run 满足 head_sha ∈ git rev-list origin/main..origin/<Stack具名branch> 栈内集 ∧ conclusion=success ∧ workflow∈required 名单 ∧ repo 匹配；PENDING 封闭词表=stack-unpushed / pushed-no-branch-runs（门禁离线自证谓词）；活体不可用→PENDING+verification-unavailable:{gh-missing|repo-parse|api-failed}；RED=声明-事实冲突/词表外/no-run-id/声明 GREEN 不可核验。
- Stack 行判定（D-003）：三要素=but-id∈but status 解析集 ∧ capture sha cat-file=commit ∧ 链尾 sha∈具名分支历史（membership 非 tip 等值）；RED 三码=but-id-not-resolved/sha-not-commit/chain-tail-not-in-branch；env 降级码=stack-unavailable/ref-unavailable/shallow-clone；but status 解析契约按账本 D-003④ 预写死；新鲜度界=宽松可配（量级 45d 起）。
- 迁移生效域（D-005）：round≥96 的 closeout 按新三态评，round<96 按旧 presence-only 评——生效域判据=轮次号可机检，禁写成内容豁免（No-Grandfathering，CONTEXT.md:870）。
- 测试（D-004）：packages/store/test/handoff-lint-verdict.test.mjs 穷举真值表——每判定允许+拒绝成对、降级成因各一用例、Stack 三要素 8 格、词表外值必报错、空/缺字段/超长边界；fixtures 于 packages/store/test/fixtures/handoff-lint/，单测与 E2E 共用；测试数为零=失败。

### T2 薄壳接线+E2E 冒烟【覆盖 D-002, D-003, D-004】
- scripts/ship-gate.mjs handoff-lint 腿改薄壳：采集环境快照→调判定核→报出口三步，壳内不写判定 if；快照形状定死。
- E2E fixture 冒烟锁接线（同套 fixtures，exit 非零即败）；核对 CI 可用面（fetch-depth:0 已就位；CI 无 but→Stack 腿 env-PENDING 恒标注）。

### T3 模板语法同步【覆盖 D-002, D-003, D-005】
- docs/agents/handoff-template.md：run URL 字段改三态受控写法（GREEN/PENDING{理由码}/RED 判定口径）、Stack 行三要素契约、降级标注格式、生效域边界（≥96 新语法/<96 旧 presence-only）——模板与门禁同轮同语法，消 F8-a 根因。

### T4 验收实跑+dogfooding【覆盖 D-001, D-004】
- 本机 ship-gate 全绿实证（真仓库执行=一次性人工验收，非回归手段）。
- claims 内容级抽查作 F8 修复后 dogfooding 验证步（不占正题位，D-001②）。

### T5 簿记同轮闭环【覆盖 D-005】
- ADR-0097 立法：三态语义+生效域迁移边界+Known-Risks 预写（but status 解析契约钉死 but 版本、env-PENDING 非阻断政策、新鲜度界初值、生效域自消退性）；条件措辞全部在 ADR 预注册，执行票只誊抄（Conditional-Ticket Purity）。
- CONTEXT.md 追加 `## Grill Round 96 — Terms (ADR-0097)` 词条区（候选：Effective-Scope Boundary / Verified-vs-Environment PENDING / Degradation-Cause Splitting 等——以落地实现为准立法，勿凑数）。
- CHANGELOG R96 段 + docs/deferred-registry.json 补登记 F8 行：status=closed、closed_by=ADR-0097、closed_by_adr_path、closed_at、evidence、opened_at 记 R95 发现时点（Fail-Closed Existence Assertion 双向核查所需）。
- 与 T1~T4 同轮闭环：closed_by 不得指向不存在的 ADR，模板/门禁/ADR 同轮同语法。

### T6 轮报+收口交接【覆盖 D-005】
- 收口交接件按「全绿/降格/F-bug」三态**预写骨架**（文档工作量前置，措辞取自 ADR-0097 预注册文本）。
- 轮报含验证电池实测读数（ship-gate/test/selftest），交接档指 R97 待办+坑位+suggested skills。

## 2. 显式范围外（账本约束集）

- r95-rework 分支处置、上游 finding --live 重跑、fundamental×cn_code 新格、全语料体检：台账项不入题（D-001①）。
- 不重开评测矩阵（R95 读数=证据非裁定）；不动 r88 formally-declined；closeout-claims.json/readout-output.json 冻结不追写；不代持/改凭证（D-001③）。
- PENDING 词表外扩（waived/time-boxed/doc-only 等人为豁免码）：永久禁——扩词表须改门禁代码（D-002①）。
- 迁移规则的别名映射/改写已审计件/接受轮内红窗三备选已否决（D-005⑤）。

## 3. Suggested skills

- $implement — T1/T2 判定核与薄壳接线的执行通道（tdd 于判定核 seam 天然成立）。
- $gitbutler — 全部版本控制写操作（一票一 commit；T0 时序自证须核 parent）。
- $domain-modeling — T5 CONTEXT.md 词条立法与 ADR-0097 的术语对齐纪律。
- $atomcode-research — 实现中遇外部不确定的深调通道（ctx_batch_execute 单发串行 concurrency:1；配额耗尽勿重试，续跑用 --resume）。
- $neat-freak — T6 轮末收尾复核（残留/文档同步/凭证闭环）。

## 4. 工件索引

- 账本：.scratch/grill-round-96/decision-ledger.md（唯一事实源）
- 前链：.scratch/grill-round-95/handoffs/round-95-audit-loop3-handoff.md（R95 LOOP3 PASS+F8 发现记录）
- 门禁：scripts/ship-gate.mjs（handoff-lint 腿 ~L1116-1235，现行为=F8 三缺陷本体）
- 先例件：scripts/closeout-coverage.mjs + packages/store/test/closeout-coverage.test.mjs（纯模块+node:test 形态锚）；scripts/check-workflows.mjs（yaml on: 触发器解析先例）
- 模板：docs/agents/handoff-template.md | Registry：docs/deferred-registry.json
- 词条锚：CONTEXT.md（No-Grandfathering ~L870 / Conditional-Ticket Purity / Fail-Closed Verification Gate）
- CI 拓扑：.github/workflows/{ci,ship-gate,native-smoke}.yml（触发器=main push/PR/dispatch）
