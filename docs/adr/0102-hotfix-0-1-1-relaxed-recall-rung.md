# ADR-0102: Hotfix 0.1.1 — 召回放宽梯级（Relaxed Recall Rung）

## Status

Accepted (hotfix 0.1.1, 2026-10-15). Ledger: `.scratch/hotfix-0.1.1/decision-ledger.md` (D-001~D-002). Amends ADR-0023 D2 (FTS5 query tokenization) for the recall paths only; ADR-0009 D4 (two-stage recall) unchanged.

## Context

ADR-0023 D2 tokenizes a query into `(w1* AND w2* … AND wN*) OR "full phrase"`. That is precise for short keyword queries, but a host agent asks `recall_memory` in natural language. A host-in-loop run (Codex host, 2026-10-15) showed the effect:

- **Session 1** researched the 2026 NBA Finals. Its results reached both memory layers: 111 rows in `retrieval_results`, 85 rows in the project index.
- **Session 2** asked a follow-up in a new session: `recall_memory("latest NBA champion NBA Finals MVP")`.
- **Result:** 0 hits in both layers, because no single stored row contains all five terms. The same terms joined with OR hit 85/111.
- **Consequence:** the host re-searched from scratch, so the stored research was unreachable.

The defect is in the query builder, not in storage or ranking.

## Decision

### D1 严格优先、欠满放宽（strict rung first, relaxed rung on under-fill）

- **Strict rung:** unchanged — `fts5EscapeQuery`, i.e. ADR-0023 D2. Its hits keep their order and priority.
- **When to relax:** only when the strict rung returns fewer than `limit` rows.
- **Relaxed rung:** `fts5RelaxedQuery`.
  - Same sanitisation (CWE-20) and the same ≤8-term cap.
  - Function words are dropped.
  - The remaining content words are OR-ed with prefix match (`w*`).
  - Rows are ranked by the same BM25 expression; the internal layer also keeps `freshness_factor`, keyed on the strict string so decay behaviour is identical.
- **Merge:** relaxed rows are appended after the strict rows, de-duplicated by row identity (`appendRelaxed`), up to `limit`.
- **No relaxing:** when fewer than two content words remain, `fts5RelaxedQuery` returns `null`.
- **Applied to all three FTS recall paths:**
  - `SqliteSessionStore.searchMemory` (single query);
  - `searchMemoryMultiQuery` (per variant, before RRF);
  - `ProjectIndexStore.search` (project index, Stage 2).

### D2 版本

All packages move to 0.1.1, published through the normal `release.yml` path (pre-tag → tag → OIDC publish).

## Consequences

- A natural-language recall question now reaches stored evidence. Regression tests reproduce the 0-hit case first:
  - `packages/store/test/fts5-relaxed-recall.test.ts`
  - `apps/plugin/test/project-index-relaxed.test.ts`
- Queries with no content-word overlap still return nothing (negative test), so abstain behaviour is unchanged.
- Golden/eval runs whose strict rung already fills `limit` are unaffected by construction.
- Noted while fixing: `ProjectIndexStore`'s `SELECT p.rowid` returns the PK under its declared name `id`, not `rowid`, so `ProjectIndexHit.rowid` is undefined at runtime.
  - Dedupe in the project-index path therefore keys on `id`.
  - The SQL and the `/recall` JSON shape are left unchanged.
  - The type mismatch is recorded here, not fixed (no consumer reads it).
- Out of scope: semantic/vector recall arms, query rewrite (ADR-0023 D1) and fusion weights (ADR-0045).
