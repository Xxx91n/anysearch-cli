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
    // #209: stateless Streamable HTTP cancellation is signalled by closing the
    // response stream (the MCP spec's stateless cancellation mechanism). A fresh
    // server per POST has no same-connection notifications/cancelled channel,
    // so the request-scoped abort controller is the only way to stop a handler.
    const requestAbort = new AbortController();
    const abortIfDisconnected = () => {
      if (!res.writableFinished) requestAbort.abort("client disconnected");
    };
    req.on("aborted", abortIfDisconnected);
    res.on("close", abortIfDisconnected);
    // A disconnect can land between app.post() and the listener registration;
    // check the already-destroyed response so that request never starts provider work.
    if (res.destroyed) requestAbort.abort("client disconnected");
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
      await runWithMcpIdentity({ clientInfoName, signal: requestAbort.signal }, () => t.handleRequest(req, res, req.body));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // A disconnected client cannot receive the 500; write it only when the
      // response is still open (the request-abort path lands here for encoding/
      // send faults after cancellation too).
      if (!res.headersSent && !res.writableEnded) {
        res.status(500).json({ error: { code: -32603, message: "Internal error: " + msg } });
      }
    } finally {
      req.off("aborted", abortIfDisconnected);
      res.off("close", abortIfDisconnected);
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
