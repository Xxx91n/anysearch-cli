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

export function registerTeardown(fn: () => void): () => void {
  teardowns.push(fn);
  return () => {
    const i = teardowns.indexOf(fn);
    if (i >= 0) teardowns.splice(i, 1);
  };
}

export function runTeardown(): void {
  for (const fn of teardowns.splice(0)) {
    try { fn(); } catch { /* a bad close must never mask the real exit path */ }
  }
}

// Introspection seam for unit tests (registry length without draining it).
export function pendingTeardowns(): number {
  return teardowns.length;
}

// Drain-then-unref backstop — after explicit close, whatever handles remain
// pending (keepalive sockets, native worker threads we cannot close) are
// unref'd so the loop can end on its own; a forced exit mid-loop teardown is
// what the crash signature lived on.
export function unrefPendingHandles(): void {
  const p = process as unknown as { _getActiveHandles?: () => Array<{ unref?: () => void }> };
  if (typeof p._getActiveHandles !== "function") return;
  for (const h of p._getActiveHandles()) h.unref?.();
}
