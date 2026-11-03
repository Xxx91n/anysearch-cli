// Rename retry contract (#137): transient Windows handle errors are retried with
// bounded backoff, a permanent failure surfaces the original error, and codes
// that never mean "another handle is busy" fail on the first attempt.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { atomicRename, setRenameSeam, type RenameRetryPolicy } from "../src/fs-atomic.js";

/** Small delays keep the retry tests fast; the shape matches the production policy. */
const FAST: Partial<RenameRetryPolicy> = { baseDelayMs: 1, maxDelayMs: 2, budgetMs: 250 };

/** Build an errno-shaped failure for the injected rename. */
function failure(code: string, message = `injected ${code}`): NodeJS.ErrnoException {
  return Object.assign(new Error(message), { code });
}

test("transient EPERM, EBUSY and ENOTEMPTY failures are retried until the rename succeeds", () => {
  const codes = ["EPERM", "EBUSY", "ENOTEMPTY"];
  const renames: string[] = [];
  let attempts = 0;
  const restore = setRenameSeam({
    policy: FAST,
    rename: (from, to) => {
      attempts += 1;
      const injected = codes[attempts - 1];
      if (injected) throw failure(injected);
      renames.push(`${from}->${to}`);
    },
  });
  try {
    atomicRename("from", "to");
  } finally {
    restore();
  }
  assert.equal(attempts, 4, "three transient failures, then the real rename");
  assert.deepEqual(renames, ["from->to"]);
});

test("a permanent transient failure keeps retrying but surfaces the original error", () => {
  const original = failure("EPERM", "target is pinned");
  let attempts = 0;
  const restore = setRenameSeam({
    policy: { ...FAST, budgetMs: 20 },
    rename: () => {
      attempts += 1;
      throw original;
    },
  });
  try {
    assert.throws(() => atomicRename("from", "to"), (error) => error === original);
  } finally {
    restore();
  }
  assert.ok(attempts >= 2, "the transient code was retried before the budget ran out");
});

test("a non-transient error is not retried", () => {
  let attempts = 0;
  const restore = setRenameSeam({
    policy: FAST,
    rename: () => {
      attempts += 1;
      throw failure("ENOENT");
    },
  });
  try {
    assert.throws(() => atomicRename("from", "to"), (error) => (error as NodeJS.ErrnoException).code === "ENOENT");
  } finally {
    restore();
  }
  assert.equal(attempts, 1);
});

test("the default seam performs a real rename", () => {
  const base = mkdtempSync(join(tmpdir(), "ans-atomic-"));
  try {
    writeFileSync(join(base, "before"), "payload");
    atomicRename(join(base, "before"), join(base, "after"));
    assert.equal(readFileSync(join(base, "after"), "utf8"), "payload");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
