// search_web tool: fast/index search via engine.retriever.
// ADR-0008 D2: thin wrapper, engine result directly to MCP JSON.
// ADR-0020 D1.1: no console.* in MCP source — write to stderr explicitly.
// ADR-0022 D1: provider answers marked as provider-generated (verified:false at contract).
// ADR-0034 D4: attribution included in both content JSON and structuredContent (SEP-1624).

import type { McpServer } from "@modelcontextprotocol/server";
import { fromJsonSchema } from "@modelcontextprotocol/server";
import { KernelJsonSchemas, type CompositionResult } from "@anysearch-cli/kernel";
import { observeTool } from "./observation.js";

export function registerSearchWeb(server: McpServer, eng: CompositionResult): void {
  server.registerTool(
    "search_web",
    {
      description: "Search the web via anysearch provider amalgamation. Returns results with MVSS sufficiency signal.",
      inputSchema: fromJsonSchema(KernelJsonSchemas.search_web),
    },
    async (args: unknown) => {
      return observeTool(eng, "search_web", async (span) => {
        const { query, mode, maxResults } = args as { query: string; mode?: string; maxResults?: number };
        // ADR-0019 D3: args validated by AJV upstream (fromJsonSchema).
        try {
          const envelope = await eng.retriever.search({ query, mode: (mode as any) ?? "fast", maxResults, span });
          const topResults = envelope.results.slice(0, 10);

        // ADR-0022 D1: provider answers pass through as first-class fields.
        // ADR-0034 D4: attribution attached to envelope by engine.attachAttribution().
          const summary = JSON.stringify(
          {
            query,
            totalResults: envelope.results.length,
            showing: topResults.length,
            results: topResults,
            // ADR-0022 D1/D2/D3: first-class answers marked providerGenerated+unverified.
            // Round-47 fix: stable output shape — always emit answers / answersAvailable / providerAnswers
            // (key presence no longer conditional; aligns with SEP-1624 stable structured schema).
            // verified:false is locked at contract layer (ProviderAnswer); do not re-stamp here.
            answers: envelope.answers ?? [],
            answersAvailable: envelope.metadata?.answersAvailable ?? false,
            providerAnswers: envelope.metadata?.providerAnswers ?? [],
            providersQueried: envelope.metadata?.providersQueried ?? [],
            // ADR-0034 D4: attribution = claim-level evidence linkage report (present iff search ran).
            ...(envelope.attribution ? { attribution: envelope.attribution } : { attribution: null }),
            // ADR-0062 D3: first-class abstain marker — policy success, not error.
            abstain: envelope.metadata?.abstain ?? null,
            // ADR-0014 D4: MCP sufficiency annotation — A+ dual-channel.
            ...(envelope.metadata?.sufficiency ? { sufficiency: envelope.metadata.sufficiency } : {}),
          },
          null,
          2,
          );

          // Auto-index into session store (best-effort, fail-open).
          try {
            const session = await eng.store.createSession("mcp");
            await eng.store.saveResults(session.id, envelope.results);
          } catch (e) {
            // ponytail: auto-index is best-effort, don't block search response.
            process.stderr.write("search_web auto-index error: " + (e instanceof Error ? e.message : String(e)) + "\n");
          }

          const attribution = envelope.attribution;
          const abstain = envelope.metadata?.abstain;
          // ADR-0062 D3 (T3): abstain surfaces as structuredContent.abstain with
          // isError absent (false). The block is emitted whenever any of
          // sufficiency/attribution/abstain is present.
          const structuredContent = {
            ...(envelope.metadata?.sufficiency ? { sufficiency: envelope.metadata.sufficiency } : {}),
            ...(attribution ? { attribution } : {}),
            ...(abstain ? { abstain } : {}),
          };
          return {
            content: [{ type: "text" as const, text: summary }],
            ...(Object.keys(structuredContent).length > 0 ? { structuredContent } : {}),
          };
        } catch (e) {
          return { content: [{ type: "text" as const, text: "search_web error: " + (e instanceof Error ? e.message : String(e)) }] };
        }
      });
    },
  );
}
