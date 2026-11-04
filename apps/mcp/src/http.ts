// HTTP transport wiring for the anysearch MCP server.
//
// #112: the engine is a per-CONNECTION resource, not a per-request one. The
// entry builds it once at startup (createDefaultEngine) and hands it here; each
// request still gets its own McpServer + stateless Streamable HTTP transport
// (the protocol requires a fresh server per connection), but they all share the
// one engine, so the two better-sqlite3 handles inside a CompositionResult are
// opened once instead of twice per request.
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import type { CompositionResult } from "@anysearch-cli/kernel";
import express, { type Express } from "express";
import { buildServer } from "./server.js";
// stash clientInfo from initialize requests into AsyncLocalStorage
// so observeTool can map it to a stable client_id via Railway PR #885.
import { runWithMcpIdentity } from "./mcp-context.js";

// ponytail: tsup define substituites __PACKAGE_VERSION__ at build time (see
// tsup.config.ts). Dev-mode tsx fallthrough reads "0.0.0" — fine for doctor.
declare const __PACKAGE_VERSION__: string | undefined;
const PKG_VERSION: string =
  typeof __PACKAGE_VERSION__ !== "undefined" && __PACKAGE_VERSION__
    ? __PACKAGE_VERSION__
    : "0.0.0";

// createHttpApp: build the express app around ONE engine. The engine is captured
// in the closure and reused by every request; nothing here constructs one.
export function createHttpApp(engine: CompositionResult): Express {
  const app = express();
  app.use(express.json());

  // SECURITY: optional bearer token auth via ANS_MCP_KEY env var (CWE-306).
  const mcpKey = process.env.ANS_MCP_KEY;
  if (mcpKey) {
    app.use((req, _res, next) => {
      const auth = req.headers.authorization || "";
      if (auth !== "Bearer " + mcpKey) {
        _res.status(401).json({ error: { code: -32001, message: "Unauthorized" } });
        return;
      }
      next();
    });
  }

  app.post("/mcp", async (req, res) => {
    try {
      // stateless factory pattern: a fresh server per request, sharing the
      // startup engine (#112 — no createEngine per request).
      const server = buildServer(engine);
      // stateless mode -- sessionIdGenerator: undefined, enableJsonResponse, keepAliveMs: 0
      const t = new NodeStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
        keepAliveMs: 0,
      });
      await server.connect(t);
      // best-effort clientInfo extraction. The MCP spec
      // sends clientInfo only on initialize; we still wrap every call in
      // AsyncLocalStorage so observeTool can pick it up consistently.
      const body = (req.body || {}) as { method?: string; params?: { clientInfo?: { name?: string } } };
      const clientInfoName = body.params?.clientInfo?.name;
      await runWithMcpIdentity({ clientInfoName }, () => t.handleRequest(req, res, req.body));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      res.status(500).json({ error: { code: -32603, message: "Internal error: " + msg } });
    }
  });

  // Health check endpoint
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", server: "anysearch-mcp", version: PKG_VERSION });
  });

  return app;
}
