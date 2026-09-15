# Glossary

本仓库只放领域术语表，不放实现细节、规格或决策记录。决策记录见 `docs/adr/`。

## Active Domain（当前领域）
"Agent 此刻被专精到哪个领域"的权威单元。切换 Active Domain 会同时联动以下五个下游层：Hooks Tool Whitelist、Prompt Skill Selection、Skill Active List、Info Source Whitelist、RAG Adapter。持有一份 TOML。对应经典工程术语 Software Product Line 的 variation-point selection（ISO/IEC 26580:2021）。

## Retroaererd Engine（检索专精引擎）
anysearch-cli 的内核（检索专精引擎）。机器事实（claim = wiring）：per-call 预算 reserve-then-settle 已接线（engine.ts:250-264）；token-cap / usd-cap 两维当前仅类型占位、尚未接线（ports.ts:9-13，ADR-0060 D3）；sufficiency gate 阈值为 minProviders=2 / minResults=5 / minDomains=3 / crossEngineVerify=true（engine.ts:25-29），post-hoc 判定；RRF 融合 k=60，memory / web 两臂各自注册（FUSION_REGISTRY.k_fusion）；cross-engine verify 已接线（checkCrossEngine，engine.ts:480）。设计灵感（非实现承诺）：paperfoot search-cli 的 RRF、Mole 的预算强制、atomcode research 协议，仅作 spec 参考；atomcode 为已商业化的外部产品，非运行时依赖。超时/崩溃续跑锚点：未实现，无对应代码（remove-or-implement，见 `docs/ponytail-debt-ledger.md` 与 ADR-0060 D6）。

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
Retroaererd Engine 的质量下界：sufficiency gate（post-hoc 判定）确保每次检索满足最低质量阈值（角度数 / 抓取次数 / 域名数 / 交叉引擎验证）。参考 atomcode research 协议 + TeamLoop sufficiency loop。实现位置在 retriever fanout 层（够数即收；grace-window 早停已接线（pool 覆盖 maxResults 个唯一 URL 后给 straggler 一个 graceWindowMs 再 abort，deepMode 恒等全部；ADR-0061 G1 交付，此前为 ADR-0014 记录的 ponytail 债）），与 budget enforcement（store 层上界）在三个维度互不打架：上界（budget）/ 下界（sufficiency）/ 延迟（fanout 收敛）。

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
recall_memory 工具的检索管道：Stage 1 先查 L1（会话摘要）+ L2（内部 FTS5，带 freshness_factor 融合新鲜度因子，ADR-0030），若 top-k 不足或为空，Stage 2 再查外部项目索引。合并时每条带 provenance: internal | project-index 标签，跨层不混合打分（各层保留各自 rank），需融合时用 RRF 或阈值截断。理由：内部记忆 = Agent 自身经验（有衰减语义），项目索引 = 共享工作区常青事实（不该衰减），强行单查询融合会互相污染。ADR-0009 Decision 4。

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


## Memory Eval Harness（记忆评测台）
把记忆生命周期（write→store→manage→read）当作可度量系统工程测试：golden dataset 化现有纯函数测试 + 确定性指标门禁 + 本地 judge 独立报告通道。业界 2026 共识（Hindsight/DeepEval/Langfuse/BuildPulse 多源交叉验证）：没有自家领域 golden dataset，任何记忆改动都没有方向判断依据。本项目的 eval harness 是度量能力本体，不只是测试。ADR-0027 D1。
_Avoid_: pass/fail snapshot, judge-in-CI-gate, metric-only reviews

## Golden Dataset Fingerprint（Golden 数据集指纹）
golden case 集合的 SHA 指纹（随报告附件），防止跨数据集版本错误比较基线。llm-evalgate 明确主张：数据集变更须强制重新校准基线并更新指纹。ADR-0027 D9。
_Avoid_: implicit dataset drift, baseline without fingerprint, cross-dataset threshold compare

## Baseline Refresh Discipline（基线刷新纪律）
门禁阈值只允许 review 确认真实改进后手工提交更新；CI 永不自动下调（静默 ratchet-down = 质量地龋崩坑）；golden 集增删 case 时强制重校准。llm-eval-ci 做法：报告即下一次基线，提交进 git 持久归档。ADR-0027 D10。
_Avoid_: auto-lower baseline, silent drift, threshold update without review

## Flaky Case Quarantine（Flaky 用例隔离）
环境性 flaky case 进隔离区（30 天 TTL + 每周过期复评 + 续期上限 2 次），代替删 case 或改阈值。与记忆系统 conflict quarantine 心智模型一致（ADR-0023）：harness 的 case 也是小号记忆单元。ADR-0027 D8。
_Avoid_: delete-on-flaky, threshold bump for flake, infinite retry

## Calibration Holdout（校准留出集）
人工标注的 30-50 条冻结 TS fixture（calibration-cases.ts），与 gate 用的 golden-cases.ts 物理分离，专用于度量 judge 与人类的一致性。从真实 judge 样本流分层抽样另写、负例偏多；拒从 golden 集抽样（pigeonhole 自认可回路）。ADR-0029 D1/D3。
_Avoid_: sampling calibration set from golden cases, Likert rubric, calibration artifacts mixed into golden fingerprint

## Kappa CI Lower Bound（κ 置信区间下界门禁）
零标注冷启动期的 interim judge 判据：Cohen's κ 的 percentile bootstrap CI（5000 次重采样）下界 ≥ 0.6。正式 L2 判据预注册为 `AC1 CI 下界 ≥ 0.7 ∧ po ≥ 0.8 ∧ CI 宽度 ≤ 0.4`；κ 在正式阶段仅作边际差异诊断。报告必须双报 raw agreement + Gwet's AC1。ADR-0029 D2 / ADR-0049 D10/D13。
_Avoid_: point-estimate kappa gate, asymptotic CI on small n, Fleiss on 2-rater setup, post-hoc threshold calibration

## Scope Discipline（当轮范围纪律）
一次 grill 一个主题 ADR + 身份明确的可选伴随项：内聚工程项进 Decision 段，到期 chore 走独立 commit + CHANGELOG Removed，显式拒绝项单列。反模式是无记录的 while-you're-at-it 顺手改。ADR-0029 D6 + AGENTS.md Scope discipline。
_Avoid_: bundling unrelated decisions into one ADR Decision, silent scope creep, deferred chores without handoff record

## Entity Link Layer（实体链接层）
记忆本体的第四维度：扁平 FTS5 行之上加"实体 → 记忆"引用层——entities 全局表 + memory_entity 桥接会话级证据行，解锁实体中心问答与一跳多跳召回。图=关系表上的只读视图（SQL/PGQ），retrieval_results 行 = episode 层、entities = semantic 层（Zep 分层同构）。ADR-0031 D1/D3。
_Avoid_: triple edge table before eval proves entity value, JSON column entity storage (unindexable), session-scoped entity keys masquerading as global

## Conditional Arm Activation（臂条件激活）
RRF 融合的弱臂防线：任一召回臂在其信号缺失时整条臂退出融合，不分泌零分稀释结果（VLDB 2026 weakest-link：弱路径显著拖累整体；Gini temporal arm 先例）。实体臂无规则层命中即缺席；臂权重初始 FTS 1.0 : entity 0.5，禁跨域不对称调参。ADR-0031 D4。
_Avoid_: always-on weak arms, post-hoc multiplicative boost outside the clamp band, hard pre-filtering that dies with extraction failure

## Reversible Entity Merge（可逆实体合并）
实体去重的行业反差点：entity_merge_log 记录每次合并（from/to/方法/阈值/前后 canonical），被并实体走 valid_until 关闭而非删除，memory_entity 重定向留 provenance——Mnemoverse 审计六系统无一能撤销合并，这是唯一可领先点。阈值源自 eval 台错误预算（同名不同义/变体同义两类 golden case），不抄 0.95 常数。ADR-0031 D5。
_Avoid_: irreversible merge, threshold copied from other products, merge decision without entity_type gate (Mem0 #5438)



## Vector Semantic Arm（向量语义臂）

RRF 融合的第四臂：transformers.js 本地嵌入（multilingual-e5-small q8, 384d）经 BLOB 旁表 + JS 余弦全扫参与融合，权重 0.5 起步、k=60 保持。_Avoid_: 不称之为 "hybrid search 第四路" 或 "语义召回通道"；SQLite 外置向量扩展（sqlite-vec/hnswlib）在向量规模 <5 万前永久不在候选池。

## Embedding Circuit Breaker（嵌入熔断器）

嵌入路径的失败熔断：连续 n=3 次嵌入失败则本轮进程语义臂降级为 FTS-only，写侧与读侧共享同一枚 breaker；恢复依赖进程重启而非在线自愈。_Avoid_: 不做"条件激活 EMA 开关"（ADR-0031 D6 下 EMA 只做遥测不做开关）；不让嵌入失败导致 recall 直接报错。

## Backfill-Vectors Command（向量回填命令）

`ans memory backfill-vectors` 幂等回填子命令：同时负责存量无向量记忆回填、嵌入失败残留（pendingVectors）清理、未来模型升级后的全量重嵌入；支持 --dry-run。_Avoid_: 不区分"存量回填命令"和"失败重试命令"两套；不在写路径内做在线重试（写库必须永远成功）。


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

## Package Manager Version Pinning（包管理器版本钉死）
工具链地基契约：package.json 顶层 packageManager 与 devEngines.packageManager 同精确版本双写（前者给 corepack，后者由 pnpm 自身强制执行，#11676），不写 hash（工业界 0/6），锁文件重生成锁版本格式。Node 25+ 无 corepack 后，双写字段是声明层唯一真相源。ADR-0026 D3。
_Avoid_: version range, floating latest, dual-lane drift

## pmOnFail Error Gate（pmOnFail 错误闸门）
执行层防线：pnpm-workspace.yaml 设 pmOnFail: error，运行中 pnpm 与声明版本不匹配时立即报错停产，而非静默 download/改写 lockfile。对人+AI Agent 双端免疫（绕过 corepack 直调内嵌二进制也被拦），agent-first 供应链敏感仓库业界主流。本地可用 pnpm_config_pm_on_fail=download 环变覆盖。ADR-0026 D5。
_Avoid_: silent self-heal, fail-open tool chain, download-as-default


## Memory Eval Harness（记忆评测台）
把记忆生命周期（write→store→manage→read）当作可度量系统工程测试：golden dataset 化现有纯函数测试 + 确定性指标门禁 + 本地 judge 独立报告通道。业界 2026 共识（Hindsight/DeepEval/Langfuse/BuildPulse 多源交叉验证）：没有自家领域 golden dataset，任何记忆改动都没有方向判断依据。本项目的 eval harness 是度量能力本体，不只是测试。ADR-0027 D1。
_Avoid_: pass/fail snapshot, judge-in-CI-gate, metric-only reviews

## Golden Dataset Fingerprint（Golden 数据集指纹）
golden case 集合的 SHA 指纹（随报告附件），防止跨数据集版本错误比较基线。llm-evalgate 明确主张：数据集变更须强制重新校准基线并更新指纹。ADR-0027 D9。
_Avoid_: implicit dataset drift, baseline without fingerprint, cross-dataset threshold compare

## Baseline Refresh Discipline（基线刷新纪律）
门禁阈值只允许 review 确认真实改进后手工提交更新；CI 永不自动下调（静默 ratchet-down = 质量地龋崩坑）；golden 集增删 case 时强制重校准。llm-eval-ci 做法：报告即下一次基线，提交进 git 持久归档。ADR-0027 D10。
_Avoid_: auto-lower baseline, silent drift, threshold update without review

## Flaky Case Quarantine（Flaky 用例隔离）
环境性 flaky case 进隔离区（30 天 TTL + 每周过期复评 + 续期上限 2 次），代替删 case 或改阈值。与记忆系统 conflict quarantine 心智模型一致（ADR-0023）：harness 的 case 也是小号记忆单元。ADR-0027 D8。
_Avoid_: delete-on-flaky, threshold bump for flake, infinite retry
## Integer Allowance Gate（整数 op 允许数门禁）
eval 门禁的容差带用「允许挂 N 个 op」的整数表达，替代「baseline − 连续小数 margin」。n=11 时单 op 抖动 9.1pp，连续 margin 没有有意义的取值空间；地板 = (expected − k)/expected。报告层附 MDE/Wilson CI；margin < MDE 时该指标降为 WARN 而非 FAIL。ADR-0028 D1。
_Avoid_: continuous margin on small-n metric, Holm/BH in CI gate, auto-lowered floor

## Rank-of-Relevant Gate（rank 整数检索门禁）
search op 的 per-case 断言 `expectRankOf: { title, maxRank }`，直接表达「期望记忆必须在前 N 名」。单相关文档场景 MRR=MAP（arXiv 2510.21440），rank 整数已含全部排序信号；聚合 MRR/nDCG 只进报告不进门禁。ADR-0028 D2。
_Avoid_: qrels gate at n=20, aggregate nDCG threshold, graded labels for single-relevance set

## Read-Side Secret Guard（检索侧 secret 兜底）
「写入拒存」之上的第二层防线：共享 `containsSecret`（大小写不敏感 + JSON 转义还原 + 空白折叠 + 有限 base64 解码）挂全部 4 个写入口（adjudicateMemory/saveResults/saveAnchor/append）与 2 个检索出口（searchMemory/searchMemoryMulti）。全角同形与截断变体为文档化已知盲区，与 GitHub push protection "Some" 口径一致。ADR-0028 D3。
_Avoid_: write-path-only regex, trust "retrievable by design" without guard, claiming full variant coverage

## Difficulty Tier and Unanswerable Slice（难度分层与不可答切片）
golden case 标 `difficulty: core|hard|adversarial`、按层报 pass rate（不进 gate）；加 near-answer distractor 的 unanswerable 负例（判分 = 返回 0 条相关结果），配 answerable 假拒率双向门禁防「全拒耍赖」。轻 paraphrase 变体必须配正向断言（负向在空结果下空洞通过）。ADR-0028 D4。
_Avoid_: unanswerable without distractor, negative-assertion-only paraphrase variant, verbatim query==title probe

## Task Parity Gate（任务平价门禁）
monorepo「名义 N 包 vs 实际 M 包」漂移的防线：turbo skip-if-absent 是官方 feature（PR #1226 拒改），业界答案 = 契约在管道、实现靠门禁（Rush 默认严格 + ignoreMissingScript 豁免）。零依赖 `scripts/task-parity.mjs` 挂 ship-gate step 1,check/test 通用任务每包必实现，豁免集显式置空。ADR-0028 D5。
_Avoid_: narrowing turbo.json to hide drift, migrating to Nx/Rush for this alone

## Fused Freshness Factor（融合新鲜度因子）
检索期唯一的时间信号乘子：created_at 衰减 + last_accessed 近因 + access_count 频率三路信号压进同一个 [0.3, 1.5] 乘性 factor，一次性乘到 BM25；双层独立 recency 型乘子相乘是 Mem0 官方明示的 over-correct 反模式（有用旧事实被埋）。pinned 全豁免、evergreen 查询仅豁免 decay 半边。ADR-0030 D2/D4。
_Avoid_: stacked recency multipliers, per-layer clamping that yields 0.09 combined floor, adding a second time-signal UDF

## Explicit Invalidation via Write Path（显式失效走写路径）
用户/写侧发起的"这条过时了"映射到既有 `valid_until` / quarantine 通道，不新增 TTL、不新增四时间戳 bi-temporal。软衰减管"还正确但不再相关"，写时失效管"事实已过期"——MemStrata AUROC 0.59 证明前者替代不了后者。ADR-0030 D1。
_Avoid_: adding TTL as a recall tool, duplicate stale-flag columns, deleting superseded facts instead of invalidating

## Year-Free QDF Trigger（无年份 QDF 触发器）
QDF 正则里禁止出现具体年份字面值（2024|2025|2026 已删）：年份通道是无出处的伪触发器且会静默过期（2027 起失效）。kernel 侧必须 import store 导出的分类器，不允许内联复制（memory-pipeline.ts 漂移事故：isEvergreen 缺 什么是X）。ADR-0030 D5。
_Avoid_: `/2024|2025|2026/` style literals, inline-copied classifier regex in kernel, dynamic-year injection as a fix


## Entity Merge with Snapshot（快照式破坏合并）
实体合并的物理语义：memory_entity 行 UPDATE 重定向到主实体 + 被并实体 valid_until 关闭（tombstone 不 DELETE）+ merge_log 携带完整快照（别名集、被重定向行 id 列表、合并时刻），快照是 unmerge 的唯一依据。Neo4j 破坏式主流 + Zep 可回放性合并进日志。ADR-0032 D1。
_Avoid_: IS_DUPLICATE_OF edge redirect on read, unlogged merge, row DELETE on merge

## Bounded Unmerge with Override（半还原撤销 + 防复发）
unmerge 只回滚合并操作自身的副作用（快照内 memory_entity 行重指 + 实体复活 + 别名恢复），合并时刻之后的新写入留在主实体（补偿事务语义，不承诺回到操作前状态）；同时写 override 记录阻断同一对实体再被自动合并。Splink manual merge/unmerge + override 工业先例。ADR-0032 D2。
_Avoid_: full rewind including post-merge writes, unmerge without anti-remerge override, blocklist-only "unmerge"

## Candidate Review Belt（候选待审带）
实体去重中带（0.6-0.9）与 MAX_ENTITY_CANDIDATES 截断溢出写 entity_merge_log kind="candidate" 行，由审查 CLI（复用 ADR-0025 quarantine 模式）keep/drop 消费，candidate 行带 hit_count 再命中升级复审（Senzing possible-match 轻量版）。合并遥测六指标（auto_merged/review_pending/confirmed/rejected/candidates_truncated/unmerged）进 Observational 区 report-only 永不 gate（Goodhart 条款 + ADR-0028 D1 统计功效纪律）。ADR-0032 D3/D5。
_Avoid_: silent candidate drop, process-count gating, Senzing-style resident suspend engine

## Weak Evidence Flag（弱证据标记）
向量臂/实体臂召回但 FTS 臂未命中的 hit 带 arms 溯源且不计入强证据；unanswerable 断言从检索层零命中（expectEmpty）迁移为 expectAllWeak——检索保持 recall-only，拒答语义在证据层（A+B，LongMemEval/MemBench/CRAG 对齐）。expectMaxCount 仅统计强（FTS 臂）命中。ADR-0033 D8。
_Avoid_: static cosine threshold to separate unanswerable distractors, expectEmpty reintroduced on adversarial slice, gating retrieval on vector-only recall

## Claim-Level Attribution（断言级归因）
答案被拆为断言序列（draft claim list），每条断言独立携 `label: supported|uncertain|unsupported`、`evidence:[{url, entity?, title?, span?, provider, sourceKey}]`、`rationale?`；与 ProviderAnswer.verified:false 严格正交——verified 是 provider 自声明，claim 标签是本地确定性信号融合结果。证据粒度：每 claim ≤3 条 evidence；unsupported ≠ 找不到，它是断言被确定性证据反证才用，缺证一律落 uncertain。ADR-0034 D3/D4。
_Avoid_: rewriting provider sentences to match evidence, stacking evidence lists over 3, mixing "not found" with "refuted"

## Signal-Gated Claim Proposal（信号门控 LLM 提案）
切分流水线：L0 `Intl.Segmenter`(sentence) + 缩写/小数点白名单修正；L1 确定性碎片信号（多断言连接词、枚举、顿号/分号密度、长句、混排缩写、实体密度≥2）；仅 L1 标碎的句升级 LLM proposal（SAFE 式：句→事实+自包含化代词消解+ VeriScore 只保可验证 claim），claim 带 span 锚回原文；非法输出 fail-open 退整句为单 claim。与 cheap-first / gate the expensive path 同构（继 HyDE 门控、sufficiency-gate 后第三次复用）。ADR-0034 D6。
_Avoid_: spaCy/Stanza/PySBD/SaT (native deps), full-text LLM decomposition every answer, treating sentence segmentation errors as primary pollution instead of absorbed fragments

## Unsupported Named-Gap Escalation（不支持断言的 named-gap 升级）
unsupported 断言运行时处置：红标 ✗ 直出原句（不改写），生成断言级 `GapRequest{ assertion, evidenceState:unsupported, gapQuery }` 进 ADR-0023 sufficiency-gate bounded reround；新证据支撑 → 降级为 supported（只改标不改文），新证据反证 → attribution 挂 counter-evidence，无果且核心主张 → 随 expectAllWeak 桥入整体 abstain/降级生成，无果非核心 → 红标直出。改写（RARR 式）与默认剔除（redact）双双否决。ADR-0034 D7。
_Avoid_: RARR-style agent-side rewriting, default-redact of unsupported sentences, replacing expected human-visible red marks with silent suppression


## KG-lite Fifth Arm（关系第五臂，召回增强）
实体间关系落成 `edges` 边表（闭集谓词、系统时态 valid_until、单事务 close+insert supersede），检索侧作为 RRF 第五臂接入（权重 0.5、条件激活、双向 1-hop、采样上限 100），arm 输出的是 `episode_memory_id` 回链记忆行——天然与既有臂在 RRF 层去重。关系臂是召回增强，永不做纯图检索替代（arXiv 2502.11371 证伪）。2-hop / as-of 时间推理是 P2+。ADR-0035 D1/D3。
_Avoid_: free-form relation predicates, recursive CTE in v1, edge ids as RRF keys, world-time valid_from in v1

## Closed Predicate Table（闭集谓词表）
关系谓词为闭集 taxonomy，库层 `CHECK (relation IN (...))` + LLM 补缺三元组 `(head_type, relation, tail_type)` 约束 + strict 后置过滤三重把关；新谓词只能经 eval 评审后以迁移入库（golden 同步翻转指纹）。表层同义词（含中文）走确定性别名表，语义去重不引入 LLM 判断。ctxgraph 实测固定谓词 F1 0.763 vs free-form 0.104。ADR-0035 D2/D4。
_Avoid_: free-form phrase predicates, LLM-judged predicate equivalence, schema change without golden flip

## Idempotent Relations Backfill（幂等关系回填）
`backfill-relations` 默认 dry-run 报告、`--apply` 实写；幂等键 `(episode_memory_id, predicate, subject_norm, object_norm)` + 唯一索引兜底，确定性规则使重跑零副作用；`--batch/--from-id` 键集分页断点续跑；`--reprocess`（规则版本升级重抽）对旧行走 valid_until supersede 永不 DELETE——明确拒绝 `--reset`。与 backfill-vectors 的 opt-in dry-run 旗语极性差异在 ADR 备忘，不改已发版命令。ADR-0035 D7。
_Avoid_: destructive --reset, in-place edge UPDATE, backfill concurrent with live MCP writes, changing shipped flag semantics


## Exact Dry-Run via Rolled-Back Transaction（回滚式精确干跑）
`backfill-relations` dry-run 在已包装事务内执行与 apply 完全相同的 insertEdge 流水线，末尾抛 rollback 回滚 — written/dedupSkipped/schemaRejected 是精确预测而非上界估计，edges 表与遥测计数器零副作用。结合 `--full-refresh`（dbt full-refresh 回退安全网：原子化重建 edges 表）构成幂等回填的完整观测面。ADR-0035 D7 r87 修订。
_Avoid_: dry-run estimating by formula, write-in-dry-run, non-atomic full refresh

## Write-Once Co-occurrence Edge（仅写一次共现边）
`related_to` 边语义为写一次：首次共现实化该边，后续 episode 重复尝试跳过并计入独立的 `relatedToWriteOnce` 遥测位（绝不混入 `dedupSkipped`）。r87 审计 F7 修正了原实现的条件反置（旧代码是“首次跳过”，导致 D4 共现通道成为死代码），golden 套件不受影响（唯一 related_to 用例是 fresh-entity no_edge 负例）。ADR-0035 D4/D7。
_Avoid_: counting write-once skips as dedup, supersede on related_to, removing the closed predicate without golden flip

## Relation-Arm Gain Observance（关系臂增益观测）
关系臂从观测区毕业的唯一通道：golden 关系组扩到 Sakai 公式一次锁定的 n（53 案 pilot 估 σ_d 上界 CI、σ²_d=2σ² 保守、上限 80、中途不追加），判定 = 配对 BCa 下界>0 且点估计 ≥ minGain=10pp（sign-flip permutation p<0.05 双保险）；n 或功效不足降 paired WARN 带（ADR-0028 D1），永不 FAIL 化为阈值。扩案保持断言式标签（assert_edge/no_edge），LLM 只合成 case 不合成 label，第二人复核 CN+EN。ADR-0036 D2/D4。
_Avoid_: iterative n top-up until significant, expanding via LLM-labeled goldens, promoting 53-case observational metrics to gate

## MDE vs MEI Separation（MDE 与 MEI 分离）
两个独立预注册、禁止互推的参数：`mdeForPaired(n, σ̂_d_upper) = 2.8σ̂_d/√n` 是统计能力（σ̂_d 取 53 案 pilot 95% 上置信界，随 --calibrate 入 baseline，指纹翻转强制重算）；minGain=10pp 是业务地板（MEI，"关系臂值不值 10pp 复杂度"）。判定 = BCa 下界>0 **且**点估计 ≥ minGain。ADR-0034 "8-10%" 重述为 σ_d∈[0.25,0.38] 时 n=80 的配对均值差推导值；比例型 mdeFor(1.4/√n) 仅在 allowance 检查原位保留、绝不管辖臂增益。ADR-0036 D4。
_Avoid_: deriving minGain from n or σ_d, reusing the proportional mdeFor as arm-gain MDE, silently widening a locked n

## Judgment vs Sanity Metric（判定指标与 sanity 指标）
判定指标（sole primary）= per-case RoR delta：rank_off − rank_on（正值=关系臂上推，rank_on 更小），top-k 外 clip 到 k+1 或排除并记排除率（>20% 整轮 WARN），k=60；all BCa/minGain/significance 只挂它。sanity 指标 = 1-hop hit-rate + relationTel，仅遥测与两种异常组合（命中但没用 / 臂死但排名动）触发 WARN+人工审查——二元 hit-rate 的 σ_d=√(p(1-p)) 天花板使 n=80 检 10pp 数学无解（dichotomization 反模式），永不进门禁。FDA 单一 primary 无 multiplicity。ADR-0036 D5。
_Avoid_: promoting a sanity metric into a gate, CRC of rank delta into binary 0/1, Holm/BH multiplicity over a single primary

## Chunked Backfill with Busy Retry（分块事务回填）
`backfill-relations --apply` 从单整事务改为每 batch 一事务提交：SQLITE_BUSY 指数退避重试（50ms 起封顶 ~5s，对齐 busy_timeout=5000），SQLITE_BUSY_SNAPSHOT（deferred 升级类）直接报错不重试；可选 per-batch `PRAGMA wal_checkpoint(PASSIVE)` 抑 WAL 膨胀；keyset/--from-id 断点与幂等键不动。dry-run 保持整事务回滚（ADR-0035 r87 精确预测语义不回归）。ADR-0035 D7 quiet-window 约束改写为"建议而非必需"。expand-contract/shadow 表被拒：SQLite 12 步重构要求切换与拷贝同事务，无锁全量回填不存在。ADR-0036 D6。
_Avoid_: whole-run apply transaction, retrying SQLITE_BUSY_SNAPSHOT, breaking dry-run exact-prediction, shadow-table expand-contract on SQLite

## Episodic-to-Semantic Consolidation（情景到语义巩固）
把陈旧/低价值的 episodic 检索快照（retrieval_results）蒸馏为 semantic_memories 行：每簇一次有界 LLM 摘要（pi-ai 缝），classifyClaim 忠实度 gate（首创四适配：episode→NormalizedResult、阈值重标、簇内证据域、sourceKey→source_episode_ids）；ops 四判定全确定性（NOOP cos>0.90 去重 / UPDATE 矛盾检测+valid_until 软关闭 / DELETE=归档）。语义行永不因 TTL 归档，只经 supersession 演化；provenance=source_episode_ids JSON 回链，原 episode 保留。ADR-0037 D1/D3/D4。
_Avoid_: per-item LLM scoring for the trigger, LLM deciding ops quadruple judgments, physical deletion of episodes, TTL-archiving semantic rows, same-table kind column

## Signal-Gated Consolidation Trigger（信号门控巩固触发器）
巩固批的提出权在确定性信号（episode 数 + freshness 衰减带 + access_count 超阈值），执行权在手动 CLI（ans consolidate --dry-run/--apply，backfill-* 先例）；无常驻后台进程（CLI 无 daemon）；LangMem debounce 只内化为批窗口设计；Generative Agents 重要性阈值门控保留形态但去掉 LLM 计分。ADR-0037 D2。
_Avoid_: resident background consolidation, per-event LLM importance scoring, auto-apply without dry-run

## Soft Archive with Undo Log（软归档与撤销日志）
主动遗忘（G019 闭环）= retrieval_results 列 archived（0/1）+ 检索过滤 AND archived=0，archive_log（entity_merge_log 同构：kind archive/unarchive + detail 快照 + undone 标记）保证 undo=archived=0 位级可逆；判定用确定性四因子（age tiered tau / access_count / last_accessed / salience 列），salience 由 consolidate LLM 顺便输出但决策零 LLM；dry-run 报告 wouldArchive/分 tier/rrfArmImpact/undoable:true；golden forget 组 L0 契约 fail-closed、质量阈值观测期后落。ADR-0037 D5。
_Avoid_: hard DELETE, archiving semantic/entity/edge rows, LLM making the forget decision, irrecoverable archive, skipping the dry-run report

## Three-Protocol LLM Endpoint Config（三协议 LLM 端点配置）
LLM 使能一律走 pi-ai 缝 + createProvider 自定义端点（其 0.84.2 原生覆盖 openai-completions / openai-responses / anthropic-messages / google 四种 wire 协议）；配置 = ANS_LLM_BASE_URL + ANS_LLM_API（chat|messages|responses 显式声明，业界共识不做协议 sniff）+ ANS_LLM_MODEL；零自研 wire 适配代码。ADR-0037 D4(Q7)。
_Avoid_: endpoint protocol sniffing/auto-detect, hand-rolled wire adapters, a second LLM client library alongside pi-ai
## Durable Maintenance DB (ANS_DB_PATH)（持久维护库路径）
维护型命令（ans consolidate / memory forget / backfill / backfill-relations / entity merge）一律落持久化 SQLite：ANS_DB_PATH 显式覆盖，缺省 ~/.anysearch/anysearch.db（t0-projection 的全局 .anysearch 目录惯例）；kernel resolveDbPath 是唯一解析点，apps/cli 的 db.ts 负责 mkdir -p。搜索/聊天路径仍 :memory: 不受影响。ADR-0037 D6 Phase-3。
_Avoid_: in-memory-only maintenance commands that silently do nothing, per-command ad-hoc db path flags, env sniffing inside packages/store
## Three-Tier Gain Gate（三档增益门禁）
gain 升级为独立 gate 结论字段（不合并单一 exit code）。绿=全量预注册规则通过且 holdout 无矛盾；WARN=holdout 功效不足 / 排除率>20% / 全量过但 holdout 未过（可能含过拟合）；红=holdout 配对检出退化或全量规则失败。“未显著为正”永不为红。ADR-0038 D2/D6。_Avoid_: hard fail-closed on unproven-positive, merging gain into one exit code。

## Dual-Track Holdout（双轨 holdout）
基线 holdout 冻结不变；生产回流用例单独成切片族（含 sourceTraceId/backflowRound/sliceId/addedAt/inputHash），用 inputHash 与基线+历史切片去重；同一条用例绝对不在两轨同时出现。两轨各 0.025 alpha，总 FWER<=0.05。两轨均绿才放行。ADR-0038 D5。_Avoid_: rotating training cases into holdout, appending to a fixed judgment baseline beyond k_max。

## OF Alpha Spending（OF alpha 分摊）
Lan-DeMets O'Brien-Fleming 边界：alpha(t) = 2 - 2*Phi(z_{1-alpha/2}/sqrt(t))，t_k=k/K_max 在基线路（按 look 计数）、t_j=n_j/N_max 在回流路（按累积样本数）。预注册表按 H0 bootstrap 仿真标定（不 directly 用正态近似；n<100 时 follow Bowyer 2025）；一次过 k_max 要么 promote-to-constant-monitor 要么动臂降级。ADR-0038 D4。
_Avoid_: unplanned looks 增加 Type I error、重复测同一批用例不当 peeking、未校准 bootstrap 边界直接套 z。

## Graded Relevance Label Skeleton（分级相关标签骨架）
0-3 relevant-id 分级标签是数据基建不是 gate：本轮只落 schema/人工双审/报告层 nDCG@k（仅报告，绝不进门禁）；语义臂 OF 家族仅预注册占位不实算。触发后续升级=标签数过 Sakai 功效阈值 + judge 校准一致率达标 + D8 探测地面成立。ADR-0038 D7。_Avoid_: 未校准 judge 进门禁、语义臂双路 OF 同居一轮、nDCG gate at n≈20。
## Tau Observation Layer（tau 观测层）
tau（7/30/90 硬编码）不改参数、只配齐观测数据资产的层：P0 access-age 直方图（age_at_access 预留接口，预固定桶）+ tau 敏感性扫描（replay 生产打分、产出排名位移分布，绝不报命中率）；P1 BG/NBD 群体级寿命估计（外置 python scripts/tau/bgnbd_fit.py + 版本化 JSON）+ 校准图 + 复活遥测；全部进 eval-report Observational 区、永不进门禁。ADR-0039 D1–D4。
_Avoid_: gating on observational metrics, proxy-fitting tau from top-k hit rate (circular), online histogram aggregation in read path

## Pre-Registered Day Buckets（预注册 day-bucket）
access-age 直方图/校准图/PSI 共用的一次性锁定桶界：0-1/2-7/8-30/31-90/91+，与 7/30/90 tier 对齐；桶界与任何模型预测无关（防自证分桶，FSRS 教训）；桶改动即 baseline 指纹翻牌 + 强制重基线（ADR-0027 D9 / ADR-0036 lockN 纪律家族）。ADR-0039 D4。
_Avoid_: post-hoc bucket reselection, bucket boundaries derived from observed outcomes, cross-dataset bucket comparison without fingerprint

## Access Events Log（访问事件 append-only 日志）
access_events(memory_id, accessed_at) 事务时间维 append-only 事件表：touchAccessed 读路径懒触发 INSERT（每搜索上限 limit 次，微秒级），不继承 valid_until、undo 不改写不删除（补偿语义）；归档行不产生新事件。与检索行 valid_until 的 bi-temporal 轴是显式区分的两条时间轴。ADR-0039 D5 + Boundaries。
_Avoid_: inserting access events in the save path, mutating/deleting events on undo, gating or ranking reads off this table

## Explicit-Skip Telemetry（explicit-skip 三档遥测）
样本/条件不足时不出占位数：目标指标标记 skipped + 报告写 deferred reason 原文引用触发条件 + 进 WARN 台账（exit 0 放行留痕，3 连败升人工）。与未校准标记、deferred-registry 同构。BG/NBD 三条件 AND 门（T1 300+100 / T2 PSI<0.25 同桶 / T3 90 天窗+30 天间隔）未达一律走它。ADR-0039 D6/D7。
_Avoid_: placeholder parameters posing as fit results, silent skip without ledger, fail-closeding data-insufficiency as system red

## Tamper-Evident Hash Chain（prev_hash 防篡改哈希链）
access_events 每新行携带 prev_hash = SHA-256(固定序命名 key canonical JSON(整行含 prev_hash))，对封闭 ASCII 标量集字节等价 RFC 8785。哈希字段集 {id, memory_id, accessed_at, prev_hash, schema_version, event_type}；legacy 行 prev_hash=NULL、schema_version=NULL(=v0)。独立验证器 ORDER BY id 逐行重算 + fork 检测 + legacy digest 比对。ADR-0040 D2/D4。
_Avoid_: hand-concatenated key:value hash input, REAL columns in chain input, ORDER BY accessed_at verification, shared serialization code between writer and verifier

## Chain Genesis Anchor（链创世锚定）
存量行零改写前提下的 cut-over 承诺：升级首次打开时 BEGIN IMMEDIATE 单事务内扫描 legacy 段算聚合 digest，写入单行表 access_chain_anchor（id=1 CHECK 约束）；其 genesis_hash 作为首条受保护事件的 prev_hash，自身为链头。FK=ON 使表内 genesis 行不可行故落单行表。ADR-0040 D3/D6。
_Avoid_: UPDATE rewriting legacy rows, cross-database anchoring transactions, silent absence of the anchor (missing anchor = writable unprotected events)

## Fail-Closed Verification Gate（fail-closed 验证门）
verify-access-events.mjs 挂 ship-gate step 1 即红：确定性验证无 WARN 观测轮（SLSA VSA 二元 PASSED/FAILED 先例；断链=ADR-0038 D2 proven-negative）。exit 契约：0=通过 / 1=断链·首错·FALSE PASS / 2=无输入·usage·内部错误；无库不再 skip：ANS_DB_PATH 显式设置但缺失=配置错误即 fail，未设置时 gate 走自产对象轨（Gate-Built Verification Object，ADR-0041 D1）；skip-ledger 留作纵深兜底。全量 O(n)，不抽检。ADR-0040 D5 / ADR-0041。
_Avoid_: fixture databases masquerading as production verification object (gate-built object sanctioned only when produced by the real write path in this gate run), fail-open or silent skip on missing database, WARN observation round for deterministic verification, sampling, trusting exit code alone without the PASSED verdict double-check

## Alert-on-Silence Telemetry（静默告警遥测）
插桩写入失败不得静默：原 catch{} 改为计数遥测 eventWriteFailures 入 Observational 区（report-as-contract，永进门禁 Goodhart）。PCI DSS v4.0 把日志系统自身故障列为必告警事件类；bootstrap 失败同走此降级通道（stderr WARN + 遥测位，ADR-0009 D6 fail-open）。ADR-0040 D2/D6。
_Avoid_: bare catch{} on instrumentation writes, gating ship on observational telemetry, silent bootstrap failure

## Gate-Built Verification Object（闸口自产验证对象）
ship-gate step 1 无本地消费库时不再结构性 skip：spawn tsx scripts/chain-gate-fixture.ts 用真实 SqliteSessionStore 写路径现场生成 .ship-gate/chain-gate.db，verifier 经 --db 指向它；闸门通过条件=exit 0 且 JSON verdict="PASSED" 双校验。与 SLSA verify-what-you-build 同构（构建与验证同一 run，对象绑定本次产物）；分层规则：ANS_DB_PATH 缺失即配置错误 fail，默认库存在则 verify-what-you-consume 恒优先。ADR-0041 D1。
_Avoid_: fixture substituting for the production chain claim, shared serialization code with the writer, non-deterministic fixture content, exit-code-only pass

## Synthetic Observation Track（合成观测轨）
CI/验证专用的静态 fixture 数据轨，与 consumed track 严格分账；只喂养 gate/dashboard 机器，永不冒充生产信号。ADR-0042 D1/D2。
_Avoid_: synthetic data leaking into production retrieval or archive signals, runtime generation inside CI, unmarked fixtures indistinguishable from real rows

## Fixture Pair Falsification（成对 fixture 证伪）
每个 gate 条款配一个最小 fail fixture（OFAT），与 pass fixture 成对覆盖真/假两分支。ADR-0042 D3。
_Avoid_: fixtures that only test the happy path, parameter-matrix explosion beyond the four clause-mapped fixtures, duplicating unit-level negatives at integration level

## Simulated Observation Window（模拟观测窗）
仅在 synthetic track 内用模拟时钟构造 T3 观测窗；报告必须标注 simulated-observation-window，真实轨保持墙钟语义。ADR-0042 D5。
_Avoid_: applying simulated clocks to the consumed track, unlabeled simulated-window reports, redefining T3 to dodge the simulation label

## Data-Absent Skip（结构性缺数 skip）
数据结构性缺失时的 skip 原因码，与 gate-not-met 分离，从不计入 3 连击升级预算。ADR-0042 D4。
_Avoid_: counting data-absent toward the escalation streak, conflating empty-database runs with gate failures, streak resets that re-notify on the same condition

## Switch State Machine (S0–S4)（切换状态机 S0–S4）
consumed/synthetic 双轨间的五阶段迁移状态机：S0 合成-only → S1 consumed 观测 → S2 双轨一致性窗口 → S3 consumed-primary → S4 合成轨定格为 CI 基线；带显式回退边。ADR-0043 D2。
_Avoid_: one-shot switchover, binary consumed/synthetic flag, switches without back edges, retiring the synthetic track into deletion

## Pre-Registered Readiness Trigger（C1–C4 预注册就绪触发）
S0→S1 晋级的预注册复合阈值表（C1 数据量 / C2 观测窗 / C3 PSI 稳定 / C4 连续 N 轮 + k_max 收敛）；任何条款不满足即留 S0，「有 events 但无 fit-eligible」归 data-absent 永不晋级。ADR-0043 D3。
_Avoid_: ad-hoc readiness checks, hardcoded placeholder inputs posing as triggers, promoting on a single round of evidence

## Graded Rollback with Inconclusive Hold（分级回退与暂停核对）
退化谱系分轻度（S3→S2 暂停核对，过即恢复，不计回退）与重度（连续确认后 S2→S1 真回退）；完整性谱系（哈希链/写失败/指纹漂移）不走回退走 fail-closed 硬阻断。回退事件不递增 3 连击。ADR-0043 D5。
_Avoid_: single-shot rollback on any degradation, treating integrity failures as state rollback, rollbacks that pollute the escalation streak, flap between adjacent stages

## Edge-Typed Replay Function（按边类型化重放函数）
切换链的每个 `event_type` 都对应唯一的 from-to 边，重放折叠对日志是全函数；`--verify` 从尾哈希比对升级为重放推导 phase 对比，不可验证即 quarantine 而非静默自愈。ADR-0044 D1。
_Avoid_: hint-style transition rows that cannot determine the next phase, verify-by-last-hash-only, silent rebuild from an incomplete replay

## Log Sufficiency with Materialized Cache（日志充分性与物化缓存）
状态事件链必须是状态的日志，物化 state block 只是可重建缓存；链为真相，缓存漂移由重放验证器兜底。ADR-0044 D1。
_Avoid_: treating the materialized block as the source of truth, accepting a lossy replay, rebuilding before the chain is proven sufficient

## Committed Registration Payload（绑定预注册载荷）
预注册阈值表按单消费律、绑定校验律、加性演进律管理：每个值只被一个决策位点消费；加载时对独立钉死的全长 SHA-256 期望值校验；schema 只做加性扩展并逐字段无损透传。ADR-0044 D2。
_Avoid_: self-computed hashes without an expected value, dead registration fields, deleting or reinterpreting old reasonCode values, truncated identity hashes

## PDP/PEP Enforcement Boundary（PDP/PEP 执行边界）
完整性 fail-closed 只放在证据转裁决或发布的两个生效点（advanceSwitch 与 ship-gate）；eval runner 保持 audit/report-only，二者通过 run 级 integrity verdict 与 runPurpose 契约解耦。ADR-0044 D3。
_Avoid_: aborting eval on integrity failure, moving the gate into the measurement loop, observational metrics driving release red

## Synthetic Drill Plane（合成演练双平面）
演练与真实裁决分属不同持久平面：drill 模式结构上拒绝写入真实 dbPath/outDir，链事件携带来源证明，synthetic 的 gate-not-met 不占 consumed 升级预算。ADR-0044 D4。
_Avoid_: test-card-to-live persistence, source-less chain events, synthetic fixture failures consuming real escalation streak

## Pre-Registered Statistical Power Guard（预注册统计功效守卫）
C2 评估频率注册为 `slaFrequency` 并按不低于 2x SLA 检查；S2 注册最小 discordant pair 下限，样本不足时整窗 WARN，永不静默通过、永不 red。ADR-0044 D5。
_Avoid_: window-only readiness checks, equivalent verdicts without a minimum sample guard, silent pass on insufficient statistical power


## Unified Fusion Governance（统一融合治理）
一条融合治理契约统一记忆侧五臂与 web provider 三源两套 RRF 实例的注册、权重、缺失语义、溯源和最终 top-k 契约，但两实例零数据共享且保留各自算法与校验权威。ADR-0045 D1。
_Avoid_: fusing the two ranked lists into one score pool, sharing one runtime registry without instance authority, treating web and memory score semantics as interchangeable

## Fusion Registry Field Set（融合注册字段集）
L1 最小注册字段为 k_fusion、rank_window、ROR_WINDOW、weights.memory、weights.web、armAbsentSemantics，加只读 algorithm 枚举；三份历史同为 60 的值拆开注册并各自单消费。ADR-0045 D2。
_Avoid_: implicit defaults scattered across call sites, a fused registry with no provenance schema, storing per-query or runtime-adaptive weights in the committed payload

## Top-k Consumption Contract（最终 top-k 消费契约）
融合结果按全池 RRF 排序、截断前溯源注解、全池 MVSS、纯前缀 top-k 截断；fused score 只是 rank_fusion 信号，不充当置信度、阈值、abstain 或跨查询可比分数。ADR-0045 D3。
_Avoid_: exposing a bare fused score, thresholding rank fusion, reordering weak evidence below strong evidence, computing MVSS after truncation, letting attribution rewrite the fused order

## Algorithm Switch Gate（算法切换门禁）
记忆侧默认 weighted RRF；切换 CC/score fusion 必须预先注册分数完备、稳定性、分级标签功效和统计功效并复用 gain gate；web 侧长期固定等权 RRF。实现融合治理时禁止顺手换算法。ADR-0045 D5。
_Avoid_: swapping fusion functions during a governance refactor, promoting an unregistered candidate, treating unproven-positive as red, folding integrity failures into state rollback

## Fusion-Level Ablation（融合级逐臂消融）
记忆侧六臂的增益证据通过 drop-arm 反事实重算 RRF 获得，臂级 delta 只是 secondary，融合后 RoR 是唯一 primary；FTS 锚臂只报告不判定。ADR-0046 D2/D3。
_Avoid_: per-arm independent gate decisions, averaging arm deltas into a fused score, judging the FTS anchor from ablation deltas

## Reverse Weakest-Link Gate（反向 weakest-link 门）
预注册单侧 harm 检验（H0: delta >= 0 vs H1: delta < 0），与 gain 门共享同一 OF alpha 轨、只做 beta 校正；`minHarm = -minGain = -10pp`，n<10 降 WARN。ADR-0046 D4。
_Avoid_: separate alpha budgets per arm, one-shot red on a single observation, unproven-negative as red, using holdout as an independent significance gate

## Paraphrase-Only Golden Slice（纯释义 golden 切片）
轻/中/重三档 paraphrase 变体；轻档必须配正向断言，中档为主体，重档只进报告与反事实正类；标签人写并双审，`maxLexicalOverlap` 预注册校准后启用。ADR-0046 D1。
_Avoid_: turning paraphrase robustness into a positive threshold gate, lexical pseudo-paraphrase pollution, treating heavy-paraphrase FTS failure as a system red

## Web Provider Observational Ledger（web provider 观测账本）
web provider 的独占命中、重叠、原生分数缺失和失败只落 Observational zone，无 verdict、无阈值、无 gate、无新表；只能进入 WARN、人工 review 与 ADR-0045 生命周期降级。ADR-0046 D5。
_Avoid_: observational provider metrics driving ship red, new durable tables for provider analytics, treating equal-weight deviation as evidence, provider thresholds in the ship gate

## Emergency Ship Override（紧急发布放行）
在已确认 critical arm 红色阻断发布时，允许以封闭枚举的 reasonCode 与显式 override 目的放行一次；每次 override 都强制重定基线并产生事后复核义务，且同一基线代际内至多一次。ADR-0046 D6。
_Avoid_: 无理由码的静默放行、跨代际累计失败预算、把 observational red 当成 ship-blocking、允许 override 污染真实评测状态

## Override Epoch（override 纪元 / 基线代际）
override 配额所归属的时间边界由 forced rebaseline 后的 golden/holdout fingerprint 对决定；指纹对变化即新纪元、配额恢复。日历时间与代码版本只作观测与审计，不参与配额判定。
_Avoid_: 用墙钟、git tag 或 package version 切分 override 配额，把“当前读取时刻”当作窗口锚点，把已发生窗口的债务带入下一代际

## Ship Override Ledger（发布 override 账本）
append-only 的事件账本记录每个 override 的纪元、reasonCode、时间与事后复核引用；损坏或不可验证时 fail-closed，不并入其它易重写的观测状态。
_Avoid_: 与 skip/gain 观测账本共享状态、正文内嵌、静默重置计数、绕过内容哈希验证

## Postmortem Obligation（postmortem 义务）
每次 override 必须在截止前产出可校验的复盘工件，包含影响、原因与至少一个可执行后续项；未在截止前产出即进入 LATE，触发下一轮发布阻断。截止以事件锚定为主，且不超过七天宽限。
_Avoid_: 只提醒不落工件、把空复盘当作已闭环、把完成动作省略为状态标志、用无限期等待替代截止

## Late Acknowledge（迟交确认）
postmortem 进入 LATE 后，允许显式确认迟交并继续推进，但该确认计入当前 override 纪元的同一次配额且不得豁免原有义务。
_Avoid_: 免费重置义务、绕过账本记账、多次确认形成规范漂移、把确认当成 postmortem 完成

## Calibration Labels File（校准标签行集）
Relevance labels 的文本 system of record；每个 revision 的 JSONL 载荷只读，可写草稿只存在于未 commit buffer。行级 diff 和 promote 都在 revision 边界发生。
_Avoid_: 把标签写回源码 case、放入运行产物目录、让 CI 自动写标签、用单对象 JSON 承载增长型标注

## Calibration Revision Registry（校准 revision registry）
内容寻址的不可变 revision 目录加 registry index 与 head/labels 指针；revision 落盘后不可变，当前态由可变指针决定。
_Avoid_: 覆盖已冻结 revision、用单一全局 stage 表达状态、把 head/labels 分文件无序更新

## Calibration State File（校准状态文件）
`state.json` 作为 `{head, labels, seedRef, schemaVersion}` 的单一原子提交点，通过同目录 temp + fsync + rename 切换。
_Avoid_: 多指针分文件提交、原地覆盖写、跨卷 rename

## Calibration Journal（校准 journal）
append-only 事件流，记录 label、promote、retire、seed import 和 head move；reconcile 用单调 seq 与 state.json 对账。
_Avoid_: 原地改写历史事件、journal 与 state 乱序提交、用 event log 加 replay 引擎替代全量 revision 快照

## Calibration Promote（校准标签 promote）
用户显式把候选 revision 冻结为权威版本的治理动作；只更新指针和版本，不替代 judge 门禁，也不把标签并入 golden gate。
_Avoid_: n 达到阈值即自动 promote、ship-gate 顺手 promote、把未校准 judge 的结论直接晋升、用 promote 绕过人工复核

## Judge Calibration（judge 校准）
用独立盲标人标签估计 judge 与人的一致性。正式判据为 pooled AC1 CI 下界 ≥ 0.7、po ≥ 0.8、CI 宽度 ≤ 0.4；Cohen κ 仅作边际差异诊断。模型、rubric 或标签分布变化要求重新校准。
_Avoid_: 用 judge 自评作为校准证据、展示 judge 判定后再让人标、把 n 下限当作可信度保证、静默切换 judge 版本后继续沿用旧校准、数据后挑系数

## Score Bridge（score bridge）
候选 revision 与冻结 vN 之间的逐 case 集合差异报告：unchanged、added、removed、revised-case，并报告翻转方向和 exact McNemar。它只证明变化，不证明正确性。
_Avoid_: 用候选与旧版的一致率替代盲标人效度证据、把 bridge 分数并入模型增益、无理由 removed/revised

## Insufficient Calibration（insufficient 三态）
CI 宽度过大或组内样本不足时，只报告“不可裁决”，不写 pass/fail；组级红旗用于定位 rubric/case 问题，不参与 judge 发证。
_Avoid_: 小 n 下强行 pass/fail、组内 5-6 例直接做 chance-corrected 门禁、用多数票掩盖两人分歧

## Calibration Seed Snapshot（校准 seed 快照）
冻结 `calibration-cases.ts` 对应的不可变 `seeds/calibration-set-vN.*` 快照；未声明漂移保持 exit 12，声明 flip 后走新快照加重校准。
_Avoid_: 就地改 frozen seed、绕过双锚校验、把 label 写回 seed 数组

## Case Tombstone（case retire）
`case_retire` journal 事件携带 `retiredAt`、`reason`、`supersededBy?`；不改历史记录，state 投影对 retired case 标记隐藏。
_Avoid_: 删除 label 行代替 retire、无 reason 的静默移除、让 retired case 参与下一次 active-set promote 覆盖计算

## Attribution Gold Label Line（归因 gold 标签线）
独立于 relevance calibration 线的 claim-vs-evidence 二元 ground-truth 标签线；样本流与盲标批次可共享，标签、rubric、fingerprint、manifest 和 head 指针必须物理隔离。ADR-0050。
_Avoid_: 用 judge 输出当 gold、复用 relevance label 标 claim、让两条线的 promote 互相改指纹

## Fused Score Calibration（fused score 校准）
把 attribution 的启发式 fused confidence 映射为 supported 后验概率的本地统计校准；小样本默认 beta calibration，isotonic 仅在标注量足够后作为升级路径。ADR-0050。
_Avoid_: 把 fused score 当概率、未独立校准集就拟合、用 ECE 单指标代替 fit/eval 分离证据

## Attribution Decision Threshold（归因决策双阈值）
在校准后概率曲线上按预注册目标精度与 held-out 校准集选择的两条阈值：上阈进入 supported，下阈进入 unsupported，中间进入 uncertain 的升级或弃权路径。ADR-0050。
_Avoid_: 后验调阈值、把阈值塞回 golden、在评价切分上搜索阈值、校准缺失时无限放行

## Calibration Fallback Floor（校准兜底底线）
校准 revision 缺失、样本不足或指纹漂移时回退 legacy 静态阈值并打 `degraded` 告警；它保持可用性，但不冒充已校准信号。ADR-0050。
_Avoid_: 校准缺失时崩溃、静默继续、用回退值替代重新校准证据


## Attribution Calibration Segment（归因校准分段审计）
对单一 attribution-gold 校准线按 retrieval instance（web|memory）做的只读分组观测；不参与 beta 拟合或阈值推导，只产出覆盖率、漂移和校准差异红旗。ADR-0051。
_Avoid_: 把 segment 当独立校准线、用 segment 标签改拟合、按 segment 静默拆线


## Context Engineering（上下文工程总纲）
把 attention budget 下的 token 策展作为统一总纲：记忆与注入是 context curation，多臂 RRF 与充分性门禁是 context assembly，预注册评测与校准是 context quality measurement，观测闭环是 context telemetry。ADR-0052。
_Avoid_: 把上下文工程当提示词措辞、把四个既有资产拆成平行系统、用模型推理替代证据治理

## Observability Closed Loop（观测闭环）
以本地优先观测资产连接 runtime trace、eval 与 experiment：生产 trace 回流 eval，失败回流 golden，实验经 ship-gate 后部署。`gen_ai.evaluation.result` 只承载结果，不执行判定。ADR-0052。
_Avoid_: 把观测数据直接当 gate、用 trace 平台替代预注册评测、让在线观测绕过离线 holdout

## Local-First Observation Asset（本地优先观测资产）
单进程 SQLite 形态的 trace/observation 资产；一次用户任务一条 trace，generation/evaluation 为 observation，rubric 项为 score，`runId` 防重放。内容捕获 opt-in 且策略先行。ADR-0052。
_Avoid_: 默认抓取高敏感内容、把单用户本地资产伪装成多租户服务、无保留策略无限增长

## OTLP Mapping Layer（OTLP 映射层）
自有版本化内部观测表示为 schema 契约，只在导出边界映射到 `gen_ai.*`；自定义属性使用 `anysearch.*` 与 `eval.*`。ADR-0052。
_Avoid_: 直接暴露未钉版本 `gen_ai.*`、把自定义属性占入保留域、在内部模型里复制外部改名史

## Semantic Pin（语义版本钉定）
对仍处 Development 的 OTel GenAI 语义按 commit 钉版本并记录 tested-with 表；不把 Development 命名空间当作长期稳定契约。ADR-0052。
_Avoid_: 声称稳定、升级时不重跑映射测试、只记 SDK 版本不记 exporter/backend 版本

## Content Trust Boundary（内容信任边界）
把「读用户未写内容」的检索/工具/记忆输入统一视作不可信来源的信任边界：概率层降险（来源分类）+ 确定性层收口（schema 闸 + fail-closed 授权）组合，而非单一注入检测器。ADR-0053。
_Avoid_: 把单一概率层当充分防线、把来源标签当检测器、对持久化记忆仓只做提示层防护

## Indirect Prompt Injection Defense（间接提示注入防御）
针对检索/工具结果携带指令注入（OWASP LLM01）的防御心智模型：不可信内容只进 tool_result、schema 化抽取、最小权限授权、防绕过探针闭环。ADR-0053。
_Avoid_: 靠 prompt 措辞护栏、托管 Prompt Shields、静默二选一

## Source Label（来源标签）
FIDES 式 `{source, traceId}` 双轴标签：`source ∈ {system,user,retrieved,tool,memory}` 做信任，`traceId` 只做关联；最严格合并传播，untrusted 胜出，不可剥离。ADR-0053。
_Avoid_: 用 traceId 当信任、裸 string 拼接、让检索内容剥离来源

## Sanitization Pipeline（净化管道）
对检索原始内容迭代到不动点的字符净化：NFC 规范化 → 剥离零宽族 → Unicode Tag 解码重扫 → bidi 剥离 →（可选）同形字折叠。ADR-0053。
_Avoid_: 单层 strip、净化前做长度校验、解码后不回扫

## Retrieval Content Schema（检索内容 schema）
净化后经 TypeBox `additionalProperties:false` 校验的检索内容形状（url/title/snippet/entity 白名单 + 长度上限 + 版本化）；形状违规 fail-closed，内容可疑降级为 stripped summary。ADR-0053。
_Avoid_: free-text 透传、无版本 schema、把 schema 校验当语义注入检测

## Fail-Closed Authorization（fail-closed 授权）
Rule of Two 总纲下的三个默认 deny 授权点：记忆仓写入（source-gate + evidence + secret guard）、URL 消费（allowlist + 用户确认）、LLM 判定输入（L1 管道断言）；判定全确定性、零 LLM。ADR-0053。
_Avoid_: 检索派生 URL 自动成为后续输入、retrieved/memory 派生直接升 T0、用 LLM 做授权判定

## INJECT Probe Suite（INJECT 探针套件）
5 族 golden 探针（不可见字符/指令注入/tool-output+URL egress/记忆投毒/组合自适应）构成的注入防绕过 eval 闭包；`canonicalPayload→SHA-256` 指纹，唯一硬门禁 `passRate==1`。ADR-0053。
_Avoid_: 用 ASR 统计当 gate、LLM 合成 label、与 STALE 探针合并

## Abstain Smoke（拒答烟雾）
LLM-in-the-loop 注入拒答行为的观测轨探针，由 probe → LLM 响应 → 三档 deterministic verdict（access-chain trace → keyword regex → LLM judge 异步采样）组成。abstainRate 与 falseAbstainRate 成对出现在 ObservationalZone，report-only，永不进 gate。ADR-0054。
_Avoid_: 当 gate、用 ASR 命名、靠 LLM judge 做 verdict 门禁、和 STALE 混跑

## Assert Judgment Input（断言判断输入）
在五个 LLM 判断边界（gap distillation / NOOP adjudication / consolidation / claim attribution / sufficiency judge）统一调用的共享断言函数，强制输入是合法的 tagged RetrievalContent。对应 LangChain before_model 接缝。ADR-0054。
_Avoid_: 在每个 caller 内部各写一遍 schema 校验、断言后又下游一次值变更

## HITL Review Queue（HITL 待审队列）
shouldAllowUrl 标 requiresHitl 的 URL 组成的持久化待审列表；headless 模式 block + reason + enqueue，TTY 模式 askAllowUrl 停机世界 y/N；用 ans hitl review 命令查看/批准/拒绝。ADR-0054。
_Avoid_: headless 挂起等人工确认、静默放行 retrieved-derived URL、绕过 allowlist 直接自动批准

## Policy Single Source（策略单一事实源）
TOML [sources].urlAllowlist 作为 URL 授权策略的唯一权威源；env 仅可经显式开关降级为加法覆盖层。kernel/server/hook 三方共享同一 mergeAllowlist + canonicalVersion 实现，处处求值同一份解析结果。ADR-0055。
_Avoid_: env 独立参与授权判定、共享解析函数各自执行（同函数多状态）

## Append-Only Merge（只增不减合并）
多层授权配置的合并语义：allow 数组跨层取并集，下层只能添加不能删除上层条目；deny 不进并集数组而是独立通道、最后评估、任何层与 hook 不可绕过（Cedar forbid-overrides-permit 同构）。ADR-0055。
_Avoid_: deny 与 allow 放同一数组求并集、hook allow 覆盖 deny、下层删除上层条目

## Policy Version（策略版本）
授权策略合并集的内容寻址版本：sha256(canonical JSON)，canonical = sort(dedupe(trim(lowercase(hosts))))；env 覆盖参与哈希，空 env 与未设置产出逐字节相同版本。drift 检测 = 版本比对，变更即发 ConfigChange 审计。ADR-0055。
_Avoid_: 单调计数器（需持久化中心状态）、TTL 过期机制、空 env 与未设置产生不同版本

## ConfigChange Audit Event（配置变更审计事件）
授权策略变更的审计记录：{ event_id, timestamp, actor, source, path, change(before/after), policy_version, trace_id, session_id }，写入本地 trace store（ADR-0052）；env 存在但覆盖开关未开时也发 config:env_override_ignored（一次/会话），绝不静默。ADR-0055。
_Avoid_: 静默忽略安全配置、审计不带策略版本与 trace_id、每条重复告警不节流

*End of Glossary*


## Session Identity File（会话身份文件）
`~/.anysearch-cli/session` — session_id 的唯一磁盘主源。对标 systemd machine-id(5)：生成一次、原子写回、用户级作用域（跨项目复用）。session_id 是写时唯一引用、永不回读做身份判定的值；trace store 侧为 write-only 派生引用。环境变量 ANS_SESSION_ID 可覆盖文件值用于 CI/调试（不写回文件）。ADR-0056 D3。

## Session ID Propagation（会话 ID 贯通协议）
跨 CLI hook MCP server 三层透传 session_id/trace_id 的契约——包括 traceparent (W3C 32hex trace_id) 与 x-anysearch-session-id (自定义 header，本地 loopback 仅用于跨层透传、绝不上游转发)。MCP 的 session_id 保持置空（SEP-2567 已移除协议级 session 概念）；client_id 从 _meta clientInfo.name 按 Railway 映射表尽力提取并引入可索引归因列。ADR-0056 D2/D3/D4/D5。

## Client ID Attribution（客户端归因标识）
MCP stateless server 从客户端 _meta 提取的 client_id——归因到"哪个客户端"（Codex/Claude Code/Cursor/...），而非"哪次会话"。取 clientInfo.name 经 Railway PR #885 映射表转换，未知客户端得 mcp_unknown。与 session_id 构成归因双维度。ADR-0056 D4。

## Attribution Columns（归因列）
observability_traces 表中为可索引审计查询新增的三个列为 injected_trace_id / session_id / client_id——均为无约束 ADD COLUMN（O(1) 迁移）。session_id / client_id 使用 partial index (WHERE ... IS NOT NULL) 避免 NULL 行（MCP session_id 大量空串）进入索引。ADR-0056 D6。

## user_version Migration（user_version 版本化迁移）
首次对 observation SQLite store 应用 PRAGMA user_version：v0（全新库）直接建 v2 完整 schema，设为 user_version=2；v1（存量库）事务化 ALTER TABLE ADD COLUMN + CREATE INDEX + user_version=2。fresh 与 migration 双路径产出的列+索引集合须一致。仓库已有 migrateSwitchEventSchema 先例。ADR-0056 D6。

## Grill Round 57 — Terms (ADR-0057)

- **node:test runner** — the Node.js built-in test runner, driven via `node --import tsx --test "test/**/*.test.ts"`. Replaces the retired `&&` chain scripts; discovers files itself, judges pass/fail by process exit code, provides per-test timeout, concurrency, and spec/tap/lcov reporters.
- **Chain membership exclusion (retired antipattern)** — the old store/package.json style where a test file only runs if a human remembered to append it to a 1916-char `&&` chain; first failure aborted the rest, and any file missing from the chain silently never ran (case: eval-switch-state-fixes.test.ts).
- **Expectations inventory** — the known-failure governance model (Chromium TestExpectations / WebKit lint-enforced bug-id / WPT expectations / Mozilla manifestparser auto-bug-filing / pytest strict_xfail): red tests are triaged fix / todo-with-issue / delete-with-justification; `todo` keeps executing (evidence retained); unconditional skip is dead code and forbidden.
- **expectFailure (node:test)** — true xfail semantics (`expectFailure` option flips pass/fail; unexpected-pass goes red). Requires Node >= 24.14; pinned Node 22 uses `todo` interim, migration deferred to Node upgrade.
- **hermetic-by-default / online-gated tests** — embedding suite default runs fully stubbed (`__setExtractorForTest`); real-model tests live behind `test:online` (node:test tags / dedicated script) and never block offline CI (SWE-book ch23; pytest-test-categories; Sopel/vcrpy precedent).
  - 无网时向量臂 fail-open 降级为观测性语义（非缺陷）；向量臂 eval 金案例归属 `test:online`（ADR-0057 r59 errata、ADR-0060 D7），离线报告须标注 degraded。
- **Carried-over acceptance closure** — ADR convention this repo follows per ADR-0057 D5: a later round that fixes a prior round's PARTIAL AC declares `Closes ADR-XXXX ACn` in its own ADR, adds a single pointer line to the old ADR, and registers the entry in deferred-registry — one atomic PR, old bodies never edited (Nygard/AWS/MS/MADR/KEP/GEP).


## Grill Round 58 — Terms (ADR-0059)

## CI/Release Two-Tier Eval（评测双层分工）
memory-eval 的门禁分层：CI 红绿 = 确定性回归断言层（fail-closed，observational 级，不消费 OF look 即 "不 peek 不花 alpha"）；统计显著性层 = decision 级，只在发布动作（pre-tag dispatch 评审 + post-tag release.yml 断言）消费预注册 OF look。工业先例：FirstMate "Deterministic checks gate merges. Statistical metrics report."、Braintrust promotion criteria。F-15 根因是 decision 语义挂错层级。

## No-Alpha-Without-Peeking（不看不花 alpha）
OF alpha spending 的正确接线语义（Spotify 原语）：只在真实评审/peek 时消费预注册 look。CI 每次跑不消费（ANS_EVAL_NO_LOOK=1）；look 账本不入外部存储、入库 git append-only + 压缩上限；post-tag 不消费新 look（防 OF 双花）。

## Quarantine-by-Ledger（台账标记式隔离）
flaky golden case 的隔离走 policy 层台账标记而非集合变更：golden 指纹不变、零重校准；30 天 TTL + 复评（ADR-0027 D8 执行）；移出再放回不算新证据、不重置统计预算（ADR-0038 对称）。

## Gate-of-the-Gate（门禁自身的门禁）
ship-gate step_0 三不变量：工作流 YAML 合法性（fail-closed）、干净树（git status 空才能发布）、gitignore 漂移（tracked∩ignored 为空）。原则：门禁的漏洞也要被门禁覆盖（F-10/F-11 教训）；pre-commit hook 只能快反馈、永不做强制点。

## SSOT-Derived Index（单一事实源派生索引）
docs/adr 是唯一事实源；README 索引 = 派生产物，由 stdlib 脚本生成 + ship-gate --check 漂移断言（terraform-docs "regenerate + diff" 模式）。手动维护索引 = Decision Documentation Theater 失败模式。

## LYING-Class Doc Drift（LYING 类文档漂移）
文档宣称从未存在的能力（withagents 四分类之一）。处置：删宣称 + 接线断言防复发，而非补实现（依 Ponytail 删优于留 + 价值裁决）。锐评的 engine 死配置即此类的仓库实例。

## Grill Round 59 — Terms (ADR-0060)

## Corrective Supersession（更正性取代）
ADR 状态机唯一合法的自更正出口：旧 ADR 翻 `Superseded by ADR-NNNN (date)`，仅动状态行，正文/errata append-only 保留；新 ADR 承载更正并反向指针。「Void」不是 Nygard 原语，不使用。工业来源：Nygard 2011 / Fowler / AWS Prescriptive Guidance / GitLab / MADR / adr-tools。

## No-Grandfathering（禁止既有偏差豁存）
被判定平行宇宙/不合规的历史内容不得以任何形式豁免保留，只能走 Superseded 出口。与 waiver（一次性、判据化、不自动续）严格区隔：豁免给流程，grandfathering 给内容——后者在本仓非法。

## Waiver Quintet（豁免五判据）
多票轮（ADR-0029 的例外）成立 iff：1 单一伞形主题且各票同源；2 票序显式且逐票独立验收；3 waiver 写进当轮 ADR 且下轮不得自动沿用（sunset）；4 两次内必回一轮一主题；5 独立复核签字（atomcode 审计角色）。工业映射：sunset clause / security exception expiry / FedRAMP POA&M / RFC 9280 §8。

## Evidence Anchor Resolvability（证据锚点可解析）
ADR 中的 git 引用（40 位 SHA）必须 `git cat-file -e` 可解析，否则 fail；被 squash 蒸发的引用改用 PR 编号 / 完整 SHA permalink / 文件路径+行号，不可解析者带显式 `[squashed]` 脚注进白名单。git 命令自身失败 = fail-closed。先例：git-filter-repo #108、GitHub 完整 SHA 钉定政策、SPDX checksum-on-reference。

## Claim-Precision Errata（宣称精度更正）
验收标准「发布时即不成立」的处置 = append-only errata（不翻状态、不改原文），且必须含 anti-downgrade 句（精度更正 ≠ 质量标准降级）。RFC errata 判据（发布时即错 → errata；新思路 → 新文档），仓内先例 ADR-0040。

## Observable Fail-Open（可观测降级）
fail-open 是 availability 的合法语义（authzed），但前提是降级必留痕迹（计数/telemetry/报告 degraded 标记）；静默降级改变被测语义 = 缺陷。仓内锚点：embedding index.ts 失败计数、ADR-0009 D6、ADR-0057 D4 test:online 边界。

## Grill Round 60 — Terms (ADR-0061)

## Coverage Manifest（覆盖清单）
golden 评测集的自述文件（`eval-looks.coverage.json`）：每个维度标 `covered|deferred`；deferred 维度必须附**入账触发**（B4 回灌 / 首个真实弃答 / 首个真实注入），缺失维度显式呈报而非凑数合成。验收依据：声明了没有，而不是收齐了没有。先例：Pranay Suyash "Your LLM Eval Set Needs a Manifest"、matric-eval deliberately-deferred 模式。

## First-Party Inclusion Rule（一手源入圈规则）
语料锚定单元是**规则**而非 URL 清单；URL 清单是规则的当期输出。入圈需全部满足：一手性（官方源，禁止二手转述）、日常依赖可举证、可回访（版本化/permalink 锚）、八维切片有新增益。出圈触发：上游 supersede / 超期翻 stale / 连续两 round 无 golden 引用 / 404-410 无继任。出圈 URL 按 Corrective Supersession append-only（复用 ADR-0060 状态机与 HITL 出口）。来源：OWASP RAG Security Cheat Sheet、Ground/Waxell staleness budget、Coalent 事件驱动 supersede。

## Milestone Serial Slicing（里程碑串行切票）
walking skeleton 收尾后的首个交付轮遵循 B1→B2→B4→B3 串行票序；每票独立验收，票间依赖即"上票的真实产物"。并行流是假并行（合并成本超线性），单一大票被豁免五判据禁止。G1 治理票挂尾 + sunset，复用 Waiver Quintet。来源：valery.tech lifecycle、mergify TBD、Tricentis big-bang 教训。

## Grill Round 61 — Terms (ADR-0062)

## Dual-Gate Domain Filtering（双闸域过滤）
域约束分两闸：pre-filter（检索前置，能力协商式——provider 支持 include_domains/includeDomains 就下发，不支持者诚实降级）+ post-filter（engine 层权威出口闸，按 canonicalizeHosts 同一匹配语义裁决最终 host，空即 abstain）。双闸各发 audit 事件（retrieval.domain_filter.pre/post）。policy 请求时从 ADR-0055 单源解析，retriever 不缓存快照（标签漂移 9.7% 教训）。红线：query-rewrite 禁注入 site: 运算符。_Avoid_: post-filter 单闸省 pre-filter（无能力协商→全量召回再砍，精度口径劣化）；retriever 侧缓存 policy 快照（标签漂移先例）；断言靠关键词 regex 而非结构化 verdict。来源：TrustNLP 2026 AFR、Tavily/Exa 能力矩阵、egress-filtering 纵深防御。

## First-Class Abstain（第一类拒答）
abstain 是策略成功执行的第一类结果，非 error 非 no-match：CLI 输出结构化一行消息且 exit 0（默认不非零，可编程区分走 --fail-on-abstain）；MCP/plugin 走 isError:false + structuredContent.abstain 契约，让宿主 agent 程序化消费（转域/告知边界）。断言锚定结构化 verdict 字段，关键词 regex 仅 observational；must-abstain 与 must-hit golden 成对防过拒。_Avoid_: abstain 默认非零 exit（自动化无法区分策略成功与真失败）；MCP 侧用 isError:true 表达拒答；断言只锚关键词 regex。来源：MCP 规范 isError 双层、ripgrep #2500、inspect_ai content_filter、promptfoo is-refusal。

## Abstain Observability Dimension（拒答观测维度）
abstain 计数是独立可观测维度（outcome:abstain），绝不混入 error 计数；abstain 率突增 = policy 误配置信号（over-refusal 的运行时镜像）。_Avoid_: abstain 混入 error 计数（误配置信号被稀释）；拒答无独立维度导致过拒无运行时镜像。来源：You.com missing-results 与 request-exceptions 分桶要求、inspect_ai stop_reason 独立槽位。

## Grill Round 62 — Terms (ADR-0063)

## Declared Exclusion（声明式排除）
eval 运行中被编译期常量（OFFLINE_EXCLUDED_GROUPS）显式排除的用例组——verdict 上是 warn/hold/skip 而非 failure，与 Data-Absent Skip（结构性缺数）是两个类目：排除是声明过的边界，缺席是数据事故。治理走静态断言（存在性 + 白名单精确匹配 + 离线覆盖下界），不走运行时配额——排除面是 diff 可见的常量，配额无感知对象。红线：排除面扩容必须撞红强制 review 自知，禁静默扩大。_Avoid_: 运行时配额当排除面治理（无感知对象、不可 diff 审）；排除与 Data-Absent 混记；扩容不撞红。来源：Kayenta Nodata/NodataFailMetric 二分、Chromium TestExpectations 声明式治理、pytest skip 语义、coverage.py 集中排除声明。

## Golden Entry Scope（golden 条目 scope 标记）
docs-golden 条目的显式执行层归属 stub|live|both——带 mustHit* 的 answer 条目强制显式声明，无默认兜底（默认值即漂移入口）。离线 stub 层证管道契约（provider 给 X 则 verdict 必须 Y；夹具独立于 expected、取自 badcase observed 现场），在线层证现场真实性（真 provider + URL 硬断言）。_Avoid_: scope 缺省兜底（默认值即漂移入口）；stub 夹具取自 expected 而非 badcase observed 现场（循环论证自证）；live 层无 mustHit* 硬锚。来源：pytest-test-categories 显式分类哲学、Langfuse/Inngest offline-online 双层模型、Speedscale《Your Mock Is Lying》自证预言批判。

## Spillover Probe（连带探针臂）
非阻塞 CI 实验腿，验证某修复对同族异 OS 症状的连带效果——三件套：job 名显式实验标注（experiment, non-blocking）+ 崩溃签名进 step summary（区分注册期 segfault vs 退出期 mutex abort）+ TTL（复评点转正或摘除，禁无限期挂）。区别于被禁的工作流级静默跳过：仍执行、仍产出观测、仍上传 artifact。_Avoid_: 工作流级静默跳过当实验（零观测产出）；探针无 TTL 无限期挂；崩溃签名不进 step summary（崩溃相位不可分）。来源：onnxruntime #24579/PR #26445 修复链（1.24.3 实证）、better-sqlite3 #1476/#1514 同族签名、costops 矩阵剪枝+预注册恢复条件、minware quarantine 治理。

## Install Closure（安装闭包）
消费者 npm i -g 实际拉入的依赖集合——其内容（如"无 onnxruntime-node"）是可断言的发布面而非实现细节。可选能力走 peer-optional（peerDependenciesMeta.optional：不自动安装、缺席无 warning）+ 守卫式动态 import：缺席即降级（向量臂→FTS-only），不拖垮安装。红线：把重型可选运行时放进硬依赖 = 让安装闭包为可能永不启用的能力买单。_Avoid_: 安装闭包当不可断言的实现细节；可选能力回 optionalDependencies（R63 T2 已迁 peer-optional，见 Peer-Optional Capability）；守卫式 import 缺席时 throw 而非降级。来源：npm RFC-0000 optionalDependencies 心智模型、esbuild 官方形态、npm cli#7355 optional 非银弹需消费端容错。

## Grill Round 63 — Terms (ADR-0064)

## Bundled-CLI Publishing（bundle-CLI 发布形态）
monorepo 发 CLI 的三分形态之一：bundler（tsup noExternal）把私有工作区包吞进 app dist，manifest 中这些包只作 devDependencies 如实声明 build-time 依赖，registry 只发消费面（cli/mcp/plugin）。区别于 publish-everything（内部包作真包发，需其有独立消费者价值+版本机器）与发布期 manifest 剥离（自建改写机器）。_Avoid_: bundled 包留在 dependencies（死声明让 npm 侧拉不存在的包）；为省 registry 面自建 manifest 改写脚本（getlang 破包先例）。来源：LaunchDarkly highlight.run 教程、tsup#1251、jlevy pnpm-monorepo-patterns、changesets#1389 反例。

## Peer-Optional Capability（peer-optional 可选能力）
重型可选能力（embedding/向量臂）的声明形态：peerDependencies+peerDependenciesMeta.optional——不自动安装、缺席无 warning、用户显式加装即启用（guarded dynamic import 缺席≡null）。区别于 optionalDependencies（默认安装、仅失败时降级 warning——放重运行时=安装炸弹回归）。_Avoid_: 可选重运行时回 optionalDependencies；optionalDep 指向 private 包（每次安装拉注定 404 的声明）。来源：npm RFC 0030（no-install-optional-peer-deps 已 implemented）、npm package.json 官方文档；Install Closure 的机制化修正（R62 optionalDependencies→R63 peer-optional）。

## Canonical Rewrite Exemption（canonical 改写豁免）
tarball manifest 与仓库 manifest 的合法差异边界：仅当改写由包管理器 canonical 语义执行（pnpm publish 的 workspace:*→实版本）且结果可从仓库 manifest 确定性推导时，豁免于漂移面定义；自建 transformer 不在豁免内。_Avoid_: 默认豁免任何发布期改写（滑坡——剥离方案会借此混入）；豁免扩大到非 canonical 工具。来源：pnpm.io/workspaces 官方 rewrite 语义、pnpm#6941、LYING-Class 漂移定义。

## Quarantine Ratchet（隔离集棘轮）
隔离集合的机器治理形态——只允许单调改善：entries 相对基线只减不增（新增即红）、renewals 恒 0（续期即红）、过 expiresAt 而无 promote/retire/转长期裁决记录即红；转长期至多一次防续期漏洞。区别于容量预算式绝对数断言（≤10 会误背书当前水位为可接受）。_Avoid_: 绝对数上限当预算背书现状；静默续期；到期无裁决照跑。来源：Chromium unexpected_pass_finder、GitLab quarantine 三档+Cleanup System 自动删除 MR、Datadog 状态机、oneuptime 双闸（cap+deadline）。

## Resolvable Self-Witness（可解析的自证）
证据信任层级中间档：产出者与裁决对象同源（self-witness），但证据携带可解析锚点（绿 run URL），外部方可独立重放核验（gh run list），hosted runner 提供 SLSA L1-L2 级隔离。位于裸自证之上、密码学外部见证（Sigstore/provenance）之下；收口文档引用须如实标注层级。_Avoid_: 把 CI 自证说成外部见证；手动发布形态下把 CI 绿当发布事件见证（缺席见证——CI 不在现场）。来源：assay 信任阶梯、SLSA provenance 模型、npm provenance 强制 cloud-hosted runner。

## GO WITH CAVEATS（带病放行三态出口）
go/no-go 第三态：带病项逐条 minuted（owner+期限+关闭判据），关闭判定权显式委托、不必每次重开终审；区别于 GO（干净通过）与 NO-GO（差距清单+复评触发）。复评=事件驱动（可观测条件满足）+日历兜底防静默悬置。_Avoid_: 带病项无 owner/期限/判据的口头放行；no-go 后无复评机制=永久悬置。来源：bettersheepdog 30 年 PM 实践、Chromium ReleaseBlock、GO_NO_GO.md Conditional Go。

## Unpublish Window（unpublish 回滚窗）
npm 发布的不可逆边界：registry 数据不可变、版本名烧毁不可再注册；发布后 72h 内且无依赖者可 unpublish，超窗只能 deprecate。发布后净机验证须落在窗口内，回滚安全网才有效。_Avoid_: 把 publish 当可回滚默认对待；发布后验证排期超 72h。来源：npm unpublish 政策官方文档。

## Grill Round 64 — Terms (ADR-0065)

## Page-Family Assertion（页族断言层 / mustHitPaths）
live 评测的断言粒度中间层：对结果 pathname 做子串匹配（如 /basic/transports、/settings），容忍 provider 的 locale/version/dated 包装（/zh/、/10.x/、/specification/latest/）但保留页族精度。断言粒度锚定被测方能稳定兑现的承诺——产品承诺是「返回某站点的某页族」，不是字节级路径（provider URL 形态是实现细节）。与 mustHitHosts（宿主级）/mustHitUrls（字节级）构成三级粒度。_Avoid_: 断言粒度超出 provider 稳定承诺（字节级路径对外部站点）；页族断言退化为无断言/纯 host 级（页族回归从此不可见）。来源：contract testing「只断言被依赖承诺」、Pact like() matcher、primitive-bench 三级 ground truth。

## Negative-Pin（负例写死 / mustNotHitPaths）
片段匹配断言的强制配套：每个页族 pattern 必须显式写死不得命中的无关页面族，防子串过宽命中（如 settings 命中无关页）。_Avoid_: 只有正例无负例的片段断言（过宽命中静默通过）；负例靠 reviewer 记忆而非 schema 字段。来源：atomcode Q2 调研——mustHitPaths 匹配算子业界无直接先例，负例集是自行约束手段。

## Stability Class（stability_class 稳定性分级）
golden 条目对断言目标上游可控度的显式标注：controlled（自控页）|frozen-spec（冻结 spec/RFC 页）|external（第三方可变页）。字节级 mustHitUrls 只允许锚在 controlled/frozen-spec 类；external 类走 mustHitPaths 或 host 级。_Avoid_: 字节级断言锚在 external 类目标（漂移必然复发）；stability_class 缺失导致棘轮无法按 class 分账。来源：primitive-bench 三级 ground truth（verified-external/authoritative-registry/sentinel-planted）、Zalando @draft、Hermes frozen fixture。

## Failure Class（failure_class 失败归因字段）
隔离/迁移案例的失败机制标注（如 external-doc-superseded、locale-clustering-suppressed-cross-host）——归因字段驱动不同处置路径，并把「被测方正确工作」与「质量回归」分开记账。_Avoid_: 无归因的裸失败记录（分不清回归 vs 断言过时）；failure_class 与 LYING-class 混淆（前者是外部漂移致期望过期，后者是被测方声称支持却给错结果）。来源：Datadog Flaky Tests broken/flaky 分类驱动处置、primitive-bench classify_miss。

## Migration Provenance（migration 留痕块）
golden 条目上的结构化出处叙事块：原断言→新断言+provider 漂移证据+裁决日期。promote 物理删除隔离账本条目（entries.filter），故 promote 出口的留痕唯一合法载体是 golden 工件本体；retire 出口的留痕载体是账本内条目（Case Tombstone）。_Avoid_: 把 promote 留痕塞进隔离账本 reviews note（promote 后物理丢失）；把该块命名 tombstone（与 Case Tombstone ADR 语义撞车）。来源：DSpace provenance vs audit-trail 分离、protobuf reserved、GraphQL @deprecated(reason)。

## Quarantine Evidence Mode（隔离证据模式 / quarantined-but-runnable）
live runner 的 env flag 模式：隔离条目实际执行、逐条输出 EVIDENCE（id/结论/时间戳/run URL 四元组）、仅隔离失败时 exit 0 覆写、连续全红打 RETIRE_CANDIDATE 喂周检。promote 的前置条件「复跑转绿」靠它获得执行通道。_Avoid_: skip 式隔离（不执行=永远收集不到转绿信号=无法有证据地 reinstate——Tuist RFC 点名的死路）；第三份隔离判定副本（判定逻辑必须消费账本单一实现 activeIds()）。来源：Buildkite mute>skip、Tuist RFC 2026-03、Datadog quarantined-running、Trunk exit-override。

## Post-Promote Watch（post-promote watch）
flaky 类案例 promote 后的观察标记：golden 条目 watch:true；CI corroboration 翻转即经棘轮重入隔离（同 id∈baseline 合法），重入后回既有 TTL 裁决通道不新开裁决。兜住 5 跑证据的统计功效下限。_Avoid_: watch 重入绕过 TTL 裁决（变续期漏洞）；promote 后无观察标记（低功效证据无兜底）。来源：Tenki consecutivePasses 逆命题、Gaffer flip-rate 阈值实证、Datadog quarantine→disable 分档。

## Re-spec Legitimacy（改判合法性充要条件）
改判 golden expected 是 re-spec 而非作弊的充要条件：现实变化发生在被测方稳定承诺面**之外** ∧ 改判后案例仍断言一个真实产品行为。承诺面内的变化改期望=作弊（破坏 pass-rate delta 可比性）；observational-only 断言遇同类漂移应 retire 非改判。_Avoid_: 把 provider 当前形态重钉为期望（grandfathering）；期望跟随被测方承诺面内的回归（橡皮图章化）。来源：金集=校准物非 ground truth（tianpan.co）、qdrant corpus 变更后重生成 qrels 惯例、pytest xfail(reason) 理由必填传统。
