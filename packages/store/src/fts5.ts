// ADR-0023 D2 (Q2=B): FTS5 Query Tokenization shared helper.
// Shared, package-local copy so any class with `db.prepare` can reuse; no better-sqlite3 type import.
// SANITIZE order is intentional: sanitize user words to alphanumeric + " " before tokenization (CWE-20).
// Tokenization = regex word split on [A-Za-z0-9] sequences; CJK chars fall to phrase OR branch.
// Multi-term = per-word `word*` joined by AND; the full phrase is kept as an OR branch;
// queries with >8 terms are truncated to the first 8 terms (0-context "phrase" for long queries is D2's "empty fallback").
// Heuristic balance chosen: prefix-match-with-truncate + phrase fallback gives ~90% intent capture per arXiv:2602.23368 evidence.
// ADR-0045 D2: MemoryFusion registry consumption (k_fusion.memory + arm weights).
import { FUSION_REGISTRY, registryWeight } from "@anysearch-cli/retriever";

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

// ADR-0102 D1: relaxed recall rung. A natural-language recall question ("latest NBA champion NBA Finals MVP")
// rarely has every term inside one stored row, so the strict AND rung above returns zero rows and evidence
// that IS in memory becomes unreachable. Callers run the strict rung first and, only when it under-fills
// the limit, append the relaxed rung: content words (function words dropped) OR-ed with prefix match,
// ranked by the same BM25 expression. Strict hits keep their order and priority.
const RELAX_STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "of", "in", "on", "at", "to", "for", "from", "by", "with", "about", "as",
  "is", "are", "was", "were", "be", "been", "being", "it", "its", "this", "that", "these", "those",
  "what", "which", "who", "whom", "whose", "when", "where", "why", "how", "do", "does", "did",
  "can", "could", "would", "should", "will", "i", "you", "we", "they", "he", "she", "me", "my", "our", "your", "their",
]);

// Content words of a query (sanitised like the strict rung, function words dropped, ≤ maxTerms).
export function relaxedTerms(query: string, maxTerms = 8): string[] {
  const words = query.replace(SANITIZE_RE, " ").trim().split(/\s+/).filter(Boolean).map((w) => w.toLowerCase());
  return [...new Set(words.filter((w) => !RELAX_STOPWORDS.has(w)))].slice(0, maxTerms);
}

// Returns null when relaxing cannot add a majority-covered row the strict rung missed
// (fewer than three content words: a strict majority of 1–2 terms is all of them).
export function fts5RelaxedQuery(query: string, maxTerms = 8): string | null {
  const content = relaxedTerms(query, maxTerms);
  if (content.length < 3) return null;
  return content.map((w) => w + "*").join(" OR ");
}

// ADR-0102 D1 coverage floor: a relaxed row is kept only if it covers a STRICT MAJORITY of the
// query's content words (prefix match on its indexed text). A row that shares just one entity word
// with the question ("cacheflush release timetable" vs "cacheflush interval") is not evidence —
// the golden unanswerable cases (un_*) require such near-miss distractors to stay out of the FTS arm.
export function coversMajority(terms: string[], text: string): boolean {
  if (terms.length === 0) return false;
  const toks = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  let matched = 0;
  for (const t of terms) if (toks.some((k) => k.startsWith(t))) matched++;
  return matched * 2 > terms.length;
}

// Append relaxed-rung rows after strict-rung rows, skipping duplicates, up to limit.
// key: row identity (default rowid; the project index returns its PK as `id`).
export function appendRelaxed<T>(strict: T[], relaxed: T[], limit: number, key: (h: T) => unknown = (h) => (h as { rowid?: unknown }).rowid): T[] {
  const out = strict.slice(0, limit);
  const seen = new Set(out.map(key));
  for (const h of relaxed) {
    if (out.length >= limit) break;
    const k = key(h);
    if (!seen.has(k)) { seen.add(k); out.push(h); }
  }
  return out;
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
  rrfRankFn: (lists: string[][], k: number, weights?: number[]) => string[],
  extraArms?: { label: string; ids: string[] }[], // ADR-0031 D4 entity + ADR-0033 D5/D8 labeled arms (provenance); each list weighted 0.5
): Promise<THit[]> {
  const lists: string[][] = [];
  for (const q of queries) {
    const safe = fts5EscapeQuery(q.trim());
    if (safe === '""') continue;
    // ADR-0030: mirror of stmts.searchAllResults: freshness_factor UDF must be registered (see registerFreshnessFactorFunction).
    // Params: (query_for_decay, fts_match_query, limit) — same string passed twice for both ? slots.
    const sql =
      "SELECT r.id as rowid, r.session_id as sessionId, r.title as role, r.snippet as content, " +
      "freshness_factor(bm25(retrieval_results_fts), r.created_at, r.last_accessed, r.access_count, r.title, r.url, ?, r.pinned) as rank " +
      "FROM retrieval_results_fts JOIN retrieval_results r ON r.id = retrieval_results_fts.rowid " +
      "WHERE retrieval_results_fts MATCH ? AND (r.valid_until IS NULL) AND (r.quarantine IS NULL) AND r.archived = 0 " +
      "ORDER BY rank LIMIT ?";
    let hits = store.dbQuery<THit>(sql, safe, safe, limit);
    // ADR-0102 D1: relaxed rung only when the strict rung under-fills (decay keyed on the same strict string).
    if (hits.length < limit) {
      const relaxed = fts5RelaxedQuery(q.trim());
      if (relaxed) {
        const terms = relaxedTerms(q.trim());
        const wide = store.dbQuery<THit & { role?: string; content?: string }>(sql, safe, relaxed, limit * 4)
          .filter((h) => coversMajority(terms, `${h.role ?? ""} ${h.content ?? ""}`));
        hits = appendRelaxed(hits, wide, limit);
      }
    }
    if (hits.length > 0) {
      // RRF input key must be a stable per-doc id — rowid identifies retrieval_results rows.
      lists.push(hits.map((h) => String(h.rowid)));
    }
  }
  const baseCount = lists.length;
  for (const arm of extraArms ?? []) { if (arm.ids.length > 0) lists.push(arm.ids); }
  if (lists.length === 0) return [];
  // ADR-0031 D4: entity arm weight 0.5 (weaker than FTS 1.0); conditional activation handled upstream (absent arm = no extra list).
  // ADR-0045 D2: MemoryFusion single decision point — registry weights + k_fusion.memory.
  // Unknown arm label => registryWeight throws (configuration error fails fast).
  const weights = lists.map((_, i) => (i >= baseCount ? registryWeight("memory", extraArms?.[i - baseCount]?.label ?? "") : FUSION_REGISTRY.weights.memory.fts));
  const fusedIds = rrfRankFn(lists, FUSION_REGISTRY.k_fusion.memory, weights);
  // SELECT ... WHERE r.id IN (<placeholders>) AND valid_until IS NULL preserves RRF order via CASE.
  const placeholders = fusedIds.map(() => "?").join(", ");
  const orderCases = fusedIds.map((id, i) => `WHEN ${id} THEN ${i}`).join(" ");
  const rows = store.dbQuery<THit>(
    `SELECT r.id as rowid, r.session_id as sessionId, r.title as role, r.snippet as content,
            CASE r.id ${orderCases} END as rrf_order
     FROM retrieval_results r
     WHERE r.id IN (${placeholders}) AND r.valid_until IS NULL AND r.quarantine IS NULL AND r.archived = 0
     ORDER BY rrf_order LIMIT ?`,
    ...fusedIds, limit,
  );
  // ADR-0037 D6 Phase-2: semantic-arm ids are synthetic negatives (-semantic_memories.id) and
  // never match retrieval_results; resolve them from semantic_memories and re-sort by RRF order.
  const negIds = fusedIds.filter((id) => id.startsWith("-"));
  if (negIds.length > 0) {
    const ph = negIds.map(() => "?").join(", ");
    const semRows = store.dbQuery<THit>(
      `SELECT (-id) as rowid, '' as sessionId, '(semantic)' as role, content as content
       FROM semantic_memories WHERE id IN (${ph}) AND valid_until IS NULL`,
      ...negIds.map((x) => Math.abs(Number(x))),
    );
    rows.push(...semRows);
    const rrfOrder = new Map(fusedIds.map((id, i) => [id, i]));
    rows.sort(
      (x, y) =>
        (rrfOrder.get(String((x as { rowid: number }).rowid)) ?? Number.MAX_SAFE_INTEGER) -
        (rrfOrder.get(String((y as { rowid: number }).rowid)) ?? Number.MAX_SAFE_INTEGER),
    );
    rows.length = Math.min(rows.length, limit);
  }
  // ADR-0033 D8: annotate arm provenance on each returned hit (weak-evidence flag source).
  const ftsIds = new Set<string>();
  for (let i = 0; i < baseCount; i++) for (const id of lists[i]!) ftsIds.add(id);
  const labelMap = new Map<string, string[]>();
  for (const arm of extraArms ?? []) { for (const id of arm.ids) { const arr = labelMap.get(id) ?? []; if (!arr.includes(arm.label)) arr.push(arm.label); labelMap.set(id, arr); } }
  for (const row of rows) {
    const id = String((row as { rowid: number }).rowid);
    const labels = labelMap.get(id) ?? [];
    (row as { arms?: string[] }).arms = ftsIds.has(id) ? ["fts", ...labels] : labels;
  }
  return rows;
}
