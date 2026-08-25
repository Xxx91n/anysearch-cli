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


## Hot-Cold Injection（热冷路径注入）
L1 记忆注入的分治策略：热路径（transformContext async）做 L1 会话摘要速召回，结果 prepend 到 systemPrompt 与当前轮 LLM 同步生效；冷路径（shouldStopAfterTurn async）做 L2 FTS5 + 两 stage 管道深召回，不阻塞当前轮，记忆到下一轮生效。热路径快（内存内 resume_anchors）、冷路径慢（FTS5 + 双库），是 Letta 同步压缩 + 异步 dreaming 的同构映射。ADR-0010 Decision 1。

## Progressive Disclosure（渐进披露）
hooks 层判断指南的分发架构：SessionStart hook 注入 ~20 行 / 150-400 token 静态路由卡（轻量指针）+ 独立 SKILL.md 按需加载（~100 tokens 常驻 description，命中才载入正文）+ AGENTS.md 最小化常驻（<200 行，只放每会话事实）。三层按"加载时机 × 上下文成本 × 权威性"分工：常驻事实进 AGENTS.md，过程判断进 SKILL.md，确定性触发进 hooks。参考 context-mode 三件套、Anthropic 2026-06-18 steering 博客。ADR-0010 Decision 2。

## Routing Card（路由卡）
SessionStart hook 注入的静态路由指令，~20 行 / 150-400 token。四块内容：插件存在声明 + 5 个 ans_* 工具一句话用途、触发规则（何时 search_web vs research_web vs recall_memory）、fail-open 降级说明、指向 SKILL.md 深挖入口的显式指针。不内联完整 guidance。跨平台降级：hook 注入（Claude/Codex）-> rules 文件（Cursor 无 SessionStart）-> AGENTS.md 段。注入太少 -> skill 永不触发（Vercel 56% 不触发）；注入太多 -> 会话崩溃（issue #15554 6MB）。ADR-0010 Decision 2。

## Fact-Process Split（事实流程分置）
AGENTS.md vs SKILL.md 的内容归属裁决线。Anthropic memory 文档金句："facts Claude should hold in every session" -> AGENTS.md 一行级；"multi-step procedure or only matters for one part" -> SKILL.md。工具白名单、fail-open 行为预期、命名空间约定是每会话事实 -> AGENTS.md；诊断/重试/恢复步骤是多步流程 -> SKILL.md。强制语义（白名单/fail-open）= AGENTS.md 一行意图声明 + hook 代码强制实现。AGENTS.md 是 context not enforced configuration。arXiv:2605.10039 确认文件大小/位置在多重检验校正后无差异。ADR-0010 Decision 2。

## ARD Tracking（ARD 追踪）
Agentic Resource Discovery v0.9 协议的追踪型 ADR 策略：记录事实基线（2026-08：v0.9 Draft，IANA 未注册，采纳约等于 0，两个参考实现）+ 季度复查哨（Synscribe 式普查 .well-known/ai-catalog.json）+ 可选低成本动作（发布时挂 ai-catalog.json 作为选项非承诺）+ 明确非目标（不按 ARD 重构分发格式、不引入运行时依赖。打包格式归属 Agent Plugins 1.0.0 Published spec）。ARD 是发现层与 MCP 执行层正交，未来接入只需加 catalog entry 无需改架构。ADR-0010 Decision 4。


## NOOP Adjudication（NOOP 裁决）
REUSE/COMPRESS 判别的核心机制。检索工具返回后，用 compaction.model 做一次 LLM 裁决：新检索结果的每个关键信息点是否已落在现有 IR 摘要的对应段内？全部覆盖 → REUSE（跳过摘要生成省一次 LLM 调用），有未覆盖信息 → COMPRESS（增量生成）。二元 function-calling 输出 { decision: "reuse" | "compress" }。对齐 Mem0 A.U.D.N. 四路裁决的 NOOP 分支但简化为二元——IR 摘要三段只增补不覆盖，无 DELETE/UPDATE 语义。裁决 LLM 调用 fire-and-forget，不阻塞 agent 循环。ADR-0013 D1/D3/D5。

## Gap Distillation（gap 蒸馏）
NOOP 裁决的输入构造。从 messages 中定位上次 rolling_summary anchor 对应的消息位置，取之后 gap，过滤 role=tool 且 tool_name 包含 search 的消息内容作为裁决输入。不取对话内容（用户闲聊、assistant 推理）——信息覆盖度判断的输入只有检索结果和现有摘要。对齐 Mem0 "候选事实 + top-k 邻居记忆"输入构造。Token 成本 500-2000 token，远低于完整 messages gap（5K-20K）。ADR-0013 D2/D9。

## Consecutive Reuse Cap（连续 REUSE 上限）
NOOP 裁决的安全阀。维护 consecutiveReuses 计数器：REUSE 则递增，COMPRESS 则归零。连续 3 次后第 4 次跳过裁决直接 COMPRESS。防止裁决 LLM 系统性偏差（总判 REUSE）导致摘要长期过期。对齐 LOCA-bench "更高频压缩 → 更少 rot"结论和 Letta issue #957 死循环故障先例。ADR-0013 D8。

## Native Smoke Matrix（原生依赖加载冒烟矩阵）
GHA 4-job 并行 matrix（win32-x64 / darwin-arm64 / linux-x64 / linux-arm64），仅 pnpm install --frozen-lockfile + require('better-sqlite3') 加载断言，不跑构建。CI 保持 allowBuilds=false，故意禁编译让 prebuild 缺失显形（source-compile 沉默案例：sweet-search b33e732 / nchat e94ab08）。public repo 零成本。ADR-0025 D1。
_Avoid_: cross-compile in CI, node-gyp on CI, build matrix

## Equal-Conflict Review Channel（等权冲突裁决通道 / pref review）
d-i' 等权机器写矛盾的唯一用户可见出口：CLI 一等命令 ans pref review 列出 quarantine 中 equal_conflict 记录并提供 keep/drop/promote 三处置动作，复用 adjudication 写路径，零新存储零新 LLM 调用。批量自动归档作为积压阈值兜底延后。ADR-0025 D2。
_Avoid_: silent resolution, auto merge, background reconciliation

## Flag-Don't-Silently-Pick（标记优先不静默二选一）
业界共识裁决方向（Mem0 roadmap / Hindsight / OzBrain / TANGLE / MemConflict）：等权矛盾必须显式隔离+标记，绝不让检索器因打分偶然性静默选一。anysearch 的 quarantine + pref review 是该方向的完整实现。ADR-0025 D2。
_Avoid_: retrieval-time coin toss, silent pick, first-match wins

*End of Glossary*

## Cursor Dual Channel（Cursor 双通道注入）
Cursor 平台 SessionStart hook 的注入策略。hook 照常 emit additional_context（snake_case 顶层字段）做前向兼容，但关键路由上下文走 .cursor/rules/anysearch.mdc（alwaysApply: true）规则文件兜底。原因：Cursor 的 additional_context 注入通道有官方承认的竞态 bug（2026-04 至 2026-08 多帖确认，Hooks 日志显示 merged 但实际未进模型上下文）。三个成熟项目（context-mode 20k stars、Hindsight、superpowers）的一致实践。ADR-0011 Decision 4。

## MDC Fallback（.mdc 规则文件兜底）
无可靠 SessionStart hook 注入通道的平台（Cursor、Antigravity）的路由卡注入方式。由 SessionStart hook 运行时动态生成 .cursor/rules/anysearch.mdc 或等价规则文件，frontmatter alwaysApply: true 确保每次会话可靠注入。路由卡内容在 session-start.ts 的 ROUTING_CARD 常量中一处定义，hook 执行时检查 .mdc 是否存在且内容一致，不存在或过期则写入。对齐 Hindsight 的"每次 sessionStart 重新生成"实践。ADR-0011 Decision 5/8。

## Fire-and-Forget（不阻塞注入）
Cursor sessionStart hook 的执行语义。agent loop 不等待 hook 完成、不强制阻塞响应。continue/user_message 字段 schema 接受但当前 callers 不 enforce（写 continue: false 也不会阻止建会话）。与 Claude Code 的 SessionStart 不同（Claude Code 会随 resume/compact/clear 重新触发）。Antigravity 同样无 SessionStart 等价事件，采用与 Cursor 相同的 .mdc 规则文件兜底策略。ADR-0011 Decision 4/8。

## Write-Read Seam（写读缝）
L0 写入端与 L1 读取端之间的契约接口。L0 在 shouldStopAfterTurn 写滚动摘要到 resume_anchors（冷、异步），L1 在 transformContext 读最新摘要注入当前轮（热、同步）。学术上对应 CoALA 的 consolidation/retrieval 接口（episodic→semantic 巩固 vs working memory 装载），工业上与 Mem0 的异步写同步读 conversation summary 模块同构。契约 = 版本化的摘要格式 schema，写读端共享。与 pi-agent-core compact() 窗口管理是不同心智模型：L0 管记忆持久化（旁路写），compact() 管窗口腾挪（修改 entry 流）。ADR-0012 Decision 2/5。

## REUSE/COMPRESS 判别
L0 事件驱动触发的判别逻辑。检索工具调用返回后先判别：新检索结果是否已被现有 IR 摘要覆盖——覆盖则 REUSE（跳过 LLM 摘要生成），否则 COMPRESS 增量生成（generateSummaryWithUsage(previousSummary) UPDATE 语义）。判别核心机制为 Mem0 式 LLM 裁决 NOOP（ADR-0013 D1）：用 compaction.model 做二元 function-calling 裁决（REUSE|COMPRESS），裁决 prompt 内联 IR 5 段结构做逐段覆盖检查（D6），输入为 gap 蒸馏（检索工具返回蒸馏内容）+ 现有摘要全文（D2）。双轨触发分流：检索后轨道走 NOOP 判别（软触发），低水位线轨道直接 COMPRESS 不判别（硬触发，对齐 MemGPT flush 语义）（D4）。两级异步执行：裁决 fire-and-forget + 压缩 fire-and-forget（D5）。连续 REUSE 上限 3 次强制 COMPRESS 兜底（D8）。裁决失败 → 默认 COMPRESS（D10，对齐 Mem0 "不确定就写入"）。学术锚点：Mem0 A.U.D.N. 四路裁决 NOOP 分支（arXiv:2504.19413）、MemGPT 70% warning / 100% flush 双级阈值（arXiv:2310.08560）、Memanto typed semantic memory 分段独立判断（arXiv:2604.22085）、LOCA-bench 高频压缩降 rot（arXiv:2606.29718）、Anthropic context engineering 注意力预算。ADR-0012 D3 + ADR-0013 D1-D11。

## IR Summary Schema（IR 专精摘要契约）
L0 滚动摘要的版本化 5 段格式契约：已查证证据 / 未决假设 / 被否决信源 / 关键数字与来源 / 工具调用与已读状态。其中已查证/未决/被否决三段跨压缩只增补不覆盖——认知分段的学术原型为 OIDA（类型化有向符号图：decisions vs hypotheses、commitment vs contradicted）与 Memanto（arXiv:2604.22085，typed semantic memory 区分 decisions/hypotheses/resolved findings）、survey arXiv:2603.07670（uncertainty-aware memory / hypothesis ledger）；Ontheia 为自托管 agent 平台（pgvector RAG），无 Decisions/Commitments/Uncertainties 分段，不作锚点。数字、效应量、URL verbatim 保留（Anthropic cookbook IR 指令 + Cognitive Scaffold ACL 2026 原子约束，压缩幻觉压到 5.3%）。区别于通用对话 Agent 的聊天要点摘要——信息检索 Agent 的摘要必须保真到证据粒度。ADR-0012 Decision 5。

## Injection Hot Zone（注入热区）
L1/L2 记忆注入的位置策略。动态内容（[Session Memory] 会话摘要 + [Research Recall] 深召回）锚定到最新一条 user message 末尾——窗口末端是注意力热区（Lost in the Middle U 型偏置：首尾最优、中段显著下降，GPT-3.5-Turbo 多文档 QA 中段最坏降幅 >20% 且部分设置低于闭卷基线），且前缀（systemPrompt + 历史）保持稳定 → prefix cache 命中（Hermes PR #2361：Anthropic 未缓存前缀 $3/MTok vs 缓存 $0.30/MTok 约 10×，33K–100K token 前缀未命中重读 ≈ $0.10–0.30/次，为推算值）。静态内容（RAG note）保持首条消息形成稳定前缀（Anthropic prompt caching 最佳实践）。预算：L1 4000 chars + L2 1500 chars，总注入 ≤ 5500 chars。ADR-0012 Decision 8/9/11。

## Routing Card Override（路由卡配置覆盖）
路由卡内容的高阶用户定制机制。内置 DEFAULT_ROUTING_CARD（routing-card.ts 共享常量模块，从 3 文件重复提取）保证零配置开箱即用；项目根 .anysearch/routing-card.json 可选覆盖；JSON 解析失败 fail-open 回退默认 + stderr 警告（ADR-0009 D6 fail-open 原则）。一处源多输出：hook additionalContext 注入、.mdc 规则文件生成、E2E 测试断言共享同一内容源。ADR-0012 Decision 14。

## Sufficiency Gate Placement（门禁架构归属）
Sufficiency gate 的 LLM 判断层（named gap 生成 + 定向重搜循环）归属 PiAgentRuntime agent loop，不在 RetroaererdEngine 内部。engine 保持纯净（无 LLM 依赖），只暴露 metadata.sufficiency 信号。学术锚点：Google SCA（编排层独立 agent，RAG Engine 纯净）、CRAG（evaluator 在 retriever 外部，plug-and-play）、LangGraph/LlamaIndex（grader 是图节点/workflow step，retriever 哑组件）、Self-RAG（reflection tokens 训练进生成器）。LevelRAG 唯一反例中 high-level searcher 本身是 LLM 规划器，低层 searcher 仍纯检索。ADR-0014 Decision 2。

## MVSS（最低可行信号集）
Sufficiency gate 元数据的最低可行信号契约。四段式结构：verdict（CRAG 三态量词聚合 correct/incorrect/ambiguous）+ agreement（纯 rank 派生 Jaccard@K + RBO@K，始终可算）+ volume（uniqueResults/uniqueDomains/successfulProviders 卫生信号）+ spread（rrfVariance rank 派生弱信号 + scoreScale 原生分数量纲，仅在有分数 provider 上计算）+ perProvider（原生分数随附，明确不跨源归一化）。硬上限：廉价信号 AUC 天花板 ≈0.76，reachability 型失败对所有廉价信号不可见——MVSS 只承诺 escalate 决策，最终 sufficiency 判定需 LLM 内容级检查（Google SCA 93%）。调研发现 Exa auto 模式 2025-07 起无 score、highlightScores 2026-05 移除，3 provider 中仅 Tavily 有 float score。ADR-0014 Decision 3。

## Dual-Output Sufficiency（单计算源双输出）
engine.ts 散落的死布尔 gatePassed/crossEngineOk/sufficiencyPassed 删除，重构为单个 computeSufficiency() 纯函数，双路输出：control（gatePassed/crossEngineOk/sufficiencyPassed 布尔，供引擎内部 fanout 早停）+ mvs（verdict/agreement/volume/spread/perProvider，写入 FusedEnvelope.metadata 外部暴露）。SufficiencyGate 配置（minProviders/minResults/minDomains/crossEngineVerify）按 ADR-0005 原意保留为内部 fanout 早停阈值。学术先例：Fagin TA（PODS 2001）阈值早停 + ε-approximation 双用途、CRAG 同一置信度双用途、paperfoot RRF 融合分一次两用、Google SCA autorater 标签三用途。Qdrant 纪律：同一统计被算两次就是冗余信号。ADR-0005 的 SufficiencyGate 定位为内部质量下界（从未赋予外部判断职责），ADR-0014 补上从未声明的"外部判断"空位，不修改 ADR-0005。ADR-0014 Decision 7。

## MCP Sufficiency Annotate（MCP 信号注解层）
MCP search_web/research_web 路径的 sufficiency 处理形态。MCP server 消费 engine metadata.sufficiency → 不做 LLM 循环 → 在返回 JSON 中追加 sufficiency 对象（A+ 方案）。双通道暴露：content 文本块中序列化 sufficiency 摘要（确保所有 agent 可见，SEP-1624 证实 structuredContent 在 Claude Code/Windsurf 被忽略）+ structuredContent 镜像完整对象供支持客户端使用。fail-open：metadata 缺失时正常返回。调研 5 个生产级搜索 MCP server（Tavily/Exa/Perplexity/Brave/Firecrawl）源码，无一在基础 search 工具做服务器内 LLM 质量门——LLM 后处理只在后端 API 或独立 research/agent 工具。MCP server 本身一律"确定性薄代理 + 确定性蒸馏"。ADR-0014 Decision 4。

## Named Gap Re-search（命名缺口定向重搜）
PiAgentRuntime agent loop 的 sufficiency gate 行为模型（Google Sufficient Context Agent 范式）。gate 不止布尔判定 → 输出"缺什么"（named gap，如 missing: ["time-sensitive pricing data"]）→ 回灌查询改写器做定向二次检索 → 有界循环（默认 1 轮重搜，domain TOML compaction.sufficiencyMaxRerounds 可配）→ 仍不达标也返回（annotate verdict=ambiguous）。学术锚点：Google SCA（Reason/Feedback 结构化缺口日志 + Query Rewriter 迭代）、LevelRAG（Verify/Supplement 原子查询补充循环）、arXiv 2411.06037（sufficient context 分类器 93% + guided abstention +2-10%）。ADR-0014 Decision 1/6。

## QPP vs Sufficient Context（内部资源控制 vs 外部质量判断）
检索引擎内部资源控制（QPP，Query Performance Prediction）与外部质量判断（Sufficient Context）的学术区分。QPP（ECIR 2024 UvA IRLab）：无相关性判断下预测检索质量，典型用途全是资源控制（选排序函数、决定多阶段处理量、自适应池深）。Sufficient Context（Google ICLR 2025）：LLM autorater 判定"能否仅凭片段给出确定答案"。两者形状不同：内部控制需要"够不够继续等"（延迟/成本语义，布尔），外部消费者需要"为什么可信/覆盖怎样"（解释语义，verdict/agreement/volume/spread）。RetroaererdEngine 的 SufficiencyGate 配置属 QPP 谱系（内部控制），MVSS 暴露属 Sufficient Context 谱系（外部判断），同一份统计中间量单计算源双输出。ADR-0014 Decision 7。
## MemoryPipeline（记忆管线深模块）
从 PiAgentRuntime shouldStopAfterTurn 和 transformContext 钩子中提取的独立深模块（packages/kernel/src/memory-pipeline.ts），承载全部 L0/L1/L2 记忆管线逻辑：L0 双轨触发策略（低水位线/检索后）、REUSE/COMPRESS NOOP 裁决 + consecutiveReuses 上限、gap 蒸馏、IR 5 段 schema 写读、L2 FTS5 意图提取与查询、anchor 读写、fire-and-forget 时序。接口面 3 个方法（attach/inject/consolidate），领域语义命名而非时序命名——接口不泄漏宿主钩子细节。3 个状态变量（lastSearchTurn/consecutiveReuses/lastSummaryMsgCount）从闭包变量提升为 pipeline 实例字段。依赖方向：pipeline -> store port + models + retriever port + domain config，绝不反向依赖 agent loop。学术锚点：Mem0 add/search/get-all 最小 API 面、Letta sleep-time 解耦 bundled single agent 反模式、Ousterhout CS190 深模块判据（temporal decomposition = 信息泄漏反模式）、pi-agent-core 钩子契约语义（shouldStopAfterTurn = 停止判定回调，非记忆子系统宿主）。ADR-0015 D1/D2。
## Module Extraction Pattern（模块提取模式）
信息专精 Agent CLI 的结构性重构纪律：提取 = 搬家 commit，行为逐字节守恒；债务修复 = 独立 commit。提取时不改变任何行为（fire-and-forget 时序、fail-open 语义、晚一轮生效全部原样保留），不混入债务修复（reviewer 无法区分搬家 diff 和改行为 diff）。现有测试不改作回归基线，新增独立单元测试覆盖新接口面。学术锚点：The Complexity Trap (arXiv 2508.21433) "提取不改变行为"是安全重构前提；Ousterhout "The interface is the test surface"。ADR-0015 D6/D7。
## Sibling Module（兄弟模块）
SufficiencyGate 与 MemoryPipeline 作为 PiAgentRuntime 内部的同级兄弟模块，各自独立 fail-open 互不阻塞。gate 管"信息够不够"（LLM gap 生成 + 重搜循环），memory 管"记什么/忘什么"（摘要写入 + 召回）。两个模块接口不同（gate 接 FusedEnvelope + messages，memory 接 messages + store），不应混在一起。PiAgentRuntime 构造函数内部创建两个实例，调用方零改动。学术锚点：ADR-0014 D2 Google SCA / CRAG grader 独立组件先例；Ousterhout 不同接口不应混合；pi-agent-core new Agent(config) 模式（构造函数内部组装一切）。ADR-0015 D3/D8。

**Temporal Decoupling（时序解耦）:
gate.evaluate() 与 pipeline.consolidate() 之间的隐性顺序依赖被显式化——gate 返回 envelope 数据包（不碰 messages），编排层调用 gate.applyTo() 注入，再传给 consolidate()。对齐 LangMem "core API without side effects" 模式。消除 Fowler 定义的 "passive-aggressive command"（signalSearchTurn）。
_Avoid_: implicit ordering, side-effect chaining

**ConsolidationState（整合状态对象）:
REUSE/COMPRESS 决策状态机的纯数据类型 `{version, consecutiveReuses, lastSummaryMsgCount}`。长生命周期变量对象化（非实例字段），单次调用快照（msgCountAtTrigger）保持局部 const，每调用信号（hadSearchTurn）作为参数传入。可序列化以支持 MCP 无状态协议。对齐 arXiv:2603.07670 POMDP belief state 形式化 + Functional Core/Imperative Shell 模式。
_Avoid_: instance field state, hidden mutable state

**Claim-Ticket Injection（凭单注入）:
gate.evaluate() 返回 envelope 后，gate.applyTo(messages, envelope) 负责注入——编排层不接触 envelope 内部结构。envelope 是 gate 的私有实现细节，未来可自由演进。对齐 LangMem 纯函数返回数据结构 + 整合层组装的模式。
_Avoid_: orchestration-layer envelope awareness, message structure leakage to gate

**Functional Shell（函数化壳层）:
MemoryPipeline.consolidate 退化为 shell——调用纯函数拿 decision + summaryRequest，按 decision 执行 I/O（LLM/DB），提交 state'。fire-and-forget + anchor 持久化 + fail-open 语义保留。纯函数做决策逻辑，shell 做 I/O。
_Avoid_: pure function with I/O, shell with decision logic

**State Anchor Upsert（状态锚点覆写）:
saveAnchor 对状态类锚点（consolidation_state）使用 UPSERT 语义（按 session_id + anchor_type 的 UPDATE-else-INSERT），历史类锚点（rolling_summary）保持 append-only。version 字段充当 CAS 校验位。对齐 SEP-2567 explicit state handle 模式 + Fastio version guard 建议。
_Avoid_: append-only state anchors, unversioned state writes


## Walking Skeleton（管道骨架）
MCP server 生产构建的先验证再深化心智模型：先让最小可运行包走通完整交付管道（tsup build, MCP Inspector, npm pack --dry-run, 全新目录 npx 实测），再在真实客户端流量下迭代算法深化。协议层无状态（2026-07-28 规范）不等于应用层不能缓存资源。对齐 Pete Hodgson Tracer Bullet / Walking Skeleton 模式。Perplexity MCP、Anthropic 官方参考服务器、context-mode 均走此路径。ADR-0017 D1。
_Avoid_: 功能先行再统一打包, 分发风险最后暴露

## LlmSession Deep Module（LLM 会话深模块）
kernel 内 createLlmSession({ provider, model }) 深模块：封装 pi-agent-core 官方固定组合步（createModels, setProvider, getModel, streamSimple.bind），内部藏住动态导入/setProvider/getModel/错误提示，返回 { models, model, streamFn } 或统一错误对象（含可用模型目录）。禁止在 kernel 内读 env。CLI/MCP/plugin 三消费端共享。对齐 Seemann 组合根、Ousterhout 深模块。ADR-0008 D7 createEngine 提升先例。ADR-0017 D2。
_Avoid_: 透传函数浅模块, 库内 Service Locator（读 env 做选择）

## Lazy Session Cache（惰性会话缓存）
LLM client 资源的进程级惰性初始化加缓存策略：buildServer() 或首次 ans_chat 调用时懒加载 createLlmSession 并缓存到闭包变量，后续调用复用；环境变量变更时检测到重建。与 MCP 无状态协议不矛盾。所有生产级 LLM MCP server 均采用进程级一次性初始化。对齐 Mark Seemann 组合根。ADR-0017 D3。
_Avoid_: 每次工具调用新建 LLM session, 模块级裸单例（Service Locator 反模式）

## Dual Era Compatibility（双时代兼容）
MCP server 同时服务 2025-era legacy transport 与 2026-07-28 无状态规范。TS SDK v2 createMcpHandler(factory, { legacy: stateless }) 默认双路。截至 2026-08-21：Claude 已支持新规范，Codex HTTP opt-in，Cursor/Windsurf/OpenClaw 仍 legacy。ADR-0017 D4。
_Avoid_: modern-only server 拒绝 legacy client, 手写兼容层（SDK 已内置）

## Build Verification Gate（构建验证关卡）
MCP server 发布前的标准验证链：tsup build, MCP Inspector 自动化, npm pack --dry-run, 全新目录 npx 实测。与 Perplexity MCP、Anthropic 官方参考服务器的验证链一致。ansible-mcp-server 三版发布全部启动即崩是反面教材。ADR-0017 D5。
_Avoid_: 仅 build 加测活（无法验证协议兼容性和外部可运行性）

## Internal Package Mode（内部包模式）
private:true 加 workspace:* 的内部包不需要 build 脚本和 dist 产物：main/types 指向 ./src/index.ts（turbo 官方 internal packages 模式）。会发布的包才需要 exports 指向 dist 加 files 匹配加 prepack 构建。对齐 LaunchDarkly 企业实战。ADR-0017 D6。
_Avoid_: 给内部包加无人消费的 dist 产物, exports 指向 src 但 files 只发 dist

## SDK Upgrade Sequencing（SDK 升级时序）
MCP SDK v1 到 v2 升级的串行化策略：先做 v2 升级（transport 层骨架重写），再做算法深化（createLlmSession 提取加 models undefined 修复）。一次只改一个维度。v1 上先完成管道先行，v2 升级是独立架构演进 ADR。ADR-0017 D7。
_Avoid_: 同时改 transport 层和 handler 内部, 在旧接口上做算法深化再迁移


## Review By Clause（复审条款）
带日期与具名 owner 的决策级复审字段，写入 ADR 正文（如 D5/D7），与债务台账的 review-by 列职责分离。ADR 回答"为什么必须复审"（决策时间边界），台账回答"到期后具体做什么"（EOL 数据 + 处置动作）。对齐 k8s/OTEP 生命周期分层先例、Fowler/AWS/WhyChose ADR 不可变惯例 + supersede 替代改写。ADR-0018 D6。

## TypeBox Bridge（TypeBox 桥接）
kernel（TypeBox schema）与 MCP v2 通信的桥接模式：借助 `@modelcontextprotocol/server` 的 `fromJsonSchema(TypeBoxSchema)` 在注册处完成 JSON Schema 解析，schema 本体零重写、与 v2 默认 validator 方言一致（2020-12）。理解性质：TypeBox 原生声明 = JSON Schema 资产 + TS 类型双面体。ADR-0018 D3。

## Capability Detection（能力检测）
zod 版本门禁的正确形态：检测 `~standard.jsonSchema` 接口存在性（PR #1895 三态范式），而非字符串版本号比对。zod 3 通过注册错误；zod 4.0-4.1 走降级加 warn；zod 4.2+ 走原生。ADR-0018 D4。

## Conformance CLI Direct（conformance 直调）
MCP 双版本兼容验证的工业做法：不用 composite GitHub Action（输入面无 spec-version/requirements），而直接跑官方 CLI `npx @modelcontextprotocol/conformance server --requirements 2025-11-25,2026-07-28`。tier-check 仅作为治理信号，不作硬门禁（issue #426 未闭合）。ADR-0018 D2。

## Tool Schema Registry（工具模式注册表）
kernel 端（`packages/kernel/src/tool-schemas.ts`）集中导出 5 个 ans_* 工具 TypeBox input schema 的单一事实源。所有业务约束（枚举/minLength/maxLength/白名单）通过 TypeBox keyword 直接表达（Type.Union/Type.Literal/Type.Optional）。kernel 不引入 MCP SDK，保持 ADR-0015 cleanroom 边界。下游组合层（apps/mcp 等）通过 `fromJsonSchema(KernelSchema)` 桥接消费，零 schema 双写。ADR-0019 D1。

## Per-tool Barrel Pattern（单工具桶模式）
apps/mcp 组合层的工具注册范式：每工具一个 `src/tools/<tool>.tool.ts` 文件，导出 `{ name, description, inputSchema: fromJsonSchema(Kernel_X_Input), handler }`；`src/tools/index.ts` 以 barrel 数组汇总全部工具；`server.ts` 一次 `forEach(server.registerTool)` 完成装配。加新工具 = 新增一个 `.tool.ts` 文件 + barrel 数组追加一项，kernel 与装配管线零改动。行业先例：cyanheads/obsidian-mcp-server（教科书实例）、chrome-devtools-mcp（>30k★）、playwright-mcp（>15k★）同构。ADR-0019 D2。

## Standard Schema Trigger（Standard Schema 触发器）
SDK v2 中 `fromJsonSchema()` 把 JSON Schema（2020-12 方言）包装成 StandardSchemaWithJSON 形态的注册边界，使任意 JSON Schema 资产可被 MCP registerTool 接受。触发条件 = ADR-0018 D3 deferred 条款所需的"v2 SDK 就位"已满足（@modelcontextprotocol/server ^2.0.0）。语义载体：ADR-0018 D3 的 trigger fired 状态。ADR-0019 D3。

## Ship Gate（发布闸门）
一个CLI任务的发布阻断闸门统称。产品层的ship-gate（`scripts/ship-gate.mjs`，D1）与协议层的conformance Action（`.github/workflows/conformance.yml`，D2）**合并**构成任何一次发布必须越过的门。ADR-0020 D1/D2。
_Avoid_: quality-gate, pre-merge check, release-pipeline

## Product Smoke Gate（产品冒烟闸门）
ship-gate 5 步中的"干活者"：静态rg断言 + turbo build/test/pack + 三平台矩阵 tgz 真安装 + spawn stdio 发 initialize 断言合法 JSON-RPC + 无 env 快速失败断言。**This gate blocks release**。Feathers "higher-level tests tend to be smoke tests" 的落子。ADR-0020 D1。
_Avoid_: smoke test（太笼统）, integration test, unit gate

## Non-Blocking Conformance Heartbeat（非阻断一致性脉搏）
官方 conformance Action 的进化角色：**报告存在但不阻断发布**。expected-failures baseline 采用 qaskills 治理（未登记失败退出非零、stale 通过也非零）从而为下轮升级 Blocking 薄信号。应对 MCP 2026-07-28 spec 漂移周期。ADR-0020 D2/D6。
_Avoid_: benchmark, certification, tier-X badge

## Threshold Injection（阈值注入）
压缩/复用阈值（`lowWatermark` / `reuseCap`）从代码硬编码被提为 domain 一等公民：用户可在 `[compaction]` TOML 段声明两可选字段，类型为 `number | {fraction:number}`(Threshold Form)；纯函数 `consolidateState` 通过可选 `opts` 参数读取，默认值 = ADR-0013 现状，零行为变化。对齐 OpenAI DynamicCompactionPolicy + LangChain `trigger=("fraction",X)` + Anthropic `trigger:{type:"input_tokens",value:N}` 三家蓝图。ADR-0021 D1/D2。
_Avoid_: magic number, voodoo constant, hardcoded constant

## Ship-Gate Evidence Layer（Ship-Gate 证据层）
ship-gate.mjs 的三层持久化心智：Layer 0=stdout 供人眼看；Layer 1=`.ship-gate/report.json` 机器可读结构化证据（脚本写、gitignored);Layer 2=CI `upload-artifact` 跨 job 传递、保留期审计、可下载。仅 stdout 不足，进 git 也错；仅文件不上传 CI 也错。Humble/Farley + Google SRE + GitLab/CircleCI 官方文档共识。ADR-0021 D4。
_Avoid_: log, step-summary, telemetry

## Domain Schema Validation Acceptance（Domain Schema 校验 Acceptance 阶段）
ship-gate.mjs 在第 1 步（静态 rg 断言）与第 2 步（turbo check/test/build）之间插入 step 1.5 `validate-domains.mjs`：扫 `domains/*.toml` → resolve() → zod 校验 `CompactionConfig` 类型（`lowWatermark` 在 [50000,∞) 或 `fraction ∈ (0,1)`；`reuseCap ≥ 1`)，错误立即 fail-fast 并指向文件：行号，防 commit 后炸运行时。Humble/Farley acceptance-stage + Ousterhout fail-fast。ADR-0021 D3。
_Avoid_: lint pass, configuration check, startup validation

## Answer Mode（Answer 模式）
检索提供端原生 answer 能力在 consumer 层的暴露契约。当前 retriever 层定义为 mode: "answer"（Exa /answer、Tavily includeAnswer），consumer 层（pi-runtime/search-web/CLI）透传但不读 envelope.answers。ADR-0022 决策：暴露给工具 schema 为 provider-fulfilled 搜索结果，不加 LLM 兜底，不做本地合成。任何 provider 无关性原则：answer 的实质责任在 provider 侧，AnySearch 可能后续跟进。Round-47 修正：metadata.answersAvailable 是能力标记（按 provider.modes 计算），不再因单次 answer 调用失败/为空而翻转为 false；消费方需结合 providerAnswers.length 判断次产出。
_Avoid_: synthesis, generated answer, response mode, summarize

## Answer Provenance（答案溯源）
provider 原生 answer 在融合信封（FusedEnvelope）里的身份标记策略。answers 字段保持 string[]（不含 provider 归属），metadata 新增 providerAnswers[] 字段包含 {provider, text} 结构用于调试与 UI 展示。理由：envelope.answers 当前仅被工具壳 JSON.stringify 忽略，加 provider 维度会让 API 复杂化且没有消费者；若未来产品决定展示 answer 的来源，需要新 UI 决策再改契约（YAGNI 现在不建）。ADR-0022。
_Avoid_: annotated answers, source attribution, labeled answer

## Sufficiency Gate Preserved（充足性门槛保持）
answer 提取不参与 Sufficiency Gate 的 verdict/agreement/volume/spread 四维计算。sufficiency evaluator 继续只看 results 数组的 cheap signal（唯一结果、域名、成功 provider 数、分数扩展），不 treat answer 为额外 sufficiency 信号。理由：answers 来自 provider 生成，受上下文截断与模型能力限制，计入会混淆门户：AUC ≤ 0.76 的上限是由 results 信号质量决定的，answer 引入 false confidence。这与 LangChain CRAG 的 self-RAG 机制对齐：LLM 自信评估不可靠，仅作提示。ADR-0022。
_Avoid_: answer-informed gate, synthesis-aware sufficiency

## FTS5 Query Tokenization（FTS5 查询分词）
自然语言查询在进入 FTS5 前的转换约定：按空白/标点切词 → 每词生成 `词*` 前缀匹配 → 以 `AND` 连接，同时把完整短语查询保留为 `OR` 分支。禁止整句加双引号（会把 FTS5 退化为精确短语匹配，token 化失效）——这是曾存在于 `session-store.ts`/`project-index-store.ts` 的 `fts5Escape` 心智模型，被 ADR-0023 D1 替换。转义仍保留 FTS5 特殊字符的 CWE-20 防护（双引号原样 doubling）。对齐 SQLite FTS5 官方文档的 prefix query + AND 组合、`arXiv:2602.23368`（Bedrock agentic keyword search）与 Aleph 检索管线的候选召回层。ADR-0023 D2。
_Avoid_: phrase-only search, exact sentence match, quoted whole query

## Transactional Memory Adjudication（事务化记忆裁决）
新记忆写入 `retrieval_results` 时的提交协议：写入不是提交，须通过三检查——（1）evidence：写入方置信 ≥0.6，用户直接输入/高信任工具豁免；（2）时序优先：同 `entity` 的新证据时间大于旧记忆时，新者生效、旧者置 `valid_until = now`（复用既有 bi-temporal 列，非物理删除，对齐 Zep non-lossy 模式）；（3）等权冲突：两源同级且矛盾时不自动覆盖，置 `quarantine` 交下次交互裁决。裁决由单次 LLM 调用完成（MemTX 简化版）。来源：MemTX（arXiv:2607.23929）四检查简化 + STALE（arXiv:2605.06527）"识别≠应用"结论——写时裁决优于检索时裁决。ADR-0023 D4。
_Avoid_: last-write-wins, silent overwrite, delete-on-conflict

## STALE Probe Suite（STALE 探针自测集）
验证记忆系统"过期记忆不再被引用"的回归测试集，源自 STALE 基准（arXiv:2605.06527）的三探针：SR（Stale-Recognition，过期状态识别）、PR（Passive Recall，被动召回）、IPA（Implicit Preference Application，隐式偏好应用）。anysearch-cli 采用 STALE-lite 子集（每探针若干核心场景），断言 `valid_until` 非空的记忆不出现在后续 `searchMemory`/`recall_memory` 结果中。明确接受"隐式冲突整体 <55%"为模型能力天花板（STALE 数据），若探针跌破该线须追查裁决层而非加向量库。属于 Ship-Gate Evidence Layer 在记忆域的实例。ADR-0023 D5。
_Avoid_: memory unit test, staleness benchmark, ad-hoc freshness check
## T0 Hot Zone（T0 热区 / MEMORY.md 偏好层）
L0/L1/L2 记忆三层之上的零延迟常驻层：SQLite 表为唯一事实源，MEMORY.md 为物化投影（每次 promote/demote 后原子重生成，temp+fsync+rename）。硬上限 1500 字符 + 200 行双阈值，溢出显式告警绝不静默截断。与 Claude Code / Cursor / Letta MemFS 常驻块同构。ADR-0024 D2/D7。
_Avoid_: system prompt notes, static instructions, always-on context

## C-prime Promote Gate（C-prime 提升闸门）
T0 偏好条目的双通道确定性闸门：任一满足即提升——(1) 用户显式 `/remember` 经 slash-guard 通道；(2) 跨会话纠正事件计数 ≥2（用户否定→肯定的结构化模式，L0/L1 管线捕获）。否决项：近 30 天有 quarantine 记录不提升；硬顶溢出进 quarantine 等位不挤爆。LLM 自报"高置信度"显式不可作为闸门（mem0 v1→v3 撤退证据）。ADR-0024 D3。
_Avoid_: auto-promote, confidence threshold, LLM-judged promotion

## Key-Level Override Merge（键级覆写合并）
双层 MEMORY.md 的确定性合并规则：每条 T0 偏好有键名（SQLite PK），项目 `<repo>/.anysearch/MEMORY.md` 与全局 `~/.anysearch/MEMORY.md` 同键时取项目值，异键合并，与 git config 双层模型同构。投影产物为单份合并文件，非两份。分支级隔离显式拒绝。ADR-0024 D6。
_Avoid_: layered merge, cascading config, branch-scoped memory

*End of Glossary*
