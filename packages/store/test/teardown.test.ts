// #183: store-side exit teardown — registry semantics + the tracked opener.
//
// The macOS F-16 abort is a forced-exit x live-native-state race, not a handle
// leak (see test/helpers/exit-teardown.mjs). What must still hold is the
// product-side contract: every store-owned handle is registered, draining the
// registry closes it, an owner that closes early leaves no registry entry
// behind (long-lived processes must not accumulate references to dead handles),
// and a deferred `process.exit` never downgrades a failure to a pass.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { openDatabase, trackDatabase } from "../src/db";
import { pendingTeardowns, registerTeardown, runTeardown, unrefPendingHandles } from "../src/teardown";
import { SqliteObservationStore } from "../src/observation";
import { SqliteSessionStore } from "../src/session-store";

const dir = mkdtempSync(join(tmpdir(), "ans-teardown-"));

try {
  // --- 1. registry: order, error isolation, drain-once, disposer ------------
  const order: string[] = [];
  registerTeardown(() => order.push("a"));
  registerTeardown(() => { throw new Error("boom"); });
  registerTeardown(() => order.push("c"));
  assert.equal(pendingTeardowns(), 3, "three registrations are pending");
  runTeardown();
  assert.equal(order.join(","), "a,c", "teardowns run in order, a throwing close is swallowed");
  assert.equal(pendingTeardowns(), 0, "registry drains");
  runTeardown();
  assert.equal(order.join(","), "a,c", "draining twice runs nothing (drain-once)");

  const dispose = registerTeardown(() => order.push("disposed"));
  assert.equal(pendingTeardowns(), 1, "registration pending");
  dispose();
  assert.equal(pendingTeardowns(), 0, "disposer removes the entry — closed handles leave no reference");
  runTeardown();
  assert.equal(order.join(","), "a,c", "a disposed entry never runs");

  // --- 2. tracked opener: drain closes, close() self-disposes, idempotent ---
  const db = openDatabase(join(dir, "tracked.db"));
  assert.equal(pendingTeardowns(), 1, "openDatabase registers the handle");
  db.prepare("CREATE TABLE t (x INTEGER)").run();
  db.prepare("INSERT INTO t (x) VALUES (1)").run();
  runTeardown();
  assert.equal(pendingTeardowns(), 0, "draining the registry unregisters the handle");
  assert.throws(() => db.prepare("SELECT 1").get(), "the handle is closed by the drain");
  db.close(); // post-teardown close is a no-op, never a native double-close
  assert.equal(pendingTeardowns(), 0, "a no-op close does not re-register");

  const early = openDatabase(join(dir, "early.db"));
  assert.equal(pendingTeardowns(), 1, "second handle registered");
  early.close();
  assert.equal(pendingTeardowns(), 0, "an owner close unregisters immediately");
  early.close();
  assert.equal(pendingTeardowns(), 0, "close is idempotent");

  // --- 3. trackDatabase covers handles constructed outside openDatabase -----
  const external = trackDatabase(new Database(join(dir, "external.db")));
  external.prepare("CREATE TABLE t (x INTEGER)").run();
  assert.equal(pendingTeardowns(), 1, "external handle registered");
  runTeardown();
  assert.throws(() => external.prepare("SELECT 1").get(), "external handle closed by the drain");

  // --- 4. store engines are registered on construction ----------------------
  const before = pendingTeardowns();
  const sessionStore = new SqliteSessionStore(join(dir, "session.db"));
  const observationStore = new SqliteObservationStore(join(dir, "observation.db"));
  assert.equal(pendingTeardowns(), before + 2, "session + observation stores register their handles");
  runTeardown();
  assert.equal(pendingTeardowns(), 0, "store teardown closes both engines");
  sessionStore.close(); // no-ops after the drain, no native double-close
  observationStore.close();

  // --- 5. the unref backstop never throws -----------------------------------
  unrefPendingHandles();
  unrefPendingHandles();
  assert.equal(pendingTeardowns(), 0, "unrefPendingHandles touches no registry entry");

  // --- 6. the deferred exit keeps a requested failure sticky ----------------
  // PR #191 review: the preload defers process.exit(), so the trailing
  // `process.exit(0)` in fusion-registry-memory.test.ts would run after its
  // `if (failed > 0) process.exit(1)` and could mask a failure. A synchronous
  // kill made that impossible; the deferred exit must preserve it.
  const storeRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
  const childExit = (script: string): number | null =>
    spawnSync(process.execPath, ["--import", "./test/helpers/exit-teardown.mjs", "-e", script], {
      cwd: storeRoot,
      encoding: "utf8",
    }).status;
  assert.equal(childExit("process.exit(1); process.exit(0);"), 1, "a trailing exit(0) cannot mask an earlier exit(1)");
  assert.equal(childExit("process.exit(0); process.exit(0);"), 0, "a clean exit stays clean");
  assert.equal(childExit("process.exitCode = 2; process.exit(0);"), 2, "an explicit nonzero exitCode survives a later exit(0)");

  console.log("teardown registry + tracked opener: OK");
} finally {
  runTeardown(); // leave the process clean even on assertion failure
  rmSync(dir, { recursive: true, force: true });
}
