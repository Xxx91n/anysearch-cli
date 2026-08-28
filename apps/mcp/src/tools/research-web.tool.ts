// research_web tool: deep multi-round search via engine.retriever.
// ADR-0008 D2: thin wrapper, engine result directly to MCP JSON.
// ADR-0020 D1.1: no console.* in MCP source — write to stderr explicitly.
// ADR-0022 D1: provider answers marked as provider-generated (verified:false at contract).
// ADR-0034 D4: attribution included in both content JSON and structuredContent (SEP-1624).

import type { McpServer } from "@modelcontextprotocol/server";
import { fromJsonSchema } from "@modelcontextprotocol/server";
import { KernelJsonSchemas, type CompositionResult } from "@anysearch/kernel";

export function registerResearchWeb(server: McpServer, eng: CompositionResult): void {
  server.registerTool(
    "research_web",
    {
      description: "Run a deep research query: multiple retrieval rounds fused via RRF, returns sufficiency signal and top citations.",
      inputSchema: fromJsonSchema(KernelJsonSchemas.research_web),
    },
    async (args: unknown) => {
      const { question, depth } = args as { question: string; depth?: string };
      const d = depth ?? "deep";
      let allResults: any[] = [];
      let lastRoundSufficiency: Record<string, unknown> | undefined;
      let lastRoundAttribution: unknown;
      let rounds = 0;

      try {
        const maxRounds = d === "deep" ? 3 : 1;
        const seenUrls = new Set<string>();
        for (let round = 0; round < maxRounds; round++) {
          const envelope = await eng.retriever.search({
            query: round === 0 ? question : question + " (round " + (round + 1) + ")",
            mode: "deep" as const,
            maxResults: 10,
          });
          rounds++;
          // ADR-0023 D1: sufficiency gate — this is the LAST round's sufficiency; earlier rounds tracks but the gate cares about the final state.
          lastRoundSufficiency = envelope.metadata?.sufficiency as unknown as Record<string, unknown> | undefined;
          // ADR-0034 D4: capture attribution from the last round envelope as report.
          lastRoundAttribution = envelope.attribution;

          const newItems = (envelope.results ?? []).filter((r: any) => !seenUrls.has(r.url));
          newItems.forEach((r: any) => seenUrls.add(r.url));
          allResults = allResults.concat(newItems);

          // Stop early when sufficiency verdict is "correct" (engine D5).
          if (envelope.metadata?.sufficiency?.verdict === "correct") break;
        }

        const lastRound = allResults.slice(-10);
        const summary = JSON.stringify(
          {
            question,
            depth: d,
            rounds,
            totalResults: allResults.length,
            results: lastRound.slice(0, 10),
            citations: allResults.slice(0, 5).map((r: any) => ({ title: r.title, url: r.url, source: r.source })),
            // ADR-0022 D1/D2/D3: provider answers pass through unmodified.
            // Round-47 fix: stable output shape.
            ...(lastRoundSufficiency ? { sufficiency: lastRoundSufficiency } : {}),
            // ADR-0034 D4: attribution from last round (claim-level evidence linkage).
            ...(lastRoundAttribution ? { attribution: lastRoundAttribution } : { attribution: null }),
          },
          null,
          2,
        );

        return {
          content: [{ type: "text" as const, text: summary }],
          ...(lastRoundSufficiency || lastRoundAttribution
            ? { structuredContent: {
                ...(lastRoundSufficiency ? { sufficiency: lastRoundSufficiency } : {}),
                ...(lastRoundAttribution ? { attribution: lastRoundAttribution } : {}),
              } }
            : {}),
        };
      } catch (e) {
        return { content: [{ type: "text" as const, text: "research_web error: " + (e instanceof Error ? e.message : String(e)) }] };
      }
    },
  );
}
