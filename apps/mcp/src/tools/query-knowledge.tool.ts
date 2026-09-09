// query_knowledge tool: RAG adapter dispatch stub.
// ADR-0006 MVP deferral: RAG adapter types not yet defined; returns adapter name only.
// ADR-0019 D3: input validated by AJV.

import type { McpServer } from "@modelcontextprotocol/server";
import { fromJsonSchema } from "@modelcontextprotocol/server";
import type { CompositionResult } from "@anysearch/kernel";
import { KernelJsonSchemas } from "@anysearch/kernel";
import { observeTool } from "./observation.js";

export function registerQueryKnowledge(server: McpServer, eng: CompositionResult): void {
  server.registerTool(
    "query_knowledge",
    {
      description: "Query domain-specific knowledge base via RAG adapter. Dispatches to configured rag.adapter in domain config.",
      inputSchema: fromJsonSchema(KernelJsonSchemas.query_knowledge),
    },
    async (_args: unknown) => {
      return observeTool(eng, "query_knowledge", async () => {
        // ponytail: stub until RAG adapter types are defined.
        const adapter = eng.config?.rag?.adapter ?? "none";
        return { content: [{ type: "text" as const, text: "query_knowledge: adapter=" + adapter + " (not yet implemented)" }] };
      });
    }
  );
}
