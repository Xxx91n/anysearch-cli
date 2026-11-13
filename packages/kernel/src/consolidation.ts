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
  ConsolidateFinalCheckFn,
  ConsolidateFinalCheckVerdict,
  ConsolidateSummarizeFn,
  ConsolidateVerifyFn,
  ConsolidateVerifyVerdict,
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
  // Named gaps, one spelling for every surface: MISSING_USAGE,
  // MISSING_CACHE, MISSING_COST. Never a silent zero.
  missing: string[];
}

// The gap labels live here so the CLI, the MCP result and the tests name the
// same dimension the same way. Three spellings of "cost" made two surfaces
// disagree about whether a gap was reported.
export const MISSING_CONSOLIDATION_USAGE = "consolidation usage";
export const MISSING_CONSOLIDATION_CACHE = "consolidation cache usage";
export const MISSING_CONSOLIDATION_COST = "consolidation cost (price unknown)";

/**
 * Budget wiring for the seam's own model calls.
 *
 * Design: consolidation spends real money outside the agent loop — so it uses
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

/**
 * Decide whether one consolidation run is metered, and on which session.
 *
 * Design: one function both entry points call — writing this rule twice already
 * produced two different answers to "was this run charged?".
 * A run is metered only when all three hold: it scoped to exactly one session
 * (several owners cannot share one run's spend, and charging the first would
 * misattribute it), a [budget] section is declared for the Active Domain
 * (without caps there is nothing to charge against), and the store can
 * register those caps (the ledger's reserve passes for a session with no row,
 * so a store that cannot register cannot enforce).
 *
 * `reason` is the caller-facing explanation when the run is unmetered; both
 * surfaces print it instead of implying a cap was enforced.
 *
 * The declared-caps check reads whatever Active Domain the caller's startup
 * path resolved (the CLI falls back to "default" like `ans chat`; the MCP
 * server uses its engine snapshot). That input differs by host on purpose —
 * the rule below, and therefore the answer to "was this charged?", is one.
 */
export type ConsolidationMetering =
  | { metered: true; budget: ConsolidationBudget }
  | { metered: false; reason: ConsolidationUnmeteredReason };

export type ConsolidationUnmeteredReason =
  | "no-scope-session"
  | "several-scope-sessions"
  | "no-declared-caps"
  | "budget-setup-failed";

export const CONSOLIDATION_UNMETERED_TEXT: Record<ConsolidationUnmeteredReason, string> = {
  "no-scope-session": "a memory-list scope has no owning session to charge",
  "several-scope-sessions": "several session owners cannot share one run's spend, and charging the first would misattribute it",
  "no-declared-caps": "this session declared no [budget] caps, so these calls were not charged to a cap",
  "budget-setup-failed": "the session's budget row or caps could not be registered",
};

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
  // D6: the correction-relationship check (same object/matter/scope/time +
  // reliable evidence) before any material may replace existing knowledge.
  verify: ConsolidateVerifyFn;
  // D7: the final-content check (basis + fact retention) on the merged text
  // before it is committed. Passing verify never skips this one.
  verifyFinal: ConsolidateFinalCheckFn;
  // Accumulates across every model call this seam made. The caller reads it
  // after the run; it is not a live view of the store report.
  usage: ConsolidationUsage;
}

export const CONSOLIDATION_SUMMARY_PROMPT = [
  "Summarize these episodic memories about the same entity into one short, factual paragraph.",
  "Only state facts directly supported by the episodes. No speculation.",
  // D8 (preserve uncorrected facts): the UPDATE path appends the old
  // distilled claim as a CURRENT KNOWLEDGE item. It must survive unless a new
  // episode explicitly corrects that same fact.
  "If an item is titled CURRENT KNOWLEDGE, it is the existing distilled claim:",
  "keep every fact it states unless a new episode explicitly corrects that same fact.",
].join("\n");

// D6: the correction-relationship check. A negation word, a newer date,
// overall similarity or a self-declared "official" source is not sufficient on
// its own; the checker must see the same object, matter, scope and time, and
// an evidence that itself asserts the change confidently.
export const CORRECTION_CHECK_PROMPT = [
  "You are checking a correction before it replaces durable knowledge.",
  "CURRENT KNOWLEDGE:",
  "{OLD}",
  "",
  "CANDIDATE SUMMARY FROM THE NEW MATERIAL:",
  "{NEW}",
  "",
  "NEW MATERIAL:",
  "{EVIDENCE}",
  "",
  "Decide:",
  "1. alreadyCurrent: does the new material already say the same thing as the current",
  "   knowledge (no change)? If yes, there is nothing to correct.",
  "2. sameFact: does the new material assert a change to the SAME fact, subject and scope as",
  "   the current knowledge? A different subject, period, population, or special case",
  "   (for example holiday hours vs regular hours) is NOT the same fact.",
  "3. reliable: does the material itself confidently and specifically assert the change?",
  "   Hearsay, speculation, questions, anonymous forum guesses, or \"might be\" text is NOT",
  "   reliable enough to replace existing knowledge.",
  "4. relation: one of",
  '   "same"       the material restates the current value (no correction)',
  '   "correction" the material explicitly replaces the current value (effective date,',
  '                "changed to", "no longer", "replaced by")',
  '   "different"  a different subject, period, population or special case',
  '   "unclear"    same topic but a conflicting claim with no basis to prefer either side',
  '                (for example two undated statements of equal authority)',
  "",
  "Reply with JSON only:",
  '{"alreadyCurrent": true|false, "sameFact": true|false, "reliable": true|false, "relation": "same|correction|different|unclear", "reason": "<short reason>"}',
].join("\n");

// D7: the final-content check. It does not re-decide whether the correction
// was justified (verify did that); it checks what would actually be written:
// every statement needs a basis, and every old fact the correction did not
// replace must survive.
export const FINAL_CONTENT_CHECK_PROMPT = [
  "You are checking the final text before it replaces durable knowledge.",
  "CURRENT KNOWLEDGE (the row being replaced):",
  "{OLD}",
  "",
  "REPLACEMENT TEXT (about to be written):",
  "{FINAL}",
  "",
  "ACCEPTED CORRECTION (the change this replacement must express):",
  "{CORRECTED}",
  "",
  "NEW MATERIAL (the evidence for the change):",
  "{EVIDENCE}",
  "",
  "Decide:",
  "1. supported: is every statement in the replacement text supported by the current",
  "   knowledge or the new material? A statement with no basis in either is not supported.",
  "2. preserved: does the replacement text keep every fact the current knowledge states,",
  "   except the one fact the new material explicitly corrects? A fact that vanished",
  "   although nothing corrected it means preserved is false.",
  "3. corrected: does the replacement text actually state the corrected fact? The accepted",
  "   correction is given below; if the replacement omits it or contradicts it, corrected is",
  "   false even when supported and preserved are true.",
  "4. noExtras: does the replacement text avoid stating facts that are neither in the current",
  "   knowledge nor the accepted correction? A detail that appears only in the raw material",
  "   (for example a price nobody asked to change) is an extra, and noExtras is false.",
  "",
  "Reply with JSON only:",
 '{"supported": true|false, "preserved": true|false, "corrected": true|false, "noExtras": true|false, "reason": "<short reason>"}',
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
 * Design: reserve before the provider call — a cap-exhausted run must stop
 * instead of discovering the overspend afterwards. Whatever was reserved is
 * released exactly once: in the reserve block's own error path when a later
 * reserve rejects (throw before the stream), and in `finally` after the stream
 * ran, so an aborted or failed stream cannot leave a hold behind.
 *
 * Design: when the provider sends no usage figure, the reservation is booked as
 * spend at its estimated amount — settling 0 would
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
  // A stream that ends with an `error`/`aborted` event has still emitted its
  // text deltas. Those deltas are a truncated answer, not a summary, and the
  // store would classify and persist them.
  let streamFailed = false;
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
      } else if (event?.type === "error") {
        // pi-ai 1.5.x reports a failed stream here instead of throwing.
        streamFailed = true;
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
      // Design: the dollar dimension settles here so a session with a usdCap
      // sees this spend. Only a server-sent price is booked: pi-ai's own
      // rate-card figure is an estimate, and booking it would both misstate the
      // bill and let a guessed price trip a real cap. An estimate stays in the
      // usage report (`costBasis: "price-estimate"`), not in the ledger.
      const providerPriced = usage?.cost?.totalFromProvider === true;
      const reportedUsd = Number(usage?.cost?.total);
      if (providerPriced && Number.isFinite(reportedUsd) && reportedUsd > 0) {
        try {
          budget.ledger.settleUsd(budget.sessionId, 0, reportedUsd);
        } catch { /* fail-open */ }
      }
    }
  }
  // A failed stream yields no summary: the caller must not persist partial text.
  if (streamFailed) {
    return { text: "", usage };
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
      // The cost gap is named too — without a usage figure there is no price
      // either, and a caller reading missing[] must not have to infer that.
      if (!usage.missing.includes(MISSING_CONSOLIDATION_USAGE)) usage.missing.push(MISSING_CONSOLIDATION_USAGE);
      if (!usage.missing.includes(MISSING_CONSOLIDATION_COST)) usage.missing.push(MISSING_CONSOLIDATION_COST);
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
      if (!usage.missing.includes(MISSING_CONSOLIDATION_COST)) {
        usage.missing.push(MISSING_CONSOLIDATION_COST);
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
    if (usage.calls > 0 && !cacheReported && !usage.missing.includes(MISSING_CONSOLIDATION_CACHE)) {
      usage.missing.push(MISSING_CONSOLIDATION_CACHE);
    }
  };

  // Single-pass placeholder substitution: one regex walk over the ORIGINAL
  // template, so inserted content is never re-scanned for placeholders.
  const fillTemplate = (template: string, values: Record<string, string>): string =>
    template.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? values[key]! : match));

  const evidenceLines = (evidence: ConsolidateEvidence[]): string =>
    evidence.map((e, i) => "[" + (i + 1) + "] " + e.title + " - " + e.snippet + " (" + e.url + ")").join("\n");

  const summarize: ConsolidateSummarizeFn = async (episodes) => {
    const prompt = [CONSOLIDATION_SUMMARY_PROMPT, evidenceLines(episodes)].join("\n");
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

  // Conservative parse (D6/D7): a reply without parseable JSON refuses the
  // correction. The store keeps the old knowledge and hands the reason back;
  // an unparseable checker never becomes a silent overwrite.
  const parseVerifyReply = (text: string): ConsolidateVerifyVerdict => {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) {
      return { alreadyCurrent: false, sameFact: false, reliable: false, reason: "checker returned no JSON" };
    }
    try {
      const obj = JSON.parse(text.slice(start, end + 1)) as {
        alreadyCurrent?: unknown; sameFact?: unknown; reliable?: unknown; relation?: unknown; reason?: unknown;
      };
      const relation = obj.relation === "same" || obj.relation === "correction" || obj.relation === "different" || obj.relation === "unclear"
        ? obj.relation
        : undefined;
      return {
        alreadyCurrent: obj.alreadyCurrent === true,
        sameFact: obj.sameFact === true,
        reliable: obj.reliable === true,
        ...(relation ? { relation } : {}),
        ...(typeof obj.reason === "string" ? { reason: obj.reason.slice(0, 240) } : {}),
      };
    } catch {
      return { alreadyCurrent: false, sameFact: false, reliable: false, reason: "checker JSON unparseable" };
    }
  };

  const parseFinalCheckReply = (text: string): ConsolidateFinalCheckVerdict => {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    // Conservative default in both places below: an unparseable reply fails
    // every criterion including `corrected` / `noExtras`, so a checker that
    // did not answer cannot let a row be written.
    if (start < 0 || end <= start) {
      return { supported: false, preserved: false, corrected: false, noExtras: false, reason: "checker returned no JSON" };
    }
    try {
      const obj = JSON.parse(text.slice(start, end + 1)) as {
        supported?: unknown; preserved?: unknown; corrected?: unknown; noExtras?: unknown; reason?: unknown;
      };
      return {
        supported: obj.supported === true,
        preserved: obj.preserved === true,
        corrected: obj.corrected === true,
        noExtras: obj.noExtras === true,
        ...(typeof obj.reason === "string" ? { reason: obj.reason.slice(0, 240) } : {}),
      };
    } catch {
      return { supported: false, preserved: false, corrected: false, noExtras: false, reason: "checker JSON unparseable" };
    }
  };

  const verify: ConsolidateVerifyFn = async ({ oldContent, summary, evidence }) => {
    // Fill the template in one pass. Chained `.replace()` calls re-scan text the
    // earlier step just inserted, so content containing a literal `{NEW}` (for
    // example a note that documents this very prompt) would have its own body
    // overwritten and the candidate section left empty (#273 review).
    const prompt = fillTemplate(CORRECTION_CHECK_PROMPT, {
      OLD: oldContent,
      NEW: summary,
      EVIDENCE: evidenceLines(evidence),
    });
    const result = await completeText(session, prompt, opts.budget);
    account(result.usage);
    finish();
    return parseVerifyReply(result.text);
  };

  const verifyFinal: ConsolidateFinalCheckFn = async ({ oldContent, finalContent, correctedContent, evidence }) => {
    const prompt = fillTemplate(FINAL_CONTENT_CHECK_PROMPT, {
      OLD: oldContent,
      FINAL: finalContent,
      CORRECTED: correctedContent,
      EVIDENCE: evidenceLines(evidence),
    });
    const result = await completeText(session, prompt, opts.budget);
    account(result.usage);
    finish();
    return parseFinalCheckReply(result.text);
  };

  return { summarize, classify, verify, verifyFinal, usage };
}

/** The store capabilities metering needs. Structural so kernel keeps no store import. */
export interface ConsolidationMeteringStore {
  ensureSession(sessionId: string, domain: string): Promise<void>;
  // `any` for the caps argument: the concrete store takes its own BudgetCaps
  // type, and a structural port has to accept that without kernel importing it.
  initBudget?: (sessionId: string, caps: any) => void;
  clearBudgetCaps?: (sessionId: string) => void;
  createBudgetLedger(): BudgetLedgerPort;
}

/**
 * Prepare metering for one run: register the session row and its caps, then
 * report whether the run will actually be charged.
 *
 * Both entry points call this, so they cannot answer "was this metered?"
 * differently. Never throws: a setup fault is reported as unmetered with the
 * reason, because a broken budget must not turn a usable run into a failure.
 */
export async function resolveConsolidationMetering(opts: {
  store: ConsolidationMeteringStore;
  scope: { by: string; sessionIds: string[] };
  domain?: { budget?: unknown };
  // The wire caps for a declared [budget]. Takes `unknown` because kernel does
  // not own the store's BudgetConfig type; the caller's mapper narrows it.
  toCaps: (budget: any) => any;
  domainLabel: string;
  // An existing ledger over the same connection (the MCP engine already built
  // one). Using it keeps one budget row and one set of statements per session.
  ledger?: BudgetLedgerPort;
  warn?: (message: string) => void;
}): Promise<ConsolidationMetering> {
  const warn = opts.warn ?? (() => {});
  if (opts.scope.by !== "session" || opts.scope.sessionIds.length === 0) {
    return { metered: false, reason: "no-scope-session" };
  }
  if (opts.scope.sessionIds.length > 1) {
    return { metered: false, reason: "several-scope-sessions" };
  }
  const sessionId = opts.scope.sessionIds[0]!;
  let ledger: BudgetLedgerPort;
  try {
    ledger = opts.ledger ?? opts.store.createBudgetLedger();
  } catch (e) {
    warn("budget ledger unavailable (" + (e instanceof Error ? e.message : String(e)) + ")");
    return { metered: false, reason: "budget-setup-failed" };
  }
  try {
    // The ledger row has an FK to sessions; a session reached only by
    // consolidation may not have a row yet.
    await opts.store.ensureSession(sessionId, opts.domainLabel);
    if (!opts.domain?.budget) {
      // No declared caps: release a stale row so spend history stays queryable
      // but the session is not presented as capped.
      try { opts.store.clearBudgetCaps?.(sessionId); } catch { /* fail-open */ }
      return { metered: false, reason: "no-declared-caps" };
    }
    if (!opts.store.initBudget) {
      // A store that cannot register caps cannot enforce them; claiming metered
      // would report a cap that does not exist.
      return { metered: false, reason: "budget-setup-failed" };
    }
    opts.store.initBudget(sessionId, opts.toCaps(opts.domain.budget));
    return { metered: true, budget: { sessionId, ledger } };
  } catch (e) {
    warn("budget setup failed (" + (e instanceof Error ? e.message : String(e)) + ")");
    return { metered: false, reason: "budget-setup-failed" };
  }
}
