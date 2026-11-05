// Store-side native-handle teardown registry — the fd249d41 pattern promoted
// out of the CLI composition root (#183).
//
// Why this exists: the F-16 macOS exit-time abort (`libc++abi: terminating ...
// mutex lock failed: Invalid argument`) re-manifested under full-suite load
// (run 41913304226: 5/76 store test-file processes crashed AFTER their
// assertions passed) because the explicit teardown only ever covered the CLI
// composition root. Store-side process exits — every store test file and
// `packages/store/src/eval/cli.ts` — left their native better-sqlite3 handles
// alive for libuv/native static destruction to reap at exit, which is exactly
// the teardown the crash signature lives on.
//
// Contract (same shape as apps/cli/src/teardown.ts, which stays the CLI's own):
// - drain-once: runTeardown() splices before running, so it is idempotent and
//   safe to invoke from an explicit exit path AND a process hook;
// - error-isolating: a throwing close never masks the process's real exit path;
// - self-disposing: registerTeardown returns a disposer so a handle its owner
//   already closed leaves no registry entry behind (long-lived processes such
//   as the MCP server open/close engines per connection).
const teardowns: Array<() => void> = [];

/**
 * Registers a close callback to run on the store's exit path.
 *
 * @param fn Teardown to run when the registry drains (a close, not a cleanup order).
 * @returns A disposer that unregisters `fn`; call it when the owner closes early
 * so a long-lived process keeps no references to dead handles.
 */
export function registerTeardown(fn: () => void): () => void {
  teardowns.push(fn);
  return () => {
    const i = teardowns.indexOf(fn);
    if (i >= 0) teardowns.splice(i, 1);
  };
}

/**
 * Drains the registry: runs every pending teardown once, in registration order.
 *
 * Drain-once (entries are spliced before running) makes it safe to call from an
 * explicit exit path and from a process hook; a throwing teardown is swallowed
 * so it can never mask the process's real exit path.
 */
export function runTeardown(): void {
  for (const fn of teardowns.splice(0)) {
    try { fn(); } catch { /* a bad close must never mask the real exit path */ }
  }
}

/**
 * Introspection seam for unit tests: the pending entry count, without draining.
 *
 * @returns How many teardowns are still registered.
 */
export function pendingTeardowns(): number {
  return teardowns.length;
}

/**
 * Drain-then-unref backstop: unrefs whatever handles are still pending after the
 * explicit close, so the event loop can end on its own.
 *
 * Keepalive sockets and native worker threads cannot be closed from here; a
 * forced exit while they are alive mid-teardown is what the F-16 crash signature
 * lived on (#183).
 */
export function unrefPendingHandles(): void {
  const p = process as unknown as { _getActiveHandles?: () => Array<{ unref?: () => void }> };
  if (typeof p._getActiveHandles !== "function") return;
  for (const h of p._getActiveHandles()) {
    // Never unref stdout/stderr: unref'ing them lets the loop end before the
    // buffered output is flushed, which would truncate the very diagnostic that
    // explains why the process is exiting (#183 review).
    if (h === (process.stdout as unknown) || h === (process.stderr as unknown)) continue;
    h.unref?.();
  }
}
