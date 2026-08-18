# ADR-0006: Architecture Grill Round 3 — Seam Wiring

Date: 2026-08-18
Status: Accepted

## 背景 (Context)

Post-audit (Round 4), all 10 ultragoal targets completed (154 tests passing, build OK).
The improve-codebase-architecture skill identified 5 deepening candidates from friction
analysis. User reviewed HTML report and chose option E: implement candidates 1→4→2→3,
defer 5 (YAGNI).

This ADR records the 8 grill decisions from grill-with-docs round 3, each grounded by
atomcode research (1 billing research run, 9 sources, 5 angles cross-verified).

## 决策 (Decision)

### Candidate 1: Engine → RetrieverPort Seam Wiring

**Decision 1A:** `RetroaererdEngine implements RetrieverPort`.
- Port becomes the real contract boundary for MCP Phase 2.
- CLI composition root creates engine, passes as RetrieverPort to commands.

**Decision 1B:** Engine `search()` accepts `Query` (superset with budget + provider filter).
- Provider filtering lives in engine (orchestration), not scattered in CLI.
- Budget handling delegated to BudgetLedger (candidate 2).

**Decision 1C:** Providers injected via constructor `new RetroaererdEngine(providers)`.
- `registerProvider()` retained as internal convenience, not on port.
- Composition root one-liner: configure all sources at construction.

### Candidate 4: DomainConfigPort → DomainSchema Adapter

**Decision 4A:** Domain TOML loaded from conventional directory `domains/<name>.toml`.
- Convention over configuration; filename = domain name.
- `ANS_DOMAIN=research` auto-finds `domains/research.toml`.

**Decision 4B:** Only sources + hooks layers wired now; prompts/skills/rag deferred.
- Engine reads `sources.enabled` to filter providers.
- `hooks.toolWhitelist` passed to runtime `filterTools()`.
- Other 3 layers have no consumer yet (pi-agent-core pending).

**Decision 4C:** DomainConfigPort extended to full 5-layer interface (sources/prompts/skills/hooks/rag).
- Consumers read only what they need (current: sources + hooks).
- Future pi-agent-core integration = start reading existing fields, zero interface change.
- Reflects ADR-0002 cc-persona 6-section structure already locked.

### Candidate 2: BudgetLedger Wiring

atomcode research (9 sources, 5 angles: Official/Comparative/Criticism/Currency/Community):
- Perplexity Agent API: model tokens + per-call tools split, `usage.cost.total_cost` in response.
- MoleAPI: quota points + two-phase pre/post-consumption (reserve-then-settle industrial deployment).
- MCP protocol has NO cost/usage standard field (SEP-2007 dormant since 2026-06-24).
- NemoRouter/Vevee: reserve = atomic check+hold, settle = real cost replace estimate, refund diff.
- Multi-dimensional: each dimension reserves separately (coarse upper bound), settle per-dimension.

**Decision 2A:** BudgetLedger optional constructor param to RetroaererdEngine.
- No BudgetPort abstraction (one implementation = hypothetical seam, ponytail).
- No ledger = no budget enforcement (dev mode); with ledger = commercial billing.

**Decision 2B:** Dual-dimension schema: token dimension + per-call dimension.
- Current: only per-call reserve-settle implemented (provider fanout calls).
- Token dimension columns exist but empty (LLM integration pending).
- Schema: add `billable_calls` column to budget_ledger for per-call consumption.

**Decision 2C:** Per-call reserve = registered provider count × per-call cost.
- Atomic check+hold before fanout (MoleAPI/NemoRouter pattern).
- Settle: actual successful providers, refund failed ones.
- 0% overshoot guaranteed by non-negative constraint (ADR-0005 decision 4).

### Candidate 3: Composition Root Factory

**Decision 3A:** Pure function `createEngine(domain?): { engine, config }`.
- Reads domain config if provided, filters providers by `sources.enabled`.
- Returns engine (as RetrieverPort) + resolved domain config.
- No state, no singleton — CLI is short-lived process (one command → exit).
- MCP Phase 2 can add caching layer if needed.

## 备选方案 (Alternatives Considered)

1. Engine keeps SearchRequest (rejected: provider/budget filtering scattered to CLI).
2. registerProvider on RetrieverPort (rejected: config ≠ search behavior).
3. Domain TOML via explicit path (rejected: convention over configuration).
4. Five-layer full wiring now (rejected: 3 layers have no consumer, YAGNI).
5. BudgetPort interface (rejected: one implementation = hypothetical seam).
6. Post-call billing, no reserve (rejected: NemoRouter proves concurrent overshoot risk).
7. Composition class with singleton (rejected: CLI short-lived, no caching benefit).

## 后果 (Consequences)

**Positive:**
- RetrieverPort becomes usable seam — MCP Phase 2 imports interface, not concrete class.
- Budget billing path works end-to-end for per-call dimension.
- Domain switching via TOML files becomes real (not just env var).
- One factory function replaces duplicated wiring across search.ts + doctor.ts.
- Future LLM token billing = add reserve-settle calls, schema already has columns.

**Negative:**
- DomainConfigPort carries 3 unused fields until pi-agent-core integration.
- BudgetLedger token columns are empty until LLM北区 integration.
- Per-call "cost" is a placeholder constant until actual pricing per provider is defined.

**Neutral:**
- Candidate 5 (async wrapping sync SQLite) explicitly deferred as YAGNI.
  Documented here so future reviews don't re-suggest it without new evidence
  (e.g. remote store swap in MCP Phase 2 would be the trigger).
