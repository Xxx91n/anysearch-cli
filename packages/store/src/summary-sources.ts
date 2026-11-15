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
 * The rule matches the rest of the store: a material is current while BOTH
 * `superseded_by` and `valid_until` are NULL, a knowledge row while `valid_until`
 * is NULL.
 *
 * Why the material checks `valid_until` too: there are two ways a material stops
 * being the current version. A correction sets `superseded_by` (a knowledge row
 * replaced its fact); an ordinary re-fetch of the same URL sets `valid_until` with
 * no successor. Checking only the first let a rebuild commit against a row the
 * planner had already rejected as stale, and then clear the suspension — a
 * rebuilt summary built on an invalidated source, marked current. The planner and
 * the commit have to use the same rule or they can disagree about the same row.
 *
 * Archiving is deliberately NOT checked — archiving is not a correction, and
 * treating it as one would suspend summaries the ticket says must keep
 * working. A row missing entirely reads as "not current": the thing the
 * summary used no longer exists, so the summary cannot be vouched for.
 */
export function isSourceCurrent(db: Database.Database, ref: SummarySourceRef): boolean {
  if (ref.kind === "material") {
    const row = db
      .prepare("SELECT superseded_by, valid_until FROM retrieval_results WHERE id = ?")
      .get(ref.id) as { superseded_by: number | null; valid_until: string | null } | undefined;
    return !!row && row.superseded_by === null && row.valid_until === null;
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

/** How many hops a supersede chain may take before the line is treated as dead. */
export const MAX_SUPERSEDE_CHAIN_HOPS = 64;

/**
 * One row of a knowledge line while walking it to its live head.
 *
 * `source_episode_ids` is included because consolidation's collision path needs
 * the live row's own material list right after the walk. Selecting it here costs
 * nothing (same row, same read) and saves that caller a second SELECT of the row
 * it just received.
 */
export interface SupersedeChainRow {
  id: number;
  content: string;
  source_episode_ids: string;
  valid_until: string | null;
  superseded_by: number | null;
}

/**
 * Walk a supersede chain to the version that is live now.
 *
 * Design: one walker shared by consolidation and the summary rebuild — a chain
 * longer than 64 hops, or one ending in a closed row with no successor, means
 * the line has no current version, and both callers must reach that verdict the
 * same way. A second copy of this loop is how the two would drift.
 *
 * @returns The live head, or null when the line has no current version.
 */
export function liveHeadOf(db: Database.Database, fromId: number): SupersedeChainRow | null {
  let id = fromId;
  for (let hop = 0; hop < MAX_SUPERSEDE_CHAIN_HOPS; hop++) {
    const row = db
      .prepare("SELECT id, content, source_episode_ids, valid_until, superseded_by FROM semantic_memories WHERE id = ?")
      .get(id) as SupersedeChainRow | undefined;
    if (!row) return null;
    if (row.valid_until === null) return row;
    if (typeof row.superseded_by !== "number" || !Number.isInteger(row.superseded_by)) return null;
    id = row.superseded_by;
  }
  return null;
}

/** One thing the summarizer read: the URL it saw, and the archive row when known. */
export interface SummaryRead {
  url: string;
  /**
   * The exact `retrieval_results` row this read came from, when the search path
   * recorded it. This is what makes the dependency exact: the same URL can hold
   * an older row (a correction retired it) and a newer one (a later fetch), and
   * only the row tells the two versions apart.
   */
  rowId?: number | null;
}

const KNOWLEDGE_PREFIX = "knowledge://semantic/";

/**
 * Rows the archive holds for one URL, preferring the CURRENT ones.
 *
 * Why the preference: a summary is written after the search that fed it, so a
 * URL with a live row at write time is a URL the summary read in its live
 * version. Returning the closed predecessors too would mark that summary as
 * built on a replaced version and suspend it — the false suspension the ticket
 * forbids — even though every fact in it came from the live row.
 *
 * Why the all-rows fallback when nothing is current: the citation can be to a
 * material that was retired BEFORE the summary was written (the S8 window). The
 * retired row is then the only row, and dropping it would leave the summary
 * with no dependency at all, so `saveSummaryAnchor` would store it VALID while
 * its body still states the replaced fact. Keeping it lets the write-time
 * check suspend it.
 *
 * `superseded_by` and `valid_until` are both treated as "this row moved on": the
 * first is a correction, the second the ordinary write-time replacement
 * (`invalidateOldRecords`) when a URL is fetched again. Archived rows are a
 * retention decision, not a version change, so they stay dependencies (see
 * isSourceCurrent).
 */
function urlMaterialRows(db: Database.Database, url: string): number[] {
  const current = db
    .prepare(
      "SELECT id FROM retrieval_results WHERE url = ? AND superseded_by IS NULL AND valid_until IS NULL ORDER BY id",
    )
    .all(url) as Array<{ id: number }>;
  if (current.length > 0) return current.map((r) => r.id);
  const any = db
    .prepare("SELECT id FROM retrieval_results WHERE url = ? ORDER BY id")
    .all(url) as Array<{ id: number }>;
  return any.map((r) => r.id);
}

/**
 * Resolve what the summarizer READ to the rows that back those reads.
 *
 * This is the exact form: the search path records the archive row id it created
 * next to the URL (see `MemoryPipeline`'s gap distillation), so a read of
 * version B does not inherit version A's dependency just because both live
 * under one URL. The per-read rules:
 *
 * - an explicit row id is used as given (existence checked only): the row the
 *   summary actually saw is the dependency, whether it is still current or was
 *   replaced after the read. Currency is decided at write time by
 *   `isSourceCurrent`, which suspends the summary instead of marking it valid.
 * - without an id, the URL rules apply (current rows, else every row — see
 *   urlMaterialRows). That covers reround results and stores that predate the
 *   id annotation.
 * - a `knowledge://` citation resolves to the knowledge row whenever it EXISTS,
 *   closed or not, for the same reason.
 *
 * Filtering by session is deliberately NOT done: D9 counts a fact recalled from
 * another session as a real dependency, and the same-session rule is exactly
 * what the ticket rejects.
 *
 * @returns Deduplicated refs, in the order the reads were given.
 */
export function resolveSummarySourcesFromReads(
  db: Database.Database,
  reads: Array<SummaryRead | null | undefined>,
): SummarySourceRef[] {
  const out: SummarySourceRef[] = [];
  const seen = new Set<string>();
  // Existence only: currency is decided at write time.
  const knowledgeStmt = db.prepare("SELECT id FROM semantic_memories WHERE id = ?");
  const materialStmt = db.prepare("SELECT id FROM retrieval_results WHERE id = ?");
  const push = (kind: "material" | "knowledge", id: number): void => {
    const key = kind + ":" + id;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ kind, id });
  };
  for (const read of reads ?? []) {
    const url = read?.url;
    const rowId = read?.rowId;
    // A knowledge citation is recognized by its URL, so it needs one.
    if (typeof url === "string" && url.startsWith(KNOWLEDGE_PREFIX)) {
      const id = Number(url.slice(KNOWLEDGE_PREFIX.length));
      if (!Number.isInteger(id) || id <= 0) continue;
      if (!knowledgeStmt.get(id)) continue;
      push("knowledge", id);
      continue;
    }
    // The row id comes BEFORE the URL checks: it is the exact dependency, and it
    // survives an empty URL. `saveResults` archives a result whose URL sanitized
    // to "" (and a secret-free one is still archived), so requiring a non-empty
    // URL here would silently drop the dependency — the summary would be stored
    // as valid and a later correction could not find it.
    if (typeof rowId === "number" && Number.isInteger(rowId) && rowId > 0) {
      if (materialStmt.get(rowId)) push("material", rowId);
      continue;
    }
    if (typeof url !== "string" || url.length === 0) continue;
    for (const id of urlMaterialRows(db, url)) push("material", id);
  }
  return out;
}

/**
 * Resolve search-result URLs to the material rows that hold them.
 *
 * The URL-only form, kept for callers that have no row id (and for stores that
 * predate the annotation). It delegates to `resolveSummarySourcesFromReads`'s
 * URL rule, so the two cannot drift: a URL resolves to its current rows, or —
 * when nothing is current — to every row it ever had.
 *
 * @returns Deduplicated refs, in the order the URLs were given.
 */
export function resolveSummarySourcesFromUrls(
  db: Database.Database,
  urls: Array<string | null | undefined>,
): SummarySourceRef[] {
  return resolveSummarySourcesFromReads(
    db,
    (urls ?? []).map((url) => (typeof url === "string" ? { url } : null)),
  );
}
