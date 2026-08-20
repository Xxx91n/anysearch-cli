// MemoryPipeline: deep module for L0/L1/L2 memory pipeline logic.
// ADR-0015 D1/D2: extracted from pi-runtime.ts shouldStopAfterTurn + transformContext.
// Interface: attach (init) / inject (hot read) / consolidate (cold write).
// Domain-semantic naming — interface does not leak host hook details.
// State vars (lastSearchTurn / consecutiveReuses / lastSummaryMsgCount) promoted to instance fields.

import { generateSummaryWithUsage, DEFAULT_COMPACTION_SETTINGS } from "@earendil-works/pi-agent-core";
import { IR_CUSTOM_INSTRUCTIONS } from "./ir-schema";
import type { RetrieverPort, SessionStorePort, DomainConfigPort } from "./ports";

export interface MemoryPipelineDeps {
  store: SessionStorePort;
  models?: any;       // ADR-0012 D4: Models object for generateSummaryWithUsage
  retriever: RetrieverPort;
  domain: DomainConfigPort;
  model: any;         // pi-ai Model instance
  streamFn: any;      // models.streamSimple.bind(models)
  sessionId: string;
  getApiKey?: () => Promise<string | undefined>;
  providerName?: string;
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
// D6: prompt includes IR 5-segment structure for per-segment coverage check.
// D10: failure -> default COMPRESS (fail-open, Mem0 "不确定就写入").
// ponytail: D3 spec says function-calling, but streamFn (pi-agent-core streamSimple)
//   doesn't expose function-calling API. Text streaming + keyword match is the pragmatic
//   path; D10 fail-open covers fragility. Upgrade to function-calling when pi-agent-core adds it.
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

export class MemoryPipeline {
  private deps: MemoryPipelineDeps;

  // State variables promoted from pi-runtime.ts closure variables.
  // ADR-0012 D3: dual-track trigger — low watermark + REUSE/COMPRESS after search.
  // 128K low watermark (~12.8% of 1M window, anti context rot; design param, needs ablation).
  private readonly LOW_WATERMARK_TOKENS = 128000;
  private lastSearchTurn = 0;    // track if last turn had a search tool call.
  // ADR-0013 D8: consecutive REUSE counter — 3 cap forces COMPRESS.
  private consecutiveReuses = 0;
  // ADR-0013 D9: track message index at last summary point for gap distillation.
  private lastSummaryMsgCount = 0;

  constructor(deps: MemoryPipelineDeps) {
    this.deps = deps;
  }

  // inject: hot path read — corresponds to transformContext delegation.
  // RAG injection + L1/L2 merged injection at latest user message (attention hot zone).
  async inject(messages: any[]): Promise<any[]> {
    const { store, domain, sessionId } = this.deps;
    let result = messages;

    // Stage 1: RAG injection — prepend RAG context note to first user message.
    if (domain.rag.adapter && domain.rag.config?.note && result.length > 0) {
      const first = result[0];
      result = [
        { ...first, content: (typeof first.content === "string" ? first.content : "") + "\n\n[RAG Context] " + domain.rag.config.note },
        ...result.slice(1),
      ];
    }

    // ADR-0012 D8/D9/D12: L1+L2 merged injection at latest user message (hot zone).
    try {
      const anchors = await store.getAnchors(sessionId);
      // D12: read LATEST rolling_summary.
      const summaryAnchors = anchors.filter(a => a.anchorType === "rolling_summary");
      const summaryAnchor = summaryAnchors[summaryAnchors.length - 1];
      const recallAnchors = anchors.filter(a => a.anchorType === "l2_recall");
      const recallAnchor = recallAnchors[recallAnchors.length - 1];

      const injections: string[] = [];
      // D9: L1 session memory, budget 4000 chars.
      if ((summaryAnchor?.payload as any)?.summary) {
        injections.push("[Session Memory] " + String((summaryAnchor.payload as any).summary).slice(0, 4000));
      }
      // D9: L2 research recall, budget 1500 chars.
      if ((recallAnchor?.payload as any)?.hits) {
        injections.push("[Research Recall] " + String((recallAnchor.payload as any).hits).slice(0, 1500));
      }

      if (injections.length > 0 && result.length > 0) {
        // D8: inject at LATEST user message (attention hot zone, prefix cache stable).
        const lastIdx = result.length - 1;
        const last = result[lastIdx];
        result = [
          ...result.slice(0, lastIdx),
          { ...last, content: (typeof last.content === "string" ? last.content : "") + "\n\n" + injections.join("\n\n") },
        ];
      }
    } catch {}

    return result;
  }

  // consolidate: cold path write — corresponds to shouldStopAfterTurn memory delegation.
  // L0 dual-track trigger + REUSE/COMPRESS NOOP adjudication + gap distillation + L2 FTS5 recall.
  // Returns void — all async work is fire-and-forget.
  async consolidate(messages: any[], totalTokens: number): Promise<void> {
    const { store, domain, model, models, streamFn, sessionId, retriever, providerName, getApiKey } = this.deps;

    // ADR-0012 D3: detect if last turn had a search tool call (REUSE/COMPRESS signal).
    // NOTE: caller updates lastSearchTurn before calling consolidate via attach signal.
    // Here we read the already-updated field.

    if (!store || !sessionId) return;

    try {
      // ADR-0012 D3: dual-track trigger — low watermark OR post-search REUSE/COMPRESS.
      const triggerLowWatermark = totalTokens > this.LOW_WATERMARK_TOKENS;
      const triggerPostSearch = this.lastSearchTurn > 0 && messages.length > 4;
      if (triggerLowWatermark || triggerPostSearch) {
        this.lastSearchTurn = 0; // reset

        const modelsObj = models;
        const summaryModel = (domain as any).compaction?.model
          ? (modelsObj?.getModel ? modelsObj.getModel(providerName || "openai", (domain as any).compaction.model) : undefined)
          : (model as any);
        const actualModel = summaryModel || (model as any);

        // ADR-0013 D4: dual-track dispatch.
        // Low watermark -> direct COMPRESS (hard, MemGPT flush).
        // Post-search -> NOOP adjudication first (soft, Mem0 NOOP).
        const shouldAdjudicate = triggerPostSearch && !triggerLowWatermark;
        // D8: consecutive REUSE cap — 3 forces COMPRESS.
        const reuseCapped = this.consecutiveReuses >= 3;
        const needsAdjudication = shouldAdjudicate && !reuseCapped;

        // Shared: get previous summary for both adjudication and compression.
        const prevAnchors = await store.getAnchors(sessionId);
        const prevSummaryAnchors = prevAnchors.filter(a => a.anchorType === "rolling_summary");
        const prevSummaryAnchor = prevSummaryAnchors[prevSummaryAnchors.length - 1];
        const previousSummary = (prevSummaryAnchor?.payload as any)?.summary as string | undefined;

        // D9: gap distillation — search tool results since last summary.
        const gapDistillation = distillGap(messages, this.lastSummaryMsgCount);

        // Capture msg count at trigger time for race-safe gap anchor update.
        const msgCountAtTrigger = messages.length;

        // D5: fire-and-forget compression helper (reused by both tracks).
        const fireCompress = () => {
          if (modelsObj && actualModel) {
            this.consecutiveReuses = 0; // D8: COMPRESS resets counter.
            generateSummaryWithUsage(
              messages, modelsObj, actualModel,
              DEFAULT_COMPACTION_SETTINGS.reserveTokens,
              undefined, // signal
              IR_CUSTOM_INSTRUCTIONS,
              previousSummary,
              "off", // thinkingLevel
            ).then((result: any) => {
              if (result?.ok && result.value?.text) {
                // D9: advance gap anchor using captured count (race-safe vs live array).
                this.lastSummaryMsgCount = msgCountAtTrigger;
                store!.saveAnchor(sessionId!, "rolling_summary", {
                  summary: result.value.text,
                  tokenWatermark: totalTokens,
                  timestamp: Date.now(),
                }).catch(() => {});
              }
            }).catch((e: any) => {
              // D10: compression failure is fire-and-forget, but log to stderr (HaluMem: silent catch masks memory corruption).
              if (typeof process !== "undefined" && process.stderr) {
                process.stderr.write("[anysearch] L0 compression warning: " + (e instanceof Error ? e.message : String(e)) + "`n");
              }
            });
          }
        };

        if (needsAdjudication) {
          // D1/D5: fire-and-forget adjudication, .then() decides compress.
          adjudicateReuseCompress(streamFn, actualModel, gapDistillation, previousSummary)
            .then((decision: "reuse" | "compress") => {
              if (decision === "reuse") {
                this.consecutiveReuses++; // D8: increment on REUSE.
              } else {
                fireCompress();
              }
            })
            .catch(() => fireCompress()); // D10: adjudication failure -> COMPRESS.
        } else {
          // Low watermark or reuse-capped -> direct COMPRESS.
          fireCompress();
        }
      }

      // ADR-0012 D10: L2 cold path — use latest search intent (tool_input.query), FTS5 only.
      const lastToolCall = [...messages].reverse().find((m: any) =>
        m.role === "assistant" && Array.isArray(m.content) &&
        m.content.some((c: any) => c.type === "tool_use" && typeof c.name === "string" && c.name.includes("search"))
      );
      const searchToolInput = lastToolCall?.content?.find((c: any) => c.type === "tool_use" && c.name?.includes("search"))?.input;
      const l2Query = searchToolInput?.query || "";
      if (typeof l2Query === "string" && l2Query.length > 3) {
        store.searchMemory(l2Query, 5).then((hits) => {
          if (hits.length > 0) {
            const memorySnippet = hits.map(h => h.content || "").slice(0, 200).join(" | ");
            store!.saveAnchor(sessionId!, "l2_recall", {
              query: l2Query, hits: memorySnippet.slice(0, 2000), timestamp: Date.now(),
            }).catch(() => {});
          }
        }).catch(() => {});
      }
    } catch {}
  }

  // attach: signal that last turn had a search tool call (REUSE/COMPRESS trigger signal).
  // Called by shouldStopAfterTurn before consolidate.
  signalSearchTurn(): void {
    this.lastSearchTurn = 1;
  }
}