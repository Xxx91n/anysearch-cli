// #303 acceptance — the MCP `ans_chat` call is one task with its own budget.
//
// What this pins, in the order the cases run:
//   1. one call registers ONE task (`mcp.ans_chat`) and ONE task budget row;
//      the run's spend lands there, and the conversation's own `budget_ledger`
//      row is never opened — the handle is context, not the quota owner (S5)
//   2. resuming that handle makes a SECOND task with a SECOND budget: history
//      quota is not spent by the resumed turn
//   3. a handle-less call starts a new conversation and a new task
//   4. a budget refusal is a structured answer (`errorKind: budget-rejected`),
//      not an upstream failure, and no provider call happens
//   5. a declared budget that cannot be established is its own structured
//      answer (`errorKind: budget-not-established`), also with no call
//   6. a cancelled request still finishes its late work before the task closes:
//      the answer reports `interrupted`, and the closeout says the task ended
//   7. a search tool registers its own task too (#304 migrated it)
//
// Offline by construction: a faux pi-ai session answers locally, the store is a
// temp SQLite file, and every env that could steer writes into the operator's
// real home is redirected (the #322 guard at the end checks it).
//
// Run: pnpm --filter @anysearch-cli/mcp test

import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { createFauxCore, fauxAssistantMessage, fauxText } from "@earendil-works/pi-ai";
import { SqliteSessionStore, type BudgetConfig } from "@anysearch-cli/store";
import type { CompositionResult } from "@anysearch-cli/kernel";
import { toolDomainStop } from "../src/tools/task-budget.js";
import type { FusedEnvelope } from "@anysearch-cli/retriever";
import type { McpServer } from "@modelcontextprotocol/server";
import { createMcpToolState, type AnsChatSessionFactory } from "../src/tool-state.js";
import { registerAnsChat } from "../src/tools/ans-chat.tool.js";
import { registerSearchWeb } from "../src/tools/search-web.tool.js";
import { resetMcpTaskWarnings, withMcpTask } from "../src/mcp-task.js";
import { resetAnsChatDegradedWarnings } from "../src/tools/ans-chat.tool.js";

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error("FAIL: " + msg);
  }
}

// #322 regression guard: PI session records under a dir (empty if absent).
function piRecords(dir: string): string[] {
  try {
    return readdirSync(dir).filter((f) => f.endsWith(".jsonl")).sort();
  } catch {
    return [];
  }
}

const ENV_KEYS = [
  "ANS_LLM_PROVIDER",
  "ANS_LLM_MODEL",
  "ANS_LLM_BASE_URL",
  "ANS_LLM_API",
  "ANS_LLM_API_KEY",
  "ANS_LLM_CONTEXT_WINDOW",
  "ANS_DB_PATH",
  "ANS_PI_SESSION_DIR",
  "HOME",
  "USERPROFILE",
];

const emptyEnvelope: FusedEnvelope = {
  results: [],
  answers: [],
  metadata: { providersQueried: [], providersFailed: [], providersCancelled: [], elapsedMs: 0, outcome: "empty" },
};

const fakeSpan: any = {
  traceId: "t303",
  spanId: "s303",
  addEvent: () => {},
  setAttributes: () => {},
  startSpan: async (_o: any, cb: any) => cb(fakeSpan),
  finish: () => {},
};

type Handler = (args: unknown, ctx?: { mcpReq?: { signal?: AbortSignal } }) => Promise<any>;

interface Captured {
  ans_chat: Handler;
  search_web: Handler;
}

function capture(eng: CompositionResult, state = createMcpToolState()): Captured {
  const handlers: Record<string, Handler> = {};
  const fakeServer = {
    registerTool: (name: string, _config: unknown, fn: Handler) => {
      handlers[name] = fn;
    },
  } as unknown as McpServer;
  registerAnsChat(fakeServer, eng, state);
  registerSearchWeb(fakeServer, eng);
  if (!handlers.ans_chat) throw new Error("ans_chat was not registered");
  return handlers as unknown as Captured;
}

interface EngineOpts {
  budget?: BudgetConfig;
  /**
   * #303: the domain TOML this engine would have loaded. The runtime re-reads
   * that file at every run boundary and re-applies its [budget], so a test
   * engine whose `config.budget` disagrees with the file on disk would have its
   * caps replaced mid-test (the file wins). Pointing the engine at a temp
   * domain keeps the two sources saying the same thing, which is also what
   * production does.
   */
  domainName?: string;
  domainsDirs?: string[];
  onSearch?: () => void;
  /** Receives each observation record the engine is asked to write. */
  onObserve?: (record: any) => void;
}

function makeEngine(store: unknown, opts: EngineOpts = {}): CompositionResult {
  return {
    retriever: {
      search: async (): Promise<FusedEnvelope> => {
        opts.onSearch?.();
        return emptyEnvelope;
      },
    },
    store,
    observation: {
      recordOperation: async (o: any, cb: any) => {
        opts.onObserve?.(o);
        return cb(fakeSpan);
      },
    },
    ...(opts.domainName ? { domainName: opts.domainName } : {}),
    ...(opts.domainsDirs ? { domainsDirs: opts.domainsDirs } : {}),
    ...(opts.budget
      ? {
        config: {
          sources: { enabled: [] },
          prompts: [],
          skills: { active: [] },
          hooks: { toolWhitelist: [] },
          rag: { adapter: "none" },
          budget: opts.budget,
        },
      }
      : {}),
  } as unknown as CompositionResult;
}

function readRows<T>(dbPath: string, sql: string, ...params: unknown[]): T[] {
  const db = new Database(dbPath, { readonly: true });
  try {
    return db.prepare(sql).all(...params) as T[];
  } finally {
    db.close();
  }
}

interface TaskRow {
  id: string;
  kind: string;
  ended: string | null;
  code: number | null;
  session: string | null;
}

const TASKS_SQL =
  "SELECT task_id as id, kind, ended_at as ended, exit_code as code, session_id as session FROM task_records ORDER BY rowid";

interface TaskBudgetRow {
  id: string;
  calls: number;
  spent: number;
  reserved: number;
  configured: number;
}

const TASK_BUDGETS_SQL =
  "SELECT task_id as id, billable_calls as calls, spent_tokens as spent, reserved_tokens as reserved, configured FROM task_budgets ORDER BY rowid";

/** A faux pi-ai session answering "pong" once per prompt; records each call. */
function makeAnsweringFactory(seen: Array<unknown>) {
  let constructed = 0;
  const factory: AnsChatSessionFactory = async (opts) => {
    constructed++;
    const faux = createFauxCore({ provider: opts.provider, models: [{ id: opts.model }] });
    faux.setResponses(Array.from({ length: 8 }, () => (ctx: any) => {
      seen.push(JSON.parse(JSON.stringify(ctx?.messages ?? [])));
      return fauxAssistantMessage(fauxText("pong"));
    }));
    return {
      model: faux.getModel(),
      streamFn: faux.streamSimple,
      models: faux,
      providerName: opts.provider,
      modelName: opts.model,
      apiKey: opts.apiKey,
      contextWindow: opts.contextWindow,
    } as any;
  };
  return { factory, constructed: () => constructed };
}

/** A session whose stream never settles — the #211 hang, used for cancellation. */
function makeStalledFactory(onStreamStart: () => void): AnsChatSessionFactory {
  return async (opts) => ({
    model: { id: opts.model, provider: opts.provider } as any,
    streamFn: ((_model: any, _context: any) => {
      onStreamStart();
      return new Promise(() => { /* never settles on purpose */ });
    }) as any,
    models: {} as any,
    providerName: opts.provider,
    modelName: opts.model,
    apiKey: opts.apiKey,
    contextWindow: opts.contextWindow,
  } as any);
}

async function main() {
  // Snapshot the operator's real PI dir BEFORE redirecting HOME (#322).
  const realPiDir = join(homedir(), ".ans", "pi-sessions");
  const realBefore = piRecords(realPiDir);

  const saved: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }

  const tempRoot = mkdtempSync(join(tmpdir(), "ans-303-mcp-task-"));
  process.env.HOME = tempRoot;
  process.env.USERPROFILE = tempRoot;
  process.env.ANS_DB_PATH = join(tempRoot, "anysearch.db");
  process.env.ANS_PI_SESSION_DIR = join(tempRoot, "pi-sessions");
  process.env.ANS_LLM_PROVIDER = "task-provider";
  process.env.ANS_LLM_MODEL = "task-model";
  resetMcpTaskWarnings();
  resetAnsChatDegradedWarnings();

  try {
    // The runtime re-reads a domain TOML at every run boundary and re-applies
    // its [budget] (the file wins — that is how a cap raise takes effect
    // without a restart). These temp domains make the file say exactly what
    // each test engine's config says, which is also what production always has:
    // the config came FROM that file.
    const domainsDir = join(tempRoot, "domains");
    mkdirSync(domainsDir, { recursive: true });
    const writeDomainToml = (name: string, budgetLines: string[]): void => {
      writeFileSync(join(domainsDir, name + ".toml"), [
        'name = "' + name + '"',
        "[sources]",
        "enabled = []",
        "[skills]",
        'active = ["search"]',
        "[rag]",
        'adapter = "none"',
        "[hooks]",
        'toolWhitelist = ["search"]',
        "[budget]",
        ...budgetLines,
        "",
      ].join("\n"), "utf8");
    };
    writeDomainToml("taskbudget", ["tokenCap = 1000000", "callCap = 20"]);
    writeDomainToml("refusedbudget", ["tokenCap = 1", "callCap = 5"]);
    const domainOpts = (name: string) => ({ domainName: name, domainsDirs: [domainsDir] });

    // ============ 1-3. one call, one task, one budget ============
    {
      const dbPath = join(tempRoot, "one-task.db");
      const store = new SqliteSessionStore(dbPath);
      const seen: Array<unknown> = [];
      const observed: any[] = [];
      const state = createMcpToolState({ createAnsChatSession: makeAnsweringFactory(seen).factory });
      // A declared [budget] is what makes "the run was charged" a statement
      // about a real row, and it is the shape that used to bill the session.
      const eng = makeEngine(store, {
        ...domainOpts("taskbudget"),
        budget: { tokenCap: 1_000_000, callCap: 20 },
        onObserve: (o) => observed.push(o),
      });
      const handlers = capture(eng, state);

      const first = await handlers.ans_chat({ message: "FIRST-TURN" });
      assert(first?.isError !== true, "1: the first turn completes (got " + JSON.stringify(first?.content?.[0]?.text ?? "") + ")");
      const firstText = String(first?.content?.[0]?.text ?? "");
      assert(firstText.includes("pong"), "1: the answer reaches the caller");

      const close1 = first?.structuredContent?.closeout;
      assert(!!close1 && typeof close1.taskId === "string" && close1.taskId.length > 0,
        "1: the result names the task this call ran as (got " + JSON.stringify(close1) + ")");
      assert(close1?.kind === "mcp.ans_chat", "1: the task kind names the tool (got " + JSON.stringify(close1?.kind) + ")");
      assert(close1?.state === "ended", "1: the closeout says the task's late work finished (got " + JSON.stringify(close1?.state) + ")");
      assert(close1?.exitCode === 0 && close1?.interrupted === false, "1: a completed answer ends the task as success");

      const tasks = readRows<TaskRow>(dbPath, TASKS_SQL);
      assert(tasks.length === 1, "1: exactly one task row for one call (got " + JSON.stringify(tasks) + ")");
      assert(tasks[0]?.kind === "mcp.ans_chat" && tasks[0]?.id === close1?.taskId,
        "1: the row is the task the result named");
      assert(!!tasks[0]?.ended && tasks[0]?.code === 0,
        "1: the task row is ended with exit 0 after the answer (got " + JSON.stringify(tasks[0]) + ")");
      assert(tasks[0]?.session === first?.structuredContent?.sessionId,
        "1: the task record carries the conversation handle it ran under");
      // #303: the observation row names the task, so a cancelled or
      // budget-stopped call's trace can be tied back to its record.
      const observedTaskIds = observed
        .map((o) => o?.attributes?.["anysearch.task.id"])
        .filter((v) => typeof v === "string" && v.length > 0);
      assert(observedTaskIds.length > 0 && observedTaskIds.every((v) => v === close1?.taskId),
        "1: the observation attributes carry the task id (got " + JSON.stringify(observedTaskIds) + ")");

      const budgets = readRows<TaskBudgetRow>(dbPath, TASK_BUDGETS_SQL);
      assert(budgets.length === 1 && budgets[0]?.id === close1?.taskId,
        "1: this run has its own task budget row (got " + JSON.stringify(budgets) + ")");
      assert(Number(budgets[0]?.calls) > 0, "1: the model call was billed to the task (got " + JSON.stringify(budgets[0]) + ")");
      assert(Number(budgets[0]?.configured) === 1,
        "1: the row is a real capped row, not a pass-through (got " + JSON.stringify(budgets[0]) + ")");
      assert(Number(budgets[0]?.reserved) === 0,
        "1: the task's reservation was settled, not left in flight (got " + JSON.stringify(budgets[0]) + ")");

      const sid = first?.structuredContent?.sessionId;
      assert(typeof sid === "string" && sid.length > 0, "1: the call returns a resumable handle");
      const sessionLedger = readRows<{ reserved: number; spent: number }>(
        dbPath, "SELECT reserved_tokens as reserved, spent_tokens as spent FROM budget_ledger WHERE session_id = ?", sid,
      );
      assert(sessionLedger.length === 0,
        "1/#303: the conversation's own account was never opened, even with a declared [budget] (got "
        + JSON.stringify(sessionLedger) + ")");

      // ---- 2. resuming the handle is a NEW task with its OWN budget ----
      const second = await handlers.ans_chat({ message: "SECOND-TURN", sessionId: sid });
      assert(second?.isError !== true && String(second?.content?.[0]?.text ?? "").includes("pong"),
        "2: the resumed turn completes");
      assert(second?.structuredContent?.sessionId === sid, "2: the same handle comes back");
      const close2 = second?.structuredContent?.closeout;
      assert(close2?.taskId !== close1?.taskId, "2: resuming starts a different task");
      const tasks2 = readRows<TaskRow>(dbPath, TASKS_SQL);
      assert(tasks2.length === 2 && tasks2.every((t) => !!t.ended && t.code === 0),
        "2: two calls, two ended tasks (got " + JSON.stringify(tasks2) + ")");
      const budgets2 = readRows<TaskBudgetRow>(dbPath, TASK_BUDGETS_SQL);
      assert(budgets2.length === 2 && budgets2.every((b) => Number(b.calls) > 0 && Number(b.reserved) === 0),
        "2/#303: each task keeps its own spent budget (got " + JSON.stringify(budgets2) + ")");
      const sessionLedger2 = readRows<{ spent: number }>(
        dbPath, "SELECT spent_tokens as spent FROM budget_ledger WHERE session_id = ?", sid,
      );
      assert(sessionLedger2.length === 0,
        "2/#303: the resumed turn spent none of the conversation's history account");

      // ---- 3. no handle: a new conversation and a new task ----
      const third = await handlers.ans_chat({ message: "THIRD-TURN" });
      assert(third?.isError !== true, "3: a handle-less call completes");
      const sid3 = third?.structuredContent?.sessionId;
      assert(typeof sid3 === "string" && sid3 !== sid, "3: a handle-less call mints a different conversation");
      assert(third?.structuredContent?.closeout?.taskId !== close1?.taskId
        && third?.structuredContent?.closeout?.taskId !== close2?.taskId,
        "3: and it is a third task");
      assert(readRows<TaskRow>(dbPath, TASKS_SQL).length === 3, "3: three calls, three tasks");

      // ---- 7. search_web is migrated too (#304): one call, one task ----
      const beforeSearch = readRows<TaskRow>(dbPath, TASKS_SQL).length;
      const searchResult = await handlers.search_web({ query: "anything" });
      const searchTasks = readRows<TaskRow>(dbPath, TASKS_SQL);
      assert(searchTasks.length === beforeSearch + 1,
        "7/#304: search_web registers its own task");
      assert(searchTasks.some((t) => t.kind === "mcp.search_web" && !!t.ended && t.code === 0),
        "7/#304: the search task ends cleanly (got " + JSON.stringify(searchTasks) + ")");
      assert(searchResult?.structuredContent?.closeout?.kind === "mcp.search_web",
        "7/#304: the answer carries the closeout for this call (got "
        + JSON.stringify(searchResult?.structuredContent?.closeout) + ")");
    }

    // ============ 4. a budget refusal is its own structured answer ============
    {
      const refusedDb = join(tempRoot, "refused.db");
      const store = new SqliteSessionStore(refusedDb);
      const seen: Array<unknown> = [];
      const state = createMcpToolState({ createAnsChatSession: makeAnsweringFactory(seen).factory });
      // 1 token cannot cover the reserve, so the runtime refuses before the call.
      const eng = makeEngine(store, {
        ...domainOpts("refusedbudget"),
        budget: { tokenCap: 1, callCap: 5 },
      });
      const handlers = capture(eng, state);

      const refused = await handlers.ans_chat({ message: "TOO-BIG" });
      assert(refused?.isError === true, "4: a budget refusal is an error result");
      assert(refused?.structuredContent?.errorKind === "budget-rejected",
        "4/#303: the refusal is machine-distinguishable from an upstream failure (got "
        + JSON.stringify(refused?.structuredContent?.errorKind) + ")");
      assert(refused?.structuredContent?.budget?.stopped === true, "4: the budget block says the run was stopped");
      const refusedText = String(refused?.content?.[0]?.text ?? "");
      assert(/stopped by its task budget/.test(refusedText), "4: the text names the task budget (got " + refusedText.slice(0, 160) + ")");
      assert(seen.length === 0, "4: no provider call was made (got " + seen.length + ")");
      const close = refused?.structuredContent?.closeout;
      assert(close?.state === "ended" && close?.exitCode === 1,
        "4: the task closes as failed (got " + JSON.stringify(close) + ")");
      const tasks = readRows<TaskRow>(refusedDb, TASKS_SQL);
      assert(tasks.length === 1 && !!tasks[0]?.ended && tasks[0]?.code === 1,
        "4: the task record carries exit 1 (got " + JSON.stringify(tasks) + ")");
      const refusedBudgets = readRows<TaskBudgetRow>(refusedDb, TASK_BUDGETS_SQL);
      assert(refusedBudgets.length === 1 && Number(refusedBudgets[0]?.configured) === 1
        && Number(refusedBudgets[0]?.calls) === 0,
        "4: the refused run left a capped row with no billable call (got "
        + JSON.stringify(refusedBudgets) + ")");
    }

    // ============ 5. declared but not established is its own answer ============
    {
      // A store without the task registry/budget seams: nothing can hold a
      // budget, so a declared [budget] must stop the run instead of running
      // unmetered (S9's third state).
      const bareStore = {
        createSession: async (domain: string) => ({ id: "bare-0001", domain, createdAt: "" }),
        ensureSession: async () => {},
      };
      const seen: Array<unknown> = [];
      const state = createMcpToolState({ createAnsChatSession: makeAnsweringFactory(seen).factory });
      const eng = makeEngine(bareStore, { budget: { callCap: 2 } });
      const handlers = capture(eng, state);

      const res = await handlers.ans_chat({ message: "NO-BUDGET-PLACE" });
      assert(res?.isError === true, "5: an unestablishable declared budget is an error result");
      assert(res?.structuredContent?.errorKind === "budget-not-established",
        "5/#303: it is distinguishable from both a refusal and an upstream failure (got "
        + JSON.stringify(res?.structuredContent?.errorKind) + ")");
      assert(seen.length === 0, "5: no provider call was made (got " + seen.length + ")");
      assert(res?.structuredContent?.closeout === undefined,
        "5: with no registry there is no task to close, and no invented one");
    }

    // ============ 6. cancellation ends the wait, not the late work ============
    {
      const dbPath = join(tempRoot, "cancelled.db");
      const store = new SqliteSessionStore(dbPath);
      let started: () => void = () => {};
      const streamStarted = new Promise<void>((r) => { started = r; });
      const state = createMcpToolState({ createAnsChatSession: makeStalledFactory(() => started()) });
      const eng = makeEngine(store, {
        ...domainOpts("taskbudget"),
        budget: { tokenCap: 1_000_000, callCap: 20 },
      });
      const handlers = capture(eng, state);
      const caller = new AbortController();

      const call = handlers.ans_chat({ message: "HANG" }, { mcpReq: { signal: caller.signal } });
      await streamStarted;
      caller.abort("stdio cancellation");
      const result = await Promise.race([
        call,
        new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("handler did not end")), 5000)),
      ]);

      assert(result?.structuredContent?.interrupted === true, "6: the answer says it was interrupted");
      // #303: the answer has to name whether the provider's final usage already
      // landed on the task row. It is "still-running" here (the stalled stream
      // never ends), which is exactly the case a bare `interrupted: true` hid.
      const lateSettlement = result?.structuredContent?.lateSettlement;
      assert(lateSettlement === "settled" || lateSettlement === "still-running" || lateSettlement === "failed",
        "6: the answer says whether the late settlement already landed (got "
        + JSON.stringify(lateSettlement) + ")");
      const close = result?.structuredContent?.closeout;
      assert(close?.state === "ended",
        "6/#303: the task closes only after its late settlement/summary drained (got " + JSON.stringify(close) + ")");
      assert(close?.interrupted === true && close?.exitCode === 1,
        "6: the record says the turn did not complete (got " + JSON.stringify(close) + ")");
      const tasks = readRows<TaskRow>(dbPath, TASKS_SQL);
      assert(tasks.length === 1 && !!tasks[0]?.ended && tasks[0]?.code === 1,
        "6: the cancelled run's task row is ended, as unfinished (got " + JSON.stringify(tasks) + ")");
      const budgets = readRows<TaskBudgetRow>(dbPath, TASK_BUDGETS_SQL);
      assert(budgets.length === 1 && Number(budgets[0]?.reserved) === 0,
        "6/#266: the cancelled run's reservation was settled, never left as phantom spend (got "
        + JSON.stringify(budgets) + ")");
    }

    // ====== 6b. cancelled before the run started: still not a clean finish ======
    //
    // The review's point: the early "already cancelled" returns used to hand
    // back a plain empty result, so the task was written as exit 0 — a request
    // that never ran read as a completed one. No provider call happens here,
    // and the record still has to say "unfinished".
    {
      const dbPath = join(tempRoot, "pre-aborted.db");
      const store = new SqliteSessionStore(dbPath);
      const seen: Array<unknown> = [];
      const state = createMcpToolState({ createAnsChatSession: makeAnsweringFactory(seen).factory });
      const eng = makeEngine(store, {
        ...domainOpts("taskbudget"),
        budget: { tokenCap: 1_000_000, callCap: 20 },
      });
      const handlers = capture(eng, state);
      const caller = new AbortController();
      caller.abort("gone before the handler");

      const res = await handlers.ans_chat({ message: "PRE-ABORTED" }, { mcpReq: { signal: caller.signal } });
      assert(res?.structuredContent?.interrupted === true,
        "6b: a pre-aborted call marks its answer interrupted (got "
        + JSON.stringify(res?.structuredContent?.closeout) + ")");
      assert(res?.structuredContent?.closeout?.exitCode === 1,
        "6b: the task closes as unfinished, not as a clean completion");
      assert(seen.length === 0, "6b: no provider call was made (got " + seen.length + ")");
      const tasks = readRows<TaskRow>(dbPath, TASKS_SQL);
      assert(tasks.length === 1 && !!tasks[0]?.ended && tasks[0]?.code === 1,
        "6b: the task row says unfinished (got " + JSON.stringify(tasks) + ")");
    }

    // ===== 8. an error keeps its shape: no closeout on a rebuild failure =====
    //
    // The review's point: `attachCloseout` used to fire on any error that
    // happened to carry structuredContent, so `buildAnsChatErrorResult` with
    // summaryRebuilds would grow a task block. A client parsing that error must
    // see the same shape as before; the task row is the record.
    {
      const dbPath = join(tempRoot, "error-shape.db");
      const store = new SqliteSessionStore(dbPath);
      const eng = makeEngine(store);

      const rebuildError = await withMcpTask(eng, "probe_tool", async () => ({
        isError: true,
        content: [{ type: "text", text: "probe_tool error: rebuild failed" }],
        structuredContent: { summaryRebuilds: [{ anchorId: 1, outcome: "failed", reasons: ["probe"], newAnchorId: null, cleared: false }] },
      }));
      assert(rebuildError?.structuredContent?.closeout === undefined,
        "8: a rebuild-report error keeps its shape — no closeout is mixed in");
      assert(Array.isArray(rebuildError?.structuredContent?.summaryRebuilds),
        "8: the rebuild report survives untouched");

      const success = await withMcpTask(eng, "probe_tool", async () => ({
        content: [{ type: "text", text: "ok" }],
      }));
      assert(success?.structuredContent?.closeout !== undefined,
        "8: a successful result still carries the closeout");

      const tasks = readRows<TaskRow>(dbPath, TASKS_SQL);
      assert(tasks.length === 2 && tasks.every((t) => !!t.ended),
        "8: both calls were registered and closed, closeout or not (got " + JSON.stringify(tasks) + ")");
      assert(tasks[0]?.code === 1 && tasks[1]?.code === 0,
        "8: failed one exit 1, successful one exit 0 (got " + JSON.stringify(tasks.map((t) => t.code)) + ")");
    }

    // ===== 9. a domain stop is classified, closed, and still reports spend =====
    //
    // A domain stop carries structuredContent (errorKind = domain-not-established)
    // the same way a budget stop does, so it gets the same closeout — and the
    // spend the run already incurred must not disappear behind the error.
    {
      const dbPath = join(tempRoot, "domain-stop.db");
      const store = new SqliteSessionStore(dbPath);
      const eng = makeEngine(store);
      const res = await withMcpTask(eng, "probe_tool", async () =>
        toolDomainStop("probe_tool", "领域配置读不出来，这次没跑：probe", {
          usage: { run: { settled: false }, memorySummary: { calls: 0, spentUsd: 0 } },
        }));
      assert(res?.structuredContent?.errorKind === "domain-not-established",
        "9: the stop stays classified (got " + JSON.stringify(res?.structuredContent) + ")");
      assert(res?.structuredContent?.closeout !== undefined,
        "9: a domain stop carries a closeout like a budget stop");
      assert(res?.structuredContent?.usage !== undefined,
        "9: the spend so far is still reported");
      const text = String(res?.content?.[0]?.type === "text" ? res.content[0].text : "");
      assert(text.includes("这次没跑") && !/这次没跑[^。]*这次没跑/.test(text),
        "9: the sentence is said once, not twice (got " + text + ")");
      const tasks = readRows<TaskRow>(dbPath, TASKS_SQL);
      assert(tasks.length === 1 && tasks[0]?.code === 1 && !!tasks[0]?.ended,
        "9: the call is recorded and closed as a failure (got " + JSON.stringify(tasks) + ")");
    }

    // ---- #322: nothing reached the operator's real home ----
    const realAfter = piRecords(realPiDir);
    assert(realBefore.join("|") === realAfter.join("|"),
      "#322: the operator's real ~/.ans/pi-sessions gained no record (before="
      + realBefore.length + ", after=" + realAfter.length + ")");
  } finally {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    try { rmSync(tempRoot, { recursive: true, force: true }); } catch { /* OS temp */ }
  }

  console.log("--- ans_chat task-budget tests: " + passed + " passed, " + failed + " failed ---");
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
