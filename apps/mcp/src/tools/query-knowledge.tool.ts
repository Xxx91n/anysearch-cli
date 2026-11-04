// query_knowledge tool: RAG adapter dispatch stub.
// #104 defined RagAdapterPort + the rag.adapter registry, but the agent-loop
// injection path (MemoryPipeline Stage-1) is where they are wired.
// input validated by AJV.

import type { McpServer } from "@modelcontextprotocol/server";
import { fromJsonSchema } from "@modelcontextprotocol/server";
import type { CompositionResult } from "@anysearch-cli/kernel";
import { KernelJsonSchemas, KernelToolDescriptions } from "@anysearch-cli/kernel";
import { observeTool } from "./observation.js";

export function registerQueryKnowledge(server: McpServer, eng: CompositionResult): void {
  server.registerTool(
    "query_knowledge",
    {
      description: KernelToolDescriptions.query_knowledge,
      inputSchema: fromJsonSchema(KernelJsonSchemas.query_knowledge),
    },
    async (_args: unknown) => {
      return observeTool(eng, "query_knowledge", async () => {
        // Design: query_knowledge reads store-scoped shared Research Memory —
        // sessions and domains are not principals, so the tool takes no sessionId or
        // domain filter. The stub remains until #155 wires it; see
        // docs/rag-adapters.md §作用域.
        const adapter = eng.config?.rag?.adapter ?? "none";
        return { content: [{ type: "text" as const, text: "query_knowledge: adapter=" + adapter + " (not yet implemented)" }] };
      });
    }
  );
}
