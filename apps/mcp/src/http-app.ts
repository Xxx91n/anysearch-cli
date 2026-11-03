// Stateless Streamable HTTP surface for the MCP server.
//
// Design(#40, decision #91): composition reuse is per-CONNECTION, not global and
// not per-request. The entry point builds the engine once at startup and injects
// it here; every request still gets a fresh McpServer + transport (cheap,
// protocol-level) so the 2026-07-28 stateless contract is preserved.
//
// Nothing request-scoped lands on the shared engine: identity rides
// AsyncLocalStorage (mcp-context.ts) and session_id stays empty on the MCP path
// (tools/observation.ts); the composition's ports take their inputs per call
// (retriever.query, store args). The ans-chat LLM session cache is module-level,
// keyed by provider+model+baseUrl+api, so sharing the engine does not change it.
import express, { type Express } from "express";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import type { McpServer } from "@modelcontextprotocol/server";
import type { CompositionResult } from "@anysearch-cli/kernel";
import { buildServer } from "./server.js";
import { runWithMcpIdentity } from "./mcp-context.js";

export interface HttpAppOptions {
  /** Connection-scoped composition, built once by the entry point. */
  engine: CompositionResult;
  /** Server version reported by /health. */
  version: string;
  /** Optional bearer token (ANS_MCP_KEY); omitted = no auth gate. */
  mcpKey?: string;
  /** Injectable per-request server factory (tests count reuse); defaults to buildServer. */
  serverFactory?: (engine: CompositionResult) => McpServer;
}

export function createHttpApp(options: HttpAppOptions): Express {
  const { engine, version, mcpKey, serverFactory = buildServer } = options;
  const app = express();
  app.use(express.json());

  // SECURITY: optional bearer token auth via ANS_MCP_KEY env var (CWE-306).
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
      // cheap per-request half: fresh server + transport over the shared engine
      const server = serverFactory(engine);
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
    res.json({ status: "ok", server: "anysearch-mcp", version });
  });

  return app;
}
