// PiAgentRuntime: pi-agent-core Agent wrapper for anysearch-cli.
// ADR-0007 decision 2: lives in packages/kernel.
// ADR-0007 decision 3: maps pi-agent-core 9 events to our 7 AgentEvent types.
// ADR-0007 decision 4: Domain 5-layer full consumption.
// ADR-0007 decision 5: token dimension budget via onResponse.
// ADR-0007 decision 6: dual session (pi Agent memory + SqliteSessionStore FTS5 sync).

import { Agent } from "@earendil-works/pi-agent-core";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@sinclair/typebox";
import type { RetrieverPort, SessionStorePort, DomainConfigPort, BudgetLedgerPort, Query } from "./ports";
import type { AgentEvent } from "./runtime";

// Build the search AgentTool: wraps RetroaererdEngine.search() with TypeBox schema.
// The LLM sees this as a tool it can call to search the web.
function createSearchTool(retriever: RetrieverPort): AgentTool {
  return {
    name: "search",
    label: "Search",
    description: "Search the web for information using multiple search engines. Returns fused, deduplicated results with RRF ranking.",
    parameters: Type.Object({
      query: Type.String({ description: "The search query" }),
      mode: Type.Optional(Type.Union([
        Type.Literal("fast"),
        Type.Literal("deep"),
        Type.Literal("answer"),
      ], { description: "Search mode: fast (default), deep (more sources), answer (with synthesis)" })),
    }),
    execute: async (_toolCallId: string, params: any) => {
      const q: Query = {
        query: String(params.query),
        mode: (params.mode as "fast" | "deep" | "answer") || "fast",
      };
      const envelope = await retriever.search(q);
      const summary = JSON.stringify(envelope, null, 2);
      return {
        content: [{ type: "text", text: summary }],
        details: { resultCount: envelope.results?.length || 0 },
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
  model: unknown; // pi-ai Model instance
  streamFn: unknown; // models.streamSimple.bind(models)
  ledger?: BudgetLedgerPort;
  sessionId?: string;
  tools?: AgentTool[]; // extra tools beyond search
  getApiKey?: () => Promise<string | undefined>;
}

export class PiAgentRuntime {
  private opts: PiAgentRuntimeOptions;

  constructor(opts: PiAgentRuntimeOptions) {
    this.opts = opts;
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
    // ADR-0009 D3 L0: rolling summary — track turn count for N-turn trigger.
    let turnCount = 0;
    const ROLLING_SUMMARY_INTERVAL = 5; // every 5 turns, write summary to resume_anchors.
    const TOKEN_WATERMARK = 8000; // token watermark for L0 summary trigger.

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
      // ADR-0007 decision 4: rag.adapter -> transformContext injection.
      // ADR-0009 D3 L1: transformContext pipeline — [RAG注入] → [记忆注入] → [compaction修剪].
      // Always active now (not just when rag.adapter set), pipeline stages are no-ops if no data.
      transformContext: (ctx: any) => {
        let result = ctx;

        // Stage 1: RAG injection (if domain.rag.adapter configured).
        if (domain.rag.adapter && domain.rag.config?.note) {
          result = {
            ...result,
            systemPrompt: (result.systemPrompt || "") + "\n\n[RAG Context] " + domain.rag.config.note,
          };
        }

        // Stage 2: Memory injection (L1 — inject session summary + recall results).
        // ponytail: inject from resume_anchors if store is available.
        if (this.opts.store && sessionId) {
          try {
            // Sync: read anchors synchronously is not possible (async interface).
            // ponytail: memory injection happens via shouldStopAfterTurn compaction path instead.
            // This stage is a no-op placeholder for the pipeline shape; actual memory injection
            // occurs when compaction triggers and writes summary to resume_anchors.
          } catch {}
        }

        // Stage 3: compaction trimming — pi-agent-core handles via shouldStopAfterTurn.
        // No additional trimming needed here; the core handles message compaction.
        return result;
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
          // ADR-0009 D3 L0: rolling summary — increment turn count, trigger on watermark.
          turnCount++;
          if (turnCount % ROLLING_SUMMARY_INTERVAL === 0 || totalInputTokens + totalOutputTokens > TOKEN_WATERMARK) {
            if (this.opts.store && sessionId) {
              try {
                const messages = (agent as any).state?.messages || [];
                // ponytail: rolling summary = last 5 messages compressed to text.
                const recentMsgs = messages.slice(-ROLLING_SUMMARY_INTERVAL * 2);
                const summary = recentMsgs.map((m: any) => m.role + ": " + (typeof m.content === "string" ? m.content.slice(0, 200) : "[complex]")).join(" | ");
                this.opts.store.saveAnchor(sessionId, "rolling_summary", {
                  turnCount,
                  tokenWatermark: totalInputTokens + totalOutputTokens,
                  summary: summary.slice(0, 1000),
                });
              } catch {}
            }
          }
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
