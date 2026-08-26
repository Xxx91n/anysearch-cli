// MemoryPipeline: deep module for L0/L1/L2 memory pipeline logic.
// ADR-0015 D1/D2: extracted from pi-runtime.ts shouldStopAfterTurn + transformContext.
// Interface: attach (init) / inject (hot read) / consolidate (cold write).
// Domain-semantic naming — interface does not leak host hook details.
// ADR-0016 D2/D3/D5/D6/D7/D8: pure function-ization + ConsolidationState + shell wrapper.
//   consolidate() is now a shell that calls pure consolidateState() then executes I/O.
//   signalSearchTurn() DELETED — replaced by hasRetrievalEvidence parameter.

import { generateSummaryWithUsage } from "@earendil-works/pi-agent-core";
// ADR-0012 D4: reuse summary engine only, NOT compact() window management.
// Own constant so upstream window-management namespace changes cannot break L0.
const COMPACTION_RESERVE_TOKENS = 16_384;
import { IR_CUSTOM_INSTRUCTIONS } from "./ir-schema";
import type { RetrieverPort, SessionStorePort, DomainConfigPort } from "./ports";
import type { GateEnvelope } from "./sufficiency-gate";
import { rewriteQuery, classifyQdf } from "./query-rewrite";
import type { LlmRewriteFn } from "./query-rewrite";

export interface MemoryPipelineDeps {
  store: SessionStorePort;
  models?: any;       // ADR-0012 D4: Models object for generateSummaryWithUsage
  retriever: RetrieverPort;
  domain: DomainConfigPort;
  model: any;         // pi-ai Model instance
  streamFn: any;      // models.streamSimple.bind(models)
  sessionId: string;
  getApiKey?: () => Promise<string | undefined> | undefined;
  providerName?: string;
  // ADR-0023 D2: S1 LLM rewrite seam. When omitted, L2 recall degrades to single-query mode (fail-open).
  llmRewriteFn?: LlmRewriteFn;
}

// ADR-0016 D5: ConsolidationState — pure, serializable type for MCP stateless mode.
// version field serves as CAS guard for saveAnchor UPSERT (fast.io optimistic locking).
export interface ConsolidationState {
  version: number;
  consecutiveReuses: number;
  lastSummaryMsgCount: number;
}

// ADR-0016 D8: ConsolidateResult — pure function output (decision + optional summaryRequest).
export interface ConsolidateResult {
  state: ConsolidationState;
  decision: "skip" | "reuse" | "compress";
  summaryRequest?: {
    gap: string;
    prevSummary: string | undefined;
    msgCountAtTrigger: number;
  };
}

// ADR-0013 D9: Gap distillation — extract search tool results from messages after last summary point.
export function distillGap(messages: any[], fromIdx: number): string {
  const gap = messages.slice(fromIdx);
  const results: string[] = [];
  for (const msg of gap) {
    if (msg.role !== "tool") continue;
    const toolName = msg.toolName || msg.name || "";
    if (typeof toolName !== "string" || !toolName.includes("search")) continue;
    const content = typeof msg.content === "string"
      ? msg.content
      : Array.isArray(msg.content)
        ? msg.content.map((c: any) => c?.text || "").join("")
        : JSON.stringify(msg.content || "");
    if (content) results.push(content);
  }
  return results.join("\n\n").slice(0, 4000);
}

// ADR-0013 D1/D3/D6: NOOP adjudication — LLM decides REUSE vs COMPRESS.
export async function adjudicateReuseCompress(
  streamFn: any,
  model: any,
  gapDistillation: string,
  existingSummary: string | undefined,
): Promise<"reuse" | "compress"> {
  const prompt = [
    "You are a memory adjudicator for a research agent.",
    "Decide if the new search results are already fully covered by the existing IR summary.",
    "",
    "IR Summary has 5 sections: Verified Evidence, Open Hypotheses, Rejected Sources, Key Numbers & Sources, Tool Calls & Read Status.",
    "Check each section: is the new information already present?",
    "",
    "If ALL new information is already covered -> respond: reuse",
    "If ANY new information is NOT covered -> respond: compress",
    "",
    "=== Existing IR Summary ===",
    existingSummary || "(empty - no prior summary)",
    "",
    "=== New Search Results (gap) ===",
    gapDistillation || "(no new results)",
  ].join("\n");

  const context = {
    systemPrompt: prompt,
    messages: [{ role: "user", content: "Respond with exactly 'reuse' or 'compress'." }],
  };

  let text = "";
  try {
    const stream = streamFn(model, context, {});
    for await (const event of stream) {
      if (event?.type === "text" && event.text) text += event.text;
    }
  } catch {
    return "compress"; // D10: fail-open.
  }

  const lower = text.toLowerCase().trim();
  if (lower.includes("reuse")) return "reuse";
  return "compress"; // D10: unparseable -> COMPRESS.
}

// ADR-0016 D5/D8: PURE consolidateState function — zero I/O, zero side effects.
// Returns decision + optional summaryRequest. Shell executes LLM + persistence.
// ADR-0021 D2: options injectable; defaults 128000 / 3 preserve zero-behavior-change.
export interface ConsolidateOpts {
  lowWatermark?: number;
  reuseCap?: number;
}

export function consolidateState(
  state: ConsolidationState,
  messages: any[],
  totalTokens: number,
  hasRetrievalEvidence: boolean,
  opts?: ConsolidateOpts,
): ConsolidateResult {
  const LOW_WATERMARK_TOKENS = opts?.lowWatermark ?? 128000;
  const REUSE_CAP = opts?.reuseCap ?? 3;
  const msgCountAtTrigger = messages.length; // local const for race-safe gap anchor update.

  const triggerLowWatermark = totalTokens > LOW_WATERMARK_TOKENS;
  const triggerPostSearch = hasRetrievalEvidence && messages.length > 4;

  if (!triggerLowWatermark && !triggerPostSearch) {
    return { state, decision: "skip" };
  }

  // D8: consecutive REUSE cap forces COMPRESS.
  const reuseCapped = state.consecutiveReuses >= REUSE_CAP;
  const shouldAdjudicate = triggerPostSearch && !triggerLowWatermark;
  const needsAdjudication = shouldAdjudicate && !reuseCapped;

  if (needsAdjudication) {
    // Adjudication path: return reuse decision (shell will call adjudicateRetryCompress).
    // If adjudication says compress, shell calls fireCompress.
    // For pure function: return "reuse" with summaryRequest for shell to adjudicate.
    // ponytail: adjudication is async I/O (LLM call) so it stays in shell.
    // Pure function returns the pre-adjudication state; shell handles the LLM call.
    return {
      state: { ...state, consecutiveReuses: state.consecutiveReuses + 1 },
      decision: "reuse", // tentative — shell may override to compress after adjudication
      summaryRequest: {
        gap: distillGap(messages, state.lastSummaryMsgCount),
        prevSummary: undefined, // shell fills from anchor
        msgCountAtTrigger,
      },
    };
  }

  // Direct compress path (low watermark or reuse-capped).
  return {
    state: { version: state.version, consecutiveReuses: 0, lastSummaryMsgCount: msgCountAtTrigger },
    decision: "compress",
    summaryRequest: {
      gap: distillGap(messages, state.lastSummaryMsgCount),
      prevSummary: undefined, // shell fills from anchor
      msgCountAtTrigger,
    },
  };
}

export class MemoryPipeline {
  private deps: MemoryPipelineDeps;

  // ADR-0016 D5/D7: ConsolidationState — in-memory cache (CLI fast path).
  // MCP mode restores from anchor per call (saveAnchor persistence).
  private consolidationState: ConsolidationState = {
    version: 1,
    consecutiveReuses: 0,
    lastSummaryMsgCount: 0,
  };

  constructor(deps: MemoryPipelineDeps) {
    this.deps = deps;
  }

  // inject: hot path read — corresponds to transformContext delegation.
  // RAG injection + L1/L2 merged injection at latest user message (attention hot zone).
  async inject(messages: any[]): Promise<any[]> {
    const { store, domain, sessionId } = this.deps;
    let result = messages;

    // Stage 1: RAG injection — prepend RAG context note to first user message.
    // ADR-0026 D7: injections target USER messages; a leading system/tool message must not swallow them.
    const firstUserIdx = result.findIndex((m: any) => m?.role === "user");
    if (domain.rag.adapter && domain.rag.config?.note && firstUserIdx >= 0) {
      const first = result[firstUserIdx];
      result = [
        ...result.slice(0, firstUserIdx),
        { ...first, content: (typeof first.content === "string" ? first.content : "") + "\n\n[RAG Context] " + domain.rag.config.note },
        ...result.slice(firstUserIdx + 1),
      ];
    }

    // ADR-0024 D5: T0 user preferences injection — same Stage-1 slot, identical content/order.
    // Idempotent: skip if first message already carries a <user_preferences> block
    // (transformContext may be invoked more than once on retry/resume).
    try {
      if (firstUserIdx >= 0) {
        const first = result[firstUserIdx] as any;
        const firstContent: string = typeof first.content === "string" ? first.content : "";
        if (!firstContent.includes("<user_preferences")) {
          const prefs = await store.listPreferences(process.cwd());
          if (prefs.length > 0) {
            const lines = prefs.map(r => "- **" + r.key + "**: " + r.value);
            const block = "<user_preferences updated=\"" + (prefs[0].modified ?? "") + "\">\n" + lines.join("\n") + "\n</user_preferences>";
            result = [...result.slice(0, firstUserIdx), { ...first, content: block + "\n\n" + firstContent }, ...result.slice(firstUserIdx + 1)];
          }
        }
      }
    } catch {}

    // ADR-0012 D8/D9/D12: L1+L2 merged injection at latest user message (hot zone).
    try {
      const anchors = await store.getAnchors(sessionId);
      const summaryAnchors = anchors.filter(a => a.anchorType === "rolling_summary");
      const summaryAnchor = summaryAnchors[summaryAnchors.length - 1];
      const recallAnchors = anchors.filter(a => a.anchorType === "l2_recall");
      const recallAnchor = recallAnchors[recallAnchors.length - 1];

      const injections: string[] = [];
      if ((summaryAnchor?.payload as any)?.summary) {
        injections.push("[Session Memory] " + String((summaryAnchor.payload as any).summary).slice(0, 4000));
      }
      if ((recallAnchor?.payload as any)?.hits) {
        injections.push("[Research Recall] " + String((recallAnchor.payload as any).hits).slice(0, 1500));
      }

      // ADR-0026 D7: latest USER message, not blindly the last array element.
      let lastIdx = -1;
      for (let i = result.length - 1; i >= 0; i--) if (result[i]?.role === "user") { lastIdx = i; break; }
      if (injections.length > 0 && lastIdx >= 0) {
        const last = result[lastIdx];
        result = [
          ...result.slice(0, lastIdx),
          { ...last, content: (typeof last.content === "string" ? last.content : "") + "\n\n" + injections.join("\n\n") },
          ...result.slice(lastIdx + 1),
        ];
      }
    } catch {}

    return result;
  }

  // ADR-0016 D6/D8: consolidate — shell layer wrapping pure consolidateState().
  // Fire-and-forget, fail-open. Executes LLM I/O + persistence based on pure decision.
  async consolidate(messages: any[], totalTokens: number, hasRetrievalEvidence: boolean): Promise<void> {
    const { store, domain, model, models, streamFn, sessionId, retriever, providerName, getApiKey } = this.deps;

    if (!store || !sessionId) return;

    try {
      // D7: Restore state from anchor for MCP stateless mode (fail-open fallback to in-memory).
      let state = this.consolidationState;
      try {
        const anchors = await store.getAnchors(sessionId);
        const stateAnchors = anchors.filter(a => a.anchorType === "consolidation_state");
        const stateAnchor = stateAnchors[stateAnchors.length - 1];
        if (stateAnchor?.payload) {
          state = stateAnchor.payload as ConsolidationState;
          this.consolidationState = state; // update in-memory cache
        }
      } catch {}

      // D8: Call pure function for decision; inject compaction opts (ADR-0021 D2).
      // ADR-0021 D1: fail-fast on unsupported {fraction} shape — silent fallback to
      // default 128000 would violate the "不静默回退" principle stated in the ADR.
      // Once model window probing lands (ADR-0022 scope), wire fraction → tokens here.
      const compactionCfg = domain.compaction;
      const lw = compactionCfg?.lowWatermark;
      let resolvedLowWatermark: number | undefined;
      if (lw !== undefined) {
        if (typeof lw === "number") {
          resolvedLowWatermark = lw;
        } else {
          throw new Error(
            "MemoryPipeline: compaction.lowWatermark as {fraction} is not yet wired " +
            "(needs model context-window lookup). Use absolute token count " +
            "e.g. lowWatermark = 128000. See ADR-0021 D1 + ADR-0022."
          );
        }
      }
      const result = consolidateState(state, messages, totalTokens, hasRetrievalEvidence, {
        lowWatermark: resolvedLowWatermark,
        reuseCap: compactionCfg?.reuseCap,
      });

      if (result.decision === "skip") return;

      // Shell: execute I/O based on pure decision.
      const modelsObj = models;
      const summaryModel = (domain as any).compaction?.model
        ? (modelsObj?.getModel ? modelsObj.getModel(providerName || "openai", (domain as any).compaction.model) : undefined)
        : (model as any);
      const actualModel = summaryModel || (model as any);

      // Get previous summary from anchor (shell I/O).
      const prevAnchors = await store.getAnchors(sessionId);
      const prevSummaryAnchors = prevAnchors.filter(a => a.anchorType === "rolling_summary");
      const prevSummaryAnchor = prevSummaryAnchors[prevSummaryAnchors.length - 1];
      const previousSummary = (prevSummaryAnchor?.payload as any)?.summary as string | undefined;

      // D5: fire-and-forget compression helper.
      const fireCompress = () => {
        if (modelsObj && actualModel) {
          this.consolidationState = {
            version: result.state.version,
            consecutiveReuses: 0,
            lastSummaryMsgCount: result.summaryRequest?.msgCountAtTrigger || messages.length,
          };
          generateSummaryWithUsage(
            messages, modelsObj, actualModel,
            COMPACTION_RESERVE_TOKENS,
            undefined,
            IR_CUSTOM_INSTRUCTIONS,
            previousSummary,
            "off",
          ).then((summaryResult: any) => {
            if (summaryResult?.ok && summaryResult.value?.text) {
              store!.saveAnchor(sessionId!, "rolling_summary", {
                summary: summaryResult.value.text,
                tokenWatermark: totalTokens,
                timestamp: Date.now(),
              }).catch(() => {});
            }
          }).catch((e: any) => {
            if (typeof process !== "undefined" && process.stderr) {
              process.stderr.write("[anysearch] L0 compression warning: " + (e instanceof Error ? e.message : String(e)) + "\n");
            }
          });
        }
      };

      if (result.decision === "compress") {
        fireCompress();
      } else if (result.decision === "reuse") {
        // Adjudication: fire-and-forget LLM call to decide reuse vs compress.
        const gapDistillation = result.summaryRequest?.gap || "";
        adjudicateReuseCompress(streamFn, actualModel, gapDistillation, previousSummary)
          .then((adjDecision: "reuse" | "compress") => {
            if (adjDecision === "compress") {
              fireCompress();
            } else {
              // Keep the incremented consecutiveReuses from pure function result.
              this.consolidationState = result.state;
            }
          })
          .catch(() => fireCompress());
      }

      // D7: Persist consolidation state to anchor (UPSERT in saveAnchor).
      this.consolidationState = result.state;
      try {
        await store.saveAnchor(sessionId, "consolidation_state", result.state);
      } catch {}

      // ADR-0012 D10: L2 cold path — FTS5 recall.
      const lastToolCall = [...messages].reverse().find((m: any) =>
        m.role === "assistant" && Array.isArray(m.content) &&
        m.content.some((c: any) => c.type === "tool_use" && typeof c.name === "string" && c.name.includes("search"))
      );
      const searchToolInput = lastToolCall?.content?.find((c: any) => c.type === "tool_use" && c.name?.includes("search"))?.input;
      const l2Query = searchToolInput?.query || "";
      if (typeof l2Query === "string" && l2Query.length > 3) {
        // ADR-0023 D2 (Q2=B): S1 rewrite + RRF fusion. Fail-open via rewriteQuery when no LLM seam.
        // QDF hint uses heuristic classifiers from @anysearch/store (no LLM call needed to tag).
        const qdf = classifyQdf(l2Query, {
          isTimeSensitive: (q) => /最新|最近|news|2024|2025|2026|latest|recent|新闻|更新/i.test(q),
          isEvergreen: (q) => /什么是|定义|概念|原理|解释|how does|what is|explain/i.test(q),
        });
        rewriteQuery(l2Query, qdf, this.deps.llmRewriteFn)
          .then((variants) => {
            // Seamed call: searchMemoryMulti present on ADR-0023-capable stores. Fall back to single-query.
            const s: any = store as any;
            const searchPromise: Promise<any[]> = typeof s.searchMemoryMulti === "function"
              ? s.searchMemoryMulti(variants, 5)
              : store.searchMemory(l2Query, 5);
            return searchPromise.then((hits) => ({ hits, variants }));
          })
          .then(({ hits, variants }) => {
            if (hits.length > 0) {
              const memorySnippet = (hits as any[]).map(h => h.content || "").slice(0, 200).join(" | ");
              store!.saveAnchor(sessionId!, "l2_recall", {
                query: l2Query, variants, hits: memorySnippet.slice(0, 2000), timestamp: Date.now(),
              }).catch(() => {});
            }
          })
          .catch(() => {});
      }
    } catch {}
  }

  // ADR-0016 D7: Get current consolidation state (for testing/debugging).
  getConsolidationState(): ConsolidationState {
    return this.consolidationState;
  }

  // ADR-0016 D7: Set consolidation state (for MCP restore from anchor).
  setConsolidationState(state: ConsolidationState): void {
    this.consolidationState = state;
  }
}
