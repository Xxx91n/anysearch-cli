// PiAgentRuntime: pi-agent-core Agent wrapper for anysearch-cli.
// decision 2: lives in packages/kernel.
// decision 3: maps pi-agent-core 9 events to our 7 AgentEvent types.
// decision 4: Domain 5-layer full consumption.
// decision 5 (amended by #90/#103, #188): token/USD budget metered via agent
// event subscription (message_end usage accumulation, agent_end settle). The
// token dimension also reserves at agent_start — input occupancy + the output
// static limit — and stops the run when the reserve is rejected. USD comes from
// pi-ai Usage.cost — no price table in TOML or kernel, so USD stays settle-only.
// decision 6: dual session (pi Agent memory + SqliteSessionStore FTS5 sync).
// MemoryPipeline + SufficiencyEvaluator extracted as sibling deep modules.

import type { AgentTool } from "@earendil-works/pi-agent-core";
// Full PI session runtime. pi-coding-agent exports only an ESM entry, so both
// hosts that link the kernel (CLI, MCP) build as ESM now.
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type ExtensionFactory,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { estimateTranscriptTokens } from "./message-text";
import { createHash } from "node:crypto";
import { Type } from "@sinclair/typebox";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
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
import type { AgentEvent, RunUsage } from "./runtime";
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

// Build the search AgentTool: wraps RetroaererdEngine.search() with TypeBox schema.
// The LLM sees this as a tool it can call to search the web.
//
// PROTOTYPE WIRING (pi-1.5.1 window): when the runtime owns a session, the
// internal search now also persists its results through store.saveResults().
// Before this, only the standalone MCP `search_web` tool indexed results, so an
// `ans_chat` search never reached retrieval_results and later sessions could
// not recall it.
export function createSearchTool(
  retriever: RetrieverPort,
  span?: RetrievalObservationSink,
  onResults?: (urls: string[]) => void,
  persist?: { store: SessionStorePort; sessionId: string },
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
      const envelope = await retriever.search(q);
      onResults?.((envelope.results ?? []).map((r) => r.url));
      // Index the run's own retrieval into the research archive (fail-open:
      // a failed write must not fail the turn).
      if (persist) {
        try {
          await persist.store.saveResults(persist.sessionId, envelope.results);
        } catch (e) {
          try {
            process.stderr.write(
              "[anysearch] search result indexing failed: " +
              (e instanceof Error ? e.message : String(e)) + "\n",
            );
          } catch { /* stderr unavailable */ }
        }
      }
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
   * with anysearch sessionId, each session resumes its own record; when absent
   * the session stays in memory.
   */
  piSessionDir?: string;
  /** Working directory for the PI session + resource loader. Defaults to cwd. */
  cwd?: string;
  /** PI compaction thresholds (auto-compaction stays enabled unless disabled). */
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

// #103 (T4 ruling #90): token/USD metering source = subscribed agent events.
// pi-ai SimpleStreamOptions.onResponse receives ProviderResponse {status, headers}
// — it carries NO usage — so the old onResponse accumulation was dead code and
// token totals stayed 0 (also starving shouldStopAfterTurn's consolidate input).
// The real source is the `message_end` event: it carries the full AgentMessage,
// and AssistantMessage.usage has input/output/totalTokens plus pi-ai-computed
// cost (Usage.cost.total is the single USD price source — no local price table).
// Note message_end also fires for user prompts and tool-result messages (which
// may carry their own usage); per the ruling only AssistantMessage.usage counts.
export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  // Provider-reported cache reads/writes. Absent usage stays 0 here but the
  // report says "unavailable" instead of pretending the call was free.
  cacheReadTokens: number;
  cacheWriteTokens: number;
  // Whether the provider actually reported each dimension, so a reported zero
  // stays distinguishable from an absent number.
  cacheReported: boolean;
  costReported: boolean;
  // Number of assistant calls that actually returned usage.
  assistantCalls: number;
  // Latest assistant message's totalTokens (input incl. cache + output of the
  // most recent LLM call). One input to the L0 watermark's occupancy:
  // max(this, estimateContextTokens(messages)) in resolveContextOccupancy.
  // Cumulative totals are ledger-only and must never feed the watermark —
  // they are monotonic, so a crossed watermark would re-fire every turn.
  lastTotalTokens: number;
}

export function emptyUsageTotals(): UsageTotals {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    costUsd: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    cacheReported: false,
    costReported: false,
    assistantCalls: 0,
    lastTotalTokens: 0,
  };
}

// One run's complete accounting. `missing` names the dimensions the provider
// did not report; the caller must surface them rather than zero-fill.
export type { RunUsage };

export function toRunUsage(totals: UsageTotals, compactionCalls: number, compactionTokens: number, compactionCostUsd: number): RunUsage {
  const missing: string[] = [];
  if (totals.assistantCalls === 0) missing.push("assistant usage");
  if (totals.assistantCalls > 0 && !totals.cacheReported) missing.push("cache usage");
  if (!totals.costReported) missing.push("cost");
  if (compactionCalls > 0 && compactionTokens === 0) missing.push("compaction usage");
  return {
    inputTokens: totals.inputTokens,
    outputTokens: totals.outputTokens,
    cacheReadTokens: totals.cacheReadTokens,
    cacheWriteTokens: totals.cacheWriteTokens,
    totalTokens: totals.totalTokens,
    costUsd: totals.costUsd,
    assistantCalls: totals.assistantCalls,
    compactionCalls,
    compactionTokens,
    compactionCostUsd,
    missing,
  };
}

// Accumulate one message_end payload into the run totals. Pure helper,
// exported for tests. Non-assistant messages and missing usage are ignored.
export function accumulateUsage(totals: UsageTotals, message: unknown): void {
  const msg = message as {
    role?: string;
    usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; totalTokens?: number; cost?: { total?: number } };
  } | undefined;
  if (!msg || msg.role !== "assistant" || !msg.usage) return;
  const input = Number(msg.usage.input) || 0;
  const output = Number(msg.usage.output) || 0;
  totals.inputTokens += input;
  totals.outputTokens += output;
  totals.cacheReadTokens += Number(msg.usage.cacheRead) || 0;
  totals.cacheWriteTokens += Number(msg.usage.cacheWrite) || 0;
  totals.cacheReported = totals.cacheReported || msg.usage.cacheRead !== undefined || msg.usage.cacheWrite !== undefined;
  totals.costReported = totals.costReported || msg.usage.cost !== undefined;
  totals.assistantCalls += 1;
  // totalTokens includes cache read/write tokens when the provider reports
  // them; fall back to input+output when absent.
  const messageTotal = Number(msg.usage.totalTokens) || (input + output);
  totals.totalTokens += messageTotal;
  totals.lastTotalTokens = messageTotal;
  totals.costUsd += Number(msg.usage.cost?.total) || 0;
}

// #113: current-context occupancy for the L0 watermark. `lastUsageTokens` is
// the provider-reported usage of the most recent assistant call; `estimated`
// adds messages appended after that call (tool results, user turns) — exactly
// the lag window CodeRabbit flagged on PR #114. max() keeps a provider report
// that is larger than the local estimate from being under-counted.
export function estimateMessagesTokens(messages: any[]): number {
  return estimateTranscriptTokens(messages ?? []);
}

export function resolveContextOccupancy(lastUsageTokens: number, messages: any[]): number {
  const estimated = estimateMessagesTokens(messages);
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
  // 1.5.1 folds initialState.systemPrompt AND initialState.tools into a leading
  // system message inside state.messages. That message is the request's static
  // head, not conversation: treating it as carried history would skip the
  // cold-start branch and count the tool declarations a second time.
  const conversation = transcript.filter((m: any) => m?.role !== "system");
  if (anchor > 0 || conversation.length > 0) {
    // Occupancy estimate covers trailing messages only; the provider anchor
    // already counts the static head (prompt + tool declarations).
    return { tokens: resolveContextOccupancy(anchor, conversation), coldStart: false };
  }
  let tokens = 0;
  try {
    // estimateTokens only reads `role`/`content`; wrapping the system prompt in
    // a user-shaped message makes it part of the same character estimate (a
    // "system" role is not a pi-agent-core message role and would count as 0).
    tokens += Math.ceil(estimateMessagesTokens([{ role: "user", content: prompt }] as any));
    if (systemPrompt) {
      tokens += Math.ceil(estimateMessagesTokens([{ role: "user", content: systemPrompt }] as any));
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

// Same-session runs are serialized (decision 10). Different sessions keep
// separate tails and run in parallel.
const sessionQueues = new Map<string, Promise<void>>();

async function acquireSessionQueue(key: string): Promise<() => void> {
  const previous = sessionQueues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const tail = previous.then(() => current);
  sessionQueues.set(key, tail);
  await previous;
  return () => {
    release();
    if (sessionQueues.get(key) === tail) sessionQueues.delete(key);
  };
}

/**
 * Cross-process mutex for one PI session file. The JSONL record has one
 * writer; two processes appending at once would interleave entries. The lock
 * is a directory (mkdir is atomic).
 *
 * A plain directory-mtime lock mistakes a long but healthy run for a dead one.
 * The holder now records its pid/host and refreshes a heartbeat file, and a
 * waiter only steals a lock when the recorded owner is really gone:
 * - same host + live pid: never steal, however old the heartbeat is
 * - same host + dead pid: steal once the stale window has passed (the floor
 *   keeps a just-created lock from being taken before owner.json lands)
 * - other host or unreadable owner: fall back to heartbeat/directory age
 * ANS_PROTOTYPE_LOCK_HEARTBEAT=0 restores the old mtime-only behavior so the
 * before/after evidence can be produced on the same binary.
 */
const FILE_LOCK_STALE_MS = 10 * 60_000;
const FILE_LOCK_TIMEOUT_MS = 120_000;
const LOCK_OWNER_FILE = "owner.json";
const LOCK_HEARTBEAT_FILE = "heartbeat";

// PROTOTYPE (cross-process probe): default behavior is unchanged, but the
// stale/timeout windows are overridable so a killed holder can be shown to
// recover in seconds instead of waiting ten minutes.
function lockMsFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function lockHeartbeatEnabled(): boolean {
  return process.env.ANS_PROTOTYPE_LOCK_HEARTBEAT !== "0";
}

function pidIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException)?.code === "EPERM";
  }
}

interface LockOwner { pid: number; host: string; startedAt: number }

function readLockOwner(lockPath: string): LockOwner | undefined {
  try {
    const raw = JSON.parse(readFileSync(join(lockPath, LOCK_OWNER_FILE), "utf8")) as Partial<LockOwner>;
    if (!Number.isInteger(raw.pid) || raw.pid! <= 0 || typeof raw.host !== "string") return undefined;
    return { pid: raw.pid!, host: raw.host, startedAt: Number(raw.startedAt) || 0 };
  } catch {
    return undefined;
  }
}

/** Newest ORIGINAL timestamp available for the lock: heartbeat, else directory. */
function lockAgeMs(lockPath: string, now: number): number {
  const heartbeat = join(lockPath, LOCK_HEARTBEAT_FILE);
  try {
    return now - statSync(existsSync(heartbeat) ? heartbeat : lockPath).mtimeMs;
  } catch {
    return 0;
  }
}

async function acquireFileLock(lockPath: string, timeoutMs = lockMsFromEnv("ANS_PI_LOCK_TIMEOUT_MS", FILE_LOCK_TIMEOUT_MS)): Promise<() => void> {
  const staleMs = lockMsFromEnv("ANS_PI_LOCK_STALE_MS", FILE_LOCK_STALE_MS);
  const heartbeatEnabled = lockHeartbeatEnabled();
  const start = Date.now();
  for (;;) {
    try {
      mkdirSync(lockPath);
      let timer: ReturnType<typeof setInterval> | undefined;
      if (heartbeatEnabled) {
        const owner: LockOwner = { pid: process.pid, host: hostname(), startedAt: Date.now() };
        try { writeFileSync(join(lockPath, LOCK_OWNER_FILE), JSON.stringify(owner)); } catch { /* best effort */ }
        const beat = () => { try { writeFileSync(join(lockPath, LOCK_HEARTBEAT_FILE), String(Date.now())); } catch { /* lock already released */ } };
        beat();
        timer = setInterval(beat, Math.min(5_000, Math.max(100, Math.floor(staleMs / 3))));
        timer.unref?.();
      }
      return () => {
        if (timer) clearInterval(timer);
        try { rmSync(lockPath, { recursive: true, force: true }); } catch { /* unlocked by stale sweep */ }
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException)?.code !== "EEXIST") throw e;
      const now = Date.now();
      let steal = false;
      if (heartbeatEnabled) {
        const owner = readLockOwner(lockPath);
        if (owner) {
          const sameHost = owner.host === hostname();
          const alive = sameHost ? pidIsAlive(owner.pid) : false;
          // A live local owner is protected no matter how old the heartbeat is.
          // A dead owner or a foreign host is judged by the stale window.
          steal = sameHost ? !alive && lockAgeMs(lockPath, now) > staleMs : lockAgeMs(lockPath, now) > staleMs;
        } else {
          steal = lockAgeMs(lockPath, now) > staleMs;
        }
      } else {
        steal = lockAgeMs(lockPath, now) > staleMs;
      }
      if (steal) {
        try {
          rmSync(lockPath, { recursive: true, force: true });
          continue;
        } catch { /* another waiter swept it first; retry the mkdir */ }
      }
      if (Date.now() - start > timeoutMs) {
        throw new Error("This session is busy in another process; retry after the current run finishes.");
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}

// Stable PI session id per AnySearch session handle. Hashing keeps arbitrary
// visible-ASCII handles out of file names.
export function piSessionKey(sessionId: string): string {
  return "ans-" + createHash("sha256").update(sessionId).digest("hex").slice(0, 32);
}

function mapSessionEvent(event: any, buffer: AgentEvent[], state: { textSeen: boolean }, onUsage: (message: unknown) => void): void {
  switch (event.type) {
    case "message_start":
      state.textSeen = false;
      break;
    case "message_update": {
      const mapped = mapAssistantMessageEvent(event.assistantMessageEvent, state);
      if (mapped) buffer.push(mapped);
      break;
    }
    case "message_end":
      onUsage(event.message);
      break;
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
    });
  }

  // decision 3: run returns AsyncIterable<AgentEvent>, mapping pi events.
  // Serialization: same session -> one run at a time (in-process queue plus a
  // cross-process lock on the PI JSONL record); different sessions proceed in
  // parallel.
  async *run(input: string): AsyncIterable<AgentEvent> {
    if (this.opts.signal?.aborted) return;
    const key = this.opts.sessionId ?? "";
    const releaseQueue = key ? await acquireSessionQueue(key) : () => {};
    let releaseFile: (() => void) | undefined;
    try {
      const lockDir = this.opts.piSessionDir && key ? join(this.opts.piSessionDir, "locks") : "";
      if (lockDir) {
        mkdirSync(lockDir, { recursive: true });
        releaseFile = await acquireFileLock(join(lockDir, piSessionKey(key) + ".lock"));
      }
      yield* this.runInternal(input);
    } catch (e) {
      yield { type: "error", message: e instanceof Error ? e.message : String(e) };
    } finally {
      releaseFile?.();
      releaseQueue();
    }
  }

  private async *runInternal(input: string): AsyncIterable<AgentEvent> {
    // #211: a signal that is already aborted means the caller gave up before
    // this run began. Do not start a provider call, reserve budget, or touch
    // session state for a request nobody is waiting for.
    const callerSignal = this.opts.signal;
    if (callerSignal?.aborted) return;

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
    const searchPersist = store && sessionId ? { store, sessionId } : undefined;
    const searchTool = createSearchTool(this.scopedRetriever, this.opts.span, (urls) => saturation.record(urls), searchPersist);
    const allTools = [searchTool, ...(this.opts.tools || [])];
    const activeTools = filterAgentTools(allTools, domain);

    // decision 4: prompts -> systemPrompt
    const systemPrompt = buildSystemPrompt(domain);

    // Token/USD budget tracking (decision 5, amended #103):
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

    // Message array produced by the sufficiency gate in finishTurn, consumed by
    // prepareNextTurnWithContext. Scoped to this run: the next run starts clean.
    let pendingTurnMessages: any[] | null = null;

    // Full PI SDK session. The provider registration below routes every model
    // call back through the caller's streamFn, so auth/baseUrl stay owned by
    // llm-init while session persistence, compaction, retries, and accounting
    // come from pi-coding-agent.
    const cwd = this.opts.cwd ?? process.cwd();
    const baseModel = (this.opts.model ?? {}) as any;
    const modelId = typeof baseModel.id === "string" && baseModel.id ? baseModel.id : "anysearch-model";
    const api = typeof baseModel.api === "string" && baseModel.api ? baseModel.api : "openai-completions";
    const contextWindow =
      this.opts.contextWindow && this.opts.contextWindow > 0
        ? this.opts.contextWindow
        : (Number(baseModel.contextWindow) > 0 ? Number(baseModel.contextWindow) : 128000);
    const sdkProviderId = "anysearch";
    const modelRuntime = await ModelRuntime.create({ modelsPath: null, refreshOnCreate: false, allowModelNetwork: false });
    modelRuntime.registerProvider(sdkProviderId, {
      name: "AnySearch",
      // Required by the provider composer even though streamSimple below
      // never dials it. The real endpoint stays on the llm-init model.
      baseUrl: typeof baseModel.baseUrl === "string" && baseModel.baseUrl ? baseModel.baseUrl : "http://127.0.0.1:1/v1",
      // Placeholder credential for the same reason: the composer refuses a
      // provider without an auth method, and our streamFn resolves the real
      // key itself. Never printed.
      apiKey: this.opts.apiKey || "anysearch-local-stream",
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
      // config, and this keeps catalog and custom-endpoint paths identical.
      streamSimple: (_model, context, options) => (this.opts.streamFn as any)(baseModel, context, options),
    });
    const sdkModel = modelRuntime.getModel(sdkProviderId, modelId);
    if (!sdkModel) throw new Error("PI provider registration did not expose " + modelId);

    const persistentDir = this.opts.piSessionDir && sessionId ? this.opts.piSessionDir : undefined;
    let sessionManager: SessionManager;
    if (persistentDir) {
      mkdirSync(persistentDir, { recursive: true });
      const key = piSessionKey(sessionId!);
      const found = SessionManager.findById(cwd, key, persistentDir);
      sessionManager = found
        ? SessionManager.open(found, persistentDir, cwd)
        : SessionManager.create(cwd, persistentDir, { id: key });
    } else {
      sessionManager = SessionManager.inMemory(cwd);
    }
    const piCompaction = this.opts.piCompaction ?? {};
    const settingsManager = SettingsManager.inMemory({
      compaction: {
        enabled: piCompaction.enabled ?? true,
        reserveTokens: piCompaction.reserveTokens ?? 16384,
        keepRecentTokens: piCompaction.keepRecentTokens ?? 20000,
      },
    });

    let compactionCalls = 0;
    let compactionTokens = 0;
    let compactionCostUsd = 0;
    // Every message finalized in this run (used for the FTS sync so a resumed
    // session does not re-append its whole history).
    const runMessages: Array<{ role?: string; content?: unknown }> = [];

    const controlFactory: ExtensionFactory = (pi) => {
      // Official extension seam for memory injection: pi calls this before
      // every provider request and restores system messages afterwards.
      pi.on("context", async (event) => {
        if (!this.pipeline) return undefined;
        const injected = await this.pipeline.inject(event.messages as any);
        return { messages: injected as any };
      });
      // Tool checks stay on the official tool_call event: AgentSession owns
      // beforeToolCall, so re-wrapping it would race its own handler.
      pi.on("tool_call", async (event) => {
        if (event.toolName === BUILTIN_SEARCH_TOOL && saturation.exhausted()) {
          return { block: true, reason: saturation.reason() };
        }
        const reloaded = this.domainReloader ? this.domainReloader() : null;
        if (reloaded) {
          (this.opts as { domain: DomainConfigPort }).domain = reloaded as DomainConfigPort;
          this.pendingBudgetRefresh = true;
        }
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
      // Accounting from the official message_end event; absent usage stays
      // absent so a later report can say "unavailable" instead of "free".
      pi.on("message_end", async (event) => {
        const message = event.message as any;
        accumulateUsage(usageTotals, message);
        if (message?.role === "assistant" && message?.usage) usageReported = true;
        if (message?.role !== "system") runMessages.push(message);
        return undefined;
      });
    };

    const resourceLoader = new DefaultResourceLoader({
      cwd,
      agentDir: persistentDir ? join(persistentDir, "agent") : join(cwd, ".anysearch", "pi-agent"),
      settingsManager,
      systemPrompt,
      // Zero host discovery: no extensions, skills, prompts, themes, or
      // AGENTS.md from the operator's environment.
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      extensionFactories: [{ name: "anysearch-control", factory: controlFactory }],
    });
    await resourceLoader.reload();

    const created = await createAgentSession({
      cwd,
      agentDir: persistentDir ? join(persistentDir, "agent") : join(cwd, ".anysearch", "pi-agent"),
      modelRuntime,
      model: sdkModel,
      thinkingLevel: "off",
      settingsManager,
      resourceLoader,
      sessionManager,
      customTools: activeTools as unknown as ToolDefinition[],
      tools: activeTools.map((t) => t.name),
    });
    const session = created.session;
    const agent = session.agent;

    // finishTurn and prepareNextTurnWithContext chain their predecessors, so
    // the sufficiency gate can wrap the session's own hooks without losing
    // compaction, boundary, or tool-loadout handling.
    const sessionFinishTurn = agent.finishTurn;
    (agent as any).finishTurn = async (turn: any, signal?: AbortSignal) => {
      if (signal?.aborted) return { action: "end" as const };
      const messages = turn?.context?.messages ?? agent.state?.messages ?? [];
      const conversation = messages.filter((m: any) => m?.role !== "system");
      const totalTokens = resolveContextOccupancy(usageTotals.lastTotalTokens, conversation);
      const toolResults: any[] = Array.isArray(turn?.toolResults) ? turn.toolResults : [];
      const hasSearchTurn = toolResults.some((r: any) => String(r?.toolName ?? "").includes("search"))
        || (typeof turn?.lastToolName === "string" && turn.lastToolName.includes("search"));
      if (this.gate && this.pipeline) {
        try {
          const env = await this.gate.evaluate(messages);
          const enriched = this.gate.applyTo(messages, env);
          if (env.enrichedEnvelope !== null && enriched !== messages) {
            pendingTurnMessages = enriched;
          }
          await this.pipeline.consolidate(enriched, totalTokens, env.hasRetrievalEvidence || hasSearchTurn);
        } catch { /* fail-open: a memory fault must not end the turn */ }
      } else if (this.pipeline) {
        try { await this.pipeline.consolidate(messages, totalTokens, hasSearchTurn); } catch { /* fail-open */ }
      }
      return sessionFinishTurn?.(turn, signal);
    };
    const sessionPrepareNextTurn = agent.prepareNextTurnWithContext;
    (agent as any).prepareNextTurnWithContext = async (turn: any, signal?: AbortSignal) => {
      const snapshot = await sessionPrepareNextTurn?.(turn, signal);
      if (!pendingTurnMessages) return snapshot;
      const nextMessages = pendingTurnMessages;
      pendingTurnMessages = null;
      const context = (snapshot?.context ?? turn?.context ?? {}) as Record<string, unknown>;
      return { ...(snapshot ?? {}), context: { ...context, messages: nextMessages } };
    };

    // decision 3: session events -> our AgentEvent types.
    const mapState = { textSeen: false };
    session.subscribe((event: any) => {
      if (event.type === "compaction_end" && event.result?.usage) {
        compactionCalls += 1;
        const u = event.result.usage;
        compactionTokens += Number(u.totalTokens) || (Number(u.input) || 0) + (Number(u.output) || 0);
        compactionCostUsd += Number(u.cost?.total) || 0;
      }
      mapSessionEvent(event, eventBuffer, mapState, () => { /* usage handled by the extension */ });
      if (event.type === "agent_end") agentDone = true;
      wakeGenerator();
    });

    // Design: forward caller cancellation into the session. `abort()` stops
    // the agent loop at its tool/turn seams; waking the generator makes run()
    // end even when the stream function never settles. This is the ans_chat
    // request signal; search tools forward their own signal to the engine.
    const cancelRun = () => {
      if (callerCancelled) return;
      callerCancelled = true;
      try { void session.abort(); } catch { /* no active run to abort */ }
      wakeGenerator();
    };
    callerSignal?.addEventListener("abort", cancelRun, { once: true });
    // Close the check/registration race: an abort that lands between the guard
    // at the top of run() and this listener would otherwise go unnoticed.
    if (callerSignal?.aborted) cancelRun();
    // No reservation or provider call for a run that was cancelled before the
    // agent prompt started. The finally below is not active yet, so drop the
    // listener here instead of relying on it.
    if (callerCancelled) {
      callerSignal?.removeEventListener("abort", cancelRun);
      try { session.dispose(); } catch { /* already disposed */ }
      return;
    }

    // Design: runtime billing requires store + sessionId + ledger, the same
    // gate MemoryPipeline uses — a half-wired runtime cannot touch
    // budget_ledger, and both startup paths hand over the engine's ledger
    // only after the session row exists (#178).
    const billingWired = !!(store && sessionId && ledger);

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

    // Correction propagation (#Q3): if a correction paused this session's
    // rolling summary, rebuild it from valid materials before the turn builds
    // its prompt, so this run never injects a corrected fact. Fail-open: a
    // failed rebuild leaves the pause in place (the stale block stays out).
    if (this.pipeline) {
      try { await this.pipeline.refreshIfNeeded(); } catch { /* fail-open */ }
    }

    // #188 (T9): reserve tokens at the agent_start boundary — before
    // agent.prompt is invoked, so an exhausted budget stops the run instead of
    // being discovered after a provider call. Formula = input-side occupancy
    // (provider usage anchor when present, estimate on a cold start) + the
    // output-side static limit ([budget].outputReserveTokens, default 12288).
    //
    // A rejected reserve is the hard stop from #186 decision 5: yield the
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
          yield {
            type: "error",
            message:
              "Token budget exhausted: this run needs " + reserveAmount +
              " tokens reserved (input " + inputOccupancy.tokens +
              " + output limit " + outputReserve + ") but the session cap cannot cover it. " +
              "The run was not started; raise [budget] tokenCap and retry (the next run re-reads the domain TOML).",
          };
          try { session.dispose(); } catch { /* already disposed */ }
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
      // Start the session prompt in background. Prompt templates stay off:
      // a user message beginning with "/" is text, not a host command.
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

      // Budget settle at agent_end (decision 5, amended #103/#188).
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
        // settle-only (#186 decision 6: no price table).
        settleTokenReserve(usageTotals.totalTokens);
        if (usageTotals.costUsd > 0) {
          try {
            ledger!.settleUsd(sessionId!, 0, usageTotals.costUsd);
          } catch (e) {
            reportBudgetFault("usd settlement", e);
          }
        }
      }

      // decision 6: dual session — sync this run's finalized messages to FTS5.
      // Only the run's own messages: the PI record owns history, and re-appending
      // a resumed session's whole transcript would duplicate rows per call.
      if (this.opts.store) {
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
        // #178: the total is the same figure settled into the ledger
        // (settleTokens) — the summary must not under-report cache tokens.
        const tokenSummary = usageTotals.totalTokens > 0
          ? ` (tokens: ${usageTotals.inputTokens} in + ${usageTotals.outputTokens} out = ${usageTotals.totalTokens} total)`
          : "";
        // #189: make the one-shot recovery visible next to the run summary.
        const recovery = this.pipeline?.getInjectedRecoveryDigest();
        // #Q1 evidence: PI's own view of the window this session runs with.
        // The value comes from the SDK model registered from LlmSessionOptions,
        // so it proves the configured 1M window reached the agent session.
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
          usage: toRunUsage(usageTotals, compactionCalls, compactionTokens, compactionCostUsd),
        };
      }
    } finally {
      callerSignal?.removeEventListener("abort", cancelRun);
      // #188 (CodeRabbit): stop the run before its reservation is released, so
      // a consumer that closed the stream early cannot leave the agent making
      // provider/tool calls after the budget was freed. The signal exists only
      // while a run is active, so a normal end is a no-op.
      let abortedEarly = false;
      if (promptPromise && !agentDone) {
        try { void session.abort(); } catch { /* already idle */ }
        abortedEarly = true;
      }
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
        // estimate. A provider-reported zero still settles as zero.
        const actual = abortedEarly && !usageReported ? tokenReserved : usageTotals.totalTokens;
        settleTokenReserve(actual);
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
          () => settleTokenDelta(usageTotals.totalTokens),
          () => settleTokenDelta(usageTotals.totalTokens),
        );
      }
      // Release the session listeners; the JSONL record is already durable.
      try { session.dispose(); } catch { /* already disposed */ }
    }
  }

  /**
   * Drain background memory writes before the caller closes the store.
   *
   * `consolidate()` intentionally does not block a turn on summary generation or
   * L2 recall, so a run can end with anchor writes still in flight. A caller
   * that owns the store (the CLI, which closes it during teardown) must await
   * this first or those writes are lost. No-op when no pipeline is wired.
   */
  async flushMemory(): Promise<void> {
    if (this.pipeline) await this.pipeline.flush();
  }

  /** Usage of the memory pipeline's own summary calls (separate from the run). */
  getMemoryUsage(): { calls: number; inputTokens: number; outputTokens: number; totalTokens: number; costUsd: number; missing: string[] } | null {
    return this.pipeline ? this.pipeline.getSummaryUsage() : null;
  }
}
