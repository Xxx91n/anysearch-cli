// #309 — an MCP tool call refused by upgrade admission never reaches a
// provider, ever, and says so in a machine-readable way.
//
// What this pins:
//  1. With the gate closed, `search_web` answers `isError` with
//     `errorKind: "upgrade-in-progress"` and the provider is NEVER called
//     (the whole point: a refusal must not become a live request).
//  2. There is no task row for the refused call: nothing ran, so nothing is
//     left open to block the upgrade that refused it.
//  3. The same call succeeds once admission reopens — the refusal is a pause,
//     not damage.
//  4. A management-role task and a follow-up still register while the gate is
//     closed (the store-level rule, seen through this entry's own wiring).
//
// The registry is the real one (through the engine's store seam), and the
// provider is a counting stub, so "no request was sent" is measured, not
// assumed.
//
// Offline by construction: no network, temp SQLite file, HOME redirected.
//
// Run: pnpm --filter @anysearch-cli/mcp test

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  RetroaererdEngine,
  type CompositionResult,
  type DomainConfigPort,
} from "@anysearch-cli/kernel";
import type Database from "better-sqlite3";
import type { SearchProvider, SearchRequest, NormalizedResult, ProviderEnvelope } from "@anysearch-cli/retriever";
import { SqliteSessionStore } from "@anysearch-cli/store";
import type { McpServer } from "@modelcontextprotocol/server";
import { registerSearchWeb } from "../src/tools/search-web.tool.js";
import { resetToolBudgetWarnings } from "../src/tools/task-budget.js";
import { resetMcpTaskWarnings } from "../src/mcp-task.js";

let passed = 0;
let failed = 0;
function assert(label: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; console.log("  PASS " + label); }
  else { failed++; console.error("  FAIL " + label + (detail ? ": " + detail : "")); }
}

const fakeSpan: any = {
  traceId: "t309",
  spanId: "s309",
  addEvent: () => {},
  setAttributes: () => {},
  startSpan: async (_o: any, cb: any) => cb(fakeSpan),
  finish: () => {},
};

/** A local arm that counts calls, so "no request was sent" is measured. */
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

/**
 * The engine plus the store seam `withMcpTask` reads its registry from, built
 * the same way tool-task-budget.test.ts does — so the refusal path runs through
 * the production wiring, not a hand-built fake.
 */
function makeEngine(dbPath: string, calls: { count: number }): CompositionResult {
  return {
    retriever: new RetroaererdEngine([makeProvider(calls)]),
    store: new SqliteSessionStore(dbPath),
    observation: { recordOperation: async (_o: any, cb: any) => cb(fakeSpan) },
    providerBuildErrors: {},
  } as unknown as CompositionResult;
}

type Handler = (args: unknown, ctx?: { mcpReq?: { signal?: AbortSignal } }) => Promise<any>;

async function main(): Promise<void> {
  const home = mkdtempSync(join(tmpdir(), "ans-309-mcp-"));
  const prevHome = process.env.HOME;
  const prevProfile = process.env.USERPROFILE;
  const prevDb = process.env.ANS_DB_PATH;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.ANS_DB_PATH = join(home, "anysearch.db");
  try {
    const calls = { count: 0 };
    const eng = makeEngine(join(home, "anysearch.db"), calls);
    const store = eng.store!;

    const handlers: Record<string, Handler> = {};
    const fakeServer = {
      registerTool: (name: string, _config: unknown, fn: Handler) => { handlers[name] = fn; },
    } as unknown as McpServer;
    registerSearchWeb(fakeServer, eng);

    resetMcpTaskWarnings();
    resetToolBudgetWarnings();

    const registry = store.createTaskRegistry();
    // The store's own connection, read directly (the same shape other tests
    // use): the count below is a fact about the database, not API behavior.
    const storeDb = (store as unknown as { db: Database.Database }).db;
    const taskRows = (): number =>
      (storeDb.prepare("SELECT COUNT(*) AS n FROM task_records").get() as { n: number }).n;

    // A root task accepted BEFORE the pause: the follow-up case below needs a
    // real parent, and admission must be open when the root starts.
    const root = registry.registerTask({ kind: "mcp.search_web", role: "business", entry: "mcp" });

    // ---- 1. business call refused while the gate is closed ----------------
    const gate = registry.openGate({ note: "mcp test" });
    const before = taskRows();
    const refused = await handlers.search_web!({ query: "anything" });
    assert("1: the refused call is an error", refused.isError === true);
    assert("1: it is classified as upgrade-in-progress", refused.structuredContent?.errorKind === "upgrade-in-progress");
    assert("1: the refusal names the gate", refused.structuredContent?.upgrade?.gate?.gateId === gate.gateId);
    assert("1: NO provider request was sent", calls.count === 0, "calls=" + calls.count);
    assert("1: the refusal wrote no task row", taskRows() === before, "before=" + before + " after=" + taskRows());
    assert("1: the text says it was not queued and will not be replayed",
      /NOT queued/.test(refused.content?.[0]?.text ?? ""));

    // ---- 2. management + follow-up work still register --------------------
    const mgmt = registry.registerTask({ kind: "cli.upgrade", role: "management", entry: "cli" });
    assert("2: management work registers while closed", registry.taskById(mgmt.taskId) !== null);
    const tail = registry.registerTask({
      kind: "server.project_index", role: "business", entry: "server",
      origin: "follow-up", parentTaskId: root.taskId,
    });
    assert("2: a follow-up of accepted work registers while closed", registry.taskById(tail.taskId) !== null);

    // ---- 3. reopening lets the same call through --------------------------
    registry.closeGate();
    const ok = await handlers.search_web!({ query: "anything" });
    assert("3: the same call succeeds after admission reopens", ok.isError !== true,
      "structured=" + JSON.stringify(ok.structuredContent ?? null));
    assert("3: a real provider request was made", calls.count === 1, "calls=" + calls.count);
    assert("3: the successful call carries a closeout (it ran as a task)",
      typeof ok.structuredContent?.closeout?.taskId === "string");

    // ---- 4. a refused call leaves nothing open to block a later upgrade --
    // Close the root this test opened on purpose; whatever mcp row is left after
    // that can only have come from the refused call.
    root.finish({ exitCode: 0 });
    const openBusiness = registry.blockingTasks().filter((b) => b.entry === "mcp");
    assert("4: no mcp task row is left open by the refused call", openBusiness.length === 0,
      JSON.stringify(openBusiness.map((b) => b.kind)));

    registry.close();
    store.close();
  } finally {
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
    if (prevProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = prevProfile;
    if (prevDb === undefined) delete process.env.ANS_DB_PATH; else process.env.ANS_DB_PATH = prevDb;
    try { rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* best effort */ }
  }

  console.log("\nmcp upgrade refusal tests: " + passed + " passed, " + failed + " failed");
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("mcp upgrade refusal test threw:", e);
  process.exit(1);
});
