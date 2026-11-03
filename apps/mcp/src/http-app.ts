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
import express, { type Express, type RequestHandler } from "express";
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

/**
 * Best-effort extraction of the MCP client name from a JSON-RPC payload.
 *
 * The MCP spec sends `clientInfo` only on `initialize`; no other method carries
 * the identity. Stateless HTTP therefore keeps no session to inherit from -- this
 * helper only parses what the current payload happens to carry, and the
 * observation layer falls back to its default MCP client id when it is absent.
 *
 * @param body Parsed JSON-RPC request body (any shape, may be null/undefined).
 * @returns The reported client name, or undefined when absent or not a string.
 */
export function extractClientInfoName(body: unknown): string | undefined {
  const params = (body as { params?: { clientInfo?: { name?: unknown } } } | null | undefined)
    ?.params;
  const name = params?.clientInfo?.name;
  return typeof name === "string" && name.length > 0 ? name : undefined;
}

/**
 * Builds the optional bearer-token gate backed by ANS_MCP_KEY (CWE-306).
 *
 * Fails closed: a request whose Authorization header is not exactly
 * `Bearer <key>` is rejected before it can reach the MCP handler, with the
 * JSON-RPC style error code -32001.
 *
 * @param mcpKey Expected bearer token; the caller only installs this when set.
 * @returns Express middleware enforcing the token.
 */
export function createBearerAuth(mcpKey: string): RequestHandler {
  return (req, res, next) => {
    const auth = req.headers.authorization || "";
    if (auth !== "Bearer " + mcpKey) {
      res.status(401).json({ error: { code: -32001, message: "Unauthorized" } });
      return;
    }
    next();
  };
}

/**
 * Builds the stateless POST /mcp handler.
 *
 * Per request it creates a fresh protocol-level server + transport over the
 * shared engine (the cheap half), then runs the request inside the
 * AsyncLocalStorage identity scope so observation can attribute it. Unexpected
 * failures are answered as JSON-RPC -32603 rather than crashing the app.
 *
 * @param engine Connection-scoped composition shared by every request.
 * @param serverFactory Per-request server factory (entry passes buildServer).
 * @returns Express handler serving the single MCP endpoint.
 */
export function createMcpRequestHandler(
  engine: CompositionResult,
  serverFactory: (engine: CompositionResult) => McpServer,
): RequestHandler {
  return async (req, res) => {
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
      // best-effort clientInfo extraction. The MCP spec sends clientInfo only
      // on initialize; we still wrap every call in AsyncLocalStorage so
      // observeTool picks up whatever the current payload carries, without
      // inventing state across stateless requests.
      const clientInfoName = extractClientInfoName(req.body);
      await runWithMcpIdentity({ clientInfoName }, () => t.handleRequest(req, res, req.body));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      res.status(500).json({ error: { code: -32603, message: "Internal error: " + msg } });
    }
  };
}

/**
 * Builds the /health liveness probe used by the deploy gate.
 *
 * It reports the version baked into the running process, so a rollback can be
 * verified from outside without inspecting the process image.
 *
 * @param version Version string to echo back.
 * @returns Express handler answering GET /health.
 */
export function createHealthHandler(version: string): RequestHandler {
  return (_req, res) => {
    res.json({ status: "ok", server: "anysearch-mcp", version });
  };
}

/**
 * Builds the stateless Streamable HTTP Express app over a connection-scoped
 * composition.
 *
 * The injected engine is shared across all requests; each request still gets a
 * fresh McpServer + transport from `serverFactory`, so the stateless contract
 * holds while the expensive composition is built only once at startup.
 *
 * @param options Connection-scoped engine plus transport/server knobs.
 * @returns A ready-to-listen Express app exposing POST /mcp and GET /health.
 */
export function createHttpApp(options: HttpAppOptions): Express {
  const { engine, version, mcpKey, serverFactory = buildServer } = options;
  const app = express();
  app.use(express.json());

  // SECURITY: optional bearer token auth via ANS_MCP_KEY env var (CWE-306).
  if (mcpKey) {
    app.use(createBearerAuth(mcpKey));
  }

  app.post("/mcp", createMcpRequestHandler(engine, serverFactory));

  app.get("/health", createHealthHandler(version));

  return app;
}
