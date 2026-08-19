# ADR-0010: Architecture Grill Round 7 — Post-Phase-3 Evolution Design

日期: 2026-08-19
状态: Accepted

## 背景 (Context)

Post-Round 6 (ADR-0009), Phase 3 Anysearch Plugin complete (hooks + ProjectIndexStore +
L0/L1/L2 + two-stage recall, 217 tests pass, 7 decisions all Accepted and verified).

ADR-0009 D3-D6 已实现 L0/L1/L2 三层记忆骨架、Dual DB、Two-Stage Recall、Fail-Open、
esbuild 多 bundle，但存在已知 placeholder 和未落地的后期心智模型：

1. L1 transformContext Stage 2 记忆注入是 no-op（async store vs sync injection 不兼容）
2. L0 滚动摘要是 text slice 而非 LLM 压缩
3. hooks 层判断指南（何时 recall_memory、何时跳过冗余搜索、蒸馏引导）未落地
4. SessionStart hook 未实现（只有 PreToolUse preheat + PostToolUse distill）
5. ARD (Agentic Resource Discovery) 前瞻未记录

Grill round 7 covered Q14-Q16 (Q1-Q13 locked in prior rounds).
atomcode research: 3 runs (agent memory frameworks, hooks guidance distribution,
3-question deep dive on SessionStart/AGENTS.md boundary/ARD timing), ~78KB reports,
55+ sources all official/first-party verified.

## 决策 (Decision)

### Decision 1: L1 Memory Injection — Hot-Cold Hybrid (Q14=C)

L1 transformContext Stage 2 记忆注入采用热冷路径混合方案：

**热路径（transformContext async）**：
- 把 transformContext 改为 async，Stage 2 await session-store.search() 拿 L1 会话摘要召回
- 结果 prepend 到 systemPrompt，与当前轮 LLM 调用同步生效
- 速召回：只查 L1（内存内 resume_anchors 摘要），不碰 L2 FTS5

**冷路径（shouldStopAfterTurn async）**：
- 在 shouldStopAfterTurn 回调里异步注入 L2 FTS5 + 两 stage 管道深召回
- 不阻塞当前轮 LLM 调用，记忆到下一轮才生效
- 深召回：L2 internal FTS5（带 time_decay）-> Stage2 project-index fallback

行业对齐：Letta 同步滑动窗口压缩 + 异步 dreaming/sleep-time；Mem0 应用驱动同步注入 +
异步 Dream 后台整合；pi-on-demand-context 弃用 transformContext 改用 steer 持久注入。
行业共识"热路径注入同步、记忆形成/压缩异步"——C 方案精准对齐。

理由：A（纯 async transformContext）侵入性大（所有调用方改 async）；B（纯
shouldStopAfterTurn）记忆滞后一轮（用户体验降级）。C 把 L1 会话摘要放热路径（快、
内存内）、L2 FTS5+双库放冷路径（慢、异步），是 Letta 同步压缩+异步 dreaming 的同构映射。

### Decision 2: Hooks Guidance — Progressive Disclosure Three-Layer (Q15=D)

hooks 层判断指南采用渐进披露三层分工架构：

**SessionStart hook（轻量指针，~20 行 / 150-400 token 静态路由卡）**：
- 插件存在声明 + 5 个 ans_* 工具一句话用途
- 触发规则（何时 search_web vs research_web vs recall_memory，何时跳过冗余搜索）
- fail-open 降级说明（ans 不可用时不阻断，与 ADR-0009 D6 一致）
- 指向 SKILL.md 深挖入口的显式指针
- 不内联完整 guidance、不注入完整工具清单/命令参考/文档摘要
- 跨平台降级：hook 注入（Claude/Codex）-> rules 文件（Cursor 无 SessionStart）-> AGENTS.md 段

**独立 SKILL.md（apps/plugin/skills/anysearch/SKILL.md）**：
- description 列触发词（search_web/research_web/recall_memory/query_knowledge/ans_chat）
- 正文：决策树 + 反模式 + 强制规则（何时 recall_memory、何时跳过冗余 search、蒸馏引导）
- LLM 语义匹配自发现，命中才加载正文（~100 tokens 常驻）

**AGENTS.md 最小化（<200 行）**：
- 只放每会话事实（一行级）：工具白名单（ans_* 前缀）、fail-open 行为预期、命名空间约定
- 不放多步流程（诊断/重试/恢复步骤 -> SKILL.md）
- 强制语义（白名单、fail-open）= AGENTS.md 一行意图声明 + hook 代码强制实现
- AGENTS.md 是 context not enforced configuration（agents.md 规范确认无 wire format）

行业证据：context-mode（20k stars）= 常驻事实进 CLAUDE.md、判断进 SKILL.md、触发进
hooks 三件套。Anthropic 2026-06-18 steering 博客明确分层。Vercel 评测：8KB 常驻索引 ->
100% 通过率 vs skill 触发 79% vs 无文档 53%。arXiv:2605.10039：文件大小/位置在多重
检验校正后无差异，真正敌人是会话内衰减。Vercel issue #15554：6MB 注入 -> 会话崩溃。
Vercel eval：无显式触发指令时 56% skill 从未被调用。

### Decision 3: L0 Rolling Summary — LLM Compression Upgrade Path (Q15 extended)

L0 滚动摘要当前是 text slice（截断最老 N% 消息）。升级路径：

**Phase 1（当前）**：text slice placeholder（已实现）
**Phase 2（本次）**：LLM 压缩摘要，对齐 Letta sliding_window 模式
- 摘要最老 ~30% 消息、保留 ~70%，摘要上限 50000 字符
- 摘要模型独立（用项目现有 LLM 配置，可选 claude-haiku / gpt-mini / deepseek）
- self_compact 模式：系统提示词+工具定义带进摘要请求 -> 最大化 prompt 缓存命中
**Phase 3（后期心智模型）**：异步 dreaming/sleep-time 子代理（Letta 对齐）

理由：Letta self_compact_sliding_window 的前缀缓存优化是 2025-26 关键优化——摘要不再
"贵"因为它命中缓存。Mem0 Dream 后台整合做记忆形成（supersede/merge）。Zep 异步摄取
成本极高（>600k tokens/会话），社区版已弃用。我们选 Letta 路线。

### Decision 4: ARD Forward-Looking — Tracking ADR (Q16=B)

ARD (Agentic Resource Discovery) v0.9 不承诺不重构，写追踪型 ADR：

**ADR 记录四件事**：
1. 事实基线（2026-08：ARD v0.9 Draft/Proposal，IANA media type 未注册，采纳约等于0，
   两个参考实现 GitHub Agent Finder + HF Discover）
2. 季度复查哨（Synscribe 式普查法：扫描主要 Agent 平台域名是否有 .well-known/ai-catalog.json）
3. 可选低成本动作（发布插件时挂一个 ai-catalog.json，作为"选项"而非"承诺"）
4. 明确非目标（不按 ARD 重构分发格式、不引入 ARD 运行时依赖；
   打包格式归属 Agent Plugins 1.0.0 Published spec）

理由：ARD 是发现层（"sits entirely before invocation"），与 MCP 执行层正交。未来接入 =
在分发域名加一个 catalog entry，无需改插件架构。早承诺风险：v0.9 草案 + IANA 未注册 +
格式可变 + 零采纳 -> 结构性返工。Agent Plugins 1.0.0（Published）才是打包格式归属，
hooks 不是 portable v1 组件。

## 备选方案 (Alternatives Considered)

1. Q14=A (纯 async transformContext) — rejected: 侵入性大，所有调用方改 async
2. Q14=B (纯 shouldStopAfterTurn) — rejected: 记忆滞后一轮，用户体验降级
3. Q15=A (纯 SKILL.md) — rejected: 缺 AGENTS.md 常驻层（工具白名单/fail-open 语义需常驻）
4. Q15=B (SKILL.md + AGENTS.md 最小化) — rejected: 缺 SessionStart 轻量指针（skill 永不触发）
5. Q15=C (硬编码 hooks 逻辑) — rejected: context-mode platform-support.md 列 18 平台
   PreToolUse 等价物名称不一致，硬编码不可维护
6. Q16=A (立即按 ARD 重构) — rejected: v0.9 草案 + 零采纳 + 格式可变 -> 结构性返工
7. Q16=C (完全忽略 ARD) — rejected: 廉价期权（单个 catalog entry 约 1 小时）值得追踪

## 后果 (Consequences)

正面:
- 热冷路径混合 = 最贴近行业共识（热同步冷异步）+ Letta 同构映射
- 渐进披露三层 = 上下文经济最优（~100 tokens/skill 常驻 + ~400 token 路由卡 + 按需加载）
- L0 LLM 压缩 + 前缀缓存 = 摘要不再贵，与 Letta 2025-26 优化对齐
- ARD 追踪型 ADR = 低成本期权 + 不锁定 + 季度复查哨
- 三层分工清晰 = 每层职责单一、可独立演进

负面:
- async transformContext 需改 pi-runtime.ts 调用方（mitigated: 接缝已存在，改动局部）
- SessionStart hook 需新增 + 跨平台降级适配（mitigated: configs/ 已预留 4 平台目录）
- L0 LLM 压缩需引入摘要模型调用（mitigated: 复用现有 LLM 配置，前缀缓存降本）
- ARD 季度复查需人工/自动化跟踪（mitigated: Synscribe 普查法简单可重复）

关联: ADR-0005 (三阶段路线), ADR-0007 (PiAgentRuntime), ADR-0008 (MCP Phase 2),
ADR-0009 (Phase 3 Plugin Design D3-D6).
*End of ADR-0010*
