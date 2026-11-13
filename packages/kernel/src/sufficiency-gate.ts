// SufficiencyEvaluator: sibling module to MemoryPipeline.
// extracted from pi-runtime.ts shouldStopAfterTurn.
// Google SCA paradigm — gate outputs "what's missing" (named gap), not just boolean.
// D5: bounded reround — default 1, max via domain TOML.
// Independent fail-open, does not block MemoryPipeline.
// evaluate returns GateEnvelope (pure, no mutation).
// applyTo() returns new messages array (pure reducer, LangGraph discipline).
// Claim-ticket pattern: gate.evaluate -> gate.applyTo -> pipeline.consolidate.

import { computeSufficiency } from "./engine";
import type { RetrieverPort, DomainConfigPort } from "./ports";
import { assertJudgmentInput, unwrapRetrieved, type SufficiencySignal, type GapRequest } from "@anysearch-cli/retriever";

export interface SufficiencyEvaluatorDeps {
  retriever: RetrieverPort;
  domain: DomainConfigPort;
  streamFn: any;
  model: any;
  getApiKey?: () => Promise<string | undefined>;
  // #259: the same archive writer the search tool uses. The gate's reround is a
  // real internal search whose results reach the next provider request, so they
  // must be indexed too — otherwise material the model just used is missing from
  // the shared archive the next session recalls from. Absent = no indexing.
  //
  // Takes the NEW results only: `evaluate` runs once per turn and the outer
  // tool result was already archived by the search tool itself. Re-archiving the
  // whole merged set would write a replacement row for every URL and close its
  // live predecessor, churning the history the ticket says to leave alone.
  //
  // `signal` is the scope the CALLER captured for this evaluation, passed through
  // so the guard cannot re-read a mutable runtime field: reading `activeRunSignal`
  // at write time would see `undefined` after an abort cleared it, and the write
  // would go through.
  archive?: (results: unknown[], signal?: AbortSignal) => Promise<void>;
  // #259: this run's cancellation scope (caller abort PLUS the runtime's own
  // stop, e.g. a consumer closing the stream). The reround uses it twice: to stop
  // searching, and as the archive write's guard. Without it a closed consumer
  // leaves a reround running, and its results could then supersede live rows in
  // a database other sessions read.
  signal?: AbortSignal;
}

// GateEnvelope — pure data returned by evaluate, consumed by applyTo.
// Claim-ticket pattern: gate never touches messages array directly.
export interface GateEnvelope {
  // GapRequest trigger sources from attribution layer.
  // Each gap.query is fed into the bounded reround loop.
  gapRequests?: GapRequest[];
  enrichedEnvelope: any | null;       // merged search results (or null if no sufficiency work done)
  hasRetrievalEvidence: boolean;      // true if gate did re-search (signals pipeline to consolidate)
  targetMessageIndex: number;         // index of the tool_result message to update
}

/**
 * Text of a tool-result message in either supported transcript shape:
 * pi-agent-core 1.5.1's standalone `toolResult` message, or the legacy `user`
 * message holding a `tool_result` content block.
 */
export function toolResultText(message: any): string | undefined {
  if (!message) return undefined;
  if (message.role === "toolResult") {
    const blocks: any[] = Array.isArray(message.content) ? message.content : [];
    const text = blocks.map((c: any) => (typeof c?.text === "string" ? c.text : "")).join("");
    return text || undefined;
  }
  if (message.role === "user" && Array.isArray(message.content)) {
    const block = message.content.find((c: any) => c?.type === "tool_result");
    const text = block?.content?.[0]?.text;
    return typeof text === "string" && text ? text : undefined;
  }
  return undefined;
}

export class SufficiencyEvaluator {
  private deps: SufficiencyEvaluatorDeps;

  constructor(deps: SufficiencyEvaluatorDeps) {
    this.deps = deps;
  }

  // evaluate: check sufficiency of last search result, generate named gap, re-search if needed.
  // PURE — returns GateEnvelope, does NOT modify messages.
  // Best-effort, fail-open. Returns empty envelope if no work needed.
  async evaluate(messages: any[], signal?: AbortSignal): Promise<GateEnvelope> {
    const { domain, retriever, streamFn, model, getApiKey } = this.deps;
    // #259: one cancellation scope for the whole evaluation — the run's own, or
    // the one handed in. A stop means this turn is over, so the reround must not
    // keep searching and must not archive.
    const scope = signal ?? this.deps.signal;

    const empty: GateEnvelope = { enrichedEnvelope: null, hasRetrievalEvidence: false, targetMessageIndex: -1, gapRequests: [] };

    // D6: sufficiencyMaxRerounds from domain config.
    const maxRerounds = (domain as any).compaction?.sufficiencyMaxRerounds ?? 1;
    if (maxRerounds <= 0) return empty;

    // Find the last tool result that carries a fused envelope. pi-agent-core
    // 1.5.1 emits a standalone toolResult message; older shapes wrapped the
    // text in a user message's tool_result block.
    let targetIndex = -1;
    let envelopeJson: string | undefined;
    for (let i = messages.length - 1; i >= 0; i--) {
      const text = toolResultText(messages[i]);
      if (!text || !text.includes("sufficiency")) continue;
      targetIndex = i;
      envelopeJson = text;
      break;
    }
    if (targetIndex < 0 || !envelopeJson) return empty;

    try {
      const parsedEnvelope = JSON.parse(envelopeJson);
      const envelope = unwrapRetrieved(parsedEnvelope) ?? parsedEnvelope;
      // extract GapRequests from attribution for GateEnvelope.
    const gapRequests = envelope?.attribution?.gaps ?? [];
    const suff = (envelope?.metadata?.sufficiency ?? envelope?.sufficiency) as SufficiencySignal | undefined;
      if (!suff || suff.verdict === "correct") return empty;

      // D1: LLM generates named gap — "what's missing" from the search results.
      const gapPrompt = [
        { role: "system" as const, content: "You are a search sufficiency evaluator. Given the search query and results, identify what information is missing. Respond with a single rewritten search query that targets the gap. Respond with ONLY the query, no explanation." },
        { role: "user" as const, content: "Original query: " + (envelope.query || envelope._query || "") + "\n\nResults: " + (envelope.results || []).slice(0, 5).map((r: any) => r.title + ": " + (r.snippet || "").slice(0, 200)).join("\n") + "\n\nSufficiency verdict: " + suff.verdict + "\n\nWhat is missing? Write a single search query to fill the gap:" },
      ];

      if (!streamFn || !model) return empty;

      // judgment-input assertion boundary 4/5 — sufficiency judge pre-call.
      assertJudgmentInput(
        {
          text: gapPrompt[1]!.content,
          source: "retrieved",
          traceId: (envelope.results?.[0] as any)?.label?.traceId ?? "sufficiency-gap",
        },
        "sufficiency-judge",
      );

      let gapQuery = "";
      const apiKey = await getApiKey?.();
      // 1.5.1 stream contract: streamFn(model, context, options). The old
      // 0.84.2 shape passed a single {model, messages} object.
      const stream = streamFn(model, { messages: gapPrompt }, { apiKey });
      for await (const chunk of stream) {
        if (chunk?.type === "text_delta" && typeof chunk.delta === "string") gapQuery += chunk.delta;
        else if (chunk?.type === "text" && chunk.text) gapQuery += chunk.text;
        else if (chunk?.delta) gapQuery += chunk.delta;
      }
      gapQuery = gapQuery.trim().replace(/^["']|["']$/g, "");
      if (gapQuery.length <= 3) return empty;

      // assertion-level GapRequest is the preferred reround seed.
      // When the attribution layer produced gaps, the first gapQuery takes precedence over
      // the LLM gap query (previous code extracted gaps but never used them).
      if (gapRequests[0]?.gapQuery) gapQuery = gapRequests[0].gapQuery;
      // D5: bounded re-search loop.
      for (let round = 0; round < maxRerounds; round++) {
        // #259: a stopped run searches no further and archives nothing.
        if (scope?.aborted) return empty;
        const reroundEnvelope = await retriever.search({
          query: gapQuery,
          mode: "fast",
          ...(scope ? { signal: scope } : {}),
        });
        // #259: check AGAIN after the search returns. A stop that landed while
        // the search was in flight must not be followed by a write — this is the
        // check that covers it, not the one above.
        if (scope?.aborted) return empty;
        // Merge results: append new unique URLs.
        const seenUrls = new Set((envelope.results || []).map((r: any) => r.url));
        const newResults = (reroundEnvelope.results || []).filter((r: any) => !seenUrls.has(r.url));
        if (newResults.length === 0) break; // no new info, stop.
        // #259: archive the reround's FRESH results only. They are about to
        // reach the next provider request, so a later session must be able to
        // recall the same material. The writer is fail-open itself, so no
        // second guard is spelled here — one fail-open rule per helper keeps the
        // two internal search paths from drifting apart. The scope is passed
        // through explicitly: re-reading a mutable runtime field at write time
        // would come back `undefined` once an abort cleared it.
        if (this.deps.archive) await this.deps.archive(newResults, scope);
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
        gapRequests,
      };
    } catch {
      return empty; // ponytail: sufficiency gate is best-effort, fail-open.
    }
  }

  // applyTo: inject enriched results back into messages.
  // PURE — returns NEW messages array, does NOT mutate input (LangGraph reducer discipline).
  // atomcode research: LangGraph prohibits direct state mutation; applyTo is a pure reducer.
  applyTo(messages: any[], envelope: GateEnvelope): any[] {
    if (envelope.enrichedEnvelope === null || envelope.targetMessageIndex < 0) return messages;
    if (envelope.targetMessageIndex >= messages.length) return messages;

    const target = messages[envelope.targetMessageIndex];
    const replacement = JSON.stringify(envelope.enrichedEnvelope, null, 2);

    // 1.5.1: tool results are standalone messages whose text blocks carry the
    // envelope. Replace the text channel in place, keeping the tool identity.
    if (target?.role === "toolResult" && Array.isArray(target.content)) {
      return messages.map((m, i) => i === envelope.targetMessageIndex
        ? { ...target, content: target.content.map((c: any) => (c?.type === "text" ? { ...c, text: replacement } : c)) }
        : m);
    }

    // Legacy shape: a user message holding a tool_result block.
    const toolResultContent = target.content?.find((c: any) => c.type === "tool_result");
    if (!toolResultContent) return messages;

    // Create new messages array with updated envelope at target index.
    const updatedTarget = {
      gapRequests: (envelope.gapRequests ?? []) as GapRequest[], //
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
