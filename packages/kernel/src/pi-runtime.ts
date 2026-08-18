// PiAgentRuntime: AgentRuntime interface implementation via pi-agent-core.
// ADR-0007 decision 2: lives in packages/kernel.
// ADR-0007 decision 3: maps pi-agent-core 9 events to our 7 AgentEvent types.
// ADR-0007 decision 4: Domain 5-layer full consumption.
// ADR-0007 decision 5: token dimension budget via onResponse.
// ADR-0007 decision 6: dual session (pi Agent memory + SqliteSessionStore FTS5 sync).

import { Agent } from "@earendil-works/pi-agent-core";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@sinclair/typebox";
import type { RetrieverPort, SessionStorePort, ToolPort, DomainConfigPort, BudgetLedgerPort, Query } from "./ports";
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
  const active = new Set(domain.skills.active);
  const whitelist = new Set(domain.hooks.toolWhitelist);
  // A tool passes if it's in both active and whitelist, or in whitelist if active is empty.
  if (active.size === 0) {
    return tools.filter(t => whitelist.size === 0 || whitelist.has(t.name));
  }
  return tools.filter(t => active.has(t.name) && (whitelist.size === 0 || whitelist.has(t.name)));
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
      // If domain.rag.adapter is set, inject retrieval context before each LLM call.
      transformContext: domain.rag.adapter
        ? (ctx: any) => {
            // ponytail: minimal RAG injection — prepend domain rag config as context note.
            // Full RAG adapter wiring deferred until rag adapter types are defined.
            if (domain.rag.config?.note) {
              return {
                ...ctx,
                systemPrompt: (ctx.systemPrompt || "") + "\n\n[RAG Context] " + domain.rag.config.note,
              };
            }
            return ctx;
          }
        : undefined,
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
    // ponytail: rough estimate — 4096 tokens per turn, reserve up front.
    if (ledger && sessionId) {
      ledger.reserveCalls(sessionId, 1);
    }

    // Start the agent prompt in background.
    const promptPromise = agent.prompt(input).catch((e: any) => {
      agentError = e?.message || String(e);
      agentDone = true;
    });

    // Yield events as they arrive.
    while (!agentDone || eventBuffer.length > 0) {
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
      } catch {
        // ponytail: FTS5 sync is best-effort, don't block agent on store failure.
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
