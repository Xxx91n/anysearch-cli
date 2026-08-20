// PiAgentRuntime: pi-agent-core Agent wrapper for anysearch-cli.
// ADR-0007 decision 2: lives in packages/kernel.
// ADR-0007 decision 3: maps pi-agent-core 9 events to our 7 AgentEvent types.
// ADR-0007 decision 4: Domain 5-layer full consumption.
// ADR-0007 decision 5: token dimension budget via onResponse.
// ADR-0007 decision 6: dual session (pi Agent memory + SqliteSessionStore FTS5 sync).

import { Agent, generateSummaryWithUsage, DEFAULT_COMPACTION_SETTINGS } from "@earendil-works/pi-agent-core";
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
  models?: unknown; // ADR-0012 D4: Models object for generateSummaryWithUsage
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
    // ADR-0012 D3: dual-track trigger — low watermark + REUSE/COMPRESS after search.
    // 128K low watermark (~12.8% of 1M window, anti context rot; design param, needs ablation).
    const LOW_WATERMARK_TOKENS = 128000;
    let lastSearchTurn = 0; // track if last turn had a search tool call (REUSE/COMPRESS signal).
    // ADR-0012 D5: IR 5-section summary schema customInstructions.
    const IR_CUSTOM_INSTRUCTIONS = [
      "Format the summary as exactly these 5 sections:",
      "1. Verified Evidence: facts confirmed by search results (append-only across compressions)",
      "2. Open Hypotheses: claims not yet verified (append-only)",
      "3. Rejected Sources: sources checked and dismissed (append-only)",
      "4. Key Numbers & Sources: important figures with source URLs",
      "5. Tool Calls & Read Status: which tools were called and what was read",
      "Sections 1-3 are append-only: preserve all existing entries, only add new ones.",
    ].join("\n");

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
      // ADR-0010 D1: transformContext async hot path — L1 session summary injection.
      // pi-agent-core signature: (messages: AgentMessage[], signal?) => Promise<AgentMessage[]>
      // Hot path: fast L1 recall (resume_anchors), prepend summary to first user message.
      // Cold path (L2 FTS5 deep recall) is in shouldStopAfterTurn below.
      transformContext: async (messages: any[]) => {
        let result = messages;

        // Stage 1: RAG injection — prepend RAG context note to first user message.
        // ponytail: pi-agent-core transformContext receives messages array, no ctx.systemPrompt.
        if (domain.rag.adapter && domain.rag.config?.note && result.length > 0) {
          const first = result[0];
          result = [
            { ...first, content: (typeof first.content === "string" ? first.content : "") + "\n\n[RAG Context] " + domain.rag.config.note },
            ...result.slice(1),
          ];
        }

        // ADR-0012 D8/D9/D12: L1+L2 merged injection at latest user message (hot zone).
        if (this.opts.store && sessionId) {
          try {
            const anchors = await this.opts.store.getAnchors(sessionId);
            // D12: read LATEST rolling_summary (was find() which got oldest due to ORDER BY id ASC).
            const summaryAnchors = anchors.filter(a => a.anchorType === "rolling_summary");
            const summaryAnchor = summaryAnchors[summaryAnchors.length - 1];
            const recallAnchors = anchors.filter(a => a.anchorType === "l2_recall");
            const recallAnchor = recallAnchors[recallAnchors.length - 1];

            const injections: string[] = [];
            // D9: L1 session memory, budget 4000 chars.
            if ((summaryAnchor?.payload as any)?.summary) {
              injections.push("[Session Memory] " + String((summaryAnchor.payload as any).summary).slice(0, 4000));
            }
            // D9: L2 research recall, budget 1500 chars. Fixes l2_recall write-read seam break.
            if ((recallAnchor?.payload as any)?.hits) {
              injections.push("[Research Recall] " + String((recallAnchor.payload as any).hits).slice(0, 1500));
            }

            if (injections.length > 0 && result.length > 0) {
              // D8: inject at LATEST user message (attention hot zone, prefix cache stable).
              const lastIdx = result.length - 1;
              const last = result[lastIdx];
              result = [
                ...result.slice(0, lastIdx),
                { ...last, content: (typeof last.content === "string" ? last.content : "") + "\n\n" + injections.join("\n\n") },
              ];
            }
          } catch {}
        }

        return result;
      },
      // ADR-0010 D1: shouldStopAfterTurn async cold path — L2 FTS5 deep recall + L0 rolling summary.
      // Fires after each assistant turn; async, does not block current turn.
      shouldStopAfterTurn: async (ctx: any) => {
        if (this.opts.store && sessionId) {
          try {
            const messages = (agent as any).state?.messages || [];
            const totalTokens = totalInputTokens + totalOutputTokens;
            // ADR-0012 D3: detect if last turn had a search tool call (REUSE/COMPRESS signal).
            const lastTool = ctx?.lastToolName || ctx?.toolName || "";
            if (typeof lastTool === "string" && lastTool.includes("search")) lastSearchTurn = 1;

            // ADR-0012 D3: dual-track trigger — low watermark OR post-search REUSE/COMPRESS.
            const triggerLowWatermark = totalTokens > LOW_WATERMARK_TOKENS;
            const triggerPostSearch = lastSearchTurn > 0 && messages.length > 4;
            if (triggerLowWatermark || triggerPostSearch) {
              lastSearchTurn = 0; // reset

              // ADR-0012 D4: reuse generateSummaryWithUsage, not compact().
              // D6: fire-and-forget — don't await, let summary land in next round.
              const modelsObj = this.opts.models as any;
              const summaryModel = (domain as any).compaction?.model
                ? (modelsObj?.getModel ? modelsObj.getModel((this.opts as any).providerName || "openai", (domain as any).compaction.model) : undefined)
                : (model as any);
              const actualModel = summaryModel || (model as any);

              if (modelsObj && actualModel) {
                // D5: IR 5-section schema via customInstructions.
                // D4: previousSummary for UPDATE incremental semantics.
                const prevAnchors = await this.opts.store.getAnchors(sessionId);
                const prevSummaryAnchors = prevAnchors.filter(a => a.anchorType === "rolling_summary");
                const prevSummaryAnchor = prevSummaryAnchors[prevSummaryAnchors.length - 1];
                const previousSummary = (prevSummaryAnchor?.payload as any)?.summary as string | undefined;

                generateSummaryWithUsage(
                  messages, modelsObj, actualModel,
                  DEFAULT_COMPACTION_SETTINGS.reserveTokens,
                  undefined, // signal
                  IR_CUSTOM_INSTRUCTIONS,
                  previousSummary,
                  "off", // thinkingLevel
                ).then((result: any) => {
                  if (result?.ok && result.value?.text) {
                    this.opts.store!.saveAnchor(sessionId!, "rolling_summary", {
                      summary: result.value.text,
                      tokenWatermark: totalTokens,
                      timestamp: Date.now(),
                    }).catch(() => {});
                  }
                }).catch(() => {});
              }
            }

            // ADR-0012 D10: L2 cold path — use latest search intent (tool_input.query), FTS5 only.
            const allMsgs = (agent as any).state?.messages || [];
            const lastToolCall = [...allMsgs].reverse().find((m: any) =>
              m.role === "assistant" && Array.isArray(m.content) &&
              m.content.some((c: any) => c.type === "tool_use" && typeof c.name === "string" && c.name.includes("search"))
            );
            const searchToolInput = lastToolCall?.content?.find((c: any) => c.type === "tool_use" && c.name?.includes("search"))?.input;
            const l2Query = searchToolInput?.query || "";
            if (typeof l2Query === "string" && l2Query.length > 3) {
              this.opts.store.searchMemory(l2Query, 5).then((hits) => {
                if (hits.length > 0) {
                  const memorySnippet = hits.map(h => h.content || "").slice(0, 200).join(" | ");
                  this.opts.store!.saveAnchor(sessionId!, "l2_recall", {
                    query: l2Query, hits: memorySnippet.slice(0, 2000), timestamp: Date.now(),
                  }).catch(() => {});
                }
              }).catch(() => {});
            }
          } catch {}
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
