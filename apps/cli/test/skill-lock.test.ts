// Manifest lock contract (#137): one mkdir lock per managed root, stale recovery
// only for a provably dead same-host holder, and token-checked release. A lock is
// never removed on a guess — cross-host, unreadable and indeterminate holders all
// fail closed with the recorded holder in the message.
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import {
  acquireManifestLock, pidNamespaceIdentity, probeHolder, readLockOwner, reclaimStaleLock,
  type LockOwner,
} from "../src/skill-store.js";

/** Create an isolated managed root (skills/synced) for one test. */
function scope(t: TestContext): string {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "ans-lock-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const managed = join(base, "home", ".anysearch-cli", "skills", "synced");
  mkdirSync(managed, { recursive: true });
  return managed;
}

/** Owner record for a lock this process does not hold. */
function owner(overrides: Partial<LockOwner> = {}): LockOwner {
  return {
    token: "stale-token",
    pid: process.pid,
    host: hostname(),
    startedAt: "2026-11-03T00:00:00.000Z",
    // Same execution environment as this process, unless a test says otherwise.
    pidNamespace: pidNamespaceIdentity(),
    ...overrides,
  };
}

/** Plant a lock directory carrying the given owner record (what a killed run leaves). */
function plantLock(managed: string, record: LockOwner = owner()): string {
  const lock = join(managed, ".installed.lock");
  rmSync(lock, { recursive: true, force: true });
  mkdirSync(lock);
  writeFileSync(join(lock, "owner.json"), JSON.stringify(record));
  return lock;
}

/** A pid that is provably gone: a child process that already exited. */
function deadPid(): number {
  const child = spawnSync(process.execPath, ["-e", ""], { stdio: "ignore" });
  const pid = child.pid;
  assert.ok(pid, "the probe fixture child must report a pid");
  assert.equal(probeHolder(pid), "dead", "an exited child is provably dead on this host");
  return pid;
}

/** Wait until the OS reports the pid as gone (killed children can linger briefly). */
async function waitUntilDead(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (probeHolder(pid) === "dead") return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(`pid ${pid} is still reported alive after being killed`);
}

test("acquire records this process as the owner and release removes its own lock", (t) => {
  const managed = scope(t);
  const lock = join(managed, ".installed.lock");
  const release = acquireManifestLock(managed);
  const recorded = readLockOwner(lock);
  assert.equal(recorded?.pid, process.pid);
  assert.equal(recorded?.host, hostname());
  assert.match(recorded?.token ?? "", /^[0-9a-f-]{36}$/);
  release();
  assert.equal(existsSync(lock), false);
});

test("release leaves a lock that a new holder owns", (t) => {
  const managed = scope(t);
  const lock = join(managed, ".installed.lock");
  const release = acquireManifestLock(managed);
  // Operator reclaims the lock and a new holder takes over the same path.
  rmSync(lock, { recursive: true, force: true });
  mkdirSync(lock);
  writeFileSync(join(lock, "owner.json"), JSON.stringify(owner({ token: "new-holder" })));
  release();
  assert.equal(readLockOwner(lock)?.token, "new-holder", "the old holder's release must not delete the new lock");
});

test("a live holder blocks acquisition and is named in the error", (t) => {
  const managed = scope(t);
  const release = acquireManifestLock(managed);
  try {
    assert.throws(() => acquireManifestLock(managed), (error: Error) => {
      assert.match(error.message, /another skill operation/);
      assert.match(error.message, new RegExp(String(process.pid)), "the recorded holder pid is reported");
      assert.match(error.message, /\.installed\.lock/);
      return true;
    });
  } finally {
    release();
  }
});

test("a lock whose same-host holder is provably dead is reclaimed", (t) => {
  const managed = scope(t);
  const lock = plantLock(managed, owner({ pid: deadPid() }));
  const release = acquireManifestLock(managed);
  assert.equal(readLockOwner(lock)?.pid, process.pid, "the stale lock was replaced by this process");
  release();
  assert.equal(existsSync(lock), false);
  assert.equal(readdirSync(managed).some((entry) => entry.includes(".reclaim-")), false, "no quarantine is left behind");
});

test("a lock recorded by another host is never reclaimed automatically", (t) => {
  const managed = scope(t);
  const lock = plantLock(managed, owner({ pid: deadPid(), host: "elsewhere.invalid" }));
  assert.throws(() => acquireManifestLock(managed), (error: Error) => {
    assert.match(error.message, /another skill operation/);
    assert.match(error.message, /elsewhere\.invalid/);
    assert.match(error.message, /cannot be probed|cross/i);
    return true;
  });
  assert.ok(existsSync(join(lock, "owner.json")), "the foreign lock survives");
  assert.equal(readLockOwner(lock)?.token, "stale-token");
});

test("an absent or unreadable owner record is never reclaimed", (t) => {
  const managed = scope(t);
  const lock = join(managed, ".installed.lock");
  mkdirSync(lock);
  assert.throws(() => acquireManifestLock(managed), /owner record is unreadable/);
  assert.ok(existsSync(lock));
  writeFileSync(join(lock, "owner.json"), "{not json");
  assert.throws(() => acquireManifestLock(managed), /owner record is unreadable/);
  assert.ok(existsSync(lock));
});

test("an indeterminate holder probe refuses to reclaim", (t) => {
  const managed = scope(t);
  const lock = plantLock(managed, owner({ pid: deadPid() }));
  assert.throws(
    () => reclaimStaleLock(managed, { probe: () => "indeterminate" }),
    /cannot determine/,
  );
  assert.equal(readLockOwner(lock)?.token, "stale-token", "a lock that may be live is untouched");
});

test("acquire records the platform PID-namespace identity when there is one", (t) => {
  const managed = scope(t);
  const release = acquireManifestLock(managed);
  try {
    assert.equal(readLockOwner(join(managed, ".installed.lock"))?.pidNamespace, pidNamespaceIdentity());
  } finally {
    release();
  }
});

test("a lock recorded in another PID namespace is never reclaimed", (t) => {
  const managed = scope(t);
  const lock = plantLock(managed, owner({ pid: deadPid(), pidNamespace: "pid:[111]" }));
  assert.throws(() => reclaimStaleLock(managed, { pidNamespace: () => "pid:[222]" }), /PID namespace/);
  assert.equal(readLockOwner(lock)?.token, "stale-token", "the live holder's lock is untouched");
});

test("a lock without a PID-namespace identity is not reclaimed when this process reports one", (t) => {
  const managed = scope(t);
  const lock = plantLock(managed, owner({ pid: deadPid(), pidNamespace: undefined }));
  assert.throws(() => reclaimStaleLock(managed, { pidNamespace: () => "pid:[111]" }), /PID namespace/);
  assert.equal(readLockOwner(lock)?.token, "stale-token");
});

test("a reclaim requires both sides to report the same PID namespace", (t) => {
  const managed = scope(t);
  plantLock(managed, owner({ pid: deadPid(), pidNamespace: "pid:[111]" }));
  assert.equal(reclaimStaleLock(managed, { pidNamespace: () => "pid:[111]" }), "reclaimed");
  assert.deepEqual(readdirSync(managed), []);
});

test("a takeover during reclamation is restored, never deleted", (t) => {
  const managed = scope(t);
  const lock = plantLock(managed, owner({ pid: deadPid() }));
  const outcome = reclaimStaleLock(managed, {
    rename: (from, to) => {
      renameSync(from, to);
      // A new holder took over between the liveness probe and the token check.
      writeFileSync(join(to, "owner.json"), JSON.stringify(owner({ token: "live-token" })));
    },
  });
  assert.equal(outcome, "held");
  assert.equal(readLockOwner(lock)?.token, "live-token", "the new holder's lock is back in place");
  assert.equal(readdirSync(managed).some((entry) => entry.includes(".reclaim-")), false, "the quarantine was restored, not deleted");
});

test("a reclaim that loses the rename race leaves the winner in place", (t) => {
  const managed = scope(t);
  plantLock(managed, owner({ pid: deadPid() }));
  const outcome = reclaimStaleLock(managed, {
    rename: (from) => {
      // Another reclaimer moved the directory first.
      rmSync(from, { recursive: true, force: true });
      throw Object.assign(new Error("gone"), { code: "ENOENT" });
    },
  });
  assert.equal(outcome, "lost");
  // The winner holds a live lock: a second acquisition must not enter the critical section.
  const release = acquireManifestLock(managed);
  try {
    assert.throws(() => acquireManifestLock(managed), /another skill operation/);
  } finally {
    release();
  }
});

test("a lock left by a SIGKILLed process is reclaimed by the next acquisition", async (t) => {
  const managed = scope(t);
  // A lock holder that leaves exactly what `ans skill` leaves when it is killed:
  // a mkdir'd lock directory plus its owner record, with no cleanup path run.
  const script = [
    'const fs = require("node:fs"), path = require("node:path"), os = require("node:os");',
    'const ns = process.platform === "linux" ? fs.readlinkSync("/proc/self/ns/pid") : undefined;',
    'const lock = path.join(process.env.ANS_TEST_MANAGED, ".installed.lock");',
    "fs.mkdirSync(lock);",
    'fs.writeFileSync(path.join(lock, "owner.json"), JSON.stringify({ token: "killed", pid: process.pid, host: os.hostname(), startedAt: new Date().toISOString(), ...(ns ? { pidNamespace: ns } : {}) }));',
    'process.stdout.write("locked\\n");',
    "setInterval(() => {}, 1000);",
  ].join("\n");
  const child = spawn(process.execPath, ["-e", script], {
    env: { ...process.env, ANS_TEST_MANAGED: managed },
    stdio: ["ignore", "pipe", "inherit"],
  });
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  });
  const holder = child.pid;
  assert.ok(holder, "the lock holder must report a pid");
  await new Promise<void>((resolve, reject) => {
    let output = "";
    child.stdout?.on("data", (chunk) => {
      output += String(chunk);
      if (output.includes("locked")) resolve();
    });
    child.on("exit", (code) => reject(new Error(`the lock holder exited before signalling: ${String(code)}`)));
  });
  child.kill("SIGKILL");
  await new Promise<void>((resolve) => child.on("exit", () => resolve()));
  await waitUntilDead(holder);

  const lock = join(managed, ".installed.lock");
  assert.equal(readLockOwner(lock)?.pid, holder, "the killed run really left its lock behind");
  const release = acquireManifestLock(managed);
  assert.equal(readLockOwner(lock)?.pid, process.pid, "the next acquisition reclaimed the dead holder's lock");
  release();
  assert.equal(existsSync(lock), false);
});
