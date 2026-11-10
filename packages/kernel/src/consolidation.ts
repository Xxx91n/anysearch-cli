// Shared consolidation seams. The CLI (`ans consolidate`) and the MCP tool
// (`ans_chat` with operation=consolidate) both build the summarize + fidelity
// gate functions here, so the two entry points cannot drift apart.

import type { ConsolidateClaimVerdict, ConsolidateEvidence, ConsolidateSummarizeFn } from "@anysearch-cli/store";
import { classifyClaim } from "./attribution";
import type { LlmSession } from "./llm-init";

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
  missing: string[];
}

export interface ConsolidationSeams {
  summarize: ConsolidateSummarizeFn;
  classify: (claim: string, evidence: ConsolidateEvidence[]) => ConsolidateClaimVerdict;
  usage: ConsolidationUsage;
}

export const CONSOLIDATION_SUMMARY_PROMPT = [
  "Summarize these episodic memories about the same entity into one short, factual paragraph.",
  "Only state facts directly supported by the episodes. No speculation.",
].join("\n");

// One direct completion for the sentence-level summarizer. Usage comes from the
// provider's final message; a missing usage block stays missing and is reported.
async function completeText(
  session: Pick<LlmSession, "model" | "streamFn" | "apiKey">,
  prompt: string,
  signal?: AbortSignal,
): Promise<{ text: string; usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; totalTokens?: number; cost?: { total?: number } } }> {
  const stream = session.streamFn(
    session.model as any,
    { messages: [{ role: "user", content: prompt }] } as never,
    { ...(session.apiKey ? { apiKey: session.apiKey } : {}), ...(signal ? { signal } : {}) } as never,
  );
  let text = "";
  let usage: any;
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

/**
 * Build the summarize/classify seams over one LLM session. The returned
 * `usage` object accumulates across every summary this seam performs.
 */
export function createConsolidationSeams(session: Pick<LlmSession, "model" | "streamFn" | "apiKey">): ConsolidationSeams {
  const usage: ConsolidationUsage = {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    costUsd: 0,
    missing: [],
  };
  let cacheReported = false;
  let costReported = false;

  const summarize: ConsolidateSummarizeFn = async (episodes) => {
    const prompt = [
      CONSOLIDATION_SUMMARY_PROMPT,
      ...episodes.map((e, i) => "[" + (i + 1) + "] " + e.title + " - " + e.snippet + " (" + e.url + ")"),
    ].join("\n");
    const result = await completeText(session, prompt);
    const u = result.usage;
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
    if (u && !costReported && !usage.missing.includes("consolidation cost")) usage.missing.push("consolidation cost");
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
