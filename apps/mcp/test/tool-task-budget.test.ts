// #304 acceptance — MCP search_web / research_web bill their own task.
//
// What this pins:
//   1. one search_web call registers ONE task (`mcp.search_web`) and ONE task
//      budget row; the provider call is billed there, and the session form's
//      `budget_ledger` stays untouched (a bare search has no session anyway)
//   2. one research_web call runs several rounds on the SAME task row: the
//      automatic internal steps share one quota instead of each starting fresh
//   3. a budget refusal is a structured answer (`errorKind: budget-rejected`)
//      and no provider call happens
//   4. a declared budget that cannot be established is its own structured
//      answer (`errorKind: budget-not-established`), also with no call
//   5. an undeclared domain still registers the task and caps nothing
//
// The retriever is the real engine over a local mock provider, so the
// reserve→settle path is exercised — not a hand-built fake that would pass
// even if the wiring were absent.
//
// Offline by construction: no network, temp SQLite file, HOME redirected.
//
// Run: pnpm --filter @anysearch-cli/mcp test

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import {
  RetroaererdEngine,
  type CompositionResult,
  type DomainConfigPort,
} from "@anysearch-cli/kernel";
import type { SearchProvider, SearchRequest, NormalizedResult, ProviderEnvelope } from "@anysearch-cli/retriever";
import { SqliteSessionStore } from "@anysearch-cli/store";
import type { McpServer } from "@modelcontextprotocol/server";
import { registerSearchWeb } from "../src/tools/search-web.tool.js";
import { registerResearchWeb } from "../src/tools/research-web.tool.js";
import { resetToolBudgetWarnings } from "../src/tools/task-budget.js";
import { resetMcpTaskWarnings } from "../src/mcp-task.js";

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

const fakeSpan: any = {
  traceId: "t304",
  spanId: "s304",
  addEvent: () => {},
  setAttributes: () => {},
  startSpan: async (_o: any, cb: any) => cb(fakeSpan),
  finish: () => {},
};

type Handler = (args: unknown) => Promise<any>;

function capture(eng: CompositionResult): Record<string, Handler> {
  const handlers: Record<string, Handler> = {};
  const fakeServer = {
    registerTool: (name: string, _config: unknown, fn: Handler) => {
      handlers[name] = fn;
    },
  } as unknown as McpServer;
  registerSearchWeb(fakeServer, eng);
  registerResearchWeb(fakeServer, eng);
  return handlers;
}

/** A local arm answering every search with one fresh URL per call. */
function makeProvider(calls: { count: number }): SearchProvider {
  return {
    id: "solo",
    modes: ["fast", "index", "deep", "answer"],
    async search(req: SearchRequest): Promise<ProviderEnvelope> {
      calls.count++;
      const results: NormalizedResult[] = [{
        url: "https://example.com/" + req.query + "/" + calls.count,
        title: "result " + calls.count,
        snippet: "snippet " + calls.count,
        source: "solo",
      }];
      return { provider: "solo", results, answers: [], elapsedMs: 1 };
    },
  };
}

function domainConfig(budget: DomainConfigPort["budget"]): DomainConfigPort {
  return {
    sources: { enabled: [] },
    prompts: [],
    skills: { active: [] },
    hooks: { toolWhitelist: [] },
    rag: { adapter: "none" },
    ...(budget ? { budget } : {}),
  };
}

function makeEngine(
  dbPath: string,
  calls: { count: number },
  opts: { budget?: DomainConfigPort["budget"]; store?: SqliteSessionStore } = {},
): CompositionResult {
  const engine = new RetroaererdEngine([makeProvider(calls)]);
  return {
    retriever: engine,
    store: opts.store ?? new SqliteSessionStore(dbPath),
    observation: { recordOperation: async (_o: any, cb: any) => cb(fakeSpan) },
    providerBuildErrors: {},
    ...(opts.budget ? { config: domainConfig(opts.budget) } : {}),
  } as unknown as CompositionResult;
}

function readRows<T>(dbPath: string, sql: string, ...params: any[]): T[] {
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
}

const TASKS_SQL =
  "SELECT task_id as id, kind, ended_at as ended, exit_code as code FROM task_records ORDER BY rowid";

interface TaskBudgetRow {
  id: string;
  calls: number;
  spent: number;
  reserved: number;
  configured: number;
}

const TASK_BUDGETS_SQL =
  "SELECT task_id as id, billable_calls as calls, spent_tokens as spent, reserved_tokens as reserved, configured FROM task_budgets ORDER BY rowid";

const ENV_KEYS = ["HOME", "USERPROFILE", "ANS_DB_PATH", "ANS_DOMAIN"];

async function main() {
  const tempRoot = mkdtempSync(join(tmpdir(), "ans-304-mcp-"));
  const previous: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) {
    previous[key] = process.env[key];
    delete process.env[key];
  }
  process.env.HOME = tempRoot;
  process.env.USERPROFILE = tempRoot;
  resetMcpTaskWarnings();
  resetToolBudgetWarnings();
  try {
    // ============ 1. search_web: one call, one task, one budget ============
    {
      const dbPath = join(tempRoot, "search.db");
      const calls = { count: 0 };
      const eng = makeEngine(dbPath, calls, { budget: { tokenCap: 1_000_000, callCap: 20 } });
      const handlers = capture(eng);
      const result = await handlers.search_web({ query: "budgeted search" });

      assert(result?.isError !== true, "1: the search completes (got " + JSON.stringify(result?.content) + ")");
      const close = result?.structuredContent?.closeout;
      assert(close?.kind === "mcp.search_web", "1: the answer names this call's task kind (got " + JSON.stringify(close) + ")");
      assert(close?.state === "ended" && close?.exitCode === 0,
        "1: the task ends cleanly (got " + JSON.stringify(close) + ")");
      assert(calls.count === 1, "1: exactly one provider call happened (got " + calls.count + ")");

      const tasks = readRows<TaskRow>(dbPath, TASKS_SQL);
      assert(tasks.length === 1 && tasks[0]?.kind === "mcp.search_web" && !!tasks[0]?.ended && tasks[0]?.code === 0,
        "1: one ended mcp.search_web task (got " + JSON.stringify(tasks) + ")");
      const budgets = readRows<TaskBudgetRow>(dbPath, TASK_BUDGETS_SQL);
      assert(budgets.length === 1 && budgets[0]?.id === close?.taskId,
        "1: the budget row belongs to the task (got " + JSON.stringify(budgets) + ")");
      assert(Number(budgets[0]?.calls) === 1 && Number(budgets[0]?.reserved) === 0 && Number(budgets[0]?.configured) === 1,
        "1: the provider call was billed and settled on the task (got " + JSON.stringify(budgets[0]) + ")");
      const sessionRows = readRows<{ n: number }>(dbPath, "SELECT COUNT(*) AS n FROM budget_ledger");
      assert(sessionRows[0]?.n === 0, "1: no session budget row was opened by a bare search");
    }

    // ============ 2. research_web: every round draws from one task row ============
    {
      const dbPath = join(tempRoot, "research.db");
      const calls = { count: 0 };
      const eng = makeEngine(dbPath, calls, { budget: { tokenCap: 1_000_000, callCap: 20 } });
      const handlers = capture(eng);
      const result = await handlers.research_web({ question: "budgeted research", depth: "deep" });

      assert(result?.isError !== true, "2: the research call completes");
      assert(calls.count === 3, "2: deep research really ran three rounds (got " + calls.count + ")");
      const close = result?.structuredContent?.closeout;
      assert(close?.kind === "mcp.research_web" && close?.state === "ended" && close?.exitCode === 0,
        "2: one ended mcp.research_web task (got " + JSON.stringify(close) + ")");
      const tasks = readRows<TaskRow>(dbPath, TASKS_SQL);
      assert(tasks.length === 1, "2: the three rounds made ONE task, not three (got " + JSON.stringify(tasks) + ")");
      const budgets = readRows<TaskBudgetRow>(dbPath, TASK_BUDGETS_SQL);
      assert(budgets.length === 1 && Number(budgets[0]?.calls) === 3 && Number(budgets[0]?.reserved) === 0,
        "2: all three rounds settled on the same budget row (got " + JSON.stringify(budgets) + ")");
    }

    // ============ 3. a budget refusal is its own structured answer ============
    {
      const dbPath = join(tempRoot, "refused.db");
      const calls = { count: 0 };
      const eng = makeEngine(dbPath, calls, { budget: { tokenCap: 1_000_000, callCap: 0 } });
      const handlers = capture(eng);
      const result = await handlers.search_web({ query: "refused" });

      assert(result?.isError === true, "3: a refused search is an error result");
      assert(result?.structuredContent?.errorKind === "budget-rejected",
        "3: the answer names the budget refusal (got " + JSON.stringify(result?.structuredContent?.errorKind) + ")");
      assert(result?.structuredContent?.budget?.stopped === true, "3: the budget block says the call stopped");
      assert(calls.count === 0, "3: no provider call happened (got " + calls.count + ")");
      const close = result?.structuredContent?.closeout;
      assert(close?.state === "ended" && close?.exitCode === 1,
        "3: the task still ends, as unfinished (got " + JSON.stringify(close) + ")");
      const tasks = readRows<TaskRow>(dbPath, TASKS_SQL);
      assert(tasks.length === 1 && tasks[0]?.code === 1, "3: the record says the call did not complete");
      const budgets = readRows<TaskBudgetRow>(dbPath, TASK_BUDGETS_SQL);
      assert(budgets.length === 1 && Number(budgets[0]?.calls) === 0 && Number(budgets[0]?.reserved) === 0,
        "3: the refused call left no phantom spend (got " + JSON.stringify(budgets) + ")");
    }

    // ====== 3b. a LATER round refused: earlier spend stays on the task ======
    //
    // The spec's "already-happened calls still settle honestly" is not the same
    // case as a first-call refusal: round one really spent, and the stop must
    // keep that number instead of reporting a run that never started.
    {
      const dbPath = join(tempRoot, "research-refused.db");
      const calls = { count: 0 };
      const eng = makeEngine(dbPath, calls, { budget: { tokenCap: 1_000_000, callCap: 1 } });
      const handlers = capture(eng);
      const result = await handlers.research_web({ question: "two rounds", depth: "standard" });

      assert(result?.isError === true, "3b: the second round's refusal is an error result");
      assert(result?.structuredContent?.errorKind === "budget-rejected",
        "3b: the answer names the budget refusal (got " + JSON.stringify(result?.structuredContent?.errorKind) + ")");
      const text = (result?.content ?? []).map((c: any) => c?.text ?? "").join("\n");
      assert(/1 round\(s\) settled before the stop/.test(text),
        "3b: the answer says how much already ran (got " + text + ")");
      assert(calls.count === 1, "3b: only the first round reached a provider (got " + calls.count + ")");
      const budgets = readRows<TaskBudgetRow>(dbPath, TASK_BUDGETS_SQL);
      assert(budgets.length === 1 && Number(budgets[0]?.calls) === 1 && Number(budgets[0]?.reserved) === 0,
        "3b: the round that ran stays booked, with no phantom reservation (got "
        + JSON.stringify(budgets) + ")");
      const close = result?.structuredContent?.closeout;
      assert(close?.state === "ended" && close?.exitCode === 1,
        "3b: the task ends as unfinished (got " + JSON.stringify(close) + ")");
    }

    // ============ 4. declared but not established: stop before any call ============
    {
      const dbPath = join(tempRoot, "fault.db");
      const calls = { count: 0 };
      // The task registry works; only the budget ledger seam is missing, which
      // is exactly the "declared but failed to establish" corner (S9).
      const store: any = new SqliteSessionStore(dbPath);
      store.createTaskBudgetLedger = undefined;
      const eng = makeEngine(dbPath, calls, { budget: { tokenCap: 1_000_000, callCap: 20 }, store });
      const handlers = capture(eng);
      const result = await handlers.search_web({ query: "faulted" });

      assert(result?.isError === true, "4: an unbuildable budget is an error result");
      assert(result?.structuredContent?.errorKind === "budget-not-established",
        "4: the answer says the budget could not be established (got " + JSON.stringify(result?.structuredContent?.errorKind) + ")");
      assert(calls.count === 0, "4: nothing was sent to a provider (got " + calls.count + ")");
      const close = result?.structuredContent?.closeout;
      assert(close?.state === "ended" && close?.exitCode === 1,
        "4: the task ends as unfinished (got " + JSON.stringify(close) + ")");
      const tasks = readRows<TaskRow>(dbPath, TASKS_SQL);
      assert(tasks.length === 1 && tasks[0]?.ended && tasks[0]?.code === 1,
        "4: the task row exists and says unfinished (got " + JSON.stringify(tasks) + ")");
    }

    // ============ 5. undeclared domain: task, no cap, unchanged answer ============
    {
      const dbPath = join(tempRoot, "undeclared.db");
      const calls = { count: 0 };
      const eng = makeEngine(dbPath, calls);
      const handlers = capture(eng);
      const result = await handlers.search_web({ query: "unmetered" });

      assert(result?.isError !== true && calls.count === 1, "5: an undeclared domain still searches");
      const close = result?.structuredContent?.closeout;
      assert(close?.state === "ended" && close?.exitCode === 0,
        "5: the task is still registered and ended (got " + JSON.stringify(close) + ")");
      const budgets = readRows<TaskBudgetRow>(dbPath, TASK_BUDGETS_SQL);
      assert(budgets.length === 0, "5: no budget row is invented for an undeclared domain");
    }
  } finally {
    for (const key of ENV_KEYS) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    try { rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* best effort */ }
  }

  console.log("\ntool task-budget tests: " + passed + " passed, " + failed + " failed");
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("tool task-budget test threw:", e);
  process.exit(1);
});
