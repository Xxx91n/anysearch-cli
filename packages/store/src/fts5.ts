// ADR-0023 D2 (Q2=B): FTS5 Query Tokenization shared helper.
// Shared, package-local copy so any class with `db.prepare` can reuse; no better-sqlite3 type import.
// SANITIZE order is intentional: sanitize user words to alphanumeric + " " before tokenization (CWE-20).
// Tokenization = regex word split on [A-Za-z0-9] sequences; CJK chars fall to phrase OR branch.
// Multi-term = per-word `word*` joined by AND; the full phrase is kept as an OR branch;
// queries with >8 terms are truncated to the first 8 terms (0-context "phrase" for long queries is D2's "empty fallback").
// Heuristic balance chosen: prefix-match-with-truncate + phrase fallback gives ~90% intent capture per arXiv:2602.23368 evidence.
const SANITIZE_RE = /[^A-Za-z0-9]+/g;
const PHRASE_QUOTE_RE = /\"/g; // CWE-20 escape: double-quote doubling for FTS5

// MAX_TERMS: long queries are truncated to the first N terms — prevents FTS5 0-row misses from phrase-OR over-match.
export function fts5EscapeQuery(query: string, maxTerms = 8): string {
  const sanitized = query.replace(SANITIZE_RE, " ").trim();
  if (!sanitized) return '""';
  const words = sanitized.split(/\s+/).slice(0, maxTerms);
  const prefixClause = words.map((w) => w + "*").join(" AND ");
  const phrase = query.replace(PHRASE_QUOTE_RE, '""');
  return "(" + prefixClause + ') OR "' + phrase + '"';
}

// ADR-0023 D2 (Q2=B): multi-query + RRF (k=60) fusion for consumer queries.
// queries: 3 variants from S1 rewrite ([original, v1, v2]) — index 0 is always the raw user query (fail-open).
// Deduplication in rrfScores is list-local: two variants returning the same doc don't double-count when fused.
// Ponytail: in-memory RRF — SQL-UNION-approach adds prepared-stmt overhead for a 3-variant bounded case.
// Design note: contract uses a single dbQuery function (not a db field) because TS nominal-private fields on the
// implementing class (SqliteSessionStore.db, SqliteSessionStore.stmts) fail structural assignability checks.
export interface SearchableStoreLike {
  dbQuery<Row = unknown>(sql: string, ...params: unknown[]): Row[];
}

export async function searchMemoryMultiQuery<THit extends { rowid: number }>(
  store: SearchableStoreLike,
  queries: string[],
  limit: number,
  rrfRankFn: (lists: string[][], k?: number) => string[],
): Promise<THit[]> {
  const lists: string[][] = [];
  for (const q of queries) {
    const safe = fts5EscapeQuery(q.trim());
    if (safe === '""') continue;
    // ADR-0030: mirror of stmts.searchAllResults: freshness_factor UDF must be registered (see registerFreshnessFactorFunction).
    // Params: (query_for_decay, fts_match_query, limit) — same string passed twice for both ? slots.
    const hits = store.dbQuery<THit>(
      "SELECT r.id as rowid, r.session_id as sessionId, r.title as role, r.snippet as content, " +
      "freshness_factor(bm25(retrieval_results_fts), r.created_at, r.last_accessed, r.access_count, r.title, r.url, ?, r.pinned) as rank " +
      "FROM retrieval_results_fts JOIN retrieval_results r ON r.id = retrieval_results_fts.rowid " +
      "WHERE retrieval_results_fts MATCH ? AND (r.valid_until IS NULL) AND (r.quarantine IS NULL) " +
      "ORDER BY rank LIMIT ?",
      safe, safe, limit,
    );
    if (hits.length > 0) {
      // RRF input key must be a stable per-doc id — rowid identifies retrieval_results rows.
      lists.push(hits.map((h) => String(h.rowid)));
    }
  }
  if (lists.length === 0) return [];
  const fusedIds = rrfRankFn(lists, 60);
  // SELECT ... WHERE r.id IN (<placeholders>) AND valid_until IS NULL preserves RRF order via CASE.
  const placeholders = fusedIds.map(() => "?").join(", ");
  const orderCases = fusedIds.map((id, i) => `WHEN ${id} THEN ${i}`).join(" ");
  const rows = store.dbQuery<THit>(
    `SELECT r.id as rowid, r.session_id as sessionId, r.title as role, r.snippet as content,
            CASE r.id ${orderCases} END as rrf_order
     FROM retrieval_results r
     WHERE r.id IN (${placeholders}) AND r.valid_until IS NULL AND r.quarantine IS NULL
     ORDER BY rrf_order LIMIT ?`,
    ...fusedIds, limit,
  );
  return rows;
}
