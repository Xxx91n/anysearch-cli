// #263 (D8/D9): summary provenance and the suspension a correction causes.
//
// Two problems this module solves, both named in the ticket:
//
// 1. A derived summary today records only its TEXT. Nothing says which
//    materials or knowledge rows it was built from, so a correction can only
//    guess which summaries went stale — and guessing by "same session" or
//    "shared wording" is exactly what the ticket forbids. `recordSummarySources`
//    writes the ids the summary really read, across sessions, so the reverse
//    question ("who depends on this material?") has a real answer.
//
// 2. When a correction replaces a fact, the summaries built on it must stop
//    being injected. Their text is never rewritten or deleted (provenance and
//    the old version stay readable); they only leave the current-conclusion
//    slot. `suspendSummariesForCorrection` runs INSIDE the correction's write
//    transaction, so there is no window where the new version is live and the
//    old summary is still injected as current fact.
//
// Not covered here: rebuilding a suspended summary from current sources (that
// is ticket 09/12) and backfilling sources for old summaries that never
// recorded any (10/12). A summary with no recorded dependency is left alone —
// "no record" is not "depends on everything".

import type Database from "better-sqlite3";

/** The two anchor types that carry a derived summary (see MemoryPipeline). */
export type SummaryAnchorType = "rolling_summary" | "l2_recall";

/**
 * Whether an anchor type carries a derived summary that records sources.
 *
 * Only these two do. Every other anchor type (query, fetch, sufficiency,
 * consolidation_state) is operational state, not a summary, and keeps the
 * cheap append/UPSERT path.
 */
export function isSummaryAnchorType(anchorType: string): anchorType is SummaryAnchorType {
  return anchorType === "rolling_summary" || anchorType === "l2_recall";
}

/**
 * Read the `sources` field of a summary payload into validated refs.
 *
 * Defensive on purpose: the payload is JSON produced by the caller, and a
 * malformed entry must not become an index-0 lookup that matches nothing.
 * Anything that is not `{kind: "material"|"knowledge", id: positive integer}`
 * is dropped; duplicates are collapsed.
 *
 * @param raw - Whatever the caller put in `payload.sources`.
 * @returns Valid, deduplicated refs; an empty array for absent/garbage input.
 */
export function parseSummarySourceRefs(raw: unknown): SummarySourceRef[] {
  if (!Array.isArray(raw)) return [];
  const out: SummarySourceRef[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const { kind, id } = item as { kind?: unknown; id?: unknown };
    if (kind !== "material" && kind !== "knowledge") continue;
    if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) continue;
    const key = kind + ":" + id;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind, id });
  }
  return out;
}

/**
 * Which row a summary read.
 *
 * `material` -> retrieval_results.id (one archived search result),
 * `knowledge` -> semantic_memories.id (one long-term knowledge row).
 * Both are versioned by the existing bi-temporal columns, so "the version the
 * summary used" is the row itself: a correction closes that row and points at
 * its successor.
 */
export interface SummarySourceRef {
  kind: "material" | "knowledge";
  id: number;
}

/** One resumed anchor that a set of source refs makes stale. */
export interface DependentSummary {
  sessionId: string;
  anchorId: number;
}

/**
 * Is this ref still a current fact?
 *
 * The rule matches the rest of the store: a material is current while
 * `superseded_by` is NULL, a knowledge row while `valid_until` is NULL.
 * Archiving is deliberately NOT checked — archiving is not a correction, and
 * treating it as one would suspend summaries the ticket says must keep
 * working. A row missing entirely reads as "not current": the thing the
 * summary used no longer exists, so the summary cannot be vouched for.
 */
export function isSourceCurrent(db: Database.Database, ref: SummarySourceRef): boolean {
  if (ref.kind === "material") {
    const row = db
      .prepare("SELECT superseded_by FROM retrieval_results WHERE id = ?")
      .get(ref.id) as { superseded_by: number | null } | undefined;
    return !!row && row.superseded_by === null;
  }
  const row = db
    .prepare("SELECT valid_until FROM semantic_memories WHERE id = ?")
    .get(ref.id) as { valid_until: string | null } | undefined;
  return !!row && row.valid_until === null;
}

/**
 * Attach the sources a summary was actually built from to its anchor.
 *
 * Callers run this INSIDE the transaction that inserts the anchor, so a summary
 * never exists without its dependency list. This function does not open a
 * transaction itself: nesting one inside `saveSummaryAnchor`'s would either be
 * a savepoint or an error, and the caller already owns the boundary.
 *
 * Idempotent: re-recording the same (anchor, kind, id) is ignored, so a retried
 * write does not multiply rows. Ids are validated here rather than trusted:
 * a non-positive or non-integer id is dropped instead of silently becoming an
 * index-0 lookup that would match nothing later.
 *
 * @param db - Store connection.
 * @param args.sessionId - Owning session (may differ from the source's session:
 *   cross-session recall is a real dependency, not a false positive).
 * @param args.anchorId - The resume_anchors row this summary lives in.
 * @param args.anchorType - Which summary kind, mirroring the anchor row.
 * @param args.sources - Ids the summary read; duplicates and bad ids are dropped.
 * @returns How many NEW dependency rows were written.
 */
export function recordSummarySources(
  db: Database.Database,
  args: {
    sessionId: string;
    anchorId: number;
    anchorType: SummaryAnchorType;
    sources: SummarySourceRef[];
  },
): number {
  const insert = db.prepare(
    "INSERT OR IGNORE INTO summary_sources (session_id, anchor_type, anchor_id, source_kind, source_id) VALUES (?, ?, ?, ?, ?)",
  );
  let written = 0;
  const seen = new Set<string>();
  for (const ref of args.sources ?? []) {
    if (!ref || typeof ref !== "object") continue;
    if (ref.kind !== "material" && ref.kind !== "knowledge") continue;
    if (!Number.isInteger(ref.id) || ref.id <= 0) continue;
    const key = ref.kind + ":" + ref.id;
    if (seen.has(key)) continue;
    seen.add(key);
    written += Number(insert.run(args.sessionId, args.anchorType, args.anchorId, ref.kind, ref.id).changes);
  }
  return written;
}

/**
 * Which summary anchors depend on any of these rows.
 *
 * The match is by identity, never by session or wording: only an anchor whose
 * `summary_sources` names one of the refs is returned. An anchor that read a
 * DIFFERENT material stays untouched, which is the "unrelated summaries must
 * not falsely go stale" half of the ticket.
 *
 * A ref list of `{kind:"knowledge", id:X}` matches summaries that recalled
 * knowledge row X; a material ref matches summaries that were built from that
 * material row. Both are exact ids.
 *
 * @returns Distinct (session, anchor) pairs, ordered by anchor id.
 */
export function findSummariesDependingOn(
  db: Database.Database,
  refs: SummarySourceRef[],
): DependentSummary[] {
  const valid = (refs ?? []).filter(
    (r) => r && Number.isInteger(r.id) && r.id > 0 && (r.kind === "material" || r.kind === "knowledge"),
  );
  if (valid.length === 0) return [];
  const materialIds = [...new Set(valid.filter((r) => r.kind === "material").map((r) => r.id))];
  const knowledgeIds = [...new Set(valid.filter((r) => r.kind === "knowledge").map((r) => r.id))];
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (materialIds.length > 0) {
    clauses.push("(source_kind = 'material' AND source_id IN (" + materialIds.map(() => "?").join(", ") + "))");
    params.push(...materialIds);
  }
  if (knowledgeIds.length > 0) {
    clauses.push("(source_kind = 'knowledge' AND source_id IN (" + knowledgeIds.map(() => "?").join(", ") + "))");
    params.push(...knowledgeIds);
  }
  const rows = db
    .prepare(
      "SELECT DISTINCT session_id AS sessionId, anchor_id AS anchorId FROM summary_sources " +
        "WHERE " + clauses.join(" OR ") + " ORDER BY anchor_id",
    )
    .all(...params) as DependentSummary[];
  return rows;
}

/**
 * Mark every given summary as suspended, naming what triggered it.
 *
 * One row per anchor (`UNIQUE (session_id, anchor_id)`): the FIRST correction
 * that touched the summary records why. A later correction on the same summary
 * does not rewrite the reason, so the audit trail keeps the original cause.
 *
 * The summary text is untouched. Nothing is deleted.
 *
 * @param trigger - What changed, for the audit trail.
 * @returns How many summaries this call newly suspended.
 */
export function suspendSummaries(
  db: Database.Database,
  summaries: DependentSummary[],
  trigger: { kind: "material" | "knowledge"; id: number; reason: string },
): { newlySuspended: DependentSummary[]; count: number } {
  const insert = db.prepare(
    "INSERT OR IGNORE INTO summary_suspensions (session_id, anchor_id, reason, trigger_kind, trigger_id) VALUES (?, ?, ?, ?, ?)",
  );
  const newlySuspended: DependentSummary[] = [];
  const seen = new Set<number>();
  for (const s of summaries ?? []) {
    if (!s || !Number.isInteger(s.anchorId) || s.anchorId <= 0) continue;
    if (seen.has(s.anchorId)) continue;
    seen.add(s.anchorId);
    // Only a row this call actually INSERTED counts. A summary suspended by an
    // earlier correction is already out of the injection slot, so reporting it
    // again would tell the caller work happened that did not.
    if (Number(insert.run(s.sessionId, s.anchorId, trigger.reason, trigger.kind, trigger.id).changes) > 0) {
      newlySuspended.push(s);
    }
  }
  return { newlySuspended, count: newlySuspended.length };
}

/**
 * One correction's effect on summaries: find the dependents, suspend them.
 *
 * Called INSIDE the correction's write transaction, after the old knowledge
 * row is closed and the retired materials are re-pointed. Doing it there is
 * the whole point — a correction committed before the suspension rows would
 * leave a window where the new version is current and the old summary is still
 * injected (the ticket's third acceptance item).
 *
 * @param refs - The rows this correction replaced: the closed knowledge row and
 *   the materials it retired.
 * @returns The summaries this correction NEWLY suspended (a summary an earlier
 *   correction already suspended is not reported a second time).
 */
export function suspendSummariesForCorrection(
  db: Database.Database,
  refs: SummarySourceRef[],
  trigger: { kind: "material" | "knowledge"; id: number; reason: string },
): { suspended: DependentSummary[]; count: number } {
  const dependents = findSummariesDependingOn(db, refs);
  const { newlySuspended, count } = suspendSummaries(db, dependents, trigger);
  return { suspended: newlySuspended, count };
}

/**
 * Summary anchors that are currently suspended in this session.
 *
 * Read on the injection path: an anchor id in this set must not be injected as
 * a current conclusion. The stored text stays readable for anyone investigating
 * the decision, which is why the check returns ids rather than rewriting the
 * anchor.
 *
 * @returns Suspended anchor ids (only rows whose `cleared_at` is NULL).
 */
export function suspendedSummaryAnchorIds(db: Database.Database, sessionId: string): Set<number> {
  const rows = db
    .prepare(
      "SELECT anchor_id AS anchorId FROM summary_suspensions WHERE session_id = ? AND cleared_at IS NULL",
    )
    .all(sessionId) as Array<{ anchorId: number }>;
  return new Set(rows.map((r) => r.anchorId));
}

/**
 * Resolve search-result URLs to the material rows that hold them.
 *
 * Why URLs are the bridge: the summary gap is distilled from the tool result
 * JSON the model saw, which carries `url`, not row ids. The archive is keyed by
 * the same URL, so the ids are recoverable exactly — no text matching, no
 * session guessing.
 *
 * A `knowledge://` URL (how a knowledge row is cited as evidence) resolves to a
 * `knowledge` ref instead of a material one.
 *
 * Two different rules on purpose, and they are not interchangeable:
 *
 * - A MATERIAL must still be CURRENT here (`valid_until IS NULL`). `valid_until`
 *   is set by the ordinary write-time replacement (`invalidateOldRecords`), so a
 *   closed row is a row whose URL already moved on. Recording it would claim the
 *   summary read a version it never saw, and a later correction to that dead row
 *   would suspend an unrelated summary.
 * - A KNOWLEDGE ref is recorded whenever the row EXISTS, closed or not. A tool
 *   result can cite `knowledge://semantic/<id>` and have that row corrected
 *   before the summary is written; dropping it here would leave the summary with
 *   no dependency at all, so `saveSummaryAnchor` would find nothing to check and
 *   store it as valid. Keeping it lets `isSourceCurrent` (run inside the write
 *   transaction) see the closed row and write the summary SUSPENDED.
 *
 * Several sessions may hold a row for one URL, and every current one is
 * returned: any of them could be the row the summary read, so a correction
 * retiring any of them makes the summary's version stale. Filtering by session
 * is deliberately NOT done — D9 counts a fact recalled from another session as a
 * real dependency, and the same-session rule is exactly what the ticket rejects.
 *
 * @returns Deduplicated refs, in the order the URLs were given.
 */
export function resolveSummarySourcesFromUrls(
  db: Database.Database,
  urls: Array<string | null | undefined>,
): SummarySourceRef[] {
  const out: SummarySourceRef[] = [];
  const seen = new Set<string>();
  const KNOWLEDGE_PREFIX = "knowledge://semantic/";
  // Every row the URL ever had, CLOSED ones included. The summary was generated
  // from a tool result that cited this URL; if a correction replaced that row
  // between generation and this write, the version the text actually states is
  // the CLOSED one. Resolving only the current row would drop exactly that
  // citation, `saveSummaryAnchor` would find nothing to check, and the summary
  // would be stored VALID even though its body came from the replaced version.
  //
  // Currency is NOT decided here: `isSourceCurrent` runs inside the write
  // transaction and turns a closed ref into a suspended summary. Unsigned
  // (archived = 0) rows are skipped — archiving is a retention decision, not a
  // version change.
  const materialStmt = db.prepare(
    "SELECT id FROM retrieval_results WHERE url = ? AND archived = 0 ORDER BY id",
  );
  // Existence only: same reason as above, currency is decided at write time.
  const knowledgeStmt = db.prepare(
    "SELECT id FROM semantic_memories WHERE id = ?",
  );
  for (const raw of urls ?? []) {
    if (typeof raw !== "string" || raw.length === 0) continue;
    if (raw.startsWith(KNOWLEDGE_PREFIX)) {
      const id = Number(raw.slice(KNOWLEDGE_PREFIX.length));
      if (!Number.isInteger(id) || id <= 0) continue;
      const row = knowledgeStmt.get(id) as { id: number } | undefined;
      if (!row) continue;
      const key = "knowledge:" + id;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ kind: "knowledge", id });
      continue;
    }
    for (const row of materialStmt.all(raw) as Array<{ id: number }>) {
      const key = "material:" + row.id;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ kind: "material", id: row.id });
    }
  }
  return out;
}
