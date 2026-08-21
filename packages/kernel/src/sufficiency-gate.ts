// SufficiencyEvaluator: sibling module to MemoryPipeline.
// ADR-0015 D3: extracted from pi-runtime.ts shouldStopAfterTurn.
// ADR-0014 D2/D5/D1: Google SCA paradigm — gate outputs "what's missing" (named gap), not just boolean.
// D5: bounded reround — default 1, max via domain TOML.
// Independent fail-open, does not block MemoryPipeline.
// ADR-0016 D2/D4: evaluate() returns GateEnvelope (pure, no mutation).
//   applyTo() returns new messages array (pure reducer, LangGraph discipline).
//   Claim-ticket pattern: gate.evaluate -> gate.applyTo -> pipeline.consolidate.

import { computeSufficiency } from "./engine";
import type { RetrieverPort, DomainConfigPort } from "./ports";
import type { SufficiencySignal } from "@anysearch/retriever";

export interface SufficiencyEvaluatorDeps {
  retriever: RetrieverPort;
  domain: DomainConfigPort;
  streamFn: any;
  model: any;
  getApiKey?: () => Promise<string | undefined>;
}

// ADR-0016 D4: GateEnvelope — pure data returned by evaluate(), consumed by applyTo().
// Claim-ticket pattern: gate never touches messages array directly.
export interface GateEnvelope {
  enrichedEnvelope: any | null;       // merged search results (or null if no sufficiency work done)
  hasRetrievalEvidence: boolean;      // true if gate did re-search (signals pipeline to consolidate)
  targetMessageIndex: number;         // index of the tool_result message to update
}

export class SufficiencyEvaluator {
  private deps: SufficiencyEvaluatorDeps;

  constructor(deps: SufficiencyEvaluatorDeps) {
    this.deps = deps;
  }

  // evaluate: check sufficiency of last search result, generate named gap, re-search if needed.
  // ADR-0016 D2/D4: PURE — returns GateEnvelope, does NOT modify messages.
  // Best-effort, fail-open. Returns empty envelope if no work needed.
  async evaluate(messages: any[]): Promise<GateEnvelope> {
    const { domain, retriever, streamFn, model, getApiKey } = this.deps;

    const empty: GateEnvelope = { enrichedEnvelope: null, hasRetrievalEvidence: false, targetMessageIndex: -1 };

    // D6: sufficiencyMaxRerounds from domain config.
    const maxRerounds = (domain as any).compaction?.sufficiencyMaxRerounds ?? 1;
    if (maxRerounds <= 0) return empty;

    // Find last tool_result that contains envelope with sufficiency (top-level or metadata).
    let targetIndex = -1;
    let lastSearchResult: any = null;
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role === "user" && Array.isArray(m.content) &&
          m.content.some((c: any) => c.type === "tool_result" && c.content?.[0]?.text?.includes("sufficiency"))) {
        targetIndex = i;
        lastSearchResult = m;
        break;
      }
    }
    if (targetIndex < 0 || !lastSearchResult) return empty;

    try {
      const toolResultContent = lastSearchResult.content.find((c: any) => c.type === "tool_result");
      const envelopeJson = toolResultContent?.content?.[0]?.text;
      if (!envelopeJson) return empty;

      const envelope = JSON.parse(envelopeJson);
      const suff = (envelope?.metadata?.sufficiency ?? envelope?.sufficiency) as SufficiencySignal | undefined;
      if (!suff || suff.verdict === "correct") return empty;

      // D1: LLM generates named gap — "what's missing" from the search results.
      const gapPrompt = [
        { role: "system" as const, content: "You are a search sufficiency evaluator. Given the search query and results, identify what information is missing. Respond with a single rewritten search query that targets the gap. Respond with ONLY the query, no explanation." },
        { role: "user" as const, content: "Original query: " + (envelope.query || envelope._query || "") + "\n\nResults: " + (envelope.results || []).slice(0, 5).map((r: any) => r.title + ": " + (r.snippet || "").slice(0, 200)).join("\n") + "\n\nSufficiency verdict: " + suff.verdict + "\n\nWhat is missing? Write a single search query to fill the gap:" },
      ];

      if (!streamFn || !model) return empty;

      let gapQuery = "";
      const apiKey = await getApiKey?.();
      const stream = streamFn({
        model: model,
        messages: gapPrompt,
        thinkingLevel: "off",
      }, { apiKey });
      for await (const chunk of stream) {
        if (chunk?.type === "text" && chunk.text) gapQuery += chunk.text;
        else if (chunk?.delta) gapQuery += chunk.delta;
      }
      gapQuery = gapQuery.trim().replace(/^["']|["']$/g, "");
      if (gapQuery.length <= 3) return empty;

      // D5: bounded re-search loop.
      for (let round = 0; round < maxRerounds; round++) {
        const reroundEnvelope = await retriever.search({ query: gapQuery, mode: "fast" });
        // Merge results: append new unique URLs.
        const seenUrls = new Set((envelope.results || []).map((r: any) => r.url));
        const newResults = (reroundEnvelope.results || []).filter((r: any) => !seenUrls.has(r.url));
        if (newResults.length === 0) break; // no new info, stop.
        envelope.results = [...(envelope.results || []), ...newResults];
        // Re-check sufficiency on merged results.
        const reroundSuff = computeSufficiency(
          envelope.results, [], // ponytail: reround re-check — real per-provider lists unavailable in tool_result JSON; agreement stays 0 (honest, not fabricated)
          { minProviders: 1, minResults: 3, minDomains: 2, crossEngineVerify: false }
        );
        if (reroundSuff.mvs.verdict === "correct") break;
      }
      // Annotate: mark that sufficiency gate ran.
      envelope.sufficiencyRerounds = true;

      return {
        enrichedEnvelope: envelope,
        hasRetrievalEvidence: true,
        targetMessageIndex: targetIndex,
      };
    } catch {
      return empty; // ponytail: sufficiency gate is best-effort, fail-open.
    }
  }

  // applyTo: inject enriched results back into messages.
  // ADR-0016 D4: PURE — returns NEW messages array, does NOT mutate input (LangGraph reducer discipline).
  // atomcode research: LangGraph prohibits direct state mutation; applyTo is a pure reducer.
  applyTo(messages: any[], envelope: GateEnvelope): any[] {
    if (envelope.enrichedEnvelope === null || envelope.targetMessageIndex < 0) return messages;
    if (envelope.targetMessageIndex >= messages.length) return messages;

    const target = messages[envelope.targetMessageIndex];
    const toolResultContent = target.content?.find((c: any) => c.type === "tool_result");
    if (!toolResultContent) return messages;

    // Create new messages array with updated envelope at target index.
    const updatedTarget = {
      ...target,
      content: target.content.map((c: any) =>
        c === toolResultContent
          ? { ...c, content: [{ type: "text", text: JSON.stringify(envelope.enrichedEnvelope, null, 2) }] }
          : c
      ),
    };

    return messages.map((m, i) => i === envelope.targetMessageIndex ? updatedTarget : m);
  }
}
