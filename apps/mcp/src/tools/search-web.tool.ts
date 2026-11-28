// search_web tool: fast/index search via engine.retriever.
// thin wrapper, engine result directly to MCP JSON.
// no console.* in MCP source — write to stderr explicitly.
// provider answers marked as provider-generated (verified:false at contract).
// attribution is always in the content JSON (null when it could not be computed) and
// only present in structuredContent when it was.

import type { McpServer, ServerContext } from "@modelcontextprotocol/server";
import { fromJsonSchema } from "@modelcontextprotocol/server";
import { KernelJsonSchemas, KernelToolDescriptions, isDomainConstraintError, isTaskBudgetRejectedError, reportedDeadlineMs, type CompositionResult } from "@anysearch-cli/kernel";
import { buildVerticalSpec, isPartialPool } from "@anysearch-cli/retriever";
import { observeTool } from "./observation.js";
import { requestSignal } from "./signal.js";
import { beginToolBudget, toolBudgetStop, toolDomainStop } from "./task-budget.js";
import { withMcpTask } from "../mcp-task.js";
import {
  allProvidersFailedText,
  envelopeArmLists,
  isInterrupted,
  outcomeOf,
  providerFailureMetadata,
  toolError,
  toolFailure,
} from "./failure.js";

export function registerSearchWeb(server: McpServer, eng: CompositionResult): void {
  server.registerTool(
    "search_web",
    {
      description: KernelToolDescriptions.search_web,
      inputSchema: fromJsonSchema(KernelJsonSchemas.search_web),
    },
    async (args: unknown, ctx?: ServerContext) => {
      // #209: the SDK context signal covers stdio cancellation; the request
      // signal covers stateless HTTP response-stream closure. The engine
      // combines the winner with its per-provider controllers.
      const signal = requestSignal(ctx);
      // #304: one tool call is one task. Wrapped around the observation so the
      // task row is ended only after the observation write, same as ans_chat.
      return withMcpTask(eng, "search_web", () => observeTool(eng, "search_web", ctx, async (span) => {
        // maxResults is intentionally absent from the
        // public schema (additionalProperties:false) — exposing it is a feature
        // decision, not hygiene; the dead destructure is removed, engine
        // default (10) rules uniformly across surfaces.
        const { query, mode, verticalDomain, verticalSubDomain, verticalParams } = args as { query: string; mode?: string; verticalDomain?: string; verticalSubDomain?: string; verticalParams?: Record<string, unknown> };
        // args validated by AJV upstream (fromJsonSchema).
        // + /: guard +
        // assembly share buildVerticalSpec — the copy below is this surface's
        // rendering of the legislated missing-domain reason (byte-frozen).
        const built = buildVerticalSpec({ domain: verticalDomain, subDomain: verticalSubDomain, params: verticalParams });
        if (!built.ok) {
          return toolError("search_web", "verticalSubDomain/verticalParams require verticalDomain");
        }
        const vertical = built.vertical;
        // #304: this search bills its own task, never a session that happens to
        // be around. A declared [budget] that cannot be established stops here,
        // before any provider request.
        const budget = beginToolBudget(eng, "search_web");
        if ("stop" in budget) return budget.stop;
        try {
          const envelope = await eng.retriever.search({
            query,
            mode: (mode as any) ?? "fast",
            ...(vertical ? { vertical } : {}),
            ...(budget.taskBudget ? { taskBudget: budget.taskBudget } : {}),
            span,
            signal,
          });

          // Only `failed` is an error: every queried arm died. The other four
          // verdicts are successes with their value named in the output; the
          // engine decides which, this surface never re-judges.
          const outcome = outcomeOf(envelope);
          const { queried: queriedProviders, cancelled: cancelledProviders, failed: failedProviders } = envelopeArmLists(envelope.metadata);
          const providerElapsedMs = envelope.metadata?.providerElapsedMs ?? {};
          const providerErrorClasses = envelope.metadata?.providerErrorClasses;
          const providerErrorRetryAfter = envelope.metadata?.providerErrorRetryAfterSeconds;
          if (outcome === "failed") {
            return toolFailure(allProvidersFailedText("search_web", failedProviders, providerErrorClasses, providerErrorRetryAfter));
          }
          // Partial success: at least one arm answered, so isError stays false
          // while these fields name the degraded arms.
          const providerFailures = providerFailureMetadata(eng, failedProviders, providerErrorClasses, providerErrorRetryAfter);
          const partial = isPartialPool(cancelledProviders);
          const topResults = envelope.results.slice(0, 10);
          // One read for both halves: the same budget in the text JSON and in
          // structuredContent, so the two copies cannot drift.
          const deadlineMs = reportedDeadlineMs(eng);

          // provider answers pass through as first-class fields.
          // attribution attached to envelope by engine.attachAttribution.
          const summary = JSON.stringify(
            {
              query,
              totalResults: envelope.results.length,
              showing: topResults.length,
              results: topResults,
              // first-class answers marked providerGenerated+unverified.
              // Stable output shape; the field list lives in docs/mcp-server.md.
              // verified:false is locked at contract layer (ProviderAnswer); do not re-stamp here.
              answers: envelope.answers ?? [],
              answersAvailable: envelope.metadata?.answersAvailable ?? false,
              providerAnswers: envelope.metadata?.providerAnswers ?? [],
              providersQueried: queriedProviders,
              // Arms we cut off ourselves: the deadline ran out, or the caller
              // went away. Paired with providersQueried, so neither case reads as
              // an arm that never ran.
              providersCancelled: cancelledProviders,
              partial,
              // The budget the engine gave this fanout.
              deadlineMs,
              // What each answered arm said it took. Cut and failed arms have no
              // key, so this map never reads as a 0ms answer.
              providerElapsedMs,
              // Some hosts give the model only this text half, so the credential
              // record goes in both halves.
              credentialSources: eng.credentialSources ?? null,
              // attribution = claim-level evidence linkage report (present iff search ran).
              ...(envelope.attribution ? { attribution: envelope.attribution } : { attribution: null }),
              // first-class abstain marker — policy success, not error.
              abstain: envelope.metadata?.abstain ?? null,
              // How this run ended: answer / failed / cancelled / abstain / empty.
              outcome,
              // resolved vertical routing (query-level args; repo-level
              // defaults surface via the retrieval.vertical.pre audit event).
              vertical: vertical ?? null,
              // MCP sufficiency annotation — A+ dual-channel.
              ...(envelope.metadata?.sufficiency ? { sufficiency: envelope.metadata.sufficiency } : {}),
              // Partial-failure metadata rides the successful result.
              ...(providerFailures ?? {}),
            },
            null,
            2,
          );

          // Auto-index into session store (best-effort, fail-open).
          // #209: cancellation is not a completed search — no session write for
          // an aborted caller. The second check closes the window where the
          // signal aborts while the session row is being minted.
          if (!signal?.aborted) {
            try {
              const session = await eng.store.createSession("mcp");
              if (!signal?.aborted) await eng.store.saveResults(session.id, envelope.results);
            } catch (e) {
              // ponytail: auto-index is best-effort, don't block search response.
              process.stderr.write("search_web auto-index error: " + (e instanceof Error ? e.message : String(e)) + "\n");
            }
          }

          const attribution = envelope.attribution;
          const abstain = envelope.metadata?.abstain;
          // 拒答标记放在 structuredContent.abstain，isError 仍为 false。成功
          // 结果一定带 structuredContent：outcome、credentialSources、
          // providersQueried、providersCancelled、partial、deadlineMs、
          // providerElapsedMs 恒有值；sufficiency / attribution / provider failures
          // 有值时才加。
          const structuredContent = {
            ...(isInterrupted(outcome, signal) ? { interrupted: true } : {}),
            ...(envelope.metadata?.sufficiency ? { sufficiency: envelope.metadata.sufficiency } : {}),
            ...(attribution ? { attribution } : {}),
            ...(abstain ? { abstain } : {}),
            outcome,
            ...(providerFailures ?? {}),
            // The same two fields the content JSON carries. Paired with
            // providersQueried, a cut-off arm is named outright instead of being
            // inferred from which other fields are missing.
            providersQueried: queriedProviders,
            providersCancelled: cancelledProviders,
            // Both always present so a host never confuses "complete" with
            // "field missing".
            partial,
            deadlineMs,
            // 答完的臂各自花了多久；被掐、失败的臂没有键。
            providerElapsedMs,
            // credentialSources 由引擎给出、原样透出；没接凭据时是 null。
            credentialSources: eng.credentialSources ?? null,
          };
          return {
            content: [{ type: "text" as const, text: summary }],
            structuredContent,
          };
        } catch (e) {
          // A refused reservation never reached a provider: report it as the
          // budget stop it is instead of an upstream error.
          if (isTaskBudgetRejectedError(e)) {
            return toolBudgetStop("search_web", "budget-rejected", e.message);
          }
          // #306: a declared Active Domain that cannot be read is refused by the
          // engine's own policy resolver. Name it as that stop, so a host does
          // not read it as an upstream failure and retry.
          if (isDomainConstraintError(e)) {
            return toolDomainStop("search_web", e.message);
          }
          return toolError("search_web", e instanceof Error ? e.message : String(e));
        }
      }));
    },
  );
}
