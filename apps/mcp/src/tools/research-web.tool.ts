// research_web tool: deep multi-round search via engine.retriever.
// thin wrapper, engine result directly to MCP JSON.
// no console.* in MCP source — write to stderr explicitly.
// provider answers marked as provider-generated (verified:false at contract).
// attribution is always in the content JSON (null when it could not be computed) and
// only present in structuredContent when it was.

import type { McpServer, ServerContext } from "@modelcontextprotocol/server";
import { fromJsonSchema } from "@modelcontextprotocol/server";
import { KernelJsonSchemas, KernelToolDescriptions, isDomainConstraintError, isTaskBudgetRejectedError, type CompositionResult } from "@anysearch-cli/kernel";
import { buildVerticalSpec, type ProviderErrorClass } from "@anysearch-cli/retriever";
import { observeTool } from "./observation.js";
import { requestSignal } from "./signal.js";
import { beginToolBudget, toolBudgetStop, toolDomainStop } from "./task-budget.js";
import { withMcpTask } from "../mcp-task.js";
import {
  allProvidersFailedText,
  outcomeOf,
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
      // #304: one tool call is one task; every research round below draws from
      // that task's single budget.
      return withMcpTask(eng, "research_web", () => observeTool(eng, "research_web", ctx, async (span) => {
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
        // #304: this call's own task budget. A declared [budget] that cannot be
        // established stops before the first round.
        const budget = beginToolBudget(eng, "research_web");
        if ("stop" in budget) return budget.stop;
        let allResults: any[] = [];
        let lastRoundSufficiency: Record<string, unknown> | undefined;
        // Arms asked and arms cut off, for the last completed round only:
        // unioning rounds would call an arm cancelled that answered later, and a
        // round cut short by the caller is `interrupted`'s story.
        let lastRoundQueried: string[] = [];
        let lastRoundCancelled: string[] = [];
        let lastEnvelope: any = null;
        let rounds = 0;
        // Failure metadata is aggregated across rounds and exposed once on
        // the merged result — an arm that failed in any round counts, so this
        // set is a union while the arm lists below are last-round only. The two
        // answer different questions, and an arm can therefore appear in both:
        // it failed early and was cut off later. anyProviderAnswered pins "zero
        // results with at least one successful arm" as success, not outage.
        const failedProviders = new Set<string>();
        const providerErrorClasses: Record<string, ProviderErrorClass> = {};
        const providerErrorRetryAfterSeconds: Record<string, number> = {};
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
              ...(budget.taskBudget ? { taskBudget: budget.taskBudget } : {}),
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
            // Overwritten every round: the last completed round wins, the same
            // round abstain and sufficiency describe.
            lastRoundQueried = queriedProviders;
            lastRoundCancelled = cancelledProviders;
            const roundFailed = envelope.metadata?.providersFailed ?? [];
            for (const id of roundFailed) failedProviders.add(id);
            Object.assign(providerErrorClasses, envelope.metadata?.providerErrorClasses ?? {});
            // Follows each arm's latest failure: overwrite when it gave a number,
            // drop when it failed again without one, keep the last otherwise
            // (providerErrorClasses above accumulates the same way).
            for (const id of roundFailed) {
              const wait = envelope.metadata?.providerErrorRetryAfterSeconds?.[id];
              if (wait !== undefined) providerErrorRetryAfterSeconds[id] = wait;
              else delete providerErrorRetryAfterSeconds[id];
            }
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
            return toolFailure(allProvidersFailedText("research_web", failedProvidersList, providerErrorClasses, providerErrorRetryAfterSeconds));
          }
          // Partial success: at least one arm answered in some round.
          const providerFailures = providerFailureMetadata(eng, failedProvidersList, providerErrorClasses, providerErrorRetryAfterSeconds);

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
          // The last completed round's verdict and marker — the same round
          // sufficiency describes, never a union across rounds. An interrupted
          // round's envelope is not trusted, so a caller that aborts during the
          // first round leaves both null.
          const lastAbstain = lastEnvelope?.metadata?.abstain ?? null;
          const lastOutcome = lastEnvelope ? outcomeOf(lastEnvelope) : null;
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
              abstain: lastAbstain,
              // The last completed round's verdict, the same round abstain and
              // sufficiency describe. Never a union across rounds: an earlier
              // `empty` does not describe a later `answer`.
              outcome: lastOutcome,
              // The last completed round's arm state, never a union.
              providersQueried: lastRoundQueried,
              providersCancelled: lastRoundCancelled,
              // resolved vertical routing (query-level spec, applied to every round).
              vertical: vertical ?? null,
              // Partial-failure metadata rides the successful result.
              ...(providerFailures ?? {}),
            },
            null,
            2,
          );

          // 拒答标记放在 structuredContent.abstain，isError 仍为 false。成功
          // 结果一定带 structuredContent：outcome、credentialSources、
          // providersQueried、providersCancelled 恒有值；其余字段有值时才加。
          const structuredContent = {
            // #304 review: a cancelled research call stops after the aborted
            // round and then returns normally. Say so, or the task wrapper
            // records the interrupted call as a clean finish.
            ...(signal?.aborted ? { interrupted: true } : {}),
            ...(lastRoundSufficiency ? { sufficiency: lastRoundSufficiency } : {}),
            ...(mergedAttribution ? { attribution: mergedAttribution } : {}),
            ...(lastAbstain ? { abstain: lastAbstain } : {}),
            // Always present, null included: `outcome` is the round's verdict,
            // not optional metadata, and a host should not have to tell "no
            // round finished" from "this build forgot the field".
            outcome: lastOutcome,
            ...(providerFailures ?? {}),
            // The same two fields the content JSON carries.
            providersQueried: lastRoundQueried,
            providersCancelled: lastRoundCancelled,
            // credentialSources 由引擎给出、原样透出；没接凭据时是 null。
            credentialSources: eng.credentialSources ?? null,
          };
          return {
            content: [{ type: "text" as const, text: summary }],
            structuredContent,
          };
        } catch (e) {
          // A refused reservation never reached a provider. Earlier rounds, if
          // any, already settled on the same task row — say how many, so the
          // answer does not read like a run that never started.
          if (isTaskBudgetRejectedError(e)) {
            return toolBudgetStop(
              "research_web",
              "budget-rejected",
              e.message + " (" + rounds + " round(s) settled before the stop)",
            );
          }
          // #306: the domain constraint is re-read per round, so it can break
          // between rounds; name that stop instead of an upstream failure.
          if (isDomainConstraintError(e)) {
            return toolDomainStop("research_web", e.message);
          }
          return toolError("research_web", e instanceof Error ? e.message : String(e));
        }
      }));
    },
  );
}
