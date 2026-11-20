// Task registry test (#302). Process records and task records, kept apart.
// Self-check via assert-based demo (ponytail: no test framework).
//
// The two contracts this file pins:
// - a finished task keeps its end (with the exit code); an unfinished one
//   keeps its owner, and the owner probe says alive / dead / unknown instead
//   of a guess — "unregistered leftovers are blockers to report, not rows to
//   sweep".
// - a process record is NOT a task record: registering a resident process
//   adds nothing to the task tables, so a server's lifetime can never be read
//   as one permanently-unfinished task.

import Database from "better-sqlite3";
import { openTaskRegistry } from "../src/task-registry";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return false; }
  passed++; return true;
}

/** A pid this host can confirm is gone: a child that has already exited. */
async function exitedPid(): Promise<number> {
  const child = spawn(process.execPath, ["-e", "process.exit(0)"]);
  const pid = child.pid;
  if (pid === undefined) throw new Error("could not start a child to obtain a dead pid");
  await new Promise<void>((resolve) => child.once("exit", () => resolve()));
  return pid;
}

async function main() {
  const tmpDir = mkdtempSync(join(tmpdir(), "ans-task-registry-"));
  const dbPath = join(tmpDir, "registry.db");
  const deadPid = await exitedPid();

  try {
    // 1. Cold start on a brand-new file: the registry can be the FIRST opener
    //    (the main program registers before any command builds an engine),
    //    so every table the schema owns must come into existence here.
    const registry = openTaskRegistry(dbPath);
    {
      const probe = new Database(dbPath, { readonly: true });
      try {
        const tables = probe.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r: any) => r.name);
        for (const t of ["task_records", "process_records", "task_budgets", "sessions", "budget_ledger"]) {
          assert(tables.includes(t), "1: cold start created " + t);
        }
      } finally { probe.close(); }
    }

    // 2. Register a task: identity, owner, end with the exit code.
    {
      const task = registry.registerTask({ kind: "cli.chat", role: "business", entry: "cli" });
      assert(/^cli-[0-9a-f-]{36}$/.test(task.taskId), "2: the task id is the entry plus a uuid (got " + task.taskId + ")");
      const row = registry.taskById(task.taskId)!;
      assert(row.kind === "cli.chat" && row.role === "business" && row.entry === "cli", "2: kind/role/entry recorded");
      assert(row.ownerPid === process.pid, "2: the owner pid is this process");
      assert(row.endedAt === null, "2: an open task has no end yet");
      // attachSession while running, not after.
      task.attachSession("session-handle-302");
      assert(registry.taskById(task.taskId)!.sessionId === "session-handle-302", "2: the session link lands on the open task");
      task.finish({ exitCode: 3 });
      const ended = registry.taskById(task.taskId)!;
      assert(ended.endedAt !== null && ended.exitCode === 3, "2: finish writes the end with the handler's exit code");
      // Idempotent: a second finish does not rewrite history.
      task.finish({ exitCode: 0 });
      assert(registry.taskById(task.taskId)!.exitCode === 3, "2: a second finish is a no-op (history is append-only)");
      task.attachSession("late-session");
      assert(registry.taskById(task.taskId)!.sessionId === "session-handle-302",
        "2: attaching after the end does not rewrite what the task ran under");
    }

    // 3. Open tasks, with the owner probe folded in honestly.
    {
      const open = registry.registerTask({ kind: "cli.consolidate", role: "business", entry: "cli" });
      const foreignRegistry = openTaskRegistry(dbPath, { owner: { pid: deadPid, host: "probe-host" } });
      const other = foreignRegistry.registerTask({ kind: "cli.chat", role: "business", entry: "cli" });
      const seen = registry.openTasks();
      const mine = seen.find(t => t.taskId === open.taskId)!;
      assert(mine.ownerState === "alive", "3: a same-host live owner reads as alive");
      const foreign = seen.find(t => t.taskId === other.taskId);
      assert(foreign !== undefined, "3: another registry's task is visible in the shared DB");
      // The default registry's owner.host is THIS host; probe-host is foreign
      // -> unknown, no matter what the pid does.
      assert(foreign?.ownerState === "unknown", "3: a foreign-host owner reads as unknown (no guess)");
      const dead = openTaskRegistry(dbPath, { owner: { pid: deadPid, host: "probe-host" } });
      const deadSeen = dead.openTasks();
      const deadRow = deadSeen.find(t => t.taskId === other.taskId)!;
      assert(deadRow.ownerState === "dead", "3: a provably dead same-host owner reads as dead");
      // And the dead-owner row is NOT cleaned up: honest leftovers stay.
      assert(dead.taskById(other.taskId) !== null, "3: a dead owner's unfinished task stays recorded");
      dead.close();
      foreignRegistry.close();
    }

    // 4. Process records are a separate lifetime, not tasks.
    {
      const countTasks = (): number => {
        const probe = new Database(dbPath, { readonly: true });
        try {
          return (probe.prepare("SELECT COUNT(*) AS n FROM task_records").get() as { n: number }).n;
        } finally { probe.close(); }
      };
      // Capture the count before, so this case proves the DELTA a process
      // record makes to the task table: none. A resident process is a
      // process fact, never a business task.
      const before = countTasks();
      const proc = registry.registerProcess({ entry: "cli" });
      const after = countTasks();
      assert(after === before, "4: registering a process adds no task record (before " + before + ", after " + after + ")");
      const processes = registry.openProcesses();
      assert(processes.length === 1 && processes[0].entry === "cli", "4: the process record is registered");
      proc.end();
      const afterEnd = registry.openProcesses();
      assert(afterEnd.length === 0, "4: ending the process closes the record");
      // A second end is a no-op (idempotent, like the task's finish).
      proc.end();
      assert(registry.openProcesses().length === 0, "4: a second endProcess is a no-op");
    }

    // 5. Management and business tasks are both registered — the role is the
    //    fact a future admission gate (#309) reads, not a hidden policy here.
    {
      const mgmt = registry.registerTask({ kind: "cli.doctor", role: "management", entry: "cli" });
      const biz = registry.registerTask({ kind: "cli.search", role: "business", entry: "cli" });
      assert(registry.taskById(mgmt.taskId)!.role === "management", "5: a management task keeps its role");
      assert(registry.taskById(biz.taskId)!.role === "business", "5: a business task keeps its role");
      // The open-task view a future coordinator reads: unfinished only, every
      // row carrying its own owner state (no entry filter — #309 can add one
      // when it needs per-entry views, not before).
      const open = registry.openTasks();
      assert(open.length === 4 && open.every((t) => t.entry === "cli"),
        "5: openTasks lists exactly the four unfinished tasks across registries (got " + open.length + ")");
      assert(open.every((t) => t.ownerState !== undefined), "5: every open row carries its owner state");
      mgmt.finish({ exitCode: 0 });
      biz.finish({ exitCode: 0 });
    }

    // 6. #307: post-work is recorded as a follow-up of the task that caused it,
    //    and a parent id that names no row is recorded as NO link — never a
    //    dangling reference or an invented id.
    {
      const root = registry.registerTask({ kind: "mcp.ans_chat", role: "business", entry: "mcp" });
      const followUp = registry.registerTask({
        kind: "server.project_index", role: "business", entry: "server",
        origin: "follow-up", parentTaskId: root.taskId,
      });
      const link = registry.taskById(followUp.taskId)!;
      assert(link.origin === "follow-up", "6: the follow-up keeps its origin");
      assert(link.parentTaskId === root.taskId, "6: a real parent row is linked");
      assert(followUp.parentLink === "linked", "6: the caller is told the link landed");
      assert(registry.taskById(root.taskId)!.origin === "independent",
        "6: the root keeps its own origin (the follow-up does not rewrite it)");

      // Unknown parent: the row exists but names nothing this database knows.
      const orphan = registry.registerTask({
        kind: "server.policy_audit", role: "business", entry: "server",
        origin: "follow-up", parentTaskId: "elsewhere-0000",
      });
      const orphanRow = registry.taskById(orphan.taskId)!;
      assert(orphanRow.parentTaskId === null, "6: an unknowable parent is recorded as no link, not a dead pointer");
      assert(orphan.parentLink === "unknown" && orphanRow.origin === "follow-up",
        "6: the follow-up still says it was post-work, and the caller is told the parent was unknown");

      // A follow-up may start AFTER its parent ended: that is what a tail IS.
      followUp.finish({ exitCode: 0 });
      assert(registry.taskById(followUp.taskId)!.endedAt !== null, "6: the follow-up closes on its own");
      root.finish({ exitCode: 0 });
      assert(registry.taskById(root.taskId)!.endedAt !== null, "6: ending the parent later does not reopen or unlink the follow-up");
      assert(registry.taskById(followUp.taskId)!.parentTaskId === root.taskId, "6: the link survives the parent's end");
      orphan.finish({ exitCode: 0 });
      assert(registry.openTasks().filter((t) => t.entry === "server").length === 0,
        "6: both server follow-ups ended");
    }

    // 7. #311: a process row keeps the build it started on, and an old database
    //    gains the column instead of failing to open.
    {
      const stamped = registry.registerProcess({ entry: "mcp", build: "0.2.0+cbefccab" });
      const unstamped = registry.registerProcess({ entry: "server" });
      const rows = registry.openProcesses();
      const byEntry = (entry: string) => rows.find((row) => row.entry === entry)!;
      assert(byEntry("mcp").build === "0.2.0+cbefccab",
        "7: the build a process started on is recorded");
      assert(byEntry("server").build === null,
        "7: a process that did not say its build records none rather than borrowing one");
      stamped.end();
      unstamped.end();

      // An existing file from before this column landed. Opening it must add the
      // column (the ALTER path), not throw — and afterwards a build can be
      // recorded, so an upgraded machine stops reporting "unknown".
      const legacyPath = join(tmpDir, "legacy-process-records.db");
      const legacy = new Database(legacyPath);
      legacy.exec(
        "CREATE TABLE process_records (" +
        "id INTEGER PRIMARY KEY AUTOINCREMENT, pid INTEGER NOT NULL, owner_host TEXT NOT NULL, " +
        "entry TEXT NOT NULL, started_at TEXT NOT NULL DEFAULT (datetime('now')), " +
        "ended_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))",
      );
      legacy.close();
      const upgraded = openTaskRegistry(legacyPath);
      try {
        const probe = new Database(legacyPath, { readonly: true });
        try {
          const columns = (probe.prepare("PRAGMA table_info(process_records)").all() as Array<{ name: string }>)
            .map((column) => column.name);
          assert(columns.includes("build"), "7: opening an old database adds the build column");
        } finally { probe.close(); }
        const after = upgraded.registerProcess({ entry: "cli", build: "0.2.0+cbefccab" });
        assert(upgraded.openProcesses().some((row) => row.build === "0.2.0+cbefccab"),
          "7: the upgraded database records a build from then on");
        after.end();
      } finally { upgraded.close(); }
    }

    registry.close();
  } finally {
    try { rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* best effort */ }
  }

  console.log("\ntask registry tests: " + passed + " passed, " + failed + " failed");
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("task registry test threw:", e);
  process.exit(1);
});
