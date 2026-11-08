// query_knowledge tool: RAG adapter dispatch — real implementation (#155).
// Reads the same store-scoped research archive range as recall_memory
// (SessionStore.searchMemory), dispatched via RagAdapterRegistry.
// Non-query adapters (none, note) return an explicit empty result;
// only "fts" performs retrieval. Unknown adapter ids fail-open to none
// with a deduped stderr warning (handled by RagAdapterRegistry.resolve).
// input validated by AJV.
import type { McpServer, ServerContext } from "@modelcontextprotocol/server";
import { fromJsonSchema } from "@modelcontextprotocol/server";
import type { CompositionResult } from "@anysearch-cli/kernel";
import {
  KernelJsonSchemas,
  KernelToolDescriptions,
  RagAdapterRegistry,
  RAG_ADAPTER_FTS,
  RAG_DEFAULT_LIMIT,
} from "@anysearch-cli/kernel";
import { observeTool } from "./observation.js";

export function registerQueryKnowledge(server: McpServer, eng: CompositionResult): void {
  // Per-connection registry, same pattern as MemoryPipeline.
  const rag = new RagAdapterRegistry({ store: eng.store });

  server.registerTool(
    "query_knowledge",
    {
      description: KernelToolDescriptions.query_knowledge,
      inputSchema: fromJsonSchema(KernelJsonSchemas.query_knowledge),
    },
    async (args: unknown, ctx?: ServerContext) => {
      return observeTool(eng, "query_knowledge", ctx, async () => {
        const { query } = args as { query: string };
        const domain = eng.config;

        if (!domain) {
          return { content: [{ type: "text" as const, text: "无可查询知识适配器（adapter=none）" }] };
        }

        // Resolve adapter (triggers unknown-id warning + dedup via registry).
        const adapter = rag.resolve(domain);

        // Non-query adapters (none, note) and unknown ids (fail-open to null):
        // return explicit empty result, do not return note text, do not throw.
        if (!adapter || adapter.id !== RAG_ADAPTER_FTS) {
          const rawAdapter = domain.rag?.adapter ?? "none";
          return { content: [{ type: "text" as const, text: "无可查询知识适配器（adapter=" + rawAdapter + "）" }] };
        }

        // fts: retrieve with provenance, fail-open on errors (resolveInjection
        // catches retrieve() faults and warns via stderr).
        const result = await rag.resolveInjection(domain, query, RAG_DEFAULT_LIMIT);

        if (result) {
          return { content: [{ type: "text" as const, text: result.block }] };
        }

        // No hits or retrieval error (already warned via resolveInjection).
        return { content: [{ type: "text" as const, text: "query_knowledge: no results found (adapter=fts)" }] };
      });
    }
  );
}
