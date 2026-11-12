// Shared consolidation seams (D5 / Q18 / Q19).
//
// `ans consolidate` and the MCP `ans_chat` tool with `operation=consolidate`
// both build their summarize + fidelity-gate functions here, so the two entry
// points cannot drift apart: same prompt, same gate, same usage accounting.
//
// Cost honesty (Q19): a custom OpenAI-compatible endpoint declares an all-zero
// price table, so a number from pi-ai's own rate card there means "unknown",
// never "free". A figure only counts as server-reported when the provider sent
// it. Every dimension that never arrived is named in `missing[]` instead of
// being rendered as a silent zero.

import type {
  ConsolidateClaimVerdict,
  ConsolidateEvidence,
  ConsolidateSummarizeFn,
} from "@anysearch-cli/store";
import { classifyClaim } from "./attribution";
import type { BudgetLedgerPort } from "./ports";
import type { LlmSession } from "./llm-init";

/**
 * What a `costUsd` number can honestly claim.
 *
 * `mixed` is the honest label when one call was server-priced and another only
 * got a rate-card estimate: calling the total "provider-reported" would
 * misreport the estimated slice as server-sent truth.
 */
export type ConsolidationCostBasis =
  | "not-called"
  | "unknown"
  | "price-estimate"
  | "provider-reported"
  | "mixed";

export interface ConsolidationUsage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  // Provider-reported cache reads/writes stay separate from input so a caller
  // can see what the prompt cache actually saved.
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  costUsd: number;
  costBasis: ConsolidationCostBasis;
  // Named gaps: "consolidation usage", "consolidation cache usage",
  // "consolidation cost (price unknown)". Never a silent zero.
  missing: string[];
}

/**
 * Budget wiring for the seam's own model calls.
 *
 * Design: consolidation spends real money outside the agent loop, so it uses
 * the same reserve-then-settle ledger as the run (D4: extra model work is
 * budgeted and accounted, never hidden outside the main call). One rule for
 * both entry points: a run is metered when it names a session that owns a
 * ledger row; a memory-list scope that no session owns is reported as
 * unmetered instead of being charged to a session the caller never named.
 */
export interface ConsolidationBudget {
  sessionId: string;
  ledger: BudgetLedgerPort;
}

/** A rejected reserve. The store counts it and stops spending; it is not a summary fault. */
export class ConsolidationBudgetError extends Error {
  readonly code = "consolidate-budget-rejected";
  constructor(message: string) {
    super(message);
    this.name = "ConsolidationBudgetError";
  }
}

export function isConsolidationBudgetError(e: unknown): e is ConsolidationBudgetError {
  return e instanceof ConsolidationBudgetError
    || (typeof e === "object" && e !== null && (e as { code?: unknown }).code === "consolidate-budget-rejected");
}

export interface ConsolidationSeams {
  summarize: ConsolidateSummarizeFn;
  classify: (claim: string, evidence: ConsolidateEvidence[]) => ConsolidateClaimVerdict;
  // Accumulates across every model call this seam made. The caller reads it
  // after the run; it is not a live view of the store report.
  usage: ConsolidationUsage;
}

export const CONSOLIDATION_SUMMARY_PROMPT = [
  "Summarize these episodic memories about the same entity into one short, factual paragraph.",
  "Only state facts directly supported by the episodes. No speculation.",
].join("\n");

// Output-side reserve for a summary call. Summaries are short; this keeps the
// pre-call token reservation conservative without pinning the model's own
// maxTokens (8192 on a custom endpoint) and over-reserving on every cluster.
const SUMMARY_OUTPUT_RESERVE_TOKENS = 1024;

// Prompt characters to tokens. Deliberately coarse and conservative: this is
// only the pre-call reservation, and the actual provider figure settles it.
function estimatePromptTokens(prompt: string): number {
  return Math.max(1, Math.ceil(prompt.length / 2));
}

type RawUsage = {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  totalTokens?: number;
  cost?: { total?: number; totalFromProvider?: boolean };
};

interface CompletionResult {
  text: string;
  usage?: RawUsage;
}

/** True when the model carries a real price table (catalog model, not a custom endpoint). */
function hasPriceTable(model: unknown): boolean {
  const cost = (model as { cost?: Record<string, unknown> } | undefined)?.cost;
  if (!cost) return false;
  return ["input", "output", "cacheRead", "cacheWrite"].some((k) => Number(cost[k]) > 0)
    || (Array.isArray((cost as { tiers?: unknown }).tiers) && ((cost as { tiers: unknown[] }).tiers.length > 0));
}

function textOfMessage(message: unknown): string {
  const blocks = (message as { content?: unknown } | undefined)?.content;
  if (!Array.isArray(blocks)) return "";
  let out = "";
  for (const block of blocks) {
    if (block && (block as { type?: string }).type === "text") {
      out += String((block as { text?: unknown }).text ?? "");
    }
  }
  return out;
}

/**
 * One direct completion plus its usage.
 *
 * Design: reserve before the provider call and release in `finally` — a
 * cap-exhausted run must stop instead of discovering the overspend afterwards,
 * and an aborted or failed stream must not leave a reservation behind.
 *
 * Design: when the provider sends no usage figure, the reservation is booked as
 * spend at its estimated amount instead of being settled as 0. Settling 0 would
 * let a silent provider evade the token cap entirely and read as a free call;
 * the reserved estimate is the only number this code has. The usage report still
 * names "consolidation usage" as missing.
 */
async function completeText(
  session: Pick<LlmSession, "model" | "streamFn" | "apiKey">,
  prompt: string,
  budget: ConsolidationBudget | undefined,
): Promise<CompletionResult> {
  let reservedTokens = 0;
  let reservedCall = false;
  if (budget) {
    try {
      reservedCall = budget.ledger.reserveCalls(budget.sessionId, 1);
      if (!reservedCall) {
        throw new ConsolidationBudgetError(
          "consolidation stopped: the session's call budget is exhausted (reserveCalls rejected)",
        );
      }
      reservedTokens = estimatePromptTokens(prompt) + SUMMARY_OUTPUT_RESERVE_TOKENS;
      if (!budget.ledger.reserveTokens(budget.sessionId, reservedTokens)) {
        // The call reservation succeeded, so it must be given back before this
        // call aborts: otherwise reserved_calls stays +1 for the rest of the
        // session and a healthy run later reads as exhausted.
        try { budget.ledger.settleCalls(budget.sessionId, 1, 0); } catch { /* fail-open */ }
        reservedCall = false;
        reservedTokens = 0;
        throw new ConsolidationBudgetError(
          "consolidation stopped: the session's token budget cannot cover this model call (reserveTokens rejected)",
        );
      }
    } catch (e) {
      if (isConsolidationBudgetError(e)) throw e;
      // A ledger fault is not exhaustion (#200's fail-open rule): give back
      // whatever this call took and continue unmetered for it.
      try { if (reservedCall) budget.ledger.settleCalls(budget.sessionId, 1, 0); } catch { /* fail-open */ }
      try { if (reservedTokens > 0) budget.ledger.settleTokens(budget.sessionId, reservedTokens, 0); } catch { /* fail-open */ }
      reservedCall = false;
      reservedTokens = 0;
    }
  }

  let text = "";
  let usage: RawUsage | undefined;
  try {
    const stream = session.streamFn(
      session.model as never,
      { messages: [{ role: "user", content: prompt }] } as never,
      { ...(session.apiKey ? { apiKey: session.apiKey } : {}) } as never,
    );
    for await (const event of stream as AsyncIterable<{
      type?: string;
      delta?: string;
      message?: unknown;
    }>) {
      if (event?.type === "text_delta" && typeof event.delta === "string") {
        text += event.delta;
      } else if (event?.type === "done" && event.message) {
        usage = (event.message as { usage?: RawUsage }).usage;
        if (!text) text = textOfMessage(event.message);
      }
    }
  } finally {
    if (budget) {
      // Design: a call that reported no usage still books its reservation as
      // spend instead of settling 0. Settling 0 would let a silent provider
      // evade the token cap entirely (and read as a free call); the reserved
      // estimate is the only number this code has, so it is booked as an
      // estimate and the usage report names "consolidation usage" missing.
      const reportedTotal = Number(usage?.totalTokens);
      const hasUsage = Number.isFinite(reportedTotal) && reportedTotal >= 0;
      try {
        if (reservedCall) budget.ledger.settleCalls(budget.sessionId, 1, 1);
      } catch { /* the reservation release below still runs; a fault must not mask the call result */ }
      try {
        if (reservedTokens > 0) {
          budget.ledger.settleTokens(budget.sessionId, reservedTokens, hasUsage ? reportedTotal : reservedTokens);
        }
      } catch { /* fail-open: the ledger release is not the caller's failure */ }
    }
  }
  return { text: text.trim(), usage };
}

/**
 * Build the summarize/classify seams over one LLM session.
 *
 * `usage` accumulates for the lifetime of the returned object; a caller that
 * runs two consolidations over one seam must read it in between, or keep one
 * seam per run (both hosts do the latter).
 */
export function createConsolidationSeams(
  session: Pick<LlmSession, "model" | "streamFn" | "apiKey">,
  opts: { budget?: ConsolidationBudget } = {},
): ConsolidationSeams {
  const priceTable = hasPriceTable(session.model);

  const usage: ConsolidationUsage = {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    costUsd: 0,
    costBasis: "not-called",
    missing: [],
  };
  let providerPricedCalls = 0;
  let estimatedCalls = 0;
  let cacheReported = false;

  const account = (raw: RawUsage | undefined): void => {
    usage.calls += 1;
    if (!raw) {
      // Text came back but the provider sent no usage block: say so, never 0.
      if (!usage.missing.includes("consolidation usage")) usage.missing.push("consolidation usage");
      return;
    }
    usage.inputTokens += Number(raw.input) || 0;
    usage.outputTokens += Number(raw.output) || 0;
    usage.cacheReadTokens += Number(raw.cacheRead) || 0;
    usage.cacheWriteTokens += Number(raw.cacheWrite) || 0;
    usage.totalTokens += Number(raw.totalTokens) || (Number(raw.input) || 0) + (Number(raw.output) || 0);
    if ((Number(raw.cacheRead) || 0) > 0 || (Number(raw.cacheWrite) || 0) > 0) cacheReported = true;

    const cost = raw.cost;
    if (cost && cost.totalFromProvider === true) {
      providerPricedCalls += 1;
      usage.costUsd += Number(cost.total) || 0;
    } else if (cost && priceTable) {
      // pi-ai computed this from the model's own rate card: an estimate, not a bill.
      estimatedCalls += 1;
      usage.costUsd += Number(cost.total) || 0;
    } else {
      // No price table (custom endpoint) or no cost object at all: the dollar
      // figure is unknown. Never present it as free.
      if (!usage.missing.includes("consolidation cost (price unknown)")) {
        usage.missing.push("consolidation cost (price unknown)");
      }
    }
  };

  const finish = (): void => {
    if (usage.calls === 0) {
      usage.costBasis = "not-called";
    } else if (providerPricedCalls === usage.calls) {
      usage.costBasis = "provider-reported";
    } else if (providerPricedCalls > 0) {
      usage.costBasis = "mixed";
    } else if (estimatedCalls > 0) {
      usage.costBasis = "price-estimate";
    } else {
      usage.costBasis = "unknown";
    }
    // pi-ai materialises cacheRead/cacheWrite as numbers, so an all-zero run is
    // "not reported", not "reported zero".
    if (usage.calls > 0 && !cacheReported && !usage.missing.includes("consolidation cache usage")) {
      usage.missing.push("consolidation cache usage");
    }
  };

  const summarize: ConsolidateSummarizeFn = async (episodes) => {
    const prompt = [
      CONSOLIDATION_SUMMARY_PROMPT,
      ...episodes.map((e, i) => "[" + (i + 1) + "] " + e.title + " - " + e.snippet + " (" + e.url + ")"),
    ].join("\n");
    const result = await completeText(session, prompt, opts.budget);
    account(result.usage);
    finish();
    return result.text || null;
  };

  const classify = (claim: string, evidence: ConsolidateEvidence[]): ConsolidateClaimVerdict => {
    const r = classifyClaim(claim, {
      retrievalResults: evidence.map((e) => ({ title: e.title, snippet: e.snippet, url: e.url }) as never),
    });
    return { label: r.label, confidence: r.confidence };
  };

  return { summarize, classify, usage };
}
