// recall_memory tool: FTS5 with time edge effect + project index fallback (ADR-0009 D4 two-stage).
// ADR-0019 D3: input validated by AJV from KernelToolSchemas; handler reads typed args.

import type { McpServer } from "@modelcontextprotocol/server";
import { fromJsonSchema } from "@modelcontextprotocol/server";
import type { CompositionResult } from "@anysearch/kernel";
import { KernelJsonSchemas } from "@anysearch/kernel";
import { observeTool } from "./observation.js";

export function registerRecallMemory(server: McpServer, eng: CompositionResult): void {
  server.registerTool(
    "recall_memory",
    {
      description: "Search the Research Memory layer (FTS5) for previously indexed research results. Applies time edge effect: decay, bi-temporal invalidation, QDF classification.",
      inputSchema: fromJsonSchema(KernelJsonSchemas.recall_memory),
    },
    async (args: unknown) => {
      return observeTool(eng, "recall_memory", async () => {
      try {
        const { query, limit } = args as { query: string; limit?: number };
        const lim = limit ?? 5;
        // ADR-0008 D3: FTS5 memory recall with time edge effect.
        const { isTimeSensitive, isEvergreen } = await import("@anysearch/store");
        // ADR-0008 D3: search Research Memory layer (retrieval_results_fts), not messages.
        const hits = await eng.store.searchMemory(query, lim);
        const ts = isTimeSensitive(query);
        const eg = isEvergreen(query);
        // ADR-0009 D4: Two-stage recall pipeline.
        // Stage 2: project index fallback (if internal hits insufficient).
        // provenance tagged, no cross-layer score mixing.
        let projectHits: Array<{ title: string; url: string; snippet: string; source: string; rank: number; createdAt: string }> = [];
        if (hits.length < lim) {
          try {
            const { ProjectIndexStore } = await import("@anysearch/plugin");
            const dbPath = process.env.ANS_PROJECT_DB || "";
            if (dbPath) {
              const store = new ProjectIndexStore(dbPath);
              projectHits = store.search(query, lim - hits.length);
              store.close();
            }
          } catch {
            // ponytail: project index optional, fail-open.
          }
        }
        // ADR-0034 D4: no attribution — recall_memory reads from memory store, not provider envelopes.
        const summary = JSON.stringify({
          query,
          qdfClassification: ts ? "time-sensitive" : eg ? "evergreen" : "standard",
          decayActive: !eg,
          hitsCount: hits.length + projectHits.length,
          internal: hits.map((h) => ({
            role: h.role,
            content: h.content.slice(0, 200),
            rank: h.rank,
            sessionId: h.sessionId,
            provenance: "internal",
          })),
          projectIndex: projectHits.map((h) => ({
            title: h.title,
            url: h.url,
            snippet: (h.snippet || "").slice(0, 200),
            source: h.source,
            rank: h.rank,
            provenance: "project-index",
          })),
        }, null, 2);
        return { content: [{ type: "text" as const, text: summary }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: "recall_memory error: " + (e instanceof Error ? e.message : String(e)) }] };
      }
      });
    }
  );
}
