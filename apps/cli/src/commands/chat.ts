// ans chat: interactive retrieval-augmented chat session.
// #258: uses the full PI AgentSession through PiAgentRuntime.
// uses createLlmSession deep module from kernel.
// LLM config resolves through the layered loader (cli > env > project > user >
// default; #108): --llm.provider/--llm.model/--llm.base-url/--llm.api flags,
// ANS_LLM_* env, .anysearch/config.toml (whitelisted keys), ~/.anysearch-cli/config.toml.
// baseUrl shape: chat/responses include the version path (..../v1); messages excludes it (anthropic SDK appends /v1/messages).

import { PiAgentRuntime, createLlmSession, parseContextWindow, piSessionOptions, formatSummaryRebuildLine } from "@anysearch-cli/kernel";
import type { DomainConfigPort, CompositionResult } from "@anysearch-cli/kernel";
import { createPersistentEngine, domainSearchDirs } from "../db";
import { createEngine } from "../composition";
import { parseLlmFlags, resolveLlmConfig } from "../config-llm";
import { domainTomlPath, loadDomainByNameIn, isDomainSchemaError, type BudgetBalance } from "@anysearch-cli/store";
import { wireChatMemory } from "./chat-memory";
import { wireChatTaskBudget } from "./chat-task-budget";
import { currentCliTask } from "../cli-task-context";

export async function runChat(argv: string[]): Promise<number> {
  const { flags, argv: args } = parseLlmFlags(argv);
  // Parse query from args.
  const query = args.join(" ");
  if (!query) {
    process.stderr.write("Usage: ans chat [--llm.provider P] [--llm.model M] [--llm.base-url U --llm.api KIND] [query]\n");
    process.stderr.write("Example: ans chat \"What is RRF fusion?\"\n");
    return 2;
  }

  // Resolve LLM config: CLI flag > env > project > user > default.
  const cfg = resolveLlmConfig({ flags });
  if (!cfg.provider || !cfg.model) {
    process.stderr.write("LLM provider not configured.\n");
    process.stderr.write("Set with: ans llm set anthropic claude-sonnet-4-6  (writes ~/.anysearch-cli/config.toml)\n");
    process.stderr.write("Or:       export ANS_LLM_PROVIDER=anthropic ANS_LLM_MODEL=claude-sonnet-4-6\n");
    return 3;
  }

  // Initialize LLM session via kernel deep module.
  let session;
  try {
    // custom endpoint config — api is required when baseUrl is set (explicit
    // three-way; no protocol sniffing; loader already warned on a bare baseUrl,
    // createLlmSession is the fail-closed backstop). cfg.apiKey supplies the
    // secret via env_key indirection or ANS_LLM_API_KEY.
    session = await createLlmSession({
      provider: cfg.provider, model: cfg.model, baseUrl: cfg.baseUrl, api: cfg.api, apiKey: cfg.apiKey,
      // #113: custom endpoints have no catalog window; the wiring
      // reads the env here (kernel stays env-free). Unknown window -> 128000.
      contextWindow: parseContextWindow(process.env.ANS_LLM_CONTEXT_WINDOW),
    });
  } catch (e: any) {
    process.stderr.write("Failed to initialize LLM: " + (e?.message || String(e)) + "\n");
    return 3;
  }

  // Initialize retriever + domain over the DURABLE store (#129).
  // Design: use createPersistentEngine (ANS_DB_PATH, default
  // ~/.anysearch/anysearch.db) instead of createEngine — the latter falls back to
  // ":memory:", which would make the newly wired RAG adapter recall nothing at
  // all ("connected but always empty" is harder to diagnose than no wiring).
  const domainName = process.env.ANS_DOMAIN || "default";
  let engine: CompositionResult;
  let domain: DomainConfigPort;
  // sessions.domain is metadata only; record the domain actually in use so a
  // fallback run does not claim a domain that failed to load.
  let sessionDomain = domainName;
  // False only when the durable DB could not be opened at all; an in-memory
  // store must not be registered as a resumable session.
  let durableStore = true;
  try {
    engine = createPersistentEngine(domainName);
    domain = engine.config || loadDomainByNameIn(domainName, domainSearchDirs()) as DomainConfigPort;
  } catch (e: any) {
    // A configured-but-broken domain is a configuration error, not an
    // availability problem: fail closed instead of silently dropping the
    // operator's domain (allowlist / weights / compaction) to the default.
    // Same predicate as createEngine; the CLI top-level handler prints the
    // error and exits non-zero (#162). Missing domains and DB/IO faults keep
    // the fallback below.
    if (isDomainSchemaError(e)) throw e;
    console.error("[warn] Domain load failed: " + (e?.message || String(e)) + ", using fallback.");
    // Fallback: no domain filtering, all providers — still on the durable DB so
    // memory reads keep working across runs.
    // Design: if the durable DB itself is unavailable, degrade to the in-memory
    // engine rather than failing the run — `ans chat` must still answer, it just
    // loses persistence (and the memory wiring is then skipped, since an
    // in-memory store cannot be resumed). Losing chat entirely is the worse
    // trade; the warning says exactly what was lost.
    let persistentOk = true;
    try {
      engine = createPersistentEngine();
    } catch (e2: any) {
      persistentOk = false;
      console.error("[warn] Durable database unavailable (" + (e2?.message || String(e2)) +
        "); continuing with an in-memory store — memory will NOT persist across runs.");
      engine = createEngine();
    }
    durableStore = persistentOk;
    sessionDomain = "default";
    domain = {
      sources: { enabled: [] },
      prompts: [],
      skills: { active: ["search"] },
      hooks: { toolWhitelist: ["search"] },
      rag: { adapter: "none" },
    };
  }
  const { retriever, store } = engine;

  // Stable session id + FK registration (#129) — see wireChatMemory.
  // #187: pass the Active Domain's optional [budget] so registration also
  // creates the ledger row (absent section = no row = unmetered).
  // #178: pass the engine's ledger (same store connection) so the runtime's
  // agent-loop usage settles into the real budget row instead of a dead port.
  // The wiring helper drops it when registration fails open.
  const memory = durableStore
    ? await wireChatMemory(store, sessionDomain, domain.budget, engine.ledger)
    : {};

  // #302: one execution, one budget. The task id comes from the dispatch-level
  // registration (index.ts registers every CLI command); wireChatMemory above
  // still registers the session row and refreshes the session budget as
  // before — the conversation's history and the callers that have not
  // migrated (MCP ans_chat, #303) keep the session form. This run's spend —
  // the agent loop, compaction, summary/re-judge, late settlement and internal
  // searches — lands on the task's own budget row instead, so resuming this
  // conversation later spends none of the history's quota.
  // A declared [budget] that cannot be established here returns a fault, and
  // the runtime stops the run before any provider call (the old fail-open
  // behavior stays for the session form until #303/#304).
  const cliTask = currentCliTask();
  const taskBudgetWiring = wireChatTaskBudget(store, cliTask?.taskId, domain.budget);
  // Best-effort context link: which conversation this task ran under. The
  // task bills on its own, but "which session was this" is what diagnostics
  // and upgrade admission (#309) will want to read off the task record.
  if (cliTask && memory.sessionId) {
    try { cliTask.attachSession(memory.sessionId); } catch { /* best-effort link */ }
  }

  // Construct PiAgentRuntime and run.
  // models undefined fix — session.models is now properly initialized.
  const runtime = new PiAgentRuntime({
    retriever,
    domain,
    // store + sessionId together are what make PiAgentRuntime build the
    // MemoryPipeline (#129): RAG Stage-1 injection and L1/L2 memory now run on
    // the real `ans chat` path instead of being silently skipped.
    ...memory,
    // lazy mtime re-read lets `ans hitl --allow-url` write-back take effect live.
    domainTomlPath: domainTomlPath(undefined, engine.domainName, engine.domainsDirs),
    // #188: same dirs the engine loaded the domain from, so the run-boundary
    // reloader can still resolve inherited base TOMLs.
    domainsDirs: engine.domainsDirs,
    // CLI is the place that decides TTY; kernel decides isInteractive itself.
    interactive: !process.env.ANS_NO_INTERACTIVE,
    model: session.model,
    // #113: real window for the L0 watermark; undefined for an unconfigured
    // custom endpoint -> absolute 128000 fallback.
    contextWindow: session.contextWindow,
    streamFn: session.streamFn,
    models: session.models,
    getApiKey: async () => session.apiKey,
    // PI owns the session record; key it by the same stable handle the store
    // uses so a later `ans chat` resumes the conversation, not just the anchors.
    // A store-less run has no resumable handle, so it stays in memory.
    ...piSessionOptions(durableStore ? memory.sessionId : undefined, session.apiKey),
    // #302: this execution's own budget — reserves and settles route to the
    // task's ledger, and internal searches carry the scope (the engine bills
    // the task instead of the session). Absent → session form, unchanged.
    taskBudget: taskBudgetWiring.taskBudget,
    taskBudgetFault: taskBudgetWiring.taskBudgetFault,
  });

  console.log("ans chat: " + query);
  console.log("---");

  try {
    for await (const event of runtime.run(query)) {
      switch (event.type) {
        case "text":
          process.stdout.write(event.content);
          break;
        case "tool_call":
          console.log("\n[tool: " + event.name + "] " + JSON.stringify(event.args));
          break;
        case "tool_result":
          console.log("[result: " + event.name + "]");
          break;
        case "search":
          console.log("\n[search: " + event.query + "]");
          break;
        case "search_result":
          console.log("[search done]");
          break;
        case "done":
          console.log("\n---");
          console.log(event.summary);
          if (event.recovery) console.log("\n" + event.recovery);
          // Report the run's own accounting; a dimension the provider
          // never reported is named instead of zero-filled into "free".
          if (event.usage) {
            const u = event.usage;
            console.log(
              "[usage] calls=" + u.assistantCalls +
              " in=" + u.inputTokens + " out=" + u.outputTokens +
              " cacheRead=" + u.cacheReadTokens + " cacheWrite=" + u.cacheWriteTokens +
              " total=" + u.totalTokens + " costUsd=" + u.costUsd + "(" + u.costSource + ")" +
              " compaction=" + u.compactionCalls + "/" + u.compactionTokens + "tok/" + u.compactionCostUsd + "usd" +
              (event.context ? " window=" + event.context.window + " ctxTokens=" + (event.context.tokens ?? "unknown") : "") +
              (u.missing.length ? " MISSING=" + u.missing.join(",") : ""),
            );
          }
          break;
        case "error":
          console.error("\n[error] " + event.message);
          return 1;
      }
    }
  } catch (e: any) {
    console.error("[error] " + (e?.message || String(e)));
    return 1;
  } finally {
    // Design: drain background anchor writes before the CLI closes this store
    // (runTeardown runs on exit). consolidate() is fire-and-forget by design, so
    // returning here without waiting loses the rolling_summary / l2_recall write.
    await runtime.flushMemory();
    // #264 (D9): a suspended summary was either rebuilt from current sources or
    // it was not. Read AFTER the drain (a rebuild is background work the drain
    // waits for) and say it in plain words, so an empty memory block is not read
    // as "there was never a summary".
    for (const r of runtime.getSummaryRebuilds()) console.log(formatSummaryRebuildLine(r));
    // Summary calls are a separate, real cost; report them apart from the run.
    // The reuse/compress adjudication is its own book (D4 重判): one judgment
    // call must not read as a summary the summarizer never made.
    const memoryUsage = runtime.getMemoryUsage();
    if (memoryUsage && memoryUsage.calls > 0) {
      console.log(
        "[usage] memory-summary calls=" + memoryUsage.calls +
        " in=" + memoryUsage.inputTokens + " out=" + memoryUsage.outputTokens +
        " total=" + memoryUsage.totalTokens + " costUsd=" + memoryUsage.costUsd +
        (memoryUsage.missing.length ? " MISSING=" + memoryUsage.missing.join(",") : ""),
      );
    }
    const adjudicationUsage = memoryUsage?.adjudication;
    if (adjudicationUsage && adjudicationUsage.calls > 0) {
      console.log(
        "[usage] memory-adjudication calls=" + adjudicationUsage.calls +
        " in=" + adjudicationUsage.inputTokens + " out=" + adjudicationUsage.outputTokens +
        " total=" + adjudicationUsage.totalTokens + " costUsd=" + adjudicationUsage.costUsd +
        (adjudicationUsage.missing.length ? " MISSING=" + adjudicationUsage.missing.join(",") : ""),
      );
    }
    // #302: this execution's own budget, read AFTER the drain so compaction,
    // summary/re-judge and late settlement are already on the row. What the run
    // spent vs the caps the domain declared for THIS task — the conversation's
    // history is a different row in a different table, so the two reports can
    // never blur. A nonzero reserve here is in-flight or fault-left work, not
    // part of the spend: reported, not hidden.
    const taskBudgetScope = taskBudgetWiring.taskBudget;
    if (taskBudgetScope) {
      const taskBalance = taskBudgetScope.ledger.getBalance(taskBudgetScope.taskId);
      if (taskBalance) {
        console.log(
          "[task-budget] this execution: tokens=" + taskBalance.spentTokens + "/" + taskBalance.tokenCap +
          " calls=" + taskBalance.billableCalls + "/" + taskBalance.callCap +
          " usd=" + taskBalance.spentUsd + "/" + taskBalance.usdCap +
          (taskBalance.reservedTokens > 0 ? " reserved=" + taskBalance.reservedTokens + "tok (still in flight or left by a fault)" : ""),
        );
      }
    }
    // S5: this-run and cumulative are reported apart. The conversation's own
    // account is the session row — CLI chats no longer spend it, so what it
    // shows is the history this conversation accumulated before the task form
    // (or through its unmigrated callers). Only printed when the row exists:
    // an undeclared domain has no session row and no account to report.
    // The ledger's port shape carries no read seam; the concrete engine
    // ledger does have getBalance, and the cast says exactly that.
    const sessionLedgerView = engine.ledger as { getBalance?: (sessionId: string) => BudgetBalance | null } | undefined;
    const sessionBalance = memory.sessionId ? sessionLedgerView?.getBalance?.(memory.sessionId) : null;
    if (sessionBalance) {
      console.log(
        "[session-budget] conversation history: tokens=" + sessionBalance.spentTokens + "/" + sessionBalance.tokenCap +
        " calls=" + sessionBalance.billableCalls + "/" + sessionBalance.callCap +
        " usd=" + sessionBalance.spentUsd + "/" + sessionBalance.usdCap +
        " — CLI chats no longer spend this account",
      );
    }
  }

  return 0;
}
