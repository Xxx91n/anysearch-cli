// PiAgentRuntime: full PI AgentSession driver for anysearch-cli.
// Lives in packages/kernel; it maps PI session events to our 7 AgentEvent types
// and consumes the Domain's 5 layers.
// Budget metering (amended by #90/#103, #188): token/USD usage is accumulated
// from session events and settled at the end of a run. The token dimension also
// reserves at run start — input occupancy + the output static limit — and stops
// the run when the reserve is rejected. USD comes from pi-ai Usage.cost; there
// is no price table in the domain TOML or in the kernel.
// Dual session: PI keeps the conversation record, SqliteSessionStore keeps the
// research archive and its FTS5 index.
// #258: the runtime runs a full pi-coding-agent AgentSession, not a bare
// pi-agent-core Agent. PI owns the session record, resume and compaction; the
// anysearch side keeps only the research store and its anchors.
// MemoryPipeline + SufficiencyEvaluator extracted as sibling deep modules.

import type { AgentTool } from "@earendil-works/pi-agent-core";
// The full PI session runtime. pi-coding-agent publishes only an ESM entry, so
// every host that links the kernel (CLI, MCP) builds as ESM; it is loaded
// lazily through ./pi-sdk so a command that never starts a run does not pay for
// its multi-second module evaluation (#258).
import { loadPiCodingAgent } from "./pi-sdk";
import {
  acquireSessionLock,
  resolveSessionLockWindows,
  SESSION_BUSY_MESSAGE,
  SESSION_LOCKS_DIRNAME,
  type SessionLockWindows,
} from "./session-lock";
import { estimateTranscriptTokens } from "./message-text";
import { accumulateUsage, emptyUsageTotals, toRunUsage, type SummaryUsage } from "./usage";
import { createHash } from "node:crypto";
import { Type } from "@sinclair/typebox";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  CONTENT_TRUST_SCHEMA_VERSION,
  RETRIEVAL_CONTENT_SCHEMA_URL,
  shouldAllowUrl,
  wrapRetrieved,
  type RetrievalContent,
  type SourceTraceLabel,
} from "@anysearch-cli/retriever";
import { ENV_ALLOW_OVERRIDE, ENV_URL_ALLOWLIST, createDomainReloader, parseEnvOverrideSwitch, resolveOutputReserveTokens, resolveUrlPolicy, toBudgetCaps } from "@anysearch-cli/store";
import type { RetrieverPort, SessionStorePort, DomainConfigPort, BudgetLedgerPort, Query, RetrievalObservationSink } from "./ports";
import type { AgentEvent, SummaryRebuildReport } from "./runtime";
import { MemoryPipeline } from "./memory-pipeline";
import { SufficiencyEvaluator } from "./sufficiency-gate";

// HITL gate helpers for shouldAllowUrl (TTY ask / headless deny-first).
// Kernel reads no env config (r94 discipline): the wiring passes
// `interactive` in PiAgentRuntimeOptions; this helper is the TTY capability check only.
export function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY);
}

// TTY y/N prompt; deny-first default on EOF/error. No timeout — waits for input
// (ponytail: add clock timeout if HITL UX reports stuck prompts).
export async function askAllowUrl(url: string): Promise<boolean> {
  const readline = await import("node:readline");
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer: string = await new Promise((resolve) => {
      rl.question("[anysearch] retrieved-derived URL not on allowlist: " + url + " — allow once? [y/N] ", resolve);
    });
    return /^y(es)?$/i.test(answer.trim());
  } catch {
    return false;
  } finally {
    rl.close();
  }
}

// Headless deny path: queue the blocked URL for `ans hitl review` recovery.
export function enqueueHitl(record: { url: string; host: string; toolName: string; reason: string; at?: string }): void {
  try {
    const dir = join(process.cwd(), ".anysearch-cli");
    mkdirSync(dir, { recursive: true });
    appendFileSync(
      join(dir, "hitl.pending"),
      JSON.stringify({ ...record, at: record.at ?? new Date().toISOString() }) + "\n",
      "utf8",
    );
  } catch { /* fail-open: queue write failure must not crash the agent loop */ }
}

// r19 T2 (r18 seal-0 finding): a stop condition other than the wall-clock budget.
// On adversarial questions the model kept re-searching (46–62 calls per question in
// r18) until timeout. Track the URLs each search returns; once `maxNoNewStreak`
// consecutive searches add nothing new, or `maxCalls` searches have run, further
// search calls are blocked and the model is told to answer from what it has.
export const SEARCH_SATURATION_DEFAULTS = { maxCalls: 12, maxNoNewStreak: 2 } as const;

export class SearchSaturation {
  private readonly seen = new Set<string>();
  private calls = 0;
  private noNewStreak = 0;
  constructor(private readonly limits: { maxCalls: number; maxNoNewStreak: number } = SEARCH_SATURATION_DEFAULTS) {}

  record(urls: string[]): void {
    this.calls++;
    let fresh = 0;
    for (const u of urls) if (u && !this.seen.has(u)) { this.seen.add(u); fresh++; }
    this.noNewStreak = fresh === 0 ? this.noNewStreak + 1 : 0;
  }

  exhausted(): boolean {
    return this.calls >= this.limits.maxCalls || this.noNewStreak >= this.limits.maxNoNewStreak;
  }

  reason(): string {
    const why = this.noNewStreak >= this.limits.maxNoNewStreak
      ? "the last " + this.noNewStreak + " searches returned no new results"
      : "the search limit of " + this.limits.maxCalls + " calls was reached";
    return "Search stopped: " + why + ". Do not search again; answer now from the evidence already gathered and state what remains uncertain.";
  }
}

// Wiring-gap diagnostics, deduped per missing-half combination. A stateless MCP
// host (`ans_chat`) builds one runtime per request, so an undeduped line would
// print on every call. Module scope, not instance scope, for the same reason
// RagAdapterRegistry keeps its `warned` set there.
const warnedWiring = new Set<string>();

/** Test hook: forget which wiring gaps were already announced. */
export function resetWiringWarnings(): void {
  warnedWiring.clear();
}

/**
 * Name a memory-wiring gap once per process.
 *
 * Both halves absent is normal for a host with no session concept — but it is
 * also exactly the shape that hid #129 for months, so it still gets one line.
 */
function warnMissingMemoryWiring(opts: PiAgentRuntimeOptions): void {
  const missing = opts.store ? "sessionId" : opts.sessionId ? "store" : "store and sessionId";
  if (warnedWiring.has(missing)) return;
  warnedWiring.add(missing);
  // stdout stays protocol-pure for MCP; a dead stderr must not break construction.
  try {
    process.stderr.write(
      "[anysearch] PiAgentRuntime: " + missing + " not supplied — MemoryPipeline NOT constructed; " +
      "RAG and L1/L2 memory injection are disabled for this runtime\n",
    );
  } catch { /* fail-open */ }
}

/**
 * Report a budget reserve/settle fault without letting it abort the chat.
 *
 * Design: budget is an accounting layer, not a precondition for answering —
 * a locked/unavailable ledger must not turn a completed agent run into a
 * failed call. stderr stays protocol-safe for MCP (no stdout), and a closed
 * stderr pipe is itself fail-open.
 */
function reportBudgetFault(stage: string, e: unknown): void {
  try {
    process.stderr.write(
      "[anysearch] budget " + stage + " failed: " +
      (e instanceof Error ? e.message : String(e)) + "\n",
    );
  } catch { /* stderr unavailable */ }
}

// #259: index one internal search into the shared research archive.
//
// One writer for both internal retrieval paths (the search tool and the
// sufficiency reround), so the abort rule, the fail-open rule and the warning
// text cannot drift apart. Before this, only the standalone `search_web` tool
// wrote to `retrieval_results`, so a search made inside ans_chat was invisible
// to later turns, other sessions, and `recall_memory`.
//
// Design: a cancelled search is not a completed one (#209), so nothing is
// archived once the caller's signal has aborted. Design: a failed write never
// fails the turn — the archive is an enhancement, not a precondition for
// answering.
async function indexSearchResults(
  writer: { store: SessionStorePort; sessionId: string } | undefined,
  results: unknown[] | null | undefined,
  signal?: AbortSignal,
): Promise<Array<number | null> | undefined> {
  if (!writer || signal?.aborted || !results || results.length === 0) return undefined;
  try {
    const withIds = writer.store.saveResultsWithIds;
    if (typeof withIds === "function") {
      // #263: the ids back the summary's dependency. Only the seam that reports
      // them is used here; `saveResults` stays the plain write.
      return await withIds.call(writer.store, writer.sessionId, results as any);
    }
    await writer.store.saveResults(writer.sessionId, results as any);
    return undefined;
  } catch (e) {
    try {
      process.stderr.write(
        "[anysearch] search result indexing failed: " +
        (e instanceof Error ? e.message : String(e)) + "\n",
      );
    } catch { /* stderr unavailable */ }
    return undefined;
  }
}

/**
 * Attach the archive row ids to the search results the model will read.
 *
 * #263: a summary records which rows it was built from, and a URL alone cannot
 * answer that — one URL may hold a row a correction retired plus a newer row a
 * later fetch wrote. The id is what tells the versions apart, so the id has to
 * travel WITH the result the model sees (the envelope JSON inside the tool
 * result), where `distillGap` can read it back.
 *
 * Copies rather than mutates: `envelope.results` is also handed to the
 * sufficiency gate and to `onResults`, and adding a field to shared objects
 * would leak the annotation into surfaces that never asked for it.
 */
function stampArchiveRowIds(envelope: any, ids: Array<number | null> | undefined): any {
  const results = envelope?.results;
  if (!ids || !Array.isArray(results)) return envelope;
  return {
    ...envelope,
    results: results.map((r: any, i: number) => {
      const id = ids[i];
      return typeof id === "number" && Number.isInteger(id) && id > 0
        ? { ...(r ?? {}), archiveRowId: id }
        : r;
    }),
  };
}

// Build the search AgentTool: wraps RetroaererdEngine.search() with TypeBox schema.
// The LLM sees this as a tool it can call to search the web.
export function createSearchTool(
  retriever: RetrieverPort,
  span?: RetrievalObservationSink,
  onResults?: (urls: string[]) => void,
  // #259: the archive writer for this session, or absent when the runtime has
  // no wired session (nothing is indexed then).
  archive?: { store: SessionStorePort; sessionId: string },
): AgentTool {
  return {
    name: BUILTIN_SEARCH_TOOL,
    label: "Search",
    // answer is provider-fulfilled (Exa/Tavily only); no CLI-side
    // synthesis. When no provider supports it, answers=[] and metadata.answersAvailable=false.
    description: "Search the web for information using multiple search engines. Returns fused, deduplicated results with RRF ranking. mode=answer returns provider-generated answers (Exa/Tavily only, unverified) alongside results; answers are provider-side, not synthesized locally.",
    parameters: Type.Object({
      query: Type.String({ description: "The search query" }),
      mode: Type.Optional(Type.Union([
        Type.Literal("fast"),
        Type.Literal("index"),
        Type.Literal("deep"),
        Type.Literal("answer"),
      ], { description: "Search mode: fast (default), index, deep (more sources), answer (provider-generated answer, available only when provider supports it)" })),
    }),
    execute: async (_toolCallId: string, params: any, signal?: AbortSignal) => {
      const q: Query = {
        query: String(params.query),
        mode: (params.mode as "fast" | "index" | "deep" | "answer") || "fast",
        // pass the caller span through so retrieval
        // domain_filter.* audit events + anysearch.outcome land inside the
        // caller's trace (ans_chat path). Single span, multi-event — no
        // sub-spans per agent-loop turn.
        ...(span ? { span } : {}),
        // Design: forward the agent run's active signal into the retrieval
        // query — a cancelled ans_chat then aborts an in-flight internal
        // search through the engine's #209 caller-signal seam.
        ...(signal ? { signal } : {}),
      };
      const rawEnvelope = await retriever.search(q);
      onResults?.((rawEnvelope.results ?? []).map((r) => r.url));
      // #259: archive this search so a later call — same session or another one —
      // can recall the material instead of searching again.
      // #263: the write also reports which row each result landed in, and those
      // ids are stamped onto the results BELOW — the model reads that JSON, so
      // it is the only place a later summary can recover which version it saw.
      const archiveIds = await indexSearchResults(archive, rawEnvelope.results, signal);
      const envelope = stampArchiveRowIds(rawEnvelope, archiveIds);
      // every retrieved payload crosses the LLM boundary through wrapRetrieved
      // (Anthropic tool_result wire format). The full envelope JSON rides in snippet untruncated
      // ponytail: schema maxLength(4000) is not enforced here; downstream parses via unwrapRetrieved.
      const tagged: RetrievalContent = {
        schema: RETRIEVAL_CONTENT_SCHEMA_URL,
        version: CONTENT_TRUST_SCHEMA_VERSION,
        url: "search://envelope/" + _toolCallId,
        title: q.query,
        snippet: JSON.stringify(envelope),
        source: "engine",
        label: { source: "retrieved", traceId: "search-" + _toolCallId },
        disposal: "accepted",
      };
      const summary = wrapRetrieved(tagged).content[0]!.text;
      return {
        content: [{ type: "text", text: summary }],
        details: {
          resultCount: envelope.results?.length || 0,
          // expose answers + provenance as first-class details.
          answerCount: envelope.answers?.length || 0,
          providerAnswers: envelope.metadata?.providerAnswers ?? [],
        },
      };
    },
  };
}

// Build systemPrompt from domain prompts layer.
function buildSystemPrompt(domain: DomainConfigPort): string {
  const prompts = domain.prompts.map(p => p.content).join("\n\n");
  return prompts || "You are a helpful research assistant with web search capabilities.";
}

// Name of the kernel's built-in retrieval tool (createSearchTool).
export const BUILTIN_SEARCH_TOOL = "search";

// Filter AgentTools by domain skills.active + hooks.toolWhitelist.
// Exported for the shipped-domain regression test (r19 T1, 2026-10-22).
// Design: the skill→tool mapping is declarative ([skills.toolRequires]), not derived
// — pi-agent-core Skill is a pure prompt carrier and carries no tool binding (#90).
// hooks.toolWhitelist stays the security upper bound. When the domain declares the
// field, the effective set is whitelist ∩ (∪ toolRequires[active skills] ∪ {built-in
// search}) and skills.active becomes a real activation filter. Without the field the
// union is taken as "everything", preserving the pre-toolRequires behavior (an
// explicitly empty map degrades the same way).
export function filterAgentTools(tools: AgentTool[], domain: DomainConfigPort): AgentTool[] {
  const whitelist = new Set(domain.hooks.toolWhitelist);
  const toolRequires = domain.skills.toolRequires;
  const declared = !!toolRequires && Object.keys(toolRequires).length > 0;
  // No declared map: whitelist alone decides; an empty whitelist means no
  // filter at all (pre-#102 behavior).
  if (!declared) {
    if (whitelist.size === 0) return tools;
    return tools.filter(t => whitelist.has(t.name));
  }
  const allowed = new Set<string>([BUILTIN_SEARCH_TOOL]);
  for (const skill of domain.skills.active) {
    // own-property check: "constructor"/"toString" are legal skill names, and
    // the inherited prototype member must contribute nothing (not throw).
    for (const t of (Object.hasOwn(toolRequires, skill) ? toolRequires[skill] : [])) allowed.add(t);
  }
  // Declared map: skills.active filters even when the whitelist is empty
  // (empty whitelist = security upper bound wide open, not a no-op).
  if (whitelist.size === 0) return tools.filter(t => allowed.has(t.name));
  return tools.filter(t => whitelist.has(t.name) && allowed.has(t.name));
}

export interface PiAgentRuntimeOptions {
  retriever: RetrieverPort;
  store?: SessionStorePort;
  domain: DomainConfigPort;
  // when set, the allow/deny lists are re-read lazily per tool call via mtime.
  domainTomlPath?: string;
  // #188 (CodeRabbit): the host's domain search dirs, so the run-boundary
  // reloader can resolve a base TOML that lives only in a host-specific dir
  // (e.g. the MCP packaged domains dir), not just dirname(tomlPath)/cwd.
  domainsDirs?: string[];
  model: unknown; // pi-ai Model instance
  streamFn: unknown; // models.streamSimple.bind(models)
  models?: unknown; // Models object for summary generation
  /** API key handed to the PI provider registration; never logged. */
  apiKey?: string;
  ledger?: BudgetLedgerPort;
  sessionId?: string;
  /**
   * Directory for PI's append-only JSONL session records. When set together
   * with an anysearch sessionId, each session resumes its own record; when
   * absent the PI session stays in memory (#258).
   */
  piSessionDir?: string;
  /**
   * Cross-process session lock windows (#266). `staleMs` is how long a lock
   * whose owner cannot be confirmed stays protected (default 10 min);
   * `waitMs` is the same-session wait cap before the run fails with
   * "session busy" (default 120 s). Parsed from ANS_PI_LOCK_STALE_MS /
   * ANS_PI_LOCK_TIMEOUT_MS by piSessionOptions.
   */
  sessionLock?: SessionLockWindows;
  /** Working directory for the PI session and resource loader. Defaults to cwd. */
  cwd?: string;
  /** PI auto-compaction thresholds (enabled unless explicitly disabled). */
  piCompaction?: { enabled?: boolean; reserveTokens?: number; keepRecentTokens?: number };
  tools?: AgentTool[]; // extra tools beyond search
  getApiKey?: () => Promise<string | undefined>;
  /** #113: REAL model context window (LlmSession.contextWindow); undefined = unknown. */
  contextWindow?: number;
  interactive?: boolean; // wiring grants TTY-ask eligibility (headless/MCP omit -> deny-first)
  // caller observation span — retrieval audit events land
  // inside the caller's span events_json (ans_chat / third retrieval surface).
  span?: RetrievalObservationSink;
  // #211: caller cancellation (the MCP request signal for ans_chat). When it
  // aborts, the active Agent is aborted and run() ends without the completion
  // path — no done summary, no FTS sync, no memory consolidation, and no
  // completion-shaped budget settlement. An already-aborted signal starts no
  // provider call and reserves no budget.
  signal?: AbortSignal;
}

// pure event mapping extracted for tests — pi-ai's
// AssistantMessageEvent union has NO "text" type; text streams as
// text_delta.delta chunks (+ text_end.content as non-streamed fallback).
// state.textSeen resets per message_start so a final text_end only fills in
// when no deltas arrived.
export function mapAssistantMessageEvent(
  ame: { type?: string; delta?: unknown; content?: unknown; text?: unknown } | undefined,
  state: { textSeen: boolean },
): AgentEvent | null {
  if (ame?.type === "text_delta" && typeof ame.delta === "string") {
    state.textSeen = true;
    return { type: "text", content: ame.delta };
  }
  if (ame?.type === "text_end" && !state.textSeen && typeof ame.content === "string" && ame.content) {
    return { type: "text", content: ame.content };
  }
  if (ame?.type === "text" && typeof ame.text === "string" && ame.text) {
    // Defensive: some pi-ai versions emitted a monolithic "text" event.
    state.textSeen = true;
    return { type: "text", content: ame.text };
  }
  return null;
}

// #113: current-context occupancy for the L0 watermark. `lastUsageTokens` is
// the provider-reported usage of the most recent assistant call; the estimate
// adds messages appended after that call (tool results, user turns) — exactly
// the lag window CodeRabbit flagged on PR #114. max() keeps a provider report
// that is larger than the local estimate from being under-counted.
export function resolveContextOccupancy(lastUsageTokens: number, messages: any[]): number {
  const estimated = estimateTranscriptTokens(messages);
  return Math.max(Number(lastUsageTokens) || 0, estimated);
}

/**
 * Input side of the pre-run token reserve (#188).
 *
 * Reuse resolveContextOccupancy's provider-usage anchor when the context carries
 * one: `lastUsageTokens` is the most recent message_end totalTokens and
 * `messages` is the transcript handed to the run. When both are empty the run
 * is a cold start — which is the normal shape here, because every run builds a
 * fresh pi-agent-core Agent — so fall back to estimating the request that is
 * about to be sent (system prompt + user prompt). An estimate, not a historical
 * rolling average: #186 decision 2 rejects rolling averages as point forecasts.
 */
export function resolveReserveInputTokens(
  lastUsageTokens: number,
  messages: any[],
  prompt: string,
  systemPrompt: string,
): { tokens: number; coldStart: boolean } {
  const anchor = Number(lastUsageTokens) || 0;
  const transcript = Array.isArray(messages) ? messages : [];
  // 1.5.1 folds the system prompt AND the tool declarations into a leading
  // system message inside the session transcript. That message is the request's
  // static head, not carried conversation: counting it as history would skip the
  // cold-start branch and count the tool declarations twice (#258).
  const conversation = transcript.filter((m: any) => m?.role !== "system");
  if (anchor > 0 || conversation.length > 0) {
    // Occupancy covers the carried transcript, but this run's own request is
    // not in it yet: the new prompt and the system head have not been sent,
    // and the call site passes anchor 0. Count both once here, or a resumed
    // turn with a long question and a long system prompt under-reserves and
    // the token cap stops catching it.
    let tokens = resolveContextOccupancy(anchor, conversation);
    try {
      tokens += Math.ceil(estimateTranscriptTokens([{ role: "user", content: prompt }] as any));
      if (systemPrompt) {
        tokens += Math.ceil(estimateTranscriptTokens([{ role: "user", content: systemPrompt }] as any));
      }
    } catch { /* fail-open: the carried-transcript estimate still counts */ }
    return { tokens, coldStart: false };
  }
  let tokens = 0;
  try {
    // The estimator only reads `role`/`content`; wrapping the system prompt in a
    // user-shaped message puts it inside the same character estimate (a "system"
    // role is not an agent message role and would count as 0).
    tokens += Math.ceil(estimateTranscriptTokens([{ role: "user", content: prompt }] as any));
    if (systemPrompt) {
      tokens += Math.ceil(estimateTranscriptTokens([{ role: "user", content: systemPrompt }] as any));
    }
  } catch { /* fail-open: the output reserve alone is still a valid lower bound */ }
  return { tokens, coldStart: true };
}

/**
 * Reserve amount = input-side occupancy + output-side static limit (#188).
 * Non-finite/negative inputs contribute 0 rather than poisoning the ledger
 * amount with NaN (better-sqlite3 would bind it as text/NULL).
 */
export function resolveTokenReserve(inputTokens: number, outputReserveTokens: number): number {
  const input = Number.isFinite(inputTokens) ? Math.max(0, inputTokens) : 0;
  const output = Number.isFinite(outputReserveTokens) ? Math.max(0, outputReserveTokens) : 0;
  return input + output;
}

// Design: same session -> one run at a time, different sessions in parallel —
// one PI record has one writer, and two runs appending to it at once would
// interleave entries. This queue is the in-process half; the cross-process
// half is the file lock in ./session-lock (#266). Both waits share one
// deadline, so a same-session caller hits the same wait cap either way.
const sessionQueues = new Map<string, Promise<void>>();

async function acquireSessionQueue(key: string, deadlineAt: number, signal?: AbortSignal): Promise<() => void> {
  const previous = sessionQueues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const tail = previous.then(() => current);
  sessionQueues.set(key, tail);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(SESSION_BUSY_MESSAGE)), Math.max(0, deadlineAt - Date.now()));
    timer.unref?.();
    // #259: a caller who gave up while queued must not be held for the whole
    // cap. The wait ends here; run()'s finally releases what was already
    // acquired, and the catch below hands this slot on.
    if (signal) {
      onAbort = () => reject(new Error(SESSION_BUSY_MESSAGE));
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }
  });
  try {
    await Promise.race([previous, expired]);
  } catch (e) {
    // Resolve our slot so later waiters chain onto a settled promise instead
    // of hanging on one nobody will ever release; the abandoned request runs
    // nothing, so there is nothing to interleave.
    release();
    throw e;
  } finally {
    clearTimeout(timer);
    if (onAbort) signal?.removeEventListener("abort", onAbort);
  }
  return () => {
    release();
    if (sessionQueues.get(key) === tail) sessionQueues.delete(key);
  };
}

// Credential handed to the synthetic provider registration when the caller has
// none of its own. PI refuses a provider with no auth method, but this value
// must never travel onward: pi-ai treats any non-empty apiKey as authoritative
// and would skip the provider's env fallback. streamSimple strips it.
export const PLACEHOLDER_API_KEY = "anysearch-local-stream";

// The cwd a PI session record is stamped with. Fixed on purpose: PI's
// findById filters by the recorded cwd whenever a custom session dir is used,
// which would make the same anysearch handle unresumable from another
// directory. A record belongs to the handle, not to the folder it ran in.
export const SESSION_RECORD_CWD = "anysearch-session";

// Stable PI session id per AnySearch session handle. Hashing keeps arbitrary
// visible-ASCII handles out of file names.
export function piSessionKey(sessionId: string): string {
  return "ans-" + createHash("sha256").update(sessionId).digest("hex").slice(0, 32);
}

function mapSessionEvent(event: any, buffer: AgentEvent[], state: { textSeen: boolean }): void {
  switch (event.type) {
    case "message_start":
      state.textSeen = false;
      break;
    case "message_update": {
      const mapped = mapAssistantMessageEvent(event.assistantMessageEvent, state);
      if (mapped) buffer.push(mapped);
      break;
    }
    case "tool_execution_start":
      buffer.push({ type: "tool_call", name: event.toolName, args: event.args });
      if (event.toolName === BUILTIN_SEARCH_TOOL) {
        buffer.push({ type: "search", query: String(event.args?.query || "") });
      }
      break;
    case "tool_execution_end":
      buffer.push({ type: "tool_result", name: event.toolName, result: event.result });
      if (event.toolName === BUILTIN_SEARCH_TOOL) {
        buffer.push({ type: "search_result", envelope: event.result });
      }
      break;
  }
}

export class PiAgentRuntime {
  private opts: PiAgentRuntimeOptions;
  private readonly domainReloader: (() => unknown) | null;
  private warnedEnvIgnored = false;
  // #188: a TOML change consumed by beforeToolCall (mid-run) must still refresh
  // the ledger caps, but the next run's reloader sees no new file change. Keep
  // the detection until the next run boundary consumes it.
  private pendingBudgetRefresh = false;
  private pipeline?: MemoryPipeline;
  private gate?: SufficiencyEvaluator;
  // T2 #177: every internal retrieval (search tool, sufficiency rerounds) goes
  // through this retriever so the wired session handle rides along. The gate
  // mirrors MemoryPipeline (`store && sessionId`): a half-wired runtime stays a
  // no-memory/no-billing runtime instead of hitting budget_ledger's FK on an
  // unregistered session id.
  private readonly scopedRetriever: RetrieverPort;
  // #259: the cancellation scope of the run currently in progress. Set for the
  // duration of a run; the sufficiency gate reads it so a reround stops when the
  // run does (not only when the caller aborts).
  private activeRunSignal?: AbortSignal;
  // The controller behind `activeRunSignal`, so the outer `run()` exit path can
  // abort it (`.return()` on the consumer generator lands there first).
  private runScopeController?: AbortController;
  // #259: the one archive writer this runtime has — `store && sessionId`, the
  // same gate the pipeline uses. Absent for a half-wired runtime, which then
  // indexes nothing.
  private readonly archive?: { store: SessionStorePort; sessionId: string };
  // How much of the memory pipeline's own spend has already been settled, so a
  // repeated flushMemory adds only the new delta instead of billing twice.
  private settledMemoryTokens = 0;
  private settledMemoryCostUsd = 0;

  constructor(opts: PiAgentRuntimeOptions) {
    this.domainReloader = opts.domainTomlPath ? createDomainReloader(opts.domainTomlPath, opts.domainsDirs, { forceFirst: true }) : null;
    // acceptance-4: the override switch is a strict enum at EVERY runtime
    // (server, hook, kernel), not just the plugin server. Misset -> throw at startup.
    parseEnvOverrideSwitch(process.env[ENV_ALLOW_OVERRIDE]);
    this.opts = opts;
    // T2 #177: one scoped retriever for the whole runtime. `store && sessionId`
    // is the same gate MemoryPipeline uses — the handle is only trusted when the
    // store is wired too. PREcondition: the wiring has registered the
    // session row (ensureSession) before the first search; otherwise the
    // resume_anchors FK would reject the anchor write. `opts` is not mutated
    // after construction, so this captured id is the runtime's only session id.
    const wiredSessionId = opts.store && opts.sessionId ? opts.sessionId : undefined;
    this.archive = wiredSessionId ? { store: opts.store!, sessionId: wiredSessionId } : undefined;
    this.scopedRetriever = wiredSessionId
      ? { search: (q) => opts.retriever.search({ ...q, sessionId: q.sessionId ?? wiredSessionId }) }
      : opts.retriever;

    // constructor internally creates pipeline + gate instances.
    // The caller supplies the wiring; caller opts unchanged.
    // Design: the gate stays exactly `store && sessionId` — narrowing it here
    // would change every startup path, far beyond this boundary (#129).
    // What was missing is not the gate but a TRACE: a root that omitted either
    // half got a pipeline-less runtime with no signal, which is why `ans chat`
    // and `ans_chat` ran without memory for so long. Both-absent remains a
    // supported "no memory" runtime, but it now announces itself instead of
    // degrading silently.
    if (opts.store && opts.sessionId) {
      this.pipeline = new MemoryPipeline({
        store: opts.store,
        models: opts.models as any,
        retriever: this.scopedRetriever,
        domain: opts.domain,
        model: opts.model as any,
        streamFn: opts.streamFn as any,
        sessionId: opts.sessionId,
        getApiKey: opts.getApiKey,
        providerName: (opts as any).providerName,
        contextWindow: opts.contextWindow,
      });
    } else {
      warnMissingMemoryWiring(opts);
    }
    this.gate = new SufficiencyEvaluator({
      retriever: this.scopedRetriever,
      domain: opts.domain,
      streamFn: opts.streamFn as any,
      model: opts.model as any,
      getApiKey: opts.getApiKey,
      // #259: the reround indexes into the same archive as the search tool.
      // Same gate as the pipeline above (store + sessionId); a half-wired
      // runtime writes nothing, so it cannot seed rows the recall path would
      // then treat as shared material.
      //
      // The write checks the scope the gate hands in, captured for that
      // evaluation. It must NOT re-read `activeRunSignal` here: an abort clears
      // that field, so the re-read would come back `undefined` and the write
      // would go through — the hole this guard exists to close.
      ...(this.archive
        ? { archive: (results: unknown[], signal?: AbortSignal) => indexSearchResults(this.archive, results, signal).then(() => undefined) }
        : {}),
    });
  }

  // run returns AsyncIterable<AgentEvent>, mapping PI session events.
  // Serialization: same session -> one run at a time (the process-local queue
  // above plus the cross-process file lock); different sessions run in
  // parallel. The file lock only exists when the PI record is durable (#258):
  // an in-memory session cannot be shared with another process in the first
  // place (#266).
  async *run(input: string): AsyncIterable<AgentEvent> {
    if (this.opts.signal?.aborted) return;
    const key = this.opts.sessionId ?? "";
    // Design: the queue and the file lock share one deadline — a same-session
    // caller must hit the same 120 s cap whether the current run is in this
    // process or another one, and splitting the budget would let a caller wait
    // twice as long for the same "session busy" answer. Both waits surface as
    // an error event, like every other run failure.
    const windows = resolveSessionLockWindows(this.opts.sessionLock);
    const deadlineAt = Date.now() + windows.waitMs;
    let releaseQueue: () => void = () => {};
    let releaseLock: (() => void) | undefined;
    try {
      if (key) releaseQueue = await acquireSessionQueue(key, deadlineAt, this.opts.signal);
      if (this.opts.piSessionDir && key) {
        const lockPath = join(this.opts.piSessionDir, SESSION_LOCKS_DIRNAME, piSessionKey(key) + ".lock");
        // The lock gets whatever is left of the shared budget, so the two
        // waits never add up past the cap.
        releaseLock = await acquireSessionLock(lockPath, {
          staleMs: windows.staleMs,
          waitMs: Math.max(1, deadlineAt - Date.now()),
        });
      }
      yield* this.runInternal(input);
    } catch (e) {
      yield { type: "error", message: e instanceof Error ? e.message : String(e) };
    } finally {
      // #259: a consumer that stops reading (`.return()`) lands HERE first —
      // before runInternal's own finally runs. Closing the run's cancellation
      // scope now is what stops an in-flight reround from archiving after
      // nobody is waiting for the answer.
      try { this.runScopeController?.abort("consumer stopped reading"); } catch { /* already aborted */ }
      this.activeRunSignal = undefined;
      this.runScopeController = undefined;
      releaseLock?.();
      releaseQueue();
    }
  }

  private async *runInternal(input: string): AsyncIterable<AgentEvent> {
    // #211: a signal that is already aborted means the caller gave up before
    // this run began. Do not start a provider call, reserve budget, or touch
    // session state for a request nobody is waiting for.
    const callerSignal = this.opts.signal;
    if (callerSignal?.aborted) return;

    // #259: one cancellation scope for this run. It covers the caller's abort
    // AND the runtime's own stop (the consumer closing the stream, the wall-clock
    // timeout, an early return). Anything that keeps working after a stop — the
    // sufficiency reround in particular — checks this instead of the caller
    // signal, which is absent on those paths and would let a late reround write
    // rows into a database other sessions read.
    const runAbort = new AbortController();
    this.activeRunSignal = runAbort.signal;
    this.runScopeController = runAbort;
    const runScope = (): AbortSignal => runAbort.signal;
    const stopRunScope = (reason: string): void => {
      try { runAbort.abort(reason); } catch { /* already aborted */ }
      if (this.activeRunSignal === runAbort.signal) this.activeRunSignal = undefined;
      if (this.runScopeController === runAbort) this.runScopeController = undefined;
    };
    // A caller-signal abort has to reach the scope as well, and it may arrive
    // before `cancelRun` is installed below; wire it here so the window is
    // closed from the very start of the run. Named so the exit path can remove
    // it: an unremoved listener would pile up on a long-lived signal.
    const onCallerAbort = (): void => { runAbort.abort("caller cancelled"); };
    callerSignal?.addEventListener("abort", onCallerAbort, { once: true });

    // SECURITY: timeout to prevent agent loop hang (CWE-400, CWE-840).
    // ponytail: 5-minute default, override via opts.timeoutMs.
    const timeoutMs = (this.opts as any).timeoutMs ?? 300000;
    const startTime = Date.now();
    const timedOut = () => Date.now() - startTime > timeoutMs;

    // #188: re-read the Active Domain at the run boundary so a live TOML edit
    // (budget raise, output-reserve override) takes effect on the next run
    // instead of waiting for a process restart. Fail-open: a bad/partial TOML
    // keeps the last known good domain, mirroring beforeToolCall's reload.
    const reloadedDomain = this.domainReloader ? this.domainReloader() : null;
    if (reloadedDomain) (this.opts as { domain: DomainConfigPort }).domain = reloadedDomain as DomainConfigPort;

    const { domain, model, streamFn, store, ledger, sessionId } = this.opts;

    // Build tools: search tool + any extra tools, filtered by domain.
    const saturation = new SearchSaturation();
    const searchTool = createSearchTool(this.scopedRetriever, this.opts.span, (urls) => saturation.record(urls), this.archive);
    const allTools = [searchTool, ...(this.opts.tools || [])];
    const activeTools = filterAgentTools(allTools, domain);

    // The domain's prompt layer becomes the session system prompt.
    const systemPrompt = buildSystemPrompt(domain);

    // Token/USD budget tracking (amended #103):
    // accumulated from message_end events, settled at the end of the run.
    const usageTotals = emptyUsageTotals();
    // #188 (CodeRabbit): distinguish "provider reported zero" from "abort cut the
    // final usage chunk off". Only an actual assistant usage report counts as a
    // genuine zero; missing usage after abort is reconciled conservatively.
    let usageReported = false;

    // Event buffer: collect events from subscribe() to yield them.
    const eventBuffer: AgentEvent[] = [];
    let resolveEvent: (() => void) | null = null;
    let agentDone = false;
    let agentError: string | null = null;
    // #211: set by the caller-signal listener below. It gates the event loop
    // and the completion path (settlement, FTS sync, done summary), so a
    // cancelled chat is never recorded as a finished run.
    let callerCancelled = false;
    const wakeGenerator = () => {
      if (resolveEvent) {
        const wake = resolveEvent;
        resolveEvent = null;
        wake();
      }
    };

    // What the sufficiency gate wants to change for the NEXT request, scoped to
    // this run. PI rebuilds the request from the session record in
    // prepareRequest — and may compact there — so handing it a whole message
    // array would resurrect history compaction just removed. This carries only
    // the rewritten tool-result text, keyed by tool call, and prepareRequest
    // applies it on top of whatever PI projected.
    let pendingToolResultEnrichment: { toolCallId: string; text: string } | null = null;

    // Full PI SDK session. The provider registration below routes every model
    // call back through the caller's streamFn, so auth/baseUrl stay owned by
    // llm-init while session persistence, resume, compaction and accounting come
    // from pi-coding-agent (#258).
    const cwd = this.opts.cwd ?? process.cwd();
    const baseModel = (model ?? {}) as any;
    const modelId = typeof baseModel.id === "string" && baseModel.id ? baseModel.id : "anysearch-model";
    const api = typeof baseModel.api === "string" && baseModel.api ? baseModel.api : "openai-completions";
    // The declared window is what the session, the compaction trigger and the
    // budget estimate all read. An unknown custom endpoint falls back to the
    // absolute 128K floor; nothing is promoted to 1M.
    const contextWindow =
      this.opts.contextWindow && this.opts.contextWindow > 0
        ? this.opts.contextWindow
        : (Number(baseModel.contextWindow) > 0 ? Number(baseModel.contextWindow) : 128000);
    const sdkProviderId = "anysearch";
    // The one place the PI SDK is loaded: a run is the only thing that needs it.
    const sdk = await loadPiCodingAgent();
    const modelRuntime = await sdk.ModelRuntime.create({ modelsPath: null, refreshOnCreate: false, allowModelNetwork: false });
    // Design: register a synthetic provider whose streamSimple is a thin bridge
    // back to the caller's streamFn — auth, base URL and wire format stay owned
    // by llm-init (one place decides what endpoint is talked to), while PI
    // gains a model it can budget, compact and report against.
    modelRuntime.registerProvider(sdkProviderId, {
      name: "AnySearch",
      // Required by the provider composer even though streamSimple below never
      // dials it; the real endpoint stays on the llm-init model.
      baseUrl: typeof baseModel.baseUrl === "string" && baseModel.baseUrl ? baseModel.baseUrl : "http://127.0.0.1:1/v1",
      // Placeholder credential: the provider composer refuses a provider with
      // no auth method, and our streamFn resolves the real key itself.
      //
      // It must never reach the caller's streamFn, though: pi-ai treats a
      // non-empty `apiKey` as authoritative and skips the provider's own env
      // fallback (getClientApiKey returns it as-is), so forwarding this
      // placeholder would shadow OPENAI_API_KEY and break catalog auth.
      // streamSimple below therefore drops it again. Never printed.
      apiKey: this.opts.apiKey || PLACEHOLDER_API_KEY,
      api,
      models: [{
        id: modelId,
        name: typeof baseModel.name === "string" ? baseModel.name : modelId,
        api,
        input: Array.isArray(baseModel.input) ? baseModel.input : ["text"],
        cost: baseModel.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        reasoning: Boolean(baseModel.reasoning),
        contextWindow,
        maxTokens: Number(baseModel.maxTokens) > 0 ? Number(baseModel.maxTokens) : 8192,
      }],
      // Ignore the registered model: the stream function owns auth and wire
      // config, so catalog and custom-endpoint paths behave identically. The
      // placeholder apiKey PI resolved for this synthetic provider is stripped
      // for the same reason — the caller's own auth must win.
      streamSimple: (_model, context, options) => {
        const forwarded = options && typeof options === "object"
          ? { ...options, apiKey: PLACEHOLDER_API_KEY === options.apiKey ? undefined : options.apiKey }
          : options;
        return (streamFn as any)(baseModel, context, forwarded);
      },
    });
    const sdkModel = modelRuntime.getModel(sdkProviderId, modelId);
    if (!sdkModel) throw new Error("PI provider registration did not expose " + modelId);

    // Design: a session handle plus a session dir means PI keeps an append-only
    // record and a later run with the same handle resumes it; without either
    // there is nothing to key a record on, so the session stays in memory.
    const persistentDir = this.opts.piSessionDir && sessionId ? this.opts.piSessionDir : undefined;
    const agentDir = persistentDir ? join(persistentDir, "agent") : join(cwd, ".anysearch", "pi-agent");
    let sessionManager: import("@earendil-works/pi-coding-agent").SessionManager;
    if (persistentDir) {
      mkdirSync(persistentDir, { recursive: true });
      const piKey = piSessionKey(sessionId!);
      // Resume the same handle's record when it exists; a restart then picks up
      // the whole transcript, not just the memory anchors.
      //
      // findById filters by the cwd recorded in the session header whenever a
      // custom session dir is in use, so passing the caller's cwd would hide a
      // record the same handle created from a different directory (`ans chat`
      // run in another folder, or MCP started elsewhere). Look the record up
      // from a fixed anchor instead: the anysearch handle identifies a
      // session, not the working directory it happened to run in.
      const found = sdk.SessionManager.findById(SESSION_RECORD_CWD, piKey, persistentDir);
      sessionManager = found
        ? sdk.SessionManager.open(found, persistentDir, cwd)
        : sdk.SessionManager.create(SESSION_RECORD_CWD, persistentDir, { id: piKey });
    } else {
      sessionManager = sdk.SessionManager.inMemory(cwd);
    }
    const piCompaction = this.opts.piCompaction ?? {};
    const settingsManager = sdk.SettingsManager.inMemory({
      compaction: {
        enabled: piCompaction.enabled ?? true,
        reserveTokens: piCompaction.reserveTokens ?? 16384,
        keepRecentTokens: piCompaction.keepRecentTokens ?? 20000,
      },
    });

    // PI's own compaction is a real provider call, so it gets its own ledger
    // rather than being folded into the run's assistant calls. accumulateUsage
    // applies the same cost-provenance rule as the main run.
    const compactionUsage = emptyUsageTotals();
    // Every message finalized in this run. The FTS sync uses this instead of the
    // whole resumed transcript, which would duplicate rows on every call.
    const runMessages: Array<{ role?: string; content?: unknown }> = [];

    // The runtime's memory injection, tool policy and accounting ride the
    // official extension seam. AgentSession owns the turn loop, so wrapping its
    // hooks (rather than re-implementing them) is what keeps compaction and
    // boundary handling from PI intact.
    const controlFactory: import("@earendil-works/pi-coding-agent").ExtensionFactory = (pi) => {
      // Called before every provider request; PI restores system messages
      // afterwards, so the injected block never accumulates in the record.
      pi.on("context", async (event) => {
        if (!this.pipeline) return undefined;
        const injected = await this.pipeline.inject(event.messages as any);
        return { messages: injected as any };
      });
      pi.on("tool_call", async (event) => {
        // saturation stop — block further searches, let the model answer.
        if (event.toolName === BUILTIN_SEARCH_TOOL && saturation.exhausted()) {
          return { block: true, reason: saturation.reason() };
        }
        // lazy mtime-checked re-read; bad TOML keeps last known good.
        const reloaded = this.domainReloader ? this.domainReloader() : null;
        if (reloaded) {
          (this.opts as { domain: DomainConfigPort }).domain = reloaded as DomainConfigPort;
          // The next run's mtime probe will see no change; remember this one so
          // the budget caps still refresh at that run boundary.
          this.pendingBudgetRefresh = true;
        }
        // single parse point: the same canonicalize+merge+strict-switch
        // resolver the server and hooks use.
        const src = (this.opts.domain as { sources?: { urlAllowlist?: string[]; urlDenylist?: string[] } } | undefined)?.sources;
        const policy = resolveUrlPolicy({ tomlHosts: src?.urlAllowlist ?? [], denyHosts: src?.urlDenylist ?? [] });
        if (policy.envHostsIgnored && !this.warnedEnvIgnored) {
          this.warnedEnvIgnored = true;
          process.stderr.write("[anysearch] " + ENV_URL_ALLOWLIST + " ignored; set " + ENV_ALLOW_OVERRIDE + "=1 to opt in\n");
        }
        const urls: string[] = JSON.stringify(event.input ?? {}).match(/https?:\/\/[^\s"'<>\\)]+/g) ?? [];
        for (const url of urls) {
          const label: SourceTraceLabel = typeof input === "string" && input.includes(url)
            ? { source: "user", traceId: "user-input" }
            : { source: "retrieved", traceId: "tool-call" };
          const verdict = shouldAllowUrl(url, label, policy.allow, policy.deny);
          if (verdict.allowed) continue;
          if (!verdict.requiresHitl) {
            return { block: true, reason: "URL rejected by trust boundary: " + url, terminate: true };
          }
          if ((this.opts.interactive ?? false) && isInteractive() && (await askAllowUrl(url))) continue;
          let host = "";
          try { host = new URL(url).hostname; } catch { /* keep empty */ }
          enqueueHitl({
            url,
            host,
            toolName: String(event.toolName ?? "unknown"),
            reason: "retrieved-derived URL blocked pending human review",
          });
          return {
            block: true,
            reason: "Blocked retrieved-derived URL " + url + " (queued for `ans hitl review`)",
            terminate: true,
          };
        }
        return undefined;
      });
      // #103: accounting from the official message_end event. Absent usage stays
      // absent so a later report can say "unavailable" instead of "free".
      pi.on("message_end", async (event) => {
        const message = event.message as any;
        accumulateUsage(usageTotals, message);
        if (message?.role === "assistant" && message?.usage) usageReported = true;
        if (message?.role !== "system") runMessages.push(message);
        return undefined;
      });
    };

    const resourceLoader = new sdk.DefaultResourceLoader({
      cwd,
      agentDir,
      settingsManager,
      systemPrompt,
      // Zero host discovery: no extensions, skills, prompts, themes, or
      // AGENTS.md from the operator's environment (#258).
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      extensionFactories: [{ name: "anysearch-control", factory: controlFactory }],
    });
    await resourceLoader.reload();

    const created = await sdk.createAgentSession({
      cwd,
      agentDir,
      modelRuntime,
      model: sdkModel,
      thinkingLevel: "off",
      settingsManager,
      resourceLoader,
      sessionManager,
      // The whitelist-filtered set is both the executable set and the declared
      // set, so PI cannot expose a tool the domain excluded.
      customTools: activeTools as unknown as import("@earendil-works/pi-coding-agent").ToolDefinition[],
      tools: activeTools.map((t) => t.name),
    });
    const session = created.session;
    const agent = session.agent;

    // finishTurn and prepareNextTurnWithContext chain their predecessors, so the
    // sufficiency gate wraps the session's own hooks without losing compaction,
    // boundary, or tool-loadout handling.
    const sessionFinishTurn = agent.finishTurn;
    (agent as any).finishTurn = async (turn: any, signal?: AbortSignal) => {
      // Design: an aborted run stops the turn loop before the cold memory path
      // — no gate/consolidate anchor is written after cancellation.
      if (signal?.aborted) return { action: "end" as const };
      const messages = turn?.context?.messages ?? agent.state?.messages ?? [];
      const conversation = messages.filter((m: any) => m?.role !== "system");
      // #113: current context occupancy, not cumulative run spend.
      const totalTokens = resolveContextOccupancy(usageTotals.lastTotalTokens, conversation);
      const toolResults: any[] = Array.isArray(turn?.toolResults) ? turn.toolResults : [];
      const hasSearchTurn = toolResults.some((r: any) => String(r?.toolName ?? "").includes("search"))
        || (typeof turn?.lastToolName === "string" && turn.lastToolName.includes("search"));
      // 3-line sequential call — evaluate -> applyTo -> consolidate.
      if (this.gate && this.pipeline) {
        try {
          // #259: hand the gate this run's cancellation scope, so a stop arriving
          // mid-evaluation (consumer closed the stream, timeout) stops the reround
          // and its archive write instead of letting it run on unattended.
          // Both signals count: PI's turn signal and the run scope. Honouring
          // only one means a stop arriving on the other is ignored and the
          // reround keeps running.
          const env = await this.gate.evaluate(messages, AbortSignal.any([signal ?? runScope(), runScope()]));
          const enriched = this.gate.applyTo(messages, env);
          if (env.enrichedEnvelope !== null && enriched !== messages) {
            // Keep just the rewritten tool-result text. The rest of the array is
            // PI's business, and compaction may replace it before this is used.
            const target = messages[env.targetMessageIndex] as any;
            const replacement = (enriched[env.targetMessageIndex] as any)?.content;
            const toolCallId = String(target?.toolCallId ?? "");
            const text = Array.isArray(replacement)
              ? replacement.map((c: any) => (typeof c?.text === "string" ? c.text : "")).join("")
              : "";
            if (toolCallId && text) pendingToolResultEnrichment = { toolCallId, text };
          }
          await this.pipeline.consolidate(enriched, totalTokens, env.hasRetrievalEvidence || hasSearchTurn);
        } catch { /* fail-open: a memory fault must not end the turn */ }
      } else if (this.pipeline) {
        try { await this.pipeline.consolidate(messages, totalTokens, hasSearchTurn); } catch { /* fail-open */ }
      }
      return sessionFinishTurn?.(turn, signal);
    };
    // PI rebuilds the request context from the session record in prepareRequest
    // (and may compact there), so the enriched transcript cannot replace the
    // message array: that would resurrect history compaction just dropped.
    // Only the gate's rewritten tool-result text is applied, on top of whatever
    // PI projected.
    const sessionPrepareRequest = agent.prepareRequest;
    (agent as any).prepareRequest = async (request: any, signal?: AbortSignal) => {
      const prepared = await sessionPrepareRequest?.(request, signal);
      const pending = pendingToolResultEnrichment;
      if (!pending) return prepared;
      pendingToolResultEnrichment = null;
      const base = prepared?.context ?? request?.context ?? {};
      const messages: any[] = Array.isArray(base.messages) ? base.messages : [];
      // A compacted transcript may no longer contain the target tool result;
      // then there is nothing to rewrite and PI's projection stands.
      const patched = messages.map((message: any) => {
        if (message?.role !== "toolResult" || String(message?.toolCallId ?? "") !== pending.toolCallId) return message;
        const content = Array.isArray(message.content)
          ? message.content.map((c: any) => (c?.type === "text" ? { ...c, text: pending.text } : c))
          : message.content;
        return { ...message, content };
      });
      return { ...(prepared ?? {}), context: { ...base, messages: patched } };
    };

    const sessionPrepareNextTurn = agent.prepareNextTurnWithContext;
    // The finishTurn/prepareRequest chain is enough: PI owns the turn loop, and
    // the enriched transcript is applied at prepareRequest (see above). Keeping
    // a second injection point here would race that rebuild and, worse, suggest
    // the snapshot survives a projection that actually replaces it.
    (agent as any).prepareNextTurnWithContext = async (turn: any, signal?: AbortSignal) =>
      sessionPrepareNextTurn?.(turn, signal);

    // session events -> our AgentEvent types.
    // text mapping delegated to mapAssistantMessageEvent (pure, tested).
    const mapState = { textSeen: false };
    session.subscribe((event: any) => {
      // PI's own compaction is a real provider call: count it separate from the
      // run's assistant calls so the report can name both.
      if (event.type === "compaction_end" && event.result?.usage) {
        accumulateUsage(compactionUsage, { role: "assistant", usage: event.result.usage });
      }
      mapSessionEvent(event, eventBuffer, mapState);
      if (event.type === "agent_end") agentDone = true;
      if (event.type === "error") {
        agentError = event.error?.message || String(event.error || "Unknown error");
      }
      // Wake up the generator if it's waiting.
      wakeGenerator();
    });

    // Design: forward caller cancellation into the session — session.abort()
    // stops the loop at its tool/turn seams, and waking the generator makes
    // run() end even when the stream function never settles. This is the
    // ans_chat request signal; the search tools already forward their own
    // signal to the engine (#209).
    const cancelRun = () => {
      if (callerCancelled) return;
      callerCancelled = true;
      // abort is a request, not a failure: a settled loop is safe to abort.
      try { void session.abort(); } catch { /* no active run to abort */ }
      wakeGenerator();
    };
    callerSignal?.addEventListener("abort", cancelRun, { once: true });
    // Close the check/registration race: an abort that lands between the guard
    // at the top of run() and this listener would otherwise go unnoticed.
    if (callerSignal?.aborted) cancelRun();
    // No reservation or provider call for a run that was cancelled before the
    // prompt started. The finally below is not active yet, so drop the listener
    // and the session here instead of relying on it.
    if (callerCancelled) {
      callerSignal?.removeEventListener("abort", cancelRun);
      callerSignal?.removeEventListener("abort", onCallerAbort);
      try { session.dispose(); } catch { /* already disposed */ }
      stopRunScope("run cancelled before start");
      return;
    }

    // Design: runtime billing requires store + sessionId + ledger, the same
    // gate MemoryPipeline uses — a half-wired runtime cannot touch
    // budget_ledger, and both startup paths hand over the engine's ledger
    // only after the session row exists (#178).
    const billingWired = !!(store && sessionId && ledger);

    // #275: release reservations whose owner this machine can prove is gone
    // before this run reserves anything. A run killed by SIGKILL never reaches
    // its finally, so its leftover would keep eating this session's cap and
    // later runs would be refused as "budget exhausted" over nothing.
    //
    // The rule is per owner (same host + dead pid), not "clear the session": a
    // consolidation running in another process holds reservations without the
    // session lock, and clearing those would loosen its cap mid-run. A fault
    // here is the usual fail-open budget fault — the reserve below then reports
    // any real exhaustion.
    //
    // Design: the sweep runs at the run boundary rather than only at
    // registration — a long-lived host reuses one ledger, so a leftover
    // inherited at startup would otherwise stay until the process restarted.
    //
    // Not done here: clearing counter amounts that no owner row claims. Those
    // are left by a pre-#275 build, and a build that old does not take the
    // session lock either, so holding the lock cannot prove the writer is gone
    // — clearing it would let a still-running old process and this run both
    // spend against the cap. That upgrade window is tracked separately (#279).
    if (billingWired) {
      try {
        ledger!.reclaimDeadReservations?.(sessionId!);
      } catch (e) {
        reportBudgetFault("reservation reclaim", e);
      }
    }

    // #188: if the domain TOML changed since the last run, refresh the ledger
    // caps before reserving. The registration sites (#187) sample the domain
    // once; a long-lived MCP process reuses its startup engine snapshot, so
    // without this a cap raise would only take effect after a restart. A
    // removed [budget] deactivates the row (spend history kept).
    //
    // The first probe on a new runtime always re-parses the file (forceFirst),
    // because a per-request host may have built the runtime after the edit;
    // later probes are mtime-gated, so this costs one parse and at most one
    // initBudget upsert per runtime.
    const budgetChanged = !!reloadedDomain || this.pendingBudgetRefresh;
    if (budgetChanged && billingWired) {
      try {
        if (domain.budget) {
          ledger!.initBudget?.(sessionId!, toBudgetCaps(domain.budget));
        } else {
          ledger!.clearBudgetCaps?.(sessionId!);
        }
      } catch (e) {
        // fail-open: keep the previously registered caps and name the fault.
        reportBudgetFault("budget refresh", e);
      } finally {
        // Clear only after the refresh attempt (CodeRabbit): a change consumed
        // mid-run by beforeToolCall is applied once at the next run boundary.
        this.pendingBudgetRefresh = false;
      }
    }

    // #188 (T9): reserve tokens at the agent_start boundary — before
    // agent.prompt is invoked, so an exhausted budget stops the run instead of
    // being discovered after a provider call. Formula = input-side occupancy
    // (provider usage anchor when present, estimate on a cold start) + the
    // output-side static limit ([budget].outputReserveTokens, default 12288).
    //
    // A rejected reserve is the hard stop: yield the
    // structured error and return without starting the run — no done event, no
    // settlement, no fabricated summary. Only this run stops; a later run after
    // a TOML raise is unaffected — the run-boundary reloader re-reads the output
    // reserve and refreshes the ledger caps from the same file.
    //
    // A ledger FAULT at reserve is not exhaustion (#200): report it and keep
    // the run going unreserved, matching the fail-open budget contract.
    let tokenReserved = 0;
    if (billingWired) {
      const inputOccupancy = resolveReserveInputTokens(0, (agent as any).state?.messages ?? [], input, systemPrompt);
      // #188: default 12288 is the measured output ceiling from the #186 prototype
      // (p95 9,309 / max 9,600 over 43 runs, 28% headroom). Re-measure when the
      // per-call maxTokens grows to roughly 1.5x the calibration value (8192) —
      // the same R≈1.5x trigger recorded in packages/store/src/domain-schema.ts.
      const outputReserve = resolveOutputReserveTokens(domain.budget);
      const reserveAmount = resolveTokenReserve(inputOccupancy.tokens, outputReserve);
      try {
        if (!ledger!.reserveTokens(sessionId!, reserveAmount)) {
          // #279: when the session holds reserved tokens that no owner row
          // claims, the cap is being eaten by a pre-#275 build's leftover. That
          // residue is deliberately not cleared (clearing it cannot prove the
          // old writer is gone), so the actionable fix is restarting the
          // session with a new id, not raising the cap. Read-only probe; a fault omits the
          // hint and the rejection above still stands on its own.
          let unownedHint = "";
          try {
            if (ledger!.hasUnownedReservedTokens?.(sessionId!)) {
              unownedHint = " Part of the reserved tokens is claimed by no owner row — likely a leftover from a pre-#275 build; start a new session to get a clean budget.";
            }
          } catch { /* read-only probe; omit the hint */ }
          yield {
            type: "error",
            message:
              "Token budget exhausted: this run needs " + reserveAmount +
              " tokens reserved (input " + inputOccupancy.tokens +
              " + output limit " + outputReserve + ") but the session cap cannot cover it. " +
              "The run was not started; raise [budget] tokenCap and retry (the next run re-reads the domain TOML)." + unownedHint,
          };
          try { session.dispose(); } catch { /* already disposed */ }
          stopRunScope("budget rejected");
          return;
        }
        tokenReserved = reserveAmount;
      } catch (e) {
        reportBudgetFault("token reserve", e);
      }
    }

    // Per-call reserve stays a soft gate (#178): a rejection lets the run
    // continue and the call is simply not billed. The token dimension above is
    // the hard stop.
    let callReserved = false;
    if (billingWired) {
      try {
        callReserved = ledger!.reserveCalls(sessionId!, 1);
      } catch (e) {
        reportBudgetFault("reserve", e);
      }
    }

    // #188: every path after a successful reservation must release it, even
    // when the generator is closed early (CLI returns on the first error or
    // timeout, stdout EPIPE, MCP client abort) or the provider reports zero
    // usage. Otherwise reserved_tokens leaks for the rest of the session and
    // healthy runs are later rejected as "exhausted". The normal path settles
    // with the provider-reported total; the finally fallback settles 0.
    let tokenSettled = false;
    let settledTokens = 0;
    let callSettled = false;
    // Money is settle-only and settles incrementally: the happy path books the
    // run's spend, and a figure that arrives later (a stalled stream's final
    // usage chunk) is booked as the delta. A single "already settled" flag
    // would silently drop that late spend. The recorded amount advances only
    // after a successful write, so a failed settle can be retried.
    let settledUsd = 0;
    const settleUsdUpTo = (amount: number): void => {
      if (!billingWired) return;
      const delta = Math.round((amount - settledUsd) * 1e9) / 1e9;
      if (!(delta > 0)) return;
      try {
        ledger!.settleUsd(sessionId!, 0, delta);
        settledUsd = amount;
      } catch (e) {
        reportBudgetFault("usd settlement", e);
      }
    };
    const settleTokenReserve = (actual: number): void => {
      if (!billingWired || tokenSettled) return;
      tokenSettled = true;
      if (tokenReserved <= 0 && actual <= 0) return;
      try {
        ledger!.settleTokens(sessionId!, tokenReserved, actual);
        settledTokens = actual;
      } catch (e) {
        // A failed settle leaves the reservation behind; let the finally
        // fallback retry once instead of dropping the release for good.
        tokenSettled = false;
        reportBudgetFault("token settlement", e);
      }
    };
    // #188 (CodeRabbit): late usage from a stalled prompt is added as a delta
    // after the reservation was already released, so an exiting process cannot
    // leave reserved_tokens behind.
    const settleTokenDelta = (finalActual: number): void => {
      if (!billingWired) return;
      if (!tokenSettled) {
        // The reservation release itself failed earlier; retry the full settle
        // (release + actual) rather than recording spend with the reservation
        // still held.
        settleTokenReserve(finalActual);
        return;
      }
      const delta = Math.max(0, finalActual - settledTokens);
      if (delta <= 0) return;
      try {
        ledger!.settleTokens(sessionId!, 0, delta);
        settledTokens = finalActual;
      } catch (e) {
        reportBudgetFault("token settlement", e);
      }
    };

    let promptPromise: Promise<void> | null = null;
    try {
      // Start the session prompt in background. Prompt templates stay off: a
      // user message beginning with "/" is text, not a host command.
      promptPromise = session.prompt(input, { expandPromptTemplates: false }).catch((e: any) => {
        agentError = e?.message || String(e);
        agentDone = true;
        wakeGenerator();
      });

      // Yield events as they arrive.
      while ((!agentDone || eventBuffer.length > 0) && !timedOut() && !callerCancelled) {
        if (eventBuffer.length > 0) {
          yield eventBuffer.shift()!;
        } else if (!agentDone) {
          // Wait for next event.
          await new Promise<void>((resolve) => {
            resolveEvent = resolve;
          });
        }
      }

      // Design: cancellation is a transport outcome, not a completed run —
      // return before usage settlement, FTS sync, and the "Agent completed"
      // summary, and let the #188 finally release the reservation instead.
      // The first check covers a stream that never settles; the second covers
      // an abort that lands while prompt() is resolving.
      if (callerCancelled) return;
      // Wait for prompt() to fully resolve.
      await promptPromise;
      if (callerCancelled) return;
      // Drain any events that arrived between agent_end and promptPromise resolution.
      while (eventBuffer.length > 0 && !callerCancelled) {
        yield eventBuffer.shift()!;
      }
      // A yield above suspends the generator; re-check before completion work.
      if (callerCancelled) return;

      // SECURITY: timeout check after loop (CWE-400).
      if (timedOut() && !agentDone) {
        yield { type: "error", message: "Agent timeout after " + timeoutMs + "ms" };
      }
      if (callerCancelled) return;

      // Budget settle at agent_end (amended #103/#188).
      if (billingWired) {
        // Design: a rejected per-call reserve is not settled — it was never
        // recorded, so settling would fabricate a billable call.
        // Design: each settlement attempt is independently fail-open and
        // reported — a locked ledger must not fail an already-completed chat or
        // skip message synchronization and the final event (CodeRabbit #200).
        if (callReserved) {
          try {
            ledger!.settleCalls(sessionId!, 1, 1);
            callSettled = true;
          } catch (e) {
            reportBudgetFault("call settlement", e);
          }
        }
        // #188: token settle stays "by actuals" — the reserved amount is
        // released and the provider-reported total is recorded as spent, even
        // when it exceeds the reservation. This runs unconditionally so a
        // zero-usage run still releases its reservation. USD remains
        // settle-only (no price table in kernel).
        //
        // PI's compaction is a real provider call that this run caused, so its
        // tokens and dollars settle on the same ledger. Leaving them out would
        // hide part of the run's spend behind the main call (#258).
        // The memory pipeline's summary calls are drained and settled by
        // flushMemory(), because they are still in flight when the run ends.
        const settledTokensTotal = usageTotals.totalTokens + compactionUsage.totalTokens;
        settleTokenReserve(settledTokensTotal);
        settleUsdUpTo(usageTotals.costUsd + compactionUsage.costUsd);
      }

      // Design: sync only this run's finalized messages into the FTS5 store —
      // the PI record already owns the full history, so re-appending a resumed
      // session's whole transcript would duplicate rows on every call.
      if (this.opts.store) {
        // append() is async: an un-awaited rejection is NOT caught by the
        // surrounding try/catch and can terminate the process on Node >= 15, and
        // the message is lost anyway. Each write gets its own try so one failure
        // does not stop the remaining messages.
        for (const msg of runMessages) {
          // A cancelled run stops the remaining sync writes; an append already
          // in flight is the residual window (it cannot be un-awaited).
          if (callerCancelled) break;
          try {
            await this.opts.store.append(sessionId || "default", {
              role: msg.role || "assistant",
              content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content),
              timestamp: Date.now(),
            } as any);
          } catch (e) {
            // ponytail: FTS5 sync is best-effort, don't block agent on store failure.
            // But log the error so it's not silently swallowed (debt fix).
            if (typeof process !== "undefined" && process.stderr) {
              process.stderr.write("[anysearch] FTS5 sync warning: " + (e instanceof Error ? e.message : String(e)) + "\n");
            }
          }
        }
      }
      if (callerCancelled) return;

      // Final event.
      if (agentError) {
        yield { type: "error", message: agentError };
      } else {
        // The summary reports the same scope the ledger settles: main calls
        // plus PI's compaction. Reporting only the main total here would
        // contradict settleTokens the moment compaction runs (#178).
        const settledTotalTokens = usageTotals.totalTokens + compactionUsage.totalTokens;
        const tokenSummary = settledTotalTokens > 0
          ? ` (tokens: ${usageTotals.inputTokens} in + ${usageTotals.outputTokens} out = ${settledTotalTokens} total)`
          : "";
        // #189: make the one-shot recovery visible next to the run summary.
        const recovery = this.pipeline?.getInjectedRecoveryDigest();
        // The window this session actually runs with, read from PI itself. It
        // comes from the SDK model registered above, so it proves the configured
        // window reached the agent session instead of just the CLI config.
        let context: { tokens: number | null; window: number; percent: number | null } | undefined;
        try {
          const cu = session.getContextUsage();
          if (cu) context = { tokens: cu.tokens, window: cu.contextWindow, percent: cu.percent };
        } catch { /* diagnostics only */ }
        yield {
          type: "done",
          summary: `Agent completed${tokenSummary}`,
          ...(recovery ? { recovery } : {}),
          ...(context ? { context } : {}),
          usage: toRunUsage(usageTotals, compactionUsage),
        };
      }
    } finally {
      callerSignal?.removeEventListener("abort", cancelRun);
      callerSignal?.removeEventListener("abort", onCallerAbort);
      // #188 (CodeRabbit): stop the run before its reservation is released, so
      // a consumer that closed the stream early cannot leave the agent making
      // provider/tool calls after the budget was freed. The signal exists only
      // while a run is active, so a normal end is a no-op.
      let abortedEarly = false;
      if (promptPromise && !agentDone) {
        try { void session.abort(); } catch { /* already idle */ }
        abortedEarly = true;
      }
      // #259: a run that stopped before its loop finished is not a completed run,
      // so the cancellation scope closes here. The reround reads it, so work
      // still in flight (a slow gap search) can neither search on nor archive.
      // A normal end leaves the scope open: that turn's work did complete.
      if (callerCancelled || abortedEarly || timedOut()) stopRunScope("run stopped early");
      // #188 (CodeRabbit): wait briefly for the in-flight prompt so its final
      // usage is recorded. If the provider is stalled, do not block the close:
      // settle once the prompt actually stops instead. A late write can fail if
      // the caller already closed the store; the normal fail-open path reports it.
      let budgetFinalized = false;
      const finalizeBudget = (): void => {
        if (budgetFinalized) return;
        budgetFinalized = true;
        // An aborted run may never receive its final usage chunk. Missing usage
        // is not a genuine zero: keep the reservation as the conservative
        // estimate. A provider-reported zero still settles as zero. Compaction
        // spend belongs to this run, so it settles here too.
        const actual = (abortedEarly && !usageReported)
          ? tokenReserved
          : usageTotals.totalTokens + compactionUsage.totalTokens;
        settleTokenReserve(actual);
        // Money is settled on this path too. A cancelled or early-closed run
        // still spent whatever the provider already reported, and skipping it
        // here would leave that spend unrecorded whenever the happy path in
        // runInternal never ran. settleUsdUpTo books only the difference, so the
        // two paths can never charge the same spend twice.
        settleUsdUpTo(usageTotals.costUsd + compactionUsage.costUsd);
        if (billingWired && callReserved && !callSettled) {
          // A provider call happened if it reported usage, or if we aborted it
          // before the final chunk arrived.
          const actualCalls = usageReported || abortedEarly ? 1 : 0;
          try {
            ledger!.settleCalls(sessionId!, 1, actualCalls);
          } catch (e) {
            reportBudgetFault("call settlement", e);
          }
        }
      };
      let promptStopped = !promptPromise;
      if (promptPromise && !callerCancelled) {
        await Promise.race([
          promptPromise.then(() => { promptStopped = true; }, () => { promptStopped = true; }),
          new Promise<void>((resolve) => setTimeout(resolve, 1000)),
        ]);
      }
      finalizeBudget();
      if (!promptStopped) {
        // #211: a cancelled run returns immediately — the caller is gone, so
        // do not spend the bounded wait on a stream that may never settle.
        // Provider still running: the reservation was released above; add only
        // the later delta when the prompt finally stops (best-effort if the
        // store is already closed).
        void promptPromise!.then(
          () => settleTokenDelta(usageTotals.totalTokens + compactionUsage.totalTokens),
          () => settleTokenDelta(usageTotals.totalTokens + compactionUsage.totalTokens),
        );
      }
      // Release the session listeners; the JSONL record is already durable.
      try { session.dispose(); } catch { /* already disposed */ }
      // #259: drop the run's scope LAST, after every shutdown step above. A
      // kept scope would make a later run inherit this run's cancellation; a
      // scope dropped early is the opposite hole — an in-flight reround would
      // fall back to the caller signal, which is absent on a consumer-close.
      if (this.runScopeController === runAbort) this.runScopeController = undefined;
    }
  }

  /**
   * Drain background memory writes before the caller closes the store, then
   * settle what those calls actually spent.
   *
   * `consolidate()` intentionally does not block a turn on summary generation or
   * L2 recall, so a run can end with anchor writes still in flight. A caller
   * that owns the store (the CLI, which closes it during teardown) must await
   * this first or those writes are lost. No-op when no pipeline is wired.
   *
   * The summary calls are real provider calls made on this session's behalf, so
   * their spend settles on the same ledger as the main run: extra merge and
   * check work belongs to the budget, not outside it. Settlement happens AFTER
   * the drain, because the cost only exists once the calls finished — settling
   * earlier would under-report them.
   */
  async flushMemory(): Promise<void> {
    if (!this.pipeline) return;
    await this.pipeline.flush();
    await this.settleMemoryUsage();
  }

  /**
   * Settle the memory pipeline's own spend. Idempotent: the pipeline reports
   * cumulative totals, so this records only what has not been settled yet, and
   * a second call after another summary call adds only the delta.
   */
  private async settleMemoryUsage(): Promise<void> {
    const { ledger, sessionId } = this.opts;
    if (!this.pipeline || !ledger || !sessionId) return;
    const report = this.pipeline.getSummaryUsage();
    // The adjudication slice is the pipeline's own spend too (D4: never hidden
    // outside the budget), so the settled watermark covers both books. Both
    // only grow, so one delta counter stays correct across flushes.
    const pipelineTokens = report.totalTokens + report.adjudication.totalTokens;
    const pipelineCost = report.costUsd + report.adjudication.costUsd;
    // Each dimension settles and records its own progress. Sharing one catch
    // would let a USD failure skip the token bookkeeping update, and the next
    // flush would bill the same tokens again.
    if (pipelineTokens > this.settledMemoryTokens) {
      try {
        ledger.settleTokens(sessionId, 0, pipelineTokens - this.settledMemoryTokens);
        this.settledMemoryTokens = pipelineTokens;
      } catch (e) {
        reportBudgetFault("memory summary token settlement", e);
      }
    }
    if (pipelineCost > this.settledMemoryCostUsd) {
      try {
        ledger.settleUsd(sessionId, 0, pipelineCost - this.settledMemoryCostUsd);
        this.settledMemoryCostUsd = pipelineCost;
      } catch (e) {
        reportBudgetFault("memory summary usd settlement", e);
      }
    }
  }

  /** Usage of the memory pipeline's own summary calls (separate from the run). */
  getMemoryUsage(): SummaryUsage | null {
    return this.pipeline ? this.pipeline.getSummaryUsage() : null;
  }

  /**
   * #264 (D9): rebuild attempts for suspended summaries, once they finished.
   *
   * Read AFTER `flushMemory()`, never from the `done` event: rebuilds are
   * background work the flush drains, so a caller that reported before the drain
   * would describe an attempt that had not run yet.
   */
  getSummaryRebuilds(): SummaryRebuildReport[] {
    return this.pipeline ? this.pipeline.getSummaryRebuilds() : [];
  }
}
