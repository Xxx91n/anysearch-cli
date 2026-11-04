// fs-atomic contract (#145): bounded rename backoff with an explicit platform
// gate. The Windows/POSIX split is a seam field asserted here directly, instead
// of being inferred from object identity on a default IO (#137's hidden rule).
// Fake clocks drive the budget checks, so no test ever waits real time.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { atomicRename, RENAME_RETRY_POLICY, renameSeam, setRenameSeam } from "../src/fs-atomic.js";

test("the win32 gate retries EPERM, EBUSY and ENOTEMPTY with exponential waits", () => {
  const sequence = ["EPERM", "EBUSY", "ENOTEMPTY"];
  const waits: number[] = [];
  let attempts = 0;
  atomicRename("from", "to", {
    platform: "win32",
    rename: () => {
      attempts += 1;
      const code = sequence[attempts - 1];
      if (code) throw Object.assign(new Error(code), { code });
    },
    sleep: (ms) => { waits.push(ms); },
    now: () => 0,
  });
  assert.equal(attempts, 4, "the fourth attempt succeeds");
  assert.deepEqual(waits, [10, 20, 40], "the backoff doubles from the initial 10ms");
});

test("an exhausted budget rethrows the original error object", () => {
  const denied = Object.assign(new Error("denied"), { code: "EPERM" });
  let clock = 0;
  let attempts = 0;
  assert.throws(() => atomicRename("from", "to", {
    platform: "win32",
    rename: () => { attempts += 1; throw denied; },
    sleep: (ms) => { clock += ms; },
    now: () => clock,
  }), (error) => error === denied);
  assert.ok(attempts > 1, "a retryable code is retried until the budget is spent");
  assert.ok(clock <= RENAME_RETRY_POLICY.budgetMs, "the accumulated wait never passes the budget");
});

test("a non-transient failure is thrown on the first attempt and never sleeps", () => {
  const missing = Object.assign(new Error("gone"), { code: "ENOENT" });
  let attempts = 0;
  assert.throws(() => atomicRename("from", "to", {
    platform: "win32",
    rename: () => { attempts += 1; throw missing; },
    sleep: () => assert.fail("ENOENT must never sleep"),
    now: () => 0,
  }), (error) => error === missing);
  assert.equal(attempts, 1);

  const uncoded = new Error("no errno code at all");
  let calls = 0;
  assert.throws(() => atomicRename("from", "to", {
    platform: "win32",
    rename: () => { calls += 1; throw uncoded; },
    sleep: () => assert.fail("an error without a code must never sleep"),
    now: () => 0,
  }), (error) => error === uncoded);
  assert.equal(calls, 1);
});

test("the POSIX gate retries EBUSY only", () => {
  const waits: number[] = [];
  let attempts = 0;
  atomicRename("from", "to", {
    platform: "linux",
    rename: () => {
      attempts += 1;
      if (attempts < 3) throw Object.assign(new Error("busy"), { code: "EBUSY" });
    },
    sleep: (ms) => { waits.push(ms); },
    now: () => 0,
  });
  assert.equal(attempts, 3, "EBUSY is retried outside win32");
  assert.deepEqual(waits, [10, 20]);

  for (const code of ["EPERM", "ENOTEMPTY"]) {
    const permanent = Object.assign(new Error(code), { code });
    let calls = 0;
    assert.throws(() => atomicRename("from", "to", {
      platform: "linux",
      rename: () => { calls += 1; throw permanent; },
      sleep: () => assert.fail(`${code} must never sleep on POSIX`),
      now: () => 0,
    }), (error) => error === permanent);
    assert.equal(calls, 1, `${code} is permanent on POSIX`);
  }
});

test("setRenameSeam restores the previous layer, not the default", () => {
  assert.equal(renameSeam.current, undefined, "production leaves the module seam unset");
  const waits: number[] = [];
  const calls: string[] = [];
  const attemptsBySource = new Map<string, number>();
  const restoreOuter = setRenameSeam({
    platform: "linux",
    rename: (from: string) => {
      calls.push(from);
      const attempt = (attemptsBySource.get(from) ?? 0) + 1;
      attemptsBySource.set(from, attempt);
      if (attempt < 2) throw Object.assign(new Error("busy"), { code: "EBUSY" });
    },
    sleep: (ms) => { waits.push(ms); },
    now: () => 0,
  });
  try {
    atomicRename("outer", "to");
    assert.deepEqual(calls, ["outer", "outer"], "the module seam drives atomicRename");
    assert.deepEqual(waits, [10], "the outer layer paces the backoff");

    let epermAttempts = 0;
    const restoreInner = setRenameSeam({
      platform: "win32",
      rename: () => {
        epermAttempts += 1;
        if (epermAttempts < 2) throw Object.assign(new Error("denied"), { code: "EPERM" });
      },
    });
    try {
      atomicRename("inner", "to");
      assert.equal(epermAttempts, 2, "EPERM retries only because the inner layer declared the win32 gate");
      assert.deepEqual(waits, [10, 10], "the inner merge keeps the outer clock and sleep");
    } finally {
      restoreInner();
    }

    assert.equal(renameSeam.current?.platform, undefined, "the inner-only platform is gone after restore");
    calls.length = 0;
    atomicRename("restored", "to");
    assert.deepEqual(calls, ["restored", "restored"], "restore returns to the outer layer's rename, not the default's");
    assert.deepEqual(waits, [10, 10, 10]);
  } finally {
    restoreOuter();
  }
  assert.equal(renameSeam.current, undefined, "the last restore returns to the production default");
});

test("the default seam performs a real rename", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "fs-atomic-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const source = join(dir, "source.txt");
  const target = join(dir, "target.txt");
  writeFileSync(source, "payload", "utf8");
  assert.equal(renameSeam.current, undefined, "no test seam is active on the default path");
  atomicRename(source, target);
  assert.equal(existsSync(source), false, "the source no longer exists");
  assert.equal(readFileSync(target, "utf8"), "payload", "the target holds the original contents");
});
