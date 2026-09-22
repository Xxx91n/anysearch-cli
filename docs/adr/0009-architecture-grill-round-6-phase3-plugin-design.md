# ADR-0009: Architecture Grill Round 6 — Phase 3 Anysearch Plugin Design

日期: 2026-08-19
状态: Accepted

## 背景 (Context)

Post-Round 5 (ADR-0008), MCP Phase 2 complete (5 tools, dual transport, 177 tests pass).
ADR-0005 三阶段路线 Phase 1 (CLI) done, Phase 2 (MCP server) done, Phase 3 (Anysearch
Plugin) next.

Phase 3 目标：构建 anysearch 独属的 context-mode 理念插件（MCP server + hooks + 沙箱子进程
+ FTS5 索引 + Think in Code），配置进各种 Agent（Codex/Claude/Cursor/OpenClaw）。

Grill round 6 covered Q8-Q13 (Q1-Q7 locked in prior rounds per handoff-round12).
atomcode research: 4 runs (Q8 hooks/FTS5 access, Q9 sandbox permissions, Q10 agent
memory architecture, Q11 distribution channels), ~95KB reports, 60+ sources all
official/first-party verified.

## 决策 (Decision)

### Decision 1: Hooks→FTS5 access — Direct SQLite WAL via long-running server (Q8=A)

hooks core handler 不直接碰 SQLite。写库收敛到长驻 MCP server 进程（类似
context-mode routing.mjs 不碰 DB，写库在 MCP server ContentStore 内）。

三层架构：
- hooks 子进程（短命，每次工具调用 spawn）：JSON 路由 + 蒸馏 + 调 server
- 长驻 MCP server 进程：FTS5 读写 + recall_memory 预检索
- SQLite WAL + busy_timeout + BEGIN IMMEDIATE + withRetry（防升级锁死）

项目级索引 vs Agent 内部记忆层是两个概念（Q10 详述），有调用联系但物理分离。

### Decision 2: Sandbox permissions — Thin hook + server full authority (Q9=A)

hook 子进程只做三件事：
1. 只读项目感知（读 .gitignore/AGENTS.md/CLAUDE.md，路径白名单 + 敏感路径黑名单）
2. 一条窄 IPC 通道调用长驻 MCP server（HTTP 127.0.0.1 + Bearer token，复用 Dual Transport）
3. 决策输出（deny/allow/modify/context JSON 回宿主）

不做：文件写、网络请求（除 server IPC）、子进程 spawn。所有重操作下沉到长驻 server。

防信息专精定位漂移：hook 权限通用化 = Agent 变成通用工具，丢失安全边界、预算经济学、
产品定位三条防线（atomcode Q9 交叉验证）。

### Decision 3: Agent memory architecture — Three-layer L0/L1/L2 (Q10=A)

Agent CLI 内部记忆系统是核心工程重心（独立于 MCP 也可工作）：

**L0 缓冲层**（packages/kernel/pi-runtime.ts）：
- `eventBuffer` + `agent.state.messages` 内存转录本
- 增量：会话内滚动摘要（N 轮/token 水位线触发，写入 resume_anchors）
- 增量：工具结果节流（大检索 JSON 不进 message 流，只进 FTS5 + 蒸馏摘要进上下文）

**L1 窗口管理层**（pi-runtime.ts transformContext 接缝）：
- 扩展 transformContext 为管道：[RAG注入] → [记忆注入(会话摘要+recall结果)] → [compaction修剪]
- shouldStopAfterTurn 挂 token 超阈值 → 触发压缩 → 落盘摘要 → 续跑

**L2 持久层**（packages/store，已实现）：
- 现有三表（messages/retrieval_results/resume_anchors）同库分表正确（同一生命周期同进程）
- Time Edge Effect 三层衰减（exp 半衰期 + bi-temporal + QDF + pinned）已实现，与
  Mem0 Decay（access-time 1.5×/0.3×）、Zep bi-temporal、Google QDF 三方验证一致
- 增量：FTS5 列权重（title/snippet 加权，engram #241 先例）
- 增量：access-time 信号（对齐 Mem0 1.5×/0.3×，每次 recall 命中刷新 last_accessed）
- 增量：entity 从 URL 升级为可配置（覆盖同实体多 URL 场景）

### Decision 4: MCP联动 — Physical dual-DB + two-stage recall pipeline (Q10 continued)

项目级索引 DB 和 Agent 内部记忆层 DB **物理分离**（独立 .db 文件）：
- 内部记忆层 DB：跟 anysearch session 走（现有 SqliteSessionStore）
- 项目级索引 DB：跟宿主项目走（类似 context-mode per-project DB）
- 写入路径彻底分离：内部 agent 对项目索引只读，项目索引对内部记忆层不可写

recall_memory = 两 stage 管道：
1. 先查 L1（会话摘要）+ L2（内部 FTS5，带 time_decay）
2. top-k 不足或为空时，再查外部项目索引
3. 合并时每条带 provenance: internal | project-index 标签，跨层不混合打分

五条接口铁律：
1. 只读消费模型（内部 agent 对项目索引只读，无 store_memory 工具）
2. 命名空间铁律（内部仓 session_id，项目索引 scope/project，缺省拒绝跨 scope）
3. 接口三件套（recall_memory MCP 工具 + 项目索引 CLI 子命令 + ans_chat agent loop 编排两层）
4. 去重与溯源（跨层 URL/content-hash 去重，provenance 标签，valid_until 只在内部仓）
5. 衰减边界（内部仓用 time_decay，项目索引不衰减或仅 access-boost）

外部宿主 hooks 通过 ans index 类工具写项目索引（context-mode ctx_index 模式）。
MCP 协议层不做 hooks 假设（hooks 是宿主侧功能，不在 MCP 协议内）。

### Decision 5: Distribution — Single npm package + configs/<platform>/ (Q11=A)

单 npm 包 + 每平台 configs/<platform>/ manifest 目录（context-mode 最佳实践，
wshobson/agents 38.9k stars 互证）。

- npm 包：一个二进制，平台间共享
- configs/claude/、configs/cursor/、configs/codex/、configs/antigravity/ 各自 manifest
- Claude 额外加 .claude-plugin/marketplace.json
- Codex 加 .codex-plugin/plugin.json
- Cursor 加 .cursor-plugin/plugin.json（或兼容 Agent Plugins v1.0 根 plugin.json）

内部开发阶段（不公开）用各平台原生本地目录加载：
- Claude Code: claude --plugin-dir ./apps/plugin/configs/claude
- Cursor: ~/.cursor/plugins/local <!-- machine-local: 用户级 ~ 路径引用（存量合规化） @ 2026-09-22 -->
- Codex: codex plugin marketplace add ./local-marketplace-root
- npm link 仅在验证 npm 渠道时才用

### Decision 6: Hook error handling — Fail-open + skills/AGENTS.md guidance (Q12=A)

hooks 挂了/MCP server 没响应/FTS5 写失败时：
- 放行工具调用，原始结果直出不蒸馏不索引
- stderr 告警，下文可用 ans doctor 诊断
- 用户不会因插件故障失去基本检索能力

后期心智模型：hooks 层索引使用引导（何时 recall_memory、何时跳过冗余搜索、蒸馏结果
如何引导 Agent 决策）放 skills/AGENTS.md 层，让 LLM 自己按规则决策，不硬编码在 hook
逻辑里。与 Active Domain 的 Prompt Skill Selection + Skill Active List 心智模型衔接。

### Decision 7: Build tool — esbuild multi-bundle for hooks (Q13=C)

hooks 层用 esbuild 多 bundle，拆成独立功能单元各最小化单次 hook spawn 加载量：
- core bundle：平台无关 handler（蒸馏逻辑 + 路由决策）
- adapter bundles：per-platform adapter（claude/codex/cursor/antigravity 各一个）
- distill bundle：PostToolUse 蒸馏逻辑
- preheat bundle：PreToolUse recall_memory 预检索逻辑

server 和 CLI 用 tsup（现有技术栈）。

前期架构选最优解，不为早期省事牺牲远期。context-mode 拆 5 个 bundle 是因为它支持
17 个平台，我们前期 4 个平台但架构预留扩展空间。

## 备选方案 (Alternatives Considered)

1. Q8=B (MCP HTTP callback) — rejected: worker 生命周期/端口/健康检查工程复杂度高
2. Q8=C (spawn CLI subcommand) — rejected: 热路径冷启动延迟不可接受
3. Q9=B (limited write) — rejected: 增大攻击面，偏离瘦 hook 原则
4. Q9=C (full trust) — rejected: 丢失信息专精定位三条防线
5. Q10=B (same DB split tables) — rejected: 两层生命周期/安全/schema 演进耦合
6. Q10=C (same DB attach schema) — rejected: SQLite attach 已知坑
7. Q10 聚合单查询 — rejected: 语义串味、打分体系冲突、衰减策略互相污染
8. Q11=B (per-platform packages) — rejected: 维护成本高
9. Q12=B (fail-closed) — rejected: 用户被插件故障拖累到连基础检索都没
10. Q12=C (scenario-based) — rejected: 增加复杂度，MVP 不需要
11. Q13=A (unified tsup) — rejected: 前期架构选型要最优解
12. Q13=B (hooks pure .mjs) — rejected: 失去类型安全

## 后果 (Consequences)

正面:
- 瘦 hook + 长驻 server = 最小延迟 + 最大安全（context-mode 验证过）
- 物理分离双库 = Agent 内部记忆独立性 + 项目索引可 purge
- L0/L1/L2 三层 = Agent CLI 独立可用 + 记忆系统可独立演进
- 两 stage recall 管道 = 语义清晰 + provenance 溯源 + 衰减策略分层不污染
- esbuild 多 bundle = 最优 hook 启动延迟 + 类型安全
- fail-open + skills 引导 = 用户不被插件故障拖累 + LLM 行为引导在 skills 层
- 单 npm 包 + configs/<platform>/ = 单一分发载体 + 每平台 manifest 互操作

负面:
- esbuild + tsup 双构建工具链（mitigated: hooks 和 server 职责不同，各自最优）
- 项目级索引 DB 需独立 schema 设计（mitigated: 复用 store 层 FTS5 模式）
- L0/L1 增量需改 pi-runtime.ts（mitigated: transformContext 接缝已存在）
- access-time 信号需 schema 加列（mitigated: ALTER TABLE 幂等安全）
- 4 atomcode research runs cost ~35 min (mitigated: all indexed in FTS5)

关联: ADR-0005 (三阶段路线), ADR-0008 (MCP Phase 2 5 tools), ADR-0007 (PiAgentRuntime).
*End of ADR-0009*
