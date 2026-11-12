// ans_chat tool: PiAgentRuntime agent loop as MCP tool.
// #210: the LLM session cache lives in the injected process-level McpToolState,
// so the stateless HTTP transport reuses it across requests instead of
// rebuilding the client per request. Direct registrations get a fresh state by
// default (test isolation); rebuild is env-var keyed.
// #132: explicit server-minted session handle (threaded by the client) wires
// MemoryPipeline; no handle = single-shot.
// input validated by AJV.

import type { McpServer, ServerContext } from "@modelcontextprotocol/server";
import { fromJsonSchema } from "@modelcontextprotocol/server";
import type { CompositionResult } from "@anysearch-cli/kernel";
import {
  PiAgentRuntime,
  parseContextWindow,
  piSessionOptions,
  emptyRunUsage,
  createConsolidationSeams,
  isConsolidationBudgetError,
  resolveConsolidationMetering,
  CONSOLIDATION_UNMETERED_TEXT,
  MISSING_CONSOLIDATION_USAGE,
  MISSING_CONSOLIDATION_CACHE,
  MISSING_CONSOLIDATION_COST,
  KernelJsonSchemas,
  KernelToolDescriptions,
  type LlmSession,
} from "@anysearch-cli/kernel";
import {
  domainTomlPath,
  resolveConsolidateScope,
  ConsolidateScopeError,
  toBudgetCaps,
  type BudgetConfig,
} from "@anysearch-cli/store";
import { createHash } from "node:crypto";
import {
  buildAnsChatConsolidateResult,
  buildAnsChatResult,
  resolveAnsChatSession,
} from "../ans-chat-session.js";
import { createMcpToolState, type AnsChatCacheEntry, type McpToolState } from "../tool-state.js";
import { observeTool } from "./observation.js";
import { requestSignal } from "./signal.js";
import { toolError, toolFailure } from "./failure.js";

export function registerAnsChat(
  server: McpServer,
  eng: CompositionResult,
  state: McpToolState = createMcpToolState(),
): void {
  // Design: cache key = provider+model+baseUrl+api+contextWindow (all wire-affecting config);
  // key material never enters the key. The window participates because it affects request
  // budgeting and the L0 watermark, not only the constructor call (#210).
  // keyHash is a rotation-detection tiebreaker (F-A4: long-lived MCP process must rebuild on env key rotation),
  // not a cache partition. Single-process single-credential (env-only) — multi-credential coexistence excluded (T5 #91 #50).
  // Future per-request model override reserves an independent Map slot via an extra key segment, never overwriting the env default slot.
  const sessionCache = state.ansChatSessionCache;
  const buildSession = state.createAnsChatSession;

  function buildCacheKey(opts: {
    provider: string;
    model: string;
    baseUrl?: string;
    api?: string;
    contextWindow?: number;
    modelOverride?: string;
  }): string {
    // Structured tuple prevents ambiguous "/" collisions: distinct configs can no longer
    // produce the same string (e.g. model="a/b", baseUrl="c" vs model="a", baseUrl="b/c").
    // JSON array serialization is deterministic and collision-free for these fields.
    const tuple: string[] = [
      opts.provider,
      opts.model,
      opts.baseUrl ?? "",
      opts.api ?? "",
      opts.contextWindow === undefined ? "" : String(opts.contextWindow),
    ];
    // Reserve for per-request model override: independent segment + independent Map slot.
    // Must not overwrite the env-keyed default slot — one override would pollute all later default calls (T5 #91).
    // An extra tuple element keeps the default key stable and guarantees no collision with
    // provider/model/baseUrl/api/contextWindow values (they are always the first five elements).
    if (opts.modelOverride) {
      tuple.push(opts.modelOverride);
    }
    return JSON.stringify(tuple);
  }

  async function getLlmSession(modelOverride?: string): Promise<LlmSession> {
    const providerName = process.env.ANS_LLM_PROVIDER ?? "";
    const modelName = process.env.ANS_LLM_MODEL ?? "";
    // thread the custom-endpoint env trio like apps/cli chat.ts:40-47 —
    // ANS_LLM_BASE_URL/ANS_LLM_API/ANS_LLM_API_KEY must reach createLlmSession on
    // the MCP path too, else the configured v1/chat upstream is unreachable.
    const baseUrl = process.env.ANS_LLM_BASE_URL;
    const apiRaw = process.env.ANS_LLM_API;
    const api = apiRaw === "chat" || apiRaw === "messages" || apiRaw === "responses" ? apiRaw : undefined;
    // #113: custom endpoints carry no catalog window; the MCP root reads the env
    // (kernel stays env-free). Malformed values fail the call, not silently 128000.
    const contextWindow = parseContextWindow(process.env.ANS_LLM_CONTEXT_WINDOW);
    // F-A4 tiebreaker: keyHash detects ANS_LLM_API_KEY rotation on a long-lived MCP server.
    // It is NOT part of the cache key partitioning — same provider/model/baseUrl/api/contextWindow
    // must hit the same cache slot; hash change re-creates the slot value, not a new slot.
    const keyHash = process.env.ANS_LLM_API_KEY
      ? createHash("sha256").update(process.env.ANS_LLM_API_KEY).digest("hex").slice(0, 12)
      : "";
    // Fingerprint the complete baseUrl before it enters the cache key: raw URLs can
    // contain userinfo (https://user:pass@host) or secrets in query strings, and the
    // ANS_LLM_API_KEY assertion alone would not catch them. Hashing preserves
    // distinct URLs → distinct slots and identical URLs → same slot, without storing
    // the raw URL (or any embedded credential) in the Map key. keyHash is not needed
    // as a tiebreaker for this case.
    const baseUrlFingerprint = baseUrl ? createHash("sha256").update(baseUrl).digest("hex") : "";
    // Wire-affecting config only; secret material never enters cache key (assertion below).
    const key = buildCacheKey({ provider: providerName, model: modelName, baseUrl: baseUrlFingerprint, api, contextWindow, modelOverride });

    // Assertion: cache key must not contain secret material. Key is built only from
    // provider+model+baseUrlFingerprint+api+contextWindow (+ optional override segment); keyHash/apiKey are separate.
    // This guards against accidental future leakage of keyHash or raw key into the key string.
    const rawKey = process.env.ANS_LLM_API_KEY;
    if (rawKey && rawKey.length >= 8 && key.includes(rawKey)) {
      throw new Error("cache key must not contain secret material");
    }

    const cached = sessionCache.get(key);
    if (cached && cached.keyHash === keyHash) return cached.session;
    if (baseUrl && !api) {
      throw new Error("ANS_LLM_BASE_URL requires ANS_LLM_API=chat|messages|responses");
    }
    // Lazy init / rotation rebuild: same slot is overwritten on tiebreaker mismatch — not split.
    // The in-flight promise is cached synchronously so concurrent identical requests
    // share one construction instead of each building a client.
    const entry: AnsChatCacheEntry = {
      keyHash,
      session: buildSession({
        provider: providerName, model: modelName, baseUrl, api, contextWindow,
        apiKey: baseUrl ? process.env.ANS_LLM_API_KEY : undefined,
      }),
    };
    sessionCache.set(key, entry);
    try {
      return await entry.session;
    } catch (e) {
      // A failed build must not poison the slot. Delete only when the slot still
      // holds THIS build: a newer credential generation may have overwritten it.
      if (sessionCache.get(key) === entry) sessionCache.delete(key);
      throw e;
    }
  }

  server.registerTool(
    "ans_chat",
    {
      description: KernelToolDescriptions.ans_chat,
      inputSchema: fromJsonSchema(KernelJsonSchemas.ans_chat),
    },
    async (args: unknown, ctx?: ServerContext) => {
      const providerName = process.env.ANS_LLM_PROVIDER;
      const modelName = process.env.ANS_LLM_MODEL;
      // #211: the same seam as the search tools (#209) — the SDK context
      // signal (stdio notifications/cancelled) or the stateless-HTTP request
      // signal (response stream closed). The runtime aborts the agent loop.
      const signal = requestSignal(ctx);
      return observeTool(eng, "ans_chat", ctx, async (span) => {
        const {
          message,
          sessionId: requestedSessionId,
          operation = "chat",
          memoryIds,
          dryRun,
        } = (args ?? {}) as {
          message?: string;
          sessionId?: string;
          operation?: "chat" | "consolidate";
          memoryIds?: number[];
          dryRun?: boolean;
        };
        if (operation === "consolidate") {
          // D5/Q18: consolidation over an explicitly selected scope, sharing
          // the CLI's rules and seams so the two entries cannot disagree.
          // A missing or malformed scope is a rejected call, never a
          // full-archive run.
          const store = eng.store;
          if (!store || typeof store.consolidateMemory !== "function") {
            return toolFailure("ans_chat: consolidation requires the session store, which this server did not wire.");
          }
          if (signal?.aborted) return buildAnsChatResult("");
          let scope: ReturnType<typeof resolveConsolidateScope>;
          try {
            scope = resolveConsolidateScope({
              sessionId: requestedSessionId,
              memoryIds,
            });
          } catch (e) {
            if (e instanceof ConsolidateScopeError) {
              return toolFailure("ans_chat consolidate: " + e.message);
            }
            throw e;
          }
          if (signal?.aborted) return buildAnsChatResult("");
          // Budget (D4). The rule lives in the kernel, so this tool and the CLI
          // cannot answer "was this run charged?" differently.
          //
          // Design: the engine's own ledger is reused rather than a second one —
          // over the same connection, so the session's [budget] row, the
          // reserves and the settles all see one set of statements.
          const metering = await resolveConsolidationMetering({
            store: store as never,
            scope,
            domain: eng.config,
            toCaps: (b) => toBudgetCaps(b as BudgetConfig),
            domainLabel: "consolidate",
            ...(eng.ledger ? { ledger: eng.ledger } : {}),
            warn: (m) => process.stderr.write("[anysearch] " + m + "\n"),
          });
          // Design: the awaits above open a window the earlier check cannot see.
          // A request cancelled while waiting for the meter or the LLM session
          // must not go on to spend money and commit memory, so every wait is
          // followed by the same check.
          if (signal?.aborted) return buildAnsChatResult("");
          const budget = metering.metered ? metering.budget : undefined;

          let seams: ReturnType<typeof createConsolidationSeams> | undefined;
          if (providerName && modelName) {
            try {
              const llm = await getLlmSession();
              if (signal?.aborted) return buildAnsChatResult("");
              // The seams carry this request's own usage counter and budget
              // binding. They are handed to the run as a per-call dependency
              // instead of being written onto the shared store: two concurrent
              // requests would otherwise read each other's spend, and a
              // memory-scoped run would inherit whatever the last session run
              // installed.
              seams = createConsolidationSeams(llm, budget ? { budget } : {});
            } catch (e) {
              // Fail-open: the store reports llmUnavailable per cluster, and the
              // usage block names the missing accounting instead of faking it.
              process.stderr.write(
                "[anysearch] ans_chat consolidate LLM init failed (" +
                  (e instanceof Error ? e.message : String(e)) + ")\n",
              );
            }
          }
          let report: Awaited<ReturnType<typeof store.consolidateMemory>>;
          try {
            report = await store.consolidateMemory({
              dryRun: dryRun === true,
              scope,
            }, seams ? { summarize: seams.summarize, classify: seams.classify } : undefined);
          } catch (e) {
            if (isConsolidationBudgetError(e)) return toolFailure("ans_chat consolidate: " + e.message);
            return toolError("ans_chat", e instanceof Error ? e.message : String(e));
          }
          const usage = seams?.usage ?? {
            calls: 0,
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            totalTokens: 0,
            costUsd: 0,
            costBasis: "not-called" as const,
            missing: [MISSING_CONSOLIDATION_USAGE, MISSING_CONSOLIDATION_CACHE, MISSING_CONSOLIDATION_COST],
          };
          // Design: any budget refusal makes the run incomplete, so it is an
          // error result — but the work that DID happen is still reported. A
          // caller must see the spend already incurred, the scope read, and the
          // rows already written; hiding them would make a partial run look
          // like it never started.
          if (report.budgetRejected > 0) {
            const result = buildAnsChatConsolidateResult(report, usage, metering.metered
              ? {}
              : { budgetUnmetered: true, budgetUnmeteredReason: CONSOLIDATION_UNMETERED_TEXT[metering.reason] });
            return {
              ...result,
              isError: true,
              content: [
                {
                  type: "text" as const,
                  text: "ans_chat consolidate: stopped by the session budget (" + report.budgetRejected +
                    " model call(s) refused); " +
                    (report.add + report.update === 0
                      ? "nothing was written."
                      : "the rest of the scope was not processed.") +
                    "\n" + result.content.map((c) => c.text).join("\n"),
                },
              ],
            };
          }
          return buildAnsChatConsolidateResult(report, usage, metering.metered
            ? {}
            : { budgetUnmetered: true, budgetUnmeteredReason: CONSOLIDATION_UNMETERED_TEXT[metering.reason] });
        }
        // The message is optional on the wire because consolidate does not use
        // it; chat still needs one. Checked before the configuration gate: a
        // missing argument is the caller's usage error regardless of whether a
        // model happens to be configured.
        const chatMessage = message?.trim();
        if (!chatMessage) {
          return toolFailure("ans_chat: message is required unless operation is \"consolidate\".");
        }
        if (!providerName || !modelName) {
          // Missing configuration is an execution failure, not a successful
          // chat whose text happens to say "not configured".
          return toolFailure("ans_chat: LLM not configured. Set ANS_LLM_PROVIDER and ANS_LLM_MODEL env vars.");
        }
        // Design: a caller that already cancelled gets no LLM construction,
        // session mint, or budget work — those would be state written for a
        // dead request. The runtime also guards this. The placeholder result is
        // not user-visible either way: the SDK drops the response for its
        // aborted request signal, and on the HTTP seam the abort fires only
        // after the response socket has closed.
        if (signal?.aborted) return buildAnsChatResult("");
        try {
          const session = await getLlmSession();
          if (signal?.aborted) return buildAnsChatResult("");
          const domain = eng.config ?? {
            sources: { enabled: [] },
            prompts: [],
            skills: { active: ["search"] },
            hooks: { toolWhitelist: ["search"] },
            rag: { adapter: "none" },
          };
          // #132: explicit server-minted session handle (MCP 2026-07-28 /
          // SEP-2567). A caller that threads the handle from a previous
          // structuredContent.sessionId resumes the same L1/L2 anchors; omitting
          // it is the explicit single-shot mode (fresh session each call).
          // Either half missing leaves the runtime's `store && sessionId` gate
          // closed, which warnMissingMemoryWiring names on stderr.
          // #178: the resolver also returns the engine's ledger on success —
          // the same connection that holds the session's [budget] row — so the
          // agent loop's token/USD usage settles on the production path.
          const memory = await resolveAnsChatSession(eng, requestedSessionId);
          // ponytail: models undefined fix — pass session.models instead of undefined.
          const runtime = new PiAgentRuntime({
            retriever: eng.retriever,
            domain,
            ...memory,
            domainTomlPath: domainTomlPath(undefined, eng.domainName, eng.domainsDirs),
            // #188: same dirs the engine loaded the domain from, so a base TOML
            // in the packaged domains dir stays resolvable on a live re-read.
            domainsDirs: eng.domainsDirs,
            model: session.model,
            // #113: the real window for the L0 watermark. The pipeline is built
            // whenever `memory` carries store + sessionId (a minted or threaded
            // handle); the watermark is skipped only when wiring failed open.
            // The env still sets the custom model's request-budget window via
            // the session.
            contextWindow: session.contextWindow,
            streamFn: session.streamFn,
            models: session.models,
            getApiKey: async () => session.apiKey,
            // PI's own session record resumes the conversation; the same handle
            // keys both the record and the SQLite anchors (#258).
            ...piSessionOptions(memory.sessionId, session.apiKey),
            // one-line observation wiring — the ans_chat span
            // receives the engine's retrieval.domain_filter.* audit events.
            span,
            // #211: cancellation of the MCP request aborts this agent run.
            signal,
          });
          let output = "";
          let runtimeError: string | undefined;
          let runUsage: unknown;
          let runContext: unknown;
          // A `done` event is the runtime's own signal that the loop finished.
          // Its absence after an otherwise clean stream means the run was cut
          // short (cancellation, a closed generator), and partial text must not
          // be presented as a completed answer.
          let completed = false;
          // Retrieval/tool work is counted separately from LLM usage: a search
          // spends provider quota, not model tokens.
          const toolCalls: Record<string, number> = {};
          for await (const event of runtime.run(chatMessage)) {
            if (event.type === "text") output += event.content;
            else if (event.type === "tool_call") {
              toolCalls[event.name] = (toolCalls[event.name] ?? 0) + 1;
            } else if (event.type === "done") {
              completed = true;
              output += "\n" + event.summary;
              runUsage = event.usage ?? null;
              runContext = event.context ?? null;
              // #189: the one-shot recovery summary stays visible to the caller.
              if (event.recovery) output += "\n" + event.recovery;
            } else if (event.type === "error") {
              runtimeError = event.message;
            }
          }
          // Background summary calls already ran on this session's behalf, so
          // their spend belongs on the ledger whatever ended the turn. Drain
          // before every exit path — an error or a cancellation must not leave
          // real spend unrecorded and later read as free. Fail-open: a drain
          // fault is reported by the runtime, never turned into a tool failure.
          await runtime.flushMemory().catch(() => {});
          // The runtime's error event means the loop did not complete; surface
          // it as an execution failure instead of a successful-looking text.
          if (runtimeError !== undefined) return toolError("ans_chat", runtimeError);
          // Cancellation is a transport outcome, not a finished run (#211). The
          // partial text is dropped so a cut-off stream never reads as an
          // answer, and no usage or context is reported for a run that has no
          // accounting. The handle is not part of the answer, so it survives:
          // the caller can resume the same session later.
          if (!completed) return buildAnsChatResult("", memory.sessionId);
          // Every call reports what it spent. A run that produced no accounting
          // still returns the full shape with every dimension named missing,
          // never a partial object that renders as a free run.
          return buildAnsChatResult(output, memory.sessionId, {
            usage: {
              run: runUsage ?? emptyRunUsage(["run usage"]),
              memorySummary: runtime.getMemoryUsage(),
            },
            context: runContext,
            toolCalls,
          });
        } catch (e) {
          return toolError("ans_chat", e instanceof Error ? e.message : String(e));
        }
      }, {
        "anysearch.provider": providerName ?? "",
        "anysearch.model": modelName ?? "",
      });
    }
  );
}
