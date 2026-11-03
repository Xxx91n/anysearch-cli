// Bounded retry for the renames on the skill installer's commit path (#137).
// Design: Windows fails a rename with EPERM/EBUSY/ENOTEMPTY while another handle
// (indexer, antivirus, an open shell) still pins the target. A transient failure
// must not abort an otherwise valid install, and a permanent one must surface the
// original error instead of a rewritten one.

import { renameSync } from "node:fs";

export interface RenameRetryPolicy {
  /** First wait; doubled on every attempt. */
  baseDelayMs: number;
  /** Upper bound for one wait. */
  maxDelayMs: number;
  /** Time budget for one rename; retries stop once it is spent. */
  budgetMs: number;
}

/** 10ms → 1s exponential backoff, bounded at roughly one minute overall. */
export const RENAME_RETRY_POLICY: RenameRetryPolicy = {
  baseDelayMs: 10,
  maxDelayMs: 1_000,
  budgetMs: 60_000,
};

/** Codes Windows returns while another handle still pins the target. */
const TRANSIENT_RENAME_CODES = new Set(["EPERM", "EBUSY", "ENOTEMPTY"]);

export type RenameOp = (from: string, to: string) => void;

// Design: this module is the single seam for tests — the operation and the policy
// are replaceable so a unit test can inject transient failures without waiting a
// minute or depending on a real Windows handle.
const seam: { rename: RenameOp; policy: RenameRetryPolicy } = {
  rename: renameSync,
  policy: RENAME_RETRY_POLICY,
};

/** Replace the rename operation and/or policy, returning a restore function. */
export function setRenameSeam(next: { rename?: RenameOp; policy?: Partial<RenameRetryPolicy> }): () => void {
  const previous = { rename: seam.rename, policy: seam.policy };
  if (next.rename) seam.rename = next.rename;
  if (next.policy) seam.policy = { ...seam.policy, ...next.policy };
  return () => {
    seam.rename = previous.rename;
    seam.policy = previous.policy;
  };
}

/** Block the current thread; the installer is synchronous end to end. */
function sleepSync(ms: number): void {
  if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Rename with bounded exponential backoff on transient Windows handle errors. */
export function atomicRename(from: string, to: string): void {
  const { rename, policy } = seam;
  const deadline = Date.now() + policy.budgetMs;
  let delay = policy.baseDelayMs;
  for (;;) {
    try {
      rename(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const remaining = deadline - Date.now();
      // Exhausted budget or a non-transient code: the caller sees the original error.
      if (!code || !TRANSIENT_RENAME_CODES.has(code) || remaining <= 0) throw error;
      sleepSync(Math.min(delay, remaining));
      delay = Math.min(delay * 2, policy.maxDelayMs);
    }
  }
}
