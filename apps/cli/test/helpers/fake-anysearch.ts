// In-process fake AnySearch MCP endpoint for the CLI tests: handshake plus one
// tools/call, no network. The CLI is spawned asynchronously here, so this
// process keeps serving while the child runs.
//
// install-smoke keeps its own standalone stub (scripts/fake-anysearch-mcp.mjs)
// on purpose: it drives the CLI with spawnSync, which blocks the event loop an
// in-process server would need to accept requests. Both sides assert the same
// gate and outcome fields, which is what keeps the two from drifting.

import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

export async function startFakeAnySearch(
  markdown: string,
): Promise<{ endpoint: string; close: () => Promise<void> }> {
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    let parsed: { id?: number; method?: string } = {};
    try {
      parsed = JSON.parse(body);
    } catch {
      // notification framing, or a body this stub does not model
    }
    const reply = (result: unknown) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: parsed.id, result }));
    };
    if (parsed.method === "initialize") {
      return reply({ protocolVersion: "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "stub", version: "1" } });
    }
    if (parsed.method === "notifications/initialized") {
      res.writeHead(202);
      return res.end();
    }
    if (parsed.method === "tools/call") return reply({ content: [{ type: "text", text: markdown }] });
    return reply({});
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return {
    endpoint: "http://127.0.0.1:" + port + "/mcp",
    close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }),
  };
}
