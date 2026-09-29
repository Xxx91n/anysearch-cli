# Grill Round 90 — Decision Ledger

> 唯一数据源纪律：本账本是整理与执行的唯一依据；对话回忆不得补写结论。
> 状态域：current / revised / stale / deferred。冲突改向=标 revised 留原记录+追加新 D-xxx。

## Current Records


### D-001 — R90 主轴：dsh 原生注册实施轮

- **原问题**：R90 Q1 终审——下一轮主轴裁决（调研修订版）：A′ dsh 原生注册实施轮 / B 立法+哨戒轻轮 / C 评测清债轮 / D 垂域重议 / E 另指。
- **我的原回答原文**：「采纳」（采纳 A′ 修订版）。
- **规范化需求**：正题=解除 defer-r72-dsh-native-tools + 实施——五 ans_* 工具（ans_search_web/ans_research_web/ans_recall_memory/ans_query_knowledge/ans_ans_chat）经 ctx.tools ToolRuntime.register+defineTool 原生注册于 apps/dsh-plugin，execute 体零业务逻辑走 HTTP IPC 同 hooks 层契约（callServer+三头+fail-open），parameters 从 apps/mcp tool-schemas.ts 单源投影，mock-Cordis ctx 测试闭环；先决=L2 安装彩排 expected-RED 闸先证红再实施。mcp__anysearch_ 桥退役或留回滚位=票内裁决。三个立法性附件随 A′ 采纳：①票内正例声明——本票消费现钉 0.1.7-rc.1 在架 API、零 repin 依赖，D-002 判词管版本轴、本票管消费轴；②真值表第四行立法——「字面拉力=TRUE+稳定龄期闸未过→repin 延后但消费放行（pending-repin：已钉版本上的消费决策独立裁决）」，消 ADR-0090 spec gap；③收口义务延展——0.2.0 stable 晋升时收口探针顺带对本票消费 API 子集再 diff+回归测试闭环，漂移即触发返工票。同域纳编：r72-web-matrix 维持 defer（approval-channel 分项可拆前置=票内裁决；patchReload/browser-turn 触发器未响不动）。
- **显式约束/负向需求**：不动钉版（0.1.7-rc.1 维持，repin 非本轮事）；不实现 r72-web-matrix 主体；垂域重议候审不复活（|ΔarmHostHit|≳0.4 未达）；评测面/上游触发债/常驻背景债顺延；无外发动作（无 tag/publish/push）；新债处置=R84 D-007 三向失真判据显式继承；断言载体预注册；票级熔断（同票连续 2 LOOP 失败→回退挂回 registry 缩轮呈报）；一票一 commit、type 纪律（fix/refactor/docs 不混）。
- **状态**：current

### D-002 — R90 票序+commit 结构+桥处置票位+条件票

- **原问题**：R90 Q2 终审——轮内票序+commit 结构+桥处置票位+条件票裁决（调研确认版）：A″ 八票序原样 / B 桥留激活并行 / C 桥退役并入 T3 / D 另排。
- **我的原回答原文**：「采纳」（采纳 A″ 调研确认版）。
- **规范化需求**：八票序——T0 哨戒续班（dist-tags 复观 0.2.0 rc.N/stable+check/test/ship-gate --quick 基线快照）；T1 spec-gap 立法（ADR-0090 addendum：真值表第四行「字面拉力=TRUE+龄期未过→repin 延后但消费放行 pending-repin」+版本轴/消费轴正交措辞，docs commit，留轮首——规则先于行为；若 T2 彩排发现判据无法表述可轮内 amend 措辞）；T2 L2 expected-RED 闸（mock-Cordis 测试先行：五工具注册存在性+执行路径+fail-open 断言，预实施跑必红留证）；T3 实施（五 ans_* defineTool+register 于 apply(ctx)，schema 投影自 tool-schemas.ts 单源，execute=callServer HTTP IPC 同 hooks 契约；测试转绿，fix commit，票内正例声明入题注）；T4 桥退役独票（cordis.patch.yml 两处 mcp-anysearch 行删除+mcp__anysearch_ 引用面清零；cutover 判据=测试绿+引用面清零+rollback 单元=T4 commit revert 闭合，不设时间 soak；refactor commit）；T5 r72-web-matrix 复核（approval-channel 分项拆/留裁决+registry 两票状态更新，docs）；T6 收口件批（ADR-0091+CONTEXT 词块+registry+closeout-claims+报告+任务书，docs）；T7 门禁+审计 LOOP。条件票 TC：轮内目击 0.2.0 stable 晋升→closing probe（消费子集+r72 实施面 .d.ts 再 diff+判词封账）；未目击不启不留痕。
- **显式约束/负向需求**：不做双注册并行期（同一 HTTP IPC 后端字节恒等、并行零信息增量）；桥退役不并入 T3（回滚单元分离）；不设时间型 soak（判据型 cutover）；一票一 commit、type 纪律不混；无 tag/push/publish。
- **状态**：current
