// ans chat: interactive retrieval-augmented chat session.
// decision 7: uses PiAgentRuntime for agent loop.
// uses createLlmSession deep module from kernel.
// LLM config resolves through the layered loader (cli > env > project > user >
// default; #108): --llm.provider/--llm.model/--llm.base-url/--llm.api flags,
// ANS_LLM_* env, .anysearch/config.toml (whitelisted keys), ~/.anysearch-cli/config.toml.
// baseUrl shape: chat/responses include the version path (..../v1); messages excludes it (anthropic SDK appends /v1/messages).

import { PiAgentRuntime, createLlmSession, parseContextWindow } from "@anysearch-cli/kernel";
import type { DomainConfigPort, CompositionResult } from "@anysearch-cli/kernel";
import { createPersistentEngine, domainSearchDirs } from "../db";
import { createEngine } from "../composition";
import { parseLlmFlags, resolveLlmConfig } from "../config-llm";
import { domainTomlPath, loadDomainByNameIn, isDomainSchemaError } from "@anysearch-cli/store";
import { wireChatMemory } from "./chat-memory";

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
      // #113: custom endpoints have no catalog window; the composition root
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
    domainTomlPath: domainTomlPath(),
    // #188: same dirs the engine loaded the domain from, so the run-boundary
    // reloader can still resolve inherited base TOMLs.
    domainsDirs: engine.domainsDirs,
    // CLI is the TTY composition root; kernel decides isInteractive itself.
    interactive: !process.env.ANS_NO_INTERACTIVE,
    model: session.model,
    // #113: real window for the L0 watermark; undefined for an unconfigured
    // custom endpoint -> absolute 128000 fallback.
    contextWindow: session.contextWindow,
    streamFn: session.streamFn,
    models: session.models,
    getApiKey: async () => session.apiKey,
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
  }

  return 0;
}
