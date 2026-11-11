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

/** Where a cost figure came from. `mixed` spans a provider figure and an estimate. */
export type CostSource = "provider" | "estimated" | "unknown" | "mixed";

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
 *
 * Honesty limit worth stating: pi-ai's per-provider parsers always materialise
 * `cacheRead`/`cacheWrite` as numbers (defaulting to 0), so a provider that
 * never sends cache figures is indistinguishable from one that reports zero
 * hits. We therefore only claim cache usage was reported when a non-zero
 * figure actually arrived; a run with zero cache tokens is named as unknown
 * instead of being presented as "reported zero".
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
  const cacheRead = Number(msg.usage.cacheRead) || 0;
  const cacheWrite = Number(msg.usage.cacheWrite) || 0;
  totals.inputTokens += input;
  totals.outputTokens += output;
  totals.cacheReadTokens += cacheRead;
  totals.cacheWriteTokens += cacheWrite;
  if (cacheRead > 0 || cacheWrite > 0) totals.cacheReported = true;
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
 *
 * Cost provenance across the two ledgers (D4): when both halves reported
 * prices, or both left them to the local rate card, one label covers the total.
 * A mix is labelled `mixed` rather than picking one side, because calling a
 * partly-estimated total "provider" would misreport part of it as server-sent.
 */
export function toRunUsage(
  totals: UsageTotals,
  compaction: UsageTotals,
): RunUsage {
  const missing = missingDimensions(totals, "assistant usage", "");
  if (compaction.assistantCalls > 0) {
    missing.push(...missingDimensions(compaction, "compaction usage", "compaction"));
  }
  const runSource = costSourceOf(totals);
  const compactionSource = costSourceOf(compaction);
  const hasCost = totals.assistantCalls > 0 || compaction.assistantCalls > 0;
  const costSource = combineCostSources(runSource, compactionSource, hasCost);
  const costUsd = totals.costUsd + compaction.costUsd;
  return {
    inputTokens: totals.inputTokens,
    outputTokens: totals.outputTokens,
    cacheReadTokens: totals.cacheReadTokens,
    cacheWriteTokens: totals.cacheWriteTokens,
    totalTokens: totals.totalTokens,
    // costUsd is the whole run's price, compaction included; compactionCostUsd
    // below is the part of it PI's compaction spent.
    costUsd,
    costSource,
    assistantCalls: totals.assistantCalls,
    compactionCalls: compaction.assistantCalls,
    compactionTokens: compaction.totalTokens,
    compactionCostUsd: compaction.costUsd,
    compactionCostSource: compactionSource,
    missing,
  };
}

/**
 * One label for a total that may span two ledgers. `mixed` means part of the
 * figure was provider-sent and part was estimated.
 */
function combineCostSources(a: CostSource, b: CostSource, hasCost: boolean): RunUsage["costSource"] {
  if (!hasCost) return "unknown";
  if (a === "unknown" && b === "unknown") return "unknown";
  if (a === "unknown") return b;
  if (b === "unknown") return a;
  return a === b ? a : "mixed";
}

/**
 * Name every dimension this ledger never received. `usageLabel` and `costLabel`
 * carry the surface's wording ("assistant usage" for the run, "summary usage"
 * for the memory pipeline).
 */
function missingDimensions(totals: UsageTotals, usageLabel: string, prefix: string): string[] {
  const label = prefix ? prefix + " " : "";
  const missing: string[] = [];
  if (totals.assistantCalls === 0) missing.push(usageLabel);
  if (totals.assistantCalls > 0 && !totals.cacheReported) missing.push(label + "cache usage");
  // A locally estimated figure is not a provider report: say so, so the caller
  // never presents it as server-sent truth.
  if (!totals.costReported) missing.push(totals.costEstimated ? label + "cost (estimated)" : label + "cost");
  return missing;
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
  return {
    calls: totals.assistantCalls,
    inputTokens: totals.inputTokens,
    outputTokens: totals.outputTokens,
    cacheReadTokens: totals.cacheReadTokens,
    cacheWriteTokens: totals.cacheWriteTokens,
    totalTokens: totals.totalTokens,
    costUsd: totals.costUsd,
    costSource: costSourceOf(totals),
    missing: missingDimensions(totals, "summary usage", "summary"),
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
