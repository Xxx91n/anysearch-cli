# Handoff — Grill Round 95 任务书（R95 评测矩阵修订轮）

生成: 2026-10-01 | 轮次: R95 | 账本: .scratch/grill-round-95/decision-ledger.md（D-001~D-005 全 current）
前链: .scratch/grill-round-94/handoffs/round-94-final-handoff.md | registry: docs/deferred-registry.json

## 0. 数据源与纪律

- 本任务书唯一数据源=R95 账本 5 条 current 记录；实现裁量与账本冲突时以账本为准并回报，不得静默改向。
- 沿用纪律（D-001）：一票一 commit、票级熔断、pathlint 冻结、无 tag/publish、but 版本控制；deprecate 外发 EOTP 不代跑。
- ADR-0029 一轮一题：本轮=评测矩阵修订轮，diff 最小化（D-002：语料 diff 仅 vert-f1105 一格）。

## 1. 任务表（T1→T8 执行序）

### T1 语料修订【覆盖 D-002, D-005】
- vert-f1105 原位降格为 unmeasured-by-design，移出可测集（语料 57→56）；墓碑理由码=受控词表值 `upstream-validator-vs-doc-mismatch`（禁自由文本，防拼写漂移）。
- 指纹滚动：{id,spec,expectation,scope} sha256-hex16 重算新指纹。
- 实证底稿：.scratch/grill-round-95/q2-research.md（2026-10-01 活查：validator 按 tag 级索 cn_code，与词表文档 per-type 规则不一致）。
- 生成器：.scratch/grill-round-84/gen-corpus.mjs（vert-f1105 在 L46）；上游词表快照：.scratch/grill-round-84/evidence/sub-domains-vocab.json。
- 禁：同 id 换芯（格语义实质变更须新 id）；expect 落运行期不存在的语义。

### T2 prereg-matrix.md【覆盖 D-003, D-005】
- 写 .scratch/grill-round-95/prereg-matrix.md 并落 commit——**先于任何 delta 跑数**（SAP-先于-database-lock）；该 commit 的 parent 必须已含 T1 语料 diff（时序自证条款）。
- 必备内容：新语料指纹 + matrix@3 版本戳 +「读数=复活条件③④输入证据非方向裁定」条款 + 单次终读纪律 + G1b→INCONCLUSIVE-instrument 谓词锚（禁临场拟，HARKing 窗口）+ 与 R85/R86 可比性边界声明（语料 57→56 致分母类字段不可直接比）+「即使 Δ 转正重议仍走 owner anysearch-eval 未来轮次」。

### T3 判读器滚动【覆盖 D-003, D-005】
- .scratch/grill-round-85/readout-delta.mjs：EXPECTED_FP→新指纹 + matrix@3 版本戳（matrix@2=R86 G1b 修订体）。
- 机械面逐字不变：G0–G4 闸序/flat-prior β 后验/效应量四字段/早停/单次终读全保；selftest 复跑锁回归。
- 已核：边界常量全参数化（无 41/57 硬编码），不需要改判据常量。

### T4 容量探针【覆盖 D-004】
- 匿名层逐次覆写：ANYSEARCH_ENDPOINT=https://api.anysearch.com + 空 key（runner 子进程 env 透传已证可行）。
- ANS_VERTICAL_DELTA_LIMIT=4（32 调用）实测 TPM 形态与配额余量——测持续吞吐非单发成功；登记为容量测量，非判读输入。

### T5 delta 腿【覆盖 D-004】
- 探针无 nudge→同窗全量（~56 格×4≈224 调用）产终读档。
- 探针或中段触发 nudge→不硬跑，当日合法落 INCONCLUSIVE-instrument（G1b 语义，探针读数作量化锚）。
- 禁跨日分桶合并（读数无单一语义）；禁缩范围终读（G2 必不过=制度性自败）。
- Runner：packages/store/test/online/eval-looks-vertical.online.ts。

### T6 单次终读【覆盖 D-003, D-005】
- readout-delta.mjs readout → .scratch/grill-round-95/readout-output.json；判读输入仅终读档一次，二次读取/peek 作废。

### T7 台账落账【覆盖 D-002, D-003, D-005】
- defer-r86-anysearch-corpus-param-contract → closed（字段集照 r87-f3-criterion-errata 先例：status/closed_by=ADR-0096/closed_by_adr_path/closed_at/evidence 追加兑现记录；carried_log append-only 不删）。
- 新 finding 独立 id（禁并入旧条 reopen）：上游文档词表 vs validator 不一致；type:finding；owner anysearch-eval；evidence 引 D-002 实证且**必须带可机检验证信号**（如「上游 validator 接受词表文档规则下的合法请求」复放断言）——防不可控锚橡皮图章。
- r88-candidate-vertical-direction-redeliberation 仅追加 carried_log：四字段集 id/owner/trigger_rule/at + 条件③④ verifier 工件快照路径；**status=formally-declined 不动**，解释权属 owner 未来轮次。
- backlog 登记（不入本轮 diff）：fundamental×cn_code 新格立案；全语料契约一致性体检。

### T8 收尾【覆盖 D-005】
- 立 docs/adr/0096-*.md：含 Known-Risks 预写三项——①与 R85/R86 可比性边界声明（先于读数存在）②墓碑理由码受控词表 ③G1b→INCONCLUSIVE-instrument 谓词锚已写进 T2。
- CONTEXT.md 追加 `## Grill Round 95 — Terms (ADR-0096)` 词条区。候选词条（账本派生）：Tombstone Reason Code（墓碑理由码受控词表）/ Evidence-Role Annotation（读数=证据非裁定的角色标注）/ Matrix Version Stamp（matrix@N 版本戳进位）/ Probe-vs-Terminal Tiering（探针/终读二分，容量探针非判读输入）/ Protocol Amendment Ordering（语料修订先于预注册的合法时序）/ Finding-vs-Disposition Separation（发现与处置分离记账）/ Machine-Checkable Verification Signal（finding 必备机检信号）。与既有词条对齐勿重复（carried_log/Single-Terminal Read/instrument-flag/Exploratory Region/Snapshot-vs-Live/Resurrection-Condition Controllability 已立法）。
- 轮报+交接档。
- **T7/T8 同轮闭环**：registry closed_by 不得指向不存在的 ADR 文件；两 commit 同轮完成或合并为一个（ADR-0095 D5 先例）。

## 2. 用户侧依赖（B 升级路径）【覆盖 D-004】

- 复活私有端点 127.0.0.1:20128 或供有效 ANYSEARCH_API_KEY → 兑现后声明式环境一次干净全量跑（判据同 R86 T5：iso providersFailed=∅ + 覆盖≥70%）。
- agent 不代修用户 env、不代持凭证（R86 立法 env 修复归用户侧）。

## 3. 显式范围外（账本约束集）

- prefer-capable 加权轴：formally-declined 不动，禁单边宣称方向复活（D-001/D-003）。
- r88-candidate status 变更：只记 carried_log（D-003/D-005）。
- 全语料契约体检、fundamental×cn_code 新格：backlog 候选，独立轮次（D-002）。
- npm deprecate 命令：EOTP 用户亲触不代跑；常驻债；tag/publish（D-001）。
- 判据修订（gate 参数/新判据替代被废止者）：属 owner 未来重议轮议题（D-003）。

## 4. Suggested skills

- $domain-modeling — T8 CONTEXT.md 词条立法时的对齐纪律。
- $atomcode-research — 执行中遇外部不确定时的深调通道（ctx_batch_execute 单发串行 concurrency:1）。
- $gitbutler — 全部版本控制写操作（一票一 commit；T2 时序自证须核对 parent 含 T1 diff）。
- $neat-freak — 轮末收尾复核（残留/文档同步/凭证闭环）。

## 5. 工件索引

- 账本：.scratch/grill-round-95/decision-ledger.md
- 调研+活查实证：.scratch/grill-round-95/q1-research.md / q2-research.md
- 语料生成器：.scratch/grill-round-84/gen-corpus.mjs
- 判读器：.scratch/grill-round-85/readout-delta.mjs（matrix@2 体）
- Runner：packages/store/test/online/eval-looks-vertical.online.ts
- Registry：docs/deferred-registry.json
- 上游词表快照：.scratch/grill-round-84/evidence/sub-domains-vocab.json
