# Grill Round 57 — Fixer 常驻任务书（Session ID Propagation Protocol 落地）

> 来源：docs/adr/0056-architecture-grill-round-56-session-id-propagation-protocol.md
> 账本：.scratch/grill-round-56/decision-ledger.md（D-001 ~ D-010）

## 身份
作为遵循工作流的开发 Agent。按本节逐条实现 ADR-0056 D1~D7，AC 全部通过。

## 前置
- 阅读 C:/Users/Administrator/AppData/Local/Temp/anysearch-cli-adr0055-audit-completed.md 恢复 ADR-0055 终态。
- 阅读 docs/adr/0056-*.md 了解全部决策与修订。
- 阅读 .scratch/grill-round-56/decision-ledger.md 了解每条决策的详细调研来源。

## 实现任务

### T1 — CLI session_id 持久化（覆盖 D-006）
- 在 kernel 或 CLI composition root 实现 session_id 文件读写。
- 路径：~/.anysearch-cli/session（用户级基目录，非 project-cwd）。
- 首次生成时原子写回（复用已有 atomicWriteFile 模式或新增最小实现）。
- 支持 ANS_SESSION_ID env override（不写回文件）。
- 验收：文件不存在时生成后非空；文件存在时读回原值；env override 覆盖文件值。

### T2 — CLI 注入 emitConfigChangeAudit（覆盖 D-003 CLI 路径）
- CLI 进程读 session_id 文件，与 trace_id（新生成的 W3C 32hex）一同传入 emitConfigChangeAudit。
- 验收：hitl.ts 写回 TOML 后 trigger 的 ConfigChange audit event 中 session_id/trace_id 非空。
- 与 ADR-0055 D5 原子写回 + round-trip verify 路径集成。

### T3 — Hook session_id 透传（覆盖 D-003 Hook 路径）
- Hook 出站 HTTP 请求追加 header：traceparent: 00---01 + x-anysearch-session-id: 。
- trace_id 在 hook 进程入口生成；session_id 从宿主 stdin 继承。
- 验收：Hook 适配器发起到 plugin server 的请求携带两 header；plugin server 解析后 trace_id/session_id 非空（非 MCP server——MCP 走 T6 独立路径）。

### T4 — Plugin server extract + inject（覆盖 D-003 Server 路径）
- parseAndValidateHeaders() 解析 traceparent / x-anysearch-session-id。
- 非法 header MUST discard（W3C section 3.2.2），trace_id 回退为 randomUUID。
- emitConfigChangeAudit(..., { traceId, sessionId }) 传入。
- 验收：server 端 ConfigChange audit event 的 trace_id/session_id 与 hook 入站值一致。

### T5 — MCP client_id 尽力提取（覆盖 D-008）
- 从 _meta.io.modelcontextprotocol/clientInfo.name 提取。
- 按 Railway PR #885 映射表转换为 client_id（codex / claude_code / cursor / continue_dev / cline / vscode_copilot / windsurf / mcp_unknown）。
- 未知客户端 -> mcp_unknown，不抛错。
- 验收：MCP server 处理的 audit event 中 client_id 非空（_meta 有 clientInfo 时）或 mcp_unknown（clientInfo 缺失时）。

### T6 — MCP session_id 保持置空（覆盖 D-009）
- MCP audit event 的 session_id 字段始终写入空串。
- 验收：MCP audit event 中 session_id 为空串且不影响 MCP 功能（fail-open）。

### T7 — Trace store schema 版本化迁移（覆盖 D-010）
- 在 observation.ts 中实现 PRAGMA user_version v0/v1 双路径迁移。
- v0（全新库）：CREATE TABLE 含 injected_trace_id / session_id / client_id 三列 + 3 个索引（session_id/client_id 为 partial WHERE ... IS NOT NULL）。
- v1（存量库）：BEGIN; ALTER TABLE ADD COLUMN x 3; CREATE INDEX x 3; user_version = 2; COMMIT。
- 复用已有 migrateSwitchEventSchema 先例。
- OBSERVATION_SCHEMA_VERSION 1 -> 2。
- 验收：fresh 与 migration 双路径产出列+索引集合一致；pnpm test 通过。

### T8 — OPA #6905 式验收防脱节（覆盖 D-005）
- emitConfigChangeAudit 写入后，逐字段 SELECT 验证非空（无注入场景为预期空串的字段跳过）。
- Golden case：hook stdin 带 session_id -> 出站 -> server extract -> store write -> SELECT 返回同值。
- 验收：集成测试覆盖该 golden case，非仅"编译通过"。

### T9 — ADR-0055 D6 补充条款（覆盖 D-001 TTL 并入）
- server 每次写入 policy.json 时存储 materialized_at 时间戳。
- 启动时 server 不可达：从磁盘缓存 load policy + stderr WARN（不阻塞启动）。
- 无独立 TTL 决策——事件驱动新鲜度不变。

## 不做的（显式范围外）
- 不建 sessions 表（D-007 R3 强制：归因列在现有 observability_traces 表内）
- session_id 不通过 tracestate header 传播（D-002 负向约束：32 键截断风险，改用 x-anysearch-session-id）
- deploy 到上游 backends 时不携带 x-anysearch-session-id（local loopback only）

## Suggested skills
- $improve-codebase-architecture
- $domain-modeling
- $code-review
- $ponytail:ponytail
- $but
