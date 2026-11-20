// #307: the hook service's post-work runs under a task row like every other
// entry, and the HTTP response waits for it.
//
// Three things are pinned here, because they are what an upgrade coordinator
// (#309) will read:
// - a /index write and a /policy audit each leave an ENDED task row (origin
//   "follow-up", entry "server") in the shared durable DB — not a fire-and-forget
//   write nobody can observe;
// - the response is sent only after that row ends, so a hook holding a 200 can
//   rely on the rows being durable, and a caller that names a real parent gets
//   the link; a parent id from elsewhere is recorded as "unknown", never as a
//   dangling reference;
// - a start that never listened ends its own process row on the way out (#344),
//   so a failed start cannot leave a record nothing will ever close.
//
// The service is the real one (spawned), not a copy: the point is that the
// production wiring registers the task, not that a helper could.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { openTaskRegistry } from "@anysearch-cli/store";
import { createPostWorkTracker, resetPostWorkWarnings } from "../src/server/post-work.js";

const PLUGIN_ROOT = join(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const TOKEN = "post-work-token";

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = address && typeof address === "object" ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

function project(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), "ans-postwork-" + tag + "-"));
  mkdirSync(join(dir, ".git"));
  mkdirSync(join(dir, "domains"), { recursive: true });
  writeFileSync(join(dir, "domains", "default.toml"), [
    'name = "default"',
    "[sources]",
    'enabled = ["tavily"]',
    'urlAllowlist = ["allowed.example"]',
    "[skills]",
    'active = ["search"]',
    "[hooks]",
    'toolWhitelist = ["search"]',
    "[rag]",
    'adapter = "none"',
    "",
  ].join("\n"), "utf8");
  return dir;
}

async function waitForServer(base: string): Promise<void> {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(base + "/health", { headers: { Authorization: "Bearer " + TOKEN } });
      if (response.status === 200) return;
    } catch { /* not up yet */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("plugin server did not become ready");
}

function stopProcess(proc: ReturnType<typeof spawn>): Promise<void> {
  return new Promise((resolve) => {
    if (proc.pid && process.platform === "win32") {
      spawn("taskkill", ["/pid", String(proc.pid), "/T", "/F"], { stdio: "ignore" })
        .once("exit", () => resolve());
      return;
    }
    if (proc.pid) { try { process.kill(-proc.pid, "SIGKILL"); } catch { /* gone */ } }
    proc.once("exit", () => resolve());
  });
}

/**
 * Everything a spawned service needs to stay inside this test's temp dir: no
 * operator home, no operator database, its own pinned port and token.
 */
function serviceSandbox(home: string, port: number): { env: NodeJS.ProcessEnv; durableDb: string } {
  const durableDb = join(home, "anysearch.db");
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^ANS_/.test(key)));
  Object.assign(env, {
    HOME: home,
    USERPROFILE: home,
    ANS_PROJECT_DB: join(home, "project-index.db"),
    ANS_SERVER_REGISTRY: join(home, "server.json"),
    ANS_SERVER_PORT: String(port),
    ANS_SERVER_TOKEN: TOKEN,
    ANS_DB_PATH: durableDb,
  });
  return { env, durableDb };
}

function spawnService(env: NodeJS.ProcessEnv): ReturnType<typeof spawn> {
  return spawn(process.execPath, ["--import", "tsx", "src/server/index.ts"], {
    cwd: PLUGIN_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
    env,
  });
}

test("post-work tracker: an unregistered registry still runs the work", async () => {
  resetPostWorkWarnings();
  const tracker = createPostWorkTracker(undefined);
  const { result, outcome } = await tracker.run("server.project_index", {}, () => 42);
  assert.equal(result, 42, "the work runs even with no registry");
  assert.equal(outcome.state, "unregistered");
  assert.equal(outcome.parentLink, "none");
  tracker.stop();
});

test("post-work tracker: a follow-up links to a real parent and ends after the work", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ans-postwork-unit-"));
  const dbPath = join(dir, "anysearch.db");
  const registry = openTaskRegistry(dbPath);
  const tracker = createPostWorkTracker(registry);
  try {
    const parent = registry.registerTask({ kind: "mcp.ans_chat", role: "business", entry: "mcp" });
    let observedRows = -1;
    const { outcome } = await tracker.run("server.project_index", { parentTaskId: parent.taskId }, async () => {
      // Inside the work the row is OPEN: an upgrade reading now sees a tail.
      observedRows = registry.openTasks().filter((t) => t.kind === "server.project_index").length;
      return "ok";
    });
    assert.equal(observedRows, 1, "the task row exists while its work runs");
    assert.equal(outcome.state, "ended", "the row is closed once the work settles");
    assert.equal(outcome.parentLink, "linked");
    const row = registry.taskById(outcome.taskId!)!;
    assert.equal(row.origin, "follow-up");
    assert.equal(row.entry, "server");
    assert.equal(row.parentTaskId, parent.taskId);
    assert.equal(row.endedAt !== null, true, "the end is written");
    assert.equal(registry.openTasks().filter((t) => t.entry === "server").length, 0,
      "no server task is left open after the work settled");
    parent.finish({ exitCode: 0 });
  } finally {
    tracker.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("post-work tracker: an unknown parent is recorded as no link, not a dead pointer", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ans-postwork-unit2-"));
  const dbPath = join(dir, "anysearch.db");
  const registry = openTaskRegistry(dbPath);
  const tracker = createPostWorkTracker(registry);
  try {
    const { outcome } = await tracker.run("server.policy_audit", { parentTaskId: "other-host-0001" }, () => undefined);
    assert.equal(outcome.parentLink, "unknown");
    const row = registry.taskById(outcome.taskId!)!;
    assert.equal(row.parentTaskId, null, "no dangling id is stored");
    assert.equal(row.origin, "follow-up", "it is still recorded as post-work");
  } finally {
    tracker.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("post-work tracker: the scheduled→running handoff never lets drain through early", async () => {
  // Review-fish finding: when `scheduled` hit 0 and `release()` ran before
  // run() took its count, drain resolved true and the shutdown closed the store
  // under a unit that was about to write. The handoff must be one synchronous
  // step: at no point is the unit in neither bucket.
  const dir = mkdtempSync(join(tmpdir(), "ans-postwork-handoff-"));
  const dbPath = join(dir, "anysearch.db");
  const registry = openTaskRegistry(dbPath);
  const tracker = createPostWorkTracker(registry);
  let settled = false;
  let workDone = false;
  try {
    tracker.runLater("server.project_index", {}, () => { workDone = true; return "done"; });
    assert.equal(tracker.pending(), 1, "counted while only scheduled");

    // Watch pending() across the handoff. Reading 0 while the work has NOT yet
    // run means a drain in that instant would have closed the store under it.
    let sawEmptyBeforeWork = false;
    const poll = setInterval(() => {
      if (!workDone && tracker.pending() === 0) sawEmptyBeforeWork = true;
    }, 1);
    await new Promise((resolve) => setTimeout(resolve, 80));
    clearInterval(poll);
    assert.equal(workDone, true, "the work ran");
    assert.equal(sawEmptyBeforeWork, false, "pending never read 0 before the work even started");
    // Let the last poll observe the real settle.
    await new Promise((resolve) => setTimeout(resolve, 20));
    settled = true;
    assert.equal(tracker.pending(), 0, "it does read 0 once everything settled");
  } finally {
    tracker.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("post-work tracker: a failing unit ends the row with exit 1 and rethrows", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ans-postwork-unit3-"));
  const dbPath = join(dir, "anysearch.db");
  const registry = openTaskRegistry(dbPath);
  const tracker = createPostWorkTracker(registry);
  try {
    await assert.rejects(
      tracker.run("server.project_index", {}, () => { throw new Error("store write failed"); }),
      /store write failed/,
    );
    const rows = registry.openTasks().filter((t) => t.entry === "server");
    assert.equal(rows.length, 0, "the failed unit's row is ended, not left open");
    const ended = new Database(dbPath, { readonly: true });
    try {
      const row = ended.prepare("SELECT exit_code as code FROM task_records WHERE entry = 'server' ORDER BY rowid DESC LIMIT 1").get() as { code: number };
      assert.equal(row.code, 1, "the exit code says the post-work failed");
    } finally {
      ended.close();
    }
  } finally {
    tracker.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("post-work tracker: work that reports failure by returning ends exit 1 (#307 review)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ans-postwork-isFailure-"));
  const dbPath = join(dir, "anysearch.db");
  const registry = openTaskRegistry(dbPath);
  const tracker = createPostWorkTracker(registry);
  try {
    const { outcome } = await tracker.run("server.policy_audit", { isFailure: (written: boolean) => !written }, () => false);
    assert.equal(outcome.exitCode, 1, "a fail-open helper reporting a failed write ends the row as failed");
    const { outcome: ok } = await tracker.run("server.policy_audit", { isFailure: (written: boolean) => !written }, () => true);
    assert.equal(ok.exitCode, 0, "a landed write ends exit 0");
  } finally {
    tracker.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("post-work tracker: a parent id on independent work is a caller bug, not a silent drop", async () => {
  // #307 review: the earlier shape dropped parentTaskId when origin was left at
  // its default, so a caller that meant "follow-up" got "none" with no signal.
  const dir = mkdtempSync(join(tmpdir(), "ans-postwork-origin-"));
  const dbPath = join(dir, "anysearch.db");
  const registry = openTaskRegistry(dbPath);
  try {
    const root = registry.registerTask({ kind: "cli.chat", role: "business", entry: "cli" });
    assert.throws(
      () => registry.registerTask({ kind: "server.project_index", role: "business", entry: "server", parentTaskId: root.taskId }),
      /only meaningful for follow-up work/,
      "an independent task must not accept a parent id quietly",
    );
    root.finish({ exitCode: 0 });
  } finally {
    registry.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("post-work tracker: runLater counts the unit before it starts, starts it a turn later", async () => {
  // Deterministic in-process proof of the deferral contract. The cross-process
  // version of this check (server's setImmediate vs client's read) is a race and
  // cannot be asserted; this one can.
  const dir = mkdtempSync(join(tmpdir(), "ans-postwork-later-"));
  const dbPath = join(dir, "anysearch.db");
  const registry = openTaskRegistry(dbPath);
  const tracker = createPostWorkTracker(registry);
  try {
    let ran = false;
    tracker.runLater("server.policy_audit", {}, () => { ran = true; });
    // Before yielding to the loop: counted, but not started, and no row yet.
    assert.equal(tracker.pending(), 1, "the unit is counted as ONE before its work starts");
    assert.equal(ran, false, "the work has not run yet");
    const before = registry.openTasks().filter((t) => t.kind === "server.policy_audit");
    assert.equal(before.length, 0, "no task row exists before the deferral runs");

    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(ran, true, "the work ran after a turn");
    // The row is now open (or already ended); either way it exists.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const rows = new Database(dbPath, { readonly: true });
    try {
      const row = rows.prepare(
        "SELECT origin, ended_at as ended FROM task_records WHERE kind = 'server.policy_audit'",
      ).get() as { origin: string; ended: string | null } | undefined;
      assert.ok(row, "the deferred unit left a row");
      assert.equal(row!.origin, "follow-up");
    } finally {
      rows.close();
    }
    assert.equal(tracker.pending(), 0, "the count is released when the unit settles");
  } finally {
    tracker.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("post-work tracker: drain waits for a running unit, and says so when it cannot", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ans-postwork-drain-"));
  const dbPath = join(dir, "anysearch.db");
  const registry = openTaskRegistry(dbPath);
  const tracker = createPostWorkTracker(registry);
  try {
    let release!: () => void;
    const running = tracker.run("server.project_index", {}, () =>
      new Promise<string>((resolve) => { release = () => resolve("done"); }),
    );
    assert.equal(tracker.pending(), 1, "the unit is counted while it runs");
    const drained = tracker.drain(5000);
    // The wait must not resolve while the work is still running.
    const early = await Promise.race([
      drained.then(() => "drained"),
      new Promise((resolve) => setTimeout(() => resolve("still-running"), 100)),
    ]);
    assert.equal(early, "still-running", "drain does not answer before the unit settles");
    release();
    assert.equal(await drained, true, "drain answers true once the unit settles");
    await running;
    assert.equal(tracker.pending(), 0);

    // A bounded wait that expires reports false instead of pretending success.
    let never!: () => void;
    const stuck = tracker.run("server.project_index", {}, () => new Promise<string>((resolve) => { never = () => resolve("late"); }));
    assert.equal(await tracker.drain(100), false, "a timeout is reported, not hidden");
    never();
    await stuck;
    assert.equal(tracker.pending(), 0);
  } finally {
    tracker.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("real service: /index settles before the answer, /policy's audit behind it", async () => {
  const root = project("live");
  const home = mkdtempSync(join(tmpdir(), "ans-postwork-home-"));
  const port = await freePort();
  const { env, durableDb } = serviceSandbox(home, port);
  const proc = spawnService(env);
  const base = "http://127.0.0.1:" + port;
  try {
    await waitForServer(base);

    // The service's own lifetime is a process row, not a task.
    const before = new Database(durableDb, { readonly: true });
    let openServerTasksBefore: number;
    try {
      openServerTasksBefore = (before.prepare(
        "SELECT COUNT(*) AS n FROM task_records WHERE entry = 'server' AND ended_at IS NULL",
      ).get() as { n: number }).n;
      const processRow = before.prepare(
        "SELECT COUNT(*) AS n FROM process_records WHERE entry = 'server' AND ended_at IS NULL",
      ).get() as { n: number };
      assert.equal(processRow.n, 1, "the service registers one process record, not a task");
    } finally {
      before.close();
    }
    assert.equal(openServerTasksBefore, 0, "idle service has no open task");

    // /index: the row must be ENDED by the time the response arrives, and the
    // parent link lands when the parent is a real row.
    const registry = openTaskRegistry(durableDb);
    let parentId: string;
    try {
      const parent = registry.registerTask({ kind: "mcp.ans_chat", role: "business", entry: "mcp" });
      parentId = parent.taskId;
      parent.finish({ exitCode: 0 });
    } finally {
      registry.close();
    }
    const response = await fetch(base + "/index", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + TOKEN, "x-anysearch-session-id": "hook-sess-307" },
      body: JSON.stringify({
        projectPath: root,
        toolName: "ans_search_web",
        parentTaskId: parentId,
        entries: [{ title: "Indexed result", url: "https://allowed.example/a", snippet: "s", source: "tavily", contentHash: "h1" }],
      }),
      signal: AbortSignal.timeout(15000),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json() as { indexed: number }).indexed, 1);

    const after = new Database(durableDb, { readonly: true });
    try {
      const rows = after.prepare(
        "SELECT task_id as id, kind, origin, entry, session_id as session, parent_task_id as parent, ended_at as ended, exit_code as code FROM task_records WHERE entry = 'server' ORDER BY rowid",
      ).all() as Array<{ id: string; kind: string; origin: string; session: string | null; parent: string | null; ended: string | null; code: number }>;
      const indexRow = rows.find((r) => r.kind === "server.project_index");
      assert.ok(indexRow, "the index write left a task row");
      assert.equal(indexRow!.origin, "follow-up", "it is post-work, not a new independent request");
      assert.ok(indexRow!.ended !== null, "the row is ended by the time the response arrived");
      assert.equal(indexRow!.code, 0);
      assert.equal(indexRow!.parent, parentId, "a real parent is linked");
      assert.equal(indexRow!.session, "hook-sess-307", "the context handle travels");
      assert.equal(rows.filter((r) => r.ended === null).length, 0, "no server task is left open");
    } finally {
      after.close();
    }

    // /policy: the first read of a project is the BASELINE, not a change. Read
    // once with the original TOML, rewrite it, then read again — only the
    // second read audits.
    const baseline = await fetch(base + "/policy?project=" + encodeURIComponent(root), {
      headers: { Authorization: "Bearer " + TOKEN }, signal: AbortSignal.timeout(10000),
    });
    assert.equal(baseline.status, 200);
    writeFileSync(join(root, "domains", "default.toml"), [
      'name = "default"',
      "[sources]",
      'enabled = ["tavily"]',
      'urlAllowlist = ["allowed.example", "second.example"]',
      "[skills]",
      'active = ["search"]',
      "[hooks]",
      'toolWhitelist = ["search"]',
      "[rag]",
      'adapter = "none"',
      "",
    ].join("\n"), "utf8");
    const changed = await fetch(base + "/policy?project=" + encodeURIComponent(root), {
      headers: { Authorization: "Bearer " + TOKEN, "x-anysearch-session-id": "hook-sess-307b" }, signal: AbortSignal.timeout(10000),
    });
    assert.equal(changed.status, 200);

    // The ordering itself ("the audit starts after the answer") is pinned
    // deterministically in the `runLater` unit test above: across a process
    // boundary the same read is a race — the deferred turn can already have
    // run by the time this query lands. What this segment can honestly assert
    // is the end state: the audit row exists, is a follow-up, and settles.

    const auditDb = new Database(durableDb, { readonly: true });
    try {
      // It settles shortly after the answer; poll rather than racing the deferral.
      const deadline = Date.now() + 10000;
      let auditRows: Array<{ origin: string; parent: string | null; ended: string | null; code: number }> = [];
      while (Date.now() < deadline) {
        auditRows = auditDb.prepare(
          "SELECT kind, origin, parent_task_id as parent, ended_at as ended, exit_code as code FROM task_records WHERE kind = 'server.policy_audit'",
        ).all() as Array<{ origin: string; parent: string | null; ended: string | null; code: number }>;
        if (auditRows.length > 0 && auditRows.every((r) => r.ended !== null)) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.ok(auditRows.length >= 1, "the policy audit left a task row (the changed-version read)");
      assert.ok(auditRows.every((r) => r.ended !== null && r.code === 0),
        "every audit row settles, and a landed write records success");
      assert.ok(auditRows.every((r) => r.origin === "follow-up" && r.parent === null),
        "an audit that names no parent records no link");
    } finally {
      auditDb.close();
    }
  } finally {
    await stopProcess(proc);
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

// #344: a start that never listened is a clean exit too, so it has to end the
// process record it wrote at module load. Two ways to fail that way are pinned
// here: a pinned port already in use, and a port the OS refuses outright.
test("real service: a start that cannot listen leaves no open process record", async () => {
  const home = mkdtempSync(join(tmpdir(), "ans-postwork-bind-"));
  const port = await freePort();
  const { env, durableDb } = serviceSandbox(home, port);
  const serverRows = (): Array<{ pid: number; ended: string | null }> => {
    const db = new Database(durableDb, { readonly: true });
    try {
      return db.prepare(
        "SELECT pid, ended_at as ended FROM process_records WHERE entry = 'server' ORDER BY rowid",
      ).all() as Array<{ pid: number; ended: string | null }>;
    } finally {
      db.close();
    }
  };
  // The exit code and the rows are the contract: the message on stderr is for a
  // human, and a piped stderr can be cut short by process.exit.
  const exitCodeOf = async (proc: ReturnType<typeof spawn>): Promise<number | null> => {
    // A child that already exited will not emit 'exit' again; waiting for it
    // would hang until the test timeout.
    if (proc.exitCode !== null) return proc.exitCode;
    const [code] = await once(proc, "exit");
    return (code ?? null) as number | null;
  };

  const live = spawnService(env);
  try {
    await waitForServer("http://127.0.0.1:" + port);
    assert.ok(live.pid, "the live service started");
    assert.deepEqual(
      serverRows().map((r) => [r.pid, r.ended]),
      [[live.pid, null]],
      "the live service holds the one open row",
    );

    // The same pinned port: this start cannot listen, so it exits 1 — a clean
    // exit that must close the row it wrote.
    const taken = spawnService(env);
    assert.equal(await exitCodeOf(taken), 1, "a start on a port already in use exits 1");

    // A port the OS refuses before the socket exists throws instead of
    // emitting 'error': same rule, and nothing was ever listening.
    const refused = spawnService({ ...env, ANS_SERVER_PORT: "abc" });
    assert.equal(await exitCodeOf(refused), 1, "a start on a port the OS refuses exits 1");

    const rows = serverRows();
    const failedStarts: Array<[string, number | undefined]> = [
      ["the taken-port start", taken.pid],
      ["the refused-port start", refused.pid],
    ];
    for (const [label, pid] of failedStarts) {
      const row = rows.find((r) => r.pid === pid);
      assert.ok(row, label + " still recorded its lifetime");
      assert.notEqual(row!.ended, null, label + " ended its row on the way out");
    }
    assert.deepEqual(
      rows.filter((r) => r.ended === null).map((r) => r.pid),
      [live.pid],
      "the live service is the only row left open",
    );
  } finally {
    await stopProcess(live);
    rmSync(home, { recursive: true, force: true });
  }
});
