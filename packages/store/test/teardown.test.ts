// #183: store-side exit teardown — registry semantics + the tracked opener.
//
// The macOS F-16 abort fires when a live better-sqlite3 handle is reaped at
// process exit, so the contract under test is: every store-side handle is
// registered, draining the registry closes it, and an owner that closes early
// leaves no registry entry behind (long-lived processes must not accumulate
// references to dead handles).
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

  console.log("teardown registry + tracked opener: OK");
} finally {
  runTeardown(); // leave the process clean even on assertion failure
  rmSync(dir, { recursive: true, force: true });
}
