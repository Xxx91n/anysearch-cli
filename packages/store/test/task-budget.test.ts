// Task budget test (#302). One execution, one budget row.
// Self-check via assert-based demo (ponytail: no test framework).
// Mirrors budget-ledger.test.ts's cases where the two forms share semantics,
// and adds the ones that are the point of the new form: two tasks never see
// each other's counters, and a budget row cannot exist without a registered
// task (the establishment-failure contract the chat wiring depends on).

import { SqliteSessionStore } from "../src/session-store";
import { TaskBudgetLedger } from "../src/task-budget";
import { openTaskRegistry } from "../src/task-registry";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return false; }
  passed++; return true;
}

async function main() {
  const tmpDir = mkdtempSync(join(tmpdir(), "ans-task-budget-"));
  const dbPath = join(tmpDir, "test.db");

  try {
    // The registry registers the tasks; the store connection carries the
    // budget ledger — the exact two-connection shape the CLI produces.
    const registry = openTaskRegistry(dbPath);
    const store = new SqliteSessionStore(dbPath);
    const ledger = store.createTaskBudgetLedger();

    const taskA = registry.registerTask({ kind: "cli.chat", role: "business", entry: "cli" });
    const taskB = registry.registerTask({ kind: "cli.chat", role: "business", entry: "cli" });

    // 1. initBudget + getBalance
    {
      ledger.initBudget(taskA.taskId, { tokenCap: 100000, usdCap: 5.0, timeLimitMs: 60000 });
      const bal = ledger.getBalance(taskA.taskId);
      assert(bal !== null, "1: getBalance returns a balance after initBudget");
      assert(bal!.tokenCap === 100000, "1: tokenCap recorded");
      assert(bal!.taskId === taskA.taskId, "1: the balance names the task, not a session");
      assert(bal!.remainingTokens === 100000, "1: nothing spent yet");

      // 2. reserve + settle
      const ok1 = ledger.reserveTokens(taskA.taskId, 10000);
      assert(ok1, "2: reserveTokens within cap succeeds");
      const ok2 = ledger.reserveTokens(taskA.taskId, 95000);
      assert(!ok2, "3: reserveTokens over cap is rejected");
      const bal2 = ledger.getBalance(taskA.taskId);
      assert(bal2!.reservedTokens === 10000, "3: failed reserve leaves the counter untouched");
      ledger.settleTokens(taskA.taskId, 10000, 8000);
      const bal3 = ledger.getBalance(taskA.taskId);
      assert(bal3!.reservedTokens === 0 && bal3!.spentTokens === 8000, "4: settle moves reserved to spent by actuals");

      // 5. USD dimension
      assert(ledger.reserveUsd(taskA.taskId, 2.0), "5: reserveUsd within cap succeeds");
      ledger.settleUsd(taskA.taskId, 2.0, 1.25);
      const bal4 = ledger.getBalance(taskA.taskId);
      assert(Math.abs(bal4!.spentUsd - 1.25) < 1e-9, "5: USD settles by actuals");

      // 6. call dimension
      assert(ledger.reserveCalls(taskA.taskId, 2), "6: reserveCalls succeeds");
      ledger.settleCalls(taskA.taskId, 2, 2);
      const bal5 = ledger.getBalance(taskA.taskId);
      assert(bal5!.billableCalls === 2 && bal5!.reservedCalls === 0, "6: calls settle reserved->billable");
    }

    // 7. Two tasks are two budgets: B never sees A's spend.
    {
      ledger.initBudget(taskB.taskId, { tokenCap: 100 });
      const balB = ledger.getBalance(taskB.taskId);
      assert(balB!.spentTokens === 0 && balB!.remainingTokens === 100,
        "7: a second task starts from a clean budget — the first task's 8000 spent is not its history");
      assert(!ledger.reserveTokens(taskB.taskId, 101), "7: B's own cap is enforced against B alone");
      // The session form is untouched by any of this: no budget_ledger row exists.
      const sessionRows = (store as any).db
        .prepare("SELECT COUNT(*) AS n FROM budget_ledger")
        .get() as { n: number };
      assert(sessionRows.n === 0, "7: task budgeting never writes the session form's table");
    }

    // 8. No row = undeclared = unmetered pass, and no row is lazily created.
    {
      const unknown = registry.registerTask({ kind: "cli.chat", role: "business", entry: "cli" }).taskId;
      assert(ledger.reserveTokens(unknown, 1), "8: a task with no budget row reserves as a pass");
      const rows = (store as any).db
        .prepare("SELECT COUNT(*) AS n FROM task_budgets WHERE task_id = ?")
        .get(unknown) as { n: number };
      assert(rows.n === 0, "8: the pass does not lazily create a budget row");
      ledger.settleTokens(unknown, 0, 5);
      assert(ledger.getBalance(unknown) === null, "8: getBalance stays null (undeclared)");
    }

    // 9. Explicit zeros reject (a real cap of zero), missing caps are unlimited.
    {
      const zeroTask = registry.registerTask({ kind: "cli.chat", role: "business", entry: "cli" }).taskId;
      ledger.initBudget(zeroTask, { tokenCap: 0 });
      assert(!ledger.reserveTokens(zeroTask, 0), "9: an explicit 0 tokenCap rejects even a zero-count reserve");
      const bareTask = registry.registerTask({ kind: "cli.chat", role: "business", entry: "cli" }).taskId;
      ledger.initBudget(bareTask, { tokenCap: 10 });
      const bal = ledger.getBalance(bareTask);
      assert(bal!.usdCap === Number.MAX_SAFE_INTEGER && bal!.callCap === Number.MAX_SAFE_INTEGER,
        "9: caps the domain did not declare are unlimited, not zero");
    }

    // 10. Re-init refreshes caps in place, counters survive.
    {
      ledger.initBudget(taskA.taskId, { tokenCap: 200000 });
      const bal = ledger.getBalance(taskA.taskId);
      assert(bal!.tokenCap === 200000 && bal!.spentTokens === 8000,
        "10: a cap refresh keeps the spend history (the task's own, not reset)");
    }

    // 11. clearBudgetCaps deactivates: getBalance null, reserves record but pass.
    {
      ledger.clearBudgetCaps(taskA.taskId);
      assert(ledger.getBalance(taskA.taskId) === null, "11: cleared caps read as unmetered");
      assert(ledger.reserveTokens(taskA.taskId, 50), "11: reserve passes on a deactivated row");
      ledger.settleTokens(taskA.taskId, 50, 50);
      ledger.initBudget(taskA.taskId, { tokenCap: 200000 });
      const bal = ledger.getBalance(taskA.taskId);
      assert(bal !== null && bal!.reservedTokens === 0 && bal!.spentTokens === 8050,
        "11: settle on the deactivated row was recorded, never negative (8050 = 8000 + 50)");
    }

    // 12. The establishment-failure contract: no budget row without a
    // registered task. The foreign key makes "the task was never registered"
    // an error the chat wiring turns into a stop, not an unmetered run.
    {
      let threw: unknown;
      try {
        ledger.initBudget("cli-never-registered", { tokenCap: 1000 });
      } catch (e) { threw = e; }
      assert(threw !== undefined, "12: initBudget for an unknown task throws (FK on task_records)");
    }

    // 13. Same store instance hands out the SAME cached ledger (the wiring,
    // the engine's per-call routing and the settle path share one object).
    {
      assert(store.createTaskBudgetLedger() === (store as any).taskBudgetLedgerInstance,
        "13: createTaskBudgetLedger caches one instance per store");
    }

    // 14. #303: the store's registry borrows the connection — a stray close()
    //     is a documented no-op, and the store keeps working afterwards.
    {
      const borrowed = store.createTaskRegistry();
      assert(borrowed === store.createTaskRegistry(), "14: createTaskRegistry caches one instance per store");
      const task = borrowed.registerTask({ kind: "mcp.ans_chat", role: "business", entry: "mcp" });
      let closeThrew = false;
      try { borrowed.close(); } catch { closeThrew = true; }
      assert(!closeThrew, "14: closing a borrowed registry does not throw");
      // The store's connection is still the store's: reading through it must work.
      assert(borrowed.taskById(task.taskId) !== null,
        "14: the store's connection survives a stray registry close");
      task.finish({ exitCode: 0 });
      assert(borrowed.taskById(task.taskId)?.endedAt !== null,
        "14: the borrowed registry still writes after the no-op close");
    }

    registry.close();
    store.close();

    // 15. #303: once the store closes its handle, the cached registry fails
    //     loudly instead of silently pretending the write landed.
    {
      const borrowed = store.createTaskRegistry();
      let threw = false;
      try { borrowed.registerTask({ kind: "mcp.ans_chat", role: "business", entry: "mcp" }); } catch { threw = true; }
      assert(threw, "15: a cached registry used after store.close() throws");
    }
  } finally {
    try { rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* best effort */ }
  }

  console.log("\ntask budget tests: " + passed + " passed, " + failed + " failed");
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("task budget test threw:", e);
  process.exit(1);
});
