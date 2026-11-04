// AsyncLocalStorage context for MCP request identity.
//
// The MCP transport delivers a fresh clientInfo only on the initialize
// handshake, then subsequent tool calls reference the same connection.
// AsyncLocalStorage lets the HTTP transport (apps/mcp/src/index.ts) stash
// the clientInfo.name it observed on initialize, while each tool's
// observeTool reads the current value without changing handler signatures.
//
// Failure modes:
// - AsyncLocalStorage unavailable (very old Node): falls back to undefined
// and the audit event records client_id = "mcp_unknown" (still safe).
// - Stash never set (stdin transport bypasses the HTTP shim): same fallback.
//
// session_id is intentionally NOT stashed here - MCP keeps session_id empty
// per (protocol carries no per-instance session identifier). Cross-call state is
// explicit instead: `ans_chat` threads a server-minted handle as an ordinary tool
// argument (#132, MCP 2026-07-28 / SEP-2567); that handle is not a transport
// session and never becomes a request identity here.
import { AsyncLocalStorage } from "node:async_hooks";

interface McpRequestIdentity {
  clientInfoName?: string;
}

const storage = new AsyncLocalStorage<McpRequestIdentity>();

export function runWithMcpIdentity<T>(identity: McpRequestIdentity, fn: () => T): T {
  return storage.run(identity, fn);
}

export function currentMcpIdentity(): McpRequestIdentity | undefined {
  return storage.getStore();
}