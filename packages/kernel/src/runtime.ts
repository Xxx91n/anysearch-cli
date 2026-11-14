// AgentRuntime: thin adapter over pi-agent-core.
// Split 5 from the atomcode kernel-split research.
// Candidate 4: deepens the agent runtime by hiding pi-agent-core behind
// a domain-aware interface. Deletion test: deleting this would scatter
// domain-aware tool filtering across every command.

import type { RetrieverPort, SessionStorePort, ToolPort, DomainConfigPort } from "./ports";
import type { CostSource } from "./usage";

export type AgentEvent =
  | { type: "text"; content: string }
  | { type: "tool_call"; name: string; args: unknown }
  | { type: "tool_result"; name: string; result: unknown }
  | { type: "search"; query: string }
  | { type: "search_result"; envelope: unknown }
  | {
      type: "done";
      summary: string;
      recovery?: string;
      usage?: RunUsage;
      context?: RunContextUsage;
    }
  | { type: "error"; message: string };

/**
 * #264 (D9): one rebuild attempt as the caller sees it.
 *
 * Deliberately NOT part of the `done` event: rebuilds are background work that
 * `flushMemory()` drains, and the `done` event is emitted before that drain. A
 * caller reports these after flushing, so the answer never says "nothing was
 * suspended" about an attempt that had not finished yet.
 */
export interface SummaryRebuildReport {
  anchorId: number;
  outcome: SummaryRebuildOutcome;
  reasons: string[];
  newAnchorId: number | null;
  cleared: boolean;
  /** Usage of the generation call, when one ran. Absent when no call was made. */
  usage?: unknown;
}

/**
 * How one rebuild attempt ended (the store and the kernel share this list).
 *
 * `stored-not-current` is distinct on purpose: the text WAS written, but the
 * suspension stayed because a source moved on (or there was no open suspension
 * to clear). Calling that "write-failed" would report a stored anchor as a write
 * error, and calling it "rebuilt" would claim a recovery that did not happen.
 */
export type SummaryRebuildOutcome =
  | "rebuilt"
  | "incomplete"
  | "no-model"
  | "generation-failed"
  | "write-failed"
  | "stored-not-current"
  | "rejected-write";

/** One run's complete accounting; `missing` names the dimensions the provider did not report. */
export interface RunUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** Whole-run total: main calls plus PI's compaction. Same scope as costUsd. */
  totalTokens: number;
  /** Whole-run price: main calls plus PI's compaction. Same scope as totalTokens. */
  costUsd: number;
  /**
   * Where costUsd came from. `provider` means the server sent the price;
   * `estimated` means the local rate card computed it; `unknown` means there is
   * no figure; `mixed` means part of the total is provider-sent and part
   * estimated (the run and PI's compaction carried it differently). An estimate
   * must never be presented as a server-reported price.
   */
  costSource: CostSource;
  /** Assistant calls that actually returned usage. 0 means no call landed. */
  assistantCalls: number;
  /** PI context-compaction calls, kept apart from the main run. */
  compactionCalls: number;
  compactionTokens: number;
  compactionCostUsd: number;
  /** Where the compaction part of costUsd came from. */
  compactionCostSource: CostSource;
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
