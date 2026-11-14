// #264 (D9): rebuild a suspended summary from the CURRENT version of what it
// read, keeping the task the user actually stated.
//
// The 08/12 work (#263) stops injecting a summary whose fact was corrected and
// leaves it suspended. This module answers the next question: what does the
// session get back in its place?
//
// Two halves, and both must be right or the rebuilt summary is worse than none:
//
// 1. FACTS come from the rows the old summary really read (summary_sources),
//    resolved forward to their current version. Never "the newest N rows of the
//    archive", never "everything in this session" — a summary rebuilt from the
//    wrong material would quietly change the user's conclusion.
//
// 2. TASK REQUIREMENTS come from the user's own stored turns of the session
//    that owns the summary (messages.role = 'user'). Not from the old summary
//    text (which a model wrote), not from tool results, not from memory, and
//    not from another session. Injected blocks are stripped first, so
//    `[Session Memory]`, `[Research Recall]`, `[RAG Context]` and
//    `<user_preferences>` text cannot smuggle themselves in as the user's
//    words — the ticket's "web/tool/memory content must not become a user
//    requirement" rule.
//
// The plan is computed WITHOUT any model call, so a rebuild that cannot
// succeed (no recorded sources, no user records, a source whose line has no
// current version, or material over the budget) costs nothing and reports
// exactly why. Only a complete plan is handed to the generator, and only a
// committed rebuild clears the suspension — a partial one never claims a full
// recovery.

import type Database from "better-sqlite3";
import { containsSecret } from "./secret.js";
import {
  isSourceCurrent,
  liveHeadOf,
  parseSummarySourceRefs,
  recordSummarySources,
  type SupersedeChainRow,
  type SummaryAnchorType,
  type SummarySourceRef,
} from "./summary-sources.js";

/**
 * Character budget for the CURRENT FACT material handed to the generator.
 *
 * Conservative on purpose: the rebuild prompt also carries the user's own
 * turns, and both go through the same completion request. When the recorded
 * sources exceed this, the plan reports the ids it left out and stays
 * incomplete — it never truncates silently and calls the result a full rebuild.
 */
export const SUMMARY_REBUILD_FACT_BUDGET_CHARS = 12_000;

/** Character budget for the user's own turns (the task requirement). */
export const SUMMARY_REBUILD_TASK_BUDGET_CHARS = 4_000;

// Fragment tags injection appends into user turns (see kernel's MemoryPipeline).
// Mirrored here for the same reason `CONTRADICTION_RE` is mirrored in
// consolidate.ts: the store must not import the kernel. If a new injection tag
// is added there, add it here too or rebuild will inherit that block as the
// user's own words.
const INJECTED_BLOCK_TAGS = ["[RAG Context]", "[Recovery Digest]", "[Session Memory]", "[Research Recall]"] as const;
const PREFS_OPEN_TAG = "<user_preferences";
const PREFS_CLOSE_TAG = "</user_preferences>";
const BLANK_LINE = String.fromCharCode(10, 10);

/** One user turn that the rebuild may quote as the task requirement. */
export interface RebuildTaskRecord {
  /** messages.id — the traceable original record. */
  messageId: number;
  text: string;
  createdAt: string;
}

/** One current fact the rebuilt summary may state. */
export interface RebuildFact {
  kind: "material" | "knowledge";
  /** The CURRENT row id (a successor, when the old one was replaced). */
  id: number;
  text: string;
}

/** A source the old summary used that is no longer current, kept as history only. */
export interface RebuildReplacedFact {
  /** The row the old summary read. */
  kind: "material" | "knowledge";
  id: number;
  /** Where the fact lives now, when a live version still exists. */
  currentKind: "material" | "knowledge" | null;
  currentId: number | null;
  /** The old text, quoted so the generator can name it as replaced. */
  text: string | null;
}

/** Something the plan refused to include, named so the caller can see the gap. */
export interface RebuildExclusion {
  kind: "task" | "material" | "knowledge" | "summary";
  id: number;
  reason: "over-budget" | "missing-row" | "no-current-version";
}

/** Everything a generator needs, plus what is provably missing. */
export interface SummaryRebuildPlan {
  sessionId: string;
  anchorId: number;
  anchorType: SummaryAnchorType;
  /** The suspended summary's own text (context, never a source of truth). */
  previousSummary: string | null;
  taskRecords: RebuildTaskRecord[];
  facts: RebuildFact[];
  replaced: RebuildReplacedFact[];
  exclusions: RebuildExclusion[];
  /**
   * True only when every recorded source resolved to a current fact, at least
   * one user turn was recovered, and nothing was dropped for budget. Only a
   * complete plan may be generated and may clear the suspension.
   */
  complete: boolean;
  /** Human-readable reasons the plan is not complete, in plain words. */
  reasons: string[];
  /** How many dependency rows the old summary recorded. */
  recordedSources: number;
}

/**
 * Strip the blocks injection appends to a user turn.
 *
 * Only injection output is removed: everything the user typed stays verbatim.
 * The same separator rule injection uses (a blank line before the tag) keeps a
 * question that merely mentions a tag from being cut.
 */
export function stripInjectedBlocks(text: string): string {
  let body = text;
  if (body.startsWith(PREFS_OPEN_TAG)) {
    const end = body.indexOf(PREFS_CLOSE_TAG);
    if (end >= 0) body = body.slice(end + PREFS_CLOSE_TAG.length);
  }
  let cut = -1;
  for (const tag of INJECTED_BLOCK_TAGS) {
    const at = body.indexOf(BLANK_LINE + tag);
    if (at >= 0 && (cut < 0 || at < cut)) cut = at;
  }
  if (cut >= 0) body = body.slice(0, cut);
  return body.trim();
}

interface MaterialRow {
  id: number;
  title: string | null;
  snippet: string | null;
  url: string;
  superseded_by: number | null;
  valid_until: string | null;
}

function materialText(row: MaterialRow): string {
  const parts: string[] = [];
  if (row.title) parts.push(row.title);
  if (row.snippet) parts.push(row.snippet);
  const body = parts.join(" — ");
  return row.url ? body + " (" + row.url + ")" : body;
}

/**
 * Resolve one recorded source to the version that is current NOW.
 *
 * Rules (the same ones the rest of the store uses):
 * - a material that a correction retired points at the knowledge row that
 *   replaced it (`retrieval_results.superseded_by` holds a semantic_memories
 *   id), so the current fact is that line's live head;
 * - a knowledge row that was replaced is followed to the live head of its
 *   chain;
 * - a row that is gone, or whose line has no live head, is NOT current and is
 *   reported as an exclusion — the summary cannot claim to have recovered it.
 */
function resolveCurrent(
  db: Database.Database,
  ref: SummarySourceRef,
): { fact: RebuildFact | null; replaced: RebuildReplacedFact | null; exclusion: RebuildExclusion | null } {
  if (ref.kind === "knowledge") {
    const row = db
      .prepare("SELECT id, content, valid_until, superseded_by FROM semantic_memories WHERE id = ?")
      .get(ref.id) as SupersedeChainRow | undefined;
    if (!row) return { fact: null, replaced: null, exclusion: { kind: "knowledge", id: ref.id, reason: "missing-row" } };
    if (row.valid_until === null) {
      return { fact: { kind: "knowledge", id: row.id, text: row.content }, replaced: null, exclusion: null };
    }
    const head = liveHeadOf(db, ref.id);
    if (!head) {
      return {
        fact: null,
        replaced: { kind: "knowledge", id: ref.id, currentKind: null, currentId: null, text: row.content },
        exclusion: { kind: "knowledge", id: ref.id, reason: "no-current-version" },
      };
    }
    return {
      fact: { kind: "knowledge", id: head.id, text: head.content },
      replaced: { kind: "knowledge", id: ref.id, currentKind: "knowledge", currentId: head.id, text: row.content },
      exclusion: null,
    };
  }
  const row = db
    .prepare("SELECT id, title, snippet, url, superseded_by, valid_until FROM retrieval_results WHERE id = ?")
    .get(ref.id) as MaterialRow | undefined;
  if (!row) return { fact: null, replaced: null, exclusion: { kind: "material", id: ref.id, reason: "missing-row" } };
  if (row.superseded_by === null && row.valid_until === null) {
    return { fact: { kind: "material", id: row.id, text: materialText(row) }, replaced: null, exclusion: null };
  }
  // `valid_until` set with no successor is the ordinary write-time replacement
  // (the same URL fetched again invalidates the older row). That row is history:
  // quoting it as current would put a stale fact in the rebuilt summary, which is
  // exactly what the ticket says must not happen. Archived rows are a retention
  // decision, not a version change, so archiving alone does NOT disqualify a row.
  if (row.superseded_by === null) {
    return {
      fact: null,
      replaced: { kind: "material", id: ref.id, currentKind: null, currentId: null, text: materialText(row) },
      exclusion: { kind: "material", id: ref.id, reason: "no-current-version" },
    };
  }
  const head = liveHeadOf(db, row.superseded_by);
  if (!head) {
    return {
      fact: null,
      replaced: { kind: "material", id: ref.id, currentKind: null, currentId: null, text: materialText(row) },
      exclusion: { kind: "material", id: ref.id, reason: "no-current-version" },
    };
  }
  // The corrected fact is now stated by the knowledge row. The material itself
  // is history, so it is reported as replaced and NOT quoted as current.
  return {
    fact: { kind: "knowledge", id: head.id, text: head.content },
    replaced: { kind: "material", id: ref.id, currentKind: "knowledge", currentId: head.id, text: materialText(row) },
    exclusion: null,
  };
}

interface StoredAnchorRow {
  id: number;
  anchor_type: string;
  payload: string;
}

function readAnchor(db: Database.Database, sessionId: string, anchorId: number): StoredAnchorRow | null {
  const row = db
    .prepare("SELECT id, anchor_type, payload FROM resume_anchors WHERE id = ? AND session_id = ?")
    .get(anchorId, sessionId) as StoredAnchorRow | undefined;
  return row ?? null;
}

function anchorBody(anchor: StoredAnchorRow): string | null {
  try {
    const payload = JSON.parse(anchor.payload) as { summary?: unknown };
    return typeof payload?.summary === "string" ? payload.summary : null;
  } catch {
    return null;
  }
}

/**
 * Read one stored message's text.
 *
 * The runtime persists a user turn as its raw string when PI handed it one, and
 * as JSON when it handed content BLOCKS (`[{type:"text",text:"..."}]`). Both
 * shapes are the user's words, so both must be readable — taking the JSON
 * verbatim would paste `[{"type":"text"...` into the rebuilt task section and
 * make the requirement unreadable.
 *
 * The hard part is telling the two apart. A user who types `{"format":"csv"}` is
 * stating a requirement, not giving a content block; returning "" for it dropped
 * that change while the plan still called itself complete.
 *
 * So the parse only wins when the JSON really LOOKS like content blocks: a
 * non-empty array whose every element is an object carrying a string `type`.
 * Everything else — a bare object, an array of scalars, an array of objects with
 * no `type` — is user text and comes back verbatim. A genuine block array with no
 * text block (an image-only turn) still yields "", which is right: there is no
 * text channel to quote.
 */
export function readStoredMessageText(content: unknown): string {
  if (typeof content !== "string") return "";
  const trimmed = content.trimStart();
  if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) return content;
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    // Not JSON after all: a user really typed something starting with "[".
    return content;
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return content;
  const isBlock = (b: unknown): boolean =>
    !!b && typeof b === "object" && typeof (b as { type?: unknown }).type === "string";
  if (!parsed.every(isBlock)) return content;
  const parts: string[] = [];
  for (const block of parsed) {
    const { type, text } = block as { type?: unknown; text?: unknown };
    if (type === "text" && typeof text === "string") parts.push(text);
  }
  return parts.join("\n");
}

/**
 * The user's own turns for one session, oldest first, injections stripped.
 *
 * This is the ONLY accepted source of task requirements (D9). Role filtering is
 * what keeps tool results and assistant text out; stripping keeps injected
 * memory/RAG blocks out.
 *
 * Every stored turn is kept, in order, INCLUDING textually identical ones. A
 * global text de-dup was tried and removed: "use Chinese" -> "switch to English"
 * -> "use Chinese again" lost the third line, which is the user's latest explicit
 * change, and the plan still looked complete. Re-appends from a retry carry a
 * different message id and cannot be told apart from a real repeat by text alone,
 * so keeping the order is the honest answer. The prompt budget is what bounds the
 * cost, and it reports what did not fit.
 *
 * @returns Records in message order; empty when the session has no user turn of
 *   its own (a new session inherits no other session's task).
 */
export function collectTaskRecords(db: Database.Database, sessionId: string): RebuildTaskRecord[] {
  const rows = db
    .prepare("SELECT id, content, created_at AS createdAt FROM messages WHERE session_id = ? AND role = 'user' ORDER BY id")
    .all(sessionId) as Array<{ id: number; content: string; createdAt: string }>;
  const out: RebuildTaskRecord[] = [];
  for (const row of rows) {
    const text = stripInjectedBlocks(readStoredMessageText(row.content));
    if (text.length === 0) continue;
    out.push({ messageId: row.id, text, createdAt: row.createdAt });
  }
  return out;
}

/**
 * Everything the rebuild needs, computed without a model call.
 *
 * The plan is deliberately strict: it only reports `complete` when all three
 * halves line up (current facts, the user's own task text, nothing dropped for
 * budget). A caller that generates a summary from an incomplete plan would be
 * the "truncated but called complete" failure the ticket forbids.
 *
 * @param db - Store connection.
 * @param req.sessionId - Session that owns the suspended summary.
 * @param req.anchorId - The suspended summary anchor.
 */
export function planSummaryRebuild(
  db: Database.Database,
  req: {
    sessionId: string;
    anchorId: number;
    factBudgetChars?: number;
    taskBudgetChars?: number;
    /**
     * The user turn this run is handling, when it is not stored yet.
     *
     * The runtime persists finalized messages at the END of a run, so the turn
     * that triggered this rebuild is still missing from `messages` while the
     * rebuild runs. Without it the plan can look complete (earlier turns are
     * stored) and the rebuilt summary silently loses THIS turn's change — the
     * "changed to weekends only" case. Anything that is not a non-empty string
     * is ignored.
     */
    currentUserTurn?: string;
  },
): SummaryRebuildPlan {
  const factBudget = req.factBudgetChars ?? SUMMARY_REBUILD_FACT_BUDGET_CHARS;
  const taskBudget = req.taskBudgetChars ?? SUMMARY_REBUILD_TASK_BUDGET_CHARS;
  const reasons: string[] = [];
  const exclusions: RebuildExclusion[] = [];

  const anchor = readAnchor(db, req.sessionId, req.anchorId);
  if (!anchor) {
    return {
      sessionId: req.sessionId,
      anchorId: req.anchorId,
      anchorType: "rolling_summary",
      previousSummary: null,
      taskRecords: [],
      facts: [],
      replaced: [],
      exclusions: [],
      complete: false,
      reasons: ["the anchor no longer exists in this session"],
      recordedSources: 0,
    };
  }
  const anchorType: SummaryAnchorType = anchor.anchor_type === "l2_recall" ? "l2_recall" : "rolling_summary";

  const sourceRows = db
    .prepare("SELECT source_kind AS kind, source_id AS id FROM summary_sources WHERE anchor_id = ? ORDER BY id")
    .all(req.anchorId) as SummarySourceRef[];
  const recorded = parseSummarySourceRefs(sourceRows);

  const facts: RebuildFact[] = [];
  const replaced: RebuildReplacedFact[] = [];
  const seenFact = new Set<string>();
  let factChars = 0;
  let overBudget = false;

  for (const ref of recorded) {
    const r = resolveCurrent(db, ref);
    if (r.replaced) replaced.push(r.replaced);
    if (r.exclusion) exclusions.push(r.exclusion);
    const fact = r.fact;
    if (!fact) continue;
    const key = fact.kind + ":" + fact.id;
    if (seenFact.has(key)) continue;
    // Budget is spent in the order the old summary recorded its sources, so a
    // reader can tell which part of the material was dropped.
    if (factChars + fact.text.length > factBudget) {
      overBudget = true;
      exclusions.push({ kind: fact.kind, id: fact.id, reason: "over-budget" });
      continue;
    }
    seenFact.add(key);
    factChars += fact.text.length;
    facts.push(fact);
  }

  if (recorded.length === 0) {
    reasons.push("the summary recorded no sources, so there is nothing to rebuild it from");
  }
  // A source that exists but was dropped for budget is NOT "no current
  // version": saying that would blame the archive for a limit this code chose.
  const currentButExcluded = exclusions.some((e) => e.reason === "over-budget");
  if (facts.length === 0 && recorded.length > 0 && !currentButExcluded) {
    reasons.push("none of the recorded sources still has a current version");
  }
  if (exclusions.some((e) => e.reason === "missing-row")) {
    reasons.push("some recorded sources no longer exist in the store");
  }
  if (exclusions.some((e) => e.reason === "no-current-version")) {
    reasons.push("some recorded sources were replaced and their line has no current version");
  }
  if (overBudget) {
    reasons.push(
      "the recorded material is over the " + factBudget + "-character budget, so part of it was not included",
    );
  }

  // Task requirements: the user's own turns, oldest first. The first turn is the
  // original request; later turns are the explicit changes the user asked for.
  const allRecords = collectTaskRecords(db, req.sessionId);
  // The live turn goes LAST: it is the newest instruction, and a later explicit
  // change must win over an earlier one in a reader's mind.
  //
  // It is appended even when the same text is already stored — a persisted copy
  // and the live one carry no shared id, so dropping either could drop the real
  // change. The budget below is what bounds the list.
  const liveTurn = typeof req.currentUserTurn === "string"
    ? stripInjectedBlocks(req.currentUserTurn)
    : "";
  if (liveTurn.length > 0) {
    allRecords.push({ messageId: 0, text: liveTurn, createdAt: "" });
  }
  const taskRecords: RebuildTaskRecord[] = [];
  let taskChars = 0;
  for (const record of allRecords) {
    if (taskChars + record.text.length > taskBudget) {
      exclusions.push({ kind: "task", id: record.messageId, reason: "over-budget" });
      continue;
    }
    taskChars += record.text.length;
    taskRecords.push(record);
  }
  if (allRecords.length === 0) {
    reasons.push("this session has no stored user turn, so the original task cannot be recovered");
  } else if (taskRecords.length < allRecords.length) {
    reasons.push(
      "the user's turns are over the " + taskBudget + "-character budget, so some were not included",
    );
  }

  const previousSummary = anchorBody(anchor);
  // The suspended text travels as context (D8: a fact no source recorded but no
  // correction touched must not vanish). Whether it fits the PROMPT budget is the
  // kernel's call, because that cap belongs to the prompt: the kernel checks it
  // before generating and refuses an over-long version rather than cutting it.
  const complete = reasons.length === 0 && facts.length > 0 && taskRecords.length > 0;
  return {
    sessionId: req.sessionId,
    anchorId: req.anchorId,
    anchorType,
    previousSummary,
    taskRecords,
    facts,
    replaced,
    exclusions,
    complete,
    reasons,
    recordedSources: recorded.length,
  };
}

/** What one committed rebuild produced. */
export interface SummaryRebuildWriteResult {
  /** The new anchor, or null when nothing was written. */
  anchorId: number | null;
  /**
   * True only when the new summary is current (not stale) and the old
   * suspension was cleared. False means the suspension is still in force.
   */
  cleared: boolean;
  /**
   * How the write ended, so the caller can tell the three cases apart instead of
   * folding them into one "not cleared":
   * - `cleared`: the new version is current and the old suspension is gone;
   * - `stored-not-current`: the anchor was written but is itself suspended (a
   *   source moved on), so both versions stay out of the prompt;
   * - `nothing-to-clear`: the anchor was written and is current, but there was no
   *   open suspension row to clear (something else already cleared it).
   */
  status: "cleared" | "stored-not-current" | "nothing-to-clear" | "rejected";
  /** Why the write did not clear the suspension, when it did not. */
  reason: string | null;
}

/**
 * Commit a rebuilt summary: new anchor + its sources, then clear the old
 * suspension — all in one transaction.
 *
 * The suspension is cleared ONLY when the new summary is itself current. A
 * source that moved on between planning and writing makes the new anchor
 * suspended (the same rule `saveSummaryAnchor` applies), and then the old
 * suspension stays: two suspended versions and no injection is the honest
 * state, and a later turn can try again.
 *
 * @param req.rebuildOfAnchorId - The suspended anchor this text replaces.
 * @param req.text - The generated summary body.
 * @param req.sources - Ids the generated text was built from (the current facts).
 * @param req.taskRecordIds - messages.id rows quoted as the task requirement.
 */
export function writeRebuiltSummaryAnchor(
  db: Database.Database,
  req: {
    sessionId: string;
    rebuildOfAnchorId: number;
    text: string;
    sources: SummarySourceRef[];
    taskRecordIds: number[];
    generator?: { kind: "model"; note?: string };
  },
): SummaryRebuildWriteResult {
  if (typeof req.text !== "string" || req.text.trim().length === 0) {
    return { anchorId: null, cleared: false, status: "rejected", reason: "the generated summary was empty" };
  }
  // Only a rolling summary is rebuilt from session material. An l2_recall block
  // is a recall snippet produced by a query, so rewriting it here would claim a
  // query result nobody ran (D10: no invented records).
  const old = db
    .prepare("SELECT anchor_type AS anchorType FROM resume_anchors WHERE id = ? AND session_id = ?")
    .get(req.rebuildOfAnchorId, req.sessionId) as { anchorType: string } | undefined;
  if (!old || old.anchorType !== "rolling_summary") {
    return {
      anchorId: null,
      cleared: false,
      status: "rejected",
      reason: old
        ? "only a rolling summary can be rebuilt from session material; this anchor is " + old.anchorType
        : "the suspended anchor no longer exists in this session",
    };
  }
  const payload = {
    summary: req.text,
    timestamp: Date.now(),
    // Traceability (D8/D9): which suspended version this replaces, which rows
    // it was built from, and which user records it quotes as the task. The old
    // anchor text stays readable; this is the pointer from one to the other.
    rebuiltFrom: {
      anchorId: req.rebuildOfAnchorId,
      sourceRefs: req.sources,
      taskRecordIds: req.taskRecordIds,
      ...(req.generator ? { generator: req.generator } : {}),
    },
    sources: req.sources,
  };
  const json = JSON.stringify(payload);
  // Same write-entry guard as `saveAnchor`: anchors are a searchable surface, so
  // a generated summary that trips the secret detector is dropped here too. The
  // suspension then stays in force, which is the safe direction.
  if (containsSecret("rolling_summary " + json)) {
    return { anchorId: null, cleared: false, status: "rejected", reason: "the generated summary matched the secret guard, so it was not stored" };
  }

  const write = db.transaction((): SummaryRebuildWriteResult => {
    // Is the version being rebuilt still the newest one? A compression that ran
    // while this rebuild was generating writes a NEWER summary C. Committing R
    // after it would make R the injected summary, and R only knows the sources of
    // the OLD version — so every fact C added would silently vanish from the
    // prompt. Checked inside the transaction and before the insert, so the old
    // version simply stays suspended: the safe direction, and nothing C added is
    // lost.
    const newer = db
      .prepare(
        "SELECT id FROM resume_anchors WHERE session_id = ? AND anchor_type = 'rolling_summary' AND id > ? LIMIT 1",
      )
      .get(req.sessionId, req.rebuildOfAnchorId) as { id: number } | undefined;
    if (newer) {
      return {
        anchorId: null,
        cleared: false,
        status: "rejected",
        reason:
          "a newer summary (anchor " + newer.id + ") was written while this one was being rebuilt; " +
          "it was left in place so nothing it added is lost",
      };
    }
    const info = db
      .prepare("INSERT INTO resume_anchors (session_id, anchor_type, payload) VALUES (?, 'rolling_summary', ?)")
      .run(req.sessionId, json);
    const anchorId = Number(info.lastInsertRowid);
    if (!Number.isInteger(anchorId) || anchorId <= 0) {
      throw new Error("rebuilt summary anchor insert returned no id");
    }
    recordSummarySources(db, { sessionId: req.sessionId, anchorId, anchorType: "rolling_summary", sources: req.sources });
    // Currency re-check at commit time, mirroring saveSummaryAnchor: the plan may
    // have read a version another writer replaced while the model was running.
    const stale = req.sources.filter((ref) => !isSourceCurrent(db, ref));
    if (stale.length > 0) {
      db.prepare(
        "INSERT OR IGNORE INTO summary_suspensions (session_id, anchor_id, reason, trigger_kind, trigger_id) VALUES (?, ?, ?, ?, ?)",
      ).run(
        req.sessionId,
        anchorId,
        "the rebuilt summary was built from " + stale.map((r) => r.kind + " " + r.id).join(", ") +
          ", which had already been replaced when it was written",
        stale[0]!.kind,
        stale[0]!.id,
      );
      return {
        anchorId,
        cleared: false,
        status: "stored-not-current",
        reason: "a source was replaced while the summary was being rebuilt; the new version is suspended too",
      };
    }
    const cleared = db
      .prepare(
        "UPDATE summary_suspensions SET cleared_at = datetime('now'), cleared_by_anchor_id = ? WHERE session_id = ? AND anchor_id = ? AND cleared_at IS NULL",
      )
      .run(anchorId, req.sessionId, req.rebuildOfAnchorId);
    if (Number(cleared.changes) === 0) {
      // No live suspension row: either another writer already cleared it or the
      // anchor was never suspended. The new summary is still current, so this is
      // not a failure — but say what happened instead of implying a clear.
      return { anchorId, cleared: false, status: "nothing-to-clear", reason: "the old summary had no open suspension to clear" };
    }
    return { anchorId, cleared: true, status: "cleared", reason: null };
  });
  return write.immediate();
}
