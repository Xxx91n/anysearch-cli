// Shared consolidation seams. The CLI (`ans consolidate`) and the MCP tool
// (`ans_chat` with operation=consolidate) both build the summarize + fidelity
// gate functions here, so the two entry points cannot drift apart.

import type {
  ConsolidateClaimVerdict,
  ConsolidateEvidence,
  ConsolidateSummarizeFn,
  ConsolidateVerifyFn,
} from "@anysearch-cli/store";
import { classifyClaim } from "./attribution";
import type { LlmSession } from "./llm-init";

/**
 * What a `costUsd` number can honestly claim. A custom endpoint has no price
 * table and its OpenAI-compatible wire format carries no dollar figure, so
 * "0" there means "unknown", not "free" (Q19).
 */
export type ConsolidationCostBasis = "not-called" | "unknown" | "price-estimate" | "provider-reported";

export interface ConsolidationUsage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  // Provider-reported cache reads/writes stay separate from input so the host
  // can see what the prompt cache actually saved.
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  costUsd: number;
  costBasis: ConsolidationCostBasis;
  missing: string[];
}

export interface ConsolidationSeams {
  summarize: ConsolidateSummarizeFn;
  classify: (claim: string, evidence: ConsolidateEvidence[]) => ConsolidateClaimVerdict;
  // PROTOTYPE: real-model check used before a single contradicting material
  // replaces existing knowledge.
  verify: ConsolidateVerifyFn;
  usage: ConsolidationUsage;
}

export const CONSOLIDATION_SUMMARY_PROMPT = [
  "Summarize these episodic memories about the same entity into one short, factual paragraph.",
  "Only state facts directly supported by the episodes. No speculation.",
  // PROTOTYPE (preserve uncorrected facts): the UPDATE path appends the old
  // distilled claim as a CURRENT KNOWLEDGE item. It must survive unless a new
  // episode explicitly corrects the same fact.
  "If an item is titled CURRENT KNOWLEDGE, it is the existing distilled claim:",
  "keep every fact it states unless a new episode explicitly corrects that same fact.",
].join("\n");

const CORRECTION_CHECK_PROMPT = [
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
  "Decide two things:",
  "1. sameFact: does the new material assert a change to the SAME fact, subject and scope as",
  "   the current knowledge? A different subject, period, population, or special case",
  "   (for example holiday hours vs regular hours) is NOT the same fact.",
  "2. reliable: does the material itself confidently and specifically assert the change?",
  "   Hearsay, speculation, questions, anonymous forum guesses, or \"might be\" text is NOT",
  "   reliable enough to replace existing knowledge.",
  "",
  "Reply with JSON only:",
  '{"sameFact": true|false, "reliable": true|false, "reason": "<short reason>"}',
].join("\n");

type RawUsage = { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; totalTokens?: number; cost?: { total?: number } };

// One direct completion for the sentence-level summarizer. Usage comes from the
// provider's final message; a missing usage block stays missing and is reported.
async function completeText(
  session: Pick<LlmSession, "model" | "streamFn" | "apiKey">,
  prompt: string,
  signal?: AbortSignal,
): Promise<{ text: string; usage?: RawUsage }> {
  const stream = session.streamFn(
    session.model as any,
    { messages: [{ role: "user", content: prompt }] } as never,
    { ...(session.apiKey ? { apiKey: session.apiKey } : {}), ...(signal ? { signal } : {}) } as never,
  );
  let text = "";
  let usage: RawUsage | undefined;
  for await (const event of stream as AsyncIterable<any>) {
    if (event?.type === "text_delta" && typeof event.delta === "string") text += event.delta;
    else if (event?.type === "text" && typeof event.text === "string") text += event.text;
    else if (event?.type === "done" && event.message) {
      usage = event.message.usage;
      const blocks = Array.isArray(event.message.content) ? event.message.content : [];
      if (!text) for (const block of blocks) if (block?.type === "text" && typeof block.text === "string") text += block.text;
    }
  }
  return { text: text.trim(), usage };
}

function parseCheckReply(text: string): { sameFact: boolean; reliable: boolean; reason?: string } {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return { sameFact: false, reliable: false, reason: "checker returned no JSON" };
  try {
    const obj = JSON.parse(text.slice(start, end + 1)) as { sameFact?: unknown; reliable?: unknown; reason?: unknown };
    return {
      sameFact: obj.sameFact === true,
      reliable: obj.reliable === true,
      ...(typeof obj.reason === "string" ? { reason: obj.reason.slice(0, 240) } : {}),
    };
  } catch {
    return { sameFact: false, reliable: false, reason: "checker JSON unparseable" };
  }
}

/**
 * Build the summarize/classify/verify seams over one LLM session. The returned
 * `usage` object accumulates across every model call this seam performs.
 */
export function createConsolidationSeams(session: Pick<LlmSession, "model" | "streamFn" | "apiKey">): ConsolidationSeams {
  // A catalog model carries real per-token prices; a custom endpoint built by
  // createLlmSession carries an all-zero table because the operator did not
  // declare prices. Zero prices therefore mean "unknown", never "free".
  const costTable = (session.model as any)?.cost as Record<string, unknown> | undefined;
  const hasPrice = !!costTable && ["input", "output", "cacheRead", "cacheWrite"].some((k) => Number(costTable[k]) > 0);

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
  let cacheReported = false;
  let costReported = false;

  const account = (u: RawUsage | undefined): void => {
    usage.calls += 1;
    if (u) {
      usage.inputTokens += Number(u.input) || 0;
      usage.outputTokens += Number(u.output) || 0;
      usage.cacheReadTokens += Number(u.cacheRead) || 0;
      usage.cacheWriteTokens += Number(u.cacheWrite) || 0;
      usage.totalTokens += Number(u.totalTokens) || (Number(u.input) || 0) + (Number(u.output) || 0);
      usage.costUsd += Number(u.cost?.total) || 0;
      cacheReported = cacheReported || u.cacheRead !== undefined || u.cacheWrite !== undefined;
      costReported = costReported || u.cost !== undefined;
    }
    // A provider that returned text but no usage is reported, never billed as 0.
    if (!u && !usage.missing.includes("consolidation usage")) usage.missing.push("consolidation usage");
    if (u && !cacheReported && !usage.missing.includes("consolidation cache usage")) usage.missing.push("consolidation cache usage");
    if (!costReported) {
      usage.costBasis = "unknown";
      if (!usage.missing.includes("consolidation cost (price unknown)")) usage.missing.push("consolidation cost (price unknown)");
    } else if (hasPrice) {
      usage.costBasis = "price-estimate";
    } else {
      // Cost object exists but the price table is zero: still unknown, not free.
      usage.costBasis = "unknown";
      if (!usage.missing.includes("consolidation cost (price unknown)")) usage.missing.push("consolidation cost (price unknown)");
    }
  };

  const summarize: ConsolidateSummarizeFn = async (episodes) => {
    const prompt = [
      CONSOLIDATION_SUMMARY_PROMPT,
      ...episodes.map((e, i) => "[" + (i + 1) + "] " + e.title + " - " + e.snippet + " (" + e.url + ")"),
    ].join("\n");
    const result = await completeText(session, prompt);
    account(result.usage);
    return result.text || null;
  };

  const classify = (claim: string, evidence: ConsolidateEvidence[]): ConsolidateClaimVerdict => {
    const r = classifyClaim(claim, {
      retrievalResults: evidence.map((e) => ({ title: e.title, snippet: e.snippet, url: e.url }) as never),
    });
    return { label: r.label, confidence: r.confidence };
  };

  const verify: ConsolidateVerifyFn = async ({ oldContent, summary, evidence }) => {
    const prompt = CORRECTION_CHECK_PROMPT
      .replace("{OLD}", oldContent)
      .replace("{NEW}", summary)
      .replace("{EVIDENCE}", evidence.map((e, i) => "[" + (i + 1) + "] " + e.title + " - " + e.snippet + " (" + e.url + ")").join("\n"));
    const result = await completeText(session, prompt, AbortSignal.timeout(60_000));
    account(result.usage);
    return parseCheckReply(result.text);
  };

  return { summarize, classify, verify, usage };
}
