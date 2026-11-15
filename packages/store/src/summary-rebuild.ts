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
// The two whose blocks carry a machine-written provenance header, so their shape
// identifies them without guessing. A SUBSET of the list above, not a parallel
// list: it is written out as a subset of that tuple type so a member that stops
// being a valid tag fails to compile.
const SELF_IDENTIFYING_BLOCK_TAGS: readonly (typeof INJECTED_BLOCK_TAGS)[number][] = [
  "[RAG Context]",
  "[Recovery Digest]",
];
const SESSION_MEMORY_TAG = "[Session Memory]";
const RESEARCH_RECALL_TAG = "[Research Recall]";
const PREFS_OPEN_TAG = "<user_preferences";
const PREFS_CLOSE_TAG = "</user_preferences>";
const BLANK_LINE = String.fromCharCode(10, 10);

/**
 * How much of a summary / recall body injection renders (#286).
 *
 * Design: the caps live in the STORE, not the kernel — the kernel renders the
 * block it appends and this module rebuilds the SAME string from the anchor
 * payload to remove it. A different number on either side means the two strings
 * never match, the exact removal finds nothing, and the summary silently falls
 * back to guessing by tag shape, which is the failure #286 is about. Rejected
 * alternative: keeping the numbers in kernel and passing them into the store via
 * the plan call — it works, but every caller would have to remember to pass them,
 * and the one that forgot would reintroduce the silent mismatch.
 */
export const SUMMARY_INJECT_MAX_CHARS = 4000;

/** How much of an l2_recall body injection renders. */
export const RECALL_INJECT_MAX_CHARS = 1500;

/**
 * Render one summary / recall block exactly as injection appends it.
 *
 * Design: this function is the single place that knows the block's string shape.
 * The kernel renders every injected summary/recall block through it and this
 * module builds the same string back from the anchor payload to strip it.
 *
 * Why one function: before #286 the kernel spelled the shape out in six render
 * expressions across three sites (the Stage-2 append, the provenance keys that
 * strip a stale block, and `injectedSummaryAnchorIds`), and two of those copies had
 * already drifted from each other — one skipped a payload whose value was not a
 * string while another coerced it with `String(...)`. A numeric payload therefore
 * matched on one side and not the other, which is exactly the silent mismatch this
 * function removes. The store had no renderer of its own to drift from; it needed
 * one to name a block at all.
 *
 * Rejected alternative: exporting one array of block descriptors — more machinery
 * for the same guarantee, and the caller would still have to pick the right entry.
 *
 * @param anchorType - `rolling_summary` or `l2_recall`.
 * @param body - The anchor's text (a summary, or the recall snippet).
 * @returns The block string, truncated exactly as injection truncates it.
 */
export function renderSummaryBlock(anchorType: "rolling_summary" | "l2_recall", body: unknown): string {
  // One coercion rule for both sides: injection writes `String(payload.x)`, so the
  // strip path must read the same value the same way. `null`/`undefined` render as
  // nothing and the caller skips the block.
  if (body === null || body === undefined) return "";
  const text = String(body);
  if (text.length === 0) return "";
  return anchorType === "rolling_summary"
    ? SESSION_MEMORY_TAG + " " + text.slice(0, SUMMARY_INJECT_MAX_CHARS)
    : RESEARCH_RECALL_TAG + " " + text.slice(0, RECALL_INJECT_MAX_CHARS);
}

/**
 * Header markers that only injection writes, never a person.
 *
 * The fts adapter and the recovery digest both put a parenthesised provenance
 * header on the block's first line (see kernel's rag-adapter `formatBlock` and
 * recovery-digest `assemble`). A user who pastes a block out of a prompt gets
 * the same header, which is the case handled below by keeping the cut to a
 * trailing run — but a header is not something a person types as their own
 * sentence.
 */
const RAG_ADAPTER_HEADER = "(adapter=";
const DIGEST_HEADER = "(provenance=";

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
 * Two passes, in this order:
 *
 * 1. Blocks named EXACTLY by `provenBlocks` are removed by string match. This is the
 *    provenance pass: a caller (or this module, from the session's own anchors)
 *    can say "this is the block I wrote", and shape stops mattering — a summary
 *    body with blank lines in it comes out whole.
 * 2. What is left is removed only when a TRAILING run of blocks matches the
 *    shape injection actually writes for each tag (see `isInjectedBlock`).
 *
 * The second pass is a fallback for callers with NO provenance. The rebuild plan
 * always has provenance (it reads the session's own anchors), so it passes
 * `trustProvenance` and drops the guesswork for the two AMBIGUOUS tags:
 * `[Session Memory]` and `[Research Recall]`, whose bodies are free-form text, are
 * removed only when the caller named them. The other two still go, because
 * `[RAG Context]` and `[Recovery Digest]` carry a machine-written provenance
 * header (`adapter=` / `provenance=`) that no person types into a sentence — shape
 * identifies those without guessing.
 *
 * Everything the user typed stays verbatim in the plan path. In the fallback path
 * the long-standing bias applies: a tag in the middle of their text is never cut,
 * but a long single line after a tag is treated as a block (see `isInjectedBlock`).
 *
 * @param text - One stored or live user turn.
 * @param provenBlocks - Exact block strings this caller can prove it wrote.
 * @param opts.trustProvenance - For the two ambiguous tags, trust ONLY named
 *   blocks. Blocks that identify themselves (RAG, digest) are still recognized.
 * @returns The turn's own text, without injected blocks.
 */
export function stripInjectedBlocks(
  text: string,
  provenBlocks?: Iterable<string>,
  opts?: { trustProvenance?: boolean },
): string {
  let body = text;
  if (body.startsWith(PREFS_OPEN_TAG)) {
    const end = body.indexOf(PREFS_CLOSE_TAG);
    if (end >= 0) body = body.slice(end + PREFS_CLOSE_TAG.length);
  }
  // Pass 1: remove the blocks this caller can NAME exactly.
  //
  // The name is the evidence, so shape stops mattering. A match only counts when it
  // ends at a block boundary (message end or a blank line); a match that runs on into
  // the user's own words is a quotation, not injection, and is left alone.
  //
  // The refusals are remembered: the shape pass must not take what this pass just
  // protected (#288 review).
  let protectedBlocks = new Set<string>();
  if (provenBlocks) {
    const exact = removeExactBlocksReporting(body, provenBlocks);
    body = exact.text;
    protectedBlocks = exact.keptUserContinuations;
  }
  // Pass 2: remove a TRAILING run of shape-recognised blocks.
  //
  // Injection appends its blocks and leaves nothing after them, so a genuine
  // injected region reaches the end of the message. This pass only ever cuts a
  // suffix, which is what keeps a user's own tag in the middle of their text safe.
  //
  // A protected block inside that suffix is the user's text, not injection. So the
  // rule is: take the LAST protected block in the suffix, keep everything up to the
  // end of that block, and strip only what follows it. Two things follow from that,
  // and both were review findings when an earlier guard got them wrong (#288):
  //
  // - the user's sentence after a protected block survives, and so does a second
  //   protected block later in the message;
  // - a real injected block arriving AFTER the user's last protected block is still
  //   removed, instead of staying in the task section as if the user had written it.
  const cut = trailingInjectionStart(body, opts?.trustProvenance === true);
  if (cut >= 0) {
    const last = lastProtectedEnd(body, protectedBlocks, cut);
    if (last < 0) {
      body = body.slice(0, cut);
    } else {
      const after = body.slice(last);
      const trailing = trailingInjectionStart(after, opts?.trustProvenance === true);
      body = body.slice(0, last) + (trailing >= 0 ? after.slice(0, trailing) : after);
    }
  }
  return body.trim();
}

/**
 * End offset of the LAST protected block at or after `from`, or -1 when none.
 *
 * Every occurrence counts, not just the first one: the same block can appear twice
 * in a message (a user pasting the same summary back and commenting on each), and
 * stopping at the first match dropped the second copy and the sentence after it
 * (#288 review).
 *
 * @param text - Text to scan.
 * @param protectedBlocks - Blocks pass 1 refused because the user kept typing.
 * @param from - First offset to consider.
 * @returns The offset just past the last matching block, or -1.
 */
function lastProtectedEnd(text: string, protectedBlocks: Set<string>, from: number): number {
  let best = -1;
  for (const block of protectedBlocks) {
    let at = text.indexOf(block, from);
    while (at >= from) {
      // A block the user's words run on from is their text; one that ends at a
      // boundary was ordinary injection and pass 1 would have removed it.
      if (!endsAtBlockBoundary(text.slice(at), block)) best = Math.max(best, at + block.length);
      at = text.indexOf(block, at + 1);
    }
  }
  return best;
}

/**
 * Does `block` end at a block boundary inside `region`?
 *
 * @param region - Text starting with the block.
 * @param block - The block string.
 * @returns True when only a blank line (or nothing) follows.
 */
function endsAtBlockBoundary(region: string, block: string): boolean {
  const end = block.length;
  return end === region.length || region.startsWith(BLANK_LINE, end);
}

/**
 * Remove whole block strings this caller can name exactly.
 *
 * A named block is removed wherever it sits as a BLOCK, because the name IS the
 * evidence: the caller read the session's own anchors, so this exact string is
 * injection output and not something the user typed. Position alone cannot be the
 * rule — a tool-call loop re-injects Stage-1 onto a turn that already carries a
 * summary block, so a summary block is NOT always last. An earlier version removed
 * only a trailing run and left a named `[Session Memory]` block in the task records
 * whenever a RAG block came after it (#286 review).
 *
 * What makes a match a block, and not just a matching string: the match must END at
 * the end of the message or at a blank line. Injection writes whole lines and
 * separates blocks with a blank line, so a real block never ends mid-sentence.
 *
 * This rule is not cosmetic. Without it, a user who PASTES the block back and keeps
 * typing lost their own words: "Please correct this:\n\n[Session Memory] <the
 * summary> and tell me why" was cut to "Please correct this: and tell me why" —
 * the exact string matched, but it was not a block, and the trailing " and tell me
 * why" is the user's. Reported by CodeRabbit on #288 and confirmed by probe.
 *
 * What else protects the user's own words: the match is the WHOLE block string, not
 * a tag prefix, so a sentence that merely mentions the tag never matches; and only
 * the block is cut, so the text before and after it stays.
 *
 * Remaining limit, stated rather than hidden: a user who pastes the block back
 * followed by a BLANK LINE and then more text still loses the pasted block, because
 * that is byte-for-byte what a real injected region looks like. A block followed by
 * a blank line is the shape injection itself writes, so no text-only rule can tell
 * the two apart. The cost is the user's quoted copy, not the user's own sentence —
 * the sentence after the blank line survives.
 *
 * Longest first, for the same reason the kernel does it: two summaries can share a
 * prefix, and removing the short one first would cut that prefix out of the longer
 * one so it could never match.
 *
 * @param text - The turn text.
 * @param known - Exact block strings that are injection output.
 * @returns The text without any of those blocks.
 */
export function removeExactBlocks(text: string, known: Iterable<string>): string {
  return removeExactBlocksReporting(text, known).text;
}

/**
 * The same removal, plus which of the caller's blocks it REFUSED because the user
 * kept typing after them.
 *
 * The refusal matters to the caller: the shape pass runs next, and if it accepted
 * one of those positions it would delete the very sentence the boundary rule just
 * protected. A named RAG block followed by " and explain why" is the case — the
 * exact pass refuses, and `RAG_HIT_LINE` only checks the line prefix, so the shape
 * pass swallowed the whole tail including the user's sentence (#288 review).
 *
 * @param text - The turn text.
 * @param known - Exact block strings that are injection output.
 * @returns The stripped text, and which blocks were left in place because the
 *   user's own words run on after them.
 */
function removeExactBlocksReporting(
  text: string,
  known: Iterable<string>,
): { text: string; keptUserContinuations: Set<string> } {
  let out = text;
  const keptUserContinuations = new Set<string>();
  const ordered = [...known].filter((b) => b.length > 0).sort((a, b) => b.length - a.length);
  for (const block of ordered) {
    // With the separator injection writes before a block, so removing both leaves
    // no run of blank lines behind.
    const withSeparator = BLANK_LINE + block;
    // A match only counts as a block when it ends at the message end or at a blank
    // line; anything else is a fragment of a longer sentence the user wrote.
    const endsBlock = (end: number): boolean => end === out.length || out.startsWith(BLANK_LINE, end);
    let at = out.indexOf(withSeparator);
    while (at >= 0) {
      const end = at + withSeparator.length;
      if (endsBlock(end)) {
        out = out.slice(0, at) + out.slice(end);
        at = out.indexOf(withSeparator);
      } else {
        // Remember the block itself: the shape pass must not take it either.
        keptUserContinuations.add(block);
        at = out.indexOf(withSeparator, at + 1);
      }
    }
    // A block at the very start of the turn has no separator before it.
    if (out.startsWith(block)) {
      if (endsBlock(block.length)) out = out.slice(block.length);
      else keptUserContinuations.add(block);
    }
  }
  return { text: out, keptUserContinuations };
}

/**
 * Every summary / recall block this session has stored, rendered exactly as
 * injection renders it.
 *
 * This is the provenance the rebuild path can afford without a kernel round
 * trip: the store owns the anchors, so a `[Session Memory]` body containing a
 * blank line is one exact string here rather than an ambiguous shape to guess
 * at (#286). Older versions are included on purpose — a reused history may
 * still carry a block a correction has since replaced.
 *
 * @param db - Store connection.
 * @param sessionId - Session whose anchors to render.
 * @returns Exact block strings; empty when the session has no summary anchor.
 */
function sessionSummaryBlocks(db: Database.Database, sessionId: string): string[] {
  const rows = db
    .prepare(
      "SELECT anchor_type AS anchorType, payload FROM resume_anchors " +
        "WHERE session_id = ? AND anchor_type IN ('rolling_summary', 'l2_recall')",
    )
    .all(sessionId) as Array<{ anchorType: string; payload: string }>;
  const out: string[] = [];
  for (const row of rows) {
    let payload: any;
    try {
      payload = JSON.parse(row.payload);
    } catch {
      continue;
    }
    const anchorType = row.anchorType === "l2_recall" ? "l2_recall" : "rolling_summary";
    const block = renderSummaryBlock(anchorType, anchorType === "l2_recall" ? payload?.hits : payload?.summary);
    if (block.length > 0) out.push(block);
  }
  return out;
}

/**
 * Where a trailing run of injected blocks starts, or -1 when there is none.
 *
 * A candidate is an occurrence of a known tag right after the blank line
 * injection always writes. Requiring that separator is what keeps a turn that
 * STARTS with a tag — a user opening with "[Session Memory] here is my note" —
 * from being mistaken for an injected region: injection never replaces the
 * user's text, it appends to it.
 *
 * @param body - The message text, after any leading preferences block is removed.
 * @param selfIdentifyingOnly - Only accept tags whose block carries a
 *   machine-written header (RAG, digest). Set by callers that hold provenance for
 *   the other tags and must not let a shape guess cut a user's sentence.
 */
function trailingInjectionStart(body: string, selfIdentifyingOnly: boolean): number {
  const tags = selfIdentifyingOnly ? SELF_IDENTIFYING_BLOCK_TAGS : INJECTED_BLOCK_TAGS;
  const candidates: number[] = [];
  for (const tag of tags) {
    let at = body.indexOf(BLANK_LINE + tag);
    while (at >= 0) {
      candidates.push(at + BLANK_LINE.length);
      at = body.indexOf(BLANK_LINE + tag, at + 1);
    }
  }
  candidates.sort((a, b) => a - b);
  for (const at of candidates) {
    if (isInjectedRun(body.slice(at), tags, selfIdentifyingOnly)) return at;
  }
  return -1;
}

/**
 * Index of the separator that ends the current block, or -1 when it runs to the end.
 *
 * Named for what it returns: the position of the blank line before the NEXT block,
 * so callers add `BLANK_LINE.length` to reach that block's tag. (It used to be
 * called `nextBlockStart`, which claimed to return a block start and made every
 * caller's `+ BLANK_LINE.length` look like an off-by-one.)
 */
function nextBlockSeparator(tail: string, from: number, tags: readonly string[]): number {
  let best = -1;
  for (const tag of tags) {
    const at = tail.indexOf(BLANK_LINE + tag, from);
    if (at >= 0 && (best < 0 || at < best)) best = at;
  }
  return best;
}

/**
 * Does this whole tail consist of injection blocks, start to end?
 *
 * A block continues until the next block boundary, so a `[Session Memory]` body
 * that itself contains a blank line stays ONE block here instead of being split
 * into two segments — the split is what made every multi-paragraph body look
 * like foreign text (#286).
 *
 * @param tail - Text from a candidate block start to the end of the message.
 * @param tags - Which tags may appear in the run. The self-identifying subset
 *   keeps a provenance-holding caller from cutting an ambiguous tag's line.
 */
function isInjectedRun(tail: string, tags: readonly string[], provenanceMode: boolean): boolean {
  if (tail.length === 0) return false;
  const starts: number[] = [];
  let pos = 0;
  for (;;) {
    const tag = tags.find((candidate) => tail.startsWith(candidate, pos));
    if (!tag) return false;
    starts.push(pos);
    const next = nextBlockSeparator(tail, pos + tag.length, tags);
    if (next < 0) {
      break;
    }
    pos = next + BLANK_LINE.length;
    if (pos >= tail.length) return false;
  }
  const blockCount = starts.length;
  for (let i = 0; i < blockCount; i++) {
    const from = starts[i]!;
    const to = i + 1 < blockCount ? starts[i + 1]! - BLANK_LINE.length : tail.length;
    if (!isInjectedBlock(tail.slice(from, to), blockCount, provenanceMode)) return false;
  }
  return true;
}

/** Field labels the recovery digest writes, one per line after its header. */
const DIGEST_FIELD_LABELS = ["state: ", "last search: query=", "providers: ", "unique: "] as const;

/**
 * One recalled-hit line, exactly as the `fts` adapter renders it.
 *
 * `formatBlock` writes `- [role] content` for every hit (see kernel's
 * rag-adapter). Requiring the bracketed role keeps the recognition honest: a user
 * who writes a plain "- something" bullet after quoting a block is not a hit.
 */
const RAG_HIT_LINE = /^- \[[^\]]*\] /;

/**
 * Is this one block written by injection, or could it be the user's own text?
 *
 * The tags are not equally ambiguous, so each is judged by the shape its
 * producer actually emits:
 *
 * - `[RAG Context]` from the `fts` adapter is a provenance header line carrying
 *   `adapter=`, `traceId=` and the rest, followed by `- [role] …` hit lines. That
 *   header is machine output: nobody types a real adapter id and trace id into a
 *   sentence. The legacy `note` form is a single line.
 * - `[Recovery Digest]` is a provenance header followed by its four fixed field
 *   lines, all of them written by `assemble`.
 * - `[Session Memory]` / `[Research Recall]` are a tag plus free-form text. THIS
 *   is the ambiguous pair: "[Session Memory] the weekend schedule changed" is
 *   equally a real summary and a person talking about the tag. Shape cannot tell
 *   them apart, so the long-standing bias is kept here: a single line of at least
 *   20 characters counts as a block, because a leftover noise line is visible to
 *   whoever reads the prompt while a dropped instruction is not. Callers that need
 *   the user's own sentence guaranteed (the rebuild plan) use `trustProvenance`
 *   instead and never reach this guess.
 *
 * @param block - One block, from its tag to just before the next block.
 * @param blockCount - How many blocks the whole run has.
 */
function isInjectedBlock(block: string, blockCount: number, provenanceMode: boolean): boolean {
  const tag = INJECTED_BLOCK_TAGS.find((candidate) => block.startsWith(candidate));
  if (!tag) return false;
  const rawBody = block.slice(tag.length);
  const body = rawBody.trim();
  if (body.length === 0) return false;
  const lines = body.split("\n");
  const first = lines[0] ?? "";

  if (tag === "[RAG Context]") {
    // The machine-written header is the provenance here: a real block always
    // carries it, and a person never does. A hit bullet is "- [role] content",
    // not any line starting with "- ".
    if (first.includes(RAG_ADAPTER_HEADER)) {
      const hits = lines.slice(1).filter((l) => l.trim().length > 0);
      return hits.length > 0 && hits.every((l) => RAG_HIT_LINE.test(l));
    }
    // No header: the legacy `note` adapter writes `TAG + " " + note`, and a person
    // writes "TAG is the tag I mean, keep going". The two are byte-identical, so
    // shape cannot settle it.
    //
    // Resolution, and why it goes this way: the ticket's acceptance item 3 says a
    // sentence the user wrote that contains a tag must be kept verbatim, and the
    // plan path is where the user's words become a task requirement. So a plan-path
    // caller (`provenanceMode`) keeps an unheaded RAG line REGARDLESS of position,
    // and the cost is that a legacy operator note can survive as a leftover line in
    // the task section.
    //
    // What that costs, stated plainly: a legacy `note` domain's block CAN reach the
    // task records. The ticket's table does not cover that form (it lists the fts
    // header shape), and the note's provenance is operator config rather than
    // recalled web text, so no page content is promoted to a user requirement. The
    // reverse trade — cutting the user's own sentence — is the failure the ticket
    // exists to prevent, so it is not taken.
    //
    // Covered by R18 (the plan path keeps a user's tagged sentence verbatim) and
    // R21 (the note form and the fallback path). R19 is the bare-call test and does
    // NOT cover this case — it documents the fallback's bias, where a long tagged
    // line IS cut.
    // A caller with NO provenance still gets the long-standing fallback below.
    if (provenanceMode) return false;
    if (lines.length > 1) return false;
    return body.length >= 20 || blockCount > 1;
  }

  if (tag === "[Recovery Digest]") {
    // Every line here is written by `assemble`; a person cannot produce it.
    if (!first.includes(DIGEST_HEADER)) return false;
    const fields = lines.slice(1).filter((l) => l.trim().length > 0);
    return fields.length > 0 && fields.every((l) => DIGEST_FIELD_LABELS.some((label) => l.startsWith(label)));
  }

  // [Session Memory] / [Research Recall]: the ambiguous pair, judged by the
  // long-standing bias explained in the docstring. A named block never reaches
  // this function (the exact pass removed it), so the only arrival here is either
  // a real injected block or a person writing about the tag — and the bias keeps
  // one over the other in that impossible-to-separate case.
  if (lines.length > 1) return false;
  return body.length >= 20 || blockCount > 1;
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
  return collectTaskRecordsWithKnown(db, sessionId, sessionSummaryBlocks(db, sessionId));
}

/**
 * The same collection, with the session's block list supplied by the caller.
 *
 * `planSummaryRebuild` needs the identical list for the live turn, so passing it in
 * keeps one query for both halves instead of reading the anchors twice per plan.
 *
 * @param db - Store connection.
 * @param sessionId - Session whose user turns to collect.
 * @param known - Exact block strings that count as injection output.
 * @returns Records in message order.
 */
function collectTaskRecordsWithKnown(
  db: Database.Database,
  sessionId: string,
  known: string[],
): RebuildTaskRecord[] {
  const rows = db
    .prepare("SELECT id, content, created_at AS createdAt FROM messages WHERE session_id = ? AND role = 'user' ORDER BY id")
    .all(sessionId) as Array<{ id: number; content: string; createdAt: string }>;
  const out: RebuildTaskRecord[] = [];
  for (const row of rows) {
    // Provenance-only: this path read the session's own anchors, so the blocks are
    // named exactly and nothing has to be guessed. That is what keeps a user
    // sentence that starts with a tag verbatim — the fallback's long-line bias
    // would otherwise cut it, and the ticket requires the user's own words to
    // survive.
    const text = stripInjectedBlocks(readStoredMessageText(row.content), known, { trustProvenance: true });
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
  //
  // One read of the session's own blocks serves both halves: the stored turns and
  // the live turn must be stripped by the same provenance, and asking twice per
  // plan was a needless second query.
  const knownBlocks = sessionSummaryBlocks(db, req.sessionId);
  const allRecords = collectTaskRecordsWithKnown(db, req.sessionId, knownBlocks);
  // The live turn goes LAST: it is the newest instruction, and a later explicit
  // change must win over an earlier one in a reader's mind.
  //
  // It is appended even when the same text is already stored — a persisted copy
  // and the live one carry no shared id, so dropping either could drop the real
  // change. The budget below is what bounds the list.
  const liveTurn = typeof req.currentUserTurn === "string"
    ? stripInjectedBlocks(req.currentUserTurn, knownBlocks, { trustProvenance: true })
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
