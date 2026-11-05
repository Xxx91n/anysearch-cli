// Store test-process exit-teardown bootstrap (#183) — test-only preload.
//
// `pnpm test` in this package runs every test FILE as its own node process, and
// those files open raw better-sqlite3 handles directly (`new Database(...)`).
// Nothing closed them at exit, so libuv/native static destruction reaped live
// handles — the macOS F-16 abort family (`libc++abi: terminating ... mutex lock
// failed: Invalid argument`) that killed 5/76 store test files in run
// 41913304226 AFTER their assertions had passed, failing the full gate.
//
// Product code now closes its own handles through src/db.ts (tracked opener +
// teardown registry drained by the eval runner). This preload covers the ~48
// raw `new Database(...)` call sites the tests use as fixtures and assertion
// readers, without rewriting each one: it wraps the CJS export of
// better-sqlite3 — in a test process only, src/ never imports this file — so
// every constructed handle is tracked and closed from a process 'exit' hook,
// newest first. Order matters: better-sqlite3 insists on LIFO closes for
// WAL/statement adjacency, and a test file's readers are opened last.
//
// Failure policy: a broken preload must not masquerade as a product failure, so
// installation errors are reported loudly on stderr and the suite keeps running
// untracked (visible in the CI log) instead of throwing at startup.
import { createRequire } from "node:module";

const open = new Set();

function track(db) {
  try {
    if (!db || typeof db.close !== "function") return;
    open.add(db);
    const close = db.close.bind(db);
    db.close = () => {
      // `open === false` means some path already closed it through the
      // prototype method — never issue a second native close.
      try { if (db.open !== false) close(); } finally { open.delete(db); }
      return db;
    };
  } catch {
    // Non-extensible handle: the exit hook still closes it via the tracked set.
  }
}

function install() {
  const req = createRequire(import.meta.url);
  const modPath = req.resolve("better-sqlite3");
  const real = req(modPath);
  const entry = req.cache && req.cache[modPath];
  if (!entry) throw new Error("better-sqlite3 CJS cache entry not found — cannot track handles");
  entry.exports = new Proxy(real, {
    construct(target, args) {
      const db = Reflect.construct(target, args, target);
      track(db);
      return db;
    },
  });
}

function drain() {
  for (const db of [...open].reverse()) {
    try { if (db.open !== false) db.close(); } catch { /* already closed / native release error */ }
    open.delete(db);
  }
  // Backstop for handles we cannot close (same intent as the store teardown
  // registry's unrefPendingHandles): let the loop end instead of forcing exit.
  const p = process;
  if (typeof p._getActiveHandles === "function") {
    for (const h of p._getActiveHandles()) { try { h.unref?.(); } catch { /* ignore */ } }
  }
}

try {
  install();
} catch (e) {
  console.error("[exit-teardown] bootstrap failed — store test processes are UNTRACKED: " + (e && e.message ? e.message : String(e)));
}

process.on("exit", drain);
