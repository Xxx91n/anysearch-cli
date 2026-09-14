# atomcode 深调研 — Q11 F3 处置（pi-runtime/ans_chat 缺 span 注入）

> atomcode · 2026-09-14 · grill-round-62
> Sufficiency Gate：searches 4 | angles: Official（OTel GenAI 规范、MCP 提案）+ Criticism（partial instrumentation 盲区）+ Currency + Community | full reads 6 | gaps: 无完全同构的 audit-event-parity 公开案例（从 audit-ready 文献 + OTel caller-observed 原则外推）

## 1) 执行摘要（Tl;dr）

**推荐 A（本轮立项修），C 折叠为已完成的前置证伪步骤**：engine.ts:293/509 的 q.span?.addEvent 是可选链——span 只在调用方注入时才发射，pi-runtime.ts:88 构造的 Query 从未携带 span 字段，ans_chat 路径双审计事件**结构性缺席**（非"引擎已发射只是无独立 span"），C 被代码直接排除。A 是纯 instrumentation、零语义变更、diff 小（PiAgentRuntimeOptions +1 可选 sink + createSearchTool 透传 + MCP 接线 1 行），与 D-001 账本完全一致（F3 本就是 D 项显式内容），与全部 current 决策零冲突。Confidence：高。

## 2) 分点结论

### ① C 已证伪——span 缺席是调用方问题，引擎层逻辑正确
- engine.ts:293/:509：q.span?.addEvent("retrieval.domain_filter.pre/post") 可选链——span 缺失静默不发射，envelope 标记（domain_filter_empty 等）仍设置；
- ports.ts:15-29：RetrievalObservationSink 注释明确 "absent = audit events are not recorded"；
- pi-runtime.ts:83-88：createSearchTool 的 execute 构造 Query{query,mode} 直接 retriever.search(q)——无 span 字段；
- domain-filter.test.ts:77-87 证明引擎层 span 注入时事件发射完整已测试。

### ② 两个已有检索面的注入形态 = 现成模板
- CLI：apps/cli/src/commands/search.ts:52-54 回调把 recordOperation span 传入 retriever.search({...span})；
- MCP：apps/mcp/src/tools/observation.ts:9-28 observeTool 把 span 交给 callback，search-web/research_web 已接；
- **关键发现**：MCP ans-chat.tool.ts:38 已调用 observeTool(eng,"ans_chat",async()=>{...})——ans_chat 在 MCP 面已有工具级 span 落 observability_spans，但 callback 未接收 span 参数（async()=> 而非 async(span)=>）也未传给 PiAgentRuntime。缺口精确为：**span 存在但未向内核透传**。

### ③ 工业界心智模型：partial instrumentation = 追踪价值第一杀手
- UptimeRobot 分布式追踪指南（2026-06）："Partial instrumentation creates blind spots... makes traces harder to trust"，最佳实践第一条 = entry points first；
- Multiplayer：同类结论，本仓属最差情形（非 legacy、改造成本极低却仍 partial coverage）；
- OTel GenAI 官方规范：span 应覆盖操作全程，"as observed by the caller"，同一逻辑操作不同入口覆盖不一致直接违反规范一致性意图；
- Greptime GenAI 解析：MCP 语义约定核心是修 broken MCP traces——ans_chat 面 span 存在但不向内核传播恰是 trace context propagation 断链的微观同构。

### ④ audit event parity：审计信号必须与策略执行面 1:1 对齐
- Prediction Guard（2026-08-14）：审计级信号要求 "captures what actually happened during model execution"；domain policy 在 ans_chat 面同样生效（post-filter 引擎层权威兜底，策略实际执行了）但审计事件缺失——"执行了但没证据"的 parity 缺口；
- MCP OTel 提案 modelcontextprotocol#269："Incomplete Observability" 是 MCP 生态头号痛点；
- 本仓佐证：CONTEXT.md "Observable Fail-Open"；README.md:70-72 已承诺 "Two audit events land in the observation trace on every domain-scoped search"——当前与实物不符（ans_chat 面不成立），A 同时兑现既有承诺。

### ⑤ 为什么不是 B
- D-001 已把 F3 写入本轮主题，挂账 = 推翻已裁决范围（即若选 B 需 D-001 标 revised）；
- instrumentation-only 无语义风险无新依赖；
- 行业共识把 partial coverage 列为优先级最高缺陷而非可推迟项；
- ship-gate.mjs:482 已断言 engine 源码含双事件 token，面级 parity 无静态断言，下轮审计必然复提。

### ⑥ 修复形态建议（比候选 A 更精确的落地法）
- 点位：PiAgentRuntimeOptions 增可选 span?: RetrievalObservationSink（或 getSpan?: ()=>sink|undefined），createSearchTool 构造 Query 时透传 span:opts.span；
- 理由 vs MCP 单点修：ans_chat 不只 MCP 一个入口，任何经 PiAgentRuntime 的组合根共享 createSearchTool——内核运行时层透传一次所有检索面同时闭合，与 ADR-0054 wire topology 先例同构；MCP 侧只需把 observeTool 的 (span) 参数接进 PiAgentRuntimeOptions（一行）；
- 多轮 search（agent loop）：单 span 多次 addEvent 天然支持（events_json 数组），不每轮开子 span；层级需求后续再议（scope discipline）；
- 验收锚：observability_spans 中经 ans_chat 路径的 span，其 events_json 出现同源 retrieval.domain_filter.pre/post 事件，属性含 anysearch.policy_version 与 anysearch.outcome——与 domain-filter.test.ts:77-87 同构的离线断言，挂 store/kernel 测试套件；
- 负向约束：零新 npm 依赖；不动 envelope 语义与 abstain 桥；不引入 OTel SDK 依赖（RetrievalObservationSink 结构子集已隔离该边界，ADR-0062 D2 既有决定）；禁 while-you-are-there 顺手改。

## 3) 对比矩阵

| 项 | 改动面/风险 | 工业心智模型 | 账本关系 | 时效成本 |
|---|---|---|---|---|
| A 本轮修（推荐，内核运行时层透传） | instrumentation-only，PiAgentRuntimeOptions+1 可选字段 | 消除 partial instrumentation 盲区，兑现 README 承诺 | 完全一致（D-001 含 F3）；按 D-010 增补一票 | 小时级，离线可断言 |
| B 挂账推迟 | 零改动 | 悖 entry-points-first/audit parity 共识 | **冲突**（推翻 D-001 既定范围） | 零但审计必复提 |
| C 先证伪 | 原设想需实测 | 科学但已被静态证据取代 | 无冲突但已无必要 | 已折叠进 A |

## 4) 来源清单

UptimeRobot 分布式追踪指南 / Multiplayer 追踪指南 / OTel GenAI spans 规范（gen-ai-spans.md）/ Greptime GenAI 六层解析 / Prediction Guard audit-ready 七信号 / MCP OTel 提案 modelcontextprotocol#269 + 本地实物（pi-runtime.ts、engine.ts、ports.ts、domain-filter.test.ts、search.ts、observation.ts、ans-chat.tool.ts、ship-gate.mjs、CONTEXT.md、README、ADR-0027/0040/0041/0052/0054/0057/0062）。

## 5) 信息缺口

1. 无完全同构的 audit-event-parity 公开案例（外推而非直接先例）；
2. agent loop 多轮 search 的 span 层级（单 span 多 event vs child span）留实现票按 events_json 数组先取最简；
3. OTel GenAI 约定仍 Development——ADR-0052 pin 策略已覆盖，未来升 SDK 时 RetrievalObservationSink 结构子集需同步演进（后续追踪点）。

## 账本冲突声明

推荐 A 与 R62 D-001~D-010、R61 全部 current 决策**零冲突**（F3 是 D-001 既定内容）。若选 B 则与 D-001 冲突需 revised——推荐不选。
