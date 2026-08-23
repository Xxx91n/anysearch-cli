// search_web tool: fanout + auto-index to FTS5 + distilled top-5 summary.
// ADR-0008 D3 / ADR-0014 D4 (sufficiency dual-channel).
// ADR-0019 D3: input validation lives in KernelToolSchemas (TypeBox + AJV); handler reads typed args.

import type { McpServer } from "@modelcontextprotocol/server";
import { fromJsonSchema } from "@modelcontextprotocol/server";
import type { CompositionResult } from "@anysearch/kernel";
import { KernelJsonSchemas } from "@anysearch/kernel";

export function registerSearchWeb(server: McpServer, eng: CompositionResult): void {
  server.registerTool(
    "search_web",
    {
      // ADR-0022 D1: surface provider answers as first-class output, marked unverified.
      description: "Search the web using multiple search engines (exa, tavily, anysearch). Results are auto-indexed to FTS5 and a distilled summary is returned. mode=answer additionally returns provider-generated answers (unverified, provider-side only).",
      inputSchema: fromJsonSchema(KernelJsonSchemas.search_web),
    },
    async (args: unknown) => {
      const { query, mode } = args as { query: string; mode?: "fast" | "deep" | "answer" };
      const m = mode ?? "fast";
      const envelope = await eng.retriever.search({ query, mode: m });
      // ponytail: distill to top 5 results to save Agent context window.
      const topResults = envelope.results.slice(0, 5).map((r) => ({
        title: r.title,
        url: r.url,
        snippet: r.snippet,
        source: r.source,
      }));
      // ADR-0008 D3: auto-index to FTS5 (context-mode mental model).
      try {
        const session = await eng.store.createSession("mcp");
        await eng.store.saveResults(session.id, envelope.results);
      } catch (e) {
        // ponytail: auto-index is best-effort, don't block search response.
        process.stderr.write("search_web auto-index error: " + (e instanceof Error ? e.message : String(e)) + "\n");
      }
      // ADR-0014 D4: MCP sufficiency annotation — A+ dual-channel (content + structuredContent).
      const sufficiency = envelope.metadata?.sufficiency;
      const summary = JSON.stringify({
        query,
        totalResults: envelope.results.length,
        showing: topResults.length,
        results: topResults,
        // ADR-0022 D1/D2/D3: first-class answers marked providerGenerated+unverified.
        answers: envelope.answers ?? [],
        answersAvailable: envelope.metadata?.answersAvailable ?? false,
        ...(envelope.metadata?.providerAnswers?.length
          ? { providerAnswers: envelope.metadata.providerAnswers.map(a => ({ ...a, providerGenerated: true, verified: false })) }
          : {}),
        providersQueried: envelope.metadata?.providersQueried ?? [],
        ...(sufficiency ? { sufficiency } : {}),
      }, null, 2);
      return {
        content: [{ type: "text" as const, text: summary }],
        ...(sufficiency ? { structuredContent: { sufficiency } } : {}),
      };
    }
  );
}
