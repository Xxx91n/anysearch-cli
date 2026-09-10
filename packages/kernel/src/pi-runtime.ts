// PiAgentRuntime: pi-agent-core Agent wrapper for anysearch-cli.
// ADR-0007 decision 2: lives in packages/kernel.
// ADR-0007 decision 3: maps pi-agent-core 9 events to our 7 AgentEvent types.
// ADR-0007 decision 4: Domain 5-layer full consumption.
// ADR-0007 decision 5: token dimension budget via onResponse.
// ADR-0007 decision 6: dual session (pi Agent memory + SqliteSessionStore FTS5 sync).
// ADR-0015: MemoryPipeline + SufficiencyEvaluator extracted as sibling deep modules.

import { Agent } from "@earendil-works/pi-agent-core";
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
} from "@anysearch/retriever";
import { ENV_ALLOW_OVERRIDE, ENV_URL_ALLOWLIST, createDomainReloader, parseEnvOverrideSwitch, resolveUrlPolicy } from "@anysearch/store";
import type { RetrieverPort, SessionStorePort, DomainConfigPort, BudgetLedgerPort, Query } from "./ports";
import type { AgentEvent } from "./runtime";
import { MemoryPipeline } from "./memory-pipeline";
import { SufficiencyEvaluator } from "./sufficiency-gate";

// ADR-0054 D4: HITL gate helpers for shouldAllowUrl (TTY ask / headless deny-first).
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

// Build the search AgentTool: wraps RetroaererdEngine.search() with TypeBox schema.
// The LLM sees this as a tool it can call to search the web.
function createSearchTool(retriever: RetrieverPort): AgentTool {
  return {
    name: "search",
    label: "Search",
    // ADR-0022 D1/D4: answer is provider-fulfilled (Exa/Tavily only); no CLI-side
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
      };
      const envelope = await retriever.search(q);
      // ADR-0054 D1: every retrieved payload crosses the LLM boundary through wrapRetrieved
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
          // ADR-0022 D1/D3: expose answers + provenance as first-class details.
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

// Filter AgentTools by domain skills.active + hooks.toolWhitelist.
function filterAgentTools(tools: AgentTool[], domain: DomainConfigPort): AgentTool[] {
  // ADR-0007 D4: hooks.toolWhitelist is the security filter.
  // skills.active is domain activation (not a tool filter).
  const whitelist = new Set(domain.hooks.toolWhitelist);
  if (whitelist.size === 0) return tools;
  return tools.filter(t => whitelist.has(t.name));
}

export interface PiAgentRuntimeOptions {
  retriever: RetrieverPort;
  store?: SessionStorePort;
  domain: DomainConfigPort;
  // ADR-0055 D5: when set, the allow/deny lists are re-read lazily per tool call via mtime.
  domainTomlPath?: string;
  model: unknown; // pi-ai Model instance
  streamFn: unknown; // models.streamSimple.bind(models)
  models?: unknown; // ADR-0012 D4: Models object for generateSummaryWithUsage
  ledger?: BudgetLedgerPort;
  sessionId?: string;
  tools?: AgentTool[]; // extra tools beyond search
  getApiKey?: () => Promise<string | undefined>;
  interactive?: boolean; // ADR-0054 D4: composition root grants TTY-ask eligibility (headless/MCP omit -> deny-first)
}

export class PiAgentRuntime {
  private opts: PiAgentRuntimeOptions;
  private readonly domainReloader: (() => unknown) | null;
  private warnedEnvIgnored = false;
  private pipeline?: MemoryPipeline;
  private gate?: SufficiencyEvaluator;

  constructor(opts: PiAgentRuntimeOptions) {
    this.domainReloader = opts.domainTomlPath ? createDomainReloader(opts.domainTomlPath) : null;
    // ADR-0055 D7 acceptance-4: the override switch is a strict enum at EVERY runtime
    // (server, hook, kernel), not just the plugin server. Misset -> throw at startup.
    parseEnvOverrideSwitch(process.env[ENV_ALLOW_OVERRIDE]);
    this.opts = opts;

    // ADR-0015 D8: constructor internally creates pipeline + gate instances.
    // Composition root responsible for wiring; caller opts unchanged.
    if (opts.store && opts.sessionId) {
      this.pipeline = new MemoryPipeline({
        store: opts.store,
        models: opts.models as any,
        retriever: opts.retriever,
        domain: opts.domain,
        model: opts.model as any,
        streamFn: opts.streamFn as any,
        sessionId: opts.sessionId,
        getApiKey: opts.getApiKey,
        providerName: (opts as any).providerName,
      });
    }
    this.gate = new SufficiencyEvaluator({
      retriever: opts.retriever,
      domain: opts.domain,
      streamFn: opts.streamFn as any,
      model: opts.model as any,
      getApiKey: opts.getApiKey,
    });
  }

  // ADR-0007 decision 3: run() returns AsyncIterable<AgentEvent>, mapping pi events.
  async *run(input: string): AsyncIterable<AgentEvent> {
    // SECURITY: timeout to prevent agent loop hang (CWE-400, CWE-840).
    // ponytail: 5-minute default, override via opts.timeoutMs.
    const timeoutMs = (this.opts as any).timeoutMs ?? 300000;
    const startTime = Date.now();
    const timedOut = () => Date.now() - startTime > timeoutMs;

    const { retriever, domain, model, streamFn, ledger, sessionId } = this.opts;

    // Build tools: search tool + any extra tools, filtered by domain.
    const searchTool = createSearchTool(retriever);
    const allTools = [searchTool, ...(this.opts.tools || [])];
    const activeTools = filterAgentTools(allTools, domain);

    // ADR-0007 decision 4: prompts -> systemPrompt
    const systemPrompt = buildSystemPrompt(domain);

    // Token budget tracking (ADR-0007 decision 5)
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    // Event buffer: collect events from subscribe() to yield them.
    const eventBuffer: AgentEvent[] = [];
    let resolveEvent: (() => void) | null = null;
    let agentDone = false;
    let agentError: string | null = null;

    // ADR-0015: hooks degrade to 2-line delegation to MemoryPipeline + SufficiencyEvaluator.
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
      // ADR-0007 decision 5: onResponse accumulates token usage.
      onResponse: (response: any) => {
        if (response?.usage) {
          totalInputTokens += response.usage.inputTokens || 0;
          totalOutputTokens += response.usage.outputTokens || 0;
        }
      },
      // ADR-0010 D1: transformContext async hot path — delegated to MemoryPipeline.inject.
      transformContext: async (messages: any[]) => {
        if (this.pipeline) return this.pipeline.inject(messages);
        return messages;
      },
      // ADR-0054 D1/D4: shouldAllowUrl at the agent-loop tool-call seam. Retrieved-derived
      // URLs not on the domain [sources].urlAllowlist are HITL-gated; deny-first headless.
      beforeToolCall: async (ctx: any) => {
        // ADR-0055 D5: lazy mtime-checked re-read; bad TOML keeps last known good.
        const reloaded = this.domainReloader ? this.domainReloader() : null;
        if (reloaded) (this.opts as { domain: DomainConfigPort }).domain = reloaded as DomainConfigPort;
        // ADR-0055 D7 single parse point: kernel consumes the same canonicalize+merge+
        // strict-switch resolver as server/hooks (audit M1: raw-array reads re-introduced drift).
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
      // ADR-0010 D1: shouldStopAfterTurn async cold path — delegated to SufficiencyEvaluator + MemoryPipeline.
      // Fires after each assistant turn; async, does not block current turn.
      shouldStopAfterTurn: async (ctx: any) => {
        const messages = (agent as any).state?.messages || [];
        const totalTokens = totalInputTokens + totalOutputTokens;
        // ADR-0016 D6: 3-line sequential call — evaluate -> applyTo -> consolidate.
        // Claim-ticket pattern: gate.evaluate returns envelope, gate.applyTo injects, pipeline.consolidate consumes.
        const lastTool = ctx?.lastToolName || ctx?.toolName || "";
        const hasSearchTurn = typeof lastTool === "string" && lastTool.includes("search");

        if (this.gate && this.pipeline) {
          try {
            const env = await this.gate.evaluate(messages);
            const enriched = this.gate.applyTo(messages, env);
            await this.pipeline.consolidate(enriched, totalTokens, env.hasRetrievalEvidence || hasSearchTurn);
          } catch {}
        } else if (this.pipeline) {
          try { await this.pipeline.consolidate(messages, totalTokens, hasSearchTurn); } catch {}
        }
        return false;
      },
    });

    // ADR-0007 decision 3: subscribe() 9 events -> our 7 AgentEvent types.
    agent.subscribe((event: any, _signal?: AbortSignal) => {
      switch (event.type) {
        case "message_update":
          if (event.assistantMessageEvent?.type === "text") {
            eventBuffer.push({ type: "text", content: event.assistantMessageEvent.text });
          }
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
         // ADR-0010 D1: rolling summary moved to shouldStopAfterTurn cold path.
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

    // Token budget: reserve at agent_start (ADR-0007 decision 5).
    // ponytail: per-call dimension used (token dimension pending BudgetLedgerPort API, ADR-0007 D5)
    if (ledger && sessionId) {
      ledger.reserveCalls(sessionId, 1);
    }

    // Start the agent prompt in background.
    const promptPromise = agent.prompt(input).catch((e: any) => {
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

    // Token budget: settle at agent_end (ADR-0007 decision 5).
    if (ledger && sessionId) {
      // ponytail: per-call settle (1 call reserved, 1 actual for the agent run).
      ledger.settleCalls(sessionId, 1, 1);
    }

    // ADR-0007 decision 6: dual session — sync to FTS5 store.
    if (this.opts.store) {
      try {
        const messages = (agent as any).state?.messages || [];
        for (const msg of messages) {
this.opts.store.append(sessionId || "default", {
            role: msg.role || "assistant",
            content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content),
            timestamp: Date.now(),
          } as any);
        }
      } catch (e) {
        // ponytail: FTS5 sync is best-effort, don't block agent on store failure.
        // But log the error so it's not silently swallowed (ADR-0007 debt fix).
        if (typeof process !== "undefined" && process.stderr) {
          process.stderr.write("[anysearch] FTS5 sync warning: " + (e instanceof Error ? e.message : String(e)) + "\n");
        }
      }
    }

    // Final event.
    if (agentError) {
      yield { type: "error", message: agentError };
    } else {
      const tokenSummary = totalInputTokens + totalOutputTokens > 0
        ? ` (tokens: ${totalInputTokens} in + ${totalOutputTokens} out)`
        : "";
      yield { type: "done", summary: `Agent completed${tokenSummary}` };
    }
  }
}
