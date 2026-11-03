// query_knowledge tool: RAG adapter dispatch stub.
// #104 defined RagAdapterPort + the rag.adapter registry, but the agent-loop
// injection path (MemoryPipeline Stage-1) is where they are wired. This tool
// still answers with the adapter name: dispatching a knowledge query needs an
// explicit memory-scope decision (which session/store a domain-wide knowledge
// query reads), tracked as its own ticket; see docs/limitations.md.
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
        // ponytail: stub until the knowledge-query memory scope is decided.
        const adapter = eng.config?.rag?.adapter ?? "none";
        return { content: [{ type: "text" as const, text: "query_knowledge: adapter=" + adapter + " (not yet implemented)" }] };
      });
    }
  );
}
