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
      // ADR-0008 D3: auto-index results to FTS5 (context-mode mental model).
      try {
        const session = await eng.store.createSession("mcp");
        await eng.store.saveResults(session.id, envelope.results);
      } catch (e) {
        // ponytail: auto-index is best-effort, don't block search response.
        process.stderr.write("search_web auto-index error: " + (e instanceof Error ? e.message : String(e)) + "\n");
      }
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

  // Tool 2: research_web — multi-round deep research with dedup + structured citations.
  server.registerTool(
    "research_web",
    {
      description: "Deep research mode: multi-round search + LLM synthesis. Takes a question and returns a structured research report.",
      inputSchema: z.object({
        question: z.string().describe("The research question to investigate"),
        depth: z.enum(["brief", "standard", "deep"]).optional().describe("Research depth: brief (1 round), standard (2 rounds), deep (3 rounds)"),
      }),
    },
    async (args: Record<string, unknown>) => {
      const question = String(args.question);
      const depth = (args.depth as "brief" | "standard" | "deep") || "standard";
      // SECURITY: cap multi-round fanout to prevent API quota exhaustion (CWE-400).
      // ponytail: max 3 rounds — increase when budget enforcement lands.
      const rounds = depth === "brief" ? 1 : depth === "deep" ? 3 : 2;
      // ADR-0008 D3: multi-round search — each round refines query from prior results.
      const allResults: Array<{ title: string; url: string; snippet: string; source: string }> = [];
      const seenUrls = new Set<string>();
      let currentQuery = question;
      for (let round = 0; round < rounds; round++) {
        const envelope = await eng.retriever.search({ query: currentQuery, mode: "deep" });
        // Auto-index each round to FTS5.
        try {
          const session = await eng.store.createSession("mcp-research");
          await eng.store.saveResults(session.id, envelope.results);
        } catch { /* best-effort */ }
        for (const r of envelope.results) {
          if (!seenUrls.has(r.url)) {
            seenUrls.add(r.url);
            allResults.push({ title: r.title, url: r.url, snippet: r.snippet, source: r.source });
          }
        }
        // Refine query: pick top result title as follow-up angle.
        if (round + 1 < rounds && envelope.results.length > 0) {
          currentQuery = envelope.results[0].title;
        }
      }
      const summary = JSON.stringify({
        question,
        depth,
        rounds,
        totalResults: allResults.length,
        results: allResults.slice(0, 10),
        citations: allResults.slice(0, 5).map(r => ({ title: r.title, url: r.url, source: r.source })),
      }, null, 2);
      return { content: [{ type: "text" as const, text: summary }] };
    }
  );

  // Tool 3: recall_memory — FTS5 search with time edge effect.
  // G019: uses time_decay SQL function registered in SessionStore.
  server.registerTool(
    "recall_memory",
    {
      description: "Search the Research Memory layer (FTS5) for previously indexed research results. Applies time edge effect: decay, bi-temporal invalidation, QDF classification.",
      inputSchema: z.object({
        query: z.string().describe("The memory recall query"),
        limit: z.number().optional().describe("Max results to return (default 5)"),
      }),
    },
    async (args: Record<string, unknown>) => {
      try {
        const query = String(args.query);
        const limit = Number(args.limit) || 5;
        // ADR-0008 D3: FTS5 memory recall with time edge effect.
        const { isTimeSensitive, isEvergreen } = await import("@anysearch/store");
       // ADR-0008 D3: search Research Memory layer (retrieval_results_fts), not messages.
       const hits = await eng.store.searchMemory(query, limit);
       const ts = isTimeSensitive(query);
       const eg = isEvergreen(query);
        // ADR-0009 D4: Two-stage recall pipeline.
        // Stage 2: project index fallback (if internal hits insufficient).
        // provenance tagged, no cross-layer score mixing.
        let projectHits: Array<{ title: string; url: string; snippet: string; source: string; rank: number; createdAt: string }> = [];
        if (hits.length < limit) {
          try {
            const { ProjectIndexStore } = await import("@anysearch/plugin");
            const dbPath = process.env.ANS_PROJECT_DB || "";
            if (dbPath) {
              const store = new ProjectIndexStore(dbPath);
              projectHits = store.search(query, limit - hits.length);
              store.close();
            }
          } catch {
            // ponytail: project index optional, fail-open.
          }
        }
       const summary = JSON.stringify({
         query,
         qdfClassification: ts ? "time-sensitive" : eg ? "evergreen" : "standard",
         decayActive: !eg,
          hitsCount: hits.length + projectHits.length,
          internal: hits.map(h => ({
           role: h.role,
           content: h.content.slice(0, 200),
           rank: h.rank,
           sessionId: h.sessionId,
           provenance: "internal",
         })),
         projectIndex: projectHits.map(h => ({
           title: h.title,
           url: h.url,
           snippet: (h.snippet || "").slice(0, 200),
           source: h.source,
           rank: h.rank,
           provenance: "project-index",
         })),
       }, null, 2);
        return { content: [{ type: "text", text: summary }] };
      } catch (e) {
        return { content: [{ type: "text", text: "recall_memory error: " + (e instanceof Error ? e.message : String(e)) }] };
      }
    }
  );

  // Tool 4: query_knowledge — RAG adapter dispatch stub.
  // ADR-0006 MVP deferral: RAG adapter types not yet defined. Returns adapter name only.
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
          models,
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
