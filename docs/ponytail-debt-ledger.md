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

## Resolved (no longer debt)
- D4 sessionIdGenerator used randomUUID() instead of undefined (stateless) — FIXED in ADR-0008 audit. Now sessionIdGenerator: undefined, enableJsonResponse: true, keepAliveMs: 0 per ADR-0008 D4 spec.

- time_decay() registered but not called from searchAllResults SQL — FIXED in commit 7f46683 (ADR-0008 D2 audit). Now wired into ORDER BY + bi-temporal filter in session-store.ts.
- invalidateOldRecords() imported but not called in saveResults() — FIXED in commit 7f46683. Now called per-insert to close old valid records for same entity URL.
