# ADR-0005: Architecture Grill Round 2 — Implementation Selections

日期: 2026-08-18
状态: Accepted

## 背景 (Context)

Step 3 kernel split (ADR-0004) completed with 3 packages + 22 tests. The handoff
document listed 5 priority next steps requiring implementation selection decisions.
This ADR records the 5 decisions from grill-with-docs round 2, each grounded by
atomcode research (4 serialized runs, 63+ cross-verified sources).

## 决策 (Decision)

### 1. SQLite Binding: better-sqlite3

atomcode research (17 sources, SQG benchmark + official docs + GitHub issues):
- better-sqlite3: synchronous, fastest (1.1-1.7x vs node:sqlite), FTS5 default compiled,
  WAL officially recommended, mature (8.1M weekly downloads), Node 24.11 compatible (>=12.1.0).
- node:sqlite: zero-dependency but experimental (Stability 1.1), API may change.
- @libsql/client: async, 10-20x slower, only worth for remote Turso scenarios.

Decision: better-sqlite3 + @types/better-sqlite3. Synchronous API matches existing
SessionStore interface. Budget ledger (decision 4) also uses this binding.

### 2. TOML Parser: smol-toml

atomcode research (17 sources, npm registry + jsDelivr + bundlephobia + GitHub):
- smol-toml 1.8.0 (2026-06): active maintenance, TOML 1.1.0 support (only one),
  first-party TypeScript types, 4.5KB gzip, 28M weekly downloads, zero dependencies.
- @iarna/toml: stagnant ~6 years, stopped at TOML 1.0.0-rc.1.
- @ltd/j-toml: no major release ~4 years, WeakMap side effects on write-back.

Decision: smol-toml. Deep-merge is not built into any TOML parser — domain-schema.ts
resolve() already implements cc-persona deep-merge semantics (settings recursive,
lists replace). TOML parser only parse to JS object, deep-merge handled by our code.

### 3. Provider Adapter Order: Three in Parallel (Tavily + Exa + AnySearch)

atomcode research (17 sources, official docs + AIMultiple benchmark + npm):
- Tavily: lowest adaptation cost (official @tavily/core SDK, 1000 credits/month free,
  no credit card required, answer + extract integrated).
- Exa: largest free tier ($20+$10/month ~2800+1400 searches), exa-js SDK 756K weekly DL.
- AnySearch: has MCP (search/extract/batch_search via 1mcp gateway), 20+ vertical domains.

Decision: implement all three in parallel. AnySearch connects to its public service
(MCP-exposed tools), internal details deferred. After feasibility verification,
handoff layer transfers to AnySearch team for internal integration.

Rationale from user: AnySearch has MCP (not a stub). Reference atomcode handoff doc
(4-engine architecture: Exa + Tavily + AnySearch + Patchright). Commercialization
targets an anysearch-dedicated agent with AnySearch internal channel as core provider.

### 4. Budget Enforcement: Mole reserve-then-settle ledger (SQLite schema)

atomcode research (12 searches, 12 deep reads, 5 angle classes):
- Mole: SQLite ledger with DB-schema non-negative constraint, reserve-then-settle,
  0% overshoot, --usd/--tokens mutually exclusive.
- AgentPatterns: max_steps + max_seconds + max_tool_calls + max_usd (runtime policy layer).
- paperfoot: no explicit budget, fanout convergence + providers_cancelled only.

Decision: Mole reserve-then-settle ledger in packages/store SQLite schema.
Budget (token-cap / usd-cap / time-limit) belongs to store layer (resource consumption),
kernel stays pure orchestration logic (fanout + RRF + sufficiency gate).
Commercialization: MCP server can call store ledger interface for per-usage billing.

Three dimensions do not conflict:
- Upper bound: budget enforcement (store layer, hard limit)
- Lower bound: sufficiency gate (retriever fanout layer, minimum quality)
- Latency: fanout convergence (kernel, enough-results-then-collect + grace window)

### 5. Distribution: Three-Phase Route (CLI -> MCP all-forms -> Anysearch Plugin)

atomcode research (12 deep reads, 5 protocol versions cross-verified):
- stdio transport is the only stable surface across all 5 MCP protocol versions
  (2024-11-05 -> 2025-03-26 -> 2025-06-18 -> 2025-11-25 -> 2026-07-28).
- context-mode (mksglu, 19.9k stars): MCP server + hooks + sandbox subprocess +
  SQLite+FTS5 + Think in Code + 17 platform plugins (.codex-plugin / .claude-plugin etc).
- Mole/Perplexity/context-mode share the same shape: CLI + MCP server same kernel.

Decision: three-phase distribution route.
1. CLI (ans): internal development, feasibility verification.
2. MCP server (ans mcp serve): wrap same kernel, support ALL MCP transport forms
   (stdio + Streamable HTTP + remote + local), maximum compatibility.
3. Anysearch Plugin: anysearch-dedicated context-mode (MCP server + hooks + sandbox
   + FTS5 + Think in Code + platform plugin packages), built-in anysearch CLI commands,
   configurable into various Agents (Codex/Claude/Cursor/OpenClaw).
   Same mental model as context-mode (mksglu) but anysearch-owned, commerciable.

## 备选方案 (Alternatives Considered)

1. SQLite: node:sqlite (rejected: experimental), libsql (rejected: async overhead for CLI).
2. TOML: @iarna/toml (rejected: stagnant), @ltd/j-toml (rejected: WeakMap side effects).
3. Provider order: Tavily-first-then-Exa (rejected by user: three parallel, AnySearch has MCP).
4. Budget: AgentPatterns runtime policy (rejected: mixes orchestration + resource management).
   Minimal viable four-item check (rejected: too small for long-term product planning).
5. Distribution: CLI-only-then-MCP-later (rejected: three-phase, MCP supports all forms).
   Simultaneous CLI+MCP launch (rejected: double workload before kernel stabilized).

## 后果 (Consequences)

正面:
- All 5 decisions grounded by atomcode research with 63+ cross-verified sources.
- Budget in store layer, sufficiency gate in retriever layer, kernel stays pure logic.
- Three-phase distribution aligned with ADR-0004 (apps/mcp already in 5-seam plan).
- MCP all-forms compatibility maximizes future Agent integration surface.

负面:
- better-sqlite3 requires native compilation (mitigated: prebuild for Node 24.11 fixed in 12.1.0+).
- smol-toml stringify changes float format (1.0 -> 1), may need format preservation for config write-back.
- Three provider adapters in parallel increases initial implementation scope.
- Mole ledger schema adds complexity to packages/store (mitigated: same SQLite layer).

关联: ADR-0001 (TS + pi skeleton), ADR-0002 (domain authority TOML), ADR-0003 (Code Mode),
ADR-0004 (kernel split seam architecture).
*End of ADR-0005*