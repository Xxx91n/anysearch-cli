# ADR-0056: Architecture Grill Round 56 — Session ID Propagation Protocol

Status: Accepted.

## Context

Rounds 1 through 55 established a layered architecture: an observation layer (ADR-0052) with a local SQLite trace store, and an authorization policy layer (ADR-0055) with a single-source TOML policy and ConfigChange audit events. ADR-0055 D8 defined ConfigChangeEvent with trace_id/session_id fields, but the post-audit found that every call site (server/index.ts, hitl.ts) passed empty strings—the observation layer independently generated trace_id via randomUUID, and no session identifier was ever injected. The gap between the audit event schema and its actual data was the exact pattern that OPA #6905 exposed (v0.67.0 console decision log missing trace_id/span_id despite field definitions).

This round addresses that gap: define a cross-layer session/trace ID propagation contract that survives CLI process restarts, hook short-lived invocations, and MCP stateless servers—without introducing TTL as an independent decision point (the TTL concern is resolved as three supplementary clauses to ADR-0055 D6).

## Decisions

### D1 — Three-Layer ID Contract

| ID | Semantics (industry anchor) | Generator | Lifespan |
| --- | --- | --- | --- |
| session_id | Session grouping anchor (CloudTrail sessionContext / OTel gen_ai.conversation.id) | Hook: host stdin existing value; CLI: .anysearch-cli/session file (generate once, atomic write-back); MCP: stateless—absent, set to empty string | Cross-trace, multi-command (minutes to days) |
| trace_id | Single logical request distributed trace root (W3C 32-hex) | Entry process per invocation (hook call -> hook process; CLI command -> CLI process; MCP tool call -> MCP server); observation layer inherits external value when present, otherwise randomUUID | Single request / turn |
| event_id | Single audit event unique ID | Already randomUUID() inside emitConfigChangeAudit | Event-level |

MCP additionally carries a client_id (see D4), distinct from session_id.

### D2 — Cross-Layer Propagation (traceparent + x-anysearch-session-id)

1. Hook process (short-lived, entry):
   - Generates trace_id (W3C 32-hex).
   - Inherits session_id from host stdin.
   - Outbound HTTP carries: traceparent: 00---01 + x-anysearch-session-id: .
2. Plugin server (long-lived, localhost:33333):
   - Extract: parse traceparent / x-anysearch-session-id. Invalid headers MUST be discarded (W3C section 3.2.2); self-generate trace_id on parse failure.
   - Inject: emitConfigChangeAudit(..., { traceId, sessionId }).
3. CLI process (short-lived):
   - trace_id = generated per command.
   - session_id = read from .anysearch-cli/session file (primary source—see D3).
   - Pass both to emitConfigChangeAudit.
4. MCP server (long-lived, stateless):
   - trace_id = generated per request.
   - client_id = best-effort from _meta clientInfo (see D4).
   - session_id = absent (see D5).
5. Observation layer:
   - Signature extended to { traceId?, sessionId?, clientId?, ... }—externally supplied values are inherited; absent values fall back to randomUUID.

session_id MUST NOT use the tracestate header (32-key truncation risk). A custom x-anysearch-session-id header is used instead (local loopback only—never forwarded to upstream backends).

### D3 — session_id Persistence: .anysearch-cli/session File as Sole Primary Source

The .anysearch-cli/session file is the single source of truth for session_id. Mirrors systemd /etc/machine-id: generate once, atomic write-back, user-scoped base directory (~/.anysearch-cli/), not project-cwd—session identity spans projects.

The trace store stores session_id as a write-only derived reference (via recordOperation / emitConfigChangeAudit writes); it never reads session_id back for identity determination.

Supports ANS_SESSION_ID env override for ad-hoc / CI use; file remains primary source, env value is not written back.

### D4 — MCP client_id: Best-Effort from _meta clientInfo -> Railway Mapping Table

MCP's InitializeRequest.clientInfo carries client identity (name/version), not session. The clientInfo.name is mapped through the Railway PR #885 production registry to a stable client_id string:

| clientInfo.name | -> client_id |
|---|---|
| claude-ai | claude_code |
| codex-mcp-client | codex |
| continue-client | continue_dev |
| Cline | cline |
| Visual Studio Code(...) | vscode_copilot |
| windsurf | windsurf |
| unknown | mcp_unknown |

Extraction priority: _meta.io.modelcontextprotocol/clientInfo.name -> mapping table -> client_id -> audit event into observation layer. Unknown clients get mcp_unknown, no error raised.

Rationale: stuffing clientInfo into session_id would collapse all Claude Code sessions into a single claude-ai value—producing false correlation, worse than empty string. client_id correctly answers "which client triggered this audit event?" without pretending to be a session.

### D5 — MCP session_id Remains Absent

MCP's _meta reserved-key table contains no session identifier field. MCP issue #231 (custom session ID proposal) was closed with no follow-up. Claude Code field evidence (claude-code #41836): the clientInfo sent to HTTP MCP servers is always {"name":"claude-ai","version":"0.1.0"}—no per-instance differentiation.

MCP audit events carry session_id = empty string. This is a known tradeoff: MCP audit traceability is weaker than hook/CLI paths. Client attribution is still available via client_id (D4).

### D6 — Trace Store Schema Revision: 3 Columns + 2 Partial Indexes + user_version Migration

observability_traces gains three columns: injected_trace_id TEXT, session_id TEXT, client_id TEXT.

Three indexes:
- CREATE INDEX idx_obs_session ON observability_traces(session_id) WHERE session_id IS NOT NULL
- CREATE INDEX idx_obs_client ON observability_traces(client_id) WHERE client_id IS NOT NULL
- CREATE INDEX idx_obs_injected_trace ON observability_traces(injected_trace_id)

Partial indexes on session_id/client_id: NULL rows are excluded (MCP session_id is always NULL; the index stays nearly empty). Precedent: SQLite official partialindex.html parent_po example, identical structure.

Versioned migration via PRAGMA user_version:
- v0 (brand-new DB): create full v2 schema (with new columns + indexes), user_version = 2.
- v1 (existing DB): BEGIN; ALTER TABLE ADD COLUMN x 3; CREATE INDEX x 3; user_version = 2; COMMIT.
- Both paths MUST produce identical column-and-index sets. Precedent: repo migrateSwitchEventSchema.

OBSERVATION_SCHEMA_VERSION: 1 -> 2.

Industry precedent: Google ADK sqlite_span_exporter.py—explicit session_id / invocation_id columns + indexes + get_all_spans_for_session audit pattern—identical structure.

### D7 — TTL Resolution (supplementary clauses to ADR-0055 D6)

TTL is NOT an independent decision point this round. ADR-0055 D6 ("no TTL—event-driven re-read is inherently fresh") is supplemented with three sub-clauses:

(a) Server persists a materialized_at timestamp alongside each policy.json cache write.
(b) On server startup, if the policy server is unreachable, boot from disk cache + WARN. Policy remains in effect.
(c) Staleness risk is bounded to long server-outage windows. Self-healing occurs on the next server-reachable write-back event.

Rationale: Envoy xDS TTL semantics (remove on expiry) would be anti-pattern—policy is a persisted authorization surface, not a temporary override. OPA bundles are the correct model: persist + version-annotate + WARN, no TTL.

## Revised Decisions

| Original | Revision | Source |
| --- | --- | --- |
| ADR-0052 D2 (Semantic Pin) | Add three-layer ID definitions (session/trace/event_id); semantic anchor becomes four layers | D-002 |
| ADR-0052 D3 (Local Trace Store) | recordOperation signature changed to { traceId?, sessionId?, clientId?, ... }—inherit when present, fallback randomUUID otherwise | D-004 |
| ADR-0052 D3 | Explicit decision: observability_traces does NOT add a sessions table; attribution columns (session_id / client_id / injected_trace_id) are allowed WITHIN the existing table | D-007 R3 / D-010 |
| ADR-0055 D8 (ConfigChange Audit) | session_id injection paths: hook inherits from stdin, CLI reads from file, server extracts from HTTP header | D-004 |
| ADR-0055 D6 (no TTL) | Supplement with three sub-clauses: materialized_at timestamp, startup disk-cache fallback + WARN, staleness bound | D-004 / D-001 |

## Rejected

- **Cache TTL as independent decision point**: Covered by D7 supplementary clauses. Introducing TTL semantics on policy.json cache would import Envoy xDS remove-on-expiry semantics that are inappropriate for persisted authorization policy.
- **session_id via tracestate header**: W3C tracestate has a 32-key truncation risk for vendor entries. Including a custom identifier in tracestate would risk silent loss under multi-hop propagation. x-anysearch-session-id as a separate header (local loopback only) is simpler and safer.
- **Sessions table in trace store**: session_id is a file-based primary source; the trace store is a best-effort observation stream (OPA pattern: drop on buffer full, lost on crash). It MUST NOT serve as a session identity source. No sessions table is created.
- **Stuffing clientInfo into session_id**: Claude Code field evidence confirms clientInfo is static across all sessions—producing false correlation. client_id is a separate attribution dimension.

## Acceptance Criteria

1. **OPA #6905-style closure**: after emitConfigChangeAudit write, immediately SELECT trace_id, session_id, client_id to verify non-empty (where expected).
2. Golden case: hook stdin carries session_id -> outbound HTTP -> server extract -> store write -> SELECT returns identical value.
3. Hook session_id field compatibility verified across Claude/Codex/Cursor/Antigravity (integration test, NOT merely compile).
4. Trace store migration: v0 fresh-create and v1 upgrade both produce identical column-and-index sets.
5. pnpm -r check/test/build clean; ship-gate passes.

## Sources

- W3C TraceContext Level 2 (2025-04-23)
- Kubernetes audit types.go / KEP-6035 (audit-id to CRI)
- OPA decision log API / #6905 (missing trace_id/span_id)
- AWS CloudTrail sessionContext
- Envoy xDS node id + TTL / staleness semantics
- OPA bundles configuration (persist + version)
- MCP spec 2026-07-28 (SEP-2575 Final)
- SEP-2567 (Mcp-Session-Id removal)
- Claude Code #41836 (clientInfo field packet capture)
- Railway PR #885 (MCP client registry + mapping table)
- Google ADK sqlite_span_exporter.py
- SQLite docs: ALTER TABLE, partialindex, JSON1, lang_altertable
- systemd machine-id(5)
- OTel semantic conventions: gen_ai.conversation.id, session.id
- Git credential store / GCM credstores
- SSH agent SSH_AUTH_SOCK convention
- OTel SQLite exporter (pierretokns fork)
- SigNoz ClickHouse schema / Grafana Tempo Parquet schema
