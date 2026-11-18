// #302 — the CLI wiring really connects the per-execution task budget.
//
// Drives the exact helpers `runChat`/index.ts call: wireChatTaskBudget against
// a real SqliteSessionStore whose task_records rows were written by the real
// registry, and trackCliCommand against a temp ANS_DB_PATH. A budget row that
// cannot be established must surface as a fault, never as an unmetered run.
//
// Deliberately NOT imported: ../src/commands/chat (ESM-only pi-agent-core).
//
// Run: pnpm --filter @anysearch-cli/cli test

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteSessionStore, openTaskRegistry } from "@anysearch-cli/store";
import { wireChatTaskBudget } from "../src/commands/chat-task-budget";
import { trackCliCommand, cliTaskKind, cliTaskRole, tryRegister } from "../src/cli-task-tracking";
import { currentCliTask, runWithCliTask } from "../src/cli-task-context";

let passed = 0, failed = 0;
function check(cond: boolean, msg: string): void {
  if (cond) { passed++; } else { failed++; console.error("FAIL: " + msg); }
}

async function main() {
  const dir = mkdtempSync(join(tmpdir(), "ans-302-cli-"));
  const dbPath = join(dir, "anysearch.db");
  const prevDb = process.env.ANS_DB_PATH;
  try {
    const registry = openTaskRegistry(dbPath);
    const store = new SqliteSessionStore(dbPath);
    const budget = { tokenCap: 4321, callCap: 7 };

    // 1. Declared + registered task: the budget row lands on the task.
    {
      const task = registry.registerTask({ kind: cliTaskKind("chat"), role: cliTaskRole("chat"), entry: "cli" });
      const wiring = wireChatTaskBudget(store, task.taskId, budget);
      check(wiring.taskBudget !== undefined && wiring.taskBudgetFault === undefined,
        "1: a declared budget over a registered task establishes");
      check(wiring.taskBudget!.taskId === task.taskId, "1: the scope names the task");
      const bal = wiring.taskBudget!.ledger.getBalance(task.taskId);
      check(bal?.tokenCap === 4321 && bal?.callCap === 7, "1: the task budget row carries the declared caps");
      // The task wiring must not touch the session form's table.
      const sessionRows = (store as any).db
        .prepare("SELECT COUNT(*) AS n FROM budget_ledger")
        .get() as { n: number };
      check(sessionRows.n === 0, "1: the task wiring creates no session budget row");
      task.finish({ exitCode: 0 });
    }

    // 2. Declared but the task was never registered: a fault, not unmetered.
    {
      const wiring = wireChatTaskBudget(store, "cli-never-registered", budget);
      check(wiring.taskBudget === undefined && typeof wiring.taskBudgetFault === "string",
        "2: an unregistered task id is a fault");
      check(/establishment failed/.test(wiring.taskBudgetFault ?? ""),
        "2: the fault names the establishment failure (FK on task_records)");
    }

    // 3. Declared, no task id at all (registry broken / context absent).
    {
      const wiring = wireChatTaskBudget(store, undefined, budget);
      check(wiring.taskBudget === undefined && /registered no task/.test(wiring.taskBudgetFault ?? ""),
        "3: a declared budget with no registered task is a fault");
    }

    // 3b. Declared, a task id but NO store: the fault must name the missing
    //     store, not a missing seam — the two point a debugger at different
    //     places (review finding on the shared kernel wiring, #303).
    {
      const wiring = wireChatTaskBudget(undefined, "cli-no-store", budget);
      check(wiring.taskBudget === undefined && /no session store/.test(wiring.taskBudgetFault ?? ""),
        "3b: a missing store is named as such (got " + JSON.stringify(wiring.taskBudgetFault) + ")");
      check(!/createTaskBudgetLedger/.test(wiring.taskBudgetFault ?? ""),
        "3b: it does not blame a missing seam");
      const undeclared = wireChatTaskBudget(undefined, "cli-no-store", undefined);
      check(undeclared.taskBudget === undefined && undeclared.taskBudgetFault === undefined,
        "3b: an undeclared domain with no store is still the unmetered session form");
    }

    // 3c. #303: a degraded corner must SAY it is degraded — otherwise "store
    //     could not hand out a ledger" looks exactly like a healthy unmetered
    //     run (review finding).
    {
      const lines: string[] = [];
      const noSeamStore = {} as never;
      const wiring = wireChatTaskBudget(noSeamStore, "cli-no-ledger", undefined, {
        warn: (m: string) => lines.push(m),
      });
      check(wiring.taskBudget === undefined && wiring.taskBudgetFault === undefined,
        "3c: undeclared + no ledger seam stays the unmetered session form");
      check(lines.length === 1 && /no ledger seam/.test(lines[0] ?? ""),
        "3c: and it warns once instead of looking healthy (got " + JSON.stringify(lines) + ")");
      const declared = wireChatTaskBudget(noSeamStore, "cli-no-ledger", budget, { warn: () => {} });
      check(/lacks createTaskBudgetLedger/.test(declared.taskBudgetFault ?? ""),
        "3c: a declared budget in the same corner is still the seam fault");
    }

    // 4. Undeclared + task: the scope still travels, but no row exists —
    //    unmetered for this task, and never a fall-back to the session form.
    {
      const task = registry.registerTask({ kind: "cli.chat", role: "business", entry: "cli" });
      const wiring = wireChatTaskBudget(store, task.taskId, undefined);
      check(wiring.taskBudget !== undefined && wiring.taskBudgetFault === undefined,
        "4: an undeclared domain still wires the task scope");
      check(wiring.taskBudget!.ledger.getBalance(task.taskId) === null,
        "4: no budget row was created (undeclared = unmetered)");
      task.finish({ exitCode: 0 });
    }

    // 5. Undeclared + no task: nothing to establish, nothing to fault on.
    {
      const wiring = wireChatTaskBudget(store, undefined, undefined);
      check(wiring.taskBudget === undefined && wiring.taskBudgetFault === undefined,
        "5: undeclared + unregistered stays quiet");
    }

    // 6. A store without the seam (hand-built): declared → fault; undeclared → quiet.
    {
      const bare = { createTaskBudgetLedger: undefined } as any;
      const declared = wireChatTaskBudget(bare, "cli-x", budget);
      check(/createTaskBudgetLedger/.test(declared.taskBudgetFault ?? ""),
        "6: a store lacking the seam faults on a declared budget");
      const quiet = wireChatTaskBudget(bare, "cli-x", undefined);
      check(quiet.taskBudget === undefined && quiet.taskBudgetFault === undefined,
        "6: the same store stays quiet when nothing was declared");
    }

    registry.close();
    store.close();

    // 7. trackCliCommand: uniform registration on a real temp DB.
    {
      process.env.ANS_DB_PATH = dbPath;
      try {
        // business command: task + process records, context threading.
        const tracking = trackCliCommand("chat");
        check(tracking.task !== undefined, "7: a business command registers a task");
        const sawInside = tracking.task!.run(() => currentCliTask());
        check(sawInside !== undefined && typeof sawInside.taskId === "string" && sawInside.taskId.length > 0,
          "7: the handler sees the task identity inside the context");
        check(sawInside?.kind === "cli.chat" && sawInside?.role === "business",
          "7: the identity carries kind and role");
        tracking.task!.finish(0);
        tracking.endProcess();
        const probe = openTaskRegistry(dbPath);
        const rows = probe.openTasks();
        check(rows.length === 0, "7: after finish, the task is no longer open");
        const openProcesses = probe.openProcesses();
        check(openProcesses.length === 0, "7: after endProcess, the process record is closed");
        // management command: registered with the management role.
        const doctorTracking = trackCliCommand("doctor");
        check(doctorTracking.task !== undefined, "7: a management command is also registered");
        const doctorTask = doctorTracking.task!.run(() => currentCliTask());
        check(doctorTask?.role === "management", "7: doctor registers as management (usable during an admission pause)");
        doctorTracking.task!.finish(0);
        doctorTracking.endProcess();
        // process-entry command: a process record, never a task.
        const mcpTracking = trackCliCommand("mcp");
        check(mcpTracking.task === undefined, "7: `ans mcp` registers no task — a resident server is not an unfinished task");
        mcpTracking.endProcess();
        // after all three: no open tasks (the mcp path registered none, and
        // every earlier task in this file was finished).
        check(probe.openTasks().length === 0, "7: no unfinished tasks remain from the three commands");
        probe.close();
      } finally {
        if (prevDb === undefined) delete process.env.ANS_DB_PATH;
        else process.env.ANS_DB_PATH = prevDb;
      }
    }

    // 8. A broken registry does not break the command.
    {
      const blocker = join(dir, "not-a-dir");
      writeFileSync(blocker, "x", "utf8");
      const prev = process.env.ANS_DB_PATH;
      process.env.ANS_DB_PATH = join(blocker, "anysearch.db");
      try {
        let tracking: ReturnType<typeof trackCliCommand> | undefined;
        try {
          tracking = trackCliCommand("chat");
        } catch (e) {
          check(false, "8: trackCliCommand must not throw when the registry cannot open (" + String(e) + ")");
        }
        if (tracking) {
          check(tracking.task === undefined, "8: no task was registered (the registry is broken)");
          check(typeof tracking.endProcess === "function", "8: the endProcess stub exists");
          tracking.endProcess();
        }
      } finally {
        if (prev === undefined) delete process.env.ANS_DB_PATH;
        else process.env.ANS_DB_PATH = prev;
      }
    }

    // 9. The context degrades to undefined outside a run (no task reads
    //    anything stale after the dispatch wrapper returns).
    {
      check(currentCliTask() === undefined, "9: currentCliTask outside a run is undefined");
      const inner = runWithCliTask({ taskId: "t", kind: "cli.chat", role: "business", attachSession: () => {} }, () => currentCliTask());
      check(inner?.taskId === "t", "9: runWithCliTask threads the identity synchronously");
    }

    // 10. tryRegister: a registration WRITE that throws degrades to undefined
    //     plus a warning, never an exception out of trackCliCommand. (Greptile's
    //     point: the writes used to sit outside the open's try/catch, so a
    //     contended DB or a full disk took down `doctor` too.) Case 8 proves
    //     the open-failure shape end-to-end; this pins the write-failure guard
    //     itself, which an open cannot fail into.
    {
      let warned: string[] = [];
      const origWrite = process.stderr.write.bind(process.stderr);
      (process.stderr as { write: (chunk: string) => boolean }).write = (chunk: string) => {
        warned.push(String(chunk));
        return true;
      };
      let threw = false;
      let degraded: number | undefined;
      try {
        degraded = tryRegister(() => { throw new Error("database is locked"); }, "task registration");
      } catch {
        threw = true;
      } finally {
        (process.stderr as { write: (chunk: string) => boolean }).write = origWrite;
      }
      check(!threw, "10: a throwing registration write never escapes tryRegister");
      check(degraded === undefined, "10: the failed write reads as 'nothing registered'");
      check(warned.some((w) => w.includes("task registration failed") && w.includes("database is locked")),
        "10: the degradation warns on stderr with the named fault");
      check(tryRegister(() => 42, "task registration") === 42,
        "10: a healthy write passes through unchanged");
    }
  } finally {
    try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* best effort */ }
  }

  console.log("\nchat task wiring tests: " + passed + " passed, " + failed + " failed");
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("chat task wiring test threw:", e);
  process.exit(1);
});
