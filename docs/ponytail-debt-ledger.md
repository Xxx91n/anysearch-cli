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
