// R62 D-003 (T4): native-handle teardown registry — pure leaf, no imports, so
// it stays CJS-reachable and unit-testable (same pattern as search-abstain.ts).
// Every engine handle created through db.ts registers its close(); the dispatcher
// runs them before exit so libuv never reaps live better-sqlite3/observation
// handles mid-loop — the F1 macOS libc++abi teardown-crash family.
const teardowns: Array<() => void> = [];
export function registerTeardown(fn: () => void): void { teardowns.push(fn); }
export function runTeardown(): void {
  for (const fn of teardowns.splice(0)) { try { fn(); } catch {} }
}

// R62 D-003a (T4): drain-then-unref backstop — after explicit close, whatever
// handles remain pending (keepalive sockets, native worker threads we cannot
// close) are unref'd so the loop can end on its own; process.exit() mid-loop
// teardown is what the crash signature lived on.
export function unrefPendingHandles(): void {
  const p = process as unknown as { _getActiveHandles?: () => Array<{ unref?: () => void }> };
  if (typeof p._getActiveHandles !== "function") return;
  for (const h of p._getActiveHandles()) h.unref?.();
}
