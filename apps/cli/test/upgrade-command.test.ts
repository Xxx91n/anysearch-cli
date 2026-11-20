// #309 — `ans upgrade status|wait|cancel|dismiss` really drives the admission
// gate, and business entries really stop when it is closed.
//
// What this pins:
//  1. `status` is read-only: it reports blockers + which processes this host
//     cannot confirm, exits 1 while work is open, and writes no end to anything.
//  2. `wait` closes admission, returns once open work is finished, and REFUSES
//     to report success when a passed deadline still has work open (exit 1,
//     naming the blockers); it never opens admission itself on success.
//  3. `cancel` reopens admission and does not touch running work.
//  4. `dismiss` needs a reason, records it, and the row stops blocking.
//  5. `trackCliCommand` refuses a BUSINESS command while the gate is closed
//     (returns `admissionRefusal`, registers no task) but still admits a
//     MANAGEMENT command — this is the "no check-then-start hole" contract at
//     the entry, which index.ts turns into exit 4.
//  6. A process record is NOT a blocker: a resident process left open does not
//     make `wait` hang; but a task row does.
//
// Offline by construction: temp SQLite file, injected clock, no provider calls.
//
// Run: pnpm --filter @anysearch-cli/cli test

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { openTaskRegistry } from "@anysearch-cli/store";
import { runUpgrade } from "../src/commands/upgrade";
import { trackCliCommand } from "../src/cli-task-tracking";

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; console.log("  PASS " + label); }
  else { failed++; console.error("  FAIL " + label + (detail ? ": " + detail : "")); }
}

async function main(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "ans-309-upgrade-"));
  const dbPath = join(dir, "anysearch.db");
  const prevDb = process.env.ANS_DB_PATH;
  process.env.ANS_DB_PATH = dbPath;
  try {
    const io = () => {
      const out: string[] = [];
      const err: string[] = [];
      return {
        out, err,
        opts: {
          stdout: (t: string) => { out.push(t); },
          stderr: (t: string) => { err.push(t); },
        },
      };
    };

    const registry = openTaskRegistry(dbPath);
    const openTask = registry.registerTask({ kind: "cli.chat", role: "business", entry: "cli" });
    // A resident process left open: NOT a blocker (its business work is the
    // per-request rows, not its lifetime).
    const proc = registry.registerProcess({ entry: "mcp" });

    // ---- 1. status: read-only, reports the open work, exits 1 --------------
    {
      const s = io();
      const code = await runUpgrade(["status"], s.opts);
      check("1: status exits 1 while work is open", code === 1);
      const text = s.out.join("");
      check("1: status names the open task kind", text.includes("cli.chat"));
      check("1: status names the process this host is unsure about separately", /入口进程/.test(text));
      const row = registry.taskById(openTask.taskId)!;
      check("1: status wrote no end to the open task", row.endedAt === null);
      check("1: status left admission open", registry.gateState() === null);
    }
    // JSON form is machine-readable and says the same thing.
    {
      const s = io();
      await runUpgrade(["status", "--json"], s.opts);
      const parsed = JSON.parse(s.out.join("")) as { admission: string; blocked: boolean; blockers: Array<{ taskId: string }>; processes: unknown[] };
      check("1: --json says admission is open", parsed.admission === "open");
      check("1: --json lists the blocker", parsed.blockers.some((b) => b.taskId === openTask.taskId));
      check("1: --json lists the process separately", Array.isArray(parsed.processes));
    }

    // ---- 2. wait with work open: closes admission, then refuses on deadline --
    {
      const s = io();
      let nowMs = 1_000;
      const sleeps: number[] = [];
      const code = await runUpgrade(["wait", "--timeout", "600"], {
        ...s.opts,
        now: () => nowMs,
        sleep: async (ms: number) => { sleeps.push(ms); nowMs += ms; },
      });
      check("2: wait exits 1 when the deadline passes with work open", code === 1);
      check("2: wait closed admission", registry.gateState() !== null);
      const errText = s.err.join("");
      check("2: wait names the remaining blocker on failure", errText.includes("cli.chat"));
      check("2: wait did not claim the files were replaced", !/已完成|已更新/.test(errText));
      check("2: wait polled at least once before giving up", sleeps.length > 0);
      check("2: the open task is still open (nothing killed it)", registry.taskById(openTask.taskId)!.endedAt === null);
    }

    // ---- 3. a business command is refused at the entry while closed --------
    {
      const t = trackCliCommand("search");
      check("3: a business command reports an admission refusal", t.admissionRefusal !== undefined);
      check("3: the refused command registered no task", t.task === undefined);
      const t2 = trackCliCommand("upgrade");
      check("3: the upgrade command itself is still admitted", t2.admissionRefusal === undefined);
      const t3 = trackCliCommand("doctor");
      check("3: doctor is still admitted (management)", t3.admissionRefusal === undefined);
    }

    // ---- 4. wait returns once the work ends, and leaves admission closed ----
    {
      openTask.finish({ exitCode: 0 });
      const s = io();
      let nowMs = 5_000;
      const code = await runUpgrade(["wait", "--timeout", "5000"], {
        ...s.opts,
        now: () => nowMs,
        sleep: async (ms: number) => { nowMs += ms; },
      });
      check("4: wait exits 0 once open work finished", code === 0, "err=" + s.err.join("") + " out=" + s.out.join(""));
      check("4: wait says it is safe to replace files", /可以换程序/.test(s.out.join("")));
      check("4: wait does NOT reopen admission itself (that is the upgrade step)", registry.gateState() !== null);
    }

    // ---- 5. cancel reopens admission, touches no running work -------------
    {
      // The work that must survive the cancel was accepted BEFORE this pause:
      // reopen, register it, then close admission again.
      registry.closeGate();
      const busy = registry.registerTask({ kind: "cli.search", role: "business", entry: "cli" });
      registry.openGate({ note: "second pause" });
      const s = io();
      const code = await runUpgrade(["cancel"], s.opts);
      check("5: cancel exits 0", code === 0);
      check("5: cancel reopened admission", registry.gateState() === null);
      check("5: cancel did not finish or kill the running task", registry.taskById(busy.taskId)!.endedAt === null);
      busy.finish({ exitCode: 0 });
      // cancel with nothing open is honest about it.
      const s2 = io();
      const code2 = await runUpgrade(["cancel"], s2.opts);
      check("5: cancel with no pause exits 0 and says so (admission is open, not blocked)",
        code2 === 0 && /本来就是开的/.test(s2.out.join("")));
    }

    // ---- 6. dismiss needs a reason and removes the blocker ----------------
    {
      const stuck = registry.registerTask({ kind: "cli.consolidate", role: "business", entry: "cli" });
      const noReason = io();
      const code1 = await runUpgrade(["dismiss", stuck.taskId], noReason.opts);
      check("6: dismiss without --reason is a usage error (2)", code1 === 2);
      const s = io();
      const code2 = await runUpgrade(["dismiss", stuck.taskId, "--reason", "process gone, no further writes possible"], s.opts);
      check("6: dismiss with a reason exits 0", code2 === 0);
      const row = registry.taskById(stuck.taskId)!;
      check("6: dismissal leaves the row open (nothing claims it finished)", row.endedAt === null);
      check("6: the reason landed", row.dismissedReason === "process gone, no further writes possible");
      check("6: the row no longer blocks", !registry.blockingTasks().some((b) => b.taskId === stuck.taskId));
      const again = io();
      const code3 = await runUpgrade(["dismiss", stuck.taskId, "--reason", "again"], again.opts);
      check("6: dismissing an already-dismissed row exits 1 with a reason", code3 === 1 && again.err.length > 0);
      const missing = io();
      const code4 = await runUpgrade(["dismiss", "no-such-task", "--reason", "x"], missing.opts);
      check("6: an unknown task id exits 1", code4 === 1);
    }

    // ---- 7. a process record alone does not block wait --------------------
    {
      // Everything that could block is done; only the resident process record
      // (`proc`) is left open. wait must return, not hang on it.
      const s = io();
      let nowMs = 10_000;
      const code = await runUpgrade(["wait", "--timeout", "1000"], {
        ...s.opts,
        now: () => nowMs,
        sleep: async (ms: number) => { nowMs += ms; },
      });
      check("7: an open process record does not keep wait from finishing", code === 0, "err=" + s.err.join("") + " out=" + s.out.join(""));
      check("7: wait still reports the process as a re-connect note, not a blocker", /入口进程|重连/.test(s.out.join("")));
      registry.closeGate();
      proc.end();
    }

    // ---- 7b. prune: dry-run previews, the real run deletes only aged
    //          FINISHED rows and leaves a recovery point -------------------
    {
      const finished = registry.registerTask({ kind: "cli.search", role: "business", entry: "cli" });
      finished.finish({ exitCode: 0 });
      const stillOpen = registry.registerTask({ kind: "cli.chat", role: "business", entry: "cli" });
      // Age both rows; only the finished one may go.
      const Database = (await import("better-sqlite3")).default;
      const raw = new Database(dbPath);
      try {
        raw.prepare("UPDATE task_records SET ended_at = datetime('now','-45 days') WHERE task_id = ?").run(finished.taskId);
        raw.prepare("UPDATE task_records SET started_at = datetime('now','-45 days') WHERE task_id = ?").run(stillOpen.taskId);
      } finally { raw.close(); }

      const dry = io();
      const dryCode = await runUpgrade(["prune", "--dry-run"], dry.opts);
      check("7b: prune --dry-run exits 0", dryCode === 0, dry.err.join(""));
      check("7b: the dry run says how many it would delete", /会删掉/.test(dry.out.join("")), dry.out.join(""));
      check("7b: nothing was deleted by the dry run", registry.taskById(finished.taskId) !== null);

      const real = io();
      const realCode = await runUpgrade(["prune"], real.opts);
      check("7b: prune exits 0", realCode === 0, real.err.join(""));
      check("7b: the aged finished row is gone", registry.taskById(finished.taskId) === null);
      check("7b: the open row survived", registry.taskById(stillOpen.taskId) !== null);
      check("7b: it names the recovery point it left", /恢复依据在/.test(real.out.join("")), real.out.join(""));
      // The snapshot the output names really exists on disk, and so does its
      // verifiable record — the claim is checked, not taken on trust.
      const named = (real.out.join("").match(/恢复依据在 (\S+?)（/) ?? [])[1];
      check("7b: the output names a snapshot path", typeof named === "string" && named.length > 0,
        real.out.join(""));
      check("7b: the named snapshot exists on disk", !!named && existsSync(named), "expected " + String(named));
      check("7b: the snapshot's verifiable record exists too", !!named && existsSync(named + ".json"));

      const empty = io();
      check("7b: a second prune with nothing aged exits 0", (await runUpgrade(["prune"], empty.opts)) === 0);
      // One shape per command: an empty database must still carry every key a
      // script reads, not a smaller object.
      const emptyJson = io();
      await runUpgrade(["prune", "--json"], emptyJson.opts);
      const emptyShape = JSON.parse(emptyJson.out.join("")) as Record<string, unknown>;
      check("7b: the empty-database --json has the same keys",
        emptyShape.pruned === 0 && emptyShape.wouldPrune === 0 && emptyShape.wouldHold === 0
          && Array.isArray(emptyShape.rows) && typeof emptyShape.days === "number",
        JSON.stringify(emptyShape));
      const bad = io();
      check("7b: --days 0 is a usage error", (await runUpgrade(["prune", "--days", "0"], bad.opts)) === 2);
      stillOpen.finish({ exitCode: 0 });
    }

    // ---- 7c. an option without a value is a usage error, not a silent
    //          fallback to the default database/timeout ---------------------
    {
      const s1 = io();
      check("7c: --db with no value is a usage error", (await runUpgrade(["status", "--db"], s1.opts)) === 2);
      const s2 = io();
      check("7c: --timeout with no value is a usage error", (await runUpgrade(["wait", "--timeout"], s2.opts)) === 2);
      const s3 = io();
      check("7c: --db followed by another option is a usage error",
        (await runUpgrade(["status", "--db", "--json"], s3.opts)) === 2);
      check("7c: the message says a value is missing", /后面要跟一个值/.test(s3.err.join("")), s3.err.join(""));
      const s4 = io();
      check("7c: --reason with no value is a usage error",
        (await runUpgrade(["dismiss", "x", "--reason"], s4.opts)) === 2);
    }

    // ---- 7d. cancel with no pause is "admission is open", not "blocked" --
    {
      const s = io();
      const code = await runUpgrade(["cancel"], s.opts);
      check("7d: cancel with nothing to cancel exits 0 (admission is open)", code === 0, "code=" + code);
      check("7d: and still says there was no pause", /本来就是开的/.test(s.out.join("")), s.out.join(""));
    }

    // ---- 7e. status names a gate whose opener is gone (the leftover trap) --
    {
      // A wait interrupted by Ctrl-C leaves the gate closed with a dead opener.
      // status must say nobody is upgrading and name the way out.
      const probe = registry.registerTask({ kind: "cli.search", role: "business", entry: "cli" });
      const host = registry.taskById(probe.taskId)!.ownerHost;
      probe.finish({ exitCode: 0 });
      const orphan = openTaskRegistry(dbPath, { owner: { pid: 999_999, host }, isOwnerAlive: () => false });
      try { orphan.openGate({ note: "interrupted wait" }); } finally { orphan.close(); }
      const s = io();
      const code = await runUpgrade(["status"], s.opts);
      const text = s.out.join("");
      check("7e: status exits 1 while admission is closed", code === 1);
      check("7e: status says the process that closed it is gone", /已经不在了/.test(text), text);
      check("7e: status names both ways out", /upgrade wait/.test(text) && /upgrade cancel/.test(text), text);
      const j = io();
      await runUpgrade(["status", "--json"], j.opts);
      const parsed = JSON.parse(j.out.join("")) as { gateOwnerState: string };
      check("7e: --json reports the gate owner as provably gone", parsed.gateOwnerState === "dead",
        JSON.stringify(parsed.gateOwnerState));
      const cancel = io();
      check("7e: cancel clears the leftover gate", (await runUpgrade(["cancel"], cancel.opts)) === 0);
      check("7e: admission is open again", registry.gateState() === null);
    }

    // ---- 7f. dry-run preview matches what a real prune would do ----------
    {
      const parent = registry.registerTask({ kind: "cli.chat", role: "business", entry: "cli" });
      parent.finish({ exitCode: 0 });
      const child = registry.registerTask({
        kind: "server.project_index", role: "business", entry: "server",
        origin: "follow-up", parentTaskId: parent.taskId,
      });
      const Database = (await import("better-sqlite3")).default;
      const raw = new Database(dbPath);
      try {
        raw.prepare("UPDATE task_records SET ended_at = datetime('now','-45 days') WHERE task_id = ?").run(parent.taskId);
      } finally { raw.close(); }

      const dry = io();
      await runUpgrade(["prune", "--dry-run", "--json"], dry.opts);
      const preview = JSON.parse(dry.out.join("")) as { wouldPrune: number; wouldHold: number };
      check("7f: the preview subtracts rows held by a live child", preview.wouldHold === 1,
        JSON.stringify(preview));
      check("7f: and says fewer will actually go", preview.wouldPrune === 0, JSON.stringify(preview));

      const real = io();
      await runUpgrade(["prune", "--json"], real.opts);
      const done = JSON.parse(real.out.join("")) as { pruned: number; heldByChildren: number };
      check("7f: the real run agrees with the preview", done.pruned === preview.wouldPrune && done.heldByChildren === preview.wouldHold,
        JSON.stringify({ preview, done }));
      child.finish({ exitCode: 0 });
    }

    // ---- 7g. #343: the process table is cleaned by the same prune, and an
    //          open row only goes when this host proved its pid is gone ------
    {
      const Database = (await import("better-sqlite3")).default;
      const host = hostname();
      // A pid this host can confirm is gone: a child that has already exited.
      // Same trick the registry tests use.
      const exitedPid = async (): Promise<number> => {
        const child = spawn(process.execPath, ["-e", "process.exit(0)"]);
        const pid = child.pid;
        if (pid === undefined) throw new Error("could not start a child to obtain a dead pid");
        await new Promise<void>((resolve) => child.once("exit", () => resolve()));
        return pid;
      };
      const deadPid = await exitedPid();

      const raw = new Database(dbPath);
      let closedAged = 0;
      let openGoneAged = 0;
      let openGoneYoung = 0;
      let openLiveAged = 0;
      let openOtherHost = 0;
      try {
        const insertEnded = raw.prepare(
          "INSERT INTO process_records (pid, owner_host, entry, started_at, ended_at) " +
          "VALUES (?, ?, 'server', datetime('now', ?), datetime('now', ?))",
        );
        const insertOpen = raw.prepare(
          "INSERT INTO process_records (pid, owner_host, entry, started_at) " +
          "VALUES (?, ?, 'server', datetime('now', ?))",
        );
        closedAged = Number(insertEnded.run(deadPid, host, "-45 days", "-40 days").lastInsertRowid);
        openGoneAged = Number(insertOpen.run(deadPid, host, "-45 days").lastInsertRowid);
        openGoneYoung = Number(insertOpen.run(deadPid, host, "-1 hours").lastInsertRowid);
        // This test process is its own live pid, so "still in use" needs no setup.
        openLiveAged = Number(insertOpen.run(process.pid, host, "-45 days").lastInsertRowid);
        openOtherHost = Number(insertOpen.run(deadPid, "another-host", "-45 days").lastInsertRowid);
      } finally { raw.close(); }

      const dry = io();
      check("7g: prune --dry-run exits 0", (await runUpgrade(["prune", "--dry-run"], dry.opts)) === 0, dry.err.join(""));
      const dryText = dry.out.join("");
      check("7g: the dry run counts the process rows it would delete", /进程登记会删掉 2 条/.test(dryText), dryText);
      check("7g: it names both reasons a row qualifies",
        /已收尾于/.test(dryText) && /本机确认这个进程已经不在了/.test(dryText), dryText);
      check("7g: it says why the rest stay (window / pid in use / other host)",
        /还没到保留窗口/.test(dryText) && /进程号还被占着/.test(dryText) && /别的机器记的/.test(dryText), dryText);

      const afterDry = new Database(dbPath, { readonly: true });
      try {
        const still = (afterDry.prepare("SELECT COUNT(*) AS n FROM process_records WHERE id = ?").get(closedAged) as { n: number }).n;
        check("7g: the dry run deleted nothing", still === 1);
      } finally { afterDry.close(); }

      const real = io();
      check("7g: prune exits 0", (await runUpgrade(["prune"], real.opts)) === 0, real.err.join(""));
      const realText = real.out.join("");
      check("7g: the real run reports both tables", /进程登记删掉了 2 条/.test(realText), realText);
      check("7g: it names the recovery point it left", /恢复依据在/.test(realText), realText);

      const after = new Database(dbPath, { readonly: true });
      try {
        const has = (id: number): boolean =>
          (after.prepare("SELECT COUNT(*) AS n FROM process_records WHERE id = ?").get(id) as { n: number }).n === 1;
        check("7g: the ended aged row is gone", !has(closedAged));
        check("7g: the open row whose pid is gone and is aged is gone", !has(openGoneAged));
        check("7g: a young open row is kept by the window", has(openGoneYoung));
        check("7g: an open row whose pid is still in use is kept", has(openLiveAged));
        check("7g: an open row from another host is kept", has(openOtherHost));
      } finally { after.close(); }

      const st = io();
      check("7g: status exits 0 with nothing blocking", (await runUpgrade(["status"], st.opts)) === 0, st.err.join(""));
      const stText = st.out.join("");
      check("7g: status folds the proven-gone rows into one line",
        /另有 1 条入口进程本机已经确认不在了/.test(stText), stText);
      check("7g: status no longer prints each gone row",
        !/本机确认已经没了，但没写结束/.test(stText), stText);

      const stJson = io();
      await runUpgrade(["status", "--json"], stJson.opts);
      const snap = JSON.parse(stJson.out.join("")) as { processes: Array<{ ownerState: string }> };
      check("7g: status --json still lists every row one by one",
        snap.processes.length === 4 && snap.processes.filter((p) => p.ownerState === "dead").length === 1,
        JSON.stringify(snap.processes));

      // Idempotent: a second run has nothing to delete and writes no snapshot.
      const again = io();
      check("7g: a second prune with nothing aged exits 0", (await runUpgrade(["prune"], again.opts)) === 0, again.err.join(""));
      check("7g: the second run wrote no extra recovery point", !/恢复依据在/.test(again.out.join("")), again.out.join(""));
    }

    // ---- 8. bad usage is its own exit code -------------------------------
    {
      const s = io();
      check("8: --timeout with junk is a usage error", (await runUpgrade(["wait", "--timeout", "abc"], s.opts)) === 2);
      const s2 = io();
      check("8: an unknown subcommand is a usage error", (await runUpgrade(["frobnicate"], s2.opts)) === 2);
      const s3 = io();
      check("8: --help exits 0", (await runUpgrade(["--help"], s3.opts)) === 0);
    }

    registry.close();
  } finally {
    if (prevDb === undefined) delete process.env.ANS_DB_PATH; else process.env.ANS_DB_PATH = prevDb;
    try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* best effort */ }
  }

  console.log("\nupgrade command tests: " + passed + " passed, " + failed + " failed");
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("upgrade command test threw:", e);
  process.exit(1);
});
