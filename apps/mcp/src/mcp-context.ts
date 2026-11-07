// AsyncLocalStorage context for MCP request identity.
//
// #213: client attribution is read from the SDK request context, where a
// 2026-07-28 request carries `_meta["io.modelcontextprotocol/clientInfo"]`
// on every call. The initialize-time extraction in http.ts is only a
// fallback for callers that stash it: legacy 2025-11-25 requests carry no
// per-request clientInfo, and a stateless HTTP server cannot carry the
// initialize handshake across requests, so those calls record mcp_unknown.
//
// Failure modes:
// - AsyncLocalStorage unavailable (very old Node): falls back to undefined
// and the audit event records client_id = "mcp_unknown" (still safe).
// - Stash never set (stdio transport bypasses the HTTP shim): same fallback.
//
// session_id is intentionally NOT stashed here - MCP keeps session_id empty
// per (protocol carries no per-instance session identifier). Cross-call state is
// explicit instead: `ans_chat` threads a server-minted handle as an ordinary tool
// argument (#132, MCP 2026-07-28 / SEP-2567); that handle is not a transport
// session and never becomes a request identity here.
import { AsyncLocalStorage } from "node:async_hooks";
import { CLIENT_INFO_META_KEY, type ServerContext } from "@modelcontextprotocol/server";

interface McpRequestIdentity {
  clientInfoName?: string;
  // #209: request-scoped cancellation for the stateless HTTP path. The SDK's
  // handler context signal only aborts via a `notifications/cancelled` on the
  // same connection; stateless HTTP (a fresh server per POST) has no such
  // channel, so the spec's cancellation signal is the response stream closing.
  // The HTTP entry sets this when the client disconnects; the search tools
  // combine it with the SDK context signal.
  signal?: AbortSignal;
}

const storage = new AsyncLocalStorage<McpRequestIdentity>();

export function runWithMcpIdentity<T>(identity: McpRequestIdentity, fn: () => T): T {
  return storage.run(identity, fn);
}

export function currentMcpIdentity(): McpRequestIdentity | undefined {
  return storage.getStore();
}

export function currentRequestSignal(): AbortSignal | undefined {
  return storage.getStore()?.signal;
}

// A client name is untrusted wire data: only a non-empty string is forwarded.
export function readClientInfoName(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const name = (value as { name?: unknown }).name;
  return typeof name === "string" && name.length > 0 ? name : undefined;
}

// Design: per-request `_meta` clientInfo is the primary client-attribution
// source, with the initialize-time stash as a fallback — the stateless
// transport cannot guarantee a cross-request stash, so a legacy call without
// per-request identity records mcp_unknown (#213; rejected: a process-wide
// client-info global).
//
// The SDK lifts the reserved envelope keys before the handler runs, so
// `ctx.mcpReq.envelope` is where clientInfo lands; a legacy request has no
// envelope here.
export function requestClientInfoName(ctx: ServerContext | undefined): string | undefined {
  const envelope = ctx?.mcpReq.envelope as Record<string, unknown> | undefined;
  return readClientInfoName(envelope?.[CLIENT_INFO_META_KEY]);
}
