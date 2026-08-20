// SufficiencyEvaluator: sibling module to MemoryPipeline.
// ADR-0015 D3: extracted from pi-runtime.ts shouldStopAfterTurn.
// ADR-0014 D2/D5/D1: Google SCA paradigm — gate outputs "what's missing" (named gap), not just boolean.
// D5: bounded reround — default 1, max via domain TOML.
// Independent fail-open, does not block MemoryPipeline.
// TEMPORAL COUPLING: evaluate() modifies messages in-place (enriches tool_result with merged results).
// MemoryPipeline.consolidate() reads the same messages array for gap distillation AFTER evaluate().
// Order MUST be gate.evaluate() -> pipeline.consolidate(). Reversing breaks gap distillation content.

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

export class SufficiencyEvaluator {
  private deps: SufficiencyEvaluatorDeps;

  constructor(deps: SufficiencyEvaluatorDeps) {
    this.deps = deps;
  }

  // evaluate: check sufficiency of last search result, generate named gap, re-search if needed.
  // Modifies messages in-place (enriches tool_result with merged results).
  // Returns void — best-effort, fail-open.
  async evaluate(messages: any[]): Promise<void> {
    const { domain, retriever, streamFn, model, getApiKey } = this.deps;

    // D6: sufficiencyMaxRerounds from domain config.
    const maxRerounds = (domain as any).compaction?.sufficiencyMaxRerounds ?? 1;
    if (maxRerounds <= 0) return;

    // Find last tool_result that contains envelope with sufficiency (top-level or metadata).
    const lastSearchResult = [...messages].reverse().find((m: any) =>
      m.role === "user" && Array.isArray(m.content) &&
      m.content.some((c: any) => c.type === "tool_result" && c.content?.[0]?.text?.includes("sufficiency"))
    );
    if (!lastSearchResult) return;

    try {
      const toolResultContent = lastSearchResult.content.find((c: any) => c.type === "tool_result");
      const envelopeJson = toolResultContent?.content?.[0]?.text;
      if (!envelopeJson) return;

      const envelope = JSON.parse(envelopeJson);
      const suff = (envelope?.metadata?.sufficiency ?? envelope?.sufficiency) as SufficiencySignal | undefined;
      if (!suff || suff.verdict === "correct") return;

      // D1: LLM generates named gap — "what's missing" from the search results.
      const gapPrompt = [
        { role: "system" as const, content: "You are a search sufficiency evaluator. Given the search query and results, identify what information is missing. Respond with a single rewritten search query that targets the gap. Respond with ONLY the query, no explanation." },
        { role: "user" as const, content: "Original query: " + (envelope.query || envelope._query || "") + "\n\nResults: " + (envelope.results || []).slice(0, 5).map((r: any) => r.title + ": " + (r.snippet || "").slice(0, 200)).join("\n") + "\n\nSufficiency verdict: " + suff.verdict + "\n\nWhat is missing? Write a single search query to fill the gap:" },
      ];

      if (!streamFn || !model) return;

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
      if (gapQuery.length <= 3) return;

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
        // Generate next gap query from merged results.
        // ponytail: single reround is default; multi-round uses same gap.
      }
      // Annotate: mark that sufficiency gate ran.
      envelope.sufficiencyRerounds = true;
      // Update the tool_result in-place so LLM sees enriched results.
      toolResultContent.content[0].text = JSON.stringify(envelope, null, 2);
    } catch {} // ponytail: sufficiency gate is best-effort, fail-open.
  }
}