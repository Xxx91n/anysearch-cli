// MCP Server factory: buildServer() registers 5 tools.
// ADR-0008 D1: context-management mental model (context-mode style).
// ADR-0008 D3: 5 MCP tools — search_web / research_web / recall_memory / query_knowledge / ans_chat.
// ADR-0008 D5: v1 SDK. ponytail: v1 registerTool only accepts zod, not TypeBox.
//   TypeBox deferred to v2 SDK upgrade (fromJsonSchema). Tracked as ponytail debt.
// ADR-0008 D7: createEngine() from @anysearch/kernel.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createEngine, type CompositionResult } from "@anysearch/kernel";

// buildServer: factory function. Each connection gets a fresh server instance.
// ADR-0008 D4: factory pattern, era-agnostic, entry selects transport.
export function buildServer(engine?: CompositionResult): McpServer {
  const eng = engine ?? createEngine();
  const server = new McpServer(
    { name: "anysearch", version: "0.0.0" },
    { capabilities: { tools: {} } }
  );

  // Tool 1: search_web — fanout search + auto-index to FTS5, return distilled summary.
  server.registerTool(
    "search_web",
    {
      description: "Search the web using multiple search engines (exa, tavily, anysearch). Results are auto-indexed to FTS5 and a distilled summary is returned.",
      inputSchema: z.object({
        query: z.string().describe("The search query"),
        mode: z.enum(["fast", "deep", "answer"]).optional().describe("Search mode: fast (default), deep (more sources), answer (with synthesis)"),
      }),
    },
    async (args: Record<string, unknown>) => {
      const query = String(args.query);
      const mode = (args.mode as "fast" | "deep" | "answer") || "fast";
      const envelope = await eng.retriever.search({ query, mode });
      // ponytail: distill to top 5 results to save Agent context window.
      const topResults = envelope.results.slice(0, 5).map(r => ({
        title: r.title,
        url: r.url,
        snippet: r.snippet,
        source: r.source,
      }));
      const summary = JSON.stringify({
        query,
        totalResults: envelope.results.length,
        showing: topResults.length,
        results: topResults,
        providersQueried: envelope.metadata.providersQueried,
      }, null, 2);
      return { content: [{ type: "text", text: summary }] };
    }
  );

  // Tool 2: research_web — minute-level deep research (stub, G018 will implement multi-round).
  server.registerTool(
    "research_web",
    {
      description: "Deep research mode: multi-round search + LLM synthesis. Takes a question and returns a structured research report.",
      inputSchema: z.object({
        question: z.string().describe("The research question to investigate"),
        depth: z.enum(["brief", "standard", "deep"]).optional().describe("Research depth: brief (1 round), standard (3 rounds), deep (5+ rounds)"),
      }),
    },
    async (args: Record<string, unknown>) => {
      // ponytail: stub until G018 implements multi-round deep research.
      const question = String(args.question);
      const envelope = await eng.retriever.search({ query: question, mode: "deep" });
      const summary = JSON.stringify({
        question,
        phase: "stub",
        results: envelope.results.slice(0, 10),
      }, null, 2);
      return { content: [{ type: "text" as const, text: summary }] };
    }
  );

  // Tool 3: recall_memory — FTS5 search with time edge effect (stub, G019 will implement).
  server.registerTool(
    "recall_memory",
    {
      description: "Search the Research Memory layer (FTS5) for previously indexed research results. Applies time edge effect: decay, bi-temporal invalidation, QDF classification.",
      inputSchema: z.object({
        query: z.string().describe("The memory recall query"),
        limit: z.number().optional().describe("Max results to return (default 5)"),
      }),
    },
    async (_args: Record<string, unknown>) => {
      // ponytail: stub until G019 implements FTS5 time edge effect.
      return { content: [{ type: "text" as const, text: "recall_memory: not yet implemented (G019)" }] };
    }
  );

  // Tool 4: query_knowledge — RAG adapter dispatch (stub, G018 will implement).
  server.registerTool(
    "query_knowledge",
    {
      description: "Query domain-specific knowledge base via RAG adapter. Dispatches to configured rag.adapter in domain config.",
      inputSchema: z.object({
        query: z.string().describe("The knowledge base query"),
      }),
    },
    async (_args: Record<string, unknown>) => {
      // ponytail: stub until RAG adapter types are defined.
      const adapter = eng.config?.rag?.adapter ?? "none";
      return { content: [{ type: "text" as const, text: "query_knowledge: adapter=" + adapter + " (not yet implemented)" }] };
    }
  );

  // Tool 5: ans_chat — PiAgentRuntime agent loop as MCP tool.
  // ponytail: inlines CLI chat.ts LLM init logic; MCP package can't depend on CLI package.
  server.registerTool(
    "ans_chat",
    {
      description: "Run the anysearch agent loop: retrieval-augmented chat with LLM. Uses PiAgentRuntime with domain-aware tool filtering.",
      inputSchema: z.object({
        message: z.string().describe("The user message to send to the agent"),
      }),
    },
    async (args: Record<string, unknown>) => {
      const message = String(args.message);
      const providerName = process.env.ANS_LLM_PROVIDER;
      const modelName = process.env.ANS_LLM_MODEL;
      if (!providerName || !modelName) {
        return { content: [{ type: "text", text: "ans_chat: LLM not configured. Set ANS_LLM_PROVIDER and ANS_LLM_MODEL env vars." }] };
      }
      try {
        const [{ createModels }, PiAgentRuntime] = await Promise.all([
          import("@earendil-works/pi-ai"),
          import("@anysearch/kernel").then(m => m.PiAgentRuntime),
        ]);
        const providerMod = await import("@earendil-works/pi-ai/providers/" + providerName);
        const models = createModels();
        models.setProvider(providerMod.default ? providerMod.default() : providerMod[providerName + "Provider"]());
        const model = models.getModel(providerName, modelName);
        if (!model) return { content: [{ type: "text", text: "ans_chat: model not found: " + providerName + "/" + modelName }] };
        const streamFn = models.streamSimple.bind(models);
        const apiKey = providerName === "openai" ? process.env.OPENAI_API_KEY
          : providerName === "anthropic" ? process.env.ANTHROPIC_API_KEY
          : providerName === "google" ? (process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY)
          : undefined;
        const domain = eng.config ?? {
          sources: { enabled: [] },
          prompts: [],
          skills: { active: ["search"] },
          hooks: { toolWhitelist: ["search"] },
          rag: { adapter: "none" },
        };
        const runtime = new PiAgentRuntime({
          retriever: eng.retriever,
          domain,
          model,
          streamFn,
          getApiKey: async () => apiKey,
        });
        let output = "";
        for await (const event of runtime.run(message)) {
          if (event.type === "text") output += event.content;
          else if (event.type === "done") output += "\n" + event.summary;
          else if (event.type === "error") output += "\n[error: " + event.message + "]";
        }
        return { content: [{ type: "text", text: output || "ans_chat: no response" }] };
      } catch (e) {
        return { content: [{ type: "text", text: "ans_chat error: " + (e instanceof Error ? e.message : String(e)) }] };
      }
    }
  );

  return server;
}
