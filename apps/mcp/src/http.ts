// HTTP transport wiring for the anysearch MCP server.
//
// #112: the engine is a per-CONNECTION resource, not a per-request one. The
// entry builds it once at startup (createDefaultEngine) and hands it here; each
// request still gets its own McpServer + stateless Streamable HTTP transport
// (the protocol requires a fresh server per connection), but they all share the
// one engine, so the two better-sqlite3 handles inside a CompositionResult are
// opened once instead of twice per request.
// #210: the same holds for process-level tool state — the entry creates it once
// and every per-request buildServer() receives it, so the ans_chat LLM client
// cache survives across requests instead of rebuilding per request.
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import type { CompositionResult } from "@anysearch-cli/kernel";
import express, { type Express } from "express";
import { buildServer, PKG_VERSION } from "./server.js";
import { createMcpToolState, type McpToolState } from "./tool-state.js";
// stash clientInfo from initialize requests into AsyncLocalStorage
// so observeTool can map it to a stable client_id via Railway PR #885.
import { runWithMcpIdentity } from "./mcp-context.js";

// minimal shape of an MCP request body — only clientInfo.name is read here.
interface McpRequestBody {
  method?: string;
  params?: { clientInfo?: { name?: string } };
}

/**
 * Reads clientInfo.name out of a JSON-RPC body, if it is there.
 *
 * The MCP spec sends clientInfo only on initialize, so every other call
 * legitimately yields undefined and the observer keeps its anonymous id. The
 * body is untrusted wire data: anything that is not a non-empty string is
 * treated as absent, so a malformed payload cannot smuggle a non-string into
 * the identity store.
 *
 * @param body Parsed JSON-RPC request body.
 * @returns The declared client name, or undefined when absent/malformed.
 */
export function extractClientInfoName(body: unknown): string | undefined {
  const name = ((body || {}) as McpRequestBody).params?.clientInfo?.name;
  return typeof name === "string" && name.length > 0 ? name : undefined;
}

// Design: per-request stateless McpServer + transport over ONE shared startup
// engine — the protocol requires a fresh server per connection, but the
// better-sqlite3 handles inside the engine open once per process (#112).
// createHttpApp: build the express app around ONE engine. The engine is captured
// in the closure and reused by every request; nothing here constructs one.
// The tool state is likewise captured once (#210) — one app means one process
// scope for the shared LLM client cache.
export function createHttpApp(
  engine: CompositionResult,
  state: McpToolState = createMcpToolState(),
): Express {
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
    // startup engine and process-level tool state (#112, #210).
    const server = buildServer(engine, state);
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
      const clientInfoName = extractClientInfoName(req.body);
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
