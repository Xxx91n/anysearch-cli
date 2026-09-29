# R90 Goal — dsh 原生注册实施轮（dsh-native-tools-impl）

> Slug: grill-round-90 | 定稿 2026-09-29 | 账本：decision-ledger.md（D-001~D-002 全 current）

## 主题

R90 = dsh 原生注册实施轮：解除 defer-r72-dsh-native-tools 并实施——五 ans_* 工具（ans_search_web/ans_research_web/ans_recall_memory/ans_query_knowledge/ans_ans_chat）经 ctx.tools ToolRuntime.register+defineTool 原生注册于 apps/dsh-plugin，execute 体零业务逻辑走 HTTP IPC 同 hooks 层契约（callServer+三头+fail-open），parameters 从 apps/mcp tool-schemas.ts 单源投影，mock-Cordis ctx 测试闭环；先决=L2 expected-RED 闸先证红再实施；mcp__anysearch_ 桥退役独票处置。同域纳编：ADR-0090 真值表 spec-gap 补行立法+r72-web-matrix 维持 defer 复核。

## 三个立法性附件（D-001）

1. **票内正例声明**：本票消费现钉 0.1.7-rc.1 在架 API、零 repin 依赖；R89 D-002 判词管版本轴、本票管消费轴。
2. **真值表第四行**：「字面拉力=TRUE+稳定龄期闸未过→repin 延后但消费放行（pending-repin：已钉版本上的消费决策独立裁决）」——消 ADR-0090 未定义态。
3. **收口义务延展**：0.2.0 stable 晋升时收口探针顺带对本票消费 API 子集再 diff+回归测试闭环，漂移即触发返工票。

## 票序（D-002 八票序+条件票）

| 票 | 内容 | 类型 | 覆盖 |
|---|---|---|---|
| T0 | 哨戒续班：dsh dist-tags 复观（0.2.0 rc.N/stable 在架）+check/test/ship-gate --quick 基线快照 | chore | D-002 |
| T1 | spec-gap 立法：ADR-0090 addendum 真值表第四行 pending-repin+版本轴/消费轴正交措辞（留轮首；T2 彩排发现判据无法表述时可轮内 amend） | docs | D-001②/D-002 |
| T2 | L2 expected-RED 闸：mock-Cordis 测试先行（五工具注册存在性+执行路径+fail-open 断言），预实施跑必红留证 | test | D-001/D-002 |
| T3 | 实施：五 ans_* defineTool+register 于 apply(ctx)，schema 投影单源 tool-schemas.ts，execute=callServer HTTP IPC；测试转绿；票内正例声明入题注 | fix | D-001 |
| T4 | 桥退役独票：cordis.patch.yml 两处 mcp-anysearch 行删除+mcp__anysearch_ 引用面清零；cutover 判据=测试绿+引用面清零+rollback 单元（T4 revert）闭合，不设时间 soak | refactor | D-002 |
| T5 | r72-web-matrix 复核：approval-channel 分项拆/留裁决+registry 两票状态更新 | docs | D-001 |
| T6 | 收口件批：ADR-0091+CONTEXT 词块+registry+closeout-claims+报告+任务书终态戳 | docs | 全条 |
| T7 | 门禁+审计 LOOP：pnpm -r check/test+ship-gate --quick+惯例复核 | — | D-002 |
| TC | 条件票：轮内目击 0.2.0 stable 晋升→closing probe（消费子集+r72 实施面 .d.ts 再 diff+判词封账）；未目击不启不留痕 | chore（条件） | D-001③/D-002 |

## 跨票治理闸（承继，非新立法）

- 新债处置=R84 D-007 三向失真判据显式继承（失真→并入主票/同文件→复核行/无关→清障轮）；发现者无权就地扩票。
- 断言载体预注册（T2 即其执行形态）。
- 票级熔断：单票门禁失败就地修重跑；同票连续 2 轮 LOOP 失败→回退该票 commit 挂回 registry+其余票推进+缩轮呈报。
- 一票一 commit、type 纪律（fix/refactor/docs/test/chore 不混）。

## 显式范围外

不动钉版（0.1.7-rc.1 维持，repin 非本轮事）/不实现 r72-web-matrix 主体（patchReload/browser-turn 触发器未响）/垂域方向重议候审不复活（|ΔarmHostHit|≳0.4 未达）/评测面（f17 等）顺延/上游触发债（r81/r84/r86×2）具名触发不动/常驻背景债×5 顺延/无外发动作（无 tag/publish/push）/观察项（ANS_PROBE_QUERY 不对称、libuv 噪声）不就地扩票/无双注册并行期（同后端字节恒等零信息增量）。

## 遗留呈报项

TC 条件票启停、approval-channel 拆留裁决、桥退役前后引用面清零核验、熔断/缩轮事件、新债三向分流——均回呈用户裁决。
