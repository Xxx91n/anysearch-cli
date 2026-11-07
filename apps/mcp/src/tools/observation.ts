import type { ServerContext } from "@modelcontextprotocol/server";
import type { CompositionResult } from "@anysearch-cli/kernel";
import type { ObservationAttributes } from "@anysearch-cli/store";
import { mapMcpClientId } from "@anysearch-cli/store";
import { currentMcpIdentity, requestClientInfoName } from "../mcp-context.js";

// Design: per-request `_meta` clientInfo wins over the initialize fallback,
// and absence of both records mcp_unknown — a legacy stateless call has no
// per-request attribution (#213). session_id always empty for MCP (stateless
// protocol). Trace_id is generated per recordOperation (entry-process per MCP
// tool call).
export function observeTool<T>(
  eng: CompositionResult,
  toolName: string,
  ctx: ServerContext | undefined,
  // the callback receives the recordOperation span so tools can
  // hand it to retriever.search() — that is how retrieval.domain_filter.* audit
  // events and the anysearch.outcome dimension land inside the MCP trace.
  callback: (span: import("@anysearch-cli/kernel").RetrievalObservationSink) => T | Promise<T>,
  attributes?: ObservationAttributes,
): Promise<T> {
  const perRequestName = requestClientInfoName(ctx);
  const fallbackIdentity = currentMcpIdentity();
  const clientId = mapMcpClientId(perRequestName ?? fallbackIdentity?.clientInfoName);
  return eng.observation.recordOperation(
    {
      kind: "mcp",
      operation: toolName,
      attributes: { "anysearch.tool": toolName, ...attributes },
      clientId,
      // sessionId deliberately omitted (stays empty -> NULL column on MCP path).
    },
    (span) => callback(span),
  );
}
