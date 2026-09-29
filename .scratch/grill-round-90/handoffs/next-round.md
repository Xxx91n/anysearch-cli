# R90 常驻任务书 — dsh 原生注册实施轮（next-round）

> 唯一数据源=.scratch/grill-round-90/decision-ledger.md（D-001~D-002 全 current）。本任务书由 R90 整理环节生成；执行轮开工先读本文件+goal.md+账本三件，禁止凭对话回忆补结论。

## 开工三件套（顺序不可换）

1. 读 .scratch/grill-round-90/decision-ledger.md（全部 current 记录）
2. 读 .scratch/grill-round-90/goal.md（主题/票序/判据/范围外）
3. 读 .scratch/grill-round-89/r72-shaping.md（解法案本体：落点/映射/测试闭环/依赖解除状态）+.scratch/grill-round-89/upgrade-ledger.md（v3 判词）

## 票序（一票一 commit；type 纪律承 R88 D-004 承继条款——fix/refactor/docs/test/chore 不混）

### T0 哨戒续班 — chore — 覆盖 D-002

- npm view 复查 @deepseek-ai/dsh-* dist-tags（next 是否越过 0.2.0-rc.1：rc.2 或 stable 晋升）+cordis dist-tags。
- 基线快照：pnpm -r check / pnpm -r test / node scripts/ship-gate.mjs --quick 当前态记录。
- 产物落 .scratch/grill-round-90/evidence/。
- **TC 闸**：若目击 0.2.0 stable 晋升→条件票 TC 启（见下）；rc.N 递增不启（不滚动跟随）。

### T1 spec-gap 立法 — docs — 覆盖 D-001②/D-002

- ADR-0090 addendum：真值表补第四行「字面拉力=TRUE+稳定龄期闸未过→repin 延后但消费放行（pending-repin：已钉版本上的消费决策独立裁决）」；版本轴/消费轴正交措辞入文。
- 留轮首（规则先于行为）；若 T2 彩排发现判据无法表述，允许轮内 amend 措辞。
- docs/adr/index.md 同步（gen-adr-index 若有登记要求）。

### T2 L2 expected-RED 闸 — test — 覆盖 D-001/D-002

- mock-Cordis ctx 测试先行：断言五工具（ans_search_web/ans_research_web/ans_recall_memory/ans_query_knowledge/ans_ans_chat）经 ctx.tools 注册存在+execute 执行路径（callServer 三头传播+fail-open 空结果降级）+预执行钩子四面在裸名 ans_* 下仍命中（isAnsTool 后缀匹配）。
- 预实施状态跑该测试**必须红**——留 RED transcript 落 evidence/（验证测试装置捕失效能力；绿了说明断言写错）。
- 参照 apps/dsh-plugin/test 现有 mock ctx 惯例。

### T3 实施 — fix — 覆盖 D-001

- 落点：apps/dsh-plugin/src/index.ts apply(ctx)。inject=['tools','systemPrompt'] 已声明，ctx.tools 即 ToolRuntime。
- 五工具各自 defineTool({name,description,parameters,execute})→register；parameters 从 apps/mcp/src/tools 的 tool-schemas.ts 单源投影（不复制 schema 文案）；execute=callServer HTTP IPC（传播三头+fail-open，同 hooks 层契约）返回 ToolExecutionResult{content,isError}。
- dependencies={} 不变量不破：注册 API 经 type-only devDep 编译期引用，运行时宿主注入。
- 测试转绿；票内正例声明入 commit message/题注：「本票消费现钉 0.1.7-rc.1 在架 API、零 repin 依赖」。

### T4 桥退役独票 — refactor — 覆盖 D-002

- 删除 cordis.patch.yml 两处 mcp-anysearch 行（probe 层+正式层）+清理 mcp__anysearch_ 引用面（grep 全仓清零：脚本/文档/测试引用逐处置——探针脚本直连 apps/mcp server 的不动，只清依赖桥命名空间的引用）。
- **cutover 判据（布尔，不设时间 soak）**：测试全绿+mcp__anysearch_ 引用面清零+rollback 单元=本 commit revert 闭合。
- 独 commit 保 revert 粒度；不并入 T3。
- 注意：apps/mcp server 本体保留（其他宿主经 ans-mcp 消费的 MCP 面不受影响，只拆 dsh 内桥）。

### T5 r72-web-matrix 复核 — docs — 覆盖 D-001

- approval-channel 分项拆/留裁决（条件：同 API 族且现钉在架——dsh-user-approval 在架签名稳定，可拆前置；裁决结果写入 registry evidence）。
- patchReload/browser-turn 维持 defer（触发器未响，不动）。
- registry 两票状态更新：native-tools→本轮实施态；web-matrix→分项裁决后的 defer 描述。

### T6 收口件批 — docs — 覆盖全条

- ADR-0091（本轮决策记录：主轴/正交性/pending-repin 行/判据型 cutover/桥退役独票/TC 机制）+docs/adr/index.md 更新。
- CONTEXT.md R90 词块六词已备（Version-Consumption Orthogonality/Pending-Repin Row/Consumed-Subset Closing Extension/Criterion-Based Cutover/Zero-Signal Parallel/Bridge-Retirement Ticket）——若轮内演化以账本为准修订。
- closeout-claims.json+轮报 reports/+本任务书终态戳+evidence 终归档。

### T7 门禁+审计 LOOP — 覆盖 D-002

- pnpm -r check / pnpm -r test / node scripts/ship-gate.mjs --quick 全绿。
- 惯例复核：commit↔票序一一对应、type 纪律、范围外项零触、新债三向分流记录。
- 审计 LOOP：独立审计窗口→返工清单→同套验收重跑。

### TC 条件票 — chore（条件） — 覆盖 D-001③/D-002

- 触发：轮内目击 0.2.0 stable 晋升（npm dist-tag latest/next 指 stable）。
- 动作：closing probe——消费子集+r72 实施面 .d.ts 再 diff vs stable tarball+判词封账+registry 追记。
- 未目击：不启不留痕（Conditional Ticket 机制，R89 T3 先例）。

## 跨票闸（执行期常驻）

- **新债三向分流**（R84 D-007 显式继承）：失真→并入主票/同文件→复核行/无关→清障轮；发现者无权就地扩票。
- **票级熔断**：单票门禁失败就地修重跑；同票连续 2 轮 LOOP 失败→回退该票 commit+挂回 registry+其余票推进+缩轮呈报用户。
- **commit 结构**：一票一 commit；T1/T5/T6=docs、T2=test、T3=fix、T4=refactor、T0/TC=chore。
- **无外发**：无 tag/publish/push。

## 显式范围外（账本原文）

不动钉版（0.1.7-rc.1 维持）/r72-web-matrix 主体不实现/垂域重议不复活（条件未达）/评测面+上游触发债+常驻债顺延/无外发动作/观察项不就地扩票/无双注册并行期。

## 汇报纪律

每票完成简报一票（票号+commit id+门禁态）；TC 启停、approval 拆留裁决、桥清零核验、熔断/缩轮、新债分流——回呈用户裁决，不静默吞。

## Suggested skills（下一执行窗口）

- $implement（T2–T4 实施主线，tdd at pre-agreed seams=T2 expected-RED 闸）
- $code-review（T6 收口前双轴复核）
- $atomcode-research（0.2.0 stable 晋升或 changelog 面世时复核信号）
- $but（全程版本控制）
- domain-modeling/neat-freak 心智模型沿用（CONTEXT/ADR 更新时激活）

## 终态戳（执行轮填）

- 判词/票态：____ | commit 序列：____ | 门禁：____ | 审计：____
