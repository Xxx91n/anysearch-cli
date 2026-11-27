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

import {
  CONSOLIDATION_CLUSTER_TOKEN_BUDGET,
  type ConsolidateClaimVerdict,
  type ConsolidateEvidence,
  type ConsolidateEvidenceSection,
  type ConsolidateFinalCheckFn,
  type ConsolidateFinalCheckVerdict,
  type ConsolidateMaterialFeed,
  type ConsolidateSummarizeFn,
  type ConsolidateVerifyFn,
  type ConsolidateVerifyVerdict,
} from "@anysearch-cli/store";
import { classifyClaim } from "./attribution";
import type { BudgetLedgerPort } from "./ports";
import type { TaskBudgetWiring } from "./task-budget";
import type { LlmSession } from "./llm-init";
import type { AliasJudgeFn, AliasJudgeVerdict } from "@anysearch-cli/store";

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
 * budgeted and accounted, never hidden outside the main call). The task-first
 * decision lives in `taskBudgetMetering`; this type is the row key either form
 * hands to one ledger interface.
 */
export interface ConsolidationBudget {
  /** The ledger's key for this run: a session id on the session form, a task id
   * on the task form (`ans consolidate` and MCP `ans_chat operation=consolidate`).
   * Only used as the row key against `ledger` — never resolved back to a session. */
  sessionId: string;
  ledger: BudgetLedgerPort;
}

/**
 * The task-first metering answer both hosts share (#304/#303).
 *
 * `undefined` means "no task budget to bill, use the session-form rule"; a
 * returned value is final — the run bills that task, and a domain that declares
 * no caps is reported as unmetered WITHOUT releasing anything on a session the
 * caller never named.
 *
 * Design: one function instead of the same ternary in each host — a memory list
 * has no owning session, and charging "the first of several sessions" would
 * misattribute a run that spans chats. Keeping the branch here is what stops
 * the CLI and the MCP tool from answering "was this run charged?" differently.
 */
export function taskBudgetMetering(
  wiring: TaskBudgetWiring,
): ConsolidationMetering | undefined {
  if (!wiring.taskBudget) return undefined;
  return wiring.declared
    ? { metered: true, budget: { sessionId: wiring.taskBudget.taskId, ledger: wiring.taskBudget.ledger } }
    : { metered: false, reason: "no-declared-caps" };
}

/**
 * Decide whether one consolidation run is metered, and on which session.
 *
 * Design: the session-form rule lives in one function — writing it twice
 * already produced two different answers to "was this run charged?".
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
  "no-declared-caps": "this run declared no [budget] caps, so these calls were not charged to a cap",
  "budget-setup-failed": "this run's budget row or caps could not be registered",
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
  // #277: "are these two names the same object?" — the question character
  // similarity cannot answer across scripts. Its answer is a proposal for the
  // review queue, never an automatic merge.
  judgeEntityAlias: AliasJudgeFn;
  // Accumulates across every model call this seam made. The caller reads it
  // after the run; it is not a live view of the store report.
  usage: ConsolidationUsage;
}

export const CONSOLIDATION_SUMMARY_PROMPT = [
  "The materials are above, numbered [1], [2], ... Each starts with its page title path.",
  "Summarize them into one short, factual paragraph about the same entity.",
  "Only state facts directly supported by the materials. No speculation.",
  // D8 (preserve uncorrected facts): the UPDATE path appends the old
  // distilled claim as a CURRENT KNOWLEDGE item. It must survive unless a new
  // episode explicitly corrects that same fact.
  "If an item is titled CURRENT KNOWLEDGE, it is the existing distilled claim:",
  "keep every fact it states unless a new material explicitly corrects that same fact.",
  "",
  // #613: the reply shape is the contract. Only <conclusion> is persisted;
  // <quotes> goes to the correction judges and the run report. A reply without
  // both tags is kept whole by the store and flagged quotesMissing, so a model
  // that ignores this instruction cannot silently lose the facts it stated.
  "Reply in exactly this shape, with no text outside the two blocks:",
  "<quotes>",
  "[n] <heading path> [@<section offset>] \"<verbatim sentence from that material>\"",
  "</quotes>",
  "<conclusion>",
  "<the factual paragraph>",
  "</conclusion>",
  "Every sentence in the conclusion must be supported by a quoted sentence.",
  "Quote only text that appears in the materials; never paraphrase inside <quotes>.",
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
  "QUOTES FROM THE NEW MATERIAL (verbatim excerpts; no other material text is shown):",
  "{QUOTES}",
  "",
  "Decide:",
  "1. alreadyCurrent: do the quotes already say the same thing as the current",
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
  "QUOTES FROM THE NEW MATERIAL (the only evidence for the change):",
  "{QUOTES}",
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

// #277: the cross-script entity check. Character similarity is 0 between a
// Chinese name and a Latin one, so this is the only evidence source that can
// relate them — and being a model, it can be wrong. That is why its answer is
// only a proposal: the store queues it for review and never applies it alone.
//
// The prompt asks for `null` explicitly. A model that must answer yes/no will
// guess; letting it say "cannot tell" is what keeps the caller from reading a
// coin flip as a decision.
export const CROSS_SCRIPT_ALIAS_PROMPT = [
  "You are deciding whether names written in DIFFERENT writing systems refer to the same object.",
  "Each pair below has one Latin-letter name and one Chinese name, taken from the same text.",
  "",
  "{PAIRS}",
  "",
  "For each pair answer:",
  "- true  only when the text gives clear evidence they name one object: a translation in",
  "        parentheses, a transliteration a reader would recognize as the same company, or an",
  "        explicit equivalence. A well-known company's established Chinese name counts.",
  "- false when the text suggests they are different objects, or when the two names are",
  "        merely mentioned near each other.",
  "- null  when you cannot tell. Use this freely: a wrong merge is costly and hard to undo,",
  "        while an undetermined pair is simply reported as undetermined.",
  "",
  "Do not decide from the names alone when the context does not support it.",
  "",
  "Reply with JSON only, one entry per pair in the same order:",
  '[{"i": 1, "same": true|false|null, "reason": "<short reason>"}]',
].join("\n");

function aliasPairsBlock(pairs: ReadonlyArray<{ left: string; right: string; context?: string }>): string {
  return pairs
    .map((p, i) => {
      const ctx = p.context ? "\n   context: " + p.context.replace(/\s+/g, " ").slice(0, 300) : "";
      return (i + 1) + ". Latin: " + p.left + " | Chinese: " + p.right + ctx;
    })
    .join("\n");
}

/**
 * #277: read the judge's reply.
 *
 * Deliberately conservative in three ways, each of which would otherwise turn a
 * broken reply into a wrong merge:
 * - an entry that is missing keeps `same: null` (undetermined), never `false`
 *   and never `true`;
 * - only a JSON `true` counts as yes — the string "true", a truthy number or a
 *   prose answer all stay undetermined;
 * - an unparseable reply returns all-null, so the caller records "undetermined"
 *   instead of acting on nothing.
 */
export function parseAliasReply(text: string, expected: number): AliasJudgeVerdict[] {
  const out: AliasJudgeVerdict[] = Array.from({ length: expected }, () => ({ same: null }));
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) return out;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return out;
  }
  if (!Array.isArray(parsed)) return out;
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") continue;
    const obj = entry as { i?: unknown; same?: unknown; reason?: unknown };
    const idx = typeof obj.i === "number" && Number.isInteger(obj.i) ? obj.i - 1 : -1;
    if (idx < 0 || idx >= expected) continue;
    const same = obj.same === true ? true : obj.same === false ? false : null;
    out[idx] = {
      same,
      ...(typeof obj.reason === "string" ? { reason: obj.reason.slice(0, 240) } : {}),
    };
  }
  return out;
}
// Output-side reserve for a summary call. Summaries are short; this keeps the
// pre-call token reservation conservative without pinning the model's own
// maxTokens (8192 on a custom endpoint) and over-reserving on every cluster.
const SUMMARY_OUTPUT_RESERVE_TOKENS = 1024;

// Prompt characters to tokens. Deliberately coarse and conservative: this is
// only the pre-call reservation, and the actual provider figure settles it.
function estimateReservationTokens(prompt: string): number {
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
        // This seam bills either a task budget or the session ledger, so the
        // message names neither.
        throw new ConsolidationBudgetError(
          "consolidation stopped: the call budget is exhausted (reserveCalls rejected)",
        );
      }
      reservedTokens = estimateReservationTokens(prompt) + SUMMARY_OUTPUT_RESERVE_TOKENS;
      if (!budget.ledger.reserveTokens(budget.sessionId, reservedTokens)) {
        // The call reservation succeeded, so it must be given back before this
        // call aborts: otherwise reserved_calls stays +1 for the rest of the
        // session and a healthy run later reads as exhausted.
        try { budget.ledger.settleCalls(budget.sessionId, 1, 0); } catch { /* fail-open */ }
        reservedCall = false;
        reservedTokens = 0;
        throw new ConsolidationBudgetError(
          "consolidation stopped: the token budget cannot cover this model call (reserveTokens rejected)",
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
 * Language-aware token estimate for a prompt block.
 *
 * A tokenizer is not available here, so this is deliberately conservative:
 * one CJK code point is one token (Chinese/Japanese/Korean are the dense
 * case), Latin text is about four characters per token. The store reports the
 * number as an estimate, never as a billed count.
 */
export function estimatePromptTokens(text: string): number {
  let cost = 0;
  for (const ch of text) cost += charTokenCost(ch.codePointAt(0) ?? 0);
  return Math.ceil(cost);
}

/** Per-code-point cost shared by the estimate and the truncation. */
function charTokenCost(cp: number): number {
  return isCjkCodePoint(cp) ? 1 : 0.25;
}

function isCjkCodePoint(cp: number): boolean {
  return (
    (cp >= 0x3400 && cp <= 0x4dbf) ||   // CJK extension A
    (cp >= 0x4e00 && cp <= 0x9fff) ||   // CJK unified ideographs
    (cp >= 0xf900 && cp <= 0xfaff) ||   // compatibility ideographs
    (cp >= 0x20000 && cp <= 0x2a6df) || // CJK extension B
    (cp >= 0x3040 && cp <= 0x30ff) ||   // kana
    (cp >= 0xac00 && cp <= 0xd7af) ||   // hangul
    (cp >= 0x3000 && cp <= 0x303f) ||   // CJK punctuation
    (cp >= 0xff00 && cp <= 0xffef)      // fullwidth forms
  );
}

function codePointLength(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) i++;
    n++;
  }
  return n;
}

/** Slice by code-point offset/length, the unit the block table stores. */
function codePointSlice(text: string, start: number, count: number): string {
  if (count <= 0) return "";
  const out: string[] = [];
  let offset = 0;
  let taken = 0;
  for (const ch of text) {
    if (offset >= start && taken < count) {
      out.push(ch);
      taken++;
      if (taken >= count) break;
    }
    offset++;
  }
  return out.join("");
}

/** Cut text at the last character that fits the token budget. */
function truncateToTokenBudget(text: string, budget: number): string {
  if (budget <= 0) return "";
  let used = 0;
  const out: string[] = [];
  for (const ch of text) {
    const cost = charTokenCost(ch.codePointAt(0) ?? 0);
    if (used + cost > budget + 1e-9) break;
    used += cost;
    out.push(ch);
  }
  return out.join("");
}

/** Words for Latin text, bigrams for CJK, used only to rank sections. */
function relevanceTokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.toLowerCase().matchAll(/[a-z0-9]+/g)) out.add(m[0] ?? "");
  for (const m of text.matchAll(/[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]+/g)) {
    const run = m[0] ?? "";
    if (run.length <= 2) {
      if (run) out.add(run);
      continue;
    }
    for (let i = 0; i < run.length - 1; i++) out.add(run.slice(i, i + 2));
  }
  out.delete("");
  return out;
}

function sectionRelevance(headingPath: string, focus: Set<string>): number {
  const tokens = relevanceTokens(headingPath);
  if (tokens.size === 0) return 0;
  let overlap = 0;
  for (const t of tokens) if (focus.has(t)) overlap++;
  // Length-normalised so a long heading does not outrank a precise short one
  // just by containing more words.
  return overlap / Math.sqrt(tokens.size);
}

function evidenceSource(e: ConsolidateEvidence): { text: string; source: "content" | "snippet" } {
  if (typeof e.content === "string" && e.content.trim().length > 0) {
    return { text: e.content, source: "content" };
  }
  return { text: e.snippet ?? "", source: "snippet" };
}

interface PlannedEvidenceCandidate {
  materialIndex: number;
  material: ConsolidateEvidence;
  section: ConsolidateEvidenceSection | null;
  heading: string;
  /** Empty for an unread section; filled from sourceText only after selection. */
  text: string;
  /** The body a section is sliced from; never read while ranking. */
  sourceText?: string;
  score: number;
  truncated: boolean;
}

function renderHeader(c: PlannedEvidenceCandidate, ordinal: number): string {
  const heading = c.heading.trim() || "(untitled)";
  const offset = c.section ? " @" + c.section.startOffset : "";
  return "[" + ordinal + "] " + heading + offset + " (" + c.material.url + ")\n";
}

function candidateText(c: PlannedEvidenceCandidate): string {
  if (c.text.length > 0 || !c.section || c.sourceText === undefined) return c.text;
  return codePointSlice(c.sourceText, c.section.startOffset, c.section.chars);
}

function renderCandidate(c: PlannedEvidenceCandidate, ordinal: number): { block: string; header: string; textChars: number; tokens: number } {
  const text = candidateText(c);
  const header = renderHeader(c, ordinal);
  const block = header + text;
  return { block, header, textChars: codePointLength(text), tokens: estimatePromptTokens(block) };
}

/**
 * Lay materials out for one summary call under the 24k-token budget.
 *
 * Design: under the cap the whole body (or snippet) goes in, in the caller's
 * order. Over the cap the planner reads only section metadata (heading path,
 * offset, length) to rank sections against the cluster's titles; the selected
 * sections are then sliced out of the body. Blocks are placed most-relevant
 * LAST and least-relevant in the middle, because the model attends to both ends
 * of a long prompt more than the middle.
 */
export function planClusterEvidence(
  episodes: ConsolidateEvidence[],
  tokenBudget: number = CONSOLIDATION_CLUSTER_TOKEN_BUDGET,
): { prompt: string; materials: ConsolidateMaterialFeed[]; overBudget: boolean } {
  const budget = Number.isFinite(tokenBudget) && tokenBudget > 0
    ? Math.floor(tokenBudget)
    : CONSOLIDATION_CLUSTER_TOKEN_BUDGET;
  const sources = episodes.map(evidenceSource);

  const focus = new Set<string>();
  for (const e of episodes) {
    for (const t of relevanceTokens(e.title)) focus.add(t);
  }

  const whole: PlannedEvidenceCandidate[] = episodes.map((e, i) => ({
    materialIndex: i,
    material: e,
    section: null,
    heading: e.title,
    text: sources[i]!.text,
    score: 0,
    truncated: false,
  }));

  // Whole-page path. The ordinal used for the estimate is the worst case
  // (every material has a 2+ digit index), so the decision never undercounts.
  const wholeTokens = whole.reduce((n, c) => n + renderCandidate(c, episodes.length).tokens, 0);
  if (wholeTokens <= budget) {
    const rendered = whole.map((c, i) => renderCandidate(c, i + 1));
    return {
      prompt: rendered.map((r) => r.block).join("\n\n"),
      materials: episodes.map((e, i) => ({
        cluster: 0,
        materialId: e.materialId ?? null,
        url: e.url,
        title: e.title,
        originalChars: codePointLength(sources[i]!.text),
        fedChars: rendered[i]!.textChars,
        estimatedTokens: rendered[i]!.tokens,
        sections: [],
        overBudget: false,
        truncated: false,
        cacheHit: false,
        source: sources[i]!.source,
      })),
      overBudget: false,
    };
  }

  // Over budget: every section is a candidate; a material without section data
  // competes as one whole block (a snippet-only row has nothing finer to pick).
  const candidates: PlannedEvidenceCandidate[] = [];
  for (let i = 0; i < episodes.length; i++) {
    const e = episodes[i]!;
    const src = sources[i]!;
    if (src.source === "content" && e.sections && e.sections.length > 0) {
      for (const s of e.sections) {
        if (s.chars <= 0) continue;
        candidates.push({
          materialIndex: i,
          material: e,
          section: s,
          heading: s.headingPath,
          text: "",
          sourceText: src.text,
          score: sectionRelevance(s.headingPath, focus),
          truncated: false,
        });
      }
      continue;
    }
    candidates.push(whole[i]!);
  }

  const ranked = candidates.slice().sort((a, b) =>
    b.score - a.score ||
    a.materialIndex - b.materialIndex ||
    (a.section?.startOffset ?? -1) - (b.section?.startOffset ?? -1));
  const chosen: PlannedEvidenceCandidate[] = [];
  let used = 0;
  for (const c of ranked) {
    // A section is costed by its metadata ceiling: one token per code point,
    // plus the header. This keeps the ranking read-only; Latin sections may be
    // under-filled, which is the safe direction for a hard cap.
    const tokens = c.section
      ? estimatePromptTokens(renderHeader(c, c.materialIndex + 1)) + c.section.chars
      : renderCandidate(c, c.materialIndex + 1).tokens;
    if (used + tokens <= budget) {
      chosen.push(c);
      used += tokens;
    }
  }
  if (chosen.length === 0 && ranked.length > 0) {
    // Not even the best single block fits: keep its head so the prompt still
    // carries evidence instead of degrading to an empty materials section.
    const best = ranked[0]!;
    const bestText = candidateText(best);
    const header = renderHeader(best, best.materialIndex + 1);
    const room = Math.max(0, budget - estimatePromptTokens(header));
    const text = truncateToTokenBudget(bestText, room);
    if (text.length > 0) {
      chosen.push({ ...best, text, truncated: text.length < bestText.length });
    }
  } else {
    // A snippet-only material has no sections to select, so a too-large whole
    // block would otherwise be dropped entirely once anything else fits. Keep
    // its head in the space that is left: "whole text within budget, or
    // truncate" applies per material, not only when the prompt is empty.
    const droppedWhole = ranked.find((c) => c.section === null && !chosen.includes(c));
    if (droppedWhole) {
      const header = renderHeader(droppedWhole, droppedWhole.materialIndex + 1);
      const room = Math.max(0, budget - used - estimatePromptTokens(header));
      const text = truncateToTokenBudget(droppedWhole.text, room);
      if (text.length > 0) {
        chosen.push({ ...droppedWhole, text, truncated: text.length < droppedWhole.text.length });
      }
    }
  }

  // Most relevant last, least relevant in the middle. Section text is sliced
  // here, after the ranking, so the planner never reads unselected blocks.
  const selected = chosen.map((c) => (c.section ? { ...c, text: candidateText(c) } : c));
  const ordered = arrangeByRelevance(selected);
  const materials: ConsolidateMaterialFeed[] = episodes.map((e, i) => ({
    cluster: 0,
    materialId: e.materialId ?? null,
    url: e.url,
    title: e.title,
    originalChars: codePointLength(sources[i]!.text),
    fedChars: 0,
    estimatedTokens: 0,
    sections: [],
    overBudget: true,
    truncated: false,
    cacheHit: false,
    source: sources[i]!.source,
  }));
  const firstSeen = ordered
    .map((c) => c.materialIndex)
    .filter((i, at, all) => all.indexOf(i) === at);
  const blocks: string[] = [];
  for (let i = 0; i < ordered.length; i++) {
    const c = ordered[i]!;
    const r = renderCandidate(c, c.materialIndex + 1);
    blocks.push(r.block);
    const feed = materials[c.materialIndex]!;
    feed.fedChars += r.textChars;
    feed.estimatedTokens += r.tokens;
    feed.truncated = feed.truncated || c.truncated;
    if (c.section) {
      feed.sections.push({
        sectionId: c.section.sectionId,
        headingPath: c.section.headingPath,
        chars: r.textChars,
      });
    }
  }
  // Prompt order first; materials that did not fit follow with fedChars 0 so
  // the report can say what was dropped instead of silently omitting it.
  const rest = episodes.map((_, i) => i).filter((i) => !firstSeen.includes(i));
  return {
    prompt: blocks.join("\n\n"),
    materials: [...firstSeen, ...rest].map((i) => materials[i]!),
    overBudget: true,
  };
}

function arrangeByRelevance<T extends { score: number; materialIndex: number }>(chosen: T[]): T[] {
  if (chosen.length <= 1) return chosen.slice();
  const ranked = chosen.slice().sort((a, b) => b.score - a.score || a.materialIndex - b.materialIndex);
  if (ranked.length === 2) return [ranked[1]!, ranked[0]!];
  const out: Array<T | null> = new Array(ranked.length).fill(null);
  out[out.length - 1] = ranked[0]!;
  const middle = Math.floor((ranked.length - 1) / 2);
  out[middle] = ranked[ranked.length - 1]!;
  const rest = ranked.slice(1, -1);
  let r = 0;
  for (let i = 0; i < out.length; i++) {
    if (out[i] === null) out[i] = rest[r++]!;
  }
  return out as T[];
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
    const planned = planClusterEvidence(episodes, CONSOLIDATION_CLUSTER_TOKEN_BUDGET);
    // Materials first, instructions last: the model reads the evidence before
    // it is told what to do, and the stable instruction block stays at the end
    // where a prefix cache can still match it across calls.
    const prompt = planned.prompt.length > 0
      ? planned.prompt + "\n\n" + CONSOLIDATION_SUMMARY_PROMPT
      : CONSOLIDATION_SUMMARY_PROMPT;
    const result = await completeText(session, prompt, opts.budget);
    account(result.usage);
    finish();
    // A provider that reports cache reads says the stable part of this prompt
    // was already in its cache. The report copies that fact per material.
    const cacheHit = (Number(result.usage?.cacheRead) || 0) > 0;
    return {
      text: result.text || null,
      materials: planned.materials.map((m) => ({ ...m, cacheHit })),
      overBudget: planned.overBudget,
      cacheHit,
    };
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

  const verify: ConsolidateVerifyFn = async ({ oldContent, summary, quotes, evidence }) => {
    // Fill the template in one pass. Chained `.replace()` calls re-scan text the
    // earlier step just inserted, so content containing a literal `{NEW}` (for
    // example a note that documents this very prompt) would have its own body
    // overwritten and the candidate section left empty (#273 review).
    //
    // Design: the judge reads the summarizer's verbatim quotes, not the full
    // evidence. `undefined` means an old caller that has no quotes yet; only
    // then fall back to the evidence lines. An empty string is a real answer
    // ("the model quoted nothing") and must not be replaced with the evidence.
    const quoteText = quotes === undefined ? evidenceLines(evidence) : quotes;
    const prompt = fillTemplate(CORRECTION_CHECK_PROMPT, {
      OLD: oldContent,
      NEW: summary,
      QUOTES: quoteText,
    });
    const result = await completeText(session, prompt, opts.budget);
    account(result.usage);
    finish();
    return parseVerifyReply(result.text);
  };

  const verifyFinal: ConsolidateFinalCheckFn = async ({ oldContent, finalContent, correctedContent, quotes, evidence }) => {
    const quoteText = quotes === undefined ? evidenceLines(evidence) : quotes;
    const prompt = fillTemplate(FINAL_CONTENT_CHECK_PROMPT, {
      OLD: oldContent,
      FINAL: finalContent,
      CORRECTED: correctedContent,
      QUOTES: quoteText,
    });
    const result = await completeText(session, prompt, opts.budget);
    account(result.usage);
    finish();
    return parseFinalCheckReply(result.text);
  };

  // #277: the cross-script entity judge. `same: true` means "one object written
  // two ways"; `same: false` means "different objects"; `same: null` means the
  // model could not tell. The store must not treat a null as either answer, so
  // the parser keeps it distinct instead of collapsing it to false.
  const judgeEntityAlias: AliasJudgeFn = async (pairs) => {
    const prompt = fillTemplate(CROSS_SCRIPT_ALIAS_PROMPT, { PAIRS: aliasPairsBlock(pairs) });
    const result = await completeText(session, prompt, opts.budget);
    account(result.usage);
    finish();
    return parseAliasReply(result.text, pairs.length);
  };

  return { summarize, classify, verify, verifyFinal, judgeEntityAlias, usage };
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
 * Prepare metering for one run on the SESSION form: register the session row
 * and its caps, then report whether the run will actually be charged.
 *
 * Callers ask `taskBudgetMetering` first; this is the fallback when no task
 * budget can be attached. Both hosts call this rather than writing the session
 * rule themselves, so they cannot answer "was this metered?" differently.
 * Never throws: a setup fault is reported as unmetered with the reason,
 * because a broken budget must not turn a usable run into a failure.
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
