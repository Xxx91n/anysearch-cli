# ADR-0023: Architecture Grill Round 20 — Memory Retrieval Deepening (Query Rewrite + Transactional Adjudication)

## Status

Accepted. Amends nothing; extends the memory subsystem from ADR-0008 D3 (Research Memory layer), ADR-0012 (L0/L1 pipeline), ADR-0013 (reuse/compress adjudication), ADR-0020 (ship-gate evidence), and ADR-0021 (threshold injection). The old whole-query phrase escape convention (`fts5Escape`) is formally deprecated by D2.

## Context

anysearch-cli's memory layer (`packages/store`) already has: SQLite FTS5 dual tables (`messages_fts` + `retrieval_results_fts`, external content + trigger sync), time decay, bi-temporal `valid_until`/`pinned`/`entity` columns (G019), and `last_accessed` touch. This round's research confirmed three gaps:

1. `fts5Escape` wraps the entire query in a double-quote phrase literal, so FTS5 degrades to exact phrase match — tokenization, prefix, and OR expansion all disabled. The same defect exists in two copies: `packages/store/src/session-store.ts` and `apps/plugin/src/store/project-index-store.ts`.
2. No query rewriting: single-shot keyword queries depend on exact user wording, with no semantic variants.
3. No write-time adjudication: when a new snapshot for the same `entity` arrives, old records stay valid; the query layer may recall stale content (the STALE benchmark identifies this as the top memory-system failure mode).

Research anchors: arXiv:2602.23368 (Amazon Bedrock — agentic keyword search reaches 91.5% of vector RAG answer correctness, production proof that no-embeddings works); arXiv:2605.06527 (STALE — write-time adjudication 68% vs passive 8-17%); arXiv:2607.23929 (MemTX transactional belief-commit); arXiv:2607.26637 (filesystem memory — organization buys search economy, not answer quality); Aleph memory pipeline (FTS5 + RRF k=60 + AssemblyBudget); Graphiti/Mem0/Letta cross-vendor benchmarks.

## Decision

**D1 (memory archive form: SQLite single truth + Markdown read-only derived, Q1=C).** SQLite (FTS5 + derived index + adjudication layer) remains the single source of truth. A Markdown archive (e.g. `memory-review.md` export) exists only as a human-readable, reviewable, read-only derived snapshot - no state write-back. Keep shallow/flat + tags; the agent must not maintain a deep taxonomy (arXiv:2607.26637 negative result). `schema.sql` unchanged.

**D2 (recall-layer fix + query rewrite - FTS5 Query Tokenization + S1 LLM rewrite, Q2=B).** Fix `fts5Escape` (both copies in sync): tokenize (regex word split), per-word prefix match (`word*`) joined by `AND`; keep the full phrase as an `OR` branch; truncate long queries to the first N terms; retain double-quote doubling escape (CWE-20). S1 query rewrite: a single LLM call (~200 tokens) on the natural-language query produces 3 FTS5 queries (original + 2 semantic variants: paraphrase / term-swap / sub-question), reusing the existing `isTimeSensitive`/`isEvergreen` QDF tags; three parallel queries against `retrieval_results_fts` fused via RRF (k=60, Aleph parameter, reusing `packages/retriever/src/rrf.ts`) to top-20. Synonym/term expansion is NOT hardcoded in the FTS5 layer - owned by the LLM rewrite. S2 LLM re-ranking (top-20 to top-5 + AssemblyBudget gate) is rejected this round: marginal gain too low at current scale; revisit when real recall-failure samples emerge.

**D3 (T0 hot zone deferred, Q4=B).** The `MEMORY.md` always-injected hot zone (durable preference / standing instruction / correction conclusions, 1500 chars cap, aligned to the Anthropic attention budget) is deferred to a future round. Rationale: hot-zone writes must pass adjudication (D4) first, or contradicting standing instructions cannot converge; D4 must land before the hot zone is safe.

**D4 (write-path transactional adjudication - MemTX-simplified three checks, Q3=A).** New memory writes to `retrieval_results` execute Transactional Memory Adjudication (see CONTEXT.md): (1) evidence - writer confidence >= 0.6; direct user input / high-trust tools exempt (aligned to the MemTX authority >= 0.9 channel). (2) Temporal priority - new evidence newer than the same-entity old memory wins; the old record gets `valid_until = now` (reuses the existing bi-temporal column; non-physical delete = Zep non-lossy). (3) Equal-weight conflict - two peer sources contradict; no auto-overwrite; set `quarantine`, deferred to the next user interaction. Adjudication lives in the store-layer write path (single LLM call), not batch processing; `flag_user_correction`-type channels trigger adjudication immediately. Cascade invalidation (distilled summaries referencing old memories) is implemented as one-level propagation (downweight/flag), not the full MemTX DAG.

**D5 (acceptance - STALE-lite probe suite in-round, Q5=A).** `packages/store/test/` gains a STALE Probe Suite test file: three probes (SR = stale recognition / PR = passive recall / IPA = implicit preference application), each with core scenario cases asserting `valid_until` set on the superseded memory and its absence from subsequent `searchMemory` results. Existing `session-store.test.ts` remains the regression floor. We explicitly accept implicit-conflict at/below 55% as the model ceiling (STALE data); no vector DB will be added if probes dip below that line.

**D6 (rejected alternatives, frozen).** No vector DB / sqlite-vec (arXiv:2602.23368 proves 90%+ without embeddings). No S2 LLM re-ranking or AssemblyBudget this round (see D2). No T0 hot zone this round (see D3). No knowledge-graph extraction pipeline (Graphiti/Zep-grade cost unjustified on a small CLI; only the temporal-edge idea is borrowed). No agent-maintained deep directory organization (arXiv:2607.26637 erosion result).

## Consequences

Positive: recall bottleneck (phrase-mode degradation) eliminated; no-embedding agentic keyword SOTA path locked; write-time adjudication turns stale-memory failure from pray-at-retrieval into converge-at-write; zero new dependencies. Cost: `recall_memory` +1 LLM call (~200 tokens) per invocation; write path +1 LLM call only when same-entity conflict candidates exist. Both costs gated by capability/config flags. Backward compat: default config (no LLM key / adjudication off) degrades gracefully to fixed FTS5 + temporal supersede only (fail-open).

## Implementation Plan

1. `packages/store/src/session-store.ts` + `apps/plugin/src/store/project-index-store.ts`: rewrite `fts5Escape` as FTS5 Query Tokenization; add unit tests ("vectors" matches "vector database").
2. `searchMemory`/`searchFts5`: support multi-query input + RRF k=60 fusion.
3. S1 query rewrite: kernel layer adds `rewriteQuery(query, qdf)` pure function + LLM injection seam; fail-open returns original query when no LLM.
4. Write-path adjudication: store-layer `saveResults` gains adjudication step (three checks + supersede UPDATE + quarantine flag).
5. STALE-lite probe test file + existing suite regression.
6. Verify: `pnpm -w build`, `pnpm -w test` all green, `node scripts/ship-gate.mjs` all pass, CLI process alive.

## Acceptance

- [ ] `fts5Escape` both copies replaced with tokenize implementation; CWE-20 escape retained; unit test present.
- [ ] Multi-query RRF fusion path has test (k=60).
- [ ] S1 rewrite fail-open (no LLM returns original query) has test.
- [ ] supersede write path: old memory `valid_until` set, excluded from subsequent `searchMemory`, tested.
- [ ] quarantine path has test.
- [ ] STALE-lite three probes file exists, all green.
- [ ] build / test / ship-gate / process-alive all green.

## Research Sources

Atomcode run this round produced a 26-search, 5-angle Sufficiency-Gate-pass report. Sources read: arXiv:2602.23368 (Keyword search is all you need, Amazon Bedrock, 2025-12); arXiv:2605.06527 (STALE, 2026-05); arXiv:2607.23929 (MemTX, 2026-07); arXiv:2607.26637 (Filesystem-Based Memory for LLM Agents, 2026-07); arXiv:2501.13956 (Zep/Graphiti dual temporal, 2025-01); NeurIPS 2025 A-Mem; Mem0 State of AI Agent Memory 2026 + 4-way benchmark (vendor self-reported, noted); Letta context hierarchy docs; Aleph memory architecture docs; Supermemory SMFS docs; Claude Code memory docs; LangChain context-engineering blog (Windsurf citation); LangChain Tavily docs. Tavily engine rate-limited during verification; cross-verification fell back to Exa + AnySearch + direct official doc fetch.
