// AgentRuntime: thin adapter over pi-agent-core.
// Split 5 from the atomcode kernel-split research.
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
  | { type: "done"; summary: string; recovery?: string; usage?: RunUsage; context?: RunContextUsage }
  | { type: "error"; message: string };

/** One run's complete accounting; `missing` names the dimensions the provider did not report. */
export interface RunUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  costUsd: number;
  /**
   * Where costUsd came from: the provider's own figure, pi-ai's local rate card
   * (an estimate), or nothing at all. An estimate must never be presented as a
   * server-reported price (D4).
   */
  costSource: "provider" | "estimated" | "unknown";
  /** Assistant calls that actually returned usage. 0 means no call landed. */
  assistantCalls: number;
  /** PI context-compaction calls, kept apart from the main run. */
  compactionCalls: number;
  compactionTokens: number;
  compactionCostUsd: number;
  /** Dimensions that stay unknown. Empty only when every dimension was reported. */
  missing: string[];
}

/** PI's own view of the context window, read back from the live session. */
export interface RunContextUsage {
  tokens: number | null;
  window: number;
  percent: number | null;
}

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
  // decision 4C: toolWhitelist is now at domain.hooks.toolWhitelist (5-layer port).
  if (domain.hooks.toolWhitelist.length === 0) return [];
  const allowed = new Set(domain.hooks.toolWhitelist);
  return tools.filter((t) => allowed.has(t.name));
}
