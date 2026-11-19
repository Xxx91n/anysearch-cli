// #309: upgrade admission — closing the gate refuses NEW business work in the
// same transaction it is registered, keeps management and follow-up work
// running, and never treats a liveness probe as "the work finished".
//
// What this pins (the acceptance list of #309, at the layer that owns it):
// - a business task registered while the gate is open is refused, and it
//   leaves NO row behind (nothing ran, so nothing blocks the upgrade that
//   refused it);
// - management work (the commands that drive the upgrade) and follow-up work
//   (tails of requests already accepted) still register;
// - `blockingTasks()` is business only, excludes dismissed rows, and carries
//   the owner probe — a dead pid is still a blocker (an open row whose fate is
//   unproven), never "finished";
// - `dismissTask` needs a reason, never writes `ended_at`, and makes the row
//   stop blocking;
// - the gate is one durable row shared across registries (separate processes
//   read the same decision), and it reopens cleanly.
//
// Self-check (ponytail: no test framework), same shape as task-registry.test.ts.
//
// Run: pnpm --filter @anysearch-cli/store test

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { AdmissionClosedError, openTaskRegistry } from "../src/task-registry";

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; console.log("  PASS " + label); }
  else { failed++; console.error("  FAIL " + label + (detail ? ": " + detail : "")); }
}

function main(): void {
  const dir = mkdtempSync(join(tmpdir(), "ans-upgrade-gate-"));
  const dbPath = join(dir, "anysearch.db");

  try {
    // ---- A. admission open: work is accepted, and there is no gate ---------
    const registry = openTaskRegistry(dbPath);
    check("A: no gate on a fresh database", registry.gateState() === null);

    const first = registry.registerTask({ kind: "cli.search", role: "business", entry: "cli" });
    const live = registry.registerTask({ kind: "cli.consolidate", role: "business", entry: "cli" });
    // An owner this host can prove dead, registered while admission is open:
    // its row is what the dismissal case below works on.
    const deadOwner = openTaskRegistry(dbPath, {
      owner: { pid: 999_999, host: registry.taskById(first.taskId)!.ownerHost },
      isOwnerAlive: () => false,
    });
    let orphan: { taskId: string } | undefined;
    try {
      orphan = deadOwner.registerTask({ kind: "cli.search", role: "business", entry: "cli" });
    } finally {
      deadOwner.close();
    }
    check("A: a business task registers while admission is open", registry.taskById(first.taskId)?.endedAt === null);

    // ---- B. closing the gate refuses new business work, in-transaction -----
    const gate = registry.openGate({ note: "test upgrade" });
    check("B: the gate opens and is readable", registry.gateState()?.gateId === gate.gateId);
    // Idempotent: a second open keeps the same gate (two openers agree).
    check("B: opening twice keeps the same gate", registry.openGate().gateId === gate.gateId);

    let refused: AdmissionClosedError | undefined;
    try {
      registry.registerTask({ kind: "cli.chat", role: "business", entry: "cli" });
    } catch (e) {
      if (e instanceof AdmissionClosedError) refused = e;
    }
    check("B: a new business task is refused while the gate is closed", refused !== undefined);
    check("B: the refusal names the gate it saw", refused?.gate.gateId === gate.gateId);
    // Refusal leaves no row: "nothing ran" must not become a phantom blocker.
    const chatRows = registry.openTasks().filter((t) => t.kind === "cli.chat");
    check("B: the refused task wrote no row", chatRows.length === 0);

    // ---- C. management and follow-up work are still admitted --------------
    const mgmt = registry.registerTask({ kind: "cli.upgrade", role: "management", entry: "cli" });
    check("C: management work registers while the gate is closed", registry.taskById(mgmt.taskId) !== null);
    const followUp = registry.registerTask({
      kind: "server.project_index", role: "business", entry: "server",
      origin: "follow-up", parentTaskId: first.taskId,
    });
    check("C: a follow-up of already-accepted work registers while closed", registry.taskById(followUp.taskId) !== null);
    check("C: the follow-up linked to its parent", followUp.parentLink === "linked");

    // ---- D. blockingTasks: business only, dismissed excluded, probe honest -
    const blockers = registry.blockingTasks();
    check("D: the open business tasks are blockers",
      blockers.some((b) => b.taskId === first.taskId) && blockers.some((b) => b.taskId === live.taskId));
    check("D: management work is not a blocker", !blockers.some((b) => b.taskId === mgmt.taskId));
    check("D: follow-up work IS a blocker (it is still a write in flight)", blockers.some((b) => b.taskId === followUp.taskId));
    check("D: a dead-owner row is still a blocker (fate unproven, not finished)",
      blockers.some((b) => b.taskId === orphan!.taskId && b.ownerState === "dead"));

    // ---- E. dismissing needs a reason and does not claim the task ended ---
    let threw = false;
    try { registry.dismissTask(orphan!.taskId, "   "); } catch { threw = true; }
    check("E: a blank reason is refused", threw);
    check("E: dismissing an open row succeeds", registry.dismissTask(orphan!.taskId, "host crashed, log confirms") === true);
    const dismissedRow = registry.taskById(orphan!.taskId)!;
    check("E: dismissal leaves ended_at NULL (nothing claims the task finished)", dismissedRow.endedAt === null);
    check("E: the reason is recorded", dismissedRow.dismissedReason === "host crashed, log confirms");
    check("E: a dismissed row stops blocking", !registry.blockingTasks().some((b) => b.taskId === orphan!.taskId));
    check("E: a dismissed row is no longer dismissable", !registry.dismissableTasks().some((b) => b.taskId === orphan!.taskId));
    check("E: dismissing twice is a no-op", registry.dismissTask(orphan!.taskId, "again") === false);

    // ---- F. reopening admission lets new work in again -------------------
    check("F: closing a closed gate reports it was open", registry.closeGate() === true);
    check("F: the gate is gone", registry.gateState() === null);
    const afterGate = registry.registerTask({ kind: "cli.search", role: "business", entry: "cli" });
    check("F: a business task registers again once admission reopens", registry.taskById(afterGate.taskId) !== null);
    check("F: closing already-open admission is a no-op", registry.closeGate() === false);

    // ---- G. the gate is one shared durable decision across registries ----
    const shared = registry.openGate({ note: "cross-process" });
    const other = openTaskRegistry(dbPath);
    try {
      check("G: another registry sees the same gate", other.gateState()?.gateId === shared.gateId);
      let otherRefused = false;
      try { other.registerTask({ kind: "cli.chat", role: "business", entry: "cli" }); } catch { otherRefused = true; }
      check("G: another registry's new business work is refused too", otherRefused);
      check("G: the other registry can end the pause", other.closeGate() === true);
    } finally {
      other.close();
    }
    check("G: admission is open again after that", registry.gateState() === null);

    // ---- J. history retention: open rows survive, aged finished rows go ----
    {
      const kept = registry.registerTask({ kind: "cli.search", role: "business", entry: "cli" });
      const old = registry.registerTask({ kind: "cli.chat", role: "business", entry: "cli" });
      old.finish({ exitCode: 0 });
      // Age the finished row past the window without touching the open one.
      const aged = new Database(dbPath);
      try {
        aged.prepare("UPDATE task_records SET ended_at = datetime('now', '-40 days') WHERE task_id = ?").run(old.taskId);
      } finally { aged.close(); }

      const preview = registry.agedFinishedTasks(30);
      check("J: the aged finished row is listed for pruning",
        preview.some((r) => r.taskId === old.taskId));
      check("J: the open row is never listed, however old it is",
        !preview.some((r) => r.taskId === kept.taskId));

      // Dry-run is the listing; pruning removes exactly the aged finished rows.
      const pruned = registry.pruneFinishedTasks(30);
      check("J: pruning removed the aged finished row", pruned.removed === 1, "removed=" + pruned.removed);
      check("J: the finished row is gone", registry.taskById(old.taskId) === null);
      check("J: the open row survived the prune", registry.taskById(kept.taskId) !== null);

      // A dismissed-but-open row is still an OPEN row: retention must not eat it.
      const stuck = registry.registerTask({ kind: "cli.consolidate", role: "business", entry: "cli" });
      registry.dismissTask(stuck.taskId, "no one can finish this");
      const agedOpen = new Database(dbPath);
      try {
        agedOpen.prepare("UPDATE task_records SET started_at = datetime('now', '-90 days') WHERE task_id = ?").run(stuck.taskId);
      } finally { agedOpen.close(); }
      registry.pruneFinishedTasks(1);
      check("J: a dismissed-but-open row survives pruning (it is still open)",
        registry.taskById(stuck.taskId) !== null);

      // A nonsense window is refused instead of silently meaning something else.
      let badWindow = false;
      try { registry.pruneFinishedTasks(0); } catch { badWindow = true; }
      check("J: a zero-day retention window is rejected", badWindow);
      kept.finish({ exitCode: 0 });
      stuck.finish({ exitCode: 0 });
    }

    // ---- J2. an aged row that a surviving row still points at is kept ----
    {
      // parent_task_id references this same table with no ON DELETE action, so a
      // blind DELETE would abort the whole prune (review finding: measured
      // FOREIGN KEY constraint failed). The aged parent must survive, and the
      // live child must keep its link.
      const parent = registry.registerTask({ kind: "cli.chat", role: "business", entry: "cli" });
      parent.finish({ exitCode: 0 });
      const child = registry.registerTask({
        kind: "server.project_index", role: "business", entry: "server",
        origin: "follow-up", parentTaskId: parent.taskId,
      });
      const raw = new Database(dbPath);
      try {
        raw.prepare("UPDATE task_records SET ended_at = datetime('now','-45 days') WHERE task_id = ?").run(parent.taskId);
      } finally { raw.close(); }

      const pruned = registry.pruneFinishedTasks(30);
      check("J2: the aged parent is held back, not deleted", registry.taskById(parent.taskId) !== null);
      check("J2: the prune reports it as held by a child", pruned.heldByChildren === 1, "held=" + pruned.heldByChildren);
      check("J2: the live child keeps its link", registry.taskById(child.taskId)!.parentTaskId === parent.taskId);
      check("J2: prune did not fail (no FK abort)", pruned.removed >= 0);
      child.finish({ exitCode: 0 });
      // A child that just ended is NOT aged yet, so the parent is still held
      // back — lossless, at the cost of pruning that pair 30 days later.
      const stillHeld = registry.pruneFinishedTasks(30);
      check("J2: a freshly finished child still holds its parent back",
        registry.taskById(parent.taskId) !== null && stillHeld.heldByChildren === 1);
      // Age the child as well: now the pair is deletable in one go.
      const ageChild = new Database(dbPath);
      try {
        ageChild.prepare("UPDATE task_records SET ended_at = datetime('now','-45 days') WHERE task_id = ?").run(child.taskId);
      } finally { ageChild.close(); }
      const second = registry.pruneFinishedTasks(30);
      check("J2: once both are aged, the pair goes together",
        registry.taskById(parent.taskId) === null && registry.taskById(child.taskId) === null);
      check("J2: nothing is left held back", second.heldByChildren === 0, "held=" + second.heldByChildren);
    }

    // ---- J3. the gate reports whether its opener is still running ---------
    {
      const foreign = openTaskRegistry(dbPath, { owner: { pid: 999_999, host: "gone-host" }, isOwnerAlive: () => false });
      try {
        foreign.openGate({ note: "orphan" });
        const viewed = registry.gateOwnerState();
        check("J3: the gate is reported with its owner state", viewed !== null && viewed.ownerState === "unknown",
          JSON.stringify(viewed));
      } finally { foreign.closeGate(); foreign.close(); }
      check("J3: closing from that registry reopens admission", registry.gateState() === null);
    }

    // ---- J4. a second `wait` adopts a gate whose opener is gone -----------
    {
      const host = registry.taskById("none")?.ownerHost ?? registry.openTasks()[0]?.ownerHost ?? "";
      const dead = openTaskRegistry(dbPath, { owner: { pid: 999_999, host }, isOwnerAlive: () => false });
      try {
        const first = dead.openGate({ note: "interrupted wait" });
        check("J4: a dead owner closes admission", registry.gateOwnerState()?.ownerState === "dead");
        // The live registry calling openGate again must TAKE OVER, not return the
        // dead holder — otherwise every later status read keeps saying "nobody is
        // upgrading" while this wait is sitting right there.
        const adopted = registry.openGate({ note: "second wait" });
        check("J4: the gate keeps its identity (it is the same pause)", adopted.gateId === first.gateId);
        check("J4: the holder is now the live process", registry.gateOwnerState()?.ownerState === "alive",
          JSON.stringify(registry.gateOwnerState()));
        check("J4: and the note names the takeover", registry.gateState()?.note === "second wait");
      } finally { dead.close(); registry.closeGate(); }
      check("J4: admission reopened for the next section", registry.gateState() === null);
    }

    // ---- J5. the preview matches the real prune on a CHAIN ---------------
    {
      // A(parent) <- B(child) <- C(grandchild), all finished and all aged. The
      // real prune peels one generation per pass and ends up deleting all
      // three; the preview has to say the same thing.
      const a = registry.registerTask({ kind: "cli.chat", role: "business", entry: "cli" });
      a.finish({ exitCode: 0 });
      const b = registry.registerTask({
        kind: "server.project_index", role: "business", entry: "server",
        origin: "follow-up", parentTaskId: a.taskId,
      });
      b.finish({ exitCode: 0 });
      const c = registry.registerTask({
        kind: "server.policy_audit", role: "business", entry: "server",
        origin: "follow-up", parentTaskId: b.taskId,
      });
      c.finish({ exitCode: 0 });
      const age = new Database(dbPath);
      try {
        age.prepare("UPDATE task_records SET ended_at = datetime('now','-45 days') WHERE task_id IN (?,?,?)")
          .run(a.taskId, b.taskId, c.taskId);
      } finally { age.close(); }

      const preview = registry.previewPrune(30);
      check("J5: the chain is entirely prunable, previewed as such", preview.wouldPrune.length === 3,
        JSON.stringify({ prune: preview.wouldPrune.length, hold: preview.wouldHold.length }));
      check("J5: nothing in the chain is predicted as held", preview.wouldHold.length === 0,
        JSON.stringify(preview.wouldHold.map((r) => r.taskId)));
      const real = registry.pruneFinishedTasks(30);
      check("J5: the real run removes exactly what the preview said",
        real.removed === preview.wouldPrune.length && real.heldByChildren === preview.wouldHold.length,
        JSON.stringify({ real, previewed: preview.wouldPrune.length }));
      check("J5: and the chain is gone", registry.taskById(a.taskId) === null && registry.taskById(c.taskId) === null);
    }

    // ---- J6. adoption refuses to fake a gate that vanished mid-flight -----
    {
      // Simulate the race: the gate is read, then someone cancels, then the
      // takeover runs. A 0-row UPDATE must become an error, never a stale gate.
      const gate = registry.openGate({ note: "about to vanish" });
      check("J6: a live gate is not adopted, just returned",
        registry.openGate({ note: "second" }).gateId === gate.gateId);
      check("J6: its note is unchanged (no takeover of a live holder)",
        registry.gateState()?.note === "about to vanish");
      registry.closeGate();
    }

    registry.close();

    // ---- H. the shape survives a reopen ----------------------------------
    const reopened = openTaskRegistry(dbPath);
    try {
      check("H: a reopened registry reads dismissed_at on the rows",
        reopened.taskById(first.taskId)!.dismissedAt === null);
      check("H: the dismissed row keeps its reason across a reopen",
        reopened.taskById(orphan!.taskId)!.dismissedReason === "host crashed, log confirms");
    } finally {
      reopened.close();
    }
    {
      const probe = new Database(dbPath, { readonly: true });
      try {
        const cols = (probe.prepare("PRAGMA table_info(task_records)").all() as Array<{ name: string }>).map((r) => r.name);
        check("H: task_records carries the dismissal columns", cols.includes("dismissed_at") && cols.includes("dismissed_reason"));
        const gateCols = (probe.prepare("PRAGMA table_info(upgrade_gate)").all() as Array<{ name: string }>).map((r) => r.name);
        check("H: upgrade_gate exists with its columns", gateCols.includes("gate_id") && gateCols.includes("opened_by_pid"));
      } finally {
        probe.close();
      }
    }

    // ---- I. an old file (no dismissal columns, no gate) is migrated ------
    {
      const oldPath = join(dir, "old.db");
      const old = new Database(oldPath);
      try {
        old.exec(`CREATE TABLE task_records (
          task_id TEXT PRIMARY KEY, kind TEXT NOT NULL,
          role TEXT NOT NULL CHECK (role IN ('business','management')),
          entry TEXT NOT NULL, owner_pid INTEGER NOT NULL, owner_host TEXT NOT NULL,
          session_id TEXT, started_at TEXT NOT NULL DEFAULT (datetime('now')),
          ended_at TEXT, exit_code INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')),
          origin TEXT NOT NULL DEFAULT 'independent' CHECK (origin IN ('independent','follow-up')),
          parent_task_id TEXT REFERENCES task_records(task_id));`);
        old.prepare(
          "INSERT INTO task_records (task_id, kind, role, entry, owner_pid, owner_host) VALUES ('cli-old', 'cli.chat', 'business', 'cli', 4242, 'old-host')",
        ).run();
      } finally { old.close(); }

      const migrated = openTaskRegistry(oldPath);
      try {
        check("I: an old open row starts as NOT dismissed (still a blocker)", migrated.blockingTasks().some((b) => b.taskId === "cli-old"));
        check("I: the gate table was created for the old file", migrated.gateState() === null);
      } finally { migrated.close(); }
    }
  } finally {
    try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* best effort */ }
  }

  console.log("\nupgrade gate tests: " + passed + " passed, " + failed + " failed");
  if (failed > 0) process.exit(1);
}

try {
  main();
} catch (e) {
  console.error("upgrade gate test threw:", e);
  process.exit(1);
}
