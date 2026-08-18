// AgentRuntime: thin adapter over pi-agent-core.
// Seam 5 from atomcode-kernel-split-architecture research.
// Candidate 4: deepens the agent runtime by hiding pi-agent-core behind
// a domain-aware interface. Deletion test: deleting this would scatter
// domain-aware tool filtering across every command.

import type { RetrieverPort, SessionStorePort, ToolPort, DomainConfigPort } from "./ports";

export type AgentEvent =
  | { type: "text"; content: string }
  | { type: "tool_call"; name: string; args: unknown }
  | { type: "tool_result"; name: string; result: unknown }
  | { type: "search"; query: string }
  | { type: "search_result"; envelope: unknown }
  | { type: "done"; summary: string }
  | { type: "error"; message: string };

export interface AgentRuntime {
  // Run the agent loop. Yields events as they occur.
  run(
    input: string,
    opts: {
      retriever: RetrieverPort;
      store: SessionStorePort;
      domain: DomainConfigPort;
      tools?: ToolPort[];
    },
  ): AsyncIterable<AgentEvent>;
}

// Filter tools by domain whitelist.
export function filterTools(
  tools: ToolPort[],
  domain: DomainConfigPort,
): ToolPort[] {
  // ADR-0006 decision 4C: toolWhitelist is now at domain.hooks.toolWhitelist (5-layer port).
  if (domain.hooks.toolWhitelist.length === 0) return [];
  const allowed = new Set(domain.hooks.toolWhitelist);
  return tools.filter((t) => allowed.has(t.name));
}
