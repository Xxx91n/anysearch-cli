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

import { Agent, estimateContextTokens } from "@earendil-works/pi-agent-core";
import type { AgentTool } from "@earendil-works/pi-agent-core";
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
import type { AgentEvent } from "./runtime";
import { MemoryPipeline } from "./memory-pipeline";
import { SufficiencyEvaluator } from "./sufficiency-gate";

// HITL gate helpers for shouldAllowUrl (TTY ask / headless deny-first).
// Kernel reads no env config (r94 discipline): the composition root passes
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
export function createSearchTool(retriever: RetrieverPort, span?: RetrievalObservationSink, onResults?: (urls: string[]) => void): AgentTool {
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
    execute: async (_toolCallId: string, params: any) => {
      const q: Query = {
        query: String(params.query),
        mode: (params.mode as "fast" | "index" | "deep" | "answer") || "fast",
        // pass the caller span through so retrieval
        // domain_filter.* audit events + anysearch.outcome land inside the
        // caller's trace (ans_chat path). Single span, multi-event — no
        // sub-spans per agent-loop turn.
        ...(span ? { span } : {}),
      };
      const envelope = await retriever.search(q);
      onResults?.((envelope.results ?? []).map((r) => r.url));
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
  models?: unknown; // Models object for generateSummaryWithUsage
  ledger?: BudgetLedgerPort;
  sessionId?: string;
  tools?: AgentTool[]; // extra tools beyond search
  getApiKey?: () => Promise<string | undefined>;
  /** #113: REAL model context window (LlmSession.contextWindow); undefined = unknown. */
  contextWindow?: number;
  interactive?: boolean; // composition root grants TTY-ask eligibility (headless/MCP omit -> deny-first)
  // caller observation span — retrieval audit events land
  // inside the caller's span events_json (ans_chat / third retrieval surface).
  span?: RetrievalObservationSink;
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
  // Latest assistant message's totalTokens (input incl. cache + output of the
  // most recent LLM call). One input to the L0 watermark's occupancy:
  // max(this, estimateContextTokens(messages)) in resolveContextOccupancy.
  // Cumulative totals are ledger-only and must never feed the watermark —
  // they are monotonic, so a crossed watermark would re-fire every turn.
  lastTotalTokens: number;
}

export function emptyUsageTotals(): UsageTotals {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0, lastTotalTokens: 0 };
}

// Accumulate one message_end payload into the run totals. Pure helper,
// exported for tests. Non-assistant messages and missing usage are ignored.
export function accumulateUsage(totals: UsageTotals, message: unknown): void {
  const msg = message as {
    role?: string;
    usage?: { input?: number; output?: number; totalTokens?: number; cost?: { total?: number } };
  } | undefined;
  if (!msg || msg.role !== "assistant" || !msg.usage) return;
  const input = Number(msg.usage.input) || 0;
  const output = Number(msg.usage.output) || 0;
  totals.inputTokens += input;
  totals.outputTokens += output;
  // totalTokens includes cache read/write tokens when the provider reports
  // them; fall back to input+output when absent.
  const messageTotal = Number(msg.usage.totalTokens) || (input + output);
  totals.totalTokens += messageTotal;
  totals.lastTotalTokens = messageTotal;
  totals.costUsd += Number(msg.usage.cost?.total) || 0;
}

// #113: current-context occupancy for the L0 watermark. `lastUsageTokens` is
// the provider-reported usage of the most recent assistant call; the estimate
// adds messages appended after that call (tool results, user turns) — exactly
// the lag window CodeRabbit flagged on PR #114. max() keeps a provider report
// that is larger than the local estimate from being under-counted.
export function resolveContextOccupancy(lastUsageTokens: number, messages: any[]): number {
  let estimated = 0;
  try {
    estimated = Number(estimateContextTokens(messages as any)?.tokens) || 0;
  } catch { /* fail-open: fall back to the usage figure */ }
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
  if (anchor > 0 || transcript.length > 0) {
    return { tokens: resolveContextOccupancy(anchor, transcript), coldStart: false };
  }
  let tokens = 0;
  try {
    // estimateTokens only reads `role`/`content`; wrapping the system prompt in
    // a user-shaped message makes it part of the same character estimate (a
    // "system" role is not a pi-agent-core message role and would count as 0).
    tokens += Math.ceil(Number(estimateContextTokens([{ role: "user", content: prompt }] as any)?.tokens) || 0);
    if (systemPrompt) {
      tokens += Math.ceil(Number(estimateContextTokens([{ role: "user", content: systemPrompt }] as any)?.tokens) || 0);
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
    // store is wired too. PREcondition: the composition root has registered the
    // session row (ensureSession) before the first search; otherwise the
    // resume_anchors FK would reject the anchor write. `opts` is not mutated
    // after construction, so this captured id is the runtime's only session id.
    const wiredSessionId = opts.store && opts.sessionId ? opts.sessionId : undefined;
    this.scopedRetriever = wiredSessionId
      ? { search: (q) => opts.retriever.search({ ...q, sessionId: q.sessionId ?? wiredSessionId }) }
      : opts.retriever;

    // constructor internally creates pipeline + gate instances.
    // Composition root responsible for wiring; caller opts unchanged.
    // Design: the gate stays exactly `store && sessionId` — narrowing it here
    // would change every composition root, far beyond this seam (#129).
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
  async *run(input: string): AsyncIterable<AgentEvent> {
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
    const searchTool = createSearchTool(this.scopedRetriever, this.opts.span, (urls) => saturation.record(urls));
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

    // hooks degrade to 2-line delegation to MemoryPipeline + SufficiencyEvaluator.
    const agent = new Agent({
      initialState: {
        systemPrompt,
        model: model as any,
        thinkingLevel: "off" as const,
        tools: activeTools,
        messages: [],
      },
      streamFn: streamFn as any,
      getApiKey: this.opts.getApiKey as any,
      sessionId,
      // #103: no onResponse here — pi-ai's ProviderResponse is {status, headers}
      // only (no usage); token accumulation lives in the message_end subscription.
      // transformContext async hot path — delegated to MemoryPipeline.inject.
      transformContext: async (messages: any[]) => {
        if (this.pipeline) return this.pipeline.inject(messages);
        return messages;
      },
      // shouldAllowUrl at the agent-loop tool-call seam. Retrieved-derived
      // URLs not on the domain [sources].urlAllowlist are HITL-gated; deny-first headless.
      beforeToolCall: async (ctx: any) => {
        // r19 T2: saturation stop — block further searches, let the model answer.
        if (ctx?.toolCall?.name === BUILTIN_SEARCH_TOOL && saturation.exhausted()) {
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
        // single parse point: kernel consumes the same canonicalize+merge+
        // strict-switch resolver as server/hooks (raw-array reads re-introduced drift).
        const src = (this.opts.domain as { sources?: { urlAllowlist?: string[]; urlDenylist?: string[] } } | undefined)?.sources;
        const policy = resolveUrlPolicy({ tomlHosts: src?.urlAllowlist ?? [], denyHosts: src?.urlDenylist ?? [] });
        if (policy.envHostsIgnored && !this.warnedEnvIgnored) {
          this.warnedEnvIgnored = true;
          process.stderr.write("[anysearch] " + ENV_URL_ALLOWLIST + " ignored; set " + ENV_ALLOW_OVERRIDE + "=1 to opt in\n");
        }
        const urls: string[] = JSON.stringify(ctx?.args ?? {}).match(/https?:\/\/[^\s"'<>\\)]+/g) ?? [];
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
            toolName: String(ctx?.toolCall?.name ?? "unknown"),
            reason: "retrieved-derived URL blocked pending human review",
          });
          return {
            block: true,
            reason: "Blocked retrieved-derived URL " + url + " (queued for `ans hitl review`)",
            terminate: true,
          };
        }
        return undefined;
      },
      // shouldStopAfterTurn async cold path — delegated to SufficiencyEvaluator + MemoryPipeline.
      // Fires after each assistant turn; async, does not block current turn.
      shouldStopAfterTurn: async (ctx: any) => {
        const messages = (agent as any).state?.messages || [];
        // #113: current context occupancy, not cumulative run spend. The
        // usage figure from the last assistant call is combined with a
        // trailing-message estimate so a tool result appended after that call
        // is counted before the next provider request. Cumulative totals
        // remain ledger-only (settled below after the run).
        const totalTokens = resolveContextOccupancy(usageTotals.lastTotalTokens, messages);
        // 3-line sequential call — evaluate -> applyTo -> consolidate.
        // Claim-ticket pattern: gate.evaluate returns envelope, gate.applyTo injects, pipeline.consolidate consumes.
        const lastTool = ctx?.lastToolName || ctx?.toolName || "";
        const hasSearchTurn = typeof lastTool === "string" && lastTool.includes("search");

        if (this.gate && this.pipeline) {
          try {
            const env = await this.gate.evaluate(messages);
            const enriched = this.gate.applyTo(messages, env);
            await this.pipeline.consolidate(enriched, totalTokens, env.hasRetrievalEvidence || hasSearchTurn);
          } catch { }
        } else if (this.pipeline) {
          try { await this.pipeline.consolidate(messages, totalTokens, hasSearchTurn); } catch { }
        }
        return false;
      },
    });

    // decision 3: subscribe 9 events -> our 7 AgentEvent types.
    // text mapping delegated to mapAssistantMessageEvent (pure, tested).
    const mapState = { textSeen: false };
    agent.subscribe((event: any, _signal?: AbortSignal) => {
      switch (event.type) {
        case "message_start":
          mapState.textSeen = false;
          break;
        case "message_update": {
          const mapped = mapAssistantMessageEvent(event.assistantMessageEvent, mapState);
          if (mapped) eventBuffer.push(mapped);
          break;
        }
        case "message_end":
          // #103: accumulate AssistantMessage.usage (tokens + pi-ai cost).
          accumulateUsage(usageTotals, event.message);
          if (event.message?.role === "assistant" && event.message?.usage) usageReported = true;
          break;
        case "tool_execution_start":
          eventBuffer.push({
            type: "tool_call",
            name: event.toolName,
            args: event.args,
          });
          if (event.toolName === "search") {
            eventBuffer.push({ type: "search", query: String(event.args?.query || "") });
          }
          break;
        case "tool_execution_end":
          eventBuffer.push({
            type: "tool_result",
            name: event.toolName,
            result: event.result,
          });
          if (event.toolName === "search") {
            eventBuffer.push({ type: "search_result", envelope: event.result });
          }
          break;
        case "agent_end":
          agentDone = true;
          // rolling summary moved to shouldStopAfterTurn cold path.
          break;
        case "error":
          agentError = event.error?.message || String(event.error || "Unknown error");
          break;
      }
      // Wake up the generator if it's waiting.
      if (resolveEvent) {
        const r = resolveEvent;
        resolveEvent = null;
        r();
      }
    });

    // Design: runtime billing requires store + sessionId + ledger, the same
    // gate MemoryPipeline uses — a half-wired runtime cannot touch
    // budget_ledger, and both composition roots hand over the engine's ledger
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
      // Start the agent prompt in background.
      promptPromise = agent.prompt(input).catch((e: any) => {
        agentError = e?.message || String(e);
        agentDone = true;
      });

      // Yield events as they arrive.
      while ((!agentDone || eventBuffer.length > 0) && !timedOut()) {
        if (eventBuffer.length > 0) {
          yield eventBuffer.shift()!;
        } else if (!agentDone) {
          // Wait for next event.
          await new Promise<void>((resolve) => {
            resolveEvent = resolve;
          });
        }
      }

      // Wait for prompt() to fully resolve.
      await promptPromise;
      // Drain any events that arrived between agent_end and promptPromise resolution.
      while (eventBuffer.length > 0) {
        yield eventBuffer.shift()!;
      }

      // SECURITY: timeout check after loop (CWE-400).
      if (timedOut() && !agentDone) {
        yield { type: "error", message: "Agent timeout after " + timeoutMs + "ms" };
      }

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

      // decision 6: dual session — sync to FTS5 store.
      if (this.opts.store) {
        // append() is async: an un-awaited rejection is NOT caught by the
        // surrounding try/catch and can terminate the process on Node >= 15, and
        // the message is lost anyway. Each write gets its own try so one failure
        // does not stop the remaining messages.
        const messages = (agent as any).state?.messages || [];
        for (const msg of messages) {
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
        yield {
          type: "done",
          summary: `Agent completed${tokenSummary}`,
          ...(recovery ? { recovery } : {}),
        };
      }
    } finally {
      // #188 (CodeRabbit): stop the run before its reservation is released, so
      // a consumer that closed the stream early cannot leave the agent making
      // provider/tool calls after the budget was freed. The signal exists only
      // while a run is active, so a normal end is a no-op.
      let abortedEarly = false;
      if (promptPromise && (agent as any).signal) {
        (agent as any).abort?.();
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
      if (promptPromise) {
        await Promise.race([
          promptPromise.then(() => { promptStopped = true; }, () => { promptStopped = true; }),
          new Promise<void>((resolve) => setTimeout(resolve, 1000)),
        ]);
      }
      if (promptStopped) {
        finalizeBudget();
      } else {
        // Provider still running: release the reservation now so an exiting
        // process cannot leave it behind, then add only the later delta when the
        // prompt finally stops (best-effort if the store is already closed).
        finalizeBudget();
        void promptPromise!.then(
          () => settleTokenDelta(usageTotals.totalTokens),
          () => settleTokenDelta(usageTotals.totalTokens),
        );
      }
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
}
