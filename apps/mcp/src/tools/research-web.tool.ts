// research_web tool: multi-round deep research with dedup + citations.
// ADR-0008 D3 multi-round search; ADR-0014 D4 dual-channel sufficiency.
// SECURITY: cap rounds to prevent quota exhaustion (CWE-400).

import type { McpServer } from "@modelcontextprotocol/server";
import { fromJsonSchema } from "@modelcontextprotocol/server";
import type { CompositionResult } from "@anysearch/kernel";
import { KernelJsonSchemas } from "@anysearch/kernel";

export function registerResearchWeb(server: McpServer, eng: CompositionResult): void {
  server.registerTool(
    "research_web",
    {
      description: "Deep research mode: multi-round search + LLM synthesis. Takes a question and returns a structured research report.",
      inputSchema: fromJsonSchema(KernelJsonSchemas.research_web),
    },
    async (args: unknown) => {
      const { question, depth } = args as { question: string; depth?: "brief" | "standard" | "deep" };
      const d = depth ?? "standard";
      // SECURITY: cap multi-round fanout to prevent API quota exhaustion (CWE-400).
      const rounds = d === "brief" ? 1 : d === "deep" ? 3 : 2;
      // ADR-0008 D3: multi-round — each round refines query from prior results.
      const allResults: Array<{ title: string; url: string; snippet: string; source: string }> = [];
      const seenUrls = new Set<string>();
      let lastRoundSufficiency: unknown;
      let currentQuery = question;
      for (let round = 0; round < rounds; round++) {
        const envelope = await eng.retriever.search({ query: currentQuery, mode: "deep" });
        // Auto-index each round to FTS5.
        try {
          const session = await eng.store.createSession("mcp-research");
          await eng.store.saveResults(session.id, envelope.results);
        } catch {
          /* best-effort */
        }
        // ADR-0014 D4: capture sufficiency from last round.
        if (envelope.metadata?.sufficiency) {
          lastRoundSufficiency = envelope.metadata.sufficiency;
        }
        for (const r of envelope.results) {
          if (!seenUrls.has(r.url)) {
            seenUrls.add(r.url);
            allResults.push({ title: r.title, url: r.url, snippet: r.snippet, source: r.source });
          }
        }
        // Refine query: top result title as follow-up angle.
        if (round + 1 < rounds && envelope.results.length > 0) {
          currentQuery = envelope.results[0].title;
        }
      }
      const summary = JSON.stringify({
        question,
        depth: d,
        rounds,
        totalResults: allResults.length,
        results: allResults.slice(0, 10),
        citations: allResults.slice(0, 5).map((r) => ({ title: r.title, url: r.url, source: r.source })),
        ...(lastRoundSufficiency ? { sufficiency: lastRoundSufficiency } : {}),
      }, null, 2);
      return {
        content: [{ type: "text" as const, text: summary }],
        ...(lastRoundSufficiency ? { structuredContent: { sufficiency: lastRoundSufficiency } } : {}),
      };
    }
  );
}
