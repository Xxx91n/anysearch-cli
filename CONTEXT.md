# Glossary

本仓库只放领域术语表，不放实现细节、规格或决策记录。决策记录见 `docs/adr/`。

## Active Domain（当前领域）
"Agent 此刻被专精到哪个领域"的权威单元。切换 Active Domain 会同时联动以下五个下游层：Hooks Tool Whitelist、Prompt Skill Selection、Skill Active List、Info Source Whitelist、RAG Adapter。持有一份 TOML。对应经典工程术语 Software Product Line 的 variation-point selection（ISO/IEC 26580:2021）。

## Retroaererd Engine（检索专精引擎）
anysearch-cli 的内核：bounded budget（token-cap、usd-cap）、serialized sufficiency-gate（≥4 angles / ≥6 fetches / ≥3 domains / cross-engine verify）、tokio::JoinSet fanout + RRF(k=60) consensus fusion、cross-engine verify、Resume Anchoring on timeout/crash。其 spec 直接采用 paperfoot search-cli 的 RRF + Mole 的预算强制 + atomcode research 协议——作为 spec 不作为运行时依赖（atomcode 是已商业化的外部产品）。

## Info Source Provider（信息源头供应方）
一个具体供应方实现，满足 `search` / `chat` / `recommend` 调用面，对接单一检索后端（anysearch 内部通道、Exa、Tavily、Brave，或企业内部数据源 via RAG Adapter）。每个 Active Domain 的 `[sources]` 决定启用哪几个供应方与融合权重。

## Retriever Result Store（检索结果仓）
按会话隔离的轻量 SQLite+FTS5 仓，承载 Consolidated Retrieval Output。落地 "Think-in-Code" 心智模型：大输出不直接进主上下文，主上下文只看 self-check 蒸馏出的产出。模型抄自 context-mode；MVP 用本地临时文件，后期可选 MCP resource 暴露。

## RAG Adapter（领域专属检索适配器）
领域的可选资源加载器，做企业内部/机密数据的 onboarding 与检索。MVP 不实施；预设 `[rag] adapter=<id>` 配置位，后续实现。

## Skill Active List
Active Domain 切换时被激活的 Agent Skills（按 agentskills.io 标准，SKILL.md + 渐进式披露）名单。每个 skill 常驻 ~100 tokens，正文按需加载 <5k tokens。

## Hooks Tool Whitelist
Active Domain 切换时同步设置的工具调用白名单。落地优先级：Anthropic SDK 的 `allowedTools: ["mcp__<server>__*"]` 风格。微软实测 16 工具可撑爆 128k 上下文，是该层存在的根本动因。

## Prompt Skill Selection
Active Domain 切换时选择当前领域预置提示词作为哪个 Agent Skill 的描述。预置提示词不再是硬挂 prompt字符串，而是走 Agent Skills 载体。

## Code Mode（代码开发模式）
Active Domain 的一种特殊值 `domain="code"`。本模式下 CLI 软依赖用户已安装的 `context-mode` ctx 工具或 `codegraph` MCP 服务做本地仓库索引；CLI 不内置索引实现。后期商业化才考虑内置轻量 SQLite+tree-sitter。

## Kernel Distribution（内核分发形态）
三阶段路线（ADR-0005）：
1. MVP：纯独立 CLI（`ans`），内部开发阶段验证可行性。
2. MCP server：包装同一 kernel，支持市面所有 MCP 形态（stdio + Streamable HTTP + 远程 + 本地），兼容性最强。参考 Mole 双形态 + Perplexity remote+local。
3. Anysearch Plugin：anysearch 独属的 context-mode（MCP server + hooks + 沙箱子进程 + FTS5 索引 + Think in Code + 平台插件包），内置 anysearch CLI 指令，配置进各种 Agent（Codex/Claude/Cursor/OpenClaw）。参考 context-mode（mksglu, 19.9k stars）心智模型理念。


## Budget Ledger（预算账本）
Retroaererd Engine 的 budget enforcement 机制：reserve-then-settle ledger，在 packages/store 的 SQLite schema 中以非负约束固化。搜索前预留 budget（token-cap / usd-cap / time-limit），搜索后结算，0% overshoot。参考 Mole 的 DB schema 层非负约束模式。Budget 归 store 层职责（资源消耗），kernel 保持纯编排逻辑。

## Sufficiency Gate（充分性门禁）
Retroaererd Engine 的质量下界：serialized sufficiency gate 确保每次检索满足最低质量阈值（角度数 / 抓取次数 / 域名数 / 交叉引擎验证）。参考 atomcode research 协议 + TeamLoop sufficiency loop。实现位置在 retriever fanout 层（够数即收 + grace window），与 budget enforcement（store 层上界）在三个维度互不打架：上界（budget）/ 下界（sufficiency）/ 延迟（fanout 收敛）。

## Anysearch Plugin（anysearch 独属插件）
最终商业化形态：一个 anysearch 独属的 context-mode 理念插件（MCP server + hooks + 沙箱子进程 + FTS5 索引 + Think in Code），内置 anysearch CLI 指令，能配置进各种 Agent。与 context-mode（mksglu）同一个心智模型理念，但是 anysearch 独属、可商业化的产品。前期先做 CLI 验证可行性，后期再包成插件分发。
## Vertical Agent（垂直 Agent）
该 CLI 在工业术语上的对外定位：vertical Agent / Vertical AI Agent，"information specialization" 是同一理念的短语化。Agentic Search 是其能力模块，不构成产品本身。差异化于 Perplexity / Exa（水平检索原语供应方）的方式是：站在供应方之上做垂直深度研究与应用层专精，不自建索引。
## Composition Root（组合根）
CLI 命令获取已配置引擎的统一入口。纯函数 createEngine(domain?) 按领域过滤 providers、构造引擎、返回 (RetrieverPort, DomainConfigPort)。替代每个命令各自 new+register 的散装接线。参考 ADR-0006 决策 3A。MCP Phase 2 可复用同一工厂。

## Billing Dimension（计费维度）
Retroaererd Engine 的双维度计费心智模型：per-call 维度（检索 API 调用，每次 provider fanout 计一次）和 token 维度（LLM 调用，按 input/output token 计）。参考 atomcode 计费调研：Perplexity Agent API 拆分模型 token + per-tool-invocation，MoleAPI quota-points + 两阶段 pre/post-consumption。MCP 协议目前无标准 cost 字段（SEP-2007 dormant），社区方案 mcp-billing-spec 提议 meter event 带 cost_microcents/input_tokens/output_tokens。Budget Ledger schema 双维度列一次留好，当前只实现 per-call 维度的 reserve-settle。

## Seam Wiring（接缝接线）
将已定义但未连通的 kernel port 接到实际实现的过程。ADR-0006 的核心工作：RetrieverPort 接 RetroaererdEngine、DomainConfigPort 接 DomainSchema 适配器、BudgetLedger 接引擎 search() 生命周期。接缝接通后端口不再是假设性接缝（一个适配器 = 假想接缝，两个 = 真实），而是可测试、可替换的合约边界。


## PiAgentRuntime（PI Agent 运行时）
AgentRuntime 接口在 packages/kernel 的具体实现（pi-runtime.ts）。内部用 pi-agent-core 的 Agent 类驱动 agent loop，把 RetroaererdEngine.search() 包成自定义 AgentTool。通过 subscribe() 回调桥接 pi-agent-core 的 9 种事件到我们的 7 种 AgentEvent。持有 BudgetLedgerPort 引用做 token 维度 reserve-then-settle。参考 ADR-0007 决策 2/3/5。

## Domain Full-Stack（领域全栈消费）
DomainConfigPort 的 5 层在被 PiAgentRuntime 消费时的完整映射：sources 过滤 provider（已实现）、hooks.toolWhitelist 过滤工具（已实现）、prompts 拼接成 Agent systemPrompt、skills.active 激活 AgentTool、rag.adapter 驱动 transformContext 注入检索结果。领域切换 = 同一个 agent loop 产出不同专精行为。参考 ADR-0007 决策 4。

## Dual Session（双会话并存）
pi-agent-core Agent 类管对话记忆（内存转录本 + compaction），SqliteSessionStore 管 FTS5 知识仓库（可搜索持久仓）。PiAgentRuntime 每轮结束把消息和检索结果同步 append 到 FTS5 仓。对话记忆是"短期上下文"，知识仓库是"长期可搜索资产"。FTS5 是 context-mode 心智模型核心特性。参考 ADR-0007 决策 6。



## MCP Tool Layer（MCP 工具层）
apps/mcp 暴露给外部主 Agent 的 5 个意图级工具：search_web（实时联网多源检索）、research_web（分钟级深度研究）、recall_memory（FTS5 调研记忆仓检索，带时间边缘效应）、query_knowledge（企业 RAG 检索）、ans_chat（PiAgentRuntime agent loop 对话）。按检索层×深度档位二维切分，每层1-2个工具，路由决策在server端。参考Perplexity Web/Org Files Focus选择器先例。

## Research Memory（调研记忆层）
FTS5知识仓中的历次调研结果，是ans_search三层检索源之一。区别于context-mode的「工具输出回看」，调研记忆层存的是多源fanout检索到的网页内容、LLM蒸馏结论、企业RAG返回的私有数据。附带时间边缘效应——近期调研结果权重高，旧的自动衰减。

## Time Edge Effect（时间边缘效应）
调研记忆层的三层时间衰减机制：①指数半衰期衰减（BM25×exp(-Δt/τ)，τ按内容分层7d/30d/90d，floor 0.3，w=0.15~0.4）；②双时态失效（同实体新调研结果写入时关闭旧记录valid_until，不依赖衰减压陈旧）；③QDF式查询分类（检测到时间敏感词临时boost新鲜度，常青查询关闭衰减）。叠加pinned豁免（用户/领域钉住的关键结果不衰减）。参考Mem0 Memory Decay、Zep bi-temporal、Google QDF。

## Dual Transport（双传输）
MCP server同时支持stdio+Streamable HTTP两种transport，通过CLI开关ans mcp serve --transport stdio|http选择。遵循官方SDK约束：一个Server实例只能connect一个transport，用buildServer() factory每请求新建实例。HTTP模式走stateless（无Mcp-Session-Id，keepAliveMs:0）。参考context7生产模式。

## MCP Factory（MCP 工具工厂）
buildServer()纯函数，每请求/每连接新建McpServer实例并注册5个工具handler。factory是era-agnostic的——stdio和HTTP只是entry选择，工具注册逻辑只写一次。复用packages/kernel的createEngine()工厂构造底层引擎。参考官方dual-era示例+context7。


## Project Index（项目级索引）
外部主 Agent（Codex/Claude/Cursor）通过 hooks 层拦截 MCP 工具调用后，hooks core handler 把工具输出蒸馏成 JSON 结构化摘要 + 自动索引到 FTS5 产生的索引。按项目共享、跨会话跨 Agent、append-heavy、可 purge。只有在 hooks 拦截到外部 Agent 调用了 MCP 工具之后才产生——没有 MCP 调用 = 没有项目级索引。与 Agent CLI 内部记忆层是两个概念，物理分离（独立 SQLite 文件），有调用联系（recall_memory 两 stage 管道联动）。参考 context-mode per-project DB 模式。

## Hook Layer（HOOKS 层 / Anysearch Plugin hooks）
Phase 3 核心组件。平台无关 core handler（蒸馏 + 路由决策 + 调 server）+ per-platform adapter（event name / field name / tool namespace 映射）。hook 子进程只做三件事：只读项目感知、一条窄 IPC 通道调长驻 MCP server、决策输出 JSON。不碰 SQLite、不做文件写/网络/spawn。所有重操作下沉到长驻 MCP server。esbuild 多 bundle 拆成 core/adapter/distill/preheat 独立功能单元最小化启动延迟。参考 context-mode routing.mjs + Claude Code hooks 安全模型。

## Dual DB（双库分离）
项目级索引 DB 和 Agent 内部记忆层 DB 物理分离（独立 .db 文件）。内部记忆层跟 anysearch session 走（SqliteSessionStore），项目级索引跟宿主项目走。写入路径彻底分离：内部 agent 对项目索引只读，项目索引对内部记忆层不可写。recall_memory 两 stage 管道先内后外，provenance 标签不混合打分。主流做法（Claude Code/Mem0/Zep 均物理分离），context-mode 同库分表是非主流但成立的先例。ADR-0009 Decision 4。

## Two-Stage Recall（两阶段召回管道）
recall_memory 工具的检索管道：Stage 1 先查 L1（会话摘要）+ L2（内部 FTS5，带 time_decay），若 top-k 不足或为空，Stage 2 再查外部项目索引。合并时每条带 provenance: internal | project-index 标签，跨层不混合打分（各层保留各自 rank），需融合时用 RRF 或阈值截断。理由：内部记忆 = Agent 自身经验（有衰减语义），项目索引 = 共享工作区常青事实（不该衰减），强行单查询融合会互相污染。ADR-0009 Decision 4。

## Memory Tier（记忆三层架构）
Agent CLI 内部记忆系统的工业级分层：L0 缓冲层（pi-runtime.ts eventBuffer + agent.state.messages，会话短期工作记忆）→ L1 窗口管理层（transformContext 管道：RAG注入→记忆注入→compaction修剪，token 水位线触发压缩）→ L2 持久层（SqliteSessionStore FTS5 + Time Edge Effect 三层衰减）。Agent CLI 独立于 MCP 也可工作——这是核心工程重心。参考 Letta message buffer/core/recall/archival 四层、pi-agent-core transformContext 接缝、Mem0 四信号检索、Zep bi-temporal。ADR-0009 Decision 3。

## Fail-Open（放行策略）
hooks 层错误处理策略：hooks 挂了/MCP server 没响应/FTS5 写失败时，放行工具调用，原始结果直出不蒸馏不索引，stderr 告警。用户不会因插件故障失去基本检索能力。信息专精 Agent 的核心价值是检索能力，索引和蒸馏是增益层——增益层挂了不能把基础能力也干掉。后期心智模型：hooks 层索引使用引导放 skills/AGENTS.md 层，LLM 按规则决策，不硬编码 hook 逻辑。ADR-0009 Decision 6。

## FTS5 Column Weight（FTS5 列权重）
项目级索引和内部记忆层 FTS5 查询的列加权排序。SQLite bm25() 函数支持按列权重参数：bm25(fts, w0, w1, ...) — 第一参数是第一列权重，剩余默认 1.0，值越低匹配越好。ProjectIndexStore 的 FTS5 列顺序（project_path, tool_name, title, url, snippet, source）权重为 (0, 0, 10.0, 1.0, 5.0, 1.0)，title 权重最高（10.0），snippet 次之（5.0），UNINDEXED 列权重 0。让标题匹配优先于内容匹配，符合搜索直觉。ADR-0009 Decision 3 L2 增量。

## Entity Configurable（实体可配置）
NormalizedResult 新增可选 entity 字段，允许调用方显式指定实体标识覆盖 URL 默认值。saveResults 写入 retrieval_results 时用 r.entity ?? r.url 作为 entity 列值。覆盖"同实体多 URL"场景：同一公司/产品有多个页面（about、pricing、blog），URL 不同但实体相同，通过显式 entity 字段聚合。前期 fallback 到 URL（零行为变更），后期配合双时态失效按实体族去重。ADR-0009 Decision 3 L2 增量。

*End of Glossary*
