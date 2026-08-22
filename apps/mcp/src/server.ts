// MCP Server factory: buildServer() registers 5 tools via Per-tool Barrel.
// ADR-0008 D1: context-management mental model (context-mode style).
// ADR-0008 D3: 5 MCP tools — search_web / research_web / recall_memory / query_knowledge / ans_chat.
// ADR-0008 D4: factory pattern, era-agnostic, entry selects transport.
// ADR-0008 D7: createEngine() from @anysearch/kernel.
// ADR-0019 D1: inputSchema wrapped via fromJsonSchema(KernelToolSchemas[name]) — SDK v2 path.
// ADR-0019 D2: tools live in apps/mcp/src/tools/*, aggregated by tools/index.ts.

import { McpServer } from "@modelcontextprotocol/server";
import { createEngine, type CompositionResult } from "@anysearch/kernel";
import { TOOL_REGISTRY } from "./tools/index.js";

// buildServer: factory function. Each connection gets a fresh server instance.
// ADR-0008 D4: factory pattern, era-agnostic, entry selects transport.
export function buildServer(engine?: CompositionResult): McpServer {
  const eng = engine ?? createEngine();
  const server = new McpServer(
    { name: "anysearch", version: "0.0.0" },
    { capabilities: { tools: {} } }
  );

  for (const tool of TOOL_REGISTRY) {
    tool.register(server, eng);
  }

  return server;
}
