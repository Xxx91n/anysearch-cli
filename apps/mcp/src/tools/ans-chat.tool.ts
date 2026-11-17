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
  piSessionKey,
  findPiSessionRecord,
  resolvePiSessionDir,
  runChatAttempt,
  ChatAttemptBusyError,
  type ChatAttemptOutcome,
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
  formatSummaryRebuildLine,
  type LlmSession,
  type SummaryRebuildReport,
} from "@anysearch-cli/kernel";
import {
  domainTomlPath,
  resolveConsolidateScope,
  ConsolidateScopeError,
  toBudgetCaps,
  type BudgetConfig,
  type ResolvedLlmConfig,
} from "@anysearch-cli/store";
import { createHash } from "node:crypto";
import {
  buildAnsChatConsolidateResult,
  buildAnsChatErrorResult,
  buildAnsChatResult,
  resolveAnsChatSession,
  isValidSessionHandle,
} from "../ans-chat-session.js";
import { createMcpToolState, type AnsChatCacheEntry, type McpToolState } from "../tool-state.js";
import { observeTool } from "./observation.js";
import { requestSignal } from "./signal.js";
import { toolError, toolFailure } from "./failure.js";

// A cut-off run's accounting dimensions: the provider never sent a final
// usage figure, so the run's tokens, cache and cost are all unknown. Named
// together so the interruption path and any future one report the same story
// (#266: an interrupted run must not read as free).
const INTERRUPTED_RUN_MISSING = ["run usage: interrupted before the provider reported it"];

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
  const resolveConfig = state.resolveLlmConfig;

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

  // #300: `cfg` is the shared layered resolution (flag > env > project > user).
  // The model settings (provider/model/baseUrl/api/secret) no longer come from
  // direct ANS_LLM_* reads — the CLI and both MCP start paths now go through the
  // same resolver, so a user/project TOML is seen by all three and the per-field
  // `sources` are available to report back. ANS_LLM_CONTEXT_WINDOW stays an env
  // only input (#113): it is a request-budget window, not a TOML model setting.
  async function getLlmSession(cfg: ResolvedLlmConfig, modelOverride?: string): Promise<LlmSession> {
    const providerName = cfg.provider ?? "";
    const modelName = cfg.model ?? "";
    // Custom endpoint trio now comes from the same resolution as the CLI. The
    // project whitelist already dropped any base_url/api/env_key a repo tried to
    // set; only env or the user file can supply them here.
    const baseUrl = cfg.baseUrl;
    const api = cfg.api;
    // #113: custom endpoints carry no catalog window; the MCP root reads the env
    // (kernel stays env-free). Malformed values fail the call, not silently 128000.
    const contextWindow = parseContextWindow(process.env.ANS_LLM_CONTEXT_WINDOW);
    // F-A4 tiebreaker: keyHash detects credential rotation on a long-lived MCP
    // server. #300: it hashes the RESOLVED key, so rotation is seen whether the
    // secret came from ANS_LLM_API_KEY or from a user-file env_key indirection.
    // It is NOT part of the cache key partitioning — same provider/model/baseUrl/api/contextWindow
    // must hit the same cache slot; hash change re-creates the slot value, not a new slot.
    const apiKey = cfg.apiKey;
    const keyHash = apiKey
      ? createHash("sha256").update(apiKey).digest("hex").slice(0, 12)
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
    const rawKey = apiKey;
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
        // CLI chat.ts passes cfg.apiKey (env or env_key indirection). Same here:
        // a user-file env_key must reach a custom endpoint on the MCP path too.
        apiKey: baseUrl ? apiKey : undefined,
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
      // #300: one layered resolution per call — flag/env/project/user — shared
      // with the CLI. Resolving here (not once at registration) means a host that
      // edits its user/project TOML is picked up by the next call, and both the
      // standalone MCP and `ans mcp` take the same path into this resolver.
      // resolveLlmConfig warns to stderr on bad TOML or a dropped key, so a
      // broken file is reported instead of being mistaken for "model connected".
      const cfg = resolveConfig();
      const providerName = cfg.provider;
      const modelName = cfg.model;
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
          allowSingleEvidence,
          dryRun,
        } = (args ?? {}) as {
          message?: string;
          sessionId?: string;
          operation?: "chat" | "consolidate";
          memoryIds?: number[];
          allowSingleEvidence?: boolean;
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
              const llm = await getLlmSession(cfg);
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
              ...(allowSingleEvidence === true ? { allowSingleEvidence: true } : {}),
            }, seams
              ? {
                  summarize: seams.summarize, classify: seams.classify, verify: seams.verify, verifyFinal: seams.verifyFinal,
                  // #277: the CLI passes this too. Without it this path would
                  // never propose a cross-script mapping, and the two entry
                  // points would answer the same ticket differently.
                  judgeEntityAlias: seams.judgeEntityAlias,
                }
              : undefined);
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
          // #261 (D7): a withheld correction means the requested change did not
          // land. The work that DID happen is still reported — spend, scope,
          // rows written — and the old knowledge stays live. isError carries
          // "not completed" to automated callers that only read the flag.
          if (report.correctionsIncomplete > 0) {
            const result = buildAnsChatConsolidateResult(report, usage, metering.metered
              ? {}
              : { budgetUnmetered: true, budgetUnmeteredReason: CONSOLIDATION_UNMETERED_TEXT[metering.reason] });
            return {
              ...result,
              isError: true,
              content: [
                {
                  type: "text" as const,
                  text: "ans_chat consolidate: " + report.correctionsIncomplete +
                    " correction(s) not completed (merge, re-judge, or final check); those rows keep their previous knowledge." +
                    (report.update > 0 ? (report.dryRun ? " " + report.update + " other correction(s) would land." : " " + report.update + " other correction(s) did land.") : "") +
                    "\n" + result.content.map((c) => c.text).join("\n"),
                },
              ],
            };
          }
          // Design: #262 (D11) — an unresolved concurrent conflict is a "not
          // finished" run for the caller — the correction they sent did not
          // land, and the current knowledge was not replaced by this run.
          // Both sides' evidence is in the report; nothing was deleted and
          // neither side was picked by write order.
          if (report.conflicts > 0) {
            const result = buildAnsChatConsolidateResult(report, usage, metering.metered
              ? {}
              : { budgetUnmetered: true, budgetUnmeteredReason: CONSOLIDATION_UNMETERED_TEXT[metering.reason] });
            return {
              ...result,
              isError: true,
              content: [
                {
                  type: "text" as const,
                  text: "ans_chat consolidate: " + report.conflicts +
                    " concurrent correction conflict(s) unresolved — this run did NOT replace the current knowledge; both sides' evidence is in the report." +
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
          // chat whose text happens to say "not configured". #300: name both
          // ways in — env OR a config file — so a host that wrote a TOML knows
          // to check it instead of being told only to set env vars.
          return toolFailure(
            "ans_chat: LLM not configured. Set ANS_LLM_PROVIDER and ANS_LLM_MODEL env vars, " +
            "or write provider/model in ~/.anysearch-cli/config.toml (user) or .anysearch/config.toml (project).",
          );
        }
        // Design: a caller that already cancelled gets no LLM construction,
        // session mint, or budget work — those would be state written for a
        // dead request. The runtime also guards this. The placeholder result is
        // not user-visible either way: the SDK drops the response for its
        // aborted request signal, and on the HTTP seam the abort fires only
        // after the response socket has closed.
        if (signal?.aborted) return buildAnsChatResult("");
        try {
          const session = await getLlmSession(cfg);
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
          // Capture the old state before the resolver can register a new handle.
          // An already tracked chat must never silently create a fresh record.
          const previousChat = typeof requestedSessionId === "string"
            ? eng.store?.getChatSession?.(requestedSessionId) : undefined;
          const hasPreviousRecord = isValidSessionHandle(requestedSessionId) &&
            !!findPiSessionRecord(resolvePiSessionDir(), piSessionKey(requestedSessionId));
          // Design: only a tracked chat or an existing PI record makes this a
          // continuation. A session row that has neither is an old database
          // conversation whose transcript lives in the research store, and
          // #265's recovery path answers it — `summary-rebuild-mcp.test.ts`
          // seeds exactly that shape and requires it to work. Refusing it as
          // "no record" would break the recovery this build already ships.
          // (CodeRabbit's #314 suggestion to treat every `sessions` row as
          // resumable was rejected for this reason.)
          const mustResume = !!previousChat?.chatTracked || hasPreviousRecord;
          const memory = await resolveAnsChatSession(eng, requestedSessionId);
          // Design: refuse a tracked continuation when wiring fails — #132's
          // fail-open path would otherwise answer without its recorded history.
          if (mustResume && (!memory.store || memory.sessionId !== requestedSessionId)) {
            return toolFailure("ans_chat: 会话恢复失败，本次没有发送问题。");
          }
          // The attempt's lease and the runtime's run lock guard the same
          // session, so they read the SAME windows: a shortened
          // ANS_PI_LOCK_STALE_MS applies to an abandoned lease too.
          const sessionWiring = piSessionOptions(memory.sessionId, session.apiKey);
          // Filled in when the attempt starts; the runtime's onRunStart reads it.
          let startedAttempt: { markStarted(): void } | undefined;
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
            ...sessionWiring,
            requirePiSessionRecord: mustResume,
            // #299: record the attempt from the moment the provider is reached,
            // not from the first token. A request cancelled before its first
            // token still ran; one refused before the prompt (cancelled caller,
            // exhausted budget) still records nothing. Read through this slot
            // because the attempt context arrives after this object is built.
            onRunStart: () => startedAttempt?.markStarted(),
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
          // #264 (D9): the rebuild attempts of this run, reported in metadata so
          // a host reading structuredContent can see them too.
          let summaryRebuilds: SummaryRebuildReport[] = [];
          // Retrieval/tool work is counted separately from LLM usage: a search
          // spends provider quota, not model tokens.
          const toolCalls: Record<string, number> = {};
          // #299: the whole attempt runs under this session's lease, so the
          // "began" and "finished" writes cannot interleave with another attempt
          // on the same session. The runtime still takes its own run lock
          // inside; this wraps it rather than moving it.
          // Design: a resumed session keeps the project it already belongs to;
          // only a session without one takes the server's directory (which is
          // why an unowned session is never assigned here).
          const attemptProject = previousChat?.projectRoot ?? null;
          let attemptResult: ChatAttemptOutcome;
          try {
            attemptResult = await runChatAttempt({
              store: memory.store,
              sessionId: memory.sessionId,
              projectRoot: attemptProject,
              piSessionDir: memory.sessionId ? resolvePiSessionDir() : undefined,
              // Same windows the run lock reads (#299 review).
              sessionLock: sessionWiring.sessionLock,
            }, async (attempt) => {
              startedAttempt = attempt;
              for await (const event of runtime.run(chatMessage)) {
                if (event.type === "text") {
                  output += event.content;
                } else if (event.type === "tool_call") {
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
              // A run that ended before the provider was ever called (a
              // cancellation during setup) has nothing to record: markStarted
              // was never reached, so this attempt leaves the row untouched.
              return { completed };
            });
          } catch (error) {
            if (error instanceof ChatAttemptBusyError) {
              return toolFailure(
                "ans_chat: 这段会话正在别处运行（" + error.sessionId + "）。等它结束后再试。",
              );
            }
            throw error;
          }
          // Background summary calls already ran on this session's behalf, so
          // their spend belongs on the ledger whatever ended the turn. Drain
          // before every exit path — an error or a cancellation must not leave
          // real spend unrecorded and later read as free. Fail-open: a drain
          // fault is reported by the runtime, never turned into a tool failure.
          await runtime.flushMemory().catch(() => {});
          // #264 (D9): read the rebuild attempts ONLY after the drain — a rebuild
          // is background work flushMemory() waits for, so reading earlier would
          // describe an attempt that had not run.
          summaryRebuilds = runtime.getSummaryRebuilds();
          // #264 (D9): say what happened to each suspended summary in the answer
          // text too. A host that only reads `content` must still learn that a
          // memory block is missing because a rebuild failed, not because the
          // session never had a summary.
          for (const r of summaryRebuilds) output += "\n" + formatSummaryRebuildLine(r);
          // An error is a failure even when background summary work completed.
          // The attempt already recorded itself as unfinished on the way out, so
          // nothing here needs to write that state a second time.
          if (runtimeError !== undefined) {
            return buildAnsChatErrorResult(runtimeError, summaryRebuilds, formatSummaryRebuildLine);
          }
          // An interrupted request keeps its handle and reports unknown usage.
          if (!attemptResult.completed) {
            return buildAnsChatResult("", memory.sessionId, {
              usage: {
                run: emptyRunUsage(INTERRUPTED_RUN_MISSING),
                memorySummary: runtime.getMemoryUsage(),
              },
              interrupted: true,
              // #264: the background rebuild did finish, so its outcome is a fact
              // about this call, not part of the dropped answer text.
              ...(summaryRebuilds.length > 0 ? { summaryRebuilds } : {}),
            });
          }
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
            ...(summaryRebuilds.length > 0 ? { summaryRebuilds } : {}),
          });
        } catch (e) {
          return toolError("ans_chat", e instanceof Error ? e.message : String(e));
        }
      }, {
        "anysearch.provider": providerName ?? "",
        "anysearch.model": modelName ?? "",
        // #300: which layer supplied each effective value, so a host can tell
        // whether a setting came from env, the project file or the user file.
        // Labels only — key material never enters observation attributes.
        "anysearch.llm.provider.source": cfg.sources.provider ?? "",
        "anysearch.llm.model.source": cfg.sources.model ?? "",
        "anysearch.llm.baseUrl.source": cfg.sources.baseUrl ?? "",
        "anysearch.llm.api.source": cfg.sources.api ?? "",
      });
    }
  );
}
