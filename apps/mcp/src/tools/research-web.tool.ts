// research_web tool: deep multi-round search via engine.retriever.
// thin wrapper, engine result directly to MCP JSON.
// no console.* in MCP source — write to stderr explicitly.
// provider answers marked as provider-generated (verified:false at contract).
// attribution included in both content JSON and structuredContent (SEP-1624).

import type { McpServer, ServerContext } from "@modelcontextprotocol/server";
import { fromJsonSchema } from "@modelcontextprotocol/server";
import { KernelJsonSchemas, KernelToolDescriptions, type CompositionResult } from "@anysearch-cli/kernel";
import { buildVerticalSpec, type ProviderErrorClass } from "@anysearch-cli/retriever";
import { observeTool } from "./observation.js";
import { requestSignal } from "./signal.js";
import {
  allProvidersFailedText,
  providerFailureMetadata,
  toolError,
  toolFailure,
} from "./failure.js";

export function registerResearchWeb(server: McpServer, eng: CompositionResult): void {
  server.registerTool(
    "research_web",
    {
      description: KernelToolDescriptions.research_web,
      inputSchema: fromJsonSchema(KernelJsonSchemas.research_web),
    },
    async (args: unknown, ctx?: ServerContext) => {
      // #209: same seam as search_web — SDK context signal (stdio) or the
      // HTTP request signal (stateless response-stream closure).
      const signal = requestSignal(ctx);
      return observeTool(eng, "research_web", ctx, async (span) => {
        const { question, depth, verticalDomain, verticalSubDomain, verticalParams } = args as { question: string; depth?: string; verticalDomain?: string; verticalSubDomain?: string; verticalParams?: Record<string, unknown> };
        // + /: shared
        // guard + assembly; error copy is this surface's rendering of the
        // legislated missing-domain reason (byte-frozen).
        const built = buildVerticalSpec({ domain: verticalDomain, subDomain: verticalSubDomain, params: verticalParams });
        if (!built.ok) {
          return toolError("research_web", "verticalSubDomain/verticalParams require verticalDomain");
        }
        const vertical = built.vertical;
        const d = depth ?? "deep";
        let allResults: any[] = [];
        let lastRoundSufficiency: Record<string, unknown> | undefined;
        let lastEnvelope: any = null;
        let rounds = 0;
        // Failure metadata is aggregated across rounds and exposed once on
        // the merged result. anyProviderAnswered pins "zero results with at
        // least one successful arm" as success, not outage.
        const failedProviders = new Set<string>();
        const providerErrorClasses: Record<string, ProviderErrorClass> = {};
        let anyProviderAnswered = false;

        try {
          // brief = 1, standard = 2, deep = 3 — the model-facing schema promises
          // these round counts (KernelJsonSchemas.research_web).
          const maxRounds = d === "deep" ? 3 : d === "standard" ? 2 : 1;
          const seenUrls = new Set<string>();
          for (let round = 0; round < maxRounds; round++) {
            const envelope = await eng.retriever.search({
              query: round === 0 ? question : question + " (round " + (round + 1) + ")",
              mode: "deep" as const,
              maxResults: 10,
              ...(vertical ? { vertical } : {}),
              span,
              signal,
            });
            rounds++;
            // #209: a cancelled research call stops after the aborted round —
            // no further provider quota, no post-cancellation work.
            if (signal?.aborted) break;
            // sufficiency gate — this is the LAST round's sufficiency; earlier rounds tracks but the gate cares about the final state.
            lastRoundSufficiency = envelope.metadata?.sufficiency as unknown as Record<string, unknown> | undefined;
            lastEnvelope = envelope;

            const queriedProviders = envelope.metadata?.providersQueried ?? [];
            const cancelledProviders = envelope.metadata?.providersCancelled ?? [];
            const roundFailed = envelope.metadata?.providersFailed ?? [];
            for (const id of roundFailed) failedProviders.add(id);
            Object.assign(providerErrorClasses, envelope.metadata?.providerErrorClasses ?? {});
            if (queriedProviders.some((id) => !roundFailed.includes(id) && !cancelledProviders.includes(id))) {
              anyProviderAnswered = true;
            }

            const newItems = (envelope.results ?? []).filter((r: any) => !seenUrls.has(r.url));
            newItems.forEach((r: any) => seenUrls.add(r.url));
            allResults = allResults.concat(newItems);

            // Stop early when sufficiency verdict is "correct" (engine D5).
            if (envelope.metadata?.sufficiency?.verdict === "correct") break;
          }

          // Zero results with no arm ever answering is an outage, not an
          // empty research result. Name the failed arms; no structuredContent.
          const failedProvidersList = [...failedProviders];
          if (allResults.length === 0 && !anyProviderAnswered && failedProvidersList.length > 0) {
            return toolFailure(allProvidersFailedText("research_web", failedProvidersList, providerErrorClasses));
          }
          // Partial success: at least one arm answered in some round.
          const providerFailures = providerFailureMetadata(eng, failedProvidersList, providerErrorClasses);

          // Re-derive attribution over the MERGED result set so claim
          // evidence sourceKeys point into the same results array this tool returns.
          // (Last-round-only attribution indexes a per-round list the tool never returns.)
          let mergedAttribution: unknown = null;
          if (lastEnvelope?.attribution) {
            const { attachAttribution } = await import("@anysearch-cli/kernel");
            const merged = { ...lastEnvelope, results: allResults };
            mergedAttribution = attachAttribution(merged, {
              ...(eng.calibration ? { calibration: eng.calibration } : {}),
            });
          }
          const lastRound = allResults.slice(-10);
          const summary = JSON.stringify(
            {
              question,
              depth: d,
              rounds,
              totalResults: allResults.length,
              results: lastRound.slice(0, 10),
              citations: allResults.slice(0, 5).map((r: any) => ({ title: r.title, url: r.url, source: r.source })),
              // provider answers pass through unmodified.
              // Round-47 fix: stable output shape.
              ...(lastRoundSufficiency ? { sufficiency: lastRoundSufficiency } : {}),
              // attribution from last round (claim-level evidence linkage).
              ...(mergedAttribution ? { attribution: mergedAttribution } : { attribution: null }),
              // abstain marker when the domain gate emptied the pool.
              abstain: lastEnvelope?.metadata?.abstain ?? null,
              // resolved vertical routing (query-level spec, applied to every round).
              vertical: vertical ?? null,
              // Partial-failure metadata rides the successful result.
              ...(providerFailures ?? {}),
            },
            null,
            2,
          );

          // structuredContent.abstain, isError absent (false).
          const lastAbstain = lastEnvelope?.metadata?.abstain;
          const structuredContent = {
            ...(lastRoundSufficiency ? { sufficiency: lastRoundSufficiency } : {}),
            ...(mergedAttribution ? { attribution: mergedAttribution } : {}),
            ...(lastAbstain ? { abstain: lastAbstain } : {}),
            ...(providerFailures ?? {}),
          };
          return {
            content: [{ type: "text" as const, text: summary }],
            ...(Object.keys(structuredContent).length > 0 ? { structuredContent } : {}),
          };
        } catch (e) {
          return toolError("research_web", e instanceof Error ? e.message : String(e));
        }
      });
    },
  );
}
