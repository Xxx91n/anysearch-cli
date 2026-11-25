// ans chat: interactive retrieval-augmented chat session.
// #258: uses the full PI AgentSession through PiAgentRuntime.
// uses createLlmSession deep module from kernel.
// LLM config resolves through the layered loader (cli > env > project > user >
// default): --llm.provider/--llm.model/--llm.base-url/--llm.api flags,
// ANS_LLM_* env, .ans/config.toml (whitelisted keys), ~/.ans/config.toml. Both
// config files fall back to the pre-#323 location while an upgrade has not
// finished, so the paths named here are the defaults, not the only answer.
// baseUrl shape: chat/responses include the version path (..../v1); messages excludes it (anthropic SDK appends /v1/messages).

import { PiAgentRuntime, createLlmSession, parseContextWindow, piSessionOptions, formatSummaryRebuildLine, resolvePiSessionDir, runChatAttempt, ChatAttemptBusyError, isDomainConstraintError } from "@anysearch-cli/kernel";
import { resolveActiveDomain } from "@anysearch-cli/store/local-service";
import type { DomainConfigPort, CompositionResult } from "@anysearch-cli/kernel";
import { createPersistentEngine, domainSearchDirs, searchCredentialSeam } from "../db";
import { createEngine } from "../composition";
import { formatLlmConfigFault, resolveLlmConfig, userConfigPath } from "../config-llm";
import { credentialFileWarning, domainTomlPath, loadDomainByNameIn, isDomainSchemaError, readUserCredentials, resolveConfigHome, resolveProjectContext, type BudgetBalance } from "@anysearch-cli/store";
import { parseChatArgv, selectChatSession, formatChatList, chatRecordReader } from "./chat-session";
import { wireChatMemory } from "./chat-memory";
import { wireChatTaskBudget } from "./chat-task-budget";
import { currentCliTask } from "../cli-task-context";
import { chooseChatCollision } from "./chat-collision";

export async function runChat(argv: string[]): Promise<number> {
  let flags, options;
  try { ({ flags, options } = parseChatArgv(argv)); }
  catch (error: any) { process.stderr.write(error.message + "\n"); return 2; }
  const query = options.retryInterrupted ? undefined : options.query;
  if (!options.retryInterrupted && !options.list && !(options.print ? query?.trim() : query)) {
    process.stderr.write('用法：ans chat [-p] [--continue | --session ID] "问题"\n接着问被打断的那轮：ans chat -c [--session ID]\n查看会话：ans chat --list [--unassigned]\n');
    return 2;
  }
  const printOnly = options.print || options.retryInterrupted;
  const logProgress = printOnly ? console.error : console.log;
  const project = resolveProjectContext();

  // Initialize retriever + domain over the DURABLE store (#129).
  // Design: use createPersistentEngine (ANS_DB_PATH, default
  // ~/.ans/anysearch.db) instead of createEngine — the latter falls back to
  // ":memory:", which would make the newly wired RAG adapter recall nothing at
  // all ("connected but always empty" is harder to diagnose than no wiring).
  // #306: three states, not one `||`. A name the operator declared (env or the
  // persisted selection) that cannot be resolved stops the command; the
  // product's own "default" convention falling back is the legal behaviour it
  // had before, and the engine says so on stderr.
  // `active.declared` is what tells the engine whether a missing TOML is a fault
  // or the product's own default convention; the engine refuses the first and
  // falls back on the second, so this path does not re-decide it.
  const active = resolveActiveDomain();
  const domainName = active.name;

  // Design: parse the user credential file once here, hand the result to
  // both consumers, and report its fault here — so a broken file is said once.
  // The model resolver also gets this `home`, since its endpoint-mismatch
  // warning names that path.
  const configHome = resolveConfigHome();
  const credentialFile = readUserCredentials({ home: configHome });
  const credentialFault = credentialFileWarning(credentialFile);
  if (credentialFault) process.stderr.write("[config] " + credentialFault + "\n");

  let engine: CompositionResult;
  let domain: DomainConfigPort;
  // sessions.domain is metadata only; record the domain actually in use so a
  // fallback run does not claim a domain that failed to load.
  let sessionDomain = domainName;
  // False only when the durable DB could not be opened at all; an in-memory
  // store must not be registered as a resumable session.
  let durableStore = true;
  try {
    engine = createPersistentEngine(domainName, { domainDeclared: active.declared, credentialsFile: credentialFile });
    domain = engine.config || loadDomainByNameIn(domainName, domainSearchDirs()) as DomainConfigPort;
  } catch (e: any) {
    // A configured-but-broken domain is a configuration error, not an
    // availability problem: fail closed instead of silently dropping the
    // operator's domain (allowlist / weights / compaction) to the default.
    // Same predicate as createEngine; the CLI top-level handler prints the
    // error and exits non-zero (#162). Missing domains and DB/IO faults keep
    // the fallback below.
    if (isDomainSchemaError(e) || isDomainConstraintError(e)) throw e;
    if (printOnly) {
      console.error("读取领域或打开持久库失败。 " + (e?.message || String(e)));
      return 1;
    }
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
      engine = createPersistentEngine(undefined, { credentialsFile: credentialFile });
    } catch (e2: any) {
      persistentOk = false;
      console.error("[warn] Durable database unavailable (" + (e2?.message || String(e2)) +
        "); continuing with an in-memory store — memory will NOT persist across runs.");
      // Design: 这条兜底也把解析好的 key 递给引擎 — exa 的工厂只按传进来的值分岔
      // （#500），不带 seam 的引擎会让有 key 的机器拿到免费额度臂。凭据文件还是上面
      // 那一份解析结果，不再读第二次。
      engine = createEngine(undefined, { searchCredentials: searchCredentialSeam(credentialFile) });
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

  let requestedSessionId: string | undefined;
  try {
    // PI owns full transcripts. A store row alone may only be a search or a
    // memory anchor, and is not proof that a conversation can be resumed.
    // The reader scans the record directory once and maps store ids to PI
    // handles in one place, so the list and a resume judge the same file.
    // Neither branch creates it twice: a brand-new chat needs no scan.
    if (options.list) {
      if (!durableStore || !store.listChatSessions) throw new Error("无法读取持久会话列表。");
      if (!options.unassigned && !project.root) throw new Error("无法确定当前项目。用 --list --unassigned 查看未归属会话。");
      const root = options.unassigned ? null : project.root;
      console.log(root ? "项目：" + root : "未归属会话（没有可靠的项目记录）");
      // A damaged row is still listed, with what is wrong with it: the user may
      // want to inspect or repair that file by hand.
      const readRecord = chatRecordReader(resolvePiSessionDir());
      for (const line of formatChatList(readRecord, store.listChatSessions(root))) {
        console.log(line);
      }
      return 0;
    }
    // Design: 脚本模式拿到锁后再查记录 — 正在写第一轮时，要报占用。
    requestedSessionId = selectChatSession(store, options, project.root,
      printOnly ? undefined : chatRecordReader(resolvePiSessionDir()));
    if (!durableStore && requestedSessionId) throw new Error("持久库不可用，无法恢复会话。");
  } catch (error: any) { process.stderr.write(error.message + "\n"); return 1; }

  // Resolve LLM config: CLI flag > env > project > user > default.
  const cfg = resolveLlmConfig({ home: configHome, flags, credentialsFile: credentialFile });
  if (!cfg.provider || !cfg.model) {
    const configFault = formatLlmConfigFault(cfg);
    if (configFault) {
      process.stderr.write(configFault + "\n");
      return 3;
    }
    process.stderr.write("LLM provider not configured.\n");
    process.stderr.write("Set with: ans llm set anthropic claude-sonnet-4-6  (writes " + userConfigPath() + ")\n");
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

  // Stable session id + FK registration (#129) — see wireChatMemory.
  // #187: pass the Active Domain's optional [budget] so registration also
  // creates the ledger row (absent section = no row = unmetered).
  // #178: pass the engine's ledger (same store connection) so the runtime's
  // agent-loop usage settles into the real budget row instead of a dead port.
  // The wiring helper drops it when registration fails open.
  const previousSession = requestedSessionId ? store.getChatSession?.(requestedSessionId) : undefined;
  let memory = durableStore
    ? await wireChatMemory(store, sessionDomain, domain.budget, engine.ledger, requestedSessionId)
    : {};

  if (!memory.sessionId && (printOnly || requestedSessionId)) {
    process.stderr.write(requestedSessionId
      ? "会话恢复失败，本次没有发送问题。\n"
      : "无法保存这段会话，本次没有发送问题。\n");
    return 1;
  }
  // The attempt's project. A resumed conversation keeps the project it already
  // belongs to; a new one takes the directory it started in.
  const attemptProject = previousSession ? previousSession.projectRoot : project.root;
  if (memory.sessionId) logProgress("[session] " + memory.sessionId);
  if (!project.root) process.stderr.write("[提示] 无法确定当前项目，不能自动选择最近会话。\n");

  // The attempt's lease and the runtime's run lock guard the same session, so
  // they must read the SAME windows: an operator (or a test) shortening
  // ANS_PI_LOCK_STALE_MS expects an abandoned lease to clear on that shorter
  // window too.
  const sessionWiring = piSessionOptions(durableStore ? memory.sessionId : undefined, session.apiKey);
  // Filled in when the attempt starts; the runtime's onRunStart reads it.
  let startedAttempt: { markStarted(): void } | undefined;

  // #302: one execution, one budget. The task id comes from the dispatch-level
  // registration (index.ts registers every CLI command); wireChatMemory above
  // still registers the session row and refreshes the session budget as
  // before — the conversation's history keeps it. This run's spend —
  // the agent loop, compaction, summary/re-judge, late settlement and internal
  // searches — lands on the task's own budget row instead, so resuming this
  // conversation later spends none of the history's quota.
  // A declared [budget] that cannot be established here returns a fault, and
  // the runtime stops the run before any provider call (the old fail-open
  // behavior stays for the session form).
  const cliTask = currentCliTask();
  const taskBudgetWiring = wireChatTaskBudget(store, cliTask?.taskId, domain.budget, {
    // Every corner where an UNDECLARED domain cannot be metered prints here, so
    // a degraded run never looks like a healthy unmetered one. The `[warn]`
    // prefix matches the CLI's other warnings; a dead stderr must not abort the
    // command, which is why the write is guarded.
    warn: (m) => {
      try { process.stderr.write("[warn] " + m + "\n"); } catch { /* a dead stderr must not break the run */ }
    },
    fallbackText: "this run falls back to the session account",
  });
  // Design: 脚本模式需要能按任务记账 — 持久库出错时，不能换个库放行付费请求。
  const taskBudgetFault = taskBudgetWiring.taskBudgetFault ??
    (printOnly && !taskBudgetWiring.taskBudget ? "no task budget scope was established" : undefined);
  // Best-effort context link: which conversation this task ran under. The
  // task bills on its own, but "which session was this" is what diagnostics
  // and upgrade admission (#309) will want to read off the task record.
  const attachSessionToTask = (id: string | undefined) => {
    if (cliTask && id) { try { cliTask.attachSession(id); } catch { /* best-effort link */ } }
  };
  attachSessionToTask(memory.sessionId);

  // #299: the whole attempt runs under the lease, so its two chat_projects
  // writes cannot interleave with another attempt on the same session. The
  // runtime still takes its own run lock inside; this wraps it rather than
  // moving it, so the JSONL append keeps the guarantee it already had.
  let attemptExitCode = 0;
  let bufferedAnswer = "";
  try {
    await runChatAttempt({
      store: durableStore ? store : undefined,
      sessionId: memory.sessionId,
      projectRoot: attemptProject,
      piSessionDir: durableStore && memory.sessionId ? resolvePiSessionDir() : undefined,
      // Same windows the run lock reads, so a shortened stale window applies to
      // an abandoned lease too.
      sessionLock: sessionWiring.sessionLock,
      onBusy: printOnly ? undefined : chooseChatCollision,
    }, async (attempt) => {
      startedAttempt = attempt;
      if (attempt.sessionId && attempt.sessionId !== memory.sessionId) {
        const forkMemory = await wireChatMemory(store, sessionDomain, domain.budget, engine.ledger, attempt.sessionId);
        if (forkMemory.sessionId !== attempt.sessionId) throw new Error("新会话登记失败，本次没有发送问题。");
        memory = forkMemory;
        attachSessionToTask(attempt.sessionId);
        console.log("[session] 已 fork，新句柄：" + memory.sessionId);
      }
      const cancellation = new AbortController();
      const interrupt = () => cancellation.abort();
      const listenForInterrupt = () => {
        process.off("SIGINT", interrupt);
        process.on("SIGINT", interrupt);
      };
      // Construct PiAgentRuntime and run.
      // models undefined fix — session.models is now properly initialized.
      const runtime = new PiAgentRuntime({
        signal: cancellation.signal,
        retriever,
        domain,
        // store + sessionId together are what make PiAgentRuntime build the
        // MemoryPipeline (#129): RAG Stage-1 injection and L1/L2 memory now run on
        // the real `ans chat` path instead of being silently skipped.
        ...memory,
        // lazy mtime re-read lets `ans hitl --allow-url` write-back take effect live.
        domainTomlPath: domainTomlPath(undefined, engine.domainName ?? "default", engine.domainsDirs),
        // Only a domain the engine actually loaded makes a missing TOML a fault.
        domainDeclared: engine.domainName !== undefined && engine.domainDeclared === true,
        // #188: same dirs the engine loaded the domain from, so the run-boundary
        // reloader can still resolve inherited base TOMLs.
        domainsDirs: engine.domainsDirs,
        // CLI is the place that decides TTY; kernel decides isInteractive itself.
        interactive: !printOnly && !process.env.ANS_NO_INTERACTIVE,
        model: session.model,
        // #113: real window for the L0 watermark; undefined for an unconfigured
        // custom endpoint -> absolute 128000 fallback.
        contextWindow: session.contextWindow,
        streamFn: session.streamFn,
        models: session.models,
        getApiKey: async () => session.apiKey,
        // PI owns the session record; key it by the same stable handle the store
        // uses so an explicit continuation restores the full conversation.
        // A store-less run has no resumable handle, so it stays in memory.
        ...piSessionOptions(durableStore ? memory.sessionId : undefined, session.apiKey),
        ...(printOnly ? { sessionLock: { ...sessionWiring.sessionLock, waitMs: 0 } } : {}),
        requirePiSessionRecord: !!requestedSessionId,
        // #299: the runtime names the exact moment the provider is reached. The
        // attempt is recorded from there, so a request cancelled before its first
        // token still counts as one that ran, while a request refused before the
        // prompt (cancelled caller, exhausted budget) records nothing.
        // The attempt context arrives when runChatAttempt starts, which is after
        // this object is built, so it is read through this slot.
        onRunStart: () => startedAttempt?.markStarted(),
        // #302: this execution's own budget — reserves and settles route to the
        // task's ledger, and internal searches carry the scope (the engine bills
        // the task instead of the session). Absent → session form, unchanged.
        taskBudget: taskBudgetWiring.taskBudget,
        taskBudgetFault,
        enforceTaskBudgetPerCall: printOnly,
        includeAnswer: printOnly,
      });
      if (!printOnly) {
        console.log("ans chat: " + query);
        console.log("---");
      }

      let completed = false;
      // The body returns the attempt's outcome, not the process exit code: a
      // run error is still an attempt that must be recorded as unfinished, and
      // the code is applied after the lease is handed back.
      let failed = false;
      let startedStreaming = false;
      listenForInterrupt();
      try {
        for await (const event of runtime.run(query, attempt)) {
          switch (event.type) {
            case "session_recovery":
              console.error(event.notice);
              break;
            case "text":
              if (!startedStreaming) {
                // Design: 输出前重新监听 SIGINT — 模型初始化后要确保 Ctrl-C 能走收尾。
                listenForInterrupt();
                startedStreaming = true;
              }
              if (!printOnly) process.stdout.write(event.content);
              break;
            case "tool_call":
              logProgress("\n[tool: " + event.name + "] " + JSON.stringify(event.args));
              break;
            case "tool_result":
              logProgress("[result: " + event.name + "]");
              break;
            case "search":
              logProgress("\n[search: " + event.query + "]");
              break;
            case "search_result":
              logProgress("[search done]");
              break;
            case "done":
              // 完成记录说的是模型这一轮是否跑完。脚本退出码还要看有没有答案。
              completed = true;
              if (printOnly) {
                if (event.answer?.trim()) {
                  const sources = event.sources?.length ? "\n\n来源\n- " + event.sources.join("\n- ") : "";
                  bufferedAnswer = event.answer.trimEnd() + sources + "\n";
                }
                break;
              }
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
              failed = true;
              break;
          }
          if (failed) break;
        }
      } catch (e: any) {
        console.error("[error] " + (e?.message || String(e)));
        failed = true;
      } finally {
        if (!printOnly) process.off("SIGINT", interrupt);
        // Design: drain background anchor writes before the CLI closes this store
        // (runTeardown runs on exit). consolidate() is fire-and-forget by design, so
        // returning here without waiting loses the rolling_summary / l2_recall write.
        try {
          await runtime.flushMemory();
        } catch (error) {
          if (bufferedAnswer) process.stderr.write("模型已答完，但收尾出错，本次没有输出答案。\n");
          throw error;
        } finally {
          if (printOnly) process.off("SIGINT", interrupt);
        }
        // #264 (D9): a suspended summary was either rebuilt from current sources or
        // it was not. Read AFTER the drain (a rebuild is background work the drain
        // waits for) and say it in plain words, so an empty memory block is not read
        // as "there was never a summary".
        for (const r of runtime.getSummaryRebuilds()) logProgress(formatSummaryRebuildLine(r));
        // Summary calls are a separate, real cost; report them apart from the run.
        // The reuse/compress adjudication is its own book (D4 重判): one judgment
        // call must not read as a summary the summarizer never made.
        const memoryUsage = runtime.getMemoryUsage();
        if (memoryUsage && memoryUsage.calls > 0) {
          logProgress(
            "[usage] memory-summary calls=" + memoryUsage.calls +
            " in=" + memoryUsage.inputTokens + " out=" + memoryUsage.outputTokens +
            " total=" + memoryUsage.totalTokens + " costUsd=" + memoryUsage.costUsd +
            (memoryUsage.missing.length ? " MISSING=" + memoryUsage.missing.join(",") : ""),
          );
        }
        const adjudicationUsage = memoryUsage?.adjudication;
        if (adjudicationUsage && adjudicationUsage.calls > 0) {
          logProgress(
            "[usage] memory-adjudication calls=" + adjudicationUsage.calls +
            " in=" + adjudicationUsage.inputTokens + " out=" + adjudicationUsage.outputTokens +
            " total=" + adjudicationUsage.totalTokens + " costUsd=" + adjudicationUsage.costUsd +
            (adjudicationUsage.missing.length ? " MISSING=" + adjudicationUsage.missing.join(",") : ""),
          );
        }
        // #302: this execution's own budget, read AFTER the drain so compaction,
        // summary/re-judge and late settlement are already on the row. What the
        // run spent vs the caps the domain declared for THIS task — the
        // conversation's history is a different row in a different table, so the
        // two reports can never blur. A nonzero reserve here is in-flight or
        // fault-left work, not part of the spend: reported, not hidden.
        const taskBudgetScope = taskBudgetWiring.taskBudget;
        if (taskBudgetScope) {
          const taskBalance = taskBudgetScope.ledger.getBalance(taskBudgetScope.taskId);
          if (taskBalance) {
            logProgress(
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
          logProgress(
            "[session-budget] conversation history: tokens=" + sessionBalance.spentTokens + "/" + sessionBalance.tokenCap +
            " calls=" + sessionBalance.billableCalls + "/" + sessionBalance.callCap +
            " usd=" + sessionBalance.spentUsd + "/" + sessionBalance.usdCap +
            " — CLI chats no longer spend this account",
          );
        }
      }
      // The attempt's own record now says finished only when the run reached
      // its end; a run that errored or was cancelled keeps the unfinished row.
      if (cancellation.signal.aborted) {
        if (bufferedAnswer) process.stderr.write("模型已答完，但收尾时被中断，本次没有输出答案。\n");
        attemptExitCode = 130;
      } else if (failed) attemptExitCode = 1;
      else if (printOnly && !bufferedAnswer) {
        process.stderr.write("模型没有返回答案。\n");
        attemptExitCode = 1;
      }
      return { completed: completed && !failed && !cancellation.signal.aborted };
    });
  } catch (error: any) {
    // One wording for "another attempt has this session right now". It is not a
    // crash and not a usage error: the same command works once the other run
    // ends, so the message says exactly that, names the handle to try, and
    // names the lease directory a person can clear once that process is gone.
    if (error instanceof ChatAttemptBusyError) {
      process.stderr.write(
        "这段会话正在别处运行（" + error.sessionId + "）。等它结束后再试。"
        + "如果确认那个进程已经不在，删掉 " + error.leasePath + " 这个目录再试。\n",
      );
      return 1;
    }
    throw error;
  }
  if (printOnly && attemptExitCode === 0) process.stdout.write(bufferedAnswer);
  return attemptExitCode;
}
