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
import { buildServer, PKG_VERSION } from "./server.js";
// stash clientInfo from initialize requests into AsyncLocalStorage
// so observeTool can map it to a stable client_id via Railway PR #885.
import { runWithMcpIdentity } from "./mcp-context.js";

// minimal shape of an MCP request body — only clientInfo.name is read here.
interface McpRequestBody {
  method?: string;
  params?: { clientInfo?: { name?: string } };
}

// Design: per-request stateless McpServer + transport over ONE shared startup
// engine — the protocol requires a fresh server per connection, but the
// better-sqlite3 handles inside the engine open once per process (#112).
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
    // stateless factory pattern: a fresh server per request, sharing the
    // startup engine (#112 — no createEngine per request).
    const server = buildServer(engine);
    try {
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
      const body = (req.body || {}) as McpRequestBody;
      const clientInfoName = body.params?.clientInfo?.name;
      await runWithMcpIdentity({ clientInfoName }, () => t.handleRequest(req, res, req.body));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      res.status(500).json({ error: { code: -32603, message: "Internal error: " + msg } });
    } finally {
      // release the per-request server's listeners on EVERY path; the shared
      // engine stays open for the next request (#112 — no per-request growth).
      await server.close();
    }
  });

  // Health check endpoint
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", server: "anysearch-mcp", version: PKG_VERSION });
  });

  return app;
}
