// MemoryPipeline: deep module for L0/L1/L2 memory pipeline logic.
// extracted from pi-runtime.ts shouldStopAfterTurn + transformContext.
// Interface: attach (init) / inject (hot read) / consolidate (cold write).
// Domain-semantic naming — interface does not leak host hook details.
// pure function-ization + ConsolidationState + shell wrapper.
// consolidate() is now a shell that calls pure consolidateState() then executes I/O.
// signalSearchTurn() DELETED — replaced by hasRetrievalEvidence parameter.

import { generateSummaryWithUsage } from "@earendil-works/pi-coding-agent";

// PI's summarizer calls `stream.result()`; test doubles and some wrappers only
// implement the async iterator. Adding the missing method keeps the official
// path usable everywhere without a second summarizer implementation.
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
// Upper bound for the background summarization call. It is fire-and-forget
// during a turn but the code that owns it drains it before closing the
// store (#129), so an unbounded provider stall would hold the CLI open until the
// provider times out. Aborting is a normal fire-and-forget failure: the next turn
// simply tries again.
const BACKGROUND_SUMMARY_TIMEOUT_MS = 90_000;
import { IR_CUSTOM_INSTRUCTIONS } from "./ir-schema";
import type { RetrieverPort, SessionStorePort, DomainConfigPort } from "./ports";
import { RagAdapterRegistry, RAG_CONTEXT_TAG, RAG_DEFAULT_LIMIT, RAG_QUERY_MAX_CHARS, isDynamicRagAdapter } from "./rag-adapter";
import { buildRecoveryDigest, RECOVERY_DIGEST_TAG } from "./recovery-digest";
import { appendMessageText, prependMessageText, readMessageText, serializeTranscriptForSummary } from "./message-text";
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
      results.push({
        url: typeof item?.url === "string" ? item.url : "",
        title: typeof item?.title === "string" ? item.title : "",
        snippet: typeof item?.snippet === "string" ? item.snippet : String(raw).slice(0, 4000),
        source: typeof item?.source === "string" ? item.source : "retrieved",
        label: itemLabel,
      });
      label = combineLabels(label, itemLabel);
    }
  }
  const text = results.map((r) => r.snippet).join("\n\n").slice(0, 4000);
  return { text, results, source: label.source, traceId: label.traceId };
}

// NOOP adjudication — LLM decides REUSE vs COMPRESS.
export async function adjudicateReuseCompress(
  streamFn: any,
  model: any,
  gapDistillation: string,
  existingSummary: string | undefined,
  signal?: AbortSignal,
): Promise<"reuse" | "compress"> {
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
  try {
    const stream = streamFn(model, context, signal ? { signal } : {});
    for await (const event of stream) {
      // 1.5.1 streams text as text_delta.delta; the monolithic "text" event
      // was the pre-upgrade shape.
      if (event?.type === "text_delta" && typeof event.delta === "string") text += event.delta;
      else if (event?.type === "text" && event.text) text += event.text;
    }
  } catch {
    return "compress"; // D10: fail-open.
  }

  const lower = text.toLowerCase().trim();
  if (lower.includes("reuse")) return "reuse";
  return "compress"; // D10: unparseable -> COMPRESS.
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

/**
 * Newest correction status for one anchor type. Status rows are append-only,
 * so the last matching statement wins: needsRefresh true pauses injection,
 * a later false row (written by refreshIfNeeded) resumes it.
 */
function latestAnchorStatus<T extends { anchorType: string; payload: any }>(anchors: T[], target: string): any {
  let found: any;
  for (const anchor of anchors) {
    if (anchor.anchorType !== "anchor_status") continue;
    if (anchor.payload?.target === target) found = anchor.payload;
  }
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

  // Usage of the pipeline's own summary requests, kept apart from the main run
  // so the caller can report both without double counting.
  private summaryUsage = { calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0, costUsd: 0, cacheReported: false, costReported: false };

  constructor(deps: MemoryPipelineDeps) {
    this.deps = { ...deps, streamFn: ensureResult(deps.streamFn) };
    this.rag = new RagAdapterRegistry({ store: deps.store });
  }

  /** Summary-call accounting for this runtime (never zero-filled). */
  getSummaryUsage(): { calls: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; totalTokens: number; costUsd: number; missing: string[] } {
    const u = this.summaryUsage;
    const missing: string[] = [];
    if (u.calls === 0) missing.push("summary usage");
    if (u.calls > 0 && !u.cacheReported) missing.push("summary cache usage");
    if (!u.costReported) missing.push("summary cost");
    return {
      calls: u.calls,
      inputTokens: u.inputTokens,
      outputTokens: u.outputTokens,
      cacheReadTokens: u.cacheReadTokens,
      cacheWriteTokens: u.cacheWriteTokens,
      totalTokens: u.totalTokens,
      costUsd: u.costUsd,
      missing,
    };
  }

  /**
   * Correction propagation, summary side. When a correction paused this
   * session's rolling summary (or its recall digest), rebuild it from the
   * materials that are still valid and clear the pause. Originals stay in the
   * archive — this writes a new anchor, it never rewrites history.
   *
   * Fail-open: a failed rebuild leaves the pause in place (the stale summary
   * stays out of prompts) and reports the reason to the caller.
   */
  async refreshIfNeeded(): Promise<{ refreshed: boolean; reason?: string; sessions?: number }> {
    const { store, sessionId } = this.deps;
    const getStatus = store.getAnchorStatus?.bind(store);
    const getDigest = store.getLiveKnowledgeDigest?.bind(store);
    if (!getStatus || !getDigest) return { refreshed: false, reason: "store has no correction-propagation support" };
    try {
      const [summaryStatus, recallStatus] = await Promise.all([
        getStatus(sessionId, "rolling_summary"),
        getStatus(sessionId, "l2_recall"),
      ]);
      const summaryStale = summaryStatus?.payload?.needsRefresh === true;
      const recallStale = recallStatus?.payload?.needsRefresh === true;
      if (!summaryStale && !recallStale) return { refreshed: false, reason: "no refresh needed" };

      const digest = await getDigest(40);
      if (digest.length === 0) {
        // Nothing valid to rebuild from: keep the pause rather than invent text.
        return { refreshed: false, reason: "no valid materials to regenerate from" };
      }
      const materialText = digest
        .map((m) => (m.kind === "semantic" ? "[knowledge #" : "[material #") + m.id + "] " + m.text)
        .join("\n")
        .slice(0, 12000);
      const invalidatedBy = summaryStatus?.payload?.invalidatedBy ?? recallStatus?.payload?.invalidatedBy;

      let summaryText: string | undefined;
      if (summaryStale) {
        const modelsObj = this.deps.models;
        const actualModel = (this.deps.model as any);
        if (!modelsObj || !actualModel) return { refreshed: false, reason: "no model for summary regeneration" };
        const apiKey = await this.deps.getApiKey?.();
        const result = await generateSummaryWithUsage(
          [
            {
              role: "user",
              timestamp: Date.now(),
              content:
                "Rebuild the research summary from the CURRENT valid materials below. " +
                "A previously stated fact was corrected; do not restate it. Only use the materials shown.\n\n" +
                materialText,
            },
          ],
          actualModel,
          undefined,
          apiKey,
          undefined,
          AbortSignal.timeout(BACKGROUND_SUMMARY_TIMEOUT_MS),
          IR_CUSTOM_INSTRUCTIONS,
          undefined,
          undefined,
          this.deps.streamFn,
        );
        const u = result.usage;
        if (u) {
          this.summaryUsage.calls += 1;
          this.summaryUsage.inputTokens += Number(u.input) || 0;
          this.summaryUsage.outputTokens += Number(u.output) || 0;
          this.summaryUsage.cacheReadTokens += Number(u.cacheRead) || 0;
          this.summaryUsage.cacheWriteTokens += Number(u.cacheWrite) || 0;
          this.summaryUsage.totalTokens += Number(u.totalTokens) || (Number(u.input) || 0) + (Number(u.output) || 0);
          this.summaryUsage.costUsd += Number(u.cost?.total) || 0;
          this.summaryUsage.cacheReported = this.summaryUsage.cacheReported || u.cacheRead !== undefined || u.cacheWrite !== undefined;
          this.summaryUsage.costReported = this.summaryUsage.costReported || u.cost !== undefined;
        }
        summaryText = result.text?.trim() || undefined;
        if (!summaryText) return { refreshed: false, reason: "regeneration returned no summary" };
      }

      const refreshedAt = new Date().toISOString();
      const origin = { refreshedFrom: "valid-materials", invalidatedBy, refreshedAt };
      if (summaryText) {
        await store.saveAnchor(sessionId, "rolling_summary", { summary: summaryText, ...origin, timestamp: Date.now() });
        await store.saveAnchor(sessionId, "anchor_status", { target: "rolling_summary", needsRefresh: false, ...origin });
      }
      if (recallStale) {
        await store.saveAnchor(sessionId, "l2_recall", { hits: materialText.slice(0, 1500), ...origin });
        await store.saveAnchor(sessionId, "anchor_status", { target: "l2_recall", needsRefresh: false, ...origin });
      }
      return { refreshed: true, sessions: 1 };
    } catch (e: any) {
      if (typeof process !== "undefined" && process.stderr) {
        process.stderr.write("[anysearch] summary refresh warning: " + (e instanceof Error ? e.message : String(e)) + "\n");
      }
      return { refreshed: false, reason: "refresh failed: " + (e instanceof Error ? e.message : String(e)) };
    }
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
      const summaryAnchor = lastAnchorOfType(anchors, "rolling_summary");
      const recallAnchor = lastAnchorOfType(anchors, "l2_recall");

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
      const summaryPayload = summaryAnchor?.payload as any;
      // Correction propagation (#Q3): a summary that still carries a corrected
      // fact stays in the archive but is paused from automatic injection until
      // refreshIfNeeded() rebuilds it from valid materials.
      const summaryPaused = latestAnchorStatus(anchors, "rolling_summary")?.needsRefresh === true;
      const recallPaused = latestAnchorStatus(anchors, "l2_recall")?.needsRefresh === true;
      if (summaryPayload?.summary && !summaryPaused) {
        injections.push(SESSION_MEMORY_TAG + " " + String(summaryPayload.summary).slice(0, 4000));
      }
      const recallPayload = recallAnchor?.payload as any;
      if (recallPayload?.hits && !recallPaused) {
        injections.push(RESEARCH_RECALL_TAG + " " + String(recallPayload.hits).slice(0, 1500));
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

      // D5: fire-and-forget compression helper.
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
          this.consolidationState = {
            version: result.state.version,
            consecutiveReuses: 0,
            lastSummaryMsgCount: result.summaryRequest?.msgCountAtTrigger || messages.length,
          };
          // Tracked: flush() must see this write before the store is closed.
          this.track(
            (async () => {
              const apiKey = await getApiKey?.();
              const result = await generateSummaryWithUsage(
                messages,
                actualModel,
                undefined,
                apiKey,
                undefined,
                deadline ?? AbortSignal.timeout(BACKGROUND_SUMMARY_TIMEOUT_MS),
                IR_CUSTOM_INSTRUCTIONS,
                previousSummary,
                undefined,
                streamFn,
              );
              const u = result.usage;
              if (u) {
                this.summaryUsage.calls += 1;
                this.summaryUsage.inputTokens += Number(u.input) || 0;
                this.summaryUsage.outputTokens += Number(u.output) || 0;
                this.summaryUsage.cacheReadTokens += Number(u.cacheRead) || 0;
                this.summaryUsage.cacheWriteTokens += Number(u.cacheWrite) || 0;
                this.summaryUsage.totalTokens += Number(u.totalTokens) || (Number(u.input) || 0) + (Number(u.output) || 0);
                this.summaryUsage.costUsd += Number(u.cost?.total) || 0;
                this.summaryUsage.cacheReported = this.summaryUsage.cacheReported || u.cacheRead !== undefined || u.cacheWrite !== undefined;
                this.summaryUsage.costReported = this.summaryUsage.costReported || u.cost !== undefined;
              }
              return { text: result.text };
            })().then((summaryResult: any) => {
              if (summaryResult?.text) {
                return store!.saveAnchor(sessionId!, "rolling_summary", {
                  summary: summaryResult.text,
                  tokenWatermark: totalTokens,
                  timestamp: Date.now(),
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
              .then((adjDecision: "reuse" | "compress") => {
                if (adjDecision === "compress" && !deadline.aborted) {
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
      this.consolidationState = result.state;
      try {
        await store.saveAnchor(sessionId, "consolidation_state", result.state);
      } catch {}

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
                const memorySnippet = (hits as any[]).map(h => h.content || "").slice(0, 200).join(" | ");
                return store!.saveAnchor(sessionId!, "l2_recall", {
                  query: l2Query, variants, hits: memorySnippet.slice(0, 2000), timestamp: Date.now(),
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
