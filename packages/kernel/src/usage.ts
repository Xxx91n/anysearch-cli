// Token / cache / cost accounting for every model call this process makes.
//
// Shared by the agent run and the memory pipeline's own summary calls so both
// report the same way. The rule that matters: a cost figure is only
// provider-reported when the server sent it. pi-ai otherwise fills `usage.cost`
// from its own rate card and stamps `totalFromProvider: false`, which is an
// estimate; a custom endpoint declares all-zero rates, which must not read as
// "free". Both stay distinguishable from a server-sent price, and every
// dimension that never arrived is named instead of zero-filled.

import type { RunUsage } from "./runtime";

/** Where a cost figure came from. */
export type CostSource = "provider" | "estimated" | "unknown";

export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  // Provider-reported cache reads/writes. An absent figure stays 0 here, but the
  // report names it as unavailable instead of pretending the call was free.
  cacheReadTokens: number;
  cacheWriteTokens: number;
  // Whether the provider actually reported each dimension, so a reported zero
  // stays distinguishable from an absent number.
  cacheReported: boolean;
  // True only when the server sent the price. pi-ai's own rate-card figure is
  // an estimate, so it does NOT set this flag.
  costReported: boolean;
  // True when costUsd came from pi-ai's local rate card (an estimate, not a
  // provider-reported figure).
  costEstimated: boolean;
  // Assistant calls that actually returned usage.
  assistantCalls: number;
  // Latest assistant message's totalTokens (input incl. cache + output of the
  // most recent LLM call). One input to the L0 watermark's occupancy:
  // max(this, estimateTranscriptTokens(messages)) in resolveContextOccupancy.
  // Cumulative totals are ledger-only and must never feed the watermark —
  // they are monotonic, so a crossed watermark would re-fire every turn.
  lastTotalTokens: number;
}

export function emptyUsageTotals(): UsageTotals {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    costUsd: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    cacheReported: false,
    costReported: false,
    costEstimated: false,
    assistantCalls: 0,
    lastTotalTokens: 0,
  };
}

/** The provenance of this ledger's cost figure. */
export function costSourceOf(totals: UsageTotals): CostSource {
  if (totals.costReported) return "provider";
  if (totals.costEstimated) return "estimated";
  return "unknown";
}

/**
 * Fold one message_end payload into the ledger. Pure; exported for tests.
 * Non-assistant messages are ignored — message_end also fires for user prompts
 * and tool results, and only AssistantMessage carries the call's usage.
 */
export function accumulateUsage(totals: UsageTotals, message: unknown): void {
  const msg = message as {
    role?: string;
    usage?: {
      input?: number; output?: number; cacheRead?: number; cacheWrite?: number; totalTokens?: number;
      cost?: { total?: number; totalFromProvider?: boolean };
    };
  } | undefined;
  if (!msg || msg.role !== "assistant" || !msg.usage) return;
  const input = Number(msg.usage.input) || 0;
  const output = Number(msg.usage.output) || 0;
  totals.inputTokens += input;
  totals.outputTokens += output;
  totals.cacheReadTokens += Number(msg.usage.cacheRead) || 0;
  totals.cacheWriteTokens += Number(msg.usage.cacheWrite) || 0;
  totals.cacheReported = totals.cacheReported || msg.usage.cacheRead !== undefined || msg.usage.cacheWrite !== undefined;
  const cost = msg.usage.cost;
  if (cost && cost.totalFromProvider === true) {
    totals.costReported = true;
    totals.costUsd += Number(cost.total) || 0;
  } else if (cost && Number.isFinite(Number(cost.total))) {
    totals.costEstimated = true;
    totals.costUsd += Number(cost.total) || 0;
  }
  totals.assistantCalls += 1;
  // totalTokens includes cache read/write tokens when the provider reports
  // them; fall back to input+output when absent.
  const messageTotal = Number(msg.usage.totalTokens) || (input + output);
  totals.totalTokens += messageTotal;
  totals.lastTotalTokens = messageTotal;
}

/**
 * Fold the run ledger and PI's own compaction ledger into the caller-facing
 * accounting. `missing` is the honest half: a dimension nobody reported is
 * named, never rendered as free.
 */
export function toRunUsage(
  totals: UsageTotals,
  compactionCalls: number,
  compactionTokens: number,
  compactionCostUsd: number,
  compactionCostSource: CostSource = "unknown",
): RunUsage {
  const missing: string[] = [];
  if (totals.assistantCalls === 0) missing.push("assistant usage");
  if (totals.assistantCalls > 0 && !totals.cacheReported) missing.push("cache usage");
  // A locally estimated figure is not a provider report: say so, so the caller
  // never presents it as server-sent truth.
  if (!totals.costReported) missing.push(totals.costEstimated ? "cost (estimated)" : "cost");
  if (compactionCalls > 0 && compactionTokens === 0) missing.push("compaction usage");
  if (compactionCalls > 0 && compactionCostSource === "unknown") missing.push("compaction cost");
  return {
    inputTokens: totals.inputTokens,
    outputTokens: totals.outputTokens,
    cacheReadTokens: totals.cacheReadTokens,
    cacheWriteTokens: totals.cacheWriteTokens,
    totalTokens: totals.totalTokens,
    costUsd: totals.costUsd,
    costSource: costSourceOf(totals),
    assistantCalls: totals.assistantCalls,
    compactionCalls,
    compactionTokens,
    compactionCostUsd,
    compactionCostSource,
    missing,
  };
}

/** Summary-call report: the same ledger, labelled for the memory pipeline. */
export interface SummaryUsage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  costUsd: number;
  costSource: CostSource;
  missing: string[];
}

export function toSummaryUsage(totals: UsageTotals): SummaryUsage {
  const missing: string[] = [];
  if (totals.assistantCalls === 0) missing.push("summary usage");
  if (totals.assistantCalls > 0 && !totals.cacheReported) missing.push("summary cache usage");
  if (!totals.costReported) missing.push(totals.costEstimated ? "summary cost (estimated)" : "summary cost");
  return {
    calls: totals.assistantCalls,
    inputTokens: totals.inputTokens,
    outputTokens: totals.outputTokens,
    cacheReadTokens: totals.cacheReadTokens,
    cacheWriteTokens: totals.cacheWriteTokens,
    totalTokens: totals.totalTokens,
    costUsd: totals.costUsd,
    costSource: costSourceOf(totals),
    missing,
  };
}

/** A zeroed run report for a run that never produced accounting. */
export function emptyRunUsage(missing: string[]): RunUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    costUsd: 0,
    costSource: "unknown",
    assistantCalls: 0,
    compactionCalls: 0,
    compactionTokens: 0,
    compactionCostUsd: 0,
    compactionCostSource: "unknown",
    missing,
  };
}
