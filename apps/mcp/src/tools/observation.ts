import type { CompositionResult } from "@anysearch/kernel";
import type { ObservationAttributes } from "@anysearch/store";
import { mapMcpClientId } from "@anysearch/store";
import { currentMcpIdentity } from "../mcp-context.js";

// ADR-0056 D-008/D-009: client_id best-effort from _meta clientInfo via Railway
// mapping; session_id always empty for MCP (stateless protocol). Trace_id is
// generated per recordOperation (entry-process per MCP tool call).
export function observeTool<T>(
  eng: CompositionResult,
  toolName: string,
  callback: () => T | Promise<T>,
  attributes?: ObservationAttributes,
): Promise<T> {
  const identity = currentMcpIdentity();
  const clientId = mapMcpClientId(identity?.clientInfoName);
  return eng.observation.recordOperation(
    {
      kind: "mcp",
      operation: toolName,
      attributes: { "anysearch.tool": toolName, ...attributes },
      clientId,
      // sessionId deliberately omitted (stays empty -> NULL column on MCP path).
    },
    callback,
  );
}
