// Stand-in AnySearch MCP endpoint for install-smoke's refusal leg.
//
// Its own process on purpose: install-smoke drives the installed CLI with
// spawnSync, which blocks the parent's event loop, so an in-process server
// would never accept the request (#474 measured a 6s timeout and zero requests
// that way; a separate process answers in under a second).
//
// Usage: start it, read the single `PORT=<n>` line it prints, point
// ANYSEARCH_ENDPOINT at http://127.0.0.1:<n>/mcp, then kill it.
//
// It answers the handshake and one `tools/call` with two out-of-domain URLs, so
// the CLI's allowlist gate throws both away and the run is a refusal. Every
// request gets a reply: the engine's 4s request-level deadline would turn a
// silent endpoint into a cancelled-arm run, which is a different leg than the
// one this stub exists to drive.

import { createServer } from "node:http";

const RESULTS = [
  "## Search Results (2 results, 12ms)",
  "",
  "### 1. Out of domain one",
  "- **URL**: https://outside.example/one",
  "- first out-of-domain arrival",
  "",
  "### 2. Out of domain two",
  "- **URL**: https://outside.example/two",
  "- second out-of-domain arrival",
  "",
].join("\n");

const server = createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  let parsed = {};
  try {
    parsed = JSON.parse(body);
  } catch {
    // notification framing, or a body this stub does not model
  }
  const reply = (result) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", id: parsed.id, result }));
  };
  if (parsed.method === "initialize") {
    return reply({
      protocolVersion: "2025-11-25",
      capabilities: { tools: {} },
      serverInfo: { name: "install-smoke-stub", version: "1" },
    });
  }
  if (parsed.method === "notifications/initialized") {
    res.writeHead(202);
    return res.end();
  }
  if (parsed.method === "tools/call") {
    return reply({ content: [{ type: "text", text: RESULTS }] });
  }
  return reply({});
});

server.listen(0, "127.0.0.1", () => {
  console.log("PORT=" + server.address().port);
});
