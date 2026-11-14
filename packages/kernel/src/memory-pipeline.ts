// MemoryPipeline: deep module for L0/L1/L2 memory pipeline logic.
// extracted from pi-runtime.ts shouldStopAfterTurn + transformContext.
// Interface: attach (init) / inject (hot read) / consolidate (cold write).
// Domain-semantic naming — interface does not leak host hook details.
// pure function-ization + ConsolidationState + shell wrapper.
// consolidate() is now a shell that calls pure consolidateState() then executes I/O.
// signalSearchTurn() DELETED — replaced by hasRetrievalEvidence parameter.

import { loadPiCodingAgent } from "./pi-sdk";

// PI's summarizer calls `stream.result()`; a host stream function only has to be
// an async iterable. Filling in the missing method keeps the official summarizer
// usable, instead of maintaining a second implementation of it.
function ensureResult(streamFn: any): any {
  if (typeof streamFn !== "function") return streamFn;
  return (model: any, context: any, options?: any) => {
    const stream = streamFn(model, context, options);
    if (stream && typeof stream.result !== "function") {
      stream.result = async () => {
        let last: any;
        for await (const event of stream) {
          if (event?.type === "done" && event.message) last = event.message;
        }
        if (!last) throw new Error("summarization stream produced no final message");
        return last;
      };
    }
    return stream;
  };
}
// reuse summary engine only, NOT compact window management.
// Own constant so upstream window-management namespace changes cannot break L0.
const COMPACTION_RESERVE_TOKENS = 16_384;

// Upper bound for the background summarization call. It is fire-and-forget
// during a turn but the code that owns it drains it before closing the
// store (#129), so an unbounded provider stall would hold the CLI open until the
// provider times out. Aborting is a normal fire-and-forget failure: the next turn
// simply tries again.
const BACKGROUND_SUMMARY_TIMEOUT_MS = 90_000;
import { IR_CUSTOM_INSTRUCTIONS } from "./ir-schema";
import { accumulateUsage, emptyUsageTotals, toSummaryUsage, type SummaryUsage } from "./usage";
import type { RetrieverPort, SessionStorePort, DomainConfigPort, SummarySuspensionPort } from "./ports";
import { rebuildSuspendedSummary, type SummaryRebuildAttempt } from "./summary-rebuild";
import { RagAdapterRegistry, RAG_CONTEXT_TAG, RAG_DEFAULT_LIMIT, RAG_QUERY_MAX_CHARS, isDynamicRagAdapter } from "./rag-adapter";
import { buildRecoveryDigest, RECOVERY_DIGEST_TAG } from "./recovery-digest";
import { appendMessageText, prependMessageText, readMessageText } from "./message-text";
import type { GateEnvelope } from "./sufficiency-gate";
import { rewriteQuery, classifyQdf } from "./query-rewrite";
import { isTimeSensitive, isEvergreen } from "@anysearch-cli/store"; // no inline regex copies
import { assertJudgmentInput, combineLabels, unwrapRetrieved, type SourceTraceLabel } from "@anysearch-cli/retriever";
import type { LlmRewriteFn } from "./query-rewrite";

export interface TaggedGapResult {
  url: string;
  title: string;
  snippet: string;
  source: string;
  label: SourceTraceLabel;
  /**
   * #263: the archive row this result was fetched into, when the search path
   * recorded it (see `stampArchiveRowIds` in pi-runtime). This is what makes a
   * summary's dependency exact: a URL can hold a retired older row and a live
   * newer one, and only the id says which version the summary read.
   */
  archiveRowId?: number;
}

export interface TaggedGap {
  text: string;
  results: TaggedGapResult[];
  source: SourceTraceLabel["source"];
  traceId: string;
}

export interface MemoryPipelineDeps {
  store: SessionStorePort;
  models?: any; // Models object for generateSummaryWithUsage
  retriever: RetrieverPort;
  domain: DomainConfigPort;
  model: any;         // pi-ai Model instance
  streamFn: any;      // models.streamSimple.bind(models)
  sessionId: string;
  getApiKey?: () => Promise<string | undefined> | undefined;
  providerName?: string;
  /**
   * #113: REAL model context window in tokens, or undefined when unknown
   * (custom endpoint without LlmSessionOptions.contextWindow). Must NOT be
   * derived from model.contextWindow — pi-ai always carries a number there
   * (128000 placeholder for custom endpoints), which would turn "unknown"
   * into "known 128K" and scale `{fraction}` by the placeholder.
   */
  contextWindow?: number;
  // S1 LLM rewrite seam. When omitted, L2 recall degrades to single-query mode (fail-open).
  llmRewriteFn?: LlmRewriteFn;
}

// ConsolidationState — pure, serializable type for MCP stateless mode.
// version field serves as CAS guard for saveAnchor UPSERT (fast.io optimistic locking).
export interface ConsolidationState {
  version: number;
  consecutiveReuses: number;
  lastSummaryMsgCount: number;
}

// ConsolidateResult — pure function output (decision + optional summaryRequest).
export interface ConsolidateResult {
  state: ConsolidationState;
  decision: "skip" | "reuse" | "compress";
  summaryRequest?: {
    gap: TaggedGap;
    prevSummary: string | undefined;
    msgCountAtTrigger: number;
  };
}

/**
 * #263 (D9): read the dependency list for a summary that is about to be written.
 *
 * Three outcomes, and the difference between the last two is the whole point:
 *
 * - `{ok: true, sources}` — the store read fine (possibly returning nothing,
 *   which is a legitimate "this summary used nothing addressable").
 * - `{ok: true, sources: []}` with no seams — the store has no provenance
 *   feature at all. Absence is not failure; the pre-#263 behaviour stands.
 * - `{ok: false}` — a seam EXISTS but threw. The dependency set is unknowable,
 *   so the caller must not write the summary: one stored with empty or partial
 *   dependencies would never be suspended when a fact it used is corrected,
 *   and with no rebuild yet the replaced fact keeps being injected.
 *
 * Kept as a standalone function so this contract is testable without the real
 * summarizer (a SDK import the repo's tests document as un-mockable).
 *
 * @param store - Session store, possibly without the provenance seams.
 * @param req.gapUrls - URLs the new material arrived under, resolved by the store.
 * @param req.gapReads - The gap's reads WITH their archive row ids, when the
 *   search path recorded them. Preferred over `gapUrls`: two rows can share one
 *   URL, so only the id says which version the summary read. Falls back to
 *   `gapUrls` when the store has no read-based seam or none of the reads
 *   carries an id.
 * @param req.previousAnchorId - Previous summary anchor, whose dependencies the
 *   new summary inherits (it was generated from that summary).
 * @returns The sources, or `{ok: false}` when a read failed.
 */
export function readSummarySourcesForWrite(
  store: unknown,
  req: {
    gapUrls: Array<string | null | undefined>;
    // #263: the gap's reads with their archive row ids when the search path
    // recorded them (see resolveSummarySourcesFromReads). Takes precedence over
    // `gapUrls` so one URL's older row cannot be attributed to a summary that
    // read the newer one.
    gapReads?: Array<{ url: string; rowId?: number | null } | null | undefined>;
    // Anchors whose dependencies the new summary inherits. More than one
    // because the summarizer can read BOTH the previous rolling summary and a
    // `[Research Recall]` block still present in the reused history.
    previousAnchorIds?: number[];
    /** @deprecated single-anchor form, kept for existing call sites/tests. */
    previousAnchorId?: number;
  },
): { ok: true; sources: Array<{ kind: "material" | "knowledge"; id: number }> } | { ok: false } {
  const s = store as {
    resolveSummarySources?: (urls: string[]) => unknown;
    resolveSummarySourcesFromReads?: (reads: Array<{ url: string; rowId?: number | null }>) => unknown;
    summarySourcesForAnchor?: (anchorId: number) => unknown;
  };
  const hasResolve = typeof s?.resolveSummarySources === "function";
  const hasReads = typeof s?.resolveSummarySourcesFromReads === "function";
  const hasInherit = typeof s?.summarySourcesForAnchor === "function";
  const inheritIds = [
    ...(req.previousAnchorIds ?? []),
    ...(req.previousAnchorId !== undefined ? [req.previousAnchorId] : []),
  ].filter((id): id is number => typeof id === "number" && Number.isInteger(id) && id > 0);
  if (!hasResolve && !hasReads && !(hasInherit && inheritIds.length > 0)) {
    return { ok: true, sources: [] };
  }
  const sources: Array<{ kind: "material" | "knowledge"; id: number }> = [];
  try {
    // Exact form first: a read that carries its archive row pins the version the
    // summary saw. Without it a URL with a retired predecessor AND a live
    // successor would record both, and the write-time currency check would
    // suspend a summary built entirely from the live one.
    //
    // A read with a usable row id is kept even when its URL is empty: the id IS
    // the dependency, and dropping the read here — before the resolver sees it —
    // would silently lose it (a summary stored as valid that a later correction
    // could never find).
    //
    // Normalized to `{url: string, rowId}`: an id-only read legitimately has no
    // URL, and `""` is how "no URL" is spelled for the store.
    const reads: Array<{ url: string; rowId: number | null }> = [];
    for (const r of req.gapReads ?? []) {
      if (!r) continue;
      const rowId = (r as { rowId?: unknown }).rowId;
      const hasRowId = typeof rowId === "number" && Number.isInteger(rowId) && rowId > 0;
      const url = typeof r.url === "string" ? r.url : "";
      if (!hasRowId && url.length === 0) continue;
      reads.push({ url, rowId: hasRowId ? (rowId as number) : null });
    }
    if (hasReads && reads.length > 0) {
      sources.push(...((s.resolveSummarySourcesFromReads!(reads) ?? []) as typeof sources));
    } else if (hasResolve) {
      const urls = (req.gapUrls ?? []).filter((u): u is string => typeof u === "string" && u.length > 0);
      sources.push(...((s.resolveSummarySources!(urls) ?? []) as typeof sources));
    }
    if (hasInherit) {
      for (const id of inheritIds) {
        sources.push(...((s.summarySourcesForAnchor!(id) ?? []) as typeof sources));
      }
    }
  } catch {
    return { ok: false };
  }
  return { ok: true, sources };
}

// #263 (D9): the row ids a tool result cited, from a `recall_memory` payload.
//
// `distillGap` only reads `search` results, and that is correct: the gap text is
// built from search snippets for the summarizer. But the summarizer also sees
// the FULL message list, so a `recall_memory` result can end up in the summary
// body. A recall hit carries no URL, so it can never be bound to a dependency
// through `resolveSummarySources`; what it does carry (since #263) is the
// archive row id in `internal[].rowid`. Collecting those ids here is what lets
// the summary record "I read this row too" — without it, correcting that row
// would never suspend the summary, and the replaced text would keep being
// injected.
//
// Positive rowid = archive material, negative = knowledge row (SessionStore's
// semantic arm). Unknown/absent rowids contribute nothing.
export function collectRecallSourceRefs(
  messages: any[],
  fromIdx: number,
): Array<{ kind: "material" | "knowledge"; id: number }> {
  const out: Array<{ kind: "material" | "knowledge"; id: number }> = [];
  const seen = new Set<string>();
  for (const msg of messages.slice(Math.max(0, fromIdx))) {
    if (msg?.role !== "tool" && msg?.role !== "toolResult") continue;
    const toolName = msg.toolName || msg.name || "";
    if (typeof toolName !== "string" || !toolName.includes("recall_memory")) continue;
    const raw = typeof msg.content === "string"
      ? msg.content
      : Array.isArray(msg.content)
        ? msg.content.map((c: any) => c?.text || "").join("")
        : "";
    if (!raw) continue;
    let parsed: any;
    try { parsed = JSON.parse(raw); } catch { continue; }
    const internal = parsed?.internal;
    if (!Array.isArray(internal)) continue;
    for (const hit of internal) {
      const rowid = Number(hit?.rowid);
      if (!Number.isInteger(rowid) || rowid === 0) continue;
      const ref = rowid > 0
        ? { kind: "material" as const, id: rowid }
        : { kind: "knowledge" as const, id: Math.abs(rowid) };
      const key = ref.kind + ":" + ref.id;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(ref);
    }
  }
  return out;
}

// #263: the summarizer reads the whole message list, so dependency scanning for
// recall hits starts at the beginning too. Exported so a test can pin the
// wiring: a window of `messages.length` (what `summaryRequest.msgCountAtTrigger`
// carries) would be empty and silently record nothing.
// #263: the dependency scan must start where the SUMMARIZER starts, which is the
// beginning of the message list. A later start (the current gap only) loses the
// dependencies of facts an overlapping earlier compression put into the same
// message list. Named so the call site's value is testable, not just implied.
export const SOURCE_SCAN_FROM_INDEX = 0;

export const RECALL_SOURCE_SCAN_FROM = 0;

// #263: the dependency scan and the summarizer call must read the SAME message
// membership. The caller hands in the live agent-state array and two `await`s
// separate the scan from the model call, so an append in that window would give
// the summary a fact its sources never saw. A shallow copy pins membership
// without copying message contents. Exported so the "is it a copy" contract is
// assertable: the real summarizer is an un-mockable SDK import.
export function snapshotMessages(messages: any[]): any[] {
  return messages.slice();
}

/**
 * #263: which stored summary anchors the message list ACTUALLY carries.
 *
 * The gate for inheriting dependencies, done exactly instead of by "newest
 * anchor wins". Injection renders each anchor to one exact string (see `inject`),
 * so an anchor whose rendered block appears in the history is an anchor whose
 * text the summarizer will read — whatever its age, and regardless of whether a
 * newer anchor exists.
 *
 * Both wrong answers the guessing version produced are closed here:
 * - no block for the newest anchor but an OLDER block present: the older
 *   anchor's dependencies are inherited (guessing the newest would record a
 *   dependency the summary never read AND miss the one it did);
 * - no block at all: nothing is inherited. A block that matches no stored
 *   anchor of this session (a caller passing another session's history) also
 *   inherits nothing — its sources are unknowable, and inventing them would
 *   suspend an unrelated summary later.
 *
 * @param messages - The snapshot the summarizer will receive.
 * @param anchors - This session's anchors (already read by the caller).
 * @returns Anchor ids whose rendered block is present.
 */
export function injectedSummaryAnchorIds(messages: any[], anchors: Array<{ id: number; anchorType: string; payload: unknown }>): number[] {
  const texts: string[] = [];
  for (const m of messages ?? []) {
    const t = readMessageText(m)?.text;
    if (t) texts.push(t);
  }
  if (texts.length === 0) return [];
  const out: number[] = [];
  for (const anchor of anchors ?? []) {
    if (anchor?.anchorType !== "rolling_summary" && anchor?.anchorType !== "l2_recall") continue;
    const payload = anchor.payload as any;
    // Same truncation as injection, so the compared string IS the injected one.
    const body = anchor.anchorType === "rolling_summary" ? payload?.summary : payload?.hits;
    if (typeof body !== "string" || body.length === 0) continue;
    const block = anchor.anchorType === "rolling_summary"
      ? SESSION_MEMORY_TAG + " " + body.slice(0, SUMMARY_INJECT_MAX_CHARS)
      : RESEARCH_RECALL_TAG + " " + body.slice(0, RECALL_INJECT_MAX_CHARS);
    const marker = BLANK_LINE_BEFORE_BLOCK + block;
    if (texts.some((t) => carriesBlock(t, marker))) out.push(anchor.id);
  }
  return out;
}

/**
 * #263: does this text carry the WHOLE block, ending at a block boundary?
 *
 * A plain `includes(marker)` is not enough: one summary's text can be the
 * prefix of another's ("shared wording" vs "shared wording plus more"), and
 * then a history carrying only the LONGER block matches the shorter anchor too.
 * The new summary would inherit a dependency it never read, and a later
 * correction of that row would suspend it.
 *
 * Injection puts every block after a blank line and joins blocks with a blank
 * line, so a block is real when what follows its text is either the end of the
 * message or the next blank-line separator. Text that continues (a longer
 * summary of the same prefix) is a different block, not this one.
 *
 * @param text - One message's text.
 * @param marker - The blank line plus the rendered block.
 */
function carriesBlock(text: string, marker: string): boolean {
  let at = text.indexOf(marker);
  while (at >= 0) {
    const after = text.slice(at + marker.length);
    if (after.length === 0 || after.startsWith(BLANK_LINE_BEFORE_BLOCK)) return true;
    at = text.indexOf(marker, at + 1);
  }
  return false;
}

/**
 * #263: the anchor ids a NEW summary inherits its dependencies from.
 *
 * The one place this decision is made, so the call site and the test cannot
 * disagree: a second copy of the rule (here and at the call site) is exactly how
 * the "newest anchor wins" version survived a test that only drove the helper.
 *
 * Two sources, and only these:
 * - the previous rolling summary's anchor: `previousSummary` is passed to the
 *   generator as its own argument, so that text is read regardless of what the
 *   message list contains.
 * - every summary anchor whose RENDERED block the history really carries (see
 *   injectedSummaryAnchorIds). This is what makes an older recall block count
 *   while a newer anchor the history never saw does not.
 *
 * @param messages - The snapshot the summarizer will receive.
 * @param anchors - This session's anchors.
 * @param previousSummaryAnchorId - The anchor behind `previousSummary`, if any.
 * @returns Valid, deduplicated anchor ids.
 */
export function summaryAnchorsToInherit(
  messages: any[],
  anchors: Array<{ id: number; anchorType: string; payload: unknown }>,
  previousSummaryAnchorId: number | undefined,
): number[] {
  const ids: number[] = [];
  const add = (id: unknown): void => {
    if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) return;
    if (!ids.includes(id)) ids.push(id);
  };
  add(previousSummaryAnchorId);
  for (const id of injectedSummaryAnchorIds(messages, anchors)) add(id);
  return ids;
}

// gap distillation returns a tagged object, never a bare string.
export function distillGap(messages: any[], fromIdx: number): TaggedGap {
  const gap = messages.slice(fromIdx);
  const results: TaggedGap["results"] = [];
  let label: SourceTraceLabel = { source: "retrieved", traceId: "gap" };
  for (const msg of gap) {
    // pi-agent-core 1.5.1 appends a separate toolResult message; older shapes
    // used a role:"tool" message. Accept both so gap distillation survives the
    // SDK upgrade.
    if (msg.role !== "tool" && msg.role !== "toolResult") continue;
    const toolName = msg.toolName || msg.name || "";
    if (typeof toolName !== "string" || !toolName.includes("search")) continue;
    const raw = typeof msg.content === "string"
      ? msg.content
      : Array.isArray(msg.content)
        ? msg.content.map((c: any) => c?.text || "").join("")
        : JSON.stringify(msg.content || "");
    if (!raw) continue;
    let parsed: any;
    try { parsed = JSON.parse(raw); } catch { parsed = null; }
    parsed = unwrapRetrieved(parsed) ?? parsed;
    const envelope = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : { schema: null, results: [] };
    const items: any[] = Array.isArray(envelope?.results) && envelope.results.length > 0
      ? envelope.results
      : [{ url: "", title: "", snippet: raw, source: "retrieved" }];
    for (const item of items) {
      const traceId = typeof (item?.label?.traceId) === "string" && item.label.traceId
        ? item.label.traceId
        : "gap-" + results.length;
      const itemLabel = combineLabels(label, {
        source: item?.label?.source === "system" || item?.label?.source === "user" || item?.label?.source === "tool" || item?.label?.source === "memory"
          ? item.label.source
          : "retrieved",
        traceId,
      });
      const rowId = Number(item?.archiveRowId);
      results.push({
        url: typeof item?.url === "string" ? item.url : "",
        title: typeof item?.title === "string" ? item.title : "",
        snippet: typeof item?.snippet === "string" ? item.snippet : String(raw).slice(0, 4000),
        source: typeof item?.source === "string" ? item.source : "retrieved",
        label: itemLabel,
        // #263: carried through when the search path recorded it. Absent on an
        // older transcript or a store without the seam — the URL bridge then
        // applies, which is why this stays optional rather than defaulted.
        ...(Number.isInteger(rowId) && rowId > 0 ? { archiveRowId: rowId } : {}),
      });
      label = combineLabels(label, itemLabel);
    }
  }
  const text = results.map((r) => r.snippet).join("\n\n").slice(0, 4000);
  return { text, results, source: label.source, traceId: label.traceId };
}

// NOOP adjudication — LLM decides REUSE vs COMPRESS.
// The call's own spend comes back with the decision: it is a separate book
// from the summary calls (D4 重判), so neither ledger inflates the other.
//
// Merge note (#272 -> #261): main briefly booked this call into the SUMMARY
// ledger through an `onUsage` callback, and said in its own commit message that
// the real home was #261. This is that home, so the callback form is dropped
// rather than carried alongside the returned usage — two ways to book the same
// call would double count it.
export async function adjudicateReuseCompress(
  streamFn: any,
  model: any,
  gapDistillation: string,
  existingSummary: string | undefined,
  signal?: AbortSignal,
): Promise<{ decision: "reuse" | "compress"; usage?: unknown }> {
  const prompt = [
    "You are a memory adjudicator for a research agent.",
    "Decide if the new search results are already fully covered by the existing rolling summary.",
    "",
    "The rolling summary has 5 sections: Verified Evidence, Open Hypotheses, Rejected Sources, Key Numbers & Sources, Tool Calls & Read Status.",
    "Check each section: is the new information already present?",
    "",
    "If ALL new information is already covered -> respond: reuse",
    "If ANY new information is NOT covered -> respond: compress",
    "",
    "=== Existing rolling summary ===",
    existingSummary || "(empty - no prior summary)",
    "",
    "=== New Search Results (gap) ===",
    gapDistillation || "(no new results)",
  ].join("\n");

  const context = {
    systemPrompt: prompt,
    messages: [{ role: "user", content: "Respond with exactly 'reuse' or 'compress'." }],
  };

  let text = "";
  let usage: unknown;
  try {
    const stream = streamFn(model, context, signal ? { signal } : {});
    for await (const event of stream) {
      // 1.5.1 streams text as text_delta.delta; the monolithic "text" event was
      // the pre-upgrade shape.
      if (event?.type === "text_delta" && typeof event.delta === "string") text += event.delta;
      else if (event?.type === "text" && event.text) text += event.text;
      // Both terminal shapes carry spend: `done` holds the successful turn's
      // usage, and pi-ai 1.5.x reports a FAILED turn on an `error` event
      // instead of throwing — reading only `done` would drop that spend from
      // the adjudication book (D4: nothing hidden).
      else if (event?.type === "done" && event.message) usage = event.message.usage;
      else if (event?.type === "error" && event.error?.usage) usage = event.error.usage;
    }
  } catch {
    return { decision: "compress", usage }; // D10: fail-open.
  }

  const lower = text.toLowerCase().trim();
  if (lower.includes("reuse")) return { decision: "reuse", usage };
  return { decision: "compress", usage }; // D10: unparseable -> COMPRESS.
}

// PURE consolidateState function — zero I/O, zero side effects.
// Returns decision + optional summaryRequest. Shell executes LLM + persistence.
// options injectable; defaults 128000 / 3 preserve zero-behavior-change.
export interface ConsolidateOpts {
  /** Absolute token count OR {fraction} of the model context window (#113). */
  lowWatermark?: number | { fraction: number };
  /** Model context window (LlmSession.contextWindow, REAL value) used to resolve {fraction}. */
  contextWindow?: number;
  reuseCap?: number;
}

// #113: absolute fallback when the model's context window is unknown (custom
// endpoints without metadata, non-catalog models). Kept at the historical
// value so unknown-window behaviour does not move.
export const FALLBACK_LOW_WATERMARK_TOKENS = 128_000;

// #113: resolve the TOML compaction.lowWatermark shape to an absolute token
// count. `{fraction}` is a share of the REAL model context window
// (LlmSession.contextWindow; the pi-ai catalog value for catalog models, or the
// explicit custom-endpoint value); an unknown/non-positive window falls back to
// FALLBACK_LOW_WATERMARK_TOKENS. A malformed shape throws — the "never silently
// fall back on a malformed shape" rule from decision #91 still holds (domain
// validation normally catches it first; this is the deep-module backstop).
export function resolveLowWatermark(
  lowWatermark: number | { fraction: number } | undefined,
  contextWindow: number | undefined,
): number {
  if (lowWatermark === undefined) return FALLBACK_LOW_WATERMARK_TOKENS;
  if (typeof lowWatermark === "number") {
    if (!Number.isFinite(lowWatermark) || lowWatermark <= 0) {
      throw new Error("MemoryPipeline: compaction.lowWatermark must be a finite positive token count");
    }
    return lowWatermark;
  }
  const fraction = (lowWatermark as { fraction?: unknown } | null)?.fraction;
  if (typeof fraction !== "number" || !Number.isFinite(fraction) || !(fraction > 0 && fraction < 1)) {
    throw new Error("MemoryPipeline: compaction.lowWatermark.fraction must be a finite number in (0,1)");
  }
  const window = Number(contextWindow);
  if (!Number.isFinite(window) || window <= 0) return FALLBACK_LOW_WATERMARK_TOKENS;
  // Floor keeps the trigger conservative (never later than the exact fraction);
  // max(1) avoids a degenerate zero watermark on a pathological tiny window.
  return Math.max(1, Math.floor(fraction * window));
}

export function consolidateState(
  state: ConsolidationState,
  messages: any[],
  totalTokens: number,
  hasRetrievalEvidence: boolean,
  opts?: ConsolidateOpts,
): ConsolidateResult {
  const LOW_WATERMARK_TOKENS = resolveLowWatermark(opts?.lowWatermark, opts?.contextWindow);
  const REUSE_CAP = opts?.reuseCap ?? 3;
  const msgCountAtTrigger = messages.length; // local const for race-safe gap anchor update.

  // #113 ruling (issue comment, 2026-11-03): the watermark compares CURRENT
  // context occupancy — `max(lastUsage, estimateContextTokens(messages))`
  // computed by pi-runtime — not cumulative run spend (#90 keeps usage as the
  // metering source; the trailing estimate only covers messages appended after
  // the last provider call). This closes the one-turn lag after a large tool
  // result, which `lastTotalTokens` alone would miss (CodeRabbit review on
  // PR #114).
  const triggerLowWatermark = totalTokens > LOW_WATERMARK_TOKENS;
  const triggerPostSearch = hasRetrievalEvidence && messages.length > 4;

  if (!triggerLowWatermark && !triggerPostSearch) {
    return { state, decision: "skip" };
  }

  // D8: consecutive REUSE cap forces COMPRESS.
  const reuseCapped = state.consecutiveReuses >= REUSE_CAP;
  const shouldAdjudicate = triggerPostSearch && !triggerLowWatermark;
  const needsAdjudication = shouldAdjudicate && !reuseCapped;

  if (needsAdjudication) {
    // Adjudication path: return reuse decision (shell will call adjudicateRetryCompress).
    // If adjudication says compress, shell calls fireCompress.
    // For pure function: return "reuse" with summaryRequest for shell to adjudicate.
    // ponytail: adjudication is async I/O (LLM call) so it stays in shell.
    // Pure function returns the pre-adjudication state; shell handles the LLM call.
    return {
      state: { ...state, consecutiveReuses: state.consecutiveReuses + 1 },
      decision: "reuse", // tentative — shell may override to compress after adjudication
      summaryRequest: {
        gap: distillGap(messages, state.lastSummaryMsgCount),
        prevSummary: undefined, // shell fills from anchor
        msgCountAtTrigger,
      },
    };
  }

  // Direct compress path (low watermark or reuse-capped).
  return {
    state: { version: state.version, consecutiveReuses: 0, lastSummaryMsgCount: msgCountAtTrigger },
    decision: "compress",
    summaryRequest: {
      gap: distillGap(messages, state.lastSummaryMsgCount),
      prevSummary: undefined, // shell fills from anchor
      msgCountAtTrigger,
    },
  };
}

// Injection tags written by Stage-1/Stage-2, and the T0 closing tag. `ragQuery`
// must not search them: #131 requires the PRE-INJECTION latest user text, so a
// retried/resumed inject() that re-reads its own output has to strip what an
// earlier pass appended before truncating to RAG_QUERY_MAX_CHARS.
const SESSION_MEMORY_TAG = "[Session Memory]";
const RESEARCH_RECALL_TAG = "[Research Recall]";
const INJECTION_TAGS = [RAG_CONTEXT_TAG, RECOVERY_DIGEST_TAG, SESSION_MEMORY_TAG, RESEARCH_RECALL_TAG] as const;
const PREFS_OPEN_TAG = "<user_preferences";
const PREFS_CLOSE_TAG = "</user_preferences>";
// The separator inject() puts before each injected block (a blank line). Named
// once so the write side and the strip side cannot disagree about it.
const BLANK_LINE_BEFORE_BLOCK = String.fromCharCode(10, 10);
// #263: how much of each summary body injection renders. Named constants because
// three places must agree: the render itself, the provenance key used to strip a
// stale block, and the WRITE side that decides which recall hits count as
// sources. When they drift the write side records a hit whose text no prompt
// ever carried, and a later correction then suspends a recall block that never
// used it.
const SUMMARY_INJECT_MAX_CHARS = 4000;
const RECALL_INJECT_MAX_CHARS = 1500;

/**
 * Remove previously injected summary blocks from one message.
 *
 * #263: the runtime cannot assume the caller starts from a clean history. A
 * caller that hands back the array a previous `inject()` returned gets its old
 * `[Session Memory]` / `[Research Recall]` blocks back, and those may state a
 * fact a correction has since replaced. Skipping the new append is not enough
 * then; the stale text has to leave the prompt.
 *
 * What may be removed is decided by PROVENANCE, not by a tag prefix: `known`
 * holds the exact block strings this pipeline wrote (or that the store records
 * as its own summaries). A user or assistant sentence that merely mentions
 * `[Session Memory]` never equals one of those strings, so it survives — a
 * prefix rule would have deleted exactly the text the reviewer flagged.
 *
 * Matching whole strings also fixes the multi-paragraph case: a summary body
 * containing a blank line is still one block, and splitting on "\n\n" (the
 * earlier approach) mistook its second paragraph for foreign content.
 *
 * @param message - Any message from the array being injected into.
 * @param known - Exact block strings this pipeline may remove.
 * @returns The message without those blocks, or the original message.
 */
function stripSummaryBlocks(message: any, known: Set<string>): any {
  if (known.size === 0) return message;
  if (!Array.isArray(message?.content)) {
    // String content: one text channel, so the whole-string removal applies.
    const target = readMessageText(message);
    if (!target) return message;
    const text = removeKnownBlocks(target.text, known);
    return text === target.text ? message : writeMessageText(message, text, target) ?? message;
  }
  // Block array: remove per TEXT BLOCK, in place. Operating on the joined text
  // and then writing it back into one block is what reordered interleaved
  // content: a caller may append its own text block after the injected one
  // ("question + summary", image, "more text"), so the summary is not
  // necessarily in the LAST block, and the text around it belongs to other
  // blocks. Each block keeps its own text and its own position.
  let changed = false;
  const blocks: any[] = [];
  for (const block of message.content) {
    if (block && typeof block === "object" && (block as any).type === "text" && typeof (block as any).text === "string") {
      const before = (block as any).text as string;
      const after = removeKnownBlocks(before, known);
      if (after !== before) {
        changed = true;
        blocks.push({ ...block, text: after });
        continue;
      }
    }
    blocks.push(block);
  }
  return changed ? { ...message, content: blocks } : message;
}

/**
 * Remove every known block string from one text channel.
 *
 * Longest first: two summaries can share a prefix (an older short version and a
 * newer one that extends it), and removing the short one first would cut that
 * prefix out of the longer one so it could never match — leaving exactly the
 * stale line the removal exists to delete.
 *
 * @param text - The text channel of one block.
 * @param known - Exact block strings the pipeline may remove.
 * @returns The text with those blocks deleted; unchanged when none matched.
 */
function removeKnownBlocks(text: string, known: Set<string>): string {
  let out = text;
  const ordered = [...known].filter((b) => b.length > 0).sort((a, b) => b.length - a.length);
  for (const block of ordered) {
    // The block was appended after a blank line (see inject()); removing the
    // separator with it keeps the field from leaving a run of blank lines behind.
    const withSeparator = BLANK_LINE_BEFORE_BLOCK + block;
    let at = out.indexOf(withSeparator);
    while (at >= 0) {
      out = out.slice(0, at) + out.slice(at + withSeparator.length);
      at = out.indexOf(withSeparator);
    }
    // A block sitting at the very start of the channel has no separator before it.
    if (out.startsWith(block)) out = out.slice(block.length);
  }
  return out;
}

/**
 * Replace the text of the block that carried the removed summary, keeping
 * every other block exactly where it was.
 *
 * The summary is always appended into the LAST text block (see inject()), so
 * that block is the one whose tail was removed. Rewriting it in place and
 * leaving the other text blocks alone keeps "text A, image A, text B, image B"
 * in that order — collapsing all text into the first block (an earlier version)
 * moved the caption of image B ahead of image A, so a model could pair the
 * wrong caption with the wrong image.
 *
 * The updated message is `{ ...message, content: blocks }`, or null when the
 * shape cannot be preserved (caller leaves the message untouched).
 *
 * @param message - Message whose text changed.
 * @param text - The full text channel after the removal.
 * @param target - Shape descriptor from {@link readMessageText}.
 */
function writeMessageText(message: any, text: string, target: { kind: "string" | "blocks" }): any | null {
  if (target.kind === "string") return { ...message, content: text };
  // A block array reaching here means the caller is replacing the whole text
  // channel (string-shaped removal only), so the text lands in the last text
  // block and the other blocks keep their order.
  if (!Array.isArray(message?.content)) return null;
  let lastTextIdx = -1;
  for (let i = message.content.length - 1; i >= 0; i--) {
    const block = message.content[i];
    if (block && typeof block === "object" && (block as any).type === "text") { lastTextIdx = i; break; }
  }
  if (lastTextIdx < 0) return null;
  const blocks = message.content.map((block: any, i: number) =>
    i === lastTextIdx ? { ...block, text } : block);
  return { ...message, content: blocks };
}

/**
 * Recover the user's own text from a message that may already carry injections.
 *
 * @param text - Current text channel of the target user message.
 * @returns The pre-injection original; an unmarked text is returned verbatim
 *   (no trimming), so a normal turn's whitespace is untouched.
 */
function preInjectionQueryText(text: string): string {
  let body = text;
  let stripped = false;
  // T0 only ever lands as a leading block; require that shape so a quotation
  // of the closing tag inside the user's own text is not mistaken for it.
  if (body.startsWith(PREFS_OPEN_TAG)) {
    const prefsEnd = body.indexOf(PREFS_CLOSE_TAG);
    if (prefsEnd >= 0) {
      body = body.slice(prefsEnd + PREFS_CLOSE_TAG.length);
      stripped = true;
    }
  }
  // Injected blocks are always appended after a blank line; matching the
  // separator avoids truncating a question that merely mentions a tag.
  let cut = -1;
  for (const tag of INJECTION_TAGS) {
    const at = body.indexOf("\n\n" + tag);
    if (at >= 0 && (cut < 0 || at < cut)) cut = at;
  }
  if (cut >= 0) {
    body = body.slice(0, cut);
    stripped = true;
  }
  return stripped ? body.trim() : text;
}

/**
 * Last anchor of one type, in append order.
 *
 * The store returns anchors oldest-first; callers always want the newest of a
 * type. Keeping the scan in one place avoids four near-copies of the
 * filter-plus-last idiom drifting apart.
 */
function lastAnchorOfType<T extends { anchorType: string }>(anchors: T[], anchorType: string): T | undefined {
  let found: T | undefined;
  for (const anchor of anchors) if (anchor.anchorType === anchorType) found = anchor;
  return found;
}

export class MemoryPipeline {
  private deps: MemoryPipelineDeps;
  // rag adapter registry (#35): domain.rag.adapter -> adapter, resolved per
  // domain object and cached, so the hot path pays no re-resolution. The
  // session store is handed in because the "fts" adapter recalls from it.
  private readonly rag: RagAdapterRegistry;

  // ConsolidationState — in-memory cache (CLI fast path).
  // MCP mode restores from anchor per call (saveAnchor persistence).
  private consolidationState: ConsolidationState = {
    version: 1,
    consecutiveReuses: 0,
    lastSummaryMsgCount: 0,
  };

  // Design: capture the recovery digest from the first successful anchor read
  // of this runtime and keep one copy in each model prompt. The capture happens
  // before the first model call, so this runtime's own searches cannot
  // masquerade as a recovered record; a fresh session has no resume anchor
  // and injects nothing. Keeping one copy per prompt matters because
  // transformContext output is not written back into agent history: a strict
  // first-call-only gate would drop the digest after a tool call.
  private recoveryDigest?: string;
  private recoveryDigestResolved = false;
  private recoveryDigestInjected = false;

  // Background anchor writes started by consolidate(). summarization, adjudication
  // and L2 recall are fire-and-forget by design (they must not block a turn), but
  // the caller that owns the store can then close it while a write is still in
  // flight, losing the anchor and swallowing the failure. flush() lets that owner
  // drain them first.
  private readonly pendingWrites = new Set<Promise<unknown>>();

  // #263: the exact summary/recall block strings this runtime appended, so a
  // later turn that receives its own output back can remove those blocks without
  // guessing by tag. Kept across turns (a history may be reused many turns
  // later); bounded because a session only ever injects a handful of distinct
  // blocks before the snapshot replaces them.
  private readonly injectedSummaryBlocks = new Set<string>();

  // Usage of the pipeline's own summary requests, kept apart from the main run
  // so the caller can report both without double counting. Same ledger type as
  // the run, so cost provenance follows the same rule.
  private summaryUsage = emptyUsageTotals();
  // D4: the reuse/compress adjudication calls are a separate book from the
  // summary calls. Both are the pipeline's own spend, but one adjudication
  // must not read as a summary the summarizer never made.
  private adjudicationUsage = emptyUsageTotals();

  // #264 (D9): which suspended anchors this runtime already tried to rebuild.
  // One attempt per anchor, not per turn: a rebuild that failed on a fact the
  // archive genuinely lacks must not re-spend a model call on every later turn.
  // Keyed by anchor id, so a NEW suspension (a later correction of another fact)
  // still gets its own attempt.
  //
  // `rebuildStarted` is added SYNCHRONOUSLY at dispatch time; `rebuildAttempts`
  // only holds finished results. Two guards, because the turn that dispatches the
  // background call must not dispatch a second one while the first is still
  // waiting on the provider.
  private readonly rebuildStarted = new Set<number>();
  private readonly rebuildAttempts = new Map<number, SummaryRebuildAttempt>();

  constructor(deps: MemoryPipelineDeps) {
    this.deps = { ...deps, streamFn: ensureResult(deps.streamFn) };
    this.rag = new RagAdapterRegistry({ store: deps.store });
  }

  /** Summary-call accounting for this runtime (never zero-filled). */
  getSummaryUsage(): SummaryUsage {
    return toSummaryUsage(this.summaryUsage, this.adjudicationUsage);
  }

  /**
   * #264 (D9): the rebuild attempts this runtime made, newest anchor last.
   *
   * Reported next to the run summary so a caller can see that a suspended
   * summary came back, or why it did not — "the hole is still there" is
   * something a caller must be told, never left to infer from silence.
   */
  getSummaryRebuilds(): SummaryRebuildAttempt[] {
    return [...this.rebuildAttempts.values()];
  }

  /** Does the store expose the rebuild seams at all? */
  private hasRebuildSeam(): boolean {
    const probe = this.deps.store as unknown as { planSummaryRebuild?: unknown; writeRebuiltSummaryAnchor?: unknown };
    return typeof probe?.planSummaryRebuild === "function" && typeof probe?.writeRebuiltSummaryAnchor === "function";
  }

  /**
   * Attempt one rebuild of a suspended summary, at most once per anchor.
   *
   * `rebuildStarted` is filled by the caller (`inject`) BEFORE this runs, so a
   * second turn arriving while the model call is still in flight cannot start a
   * duplicate attempt.
   *
   * Fail-open: a rebuild fault must not break the turn. A thrown plan read is
   * recorded as `incomplete` with the message, so the caller still learns that
   * the summary did not come back.
   *
   * @param sessionId - Session owning the summary.
   * @param anchorId - The suspended anchor.
   */
  private async maybeRebuildSummary(sessionId: string, anchorId: number): Promise<SummaryRebuildAttempt | undefined> {
    const existing = this.rebuildAttempts.get(anchorId);
    if (existing) return existing;
    // No store seam at all: nothing to plan against. Recording "incomplete" here
    // would claim an attempt the store never saw, so this returns undefined and
    // the injection path keeps its pre-#264 behaviour.
    if (!this.hasRebuildSeam()) return undefined;
    let attempt: SummaryRebuildAttempt;
    let called = false;
    try {
      const apiKey = await this.deps.getApiKey?.();
      // A rebuild that got past the plan makes exactly one model call, whether or
      // not the provider answers with usage. `called` is what lets the ledger
      // count it even then — the same rule #273 applied to adjudication: a sent
      // call that reports nothing is a call with UNKNOWN tokens, not a free one.
      called = typeof this.deps.streamFn === "function" && !!this.deps.model;
      attempt = await rebuildSuspendedSummary(this.deps.store, {
        sessionId,
        anchorId,
        streamFn: this.deps.streamFn as any,
        model: this.deps.model,
        // Same hand-off as every peer kernel call: without it, a host that
        // configured the key outside ANS_LLM_API_KEY fails every rebuild on auth.
        ...(apiKey ? { apiKey } : {}),
        // Same bound as the other background summary work: flush() waits for this
        // write before the store closes, so an unbounded provider stall would hold
        // the CLI open until the provider timed out.
        signal: AbortSignal.timeout(BACKGROUND_SUMMARY_TIMEOUT_MS),
      });
      // A plan that was not complete (or a store without the seam) never reached
      // the model, so it must not be counted as a billed call.
      if (attempt.outcome === "incomplete" || attempt.outcome === "no-model") called = false;
    } catch (e) {
      attempt = {
        anchorId,
        outcome: "incomplete",
        reasons: ["the rebuild could not run (" + (e instanceof Error ? e.message : String(e)) + ")"],
        newAnchorId: null,
        cleared: false,
      };
      called = false;
    }
    this.rebuildAttempts.set(anchorId, attempt);
    if (attempt.usage) {
      // The rebuild is a real provider call on this session's behalf, so it books
      // to the same summary ledger the run reports (D4: nothing hidden outside
      // the main call).
      accumulateUsage(this.summaryUsage, { role: "assistant", usage: attempt.usage });
    } else if (called) {
      // Sent but no usage block came back: count the call and say the tokens are
      // unknown. Leaving it out entirely would let a silent provider hide the
      // call from the cost report, which is the failure #273 fixed for
      // adjudication.
      this.summaryUsage.assistantCalls += 1;
      this.summaryUsage.callsWithoutUsage = (this.summaryUsage.callsWithoutUsage ?? 0) + 1;
    }
    if (!attempt.cleared) {
      // stderr, not stdout: the host protocols own stdout. The caller also sees
      // it in the result metadata, this line is for a person reading a log.
      try {
        process.stderr.write(
          "[anysearch] summary rebuild for anchor " + anchorId + " did not complete: " +
            attempt.reasons.join("; ") + "\n",
        );
      } catch { /* stderr unavailable */ }
    }
    return attempt;
  }

  /**
   * Build the injection payload for one turn — corresponds to treequery's
   * `transformContext` delegation.
   *
   * Stage-1 splits by volatility (#131, implemented by #154): static operator
   * text (`note`, and `none` + leftover `config.note`) appends to the *first*
   * user turn; query-driven adapters (`fts`) append to the *latest* user turn
   * (the end of the latest user turn) and query on that turn's pre-injection text. T0
   * prepends `<user_preferences>` to the *first* user turn. Stage-2 appends the
   * merged L1/L2 memory block to the *latest* user turn, after Stage-1.
   * All stages target user messages only, so a leading system/tool message
   * cannot swallow the payload. The input array is never mutated.
   *
   * @param messages - Conversation so far, in provider message shape.
   * @returns A new array carrying the turn's injections.
   */
  async inject(messages: any[]): Promise<any[]> {
    const { store, domain, sessionId } = this.deps;
    let result = messages;

    // Design: Stage-1 splits RAG placement by volatility (#131, implemented by
    // #154) — static operator text (`note`, and `none` + leftover `config.note`)
    // appends to the FIRST user message so the session prefix stays byte-stable
    // across turns and #104 AC2 holds byte-for-byte, while query-driven adapters
    // (`fts`, see DYNAMIC_RAG_ADAPTERS) append to the LATEST user message (the
    // end of that turn) and key `ragQuery` on that turn's PRE-INJECTION text
    // (first RAG_QUERY_MAX_CHARS). Rejected alternative (Option A): keeping
    // dynamic RAG on the first turn makes follow-up turns recall turn-1 evidence,
    // dilutes recency attention, and invalidates the KV cache prefix from
    // `messages[0]` whenever memory changes; moving static `note` to the latest
    // turn (Option B) breaks #104 AC2; moving L1/L2 to the first turn (Option C)
    // loses recency. Stage-1 runs before Stage-2 so one message reads `user text ->
    // [RAG Context] -> [Recovery Digest] -> [Session Memory] ->
    // [Research Recall]`; each tier is independently budgeted
    // (4000 / 600 / 4000 / 1500 chars).
    // Stage 1: RAG injection — static adapters target the first user message,
    // dynamic adapters the latest; a leading system/tool message never swallows it.
    // #35: the adapter is selected by domain.rag.adapter (none / note-legacy / fts);
    // unknown ids fail open to none with a named stderr warning inside the registry.
    // #104: pi-agent-core normalizes prompt("…") to content BLOCKS, so the seam is
    // shape-aware (message-text.ts) instead of string-only — a string-only read
    // either never fired or overwrote the user's message with the injected text.
    const firstUserIdx = result.findIndex((m: any) => m?.role === "user");
    // One scan, shared with Stage-2 below: replacing an element keeps its index.
    let lastUserIdx = -1;
    for (let i = result.length - 1; i >= 0; i--) if (result[i]?.role === "user") { lastUserIdx = i; break; }
    if (firstUserIdx >= 0) {
      // Resolve inside the guard (fail-open): registry build is the only throwing
      // seam, and a turn must not fail because adapter selection did.
      let dynamicRag = false;
      try {
        dynamicRag = isDynamicRagAdapter(this.rag.resolve(domain)?.id);
      } catch { dynamicRag = false; }
      const ragIdx = dynamicRag ? lastUserIdx : firstUserIdx;
      const ragTarget = ragIdx >= 0 ? readMessageText(result[ragIdx]) : null;
      if (ragTarget) {
        // `ragQuery` is the PRE-INJECTION latest user text: strip earlier T0 /
        // [RAG Context] / [Recovery Digest] / [Session Memory] /
        // [Research Recall] text so a retried or resumed array cannot pollute
        // the recall key, then cap for the strict FTS5 rung. `note` ignores the
        // query.
        const ragQuery = preInjectionQueryText(ragTarget.text).slice(0, RAG_QUERY_MAX_CHARS);
        // Fail-open: retrieval faults are the registry's to report; the agent loop
        // always continues with the un-injected messages.
        let ragInstruction = "";
        try {
          const injection = await this.rag.resolveInjection(domain, ragQuery, RAG_DEFAULT_LIMIT);
          if (injection && injection.block) ragInstruction = "\n\n" + injection.block;
        } catch { /* fail-open: never block a turn on RAG */ }
        if (ragInstruction) {
          // Shape-preserving write-back: blocks stay blocks, non-text blocks survive.
          const next = appendMessageText(result[ragIdx], ragInstruction, ragTarget);
          if (next) {
            result = [
              ...result.slice(0, ragIdx),
              next,
              ...result.slice(ragIdx + 1),
            ];
          }
        }
      }
    }

    // T0 user preferences injection — static slot (first user turn), identical
    // content/order. Idempotent: skip if first message already carries a
    // <user_preferences> block (transformContext may be invoked more than once
    // on retry/resume).
    try {
      // Re-read after Stage-1 (same shape rules): a static RAG block may have
      // landed on this turn.
      const t0Target = firstUserIdx >= 0 ? readMessageText(result[firstUserIdx]) : null;
      if (firstUserIdx >= 0 && t0Target) {
        const firstContent = t0Target.text;
        if (!firstContent.includes("<user_preferences")) {
          const prefs = await store.listPreferences(process.cwd());
          if (prefs.length > 0) {
            const lines = prefs.map(r => "- **" + r.key + "**: " + r.value);
            const block = "<user_preferences updated=\"" + (prefs[0].modified ?? "") + "\">\n" + lines.join("\n") + "\n</user_preferences>";
            // Preferences stay a PREFIX of the text channel (documented position).
            const next = prependMessageText(result[firstUserIdx], block + "\n\n", t0Target);
            if (next) result = [...result.slice(0, firstUserIdx), next, ...result.slice(firstUserIdx + 1)];
          }
        }
      }
    } catch {}

    // L1+L2 merged injection at latest user message (the end of that turn).
    try {
      const anchors = await store.getAnchors(sessionId);
      // Read side of the resume anchor (#189): capture the last anchor
      // once, before this runtime's first search can replace it.
      this.captureRecoveryDigest(anchors);
      // #263 (D9): a summary a correction made stale must not be injected as
      // the current conclusion. Its text stays stored (readable through
      // getAnchors) — only the injection slot is skipped, so the caller never
      // sees a replaced fact presented as current knowledge.
      //
      // The set is read per turn, not once per runtime: a correction may land
      // between two turns of the same session, and the second turn must already
      // respect it.
      // "The store has no suspension tracking" and "the read failed" must not
      // look the same. A store without the seam keeps the pre-#263 behaviour
      // (inject what it always injected). A read that THROWS is different: the
      // suspension state is unknown, and guessing "nothing is suspended" would
      // put a replaced fact back in the prompt — the exact failure this ticket
      // exists to stop. So the two summary slots are skipped for this turn.
      let suspended: Set<number> = new Set();
      let suspensionUnknown = false;
      const readSuspended = (store as unknown as SummarySuspensionPort).suspendedSummaryAnchorIds;
      if (typeof readSuspended === "function") {
        try {
          suspended = readSuspended.call(store, sessionId);
        } catch {
          suspensionUnknown = true;
        }
      }
      const summaryAnchor = lastAnchorOfType(anchors, "rolling_summary");
      const recallAnchor = lastAnchorOfType(anchors, "l2_recall");
      const summarySuspended = suspensionUnknown || (!!summaryAnchor && suspended.has(summaryAnchor.id));
      const recallSuspended = suspensionUnknown || (!!recallAnchor && suspended.has(recallAnchor.id));

      // #263 (D9): a caller may hand back the messages a PREVIOUS inject() call
      // returned. Those still carry the old `[Session Memory]` and
      // `[Research Recall]` blocks in their text, so skipping the append alone
      // would leave the superseded facts in the prompt. Strip the two summary
      // blocks before deciding what to append, then re-append only what is still
      // valid — that is what makes "stops being injected" true for a reused
      // history and not just for a fresh one.
      //
      // What may be removed is decided by provenance, not by a tag prefix:
      //  - every summary/l2 anchor text the STORE holds for this session (any
      //    version, including ones a correction replaced), rendered exactly as
      //    injection renders it;
      //  - every block THIS runtime appended in an earlier turn.
      // A user or assistant sentence that merely mentions the tag matches neither,
      // so it survives. A summary body with a blank line is still one exact string,
      // so it is matched whole instead of split on "\n\n".
      const knownBlocks = new Set<string>();
      for (const anchor of anchors) {
        const payload = anchor.payload as any;
        if (anchor.anchorType === "rolling_summary" && payload?.summary) {
          knownBlocks.add(SESSION_MEMORY_TAG + " " + String(payload.summary).slice(0, SUMMARY_INJECT_MAX_CHARS));
        }
        if (anchor.anchorType === "l2_recall" && payload?.hits) {
          knownBlocks.add(RESEARCH_RECALL_TAG + " " + String(payload.hits).slice(0, RECALL_INJECT_MAX_CHARS));
        }
      }
      for (const block of this.injectedSummaryBlocks) knownBlocks.add(block);
      if (knownBlocks.size > 0) {
        result = result.map((message: any) => stripSummaryBlocks(message, knownBlocks));
      }

      const injections: string[] = [];
      // Keep the digest in every model prompt of the resumed conversation. The
      // carried-block check keeps one copy when a caller does persist the
      // transformed history; it is not a one-shot gate (transformContext output
      // is not written back into agent history, so the digest would otherwise
      // disappear after a tool call).
      const injectRecovery = !!this.recoveryDigest;
      if (injectRecovery) {
        // Match the block shape (a blank line before the tag), not a bare
        // mention: a user asking about "[Recovery Digest]" must not suppress
        // the real injection.
        const carriedBlock = "\n\n" + RECOVERY_DIGEST_TAG;
        const carried = result.some((message: any) =>
          message?.role === "user" && (readMessageText(message)?.text ?? "").includes(carriedBlock));
        if (carried) {
          this.recoveryDigestInjected = true;
        } else {
          injections.push(this.recoveryDigest!);
        }
      }
      // A suspended summary is SILENTLY skipped, not replaced with a
      // "this section is suspended" line. The ticket forbids filling the slot
      // with the archive's latest material or any unrelated summary, and a
      // placeholder would be one more thing the model has to interpret.
      //
      // #264 (D9): a suspended summary is not injected (above), but leaving the
      // hole there forever is the state this ticket closes. The rebuild runs in
      // the background exactly like the summary/recall writes do: `inject()` is
      // the hot path BEFORE every provider request, so awaiting a second model
      // call here would stall the turn and double its latency. The result is
      // drained by flush() and reported at the end of the run.
      //
      // Design: the rebuild is dispatched as background work, not awaited in
      // `inject()` — `inject` runs before every provider request, so waiting on a
      // second model call here would double the turn's latency. Accepted cost:
      // the rebuilt text reaches the prompt one turn later than ideal.
      //
      // At most once per anchor per runtime, and only when the plan is complete:
      // an unrecoverable summary costs no model call, and a failed rebuild leaves
      // the suspension in force.
      //
      // NOT dispatched when `suspensionUnknown`: that flag means the read threw,
      // so this summary is only ASSUMED suspended. Rebuilding on that assumption
      // would spend a model call and add an anchor for a summary that may be
      // perfectly current — and the write would then report "no open suspension
      // to clear" about work nobody asked for. Unknown state skips this turn;
      // the next readable turn decides.
      //
      // Design: l2_recall is not rebuilt — its payload is a recall snippet
      // produced by a query, not a statement of the session's task, so
      // regenerating it means running that recall again, which the next search
      // turn does on its own. Inventing text for it is the fabrication D10
      // forbids.
      if (summarySuspended && !suspensionUnknown && summaryAnchor) {
        const anchorId = summaryAnchor.id;
        if (!this.rebuildStarted.has(anchorId) && this.hasRebuildSeam()) {
          // Marked SYNCHRONOUSLY, before the async body runs: `inject` is awaited
          // per provider request, so two requests can be in flight before either
          // rebuild finishes.
          this.rebuildStarted.add(anchorId);
          this.track(this.maybeRebuildSummary(sessionId, anchorId).then(() => undefined, () => undefined));
        }
      }
      const summaryPayload = summaryAnchor?.payload as any;
      if (!summarySuspended && summaryPayload?.summary) {
        const block = SESSION_MEMORY_TAG + " " + String(summaryPayload.summary).slice(0, SUMMARY_INJECT_MAX_CHARS);
        injections.push(block);
        this.injectedSummaryBlocks.add(block);
      }
      const recallPayload = recallAnchor?.payload as any;
      if (!recallSuspended && recallPayload?.hits) {
        // The l2_recall payload stores an already-truncated snippet, so the
        // rendered block is the same string every turn — a stable provenance key.
        const block = RESEARCH_RECALL_TAG + " " + String(recallPayload.hits).slice(0, RECALL_INJECT_MAX_CHARS);
        injections.push(block);
        this.injectedSummaryBlocks.add(block);
      }

      // latest USER message, not blindly the last array element. The index was
      // computed once above; Stage-1 replaced elements in place, so it still holds.
      if (injections.length > 0 && lastUserIdx >= 0) {
        // Same shape rule as Stage-1/T0: pi normalizes prompt("…") to content
        // BLOCKS, so a string-only write here would replace the user's turn with
        // the injection (data loss). Stand down when the turn has no text channel.
        const last = result[lastUserIdx];
        const target = readMessageText(last);
        const next = target ? appendMessageText(last, "\n\n" + injections.join("\n\n"), target) : null;
        if (next) {
          result = [
            ...result.slice(0, lastUserIdx),
            next,
            ...result.slice(lastUserIdx + 1),
          ];
          if (injectRecovery) this.recoveryDigestInjected = true;
        }
      }
    } catch {
      // A failed anchor read must not be retried later in the same runtime: by
      // then this runtime's own search could have written an anchor and been
      // mistaken for a recovered record.
      this.recoveryDigestResolved = true;
      // #263: the anchor read failed, so the suspension state is unknown. The
      // removal above could not run, and a caller that reuses a previous
      // inject() output would keep its old `[Session Memory]` / `[Research
      // Recall]` blocks — which may already be suspended. Remove the blocks
      // THIS runtime wrote (no anchor read needed) and append nothing: with
      // unknown state, injecting is the failure mode the ticket forbids.
      if (this.injectedSummaryBlocks.size > 0) {
        result = result.map((message: any) => stripSummaryBlocks(message, this.injectedSummaryBlocks));
      }
    }

    return result;
  }

  // consolidate — shell layer wrapping pure consolidateState.
  // Fire-and-forget, fail-open. Executes LLM I/O + persistence based on pure decision.
  async consolidate(messages: any[], totalTokens: number, hasRetrievalEvidence: boolean): Promise<void> {
    const { store, domain, model, models, streamFn, sessionId, retriever, providerName, getApiKey } = this.deps;

    if (!store || !sessionId) return;

    try {
      // D7: Restore state from anchor for MCP stateless mode (fail-open fallback to in-memory).
      let state = this.consolidationState;
      try {
        const anchors = await store.getAnchors(sessionId);
        const stateAnchor = lastAnchorOfType(anchors, "consolidation_state");
        if (stateAnchor?.payload) {
          state = stateAnchor.payload as ConsolidationState;
          this.consolidationState = state; // update in-memory cache
        }
      } catch {}

      // D8: Call pure function for decision; inject compaction opts.
      // #113: {fraction} resolves against the REAL model window carried by
      // LlmSession.contextWindow. Unknown window (custom endpoint without
      // LlmSessionOptions.contextWindow) falls back to 128000. Malformed shapes
      // still throw (resolveLowWatermark), never silently degrade; domain
      // validation is the primary fail-fast gate.
      const compactionCfg = domain.compaction;
      const result = consolidateState(state, messages, totalTokens, hasRetrievalEvidence, {
        lowWatermark: compactionCfg?.lowWatermark,
        contextWindow: this.deps.contextWindow,
        reuseCap: compactionCfg?.reuseCap,
      });

      if (result.decision === "skip") return;

      // judgment-input assertion boundary 1/5 — gap distillation.
      const gap = result.summaryRequest?.gap;
      if (gap && gap.text) assertJudgmentInput(gap, "gap-distillation");

      // Shell: execute I/O based on pure decision.
      const modelsObj = models;
      const summaryModel = (domain as any).compaction?.model
        ? (modelsObj?.getModel ? modelsObj.getModel(providerName || "openai", (domain as any).compaction.model) : undefined)
        : (model as any);
      const actualModel = summaryModel || (model as any);

      // Get previous summary from anchor (shell I/O).
      const prevAnchors = await store.getAnchors(sessionId);
      const prevSummaryAnchor = lastAnchorOfType(prevAnchors, "rolling_summary");
      const previousSummary = (prevSummaryAnchor?.payload as any)?.summary as string | undefined;
      const previousSummaryAnchorId = prevSummaryAnchor?.id;
      // #263: which summary anchors the generator will ACTUALLY read.
      //
      // The new summary is generated FROM the previous summary text
      // (`previousSummary`) plus whatever summary / recall blocks the message
      // list already carries (a caller may hand `inject()`'s output straight to
      // `consolidate()`). Its dependencies are the union of those anchors'
      // dependencies — recorded so a correction of a fact stated in them
      // suspends this newer summary too.
      //
      // Done by matching the RENDERED blocks, not by "newest anchor wins":
      // - the newest l2_recall anchor with NO block in the history is a
      //   dependency the summary never read. Inheriting it would let a later
      //   correction suspend an unrelated summary — the exact false suspension
      //   the ticket forbids.
      // - a block in the history that is NOT the newest anchor is a dependency
      //   the summary DID read. Inheriting only the newest would miss it, so the
      //   correction would leave the replaced fact in the newly injected
      //   summary.
      // Both cases are covered because the match is per anchor, and an anchor
      // absent from the list is an anchor absent from the sources.
      const inheritedAnchorIds = summaryAnchorsToInherit(messages, prevAnchors, previousSummaryAnchorId);
      // D5: fire-and-forget compression helper.
      // #263: set when the source read failed. The state must NOT advance then:
      // this turn's summary was skipped, so the next turn has to retry the same
      // gap instead of believing it was compressed.
      let summaryWriteSkipped = false;
      const fireCompress = (deadline?: AbortSignal) => {
        // A shared deadline that already expired means this turn's background
        // budget is spent; do not start a call that can only fail.
        if (deadline?.aborted) return;
        if (modelsObj && actualModel) {
          // judgment-input assertion boundary 3/5 — consolidation pre-call.
          // Fire-and-forget: an invalid judgment input skips compression instead of
          // throwing into the agent loop (AGENTS.md fail-open for background paths).
          try {
            if (gap && gap.text) assertJudgmentInput(gap, "consolidation");
          } catch {
            return;
          }
          // #263 (D9): which rows this summary actually read. Two parts:
          //  - the new gap's material URLs, resolved to the archive rows that
          //    currently hold them (exact ids, never text matching);
          //  - the previous summary's own dependencies, because this summary is
          //    generated FROM that one. Without the inheritance a correction to
          //    an old fact would suspend the earlier summary and leave the
          //    newest one — which still states the replaced fact — injected.
          //
          // Read here, before the model call: the material was archived when the
          // search ran, so the ids exist already, and the anchor write can then
          // carry them through one transaction.
          //
          // A store without the seam records nothing (absence is not an error).
          // A read that THROWS ends this turn's summary instead: a summary
          // stored with half its dependencies (or none) would never be
          // suspended when a fact it used is corrected, and with no rebuild yet
          // that leaves the replaced fact injected — worse than no summary at
          // all for one turn. `consolidationState` is updated only after the
          // sources were read, so a skipped turn does not advance the state the
          // next turn depends on.
          // #263 (D9): the URLs the SUMMARIZER actually read, not just this
          // turn's gap.
          //
          // `generateSummaryWithUsage(messages, ...)` receives the whole message
          // list, so a second compression starting before the first one's write
          // can produce a summary containing the FIRST gap's facts while
          // `summaryRequest.gap` covers only its own slice. Recording the gap
          // alone would leave the newer summary without the earlier dependency;
          // a later correction of that fact would suspend the first summary and
          // keep injecting the newer one.
          //
          // The fix needs no new bookkeeping: run the SAME scan over the whole
          // list, which is what the generator reads.
          //
          // The scan and the model call must read the SAME list. Two `await`s
          // separate them (the API key and the SDK load), and the caller hands
          // in the live agent-state array, so a message appended in that window
          // would reach the generator while being absent from the scan — a fact
          // in the summary with no recorded dependency. A shallow copy pins the
          // membership without copying message contents.
          const snapshot = snapshotMessages(messages);
          const scanFromStart = distillGap(snapshot, SOURCE_SCAN_FROM_INDEX);
          const read = readSummarySourcesForWrite(store, {
            gapUrls: scanFromStart.results
              .map((r: any) => r?.url)
              .filter((u: any) => typeof u === "string" && u.length > 0),
            // The exact form: each read carries the archive row the search wrote,
            // so a URL with a retired predecessor AND a live successor records
            // only the version actually read.
            gapReads: scanFromStart.results.map((r) => ({ url: r.url, rowId: r.archiveRowId ?? null })),
            previousAnchorIds: inheritedAnchorIds,
          });
          if (!read.ok) {
            // Report the skip on stderr (stdout stays protocol-pure) and stop
            // this turn's summary: writing one with unknown dependencies is what
            // the ticket forbids.
            try {
              process.stderr.write(
                "[anysearch] summary sources unreadable — skipping this turn's summary write\n",
              );
            } catch { /* stderr unavailable */ }
            summaryWriteSkipped = true;
            return;
          }
          // #263 (D9): recall hits the summarizer also saw. They carry no URL,
          // so they cannot be recovered from `resolveSummarySources`; the ids
          // come straight from the tool result (see collectRecallSourceRefs).
          //
          // Scanned from index 0 because the summarizer reads the WHOLE message
          // list (`generateSummaryWithUsage(messages, ...)`). A window starting
          // at `msgCountAtTrigger` would be empty by construction — that value
          // IS `messages.length` — so no recall hit could be recorded while the
          // summary still used them. Merged with the search-material refs.
          const sources = read.sources;
          for (const ref of collectRecallSourceRefs(messages, RECALL_SOURCE_SCAN_FROM)) {
            if (!sources.some((r) => r.kind === ref.kind && r.id === ref.id)) sources.push(ref);
          }
          this.consolidationState = {
            version: result.state.version,
            consecutiveReuses: 0,
            lastSummaryMsgCount: result.summaryRequest?.msgCountAtTrigger || messages.length,
          };
          // Tracked: flush() must see this write before the store is closed.
          this.track(
            (async () => {
              const apiKey = await getApiKey?.();
              const sdk = await loadPiCodingAgent();
              // 1.5.1 signature: (messages, model, reserveTokens, apiKey,
              // headers, signal, customInstructions, previousSummary,
              // thinkingLevel, streamFn, env, retry, callbacks, sessionId).
              // The old 0.84.2 shape took a Models object and returned a
              // Result, so the whole call is restructured here.
              const result = await sdk.generateSummaryWithUsage(
                // The SAME snapshot the dependency scan read (see above): a
                // later append to the caller's live array cannot add a fact the
                // sources do not cover.
                snapshot,
                actualModel,
                COMPACTION_RESERVE_TOKENS,
                apiKey,
                undefined,
                deadline ?? AbortSignal.timeout(BACKGROUND_SUMMARY_TIMEOUT_MS),
                IR_CUSTOM_INSTRUCTIONS,
                previousSummary,
                undefined,
                streamFn,
              );
              const u = result.usage;
              if (u) accumulateUsage(this.summaryUsage, { role: "assistant", usage: u });
              return { text: result.text };
            })().then((summaryResult: any) => {
              if (summaryResult?.text) {
                return store!.saveAnchor(sessionId!, "rolling_summary", {
                  summary: summaryResult.text,
                  tokenWatermark: totalTokens,
                  timestamp: Date.now(),
                  // #263: the source list travels inside the payload, so the
                  // anchor and its dependencies commit in one transaction.
                  sources,
                }).catch(() => {});
              }
              return undefined;
            }).catch((e: any) => {
              if (typeof process !== "undefined" && process.stderr) {
                process.stderr.write("[anysearch] L0 compression warning: " + (e instanceof Error ? e.message : String(e)) + "\n");
              }
            }),
          );
        }
      };

      if (result.decision === "compress") {
        fireCompress();
      } else if (result.decision === "reuse") {
        // Adjudication: fire-and-forget LLM call to decide reuse vs compress.
        const gapDistillation = result.summaryRequest?.gap.text || "";
        // judgment-input assertion boundary 2/5 — NOOP adjudication pre-call.
        // Fire-and-forget: invalid judgment input skips adjudication (keep reuse),
        // never throws into the agent loop.
        let gapValid = true;
        try {
          if (gap && gap.text) assertJudgmentInput(gap, "noop-adjudication");
        } catch {
          gapValid = false;
        }
        if (gapValid) {
          // One deadline for adjudication AND any compression it triggers: a
          // separate timeout per call would let one turn's background work run
          // for 2x the bound, and flush() waits on all of it. On abort we keep
          // the reuse state and retry next turn instead of firing compression
          // under an already-expired budget.
          const deadline = AbortSignal.timeout(BACKGROUND_SUMMARY_TIMEOUT_MS);
          this.track(
            adjudicateReuseCompress(streamFn, actualModel, gapDistillation, previousSummary, deadline)
              .then((adj: { decision: "reuse" | "compress"; usage?: unknown }) => {
                // #261/#273 review: the request was SENT, so it must appear in
                // the adjudication book even when the provider sent no usage.
                // Without a usage block the old code left `calls` at 0, the CLI's
                // `calls > 0` gate then suppressed the whole line, and a real
                // (possibly billed) call vanished from the report. When usage is
                // missing the call is counted AND flagged, so the report names
                // the unknown tokens instead of printing in=0 out=0 as if the
                // call were free.
                if (adj.usage) {
                  accumulateUsage(this.adjudicationUsage, { role: "assistant", usage: adj.usage });
                } else {
                  this.adjudicationUsage.assistantCalls += 1;
                  this.adjudicationUsage.callsWithoutUsage = (this.adjudicationUsage.callsWithoutUsage ?? 0) + 1;
                }
                if (adj.decision === "compress" && !deadline.aborted) {
                  fireCompress(deadline);
                } else {
                  // Keep the incremented consecutiveReuses from the pure result.
                  this.consolidationState = result.state;
                }
              })
              .catch(() => {
                // Adjudication failed or timed out: do not spend more budget on a
                // second model call; the next turn retries.
                this.consolidationState = result.state;
              }),
          );
        }
      }

      // D7: Persist consolidation state to anchor (UPSERT in saveAnchor).
      //
      // #263: NOT when this turn's summary was skipped. Advancing
      // `lastSummaryMsgCount` would make the next turn's distillGap skip the
      // very search results this turn never compressed, and the later summary
      // would state those facts with no recorded source — the summary that
      // cannot be suspended.
      if (!summaryWriteSkipped) {
        this.consolidationState = result.state;
        try {
          await store.saveAnchor(sessionId, "consolidation_state", result.state);
        } catch {}
      }

      // L2 cold path — FTS5 recall.
      // 1.5.1 stores assistant tool calls as type:"toolCall" with `arguments`;
      // the legacy tool_use/input shape is kept as a fallback for adapted
      // transcripts and older tests.
      const isSearchCall = (c: any) =>
        (c?.type === "toolCall" || c?.type === "tool_use") &&
        typeof c.name === "string" && c.name.includes("search");
      const lastToolCall = [...messages].reverse().find((m: any) =>
        m.role === "assistant" && Array.isArray(m.content) && m.content.some(isSearchCall)
      );
      const searchBlock = lastToolCall?.content?.find(isSearchCall);
      const searchToolInput = searchBlock?.arguments ?? searchBlock?.input;
      const l2Query = searchToolInput?.query || "";
      if (typeof l2Query === "string" && l2Query.length > 3) {
        // (Q2=B): S1 rewrite + RRF fusion. Fail-open via rewriteQuery when no LLM seam.
        // QDF hint uses heuristic classifiers from @anysearch-cli/store (no LLM call needed to tag).
        const qdf = classifyQdf(l2Query, { isTimeSensitive, isEvergreen });
        this.track(
          rewriteQuery(l2Query, qdf, this.deps.llmRewriteFn)
            .then((variants) => {
              // Optional call: searchMemoryMulti present on -capable stores. Fall back to single-query.
              const s: any = store as any;
              const searchPromise: Promise<any[]> = typeof s.searchMemoryMulti === "function"
                ? s.searchMemoryMulti(variants, 5)
                : store.searchMemory(l2Query, 5);
              return searchPromise.then((hits) => ({ hits, variants }));
            })
            .then(({ hits, variants }) => {
              if (hits.length > 0) {
                // #263 (D9): sources are collected in the SAME loop that builds
                // the text, and only for hits that actually contributed to it.
                // Recording every returned hit would claim the summary used rows
                // whose text was truncated away — a later correction to one of
                // those would then suspend a recall block it never fed, and with
                // no rebuild yet that silently removes valid recall text.
                //
                // Both caps are applied here, not after the fact: the block is
                // built from the hits until the text budget is spent, and the
                // anchor payload is capped at the SAME budget below.
                //
                // The budget is the injection cap (1500), not a larger number:
                // `inject` renders `hits.slice(0, 1500)`, so anything past that
                // is never shown. Recording a hit that only lives beyond the
                // cap would claim the summary used text that no prompt ever
                // carried, and a later correction of that row would suspend the
                // whole recall block — removing valid text it never fed.
                const CHUNK_BUDGET = RECALL_INJECT_MAX_CHARS;
                const parts: string[] = [];
                const sources: Array<{ kind: "material" | "knowledge"; id: number }> = [];
                const seen = new Set<string>();
                let used = 0;
                for (const h of hits as any[]) {
                  const text = h?.content || "";
                  if (!text) continue;
                  // The separator costs characters too; measuring it keeps the
                  // payload cap from silently dropping the last included hit.
                  const sep = parts.length === 0 ? 0 : 3; // " | "
                  const room = CHUNK_BUDGET - used - sep;
                  if (room <= 0) break;
                  // The FIRST hit is always taken, truncated if it alone exceeds
                  // the budget: an over-long top hit must not leave the block
                  // empty (no anchor, no recall at all). Later hits are taken
                  // whole or not at all, so a hit that contributed nothing is
                  // never recorded as a source.
                  const include = parts.length === 0
                    ? text.slice(0, room)
                    : (text.length <= room ? text : "");
                  if (!include) break;
                  parts.push(include);
                  used += sep + include.length;
                  // The hit id encoding already carries the kind: a positive
                  // rowid is an archived material, a negative one a knowledge
                  // row (see SessionStore's semantic arm).
                  const rowid = Number(h?.rowid);
                  if (!Number.isInteger(rowid) || rowid === 0) continue;
                  const ref = rowid > 0
                    ? { kind: "material" as const, id: rowid }
                    : { kind: "knowledge" as const, id: Math.abs(rowid) };
                  const key = ref.kind + ":" + ref.id;
                  if (seen.has(key)) continue;
                  seen.add(key);
                  sources.push(ref);
                }
                if (parts.length === 0) return undefined;
                return store!.saveAnchor(sessionId!, "l2_recall", {
                  query: l2Query, variants, hits: parts.join(" | ").slice(0, CHUNK_BUDGET), timestamp: Date.now(), sources,
                }).catch(() => {});
              }
              return undefined;
            })
            .catch(() => {}),
        );
      }
    } catch {}
  }

  // Get current consolidation state (for testing/debugging).
  getConsolidationState(): ConsolidationState {
    return this.consolidationState;
  }

  /**
   * The digest present in the resumed prompt, if any.
   *
   * Used by the runtime to make the recovery visible on the `done` event. It
   * covers a digest injected in any model prompt of this run and a copy already
   * carried by the handed-back history when the anchor was readable. A copy
   * that exists only in history, with no readable anchor, is not reported.
   * Undefined for a fresh session and for a session whose last anchor had no
   * usable payload.
   */
  getInjectedRecoveryDigest(): string | undefined {
    return this.recoveryDigestInjected ? this.recoveryDigest : undefined;
  }

  // One-shot capture: the first successful anchor read wins. Marking the read
  // as resolved even when there is no resume anchor is what keeps a fresh
  // session at zero injection after its own first search writes one.
  private captureRecoveryDigest(anchors: Array<{ anchorType: string; payload: unknown }>): void {
    if (this.recoveryDigestResolved) return;
    this.recoveryDigestResolved = true;
    try {
      const last = lastAnchorOfType(anchors, "sufficiency");
      if (last) this.recoveryDigest = buildRecoveryDigest(last.payload);
    } catch { /* fail-open: a malformed anchor never blocks a turn */ }
  }

  // Set consolidation state (for MCP restore from anchor).
  setConsolidationState(state: ConsolidationState): void {
    this.consolidationState = state;
  }

  /** Register a background write so flush() can wait for it. */
  private track(p: Promise<unknown>): void {
    this.pendingWrites.add(p);
    const done = () => { this.pendingWrites.delete(p); };
    p.then(done, done);
  }

  /**
   * Wait for the background anchor writes started by consolidate().
   *
   * The caller that owns the store must drain before closing it: closing while a
   * saveAnchor is in flight loses the anchor and the failure is swallowed by the
   * fire-and-forget handlers. Never throws — a failed write is not the caller's
   * problem to handle here.
   */
  async flush(): Promise<void> {
    // Writes can chain (generate -> saveAnchor), so loop until the set drains.
    while (this.pendingWrites.size > 0) {
      await Promise.allSettled([...this.pendingWrites]);
    }
  }
}
