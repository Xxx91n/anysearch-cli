// #209: cancellation signal composition for the MCP tool handlers.
//
// stdio delivers cancellation through the SDK handler context signal
// (`notifications/cancelled` on the same connection). Stateless HTTP has no
// same-connection notification channel, so the HTTP entry stashes the
// request-scoped signal in AsyncLocalStorage (mcp-context.ts) and the handlers
// read it there. Either source is a caller signal; the engine treats them the
// same. Absent sources collapse to undefined so non-cancellable callers keep
// the engine's original grace-window-only behavior.
import type { ServerContext } from "@modelcontextprotocol/server";
import { currentRequestSignal } from "../mcp-context.js";

export function combineSignals(...signals: Array<AbortSignal | undefined>): AbortSignal | undefined {
  const present = signals.filter((s): s is AbortSignal => s !== undefined);
  if (present.length === 0) return undefined;
  if (present.length === 1) return present[0];
  return AbortSignal.any(present);
}

/**
 * The one cancellation seam every tool handler uses.
 *
 * Design: combine the SDK context signal (stdio same-connection cancellation)
 * with the stateless-HTTP request signal — one composition point keeps the
 * three tool handlers on the same precedence and lets a future caller signal
 * source be added here instead of per handler.
 */
export function requestSignal(ctx?: ServerContext): AbortSignal | undefined {
  return combineSignals(ctx?.mcpReq.signal, currentRequestSignal());
}
