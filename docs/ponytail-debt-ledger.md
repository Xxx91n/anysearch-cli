# Ponytail Debt Ledger — anysearch-cli

Auto-generated from ponytail: comments across the repo.
Each entry: file:line | debt description | upgrade trigger

packages/kernel/src/engine.ts:97 | MVP uses Promise.allSettled without early-cancel. Full grace-window abort needs custom race. | Upgrade when latency matters
apps/cli/src/commands/skill.ts:2 | MVP stub. Skill install from SearchCLI pattern deferred. | Implement when pi-agent-core lands
apps/cli/src/commands/recommend.ts:2 | MVP stub. Domain recommendation engine deferred. | Implement when domain recommendation logic is designed
packages/retriever/src/providers/tavily.ts | AbortSignal not forwarded (SDK lacks support) | Add when @tavily/core exposes signal
packages/retriever/src/providers/tavily.ts | usage() returns undefined (per-call credits only) | Map credits when standalone usage API exists
packages/retriever/src/providers/exa.ts | usage() returns undefined (costDollars per-call only) | Map costDollars when standalone usage API exists
packages/kernel/src/pi-runtime.ts:124 | transformContext RAG injection is minimal (config.note only). Full RAG adapter wiring deferred. | Implement when rag adapter types are defined
packages/kernel/src/pi-runtime.ts:183 | BudgetLedgerPort has token/USD methods but pi-runtime still uses per-call dimension only. Reserve/settleTokens not yet wired. | Wire token dimension in pi-runtime when ADR-0007 D5 call-sites are implemented
packages/kernel/src/pi-runtime.ts:53 | filterAgentTools uses hooks.toolWhitelist only (skills.active not used as tool filter). Domain activation semantics may need refinement. | Revisit when multi-tool domains are designed
apps/cli/src/commands/llm.ts | LLM config persistence via env vars only (no config file write). | Add config file write when needed
apps/mcp/src/server.ts | TypeBox→zod: v1 SDK registerTool only accepts zod, not TypeBox JSON Schema. TypeBox deferred to v2 SDK upgrade (fromJsonSchema). | Switch to TypeBox when upgrading to @modelcontextprotocol/server v2
apps/mcp/src/server.ts | search_web/research_web createSession per call — high-frequency tools should reuse a cached session. | Cache session ID in buildServer closure when session churn matters
packages/kernel/src/composition.ts | Provider factories wrapped in try/catch to skip providers without API keys. May silently hide real construction errors. | Add debug logging when provider construction fails before API key missing is expected

| apps/plugin/src/hooks/adapters/cursor.ts | ROUTING_CARD + MDC_CONTENT duplicated in cursor.ts, antigravity.ts, session-start.ts — one source three outputs. | Extract to shared constants module when 4th platform added |
| apps/plugin/src/hooks/adapters/antigravity.ts | .mdc generated on every hook invocation (not just SessionStart) since Antigravity has no SessionStart event. | Remove when Antigravity adds SessionStart event support |
| apps/plugin/src/hooks/session-start.ts | .mdc write to user workspace .cursor/rules/ is a side effect. | Add .gitignore entry or opt-out config when user reports |

packages/kernel/src/memory-pipeline.ts:116 | LOW_WATERMARK_TOKENS = 128_000 hardcoded. For 1M-token models (deepseek-v4-fast) ~13% triggers (over-eager rolling summary); for gpt-4o-class (128k window) totalTokens accumulates monotonically so watermark fires on nearly every turn after warmup. Semantics right ("cheap small-model flush", ADR-0012 D2/D4), number hardcoded. per prior grill decision #6/7 (user: defer to real-traffic phase), not fixed pre-release. | Per-model default or totalTokens -> contextWindow-occupancy dynamically. Triggered when real traffic shows compression is mistimed (too early / too late).

| packages/kernel/src/* (TypeBox) | TypeBox schema registry relies on v2 fromJsonSchema bridge for kernel->MCP registration. Currently zero rewrite path pending MCP SDK v2 migration. | When MCP SDK v2 migration completes (ADR-0018 D1), swap to `fromJsonSchema(TypeBoxSchema)` registrations; until then zod raw shape remains in apps/mcp. |
| @modelcontextprotocol/server (built-in normalizeRawShapeSchema) | zod 4.0-4.1 fallback: SDK emits one-time `[mcp-sdk]` warn via its own capability detection; descriptions drop relative to 4.2+. No kernel-side guard needed — SDK is the single point of truth. | Resolved when v1 maintenance window closes (2027-01-01, ADR-0008 D5) and dual-era conformance matrix confirms 4.2+ only. Visited 2026-08-21 in R16-3 — SDK公允 message confirmed in source. |
| docs/ponytail-debt-ledger.md | No review-by column exists for time-boxed debts. ADR-0018 D6 requires it as the operation-side companion to ADR Review-by clauses. | Add review-by column to all unresolved time-boxed rows when MCP SDK v1 EOL (2027-01-01, ADR-0008 D5) approaches. |

## Resolved (no longer debt)
- #13 Temporal coupling between gate.evaluate() and pipeline.consolidate() — FIXED in ADR-0016. Pure function-ization: evaluate() returns GateEnvelope, applyTo() returns new array, consolidate() receives hasRetrievalEvidence parameter.
- #14 signalSearchTurn() passive-aggressive command — FIXED in ADR-0016. Deleted, replaced by hasRetrievalEvidence boolean parameter.
- DELETE-then-INSERT UPSERT anti-pattern in saveAnchor — FIXED in ADR-0016 audit. Migrated to atomic INSERT ... ON CONFLICT DO UPDATE with partial UNIQUE INDEX (SQLite 3.24.0+). atomcode research: 17 sources confirm DELETE-then-INSERT triggers DELETE triggers, cascades FK children, resets autoincrement.
- D9 Layer 1 pure function tests missing — FIXED in ADR-0016 audit. Added 15 zero-mock assertions for consolidateState: skip/reuse/compress decisions, REUSE cap, idempotency, input immutability.
- D4 sessionIdGenerator used randomUUID() instead of undefined (stateless) — FIXED in ADR-0008 audit. Now sessionIdGenerator: undefined, enableJsonResponse: true, keepAliveMs: 0 per ADR-0008 D4 spec.

- time_decay() registered but not called from searchAllResults SQL — FIXED in commit 7f46683 (ADR-0008 D2 audit). Now wired into ORDER BY + bi-temporal filter in session-store.ts.
- invalidateOldRecords() imported but not called in saveResults() — FIXED in commit 7f46683. Now called per-insert to close old valid records for same entity URL.
