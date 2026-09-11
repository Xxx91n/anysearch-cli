# Decision Ledger — Grill Round 56 (会话 ID 贯通协议 & 缓存 TTL 失效语义)

> 规则：每个被确认的实质性结论当场追加一条记录，ID 从 D-001 起递增。
> 状态：current / revised / stale / deferred。
> 冲突时标记原记录为 revised（保留原文），生成新 D-xxx 呈报。

---

## D-001 — 本轮 grill 主题聚焦：D8 会话 ID 贯通协议

**原问题**：ADR-0055 审计后 deferred 了 D8 事件 traceId/sessionId 字段补齐 vs policy.json 缓存 TTL/失效语义，先干哪个？

**原回答**：「确认」（选项 A）

**规范化需求**：本轮 grill 落「D8 会话 ID 贯通协议」——定义 CLI/hook/MCP/server 间 session_id/trace_id 的生成权责、流转机制、跨层透传契约。

**显式约束/负向需求**：
- TTL 主题不设独立决策点，以 ADR-0055 D6 三条补充子条款并入（persist 兜底 + materialized_at 标注 + 陈旧风险边界论证）。
- session_id 不使用 tracestate header（32 键截断风险），改用自定义 x-anysearch-session-id header（仅本地 loopback 透传）。
- 轮次严格遵循 ADR-0029「一轮一主题」；备选主题缓存 TTL 不进入本轮决策树。

**状态**：current

**调研来源**：atomcode 18 个权威来源核验（W3C TraceContext、K8s audit types.go/KEP-6035、OPA decision log/#6905、AWS CloudTrail、OTel context propagation、Envoy xDS/TTL、Kubebuilder、controller-runtime cache、OPA bundles/configuration、TECHSY session/trace 层级、middleware.io trace ID 辨析、AnySearch 三引擎交叉验证）。

---

## D-002 — 三层 ID 契约（谁生成、什么语义）

**原问题**：trace_id/session_id/event_id 的生成权责归属？

**原回答**：「确认」

**规范化需求**：

| ID | 语义（对标） | 谁生成 | 生命周期 |
| --- | --- | --- | --- |
| session_id | 会话分组锚点（CloudTrail sessionContext / OTel gen_ai.conversation.id） | Hook: 宿主 stdin 现成值；CLI: .anysearch-cli/session 文件（无则生成+原子写回持久化）；MCP: stateless，尝试从 MCP 客户端元数据/header 提取，缺失置空 | 跨多 trace、多命令（分钟级~天级） |
| trace_id | 单次逻辑请求的分布式追踪根（W3C 32hex） | 入口进程每次生成（hook 调用→hook 进程；CLI 命令→CLI 进程；MCP tool call→MCP server）；observation 层收到外部 trace_id 时继承，无则自生成 | 单次请求/turn |
| event_id | 单条审计事件唯一 ID | 已是 emitConfigChangeAudit 内 randomUUID() | 事件级 |

**显式约束/负向需求**：
- 不引入新的持久化文件（复用 .anysearch-cli 目录）。
- session_id 缺失时 hook/CLI/MCP 均 fail-open（空串），不阻塞核心功能。
- observation 层外部覆盖签名为可选（{ traceId?, sessionId? }），不破坏现有调用点。

**状态**：current

---

## D-003 — 注入层与流转机制（跨层透传）

**原问题**：ID 如何从 hook 进程传到 plugin server？

**原回答**：「确认」

**规范化需求**：

1. Hook 进程（短生命周期，入口）
   - 生成 trace_id（W3C 32hex）
   - 从 stdin 继承宿主 session_id
   - 出站 HTTP 带 traceparent: 00-<trace_id>-<span_id>-01 + x-anysearch-session-id: <session_id>
2. Plugin server（长生命周期，localhost:33333）
   - extract: 解析 traceparent/x-anysearch-session-id（非法则丢弃并自生成——按 W3C 规范 MUST）
   - inject: emitConfigChangeAudit(..., { traceId, sessionId })
3. CLI 进程（短生命周期）
   - trace_id = 每次命令生成
   - session_id = 读 .anysearch-cli/session 文件
   - emitConfigChangeAudit 传入
4. MCP server（长生命周期，stateless）
   - 每请求生成 trace_id
   - session_id 尽力从客户端提取，缺失置空
5. Observation 层
   - 签名改为可选覆盖：{ traceId?, sessionId?, ... }
   - 外部存在则继承，否则 randomUUID()

**显式约束/负向需求**：
- 不使用 tracestate header（32 键截断风险），改用自定义 x-anysearch-session-id header。
- 非法 header MUST 丢弃（W3C §3.2.2），不尝试部分解析。

**状态**：current

---

## D-004 — 需修订的旧决策（marked: revised）

**原问题**：调研结论与哪些已落定 ADR 冲突？

**原回答**：「确认」

**修订清单**：

| 原决策 | 修订内容 | 状态 |
| --- | --- | --- |
| ADR-0052 D2 (Semantic Pin) | 新增三层 ID 定义（session/trace/event_id），语义锚定变四层 | revised |
| ADR-0052 D3 (Local Trace Store) | recordOperation 签名改为 { traceId?, sessionId?, ... }——外部存在则继承，否则 fallback randomUUID | revised |
| ADR-0055 D8 (ConfigChange Audit) | 补齐 session_id 注入路径：hook 从 stdin 继、CLI 从文件续、server 从 HTTP header 解 | revised |
| ADR-0055 D6 (no TTL) | 补充三条子条款：(a) server 写入时存储 materialized_at 时间戳；(b) 启动时若 server 不可达，从磁盘缓存启动 + WARN；(c) 陈旧风险仅出现在长 server 挂掉期间，自愈靠下次 server 恢复后的写回事件 | revised |

**负向约束**：
- ADR-0055 D2 (只增不减 merge) 不修订——semantics intact。
- ADR-0052 D5 (三态分离) 不修订——trace/eval/experiment 边界 unchanged。

**状态**：current

---

## D-005 — OPA #6905 式验收防脱节

**原问题**：字段定义与实现脱节的风险如何防止？

**原回答**：「确认」

**规范化需求**：验收标准必须包含「写入 trace store 后立即 SELECT 验证字段非空」——参照 OPA #6905 教训（v0.67.0 console decision log 无 trace_id/span_id，字段与实现脱节）。

**显式约束/负向需求**：
- 验收测试非仅「编译通过」，须对 emitConfigChangeAudit → observation write → SELECT trace_id, session_id 做读写闭环。
- Golden case：hook stdin 带 session_id → 出站 → server extract → store write → SELECT 返回同值。

**状态**：current

---

## 开放问题（待 grill 下探）

1. session_id 持久化文件的命名和路径（.anysearch-cli/session vs 复用 trace store 的 sessions 表？）
2. MCP client session 元数据来源——MCP spec 是否有标准 header/协议字段可提取？
3. OPA #6905 修复版本未确认——影响「OPA 作为完全落地范本」的引用强度。
4. Hook 适配器的 session_id 字段跨宿主（Claude/Codex/Cursor/Antigravity）兼容性验证——需集成测试覆盖。

---

## D-006 — session_id 持久化：独立文件 .anysearch-cli/session 为唯一主源

**原问题**：CLI 进程的 session_id 如何持久化？独立文件 .anysearch-cli/session vs 复用 trace store SQLite sessions 表？

**原回答**：「确认」（选项 A）

**规范化需求**：
- .anysearch-cli/session 文件是 session_id 的**唯一主源**。首次生成后原子写回（复用现有 atomicWriteFile 模式），后续启动读文件即可。
- trace store 侧 session_id 是 write-only 派生引用（通过 recordOperation/emitConfigChangeAudit 写入），**绝不回读做身份判定**。
- OTel 映射层维持 session.id 属性输出（宽锚点、Opt-In），gen_ai.conversation.id 留给未来 ans chat 线程级。
- 支持 ANS_SESSION_ID env override 覆盖文件值（CI/调试用），文件仍为主源，env 不写回。

**显式约束/负向需求**：
- 不引入新目录，仅 .anysearch-cli/session 一个新增文件。
- observability_traces 不新增 session_id 列、不建 sessions 表——attribute 承载不变，免 schema migration。
- 文件作用域为用户级基目录（~/.anysearch-cli/），非 project-cwd 级——session 跨项目复用。
- CLI 冷启动 O(1)：约 10us readFileSync，不依赖观测层链路。

**状态**：current

**调研来源**：atomcode 17 个权威来源核验（systemd machine-id(5)、K8s Lease/leader election、OPA decision log/#6905、Envoy xDS Node.id、Git credential store、OTel gen_ai conversation.id & session.id semconv、TraceVerde #219、SSH_AUTH_SOCK 约定、GCM credstores）。

---

## D-007 — D-002 / D-004 修订落地（Q2 确认的 R1~R5）

**原问题**：Q2 调研结论与哪些已落定决策冲突？

**原回答**：「确认」

**修订清单**：

| # | 原决策 | 修订内容 | 状态 |
| --- | --- | --- | --- |
| R1 | D-002 session_id 行 | 新增：文件是唯一主源，trace store 侧 write-only 派生引用；pin 作用域（user-scope 基目录 + ANS_SESSION_ID env override） | current |
| R2 | D-002 负向约束 |"不引入新的持久化文件"澄清为"不引入**新目录**"，.anysearch-cli/session 是本轮唯一新增文件 | current |
| R3 | ADR-0052 D3 (Local Trace Store) | **新增显式决策**：observability_traces 不新增 session_id 列、不建 sessions 表，attribute 承载不变 | current |
| R4 | ADR-0055 D8 (ConfigChange Audit) | CLI 路径细化：读文件（主源）→注入 emitConfigChangeAudit | current |
| R5 | ADR-0052 D2 (Semantic Pin) | session_id 对标 OTel session.id（宽锚点、Opt-In），gen_ai.conversation.id 留给未来 ans chat 线程级 | current |

**负向不修订**：
- ADR-0055 D2（merge 语义）、ADR-0052 D5（三态分离）、D-001 的不用 tracestate 维持不变。
- TTL 维持并入 ADR-0055 D6 子条款——文件主源天然满足 persist 兜底。

**状态**：current

---

## D-008 — MCP client_id 尽力提取（_meta clientInfo → Railway 映射表）

**原问题**：MCP server 能否从协议中提取会话/客户端标识？

**原回答**：「确认」（选项 C，落地为 client_id 尽力提取 + session_id 保持置空）

**规范化需求**：
- MCP 协议的 InitializeRequest.clientInfo 承载的是客户端**身份**（identity——name/version），不是会话（session）。不可塞入 session_id。
- 将 clientInfo.name 通过 Railway PR #885 生产级映射表转为稳定的 client_id 字符串（codex / claude_code / cursor / continue_dev / cline / vscode_copilot / windsurf / mcp_unknown）。
- 提取优先级：_meta.io.modelcontextprotocol/clientInfo.name → 映射表 → client_id → 审计事件入 observation 层。
- 未知客户端（映射表未命中）→ mcp_unknown，不抛错。

**显式约束/负向需求**：
- 不塞 clientInfo 进 session_id——Claude Code 所有会话会坍缩成同一个 claude-ai 值，制造假关联。
- MCP 2026-07-28 spec（SEP-2575 Final）已移除 Mcp-Session-Id header 及协议级 session 概念，本方案与此同向。
- anysearch-cli 的 apps/mcp/src/index.ts 已实现 sessionIdGenerator: undefined, keepAliveMs: 0 + buildServer() 每请求新建实例——无需架构返工。

**状态**：current

**调研来源**：atomcode 10 个权威来源核验（MCP spec 2026-07-28、SEP-2575/2567 全文、Claude Code #41836 一手服务端抓包证据、Railway PR #885 客户端注册表+映射表、OTel MCP semconv 原始定义）。

---

## D-009 — MCP session_id 保持置空（协议无此字段，生态无此实践）

**原问题**：MCP server 的 session_id 能否从协议提取？

**原回答**：「确认」（session_id 置空）

**规范化需求**：
- MCP 协议的 _meta 保留键表不含任何会话标识字段。MCP issue #231（自定义 session ID 提案）已 closed 无后续。
- Claude Code 生态实证：向 HTTP MCP server 发送的 clientInfo 恒为 {"name":"claude-ai","version":"0.1.0"}，无 per-instance 区分。[来源：claude-code #41836]
- MCP 审计事件 session_id 字段**置空**——这是已知 tradeoff：MCP 的审计可追踪性天然弱于 hook/CLI 路径。
- 对应的 ConfigChange audit event 仍通过 client_id 实现客户端归因（D-008）。

**显式约束/负向需求**：
- 不因置空而阻塞 MCP 功能——fail-open。
- partial index（D-010）自动过滤 NULL session_id，性能不受影响。

**状态**：current

---

## D-010 — trace store schema 修订：3 列 + 2 partial 索引 + user_version 迁移

**原问题**：recordOperation 签名改为 { traceId?, sessionId?, clientId? } 后，SQLite trace store schema 怎么改？

**原回答**：「确认」（选项 B 收敛版）

**规范化需求**：
1. **新增 3 列**（observability_traces 表内）：injected_trace_id TEXT、session_id TEXT、client_id TEXT
   - 无约束 ADD COLUMN = O(1)（SQLite 官方：10M rows ≈ 1 row）
2. **新增 3 个索引**：
   - session_id partial index：CREATE INDEX idx_obs_session ON observability_traces(session_id) WHERE session_id IS NOT NULL
   - client_id partial index：CREATE INDEX idx_obs_client ON observability_traces(client_id) WHERE client_id IS NOT NULL
   - injected_trace_id 普通索引：CREATE INDEX idx_obs_injected_trace ON observability_traces(injected_trace_id)
3. **首次引入 PRAGMA user_version 版本化迁移**：
   - v0（全新库）→直接建 v2 完整 schema（含新列+索引），user_version=2
   - v1（存量库）→BEGIN; ALTER TABLE ADD COLUMN × 3; CREATE INDEX × 3; user_version=2; COMMIT;
   - fresh 与 migration 双路径产出的列+索引集合必须一致（仓库已有 migrateSwitchEventSchema 先例）
4. **OBSERVATION_SCHEMA_VERSION 1 → 2**

**工业先例**：Google ADK sqlite_span_exporter.py——session_id / invocation_id 显式列 + 索引 + get_all_spans_for_session 审计模式，与本方案逐字同构。

**Partial index 理由（D-009 直接驱动）**：MCP session_id 大量 NULL。WHERE session_id IS NOT NULL 让 NULL 行不进索引——索引几乎空转。SQLite 官方 partialindex.html 的 parent_po 例子与本场景逐字同构。

**必须修订的旧决策**：
| # | 目标 | 修订 |
| --- | --- | --- |
| D-007 R3 | "observability_traces 不新增 session_id 列" | 修订为"不建 sessions **表**，允许在 observability_traces **表内**新增归因列（session_id / client_id / injected_trace_id）"——消除 Q4 选项 B 注释与 D-007 原文的内部矛盾 |

**负向不修订**：
- D-007 R3 的"不建 sessions 表"不变——仅将"不新增列"从禁止改为允许。
- ADR-0052 D5（三态分离）、ADR-0055 D2（merge 语义）维持不变。

**状态**：current

**调研来源**：atomcode 18 个来源核验（Google ADK sqlite_span_exporter.py 源代码、SQLite ALTER TABLE / expridx / partialindex / JSON1 官方文档、Jaeger ES schema、SigNoz ClickHouse schema、Tempo Parquet schema、OTel SQLite exporter pierretokns fork、UBOS/Coddy/社区 JSON 索引实测数据）。
