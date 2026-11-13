// Turn episode records into semantic memories (D2/D4) + reversible active forgetting (D5).
// Deterministic core; LLM only behind injected seams (summarize / classify). Fail-open:
// summarize null or absent -> cluster skipped (llmUnavailable); classify absent -> semantic row
// written at LOW_CONFIDENCE (0.2), never blocks the write.
// atomcode research (r93): dry-run = BEGIN IMMEDIATE + ROLLBACK exact prediction (r87
// pattern); no RETURNING inside a transaction touching FTS5 content tables (better-sqlite3 #654)
// -> inserts use lastInsertRowid.

import type Database from "better-sqlite3";
import { embedText, cosineSimilarity } from "./embedding-arm.js";
import { classifyTier, TAU_TIER } from "./time-decay.js";

export const THETA_DUP = 0.90;           // D4/D7: NOOP boundary; golden boundary case pins <, =, >
// NOOP boundary for the jaccard-only degraded path (embedding absent).
// Calibrated on the golden dataset 2026-09-15: distinct stub summaries jac=0.000, identical
// rerun=1.000, contradiction-pair ceiling=0.714 (update path must stay reachable). 0.80 sits
// inside the conservative band 0.7-0.85 with margin over the 0.714 ceiling.
// NOT the 0.4 update gate: update = bestJac>0.4 AND contradiction; noop-jac = bestJac>0.80
// alone (near-verbatim dup). Lossy by construction — catches lexical dups, misses paraphrase;
// the embedding path remains the dedup authority when present.
export const THETA_JAC = 0.80;

// #261: the "same topic" floor. Above this token overlap a candidate is talking
// about the SAME thing as a live row even if the polarity matches, so the
// relationship check — not the keyword rule — decides whether it is a
// correction. Deliberately the same 0.4 the update rule has always used: this
// widens which candidates reach the checker, it does not change what counts as
// a duplicate.
export const SAME_TOPIC_JACCARD = 0.4;
export const LOW_CONFIDENCE = 0.2;       // fidelity-gate absent or uncertain claims
export const CLUSTER_MIN = 3;            // D2: minimum episodes per entity cluster
// Design: #262 — ONE salience formula, shared by the plan-time clusters and
// the collision resolution's one-material fallback, so the two cannot drift.
function clusterSalience(liveCount: number): number {
  return Math.min(1, 0.4 + 0.1 * liveCount);
}
export const ARCHIVE_AGE_FACTOR = 3;     // D5: age > 3 * tier tau AND access_count = 0 AND stale last_accessed

// Local mirror of kernel attribution.ts CONTRADICTION_RE. Store must not import kernel
// (kernel -> store one-way dependency); keep in sync manually.
const CONTRADICTION_RE = /\b(?:not|never|no longer)\b|(?:\u5E76\u975E|\u6BEB\u65E0|\u5168\u65E0|\u4E0D\u662F|\u4E0D\u542B|\u6CA1[\u6709\u5728]?|\u672A|\u65E0|\u975E(?!\u5E38))/i;

interface EpisodeRow {
  id: number;
  entity: string | null;
  title: string | null;
  snippet: string | null;
  url: string;
  created_at: string;
  last_accessed: string | null;
  access_count: number | null;
  // #261: the knowledge row that replaced this material's fact, if any. The
  // scan still reads superseded rows (the update chain needs the history), so
  // this column is what lets a cluster know it is talking about the past.
  superseded_by: number | null;
}

interface SemanticRow {
  id: number;
  content: string;
  source_episode_ids: string;
  embedding: Buffer | null;
}

export interface ConsolidateEvidence { title: string; snippet: string; url: string; }
export type ConsolidateSummarizeFn = (episodes: ConsolidateEvidence[]) => Promise<string | null>;
export interface ConsolidateClaimVerdict { label: "supported" | "uncertain" | "unsupported"; confidence: number; }
export type ConsolidateClassifyFn = (claim: string, evidence: ConsolidateEvidence[]) => ConsolidateClaimVerdict;

/** How a new material relates to the knowledge it is compared with (D6). */
export type CorrectionRelation = "same" | "correction" | "different" | "unclear";

/**
 * D6: the correction-relationship check. Before one material may replace an
 * existing knowledge row, the caller-supplied checker must confirm the
 * material is about the SAME fact (object, matter, scope, time) and is itself
 * reliable. A negation keyword, a newer date, overall similarity or a
 * self-declared "official" source is not sufficient on its own — that call
 * belongs to this seam, not to a regex.
 */
export interface ConsolidateVerifyInput {
  oldContent: string;
  /** Candidate distilled from the new material. */
  summary: string;
  evidence: ConsolidateEvidence[];
}
export interface ConsolidateVerifyVerdict {
  /** The material restates what the live knowledge already says: no write. */
  alreadyCurrent?: boolean;
  sameFact: boolean;
  reliable: boolean;
  relation?: CorrectionRelation;
  reason?: string;
}
export type ConsolidateVerifyFn = (input: ConsolidateVerifyInput) => Promise<ConsolidateVerifyVerdict>;

/**
 * D7: the final-content check. Passing the correction-relationship check does
 * not skip this one. It runs on the MERGED text before anything is committed:
 * every statement must have a basis, and every fact of the old knowledge the
 * correction did not replace must survive in the new text.
 */
export interface ConsolidateFinalCheckInput {
  oldContent: string;
  finalContent: string;
  evidence: ConsolidateEvidence[];
  /**
   * The candidate the relationship check accepted. The checker needs it to
   * answer two questions that the raw material cannot: does the replacement
   * actually STATE this correction (otherwise the accepted fact is lost), and
   * does it add anything that is neither old knowledge nor this correction
   * (otherwise a lone material smuggles a new long-term conclusion in through
   * the merge). See #273 review.
   */
  correctedContent: string;
}
export interface ConsolidateFinalCheckVerdict {
  supported: boolean;
  preserved: boolean;
  /** The replacement states the accepted correction. Absent = not checked. */
  corrected?: boolean;
  /** The replacement adds nothing beyond old knowledge + the correction. */
  noExtras?: boolean;
  reason?: string;
}
export type ConsolidateFinalCheckFn = (input: ConsolidateFinalCheckInput) => Promise<ConsolidateFinalCheckVerdict>;

/** What a refused correction hands back to the caller (D6): old content, the
 * candidate, its sources, the check's verdict and reason, and what to look
 * into next. The materials stay; only the replacement is refused. */
export interface ConsolidateVerifyDetail {
  oldId: number;
  oldContent: string;
  candidate: string;
  evidence: ConsolidateEvidence[];
  sameFact: boolean;
  reliable: boolean;
  relation?: CorrectionRelation;
  reason?: string;
  followUp: string;
}

/** An accepted correction keeps the check's verdict, so "this was a correction
 * of the same fact by reliable evidence" is visible, not a keyword hit. */
export interface ConsolidateVerifiedCorrection {
  oldId: number;
  oldContent: string;
  candidate: string;
  evidence: ConsolidateEvidence[];
  sameFact: boolean;
  reliable: boolean;
  relation?: CorrectionRelation;
  reason?: string;
}

/** A correction that was NOT committed (D7/AC): the merge failed or came back
 * empty, or the final-content check failed. The old knowledge stays live; the
 * replacement is withheld rather than falling back to a summary that would
 * drop the old row's other facts. */
export interface ConsolidateIncompleteDetail {
  oldId: number;
  oldContent: string;
  candidate: string;
  evidence: ConsolidateEvidence[];
  stage: "merge-failed" | "merge-empty" | "final-check" | "rejudge-budget" | "rejudge-failed";
  reason?: string;
}

/**
 * #262 (D11): how a cross-run collision was resolved once the write phase
 * found the planned target already replaced by another session. `retries`
 * counts the re-read + re-judge rounds spent; it is at most 1 by design.
 */
export interface ConsolidateResolvedCollision {
  /** The dead row this run's plan was built against. */
  plannedTargetId: number;
  /** The live row the collision was resolved against. */
  targetId: number;
  targetContent: string;
  /** "duplicate": the re-judge found the correction already applied, so no
   * new version was created and this run's materials joined the live row's
   * sources. "re-merged": the correction was regenerated against the latest
   * content and landed as a new row. */
  resolution: "duplicate" | "re-merged";
  newId?: number;
  sameFact: boolean;
  reliable: boolean;
  relation?: CorrectionRelation;
  reason?: string;
  retries: number;
}

/**
 * #262 (D11): a collision that could NOT be resolved — the later correction's
 * plan was built against a version another session replaced, and either the
 * re-judge refused the correction against the live version, or that live
 * version moved again before the re-judged attempt could commit. Nothing was
 * deleted and neither side was picked by write order: the caller gets both
 * sides' materials, the current live content, the reason and what to check
 * next, and goes on investigating.
 */
export interface ConsolidateConflictDetail {
  plannedTargetId: number;
  plannedContent: string;
  candidate: string;
  evidence: ConsolidateEvidence[];
  currentTargetId: number | null;
  currentContent: string;
  currentEvidence: ConsolidateEvidence[];
  sameFact?: boolean;
  reliable?: boolean;
  relation?: CorrectionRelation;
  reason: string;
  followUp: string;
  /** Re-read + re-judge rounds spent before giving up: 0 or 1, never more. */
  retries: number;
}

/**
 * A planned correction whose write found its target already replaced by a
 * concurrent writer (#262). Same-run replacements (two clusters of THIS run
 * fighting over one row) are reported at once inside the write transaction;
 * everything else lands here for the post-commit resolution phase.
 */
interface PendingCollision {
  planned: SemanticRow;
  candidate: string;
  evidence: ConsolidateEvidence[];
  epsIds: number[];
  /** Design: #262 (D11) — the update-kind insert parameters from plan time
   * travel with the pending op; the merged TEXT the first attempt produced
   * deliberately does not: the re-merge must regenerate it against the
   * latest version, because a summary built for the dead target is exactly
   * what D11 forbids reusing. */
  confidence?: number;
  salience?: number;
}

/** The live head of a supersede chain: every field the resolution reads
 * (#262). No embedding — the re-merge embeds the text it merges, not the
 * row it replaces. */
interface ChainRow {
  id: number;
  content: string;
  source_episode_ids: string;
  valid_until: string | null;
  superseded_by: number | null;
}

/**
 * Which materials a run was allowed to read.
 *
 * Design: `by` names the rule that actually selected them — the selector that
 * wins is always the narrower one, so `memoryIds` beats `sessionId` and a
 * caller cannot accidentally widen an explicit list by repeating a session
 * handle. `archive` exists only for the eval runner and the existing
 * regression tests; the caller-facing resolver never produces it.
 */
export type ConsolidateScopeBy = "memory" | "session" | "archive";

export interface ConsolidateScopeReport {
  by: ConsolidateScopeBy;
  sessionIds: string[];
  memoryIds: number[];
  // A sessionId given alongside memoryIds. It is reported, not applied: the
  // explicit list is the scope.
  sessionIdNotApplied: boolean;
  // Materials the caller asked for vs. rows the run actually read after the
  // archived / quarantined / no-entity filters.
  requestedMaterials: number;
  materialsRead: number;
}

export interface ConsolidateReport {
  dryRun: boolean;
  clustersScanned: number;
  clustersTriggered: number;
  llmUnavailable: number;
  gateRejected: number;
  add: number;
  noop: number;
  update: number;
  // dedup decisions made on the jaccard-only degraded path (no cosine
  // computable — arm absent or no live row carries an embedding). Never silent.
  embeddingAbsent: number;
  // The scope this run really used, echoed back so a caller can see it rather
  // than infer it from the flags it thinks it passed.
  scope: ConsolidateScopeReport;
  // Clusters whose model call was refused by the session budget. The run stops
  // spending at the first rejection; nothing is written for those clusters.
  budgetRejected: number;
  // D6: single-evidence episodes that could not correct existing knowledge. A
  // lone material may correct, never create, so with no live row to correct
  // (and no polarity disagreement) it is skipped, not added.
  singleEvidenceSkipped: number;
  // #261: clusters whose materials were all superseded by an earlier
  // correction. They are kept in the scan (the update chain reads them) but
  // may not produce a new live row: that would resurrect the replaced facts.
  supersededClusterSkipped: number;
  // D6: corrections the relationship check refused — different fact, unreliable
  // evidence, or an unclear relation. The old knowledge stays live.
  verifyRejected: number;
  // What each refusal hands back to the caller: old content, candidate,
  // sources, verdict, reason and what to check next.
  verifyDetails: ConsolidateVerifyDetail[];
  // D7: accepted corrections with the checker's verdict attached.
  verifiedCorrections: ConsolidateVerifiedCorrection[];
  // D7/AC: corrections withheld because the merge failed, came back empty, or
  // the final-content check failed. Not committed; the old row stays live.
  correctionsIncomplete: number;
  incompleteDetails: ConsolidateIncompleteDetail[];
  // #262 (D11): concurrent-correction collisions that stayed UNRESOLVED —
  // the re-judge refused the correction against the latest version, or that
  // version moved again before the re-judged attempt could commit. This
  // run did NOT replace the current knowledge; both sides' evidence is
  // reported so the caller can keep investigating.
  conflicts: number;
  conflictDetails: ConsolidateConflictDetail[];
  // #262 (D11): collisions a re-read + one re-judge resolved: the correction
  // turned out to be already applied (no new version, "duplicate") or it was
  // re-merged onto the latest version and landed ("re-merged").
  resolvedCollisions: ConsolidateResolvedCollision[];
  semanticIds: number[];
  // Design: dedup compares against every live semantic memory, not only those
  // built from this scope — shared knowledge is corrected by reliable new
  // material (D5/D6), so an update may target a row the scope never read. That
  // is allowed, but it must be visible: each entry names the knowledge row this
  // run closed and whether that row's own materials were inside the scope.
  // `false` means knowledge outside the selected materials was replaced.
  updates: Array<{
    oldId: number;
    newId: number;
    // True when every occurrence this row was built from came from the scope.
    withinScope: boolean;
    // Materials of the closed row that the scope did not read.
    outsideScopeMaterialIds: number[];
    // D8: the episodes whose superseded_by now points at the new row — the
    // materials that carried the corrected fact. The rows stay (provenance);
    // they leave current-fact recall.
    supersededEpisodeIds: number[];
  }>;
}

/**
 * A scope the caller did not supply, or supplied in a form this run refuses.
 *
 * Consolidation must never fall back to the whole archive: "I forgot the
 * flag" and "consolidate everything" are indistinguishable at the store, so
 * the missing-scope case is an error here.
 */
export class ConsolidateScopeError extends Error {
  readonly code = "consolidate-scope-error";
  constructor(message: string) {
    super(message);
    this.name = "ConsolidateScopeError";
  }
}

export const CONSOLIDATE_SESSION_ID_MAX_CHARS = 128;
const CONSOLIDATE_SESSION_ID_PATTERN = /^[\x21-\x7E]+$/;

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

/**
 * Decide what a consolidation run may read, from raw caller input.
 *
 * Shared by `ans consolidate` and the MCP tool so the two entries cannot
 * disagree on what counts as a usable scope. Rules:
 * - `memoryIds` supplied -> validate every id, select by that list. A
 *   `sessionId` may also be supplied; it is echoed but never widens the list.
 * - otherwise `sessionId`/`sessionIds` -> validate every id, select by session.
 * - neither -> error. No implicit full-archive run.
 *
 * An empty `memoryIds` list counts as supplied and malformed: a caller that
 * said "these materials" and named none gets a refusal, not a different scope.
 *
 * The archive mode is deliberately not reachable from here. It exists for the
 * eval runner and the existing regression tests, which call the store directly.
 */
export function resolveConsolidateScope(raw: {
  sessionId?: unknown;
  sessionIds?: unknown;
  memoryIds?: unknown;
}): ConsolidateScope {
  const asArray = (value: unknown): unknown[] => {
    if (Array.isArray(value)) return value;
    if (value === undefined || value === null) return [];
    return [value];
  };

  const rawSessions = asArray(raw.sessionIds ?? raw.sessionId);
  const rawMemories = asArray(raw.memoryIds);
  // An explicitly supplied memoryIds list is the caller's statement of scope.
  // Supplying it empty (or with a bad id) is a malformed request, not "no
  // memory scope": falling through to the session would silently read a
  // different set of materials than the caller said.
  const memoriesSupplied = Array.isArray(raw.memoryIds)
    ? true
    : raw.memoryIds !== undefined && raw.memoryIds !== null;

  if (memoriesSupplied) {
    const bad = rawMemories.filter((id) => !isPositiveInteger(id));
    if (bad.length > 0 || rawMemories.length === 0) {
      throw new ConsolidateScopeError(
        "memoryIds must be a non-empty list of positive integer ids; got " + JSON.stringify(rawMemories),
      );
    }
    const sessionIds: string[] = [];
    for (const raw of rawSessions) {
      if (!isValidConsolidateSessionId(raw)) {
        throw new ConsolidateScopeError(
          "sessionId must be 1.." + CONSOLIDATE_SESSION_ID_MAX_CHARS + " visible ASCII characters; got " + JSON.stringify(raw),
        );
      }
      if (!sessionIds.includes(raw)) sessionIds.push(raw);
    }
    return {
      by: "memory",
      sessionIds,
      memoryIds: rawMemories as number[],
      sessionIdNotApplied: sessionIds.length > 0,
    };
  }

  if (rawSessions.length > 0) {
    const out: string[] = [];
    for (const id of rawSessions) {
      if (!isValidConsolidateSessionId(id)) {
        throw new ConsolidateScopeError(
          "sessionId must be 1.." + CONSOLIDATE_SESSION_ID_MAX_CHARS + " visible ASCII characters; got " + JSON.stringify(id),
        );
      }
      if (!out.includes(id)) out.push(id);
    }
    return { by: "session", sessionIds: out, memoryIds: [], sessionIdNotApplied: false };
  }

  throw new ConsolidateScopeError(
    "an explicit scope is required: pass sessionId or a non-empty memoryIds list. Refusing to consolidate the full archive.",
  );
}

/**
 * Scope-id rule for consolidation. Same visible-ASCII 1..128 shape as the
 * ans_chat session handle, but the failure contract is the opposite: a
 * malformed chat handle fails open (single-shot), a malformed consolidation
 * scope fails closed.
 */
export function isValidConsolidateSessionId(value: unknown): value is string {
  return (
    typeof value === "string"
    && value.length > 0
    && value.length <= CONSOLIDATE_SESSION_ID_MAX_CHARS
    && CONSOLIDATE_SESSION_ID_PATTERN.test(value)
  );
}

/**
 * One readable line describing the scope a run actually used.
 *
 * Design: both entry points print this, so it lives here — two copies drifted
 * before (one said "of N requested" for a session scope, the other did not),
 * one function makes the CLI and the MCP result describe the same run the same
 * way.
 */
export function formatConsolidateScope(scope: ConsolidateScopeReport): string {
  const target = scope.by === "session"
    ? "session " + scope.sessionIds.join(", ")
    : scope.by === "memory"
      ? "memory " + scope.memoryIds.join(", ")
      : "archive";
  const counts = scope.by === "memory"
    ? "materials read " + scope.materialsRead + " of " + scope.requestedMaterials + " requested"
    : "materials read " + scope.materialsRead;
  return target + " (" + counts + ")"
    + (scope.sessionIdNotApplied ? "; sessionId not applied: the memory list is the scope" : "");
}

/**
 * A summarize seam refused the call because a budget cap rejected it.
 *
 * The seam raises a typed error; the store must not import kernel (kernel ->
 * store is the only direction), so it recognises the shape instead of the
 * class: the provider-side error carries `code: "consolidate-budget-rejected"`.
 */
function isBudgetRejection(e: unknown): boolean {
  return typeof e === "object" && e !== null
    && (e as { code?: unknown }).code === "consolidate-budget-rejected";
}

export interface ArchiveCandidate {
  id: number;
  entity: string | null;
  title: string | null;
  url: string;
  createdAt: string;
  lastAccessed: string | null;
  accessCount: number;
  ageDays: number;
  reason: string;
}

export interface ArchiveApplyReport {
  dryRun: boolean;
  requested: number;
  archived: number;
  skipped: number;
  logIds: number[];
  undoableTotal: number;
}

const DAY_MS = 86400000;

// SQLite datetime('now') is UTC "YYYY-MM-DD HH:MM:SS"; Date.parse of the raw string is
// local-time dependent, so normalize to ISO Z before parsing (matches julianday in time-decay).
export function parseSqliteUtc(ts: string): number {
  return Date.parse(ts.replace(" ", "T") + "Z");
}

function tokenize(text: string): Set<string> {
  const m = text.toLowerCase().match(/[a-z0-9]+|[\u4E00-\u9FFF]/g);
  return new Set(m ?? []);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

// Claim splitter: sentence boundaries for latin + CJK punctuation; trivial fragments dropped.
export function splitClaims(summary: string): string[] {
  return summary
    .split(/(?<=[.!?\u3002\uFF01\uFF1F])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 6);
}

export type ConsolidateOp = "add" | "noop" | "update";

/**
 * D7 polarity rule: only a polarity DISAGREEMENT between the candidate and the
 * live row counts as a contradiction. A correction that restates the same
 * negation as the existing claim contradicts nothing, and a negation word in
 * the candidate alone was never sufficient grounds to replace knowledge.
 */
export function polarityContradiction(candidate: string, liveContent: string): boolean {
  return CONTRADICTION_RE.test(candidate) !== CONTRADICTION_RE.test(liveContent);
}

// D4/D7 ops-quadruple decision as a pure function so the 0.90 boundary is unit-testable without
// float32 cosine noise (integration covers the real cosine end-to-end).
// bestCos === null marks the degraded path — no cosine was computable (embedding
// arm absent, or no live row carries an embedding). Jaccard becomes the sole dedup signal and
// bestJac > thetaJac decides noop. Ordering mirrors the cosine path: noop before update, so a
// near-verbatim contradiction is still a noop (the 0.714 ceiling is why thetaJac > 0.72).
export function decideOp(bestCos: number | null, bestJac: number, contradiction: boolean, theta = THETA_DUP, thetaJac = THETA_JAC): ConsolidateOp {
  if (bestCos === null ? bestJac > thetaJac : bestCos > theta) return "noop";
  if (bestJac > 0.4 && contradiction) return "update";
  return "add";
}

function blobToFloat32(b: Buffer): Float32Array {
  return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
}

export interface ConsolidateRunOptions {
  dryRun?: boolean;
  thetaDup?: number;
  limit?: number;
  // Which materials to read. Product entry points resolve caller input through
  // resolveConsolidateScope, so this is already validated. Absent keeps the
  // internal full-archive mode that the eval runner and the existing
  // regression tests call directly; no product surface can reach it without
  // an explicit scope.
  scope?: ConsolidateScope;
  // D6: let one reliable material correct an existing knowledge row even
  // though it cannot pass the batch threshold (CLUSTER_MIN). Opt-in: the batch
  // gate stays the default, and a lone material may only UPDATE existing
  // knowledge, never ADD a new long-term conclusion.
  allowSingleEvidence?: boolean;
}

/** A validated scope. The store derives every count it reports from this. */
export interface ConsolidateScope {
  by: ConsolidateScopeBy;
  sessionIds: string[];
  memoryIds: number[];
  sessionIdNotApplied: boolean;
}

// D2/D4 main pipeline: signal-gated cluster scan -> summarize seam -> fidelity gate ->
// deterministic ops quadruple. dryRun runs the identical write path inside a rolled-back
// BEGIN IMMEDIATE transaction, so its counters are an exact prediction of apply
// *of the state it read* — a later concurrent write can still change what apply
// would do, and the report says so rather than promising the same result.
//
// #262 (D11): a write that finds its target replaced by a concurrent writer is
// withheld whole and re-read + re-judged at most once after the transaction
// (see resolveCollisions); a replacement closed by THIS run keeps the
// same-run conflict report it always had.
//
// Scope (D5/Q18): the scan reads only the resolved scope. The archive mode is
// internal; both product entry points refuse to build it from a missing or
// malformed caller scope, so a forgotten flag can never become "consolidate
// everything".
export async function consolidateMemoryRun(
  db: Database.Database,
  deps: {
    summarize?: ConsolidateSummarizeFn;
    classify?: ConsolidateClassifyFn;
    verify?: ConsolidateVerifyFn;
    verifyFinal?: ConsolidateFinalCheckFn;
  } = {},
  opts: ConsolidateRunOptions = {},
): Promise<ConsolidateReport> {
  const dryRun = opts.dryRun === true;
  const theta = opts.thetaDup ?? THETA_DUP;
  const scope = opts.scope ?? { by: "archive" as const, sessionIds: [], memoryIds: [], sessionIdNotApplied: false };
  const report: ConsolidateReport = {
    dryRun, clustersScanned: 0, clustersTriggered: 0, llmUnavailable: 0,
    gateRejected: 0, add: 0, noop: 0, update: 0, embeddingAbsent: 0,
    scope: {
      by: scope.by,
      sessionIds: [...scope.sessionIds],
      memoryIds: [...scope.memoryIds],
      sessionIdNotApplied: scope.sessionIdNotApplied,
      // The caller named these materials; counting them is what lets a reader
      // tell "asked for 5, read 3" from "asked for 0, read 0".
      requestedMaterials: scope.memoryIds.length,
      materialsRead: 0,
    },
    budgetRejected: 0,
    singleEvidenceSkipped: 0,
    supersededClusterSkipped: 0,
    verifyRejected: 0,
    verifyDetails: [],
    verifiedCorrections: [],
    correctionsIncomplete: 0,
    incompleteDetails: [],
    conflicts: 0,
    conflictDetails: [],
    resolvedCollisions: [],
    semanticIds: [],
    updates: [],
  };

  // The materials this run read, kept at run scope (#262): the collision
  // resolution reports `withinScope` for updates it writes after the main
  // transaction, and that verdict is about the whole run's read set.
  const readIds = new Set<number>();

  // #262 (D11): rows THIS run replaced inside its write transaction. A dead
  // target found in this set is the same-run fight `reportRunCollision` has
  // always described; anything else was closed by a concurrent writer and
  // goes to the post-commit resolution instead.
  const replacedRowIds = new Set<number>();
  // Cross-run collisions collected by the write closures. Resolution needs
  // model calls, and those must not run inside BEGIN IMMEDIATE: the budget
  // ledger reserves through the same connection and would deadlock on it.
  const collisions: PendingCollision[] = [];

  // The live row's current source set, read inside the write transaction.
  // Returns null when the row is no longer live — the caller reports the
  // collision instead of writing to a closed row (#273 review). Only the id
  // is read, so both the planner's row and the resolution's chain head fit.
  //
  // Reading it here (rather than trusting the planner's snapshot) is what
  // keeps two clusters that touch ONE row from overwriting each other's
  // materials: each write sees what the previous write already merged in.
  const currentSources = (row: { id: number }): number[] | null => {
    const live = db
      .prepare("SELECT source_episode_ids FROM semantic_memories WHERE id = ? AND valid_until IS NULL")
      .get(row.id) as { source_episode_ids: string } | undefined;
    if (!live) return null;
    try { return JSON.parse(live.source_episode_ids) as number[]; } catch { return []; }
  };

  // Two clusters in one run planned against the same live row and both passed
  // their checks. The first write wins; the second is reported as an
  // unresolved conflict instead of silently forking or editing dead knowledge.
  const reportRunCollision = (row: SemanticRow, candidate: string, sources: ConsolidateEvidence[]): void => {
    report.verifyRejected++;
    report.verifyDetails.push({
      oldId: row.id, oldContent: row.content, candidate, evidence: sources,
      sameFact: true, reliable: true,
      relation: "unclear",
      reason: "this run already replaced the same knowledge row",
      followUp: "同一次整理里另一个簇已经替换了这行知识；请先查看那次替换的结果，再单独处理这次的新材料。",
    });
  };

  // Route a dead-row encounter in a write closure (#262): a same-run
  // replacement keeps the historical report; a cross-run replacement queues
  // the op for the resolution phase instead of reporting it with the
  // same-run wording (which mislabels a concurrent writer and silently
  // drops the later correction).
  const noteRowCollision = (
    row: SemanticRow,
    info: {
      candidate: string;
      evidence: ConsolidateEvidence[];
      epsIds: number[];
      confidence?: number;
      salience?: number;
    },
  ): void => {
    if (replacedRowIds.has(row.id)) {
      reportRunCollision(row, info.candidate, info.evidence);
      return;
    }
    collisions.push({
      planned: row,
      candidate: info.candidate,
      evidence: info.evidence,
      epsIds: info.epsIds,
      ...(info.confidence !== undefined ? { confidence: info.confidence } : {}),
      ...(info.salience !== undefined ? { salience: info.salience } : {}),
    });
  };

  // Walk a supersede chain to its live head (#262). Calm guard: chains longer
  // than 64 hops (or ending in a closed row with no successor) mean the line
  // has no current version left; the collision is then reported unresolved
  // instead of guessed at.
  const liveHeadOf = (fromId: number): ChainRow | null => {
    let id = fromId;
    for (let hop = 0; hop < 64; hop++) {
      const row = db
        .prepare("SELECT id, content, source_episode_ids, valid_until, superseded_by FROM semantic_memories WHERE id = ?")
        .get(id) as ChainRow | undefined;
      if (!row) return null;
      if (row.valid_until === null) return row;
      if (typeof row.superseded_by !== "number" || !Number.isInteger(row.superseded_by)) return null;
      id = row.superseded_by;
    }
    return null;
  };

  // The materials behind a knowledge row — snippets ARE the row's evidence
  // text; a conflict must hand the caller both sides' materials, not just
  // their urls (#262 / B2).
  const materialsOf = (row: { source_episode_ids: string }): ConsolidateEvidence[] => {
    let ids: number[];
    try { ids = JSON.parse(row.source_episode_ids) as number[]; } catch { return []; }
    if (!Array.isArray(ids) || ids.length === 0) return [];
    const rows = db
      .prepare("SELECT title, snippet, url FROM retrieval_results WHERE id IN (" + ids.map(() => "?").join(", ") + ")")
      .all(...ids) as Array<{ title: string | null; snippet: string | null; url: string }>;
    return rows.map((r) => ({ title: r.title ?? "", snippet: r.snippet ?? "", url: r.url }));
  };

  // Design: #262 (D11) — an unresolved collision is reported with both sides
  // and the current live content. Never deletes, never picks a side by write
  // order.
  const pushConflict = (
    pending: PendingCollision,
    o: {
      current: ChainRow | null;
      reason: string;
      followUp: string;
      retries: number;
      verdict?: ConsolidateVerifyVerdict;
    },
  ): void => {
    report.conflicts++;
    report.conflictDetails.push({
      plannedTargetId: pending.planned.id,
      plannedContent: pending.planned.content,
      candidate: pending.candidate,
      evidence: pending.evidence,
      currentTargetId: o.current?.id ?? null,
      currentContent: o.current?.content ?? "(no live version left on this knowledge line)",
      currentEvidence: o.current ? materialsOf(o.current) : [],
      ...(o.verdict ? { sameFact: o.verdict.sameFact, reliable: o.verdict.reliable } : {}),
      ...(o.verdict?.relation ? { relation: o.verdict.relation } : {}),
      reason: o.verdict?.reason ? o.reason + " — " + o.verdict.reason : o.reason,
      followUp: o.followUp,
      retries: o.retries,
    });
  };

  // Design: #262 — one short write transaction per resolution step. The fn
  // returns null when the target moved again — nothing was written to the
  // dead row, so committing the empty transaction is safe and the caller
  // reports the conflict with the freshly re-read head.
  const resolutionTxn = <T>(fn: () => T | null): T | null => {
    if (db.inTransaction) throw new Error("collision resolution must not run inside an open transaction");
    db.exec("BEGIN IMMEDIATE");
    try {
      const out = fn();
      db.exec("COMMIT");
      return out;
    } catch (err) {
      try { db.exec("ROLLBACK"); } catch { /* already rolled back */ }
      throw err;
    }
  };

  // Design: #262 — the physical UPDATE write lives in one place, shared by
  // the plan-phase closure and the post-collision re-merge. Two copies of
  // the same SQL in one function is exactly how one path drifts from the
  // other (a retire rule fixed here would silently miss there).
  // `retireIds` are the target's own still-live sources — the materials of
  // the replaced row; the row's whole history stays untouched.
  const writeUpdateRow = (
    targetId: number,
    content: string,
    buffer: Buffer | null,
    opts: { sources: number[]; retireIds: number[]; salience: number; confidence: number },
  ): { newId: number; retiredNow: number[] } => {
    const info = db
      .prepare("INSERT INTO semantic_memories (content, source_episode_ids, salience, confidence, embedding) VALUES (?, ?, ?, ?, ?)")
      .run(content, JSON.stringify(opts.sources), opts.salience, opts.confidence, buffer);
    const newId = Number(info.lastInsertRowid);
    report.semanticIds.push(newId);
    db.prepare("UPDATE semantic_memories SET valid_until = datetime('now'), superseded_by = ? WHERE id = ?").run(newId, targetId);
    // #273 review: only the materials this statement actually re-pointed.
    // `retireIds` holds every source the target row ever had, including ones
    // an earlier correction already retired to an older successor; reporting
    // all of them would claim this run superseded materials it never touched.
    let retiredNow: number[] = [];
    if (opts.retireIds.length > 0) {
      const upd = db.prepare(
        "UPDATE retrieval_results SET superseded_by = ? WHERE id IN (" + opts.retireIds.map(() => "?").join(", ") + ") AND superseded_by IS NULL",
      ).run(newId, ...opts.retireIds);
      if (Number(upd.changes) > 0) {
        retiredNow = (db
          .prepare("SELECT id FROM retrieval_results WHERE id IN (" + opts.retireIds.map(() => "?").join(", ") + ") AND superseded_by = ?")
          .all(...opts.retireIds, newId) as Array<{ id: number }>).map((r) => r.id);
      }
    }
    return { newId, retiredNow };
  };

  // plan phase (scan + LLM summarize + classify + dedup) runs WITHOUT the
  // write lock; only the collected ops run inside BEGIN IMMEDIATE. Same op order and counters,
  // so the dry-run exact-prediction contract is unchanged (Bacon P2).
  const writes: Array<() => void> = [];
  const plan = async (): Promise<void> => {
    // Cluster scan INCLUDES superseded rows (valid_until NOT NULL): same-entity writes soft-close
    // the prior version immediately, so episodic history *is* the closed-row set.
    //
    // Scope selection: memoryIds wins over sessionIds (the explicit list is the
    // scope; a sessionId alongside it never widens it). Every filter that
    // already applies to a full-archive scan still applies inside the scope.
    const where: string[] = ["entity IS NOT NULL", "quarantine IS NULL", "archived = 0"];
    const params: Array<string | number> = [];
    if (scope.by === "memory") {
      where.push("id IN (" + scope.memoryIds.map(() => "?").join(", ") + ")");
      params.push(...scope.memoryIds);
    } else if (scope.by === "session") {
      where.push("session_id IN (" + scope.sessionIds.map(() => "?").join(", ") + ")");
      params.push(...scope.sessionIds);
    }
    const rows = db
      .prepare(
        "SELECT id, entity, title, snippet, url, created_at, last_accessed, access_count, superseded_by " +
          "FROM retrieval_results WHERE " + where.join(" AND ") + " ORDER BY entity, id",
      )
      .all(...params) as EpisodeRow[];
    report.scope.materialsRead = rows.length;
    // "In scope" means "this run read it", not "it belongs to the cluster being
    // processed": dedup compares against every live knowledge row, so a matched
    // row may have been built from materials of another entity that this run
    // also read. Using the whole read set is what makes the scope verdict
    // honest in both directions.
    for (const r of rows) readIds.add(r.id);

    const byEntity = new Map<string, EpisodeRow[]>();
    for (const r of rows) {
      const key = r.entity ?? "";
      if (!key) continue;
      const arr = byEntity.get(key) ?? [];
      arr.push(r);
      byEntity.set(key, arr);
    }

    const nowMs = Date.now();
    let processed = 0;
    let budgetStopped = false;

    // D6: one place builds the refusal the caller gets back, so the
    // single-evidence and batch paths cannot drift in shape. What is missing is
    // named (the relation verdict), never guessed: the old knowledge, the
    // candidate, its sources, the check's verdict and reason travel together.
    const refuseCorrection = (
      row: SemanticRow,
      candidate: string,
      evidence: ConsolidateEvidence[],
      verdict: ConsolidateVerifyVerdict | undefined,
    ): void => {
      report.verifyRejected++;
      const relation = verdict?.relation;
      const followUp = relation === "different"
        ? "与旧结论可能不是同一对象/事项/范围/时间，不能当成纠正；旧结论保留，请补查对应关系后再试。"
        : relation === "unclear"
          ? "新资料与旧结论是否同一事实无法确定；旧结论保留，请补查后再试。"
          : "新资料未被判定为同一事实且足够可靠；旧结论保留，请补查更可靠的来源后再试。";
      report.verifyDetails.push({
        oldId: row.id,
        oldContent: row.content,
        candidate,
        evidence,
        sameFact: verdict?.sameFact ?? false,
        reliable: verdict?.reliable ?? false,
        ...(relation ? { relation } : {}),
        ...(verdict?.reason ? { reason: verdict.reason } : {}),
        followUp,
      });
    };

    for (const [, eps] of byEntity) {
      if (budgetStopped) break;
      if (opts.limit && processed >= opts.limit) break;
      report.clustersScanned++;
      // #261: a cluster made only of already-superseded materials describes the
      // past. It still joins the scan (the update chain needs the history), but
      // it may not become a NEW live knowledge row — that would resurrect the
      // facts a later correction replaced.
      //
      // Skipped BEFORE the trigger counters and the summarize call: counting it
      // as "triggered" would claim work that will not happen, and paying for a
      // summary whose only possible outcome is "discard" is a real model call
      // spent on nothing (CodeRabbit review on #273).
      if (eps.every((e) => e.superseded_by !== null)) {
        report.supersededClusterSkipped++;
        continue;
      }
      // #273 review: the batch gate counts LIVE materials only. Superseded ones
      // stay in the cluster for the update chain, but they are already history —
      // letting three replaced episodes carry a fourth new material past
      // CLUSTER_MIN turns one lone material into "batch evidence" and lets it
      // write a brand-new long-term conclusion. That breaks the D6 rule that a
      // single material may only correct, never create.
      const liveEps = eps.filter((e) => e.superseded_by === null);
      // D6: single-evidence correction is an opt-in exception to the batch
      // threshold (CLUSTER_MIN stays the default gate).
      const singleEvidence = liveEps.length === 1 && opts.allowSingleEvidence === true;
      if (liveEps.length < CLUSTER_MIN && !singleEvidence) continue;
      // D2 deterministic trigger: oldest episode past its tier half-life OR low access signal.
      // No LLM scoring at trigger time.
      const oldest = liveEps[0]!;
      const tau = TAU_TIER[classifyTier(oldest.title ?? "", oldest.url ?? "")];
      const ageDays = (nowMs - parseSqliteUtc(oldest.created_at)) / DAY_MS;
      const avgAccess = liveEps.reduce((a, e) => a + (e.access_count ?? 0), 0) / liveEps.length;
      if (!(ageDays > tau || avgAccess <= 1)) continue;
      report.clustersTriggered++;
      processed++;

      // Summarize seam (fail-open): absent seam or null result -> skip cluster entirely.
      // A budget refusal is different from a summary fault: the caller's cap was
      // reached, so the run stops spending and reports it instead of looping
      // through the remaining clusters only to be refused again.
      if (!deps.summarize) { report.llmUnavailable++; continue; }
      const evidence: ConsolidateEvidence[] = liveEps.map((e) => ({
        title: e.title ?? "", snippet: e.snippet ?? "", url: e.url ?? "",
      }));
      let summary: string | null;
      try {
        summary = await deps.summarize(evidence);
      } catch (e) {
        if (isBudgetRejection(e)) {
          report.budgetRejected++;
          budgetStopped = true;
          break;
        }
        throw e;
      }
      if (!summary || summary.trim().length === 0) { report.llmUnavailable++; continue; }

      // D4 fidelity gate (kernel classifyClaim shape, injected). Row verdict = worst claim:
      // any unsupported -> reject the whole consolidation; any uncertain -> LOW_CONFIDENCE row.
      //
      // D7: for a verifier-backed single-evidence correction the gate is
      // circular — the candidate states the correction and the same evidence
      // carries the negation that describes the change, which the claim-level
      // contradiction rule reads as counter-evidence. The correction check
      // (same fact + reliable) is the gate for that path. Its confidence is not
      // invented: with the claim gate skipped the row keeps LOW_CONFIDENCE and
      // the check's verdict + reason are recorded in verifiedCorrections.
      const verifierBackedSingle = singleEvidence && deps.verify !== undefined;
      let confidence = LOW_CONFIDENCE;
      let claimGateRejected = false;
      if (deps.classify && !verifierBackedSingle) {
        let rejected = false;
        let uncertain = false;
        let minConf = 1;
        for (const claim of splitClaims(summary)) {
          const v = deps.classify(claim, evidence);
          if (v.label === "unsupported") { rejected = true; break; }
          if (v.label === "uncertain") uncertain = true;
          minConf = Math.min(minConf, v.confidence);
        }
        if (rejected) claimGateRejected = true;
        if (!rejected) confidence = uncertain ? LOW_CONFIDENCE : minConf;
      }

      // Embedding seam (fail-open): NULL embedding still inserts; dedup falls back to jaccard
      // (: that fallback now decides noop via THETA_JAC — see decideOp).
      const emb = await embedText(summary, "passage");
      const embBuf = emb ? Buffer.from(emb.buffer, emb.byteOffset, emb.byteLength) : null;

      const lives = db
        .prepare("SELECT id, content, source_episode_ids, embedding FROM semantic_memories WHERE valid_until IS NULL")
        .all() as SemanticRow[];
      // Selection vs decision: `best` names the live row this cluster relates to
      // most (any cosine sign — the correction check, not the similarity score,
      // decides whether it may be replaced; A2-style different-object rows must
      // still reach the checker instead of silently reading as "nothing to
      // correct"). `bestCos` keeps the historical 0 floor, so decideOp's
      // thresholds are unchanged.
      let best: SemanticRow | null = null;
      let bestScoreCos = -Infinity;
      let bestCos = 0;
      let bestJac = 0;
      let sawCos = false; // at least one cosine actually computed this scan
      const sumTokens = tokenize(summary);
      for (const l of lives) {
        const jac = jaccard(sumTokens, tokenize(l.content));
        let cos = 0;
        if (emb && l.embedding) { cos = cosineSimilarity(emb, blobToFloat32(l.embedding)); sawCos = true; }
        if (cos > bestScoreCos || (cos === bestScoreCos && jac > bestJac)) {
          best = l; bestScoreCos = cos; bestCos = Math.max(0, cos); bestJac = jac;
        }
      }
      // Degraded-path accounting: a dedup decision ran without any cosine signal.
      if (!sawCos && lives.length > 0) report.embeddingAbsent++;

      // D7 polarity fix (see polarityContradiction): a negation word in the
      // candidate alone never selects the update op.
      const contradiction = best ? polarityContradiction(summary, best.content) : false;

      // #273 review: `noop` must mean "certainly the same text", not "very
      // similar". A one-value edit ("opens at 09:00" -> "opens at 10:00") scores
      // 0.867 and would otherwise be skipped as a duplicate, leaving the old
      // time as current knowledge forever. So the near-verbatim test is
      // tightened here — only an exact restatement counts as a duplicate — and
      // anything else above the same-topic floor goes to the relationship check.
      // decideOp itself keeps its documented thresholds for the historical ops.
      // Hoisted above the exact-restatement short-circuit: that branch also
      // merges this cluster's materials into the row's source set, so it needs
      // the ids before `insert()` is defined. See the note there.
      const epsIds = liveEps.map((e) => e.id);
      const exactRestatement = best ? summary.trim() === best.content.trim() : false;
      if (exactRestatement) {
        // A summarizer may echo old knowledge even when the current material
        // does not support it. Never attach rejected evidence to a live row.
        if (claimGateRejected) { report.gateRejected++; continue; }
        const row = best!;
        writes.push(() => {
          // Liveness + current sources recheck: see `currentSources`. A
          // correction planned earlier in this run may already have closed this
          // row, and writing to it would land the materials on dead knowledge
          // while reporting a successful noop (#273 review).
          const current = currentSources(row);
          // #262: a same-run closure routes to reportRunCollision; a cross-run
          // one queues for the resolution phase with this op's plan context.
          if (!current) { noteRowCollision(row, { candidate: summary!, evidence, epsIds }); return; }
          // #273 review: the materials that produced this restatement must join
          // the row's source set. Otherwise a later correction only retires the
          // OLD sources, and these stay live with the stale text still in them —
          // so the fact this noop confirmed could come back after a correction.
          const merged = Array.from(new Set([...current, ...epsIds])).sort((a, b) => a - b);
          db.prepare("UPDATE semantic_memories SET access_count = access_count + 1, last_accessed = datetime('now'), source_episode_ids = ? WHERE id = ?")
            .run(JSON.stringify(merged), row.id);
          report.noop++;
        });
        continue;
      }

      // D6/D7: every automatic replacement passes the same correction-relationship
      // check, so the single-evidence path and the batch path cannot drift apart.
      // A budget refusal is thrown back to the caller's loop, which stops the run.
      //
      // Design: the verdict is returned, not recorded here. `verifiedCorrections`
      // means "this correction landed", so it is filled only after the merge and
      // the final-content check both pass; recording it at check time made a
      // withheld correction read as verified on the CLI.
      type CorrectionCheck =
        | { kind: "noop" }
        | { kind: "refused" }
        | { kind: "update"; verdict: ConsolidateVerifyVerdict };
      const runCorrectionCheck = async (row: SemanticRow): Promise<CorrectionCheck> => {
        const verdict = await deps.verify!({ oldContent: row.content, summary: summary!, evidence });
        if (verdict.alreadyCurrent === true || verdict.relation === "same") return { kind: "noop" };
        // Accept ONLY an explicit correction. A missing or unparseable `relation`
        // is a refusal, not a pass: the checker's prompt asks for it, and treating
        // its absence as "close enough" would let an incomplete reply replace
        // live knowledge — the same defect as trusting a keyword.
        if (verdict.relation !== "correction" || !verdict.sameFact || !verdict.reliable) {
          refuseCorrection(row, summary!, evidence, verdict);
          return { kind: "refused" };
        }
        return { kind: "update", verdict };
      };

      // #261 note: the all-superseded case was already handled above, before the
      // trigger counters and the summarize call. The cluster reaching this point
      // has at least one live material.

      let op: ConsolidateOp = best ? decideOp(sawCos ? bestCos : null, bestJac, contradiction, theta) : "add";
      let acceptedVerdict: ConsolidateVerifyVerdict | undefined;
      if (singleEvidence) {
        // A lone material may correct an existing memory; it may not create
        // new knowledge and does not count as a duplicate touch.
        if (!best) { report.singleEvidenceSkipped++; continue; }
        if (deps.verify) {
          let checked: CorrectionCheck;
          try {
            checked = await runCorrectionCheck(best);
          } catch (e) {
            if (isBudgetRejection(e)) { report.budgetRejected++; budgetStopped = true; break; }
            throw e;
          }
          if (checked.kind === "refused") continue;
          op = checked.kind;
          if (checked.kind === "update") acceptedVerdict = checked.verdict;
        } else {
          // No checker: a lone material cannot authorize any replacement.
          // Exact restatements were handled above; similarity or polarity alone
          // cannot prove same-fact and source reliability.
          report.singleEvidenceSkipped++;
          continue;
        }
      } else if (best && (bestJac > SAME_TOPIC_JACCARD || op === "noop")) {
        // #261 review: polarity alone cannot decide whether a candidate is a
        // correction. A same-polarity edit ("does not support REST, deploys run
        // weekly" -> "... monthly") disagrees with nothing by keyword, yet it
        // changes a fact, and treating it as `add` leaves two live rows stating
        // different cadences. So a candidate that talks about the SAME thing
        // (high token overlap) is handed to the relationship check, which is the
        // one place that can tell correction from restatement from new fact.
        //
        // `op === "noop"` joins the condition (#273 review): decideOp treats a
        // cosine above theta as a duplicate, and cosine stays high when the
        // wording changes but the topic does not. A value edit in different
        // words ("opens at 09:00" -> "doors open at ten") can score ~0.95
        // cosine with low token overlap, so it never reached this branch and
        // was counted as a duplicate — the old value stayed current forever.
        // Only an EXACT restatement returns above, so anything arriving here
        // with `noop` is a paraphrase and must be judged, not assumed away.
        if (!deps.verify) {
          refuseCorrection(best, summary, evidence, undefined);
          continue;
        }
        let checked: CorrectionCheck;
        try {
          checked = await runCorrectionCheck(best);
        } catch (e) {
          if (isBudgetRejection(e)) { report.budgetRejected++; budgetStopped = true; break; }
          throw e;
        }
        if (checked.kind === "refused") continue;
        op = checked.kind;
        if (checked.kind === "update") acceptedVerdict = checked.verdict;
      }

      // An accepted correction may bypass the generic negation heuristic.
      // Unsupported additions must still fail the original fidelity gate.
      if (claimGateRejected && op !== "update") { report.gateRejected++; continue; }
      // Similarity alone is never an authorization to replace live knowledge.
      if (op === "update" && !acceptedVerdict) {
        if (best) refuseCorrection(best, summary, evidence, undefined);
        else report.gateRejected++;
        continue;
      }
      const salience = clusterSalience(liveEps.length);
      const insert = (extraSources: number[] = [], content: string | null = summary, buffer: Buffer | null = embBuf): number => {
        const src = Array.from(new Set([...epsIds, ...extraSources])).sort((a, b) => a - b);
        const info = db
          .prepare("INSERT INTO semantic_memories (content, source_episode_ids, salience, confidence, embedding) VALUES (?, ?, ?, ?, ?)")
          .run(content, JSON.stringify(src), salience, confidence, buffer);
        const id = Number(info.lastInsertRowid);
        report.semanticIds.push(id);
        return id;
      };

      if (op === "noop") {
        // D4 NOOP: touch only; the row is a stable anchor for idempotent reruns.
        //
        // `noop` reaches here from two places and both mean "same fact, nothing
        // to write": an exact restatement (decided above, by text equality) or
        // a checker verdict of `alreadyCurrent` / `relation: "same"` — the
        // latter is a paraphrase, so text equality would miss it. Gating on
        // `exactRestatement` alone let a verified same-fact candidate fall
        // through to `insert()` and become a second copy (#273 review).
        const row = best!;
        writes.push(() => {
          // Liveness recheck (#273 review): a correction cluster that was
          // planned earlier can close this row before this write runs. Touching
          // it then would land the materials on a closed row and report `noop`
          // success, leaving the successor without those sources and the facts
          // still recallable. Report the conflict instead of writing.
          //
          // The source set is read HERE for the same reason: the planner's copy
          // is a snapshot, so two clusters touching one row would each write a
          // set missing the other's materials — and a later correction would
          // never retire the lost ones (#273 review).
          const current = currentSources(row);
          // #262: same-run replacement keeps this run's conflict report; a
          // cross-run replacement goes to the resolution phase.
          if (!current) { noteRowCollision(row, { candidate: summary!, evidence, epsIds, confidence, salience }); return; }
          // #273 review: the materials that produced this restatement must join
          // the row's source set. Otherwise a later correction only retires the
          // OLD sources, and these stay live with the stale text still in them —
          // so the fact this noop confirmed could come back after a correction.
          const merged = Array.from(new Set([...current, ...epsIds])).sort((a, b) => a - b);
          db.prepare("UPDATE semantic_memories SET access_count = access_count + 1, last_accessed = datetime('now'), source_episode_ids = ? WHERE id = ?")
            .run(JSON.stringify(merged), row.id);
          report.noop++;
        });
      } else if (op === "update" && best) {
        // D8: the replacement must carry the old knowledge's uncorrected facts.
        // Regenerate the text with the current knowledge in the evidence, then
        // run the D7 final-content check. A failed or empty merge withholds the
        // replacement entirely — falling back to the candidate summary would
        // silently drop every old fact the correction did not touch.
        const row = best;
        const currentKnowledge: ConsolidateEvidence = {
          title: "CURRENT KNOWLEDGE",
          snippet: row.content,
          url: "knowledge://semantic/" + row.id,
        };
        const mergeEvidence = [...evidence, currentKnowledge];
        let merged: string | null = null;
        let mergeFailed = false;
        let mergeError: unknown;
        try {
          merged = await deps.summarize(mergeEvidence);
        } catch (e) {
          if (isBudgetRejection(e)) { report.budgetRejected++; budgetStopped = true; break; }
          mergeFailed = true;
          mergeError = e;
        }
        if (mergeFailed || !merged || !merged.trim()) {
          report.correctionsIncomplete++;
          report.incompleteDetails.push({
            oldId: row.id, oldContent: row.content, candidate: summary, evidence,
            stage: mergeFailed ? "merge-failed" : "merge-empty",
            ...(mergeFailed ? { reason: mergeError instanceof Error ? mergeError.message : String(mergeError) } : {}),
          });
          continue;
        }
        const finalSummary = merged.trim();
        const mergedEmb = await embedText(finalSummary, "passage");
        const finalEmbBuf = mergedEmb ? Buffer.from(mergedEmb.buffer, mergedEmb.byteOffset, mergedEmb.byteLength) : null;
        // D7 second check: the final content's basis and fact retention.
        // Passing the correction-relationship check never skips this one.
        if (deps.verifyFinal) {
          let verdict: ConsolidateFinalCheckVerdict;
          try {
            verdict = await deps.verifyFinal({
              oldContent: row.content,
              finalContent: finalSummary,
              evidence,
              // The bare candidate, not the merged text: the checker has to say
              // whether the ACCEPTED correction is what got written.
              correctedContent: summary,
            });
          } catch (e) {
            if (isBudgetRejection(e)) { report.budgetRejected++; budgetStopped = true; break; }
            throw e;
          }
          // All four criteria gate the write. `corrected` closes the hole where
          // the merge keeps the old facts but drops the very change that was
          // accepted; `noExtras` closes the hole where a lone material smuggles
          // a new long-term fact in through the merge (#273 review). An
          // undefined field means the checker did not answer that question,
          // which is a refusal, not a pass.
          if (!verdict.supported || !verdict.preserved || verdict.corrected !== true || verdict.noExtras !== true) {
            report.correctionsIncomplete++;
            report.incompleteDetails.push({
              oldId: row.id, oldContent: row.content, candidate: summary, evidence,
              stage: "final-check",
              ...(verdict.reason ? { reason: verdict.reason } : {}),
            });
            continue;
          }
        } else {
          // No final-content seam: the replacement is withheld. The claim gate
          // below (when present) only rejects unsupported statements; it cannot
          // tell whether an uncorrected fact survived, and a wrong "yes" here
          // drops exactly the facts D8 says must stay. So "no checker" means
          // "no replacement", reported as incomplete rather than written.
          report.correctionsIncomplete++;
          report.incompleteDetails.push({
            oldId: row.id, oldContent: row.content, candidate: summary, evidence,
            stage: "final-check",
            reason: "no final-content checker was supplied, so fact retention could not be verified",
          });
          continue;
        }
        writes.push(() => {
          // D4/D8 UPDATE: write the merged row with the union of sources,
          // soft-close the old row with an explicit successor, and mark the
          // closed row's materials superseded by the new knowledge (the rows
          // stay for provenance; they leave current-fact recall).
          //
          // The closed row may have been built from materials outside the scope.
          // That is allowed (shared knowledge is correctable by reliable new
          // material), but the report must show it instead of leaving a caller to
          // assume only the selected materials moved.
          //
          // Same-run collision guard (#273 review): two clusters in ONE run can
          // plan against the same live row (both read it before any write ran),
          // and both plans can pass their checks. Closing it twice would leave
          // two live successors for one old row. The first write wins; a later
          // cluster targeting the same row is reported as an unresolved
          // compatibility conflict instead of silently forking the knowledge.
          // Design: #262 (D11) — a CONCURRENT writer closing this row is a
          // different situation from the same-run fight above: that op is
          // withheld whole (its merged text is not reused) and queued for a
          // re-read + one re-judge after the commit.
          //
          // The source set is read in the transaction, not from the planner's
          // snapshot: a noop on the same row may already have merged its own
          // materials into it, and writing the snapshot would drop them — those
          // materials would then never be retired by a later correction (#273
          // review). `currentSources` also carries the liveness check.
          const prev = currentSources(row);
          if (!prev) {
            noteRowCollision(row, { candidate: summary!, evidence, epsIds, confidence, salience });
            return;
          }
          const { newId, retiredNow } = writeUpdateRow(row.id, finalSummary, finalEmbBuf, {
            sources: Array.from(new Set([...epsIds, ...prev])).sort((a, b) => a - b),
            retireIds: prev,
            salience,
            confidence,
          });
          // #262: this row is now THIS run's replacement, so a later closure in
          // the same transaction reads it as the same-run fight it is, never as
          // a concurrent writer.
          replacedRowIds.add(row.id);
          // The correction actually landed: this is where "verified" becomes true.
          if (acceptedVerdict) {
            report.verifiedCorrections.push({
              oldId: row.id, oldContent: row.content, candidate: summary!, evidence,
              sameFact: acceptedVerdict.sameFact, reliable: acceptedVerdict.reliable,
              ...(acceptedVerdict.relation ? { relation: acceptedVerdict.relation } : {}),
              ...(acceptedVerdict.reason ? { reason: acceptedVerdict.reason } : {}),
            });
          }
          const outside = prev.filter((id) => !readIds.has(id));
          report.updates.push({
            oldId: row.id, newId,
            withinScope: outside.length === 0,
            outsideScopeMaterialIds: outside,
            supersededEpisodeIds: retiredNow,
          });
          report.update++;
        });
      } else {
        writes.push(() => {
          insert();
          report.add++;
        });
      }
    }
  };

  // Design: #262 (D11) — concurrent-collision resolution runs AFTER the main
  // transaction (model calls must not sit inside BEGIN IMMEDIATE: the budget
  // ledger reserves through the same connection and would deadlock), and each
  // withheld op gets AT MOST ONE re-read + re-judge:
  //  - re-judge says the latest version already carries the correction -> no
  //    new version; this run's materials join the live row's sources
  //    ("duplicate").
  //  - re-judge still accepts the correction -> ONE re-merge against the
  //    latest content — never the first attempt's final summary, which was
  //    built for the dead target — then the same final-content check, then a
  //    write whose target must STILL be the row that was re-judged. If it
  //    moved again the collision is reported unresolved; no third judgment.
  //  - re-judge refuses -> unresolved conflict: both sides' materials, the
  //    current live content and the reason go back to the caller. Nothing is
  //    deleted and neither side is picked by write order.
  // dryRun spends no model call here: the ROLLBACK already happened, so the
  // collision is reported as a preview fact only.
  const resolveCollisions = async (): Promise<void> => {
    if (collisions.length === 0) return;
    const verify = deps.verify;
    const summarize = deps.summarize;
    const verifyFinal = deps.verifyFinal;
    let resolutionStopped = false;
    // Design: #262 — one incomplete shape for every way the resolution can
    // stop short: a budget refusal (stage rejudge-budget), a model fault
    // (rejudge-failed), or a withheld final check (final-check). The landed
    // work and spend of the main transaction keep their own report fields.
    const pushIncompleteRejudge = (
      row: { id: number; content: string },
      pending: PendingCollision,
      stage: "rejudge-budget" | "rejudge-failed" | "final-check",
      reason: string,
    ): void => {
      report.correctionsIncomplete++;
      report.incompleteDetails.push({
        oldId: row.id,
        oldContent: row.content,
        candidate: pending.candidate,
        evidence: pending.evidence,
        stage,
        reason,
      });
    };
    for (const pending of collisions) {
      // Design: #262 — the budget refused a resolution call earlier in this
      // phase, so what is left stays unresolved BY NAME: counted as
      // incomplete, never silently dropped.
      if (resolutionStopped) {
        pushIncompleteRejudge(pending.planned, pending, "rejudge-budget", "the session budget was already exhausted before this collision could be re-judged");
        continue;
      }
      const head = liveHeadOf(pending.planned.id);
      if (!head) {
        pushConflict(pending, {
          current: null, retries: 0,
          reason: "the knowledge this correction planned to replace no longer has a live version",
          followUp: "这条知识链现在没有生效版本；材料已保留，请先弄清当前该以哪条为准，再重新发起更正。",
        });
        continue;
      }
      if (dryRun) {
        pushConflict(pending, {
          current: head, retries: 0,
          reason: "dry-run preview: a concurrent write replaced the planned target while this preview ran",
          followUp: "这是 dry-run 预览；真实运行会重读当前版本并最多重新判断一次，预览不保证之后仍得到同样结果。",
        });
        continue;
      }
      if (!verify || !summarize) {
        pushConflict(pending, {
          current: head, retries: 0,
          reason: "no correction checker (or summarizer) was supplied, so the collision could not be re-judged",
          followUp: "缺少判定或摘要检查器，无法重判这次并发冲突；材料已保留，请配置检查器后重试。",
        });
        continue;
      }
      // The ONE re-judge, against the live head's content (D11: at most one).
      let verdict: ConsolidateVerifyVerdict;
      try {
        verdict = await verify({ oldContent: head.content, summary: pending.candidate, evidence: pending.evidence });
      } catch (e) {
        if (isBudgetRejection(e)) {
          report.budgetRejected++;
          resolutionStopped = true;
          pushIncompleteRejudge(head, pending, "rejudge-budget", "the re-judge model call was refused by the session budget");
          continue;
        }
        // Design: #262 — a model fault here must not hide the work the main
        // transaction already committed. It is reported as an incomplete
        // correction (the collision stays unresolved by name), not thrown:
        // a thrown error would take the landed updates and spent calls down
        // with it.
        pushIncompleteRejudge(head, pending, "rejudge-failed",
          "the re-judge model call failed: " + (e instanceof Error ? e.message : String(e)));
        continue;
      }
      if (verdict.alreadyCurrent === true || verdict.relation === "same") {
        // 关键事实已经相同：不新建版本，本方材料并入当前行来源集。
        const wrote = resolutionTxn((): boolean | null => {
          const current = currentSources(head);
          if (!current) return null;
          const merged = Array.from(new Set([...current, ...pending.epsIds])).sort((a, b) => a - b);
          db.prepare("UPDATE semantic_memories SET access_count = access_count + 1, last_accessed = datetime('now'), source_episode_ids = ? WHERE id = ?")
            .run(JSON.stringify(merged), head.id);
          report.noop++;
          report.resolvedCollisions.push({
            plannedTargetId: pending.planned.id,
            targetId: head.id,
            targetContent: head.content,
            resolution: "duplicate",
            sameFact: verdict.sameFact,
            reliable: verdict.reliable,
            ...(verdict.relation ? { relation: verdict.relation } : {}),
            ...(verdict.reason ? { reason: verdict.reason } : {}),
            retries: 1,
          });
          return true;
        });
        if (wrote === null) {
          pushConflict(pending, {
            current: liveHeadOf(pending.planned.id), verdict, retries: 1,
            reason: "the current version was replaced again while the collision was being resolved; no third judgment runs",
            followUp: "重读后的版本在落地前又被别的会话更新，本次到此为止；请查看当前生效内容后重新决定。",
          });
        }
        continue;
      }
      if (verdict.relation !== "correction" || !verdict.sameFact || !verdict.reliable) {
        // B2 (Q21): the re-judge refused against the CURRENT version. The
        // first accepted plan is now a collision the caller must see in full.
        const relation = verdict.relation;
        pushConflict(pending, {
          current: head, verdict, retries: 1,
          reason: relation === "different"
            ? "the re-judge found the new material is not about the same object, matter, scope or time as the current version"
            : relation === "unclear"
              ? "the re-judge could not reconcile this correction with the current version: conflicting claims, no basis to prefer either side"
              : "the re-judge did not accept this correction against the current version",
          followUp: relation === "different"
            ? "并发冲突：本次更正与当前生效结论可能不是同一对象/事项/范围/时间；两边材料都在上面，请补查对应关系后再试。"
            : relation === "unclear"
              ? "并发冲突：两边各执一词、判不出哪边更可靠；两边材料与差异都在上面，请先查证再决定，先写入的一方不代表更正确。"
              : "并发冲突没有通过针对当前生效结论的判定；两边材料都在上面，请补查更可靠的来源后再试。",
        });
        continue;
      }
      // D11: the re-judge still accepts the correction — regenerate the merge
      // against the LATEST content. The first attempt's final summary was
      // built for the dead version and is never reused.
      const mergeEvidence: ConsolidateEvidence[] = [
        ...pending.evidence,
        { title: "CURRENT KNOWLEDGE", snippet: head.content, url: "knowledge://semantic/" + head.id },
      ];
      let merged: string | null = null;
      let mergeFailed = false;
      let mergeError: unknown;
      try {
        merged = await summarize(mergeEvidence);
      } catch (e) {
        if (isBudgetRejection(e)) {
          report.budgetRejected++;
          resolutionStopped = true;
          pushIncompleteRejudge(head, pending, "rejudge-budget", "the re-merge model call was refused by the session budget");
          continue;
        }
        mergeFailed = true;
        mergeError = e;
      }
      if (mergeFailed || !merged || !merged.trim()) {
        // 不提交替换；材料保留，明确报未完成（与计划阶段同一口径）。
        report.correctionsIncomplete++;
        report.incompleteDetails.push({
          oldId: head.id, oldContent: head.content, candidate: pending.candidate, evidence: pending.evidence,
          stage: mergeFailed ? "merge-failed" : "merge-empty",
          ...(mergeFailed ? { reason: mergeError instanceof Error ? mergeError.message : String(mergeError) } : {}),
        });
        continue;
      }
      const finalSummary = merged.trim();
      const mergedEmb = await embedText(finalSummary, "passage");
      const finalEmbBuf = mergedEmb ? Buffer.from(mergedEmb.buffer, mergedEmb.byteOffset, mergedEmb.byteLength) : null;
      // Design: #262 — insert parameters: update-kind pendings carry the
      // cluster's plan-time values. A noop-kind pending that the re-judge
      // turns into an accepted correction gets the same fallback the plan
      // would use for a one-material cluster: LOW_CONFIDENCE and
      // clusterSalience(1) — an accepted correction never silently gets
      // better numbers than its evidence supports.
      const insertConfidence = pending.confidence ?? LOW_CONFIDENCE;
      const insertSalience = pending.salience ?? clusterSalience(1);
      if (!verifyFinal) {
        // Same rule as plan time: no final-content checker means no
        // replacement. Withheld, reported, materials kept.
        report.correctionsIncomplete++;
        report.incompleteDetails.push({
          oldId: head.id, oldContent: head.content, candidate: pending.candidate, evidence: pending.evidence,
          stage: "final-check",
          reason: "no final-content checker was supplied, so fact retention could not be verified",
        });
        continue;
      }
      let finalVerdict: ConsolidateFinalCheckVerdict;
      try {
        finalVerdict = await verifyFinal({
          oldContent: head.content,
          finalContent: finalSummary,
          evidence: pending.evidence,
          // The bare candidate, not the merged text: the checker has to say
          // whether the ACCEPTED correction is what got written.
          correctedContent: pending.candidate,
        });
      } catch (e) {
        if (isBudgetRejection(e)) {
          report.budgetRejected++;
          resolutionStopped = true;
          pushIncompleteRejudge(head, pending, "rejudge-budget", "the final-content re-check model call was refused by the session budget");
          continue;
        }
        // Design: #262 — same rule as the re-judge: a model fault after the
        // main transaction committed becomes a named incomplete correction,
        // never a throw that takes the landed work and spend down with it.
        pushIncompleteRejudge(head, pending, "final-check",
          "the final-content re-check call failed: " + (e instanceof Error ? e.message : String(e)));
        continue;
      }
      if (!finalVerdict.supported || !finalVerdict.preserved || finalVerdict.corrected !== true || finalVerdict.noExtras !== true) {
        // Failed final check on the re-merge: no replacement, incomplete.
        report.correctionsIncomplete++;
        report.incompleteDetails.push({
          oldId: head.id, oldContent: head.content, candidate: pending.candidate, evidence: pending.evidence,
          stage: "final-check",
          ...(finalVerdict.reason ? { reason: finalVerdict.reason } : {}),
        });
        continue;
      }
      // Second submit: the target must STILL be the row that was re-judged.
      // If it moved again the collision is unresolved and NO third re-judge
      // runs — the ticket's hard limit.
      const wrote = resolutionTxn((): number | null => {
        const prev = currentSources(head);
        if (!prev) return null;
        const { newId, retiredNow } = writeUpdateRow(head.id, finalSummary, finalEmbBuf, {
          sources: Array.from(new Set([...pending.epsIds, ...prev])).sort((a, b) => a - b),
          retireIds: prev,
          salience: insertSalience,
          confidence: insertConfidence,
        });
        // The re-merged correction actually landed — "verified" starts here.
        report.verifiedCorrections.push({
          oldId: head.id, oldContent: head.content, candidate: pending.candidate, evidence: pending.evidence,
          sameFact: verdict.sameFact, reliable: verdict.reliable,
          ...(verdict.relation ? { relation: verdict.relation } : {}),
          ...(verdict.reason ? { reason: verdict.reason } : {}),
        });
        const outside = prev.filter((id) => !readIds.has(id));
        report.updates.push({
          oldId: head.id, newId,
          withinScope: outside.length === 0,
          outsideScopeMaterialIds: outside,
          supersededEpisodeIds: retiredNow,
        });
        report.update++;
        report.resolvedCollisions.push({
          plannedTargetId: pending.planned.id,
          targetId: head.id,
          targetContent: head.content,
          resolution: "re-merged",
          newId,
          sameFact: verdict.sameFact,
          reliable: verdict.reliable,
          ...(verdict.relation ? { relation: verdict.relation } : {}),
          ...(verdict.reason ? { reason: verdict.reason } : {}),
          retries: 1,
        });
        return newId;
      });
      if (wrote === null) {
        pushConflict(pending, {
          current: liveHeadOf(pending.planned.id), verdict, retries: 1,
          reason: "the current version was replaced again before the re-judged correction could commit; no third judgment runs",
          followUp: "重判后的版本在提交前又被别的会话更新，不做第三次重判；请查看当前生效内容后重新决定。",
        });
      }
    }
  };

  if (db.inTransaction) throw new Error("consolidateMemoryRun must not run inside an open transaction");
  await plan();
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const w of writes) w();
    db.exec(dryRun ? "ROLLBACK" : "COMMIT");
  } catch (err) {
    try { db.exec("ROLLBACK"); } catch { /* already rolled back */ }
    throw err;
  }
  await resolveCollisions();
  return report;
}

// D5 deterministic candidate scan: live, non-pinned, non-quarantined rows whose age exceeds
// factor * tier tau, with zero accesses and last_accessed stale (or never accessed).
export function scanArchiveCandidates(
  db: Database.Database,
  opts: { ageFactor?: number; now?: number; limit?: number } = {},
): ArchiveCandidate[] {
  const factor = opts.ageFactor ?? ARCHIVE_AGE_FACTOR;
  const nowMs = opts.now ?? Date.now();
  const rows = db
    .prepare(
      "SELECT id, entity, title, snippet, url, created_at, last_accessed, access_count " +
        "FROM retrieval_results WHERE archived = 0 AND valid_until IS NULL AND quarantine IS NULL " +
        "AND COALESCE(pinned, 0) = 0 ORDER BY id",
    )
    .all() as EpisodeRow[];
  const out: ArchiveCandidate[] = [];
  for (const r of rows) {
    const tier = classifyTier(r.title ?? "", r.url ?? "");
    const tau = TAU_TIER[tier];
    const ageDays = (nowMs - parseSqliteUtc(r.created_at)) / DAY_MS;
    const access = r.access_count ?? 0;
    if (!(ageDays > factor * tau)) continue;
    if (access > 0) continue;
    const laMs = r.last_accessed ? parseSqliteUtc(r.last_accessed) : null;
    if (laMs !== null && (nowMs - laMs) / DAY_MS <= tau) continue;
    out.push({
      id: r.id, entity: r.entity, title: r.title, url: r.url,
      createdAt: r.created_at, lastAccessed: r.last_accessed, accessCount: access,
      ageDays: Math.round(ageDays * 10) / 10,
      reason: "tier=" + tier + " tau=" + String(tau) + " age=" + (Math.round(ageDays * 10) / 10) + "d access=0 lastAccessed=" + (r.last_accessed ?? "never"),
    });
    if (opts.limit && out.length >= opts.limit) break;
  }
  return out;
}

// D5 apply: snapshot + archived=1 per row. dryRun runs identical writes in a rolled-back
// transaction (same exact-prediction contract as consolidate); report.logIds are then advisory.
export function applyArchive(
  db: Database.Database,
  ids?: number[],
  opts: { dryRun?: boolean } = {},
): ArchiveApplyReport {
  const dryRun = opts.dryRun === true;
  const targets = ids ?? scanArchiveCandidates(db).map((c) => c.id);
  const report: ArchiveApplyReport = { dryRun, requested: targets.length, archived: 0, skipped: 0, logIds: [], undoableTotal: 0 };
  const sel = db.prepare("SELECT * FROM retrieval_results WHERE id = ?");
  const upd = db.prepare("UPDATE retrieval_results SET archived = 1 WHERE id = ? AND archived = 0");
  const ins = db.prepare("INSERT INTO archive_log (memory_id, snapshot, reason) VALUES (?, ?, ?)");
  if (db.inTransaction) throw new Error("applyArchive must not run inside an open transaction");
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const id of targets) {
      const row = sel.get(id) as Record<string, unknown> | undefined;
      if (!row || row.archived === 1) { report.skipped++; continue; }
      // explicit ids bypass scanArchiveCandidates — enforce pinned / closed / quarantined
      // exclusions at the force point too (Bacon P2). Scan path never reaches this (already excluded).
      if (row.pinned === 1 || row.valid_until !== null || row.quarantine !== null) { report.skipped++; continue; }
      upd.run(id);
      const info = ins.run(id, JSON.stringify(row), "auto-scan");
      report.logIds.push(Number(info.lastInsertRowid));
      report.archived++;
    }
    const c = db.prepare("SELECT COUNT(*) AS n FROM archive_log WHERE undone_at IS NULL").get() as { n: number };
    report.undoableTotal = c.n;
    db.exec(dryRun ? "ROLLBACK" : "COMMIT");
  } catch (err) {
    try { db.exec("ROLLBACK"); } catch { /* already rolled back */ }
    throw err;
  }
  return report;
}

// D5 undo: restore archived=0 from an active archive_log row and stamp undone_at. Idempotent by
// construction - an already-undone (or missing) log row returns ok:false without touching state.
export function undoArchive(db: Database.Database, logId: number): { ok: boolean; memoryId?: number } {
  const row = db
    .prepare("SELECT id, memory_id FROM archive_log WHERE id = ? AND undone_at IS NULL")
    .get(logId) as { id: number; memory_id: number } | undefined;
  if (!row) return { ok: false };
  const tx = db.transaction(() => {
    db.prepare("UPDATE retrieval_results SET archived = 0 WHERE id = ?").run(row.memory_id);
    db.prepare("UPDATE archive_log SET undone_at = datetime('now') WHERE id = ?").run(row.id);
  });
  tx();
  return { ok: true, memoryId: row.memory_id };
}
