# ADR-0007: Architecture Grill Round 4 — pi-agent-core Integration

日期: 2026-08-19
状态: Accepted

## 背景 (Context)

Round 5 交接文档明确了下一步优先级：① 提交审计修复（已完成 62a07a7）→ ② MCP Phase 2 → ③ pi-agent-core 集成 → ④ token 维度计费 → ⑤ Domain TOML 持久化。

架构 grill 发现 MCP Phase 2 和 pi-agent-core 集成有依赖关系：MCP server 包的是 kernel，pi-agent-core 集成会改 AgentRuntime 实现（kernel 的一部分）。先做 MCP 只能暴露 retrieve，再做 pi-agent-core 后 MCP 要重新接线。

atomcode research 调研了 pi-agent-core 完整 API（280 行报告，35 页源码读取，7 次搜索，5 角度交叉验证）：
- Agent 类：new Agent({ initialState, streamFn }) -> prompt()/subscribe()
- 工具用 TypeBox schema 定义：AgentTool = { name, description, parameters: TSchema, execute }
- RetrieverPort 不在 pi 生态内——正确接法是把搜索包成自定义 AgentTool
- pi-ai：createModels() + provider 工厂（OpenAI/Anthropic/Google 30+），streamSimple 是 agent 的 StreamFn
- 状态管理分两层：轻量 agent.state（内存）+ harness SessionManager（JSONL/SQLite 持久化）
- 包版本 0.84.2，Node >=22.19，ESM-only，MIT

## 决策 (Decision)

### Decision 1: 先做 pi-agent-core 集成，再做 MCP Phase 2

MCP server 一次到位暴露完整能力（retrieve + chat + llm），避免包一半再拆开重接。

pi-agent-core 集成完成后，MCP Phase 2 的 buildServer(engine) 工厂可以直接暴露 retrieve + chat 工具，主 Agent 调用一次就拿到多源验证检索 + agent loop 对话。

### Decision 2: PiAgentRuntime 实现放 packages/kernel

在 packages/kernel 内新建 pi-runtime.ts 实现 AgentRuntime 接口。kernel 包新增依赖 @earendil-works/pi-agent-core + @earendil-works/pi-ai。

CLI 的 chat 和 llm 命令 import kernel 的 PiAgentRuntime，组合根注入 RetrieverPort + SessionStorePort + DomainConfigPort。

MCP Phase 2 也直接从 kernel 取 AgentRuntime，不跨包。

### Decision 3: AgentEvent 保留我们的 7 种，做薄映射层

保留我们的 AgentEvent（text/tool_call/tool_result/search/search_result/done/error），在 PiAgentRuntime.run() 内桥接 pi-agent-core 的 subscribe() 回调，把 9 种事件归并映射：
- message_update -> text（流式文本增量）
- tool_execution_start -> tool_call
- tool_execution_end -> tool_result
- agent_end -> done
- error -> error

CLI 和 MCP 消费我们的事件类型，不被 pi-agent-core 版本绑定。

### Decision 4: Domain 5 层全接

pi-agent-core 集成首次消费 DomainConfigPort 的 prompts/skills/rag 三个层（ADR-0006 决策 4B 标为 deferred）：
- prompts -> 拼接成 Agent 的 systemPrompt（领域专属提示词 = Agent 系统人格）
- skills.active -> 决定哪些 AgentTool 被激活（工具开关）
- rag.adapter -> 决定 transformContext 钩子是否在每次 LLM 调用前注入检索结果

领域切到 research -> Agent 自动拿到 research 的系统提示词 + research 激活的工具 + research 的 RAG 适配器。这就是"信息专精 Agent"的核心：同一个 agent loop，不同领域配置产出不同专精行为。

### Decision 5: token 维度归 PiAgentRuntime，per-call 维度归 RetroaererdEngine

PiAgentRuntime 持有 BudgetLedgerPort 引用，在 agent loop 生命周期内做 token 维度的 reserve-then-settle：
- agent_start 时 reserve 粗估 token 上限
- 每轮 LLM 调用通过 onResponse 钩子累加实际 token
- agent_end 时 settle 实际消耗（退多补少）

RetroaererdEngine 继续管 per-call 维度（fanout 前 reserve、fanout 后 settle）。

两者共用同一个 BudgetLedgerPort 实例（两个维度共用一个 session）。

### Decision 6: session 系统并存

PiAgentRuntime 用 pi-agent-core 的 Agent 类（轻量内存状态，agent.state.messages），每轮结束后把消息和检索结果同步 append 到 SqliteSessionStore 做 FTS5 索引。

- pi-agent-core Agent 管对话记忆（内存转录本 + compaction）
- SqliteSessionStore 管 FTS5 知识仓库（可搜索持久仓）

两者不冲突——一个是"对话记忆"，一个是"知识仓库"。FTS5 索引是 context-mode 心智模型的核心特性。

### Decision 7: 先做 ans llm + ans chat，defer skill + recommend + auth 写配置

ans llm — 配置 LLM provider（列出可用 provider、设置默认 model、检查 auth 状态），是 ans chat 的前置条件。

ans chat — 交互式检索增强对话（pi-agent-core Agent loop + RetroaererdEngine 作为 AgentTool），是核心产品体验。

ans skill、ans recommend、ans auth 配置写入继续 defer。

用户路径：ans llm set anthropic -> ans chat "研究 xxx" -> Agent 用 Anthropic 模型 + RetroaererdEngine 多源检索回答。

## 备选方案 (Alternatives Considered)

1. 先做 MCP Phase 2（rejected: 只能暴露 retrieve，agent loop 后补要重新接线）
2. PiAgentRuntime 放 apps/cli（rejected: MCP Phase 2 要 import CLI 代码或重复逻辑）
3. re-export pi-agent-core AgentEvent（rejected: CLI/MCP 被绑定到 pi-agent-core 类型版本）
4. 只接 prompts 层（rejected: skills 和 rag 是"信息专精"核心差异化）
5. token 维度归 engine（rejected: 语义混乱，engine 是检索引擎不应知道 LLM token）
6. 用 pi SessionManager 替换 SqliteSessionStore（rejected: 丢掉 FTS5 全文检索能力）
7. 5 个命令全做（rejected: skill 和 recommend 设计未 grill，强行做引入未规划抽象）

## 后果 (Consequences)

正面:
- MCP Phase 2 一次到位暴露完整能力，不重复接线
- AgentRuntime 实现在 kernel，CLI 和 MCP Phase 2 共享同一组合根
- AgentEvent 映射层隔离 pi-agent-core 版本变化
- Domain 5 层全消费，领域切换产出不同专精行为
- 双维度计费职责分明：token 归 runtime，per-call 归 engine
- FTS5 知识仓库保留，context-mode 心智模型核心特性不丢
- 最小可用闭环：llm + chat

负面:
- kernel 包新增 pi-agent-core + pi-ai 依赖（ESM-only，Node >=22.19）
- AgentEvent 映射层是手写归并，pi-agent-core 事件变化时需同步
- Domain rag 层的 transformContext 钩子增加 agent loop 复杂度
- token reserve 是粗估上限，agent 循环中途超额只能事后 settle 不够

关联: ADR-0001 (pi skeleton), ADR-0002 (domain authority), ADR-0004 (kernel split),
ADR-0005 (three-phase distribution), ADR-0006 (seam wiring).

*End of ADR-0007*
