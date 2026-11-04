// Bounded retry for the renames on the skill installer's commit path (#137,
// extracted from skill-store.ts in #145 so the platform gate is an explicit seam).
// Design: Windows fails a rename with EPERM/EBUSY/ENOTEMPTY while another handle
// (indexer, antivirus, an open shell) still pins the target, so a transient
// failure must not abort an otherwise valid install. On POSIX the same codes are
// usually permanent (immutable or sticky targets), so only EBUSY — a busy mount
// or share — is retried. Exhaustion rethrows the original error: the commit point
// stays "rename to the new name", never "rename onto something else".

import { renameSync } from "node:fs";

export interface RenameRetryPolicy {
  /** First wait; doubled on every attempt. */
  initialDelayMs: number;
  /** Upper bound for one wait. */
  maxDelayMs: number;
  /** Time budget for one rename. */
  budgetMs: number;
}

/** 10ms → 1s exponential backoff, bounded at about one minute overall. */
export const RENAME_RETRY_POLICY: RenameRetryPolicy = {
  initialDelayMs: 10,
  maxDelayMs: 1_000,
  budgetMs: 60_000,
};

const WINDOWS_RETRYABLE_RENAME_CODES = new Set(["EPERM", "EBUSY", "ENOTEMPTY"]);
/** POSIX reports EPERM/ENOTEMPTY for permanent conditions, so only EBUSY is retried. */
const POSIX_RETRYABLE_RENAME_CODES = new Set(["EBUSY"]);

export type RenameOp = (from: string, to: string) => void;

/** Every retry input is injectable, including the platform gate. */
export interface RenameSeam {
  rename: RenameOp;
  sleep: (ms: number) => void;
  now: () => number;
  /** "win32" retries every sharing-violation code; any other value retries only EBUSY. */
  platform: NodeJS.Platform;
}

/** Sleep the current thread; Node, unlike browsers, allows Atomics.wait on the main thread. */
export function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

const DEFAULT_SEAM: RenameSeam = {
  rename: renameSync,
  sleep: sleepSync,
  now: Date.now,
  platform: process.platform,
};

/** Test seam for the real commit path; production leaves it unset. */
export const renameSeam: { current?: Partial<RenameSeam> } = {};

// Design: restore returns to the previous layer rather than to the default, so
// nested injections unwind like a stack.
/** Replace part of the seam and return a restore function. */
export function setRenameSeam(next: Partial<RenameSeam>): () => void {
  const previous = renameSeam.current;
  renameSeam.current = { ...previous, ...next };
  return () => {
    renameSeam.current = previous;
  };
}

// Design: the loop rule is unchanged from #137 — the next wait is only taken when
// it still fits in the budget, so the caller never waits past the deadline.
/** Rename with bounded exponential backoff for transient sharing violations. */
export function atomicRename(from: string, to: string, injected: Partial<RenameSeam> = {}): void {
  const { rename, sleep, now, platform } = { ...DEFAULT_SEAM, ...renameSeam.current, ...injected };
  const retryable = platform === "win32" ? WINDOWS_RETRYABLE_RENAME_CODES : POSIX_RETRYABLE_RENAME_CODES;
  const deadline = now() + RENAME_RETRY_POLICY.budgetMs;
  let delay = RENAME_RETRY_POLICY.initialDelayMs;
  for (;;) {
    try {
      rename(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === undefined || !retryable.has(code) || now() + delay > deadline) throw error;
      sleep(delay);
      delay = Math.min(delay * 2, RENAME_RETRY_POLICY.maxDelayMs);
    }
  }
}
