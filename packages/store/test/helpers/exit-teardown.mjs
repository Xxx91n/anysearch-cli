// Store test-process exit-teardown bootstrap (#183) — test-only preload.
//
// WHY (evidence, macOS arm64):
// Two full-gate observations on the #183 branch pin the trigger. Every store test
// file that aborted at exit (`libc++abi: terminating ... mutex lock failed:
// Invalid argument`) had called `process.exit(...)` as its terminal statement:
// diag run 42031513303 -> access-chain-telemetry, access-chain-verify,
// eval-abstain, fusion-registry-memory (all `process.exit` files, all after
// "N passed, 0 failed"); no naturally-exiting file ever crashed. And the
// eval-runner child that died with a signal in run 41913304226 (caught by
// eval-gate.test.ts) passed in the same diag run once
// packages/store/src/eval/cli.ts stopped calling `process.exit(code)`.
// Mechanism: process.exit() runs C++ static destructors (and N-API env cleanup)
// while Node's threadpool/native state can still be alive; on Apple's libc++
// locking a mutex that those destructors already tore down is fatal (EINVAL ->
// std::system_error -> std::terminate -> SIGABRT). Closing every sqlite handle
// first removes the connection-side surface but cannot stop that race, which is
// why this preload also applies the CLI composition root's exit contract
// (apps/cli/src/index.ts `exit()`):
//
// - `process.exit(code)` no longer terminates synchronously: it records the code,
//   unrefs handles that would hold the loop, and lets the process exit on its
//   own; an unref'd 5s watchdog preserves the old guaranteed-exit semantics if
//   something keeps the loop alive after all.
// - every better-sqlite3 handle constructed by a test is tracked (the CJS export
//   is wrapped once, before any test module loads) and closed newest-first from
//   the `exit` hook; src/ never imports this file, and product code goes through
//   the tracked opener in src/db.ts.
//
// Consequence for test authors: code after `process.exit(...)` keeps running in
// that process. All 51 store call sites use it as their terminal statement or
// inside an already-failing branch, and the exit code is preserved either way, so
// the observable contract (does this file pass?) is unchanged.
//
// Failure policy: a broken preload must not masquerade as a product failure, so
// installation errors are reported loudly on stderr and the suite keeps running
// untracked (visible in the CI log) instead of throwing at startup.
import { createRequire } from "node:module";

const open = new Set();
const realExit = process.exit.bind(process);
let watchdogArmed = false;

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

function installTracking() {
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

function unrefPendingHandles() {
  if (typeof process._getActiveHandles !== "function") return;
  for (const h of process._getActiveHandles()) {
    try { h.unref?.(); } catch { /* ignore */ }
  }
}

function drain() {
  for (const db of [...open].reverse()) {
    try { if (db.open !== false) db.close(); } catch { /* already closed / native release error */ }
    open.delete(db);
  }
  unrefPendingHandles();
}

function installDeferredExit() {
  process.exit = (code) => {
    const wanted = typeof code === "number" ? code : (process.exitCode ?? 0);
    process.exitCode = wanted;
    unrefPendingHandles();
    if (!watchdogArmed) {
      watchdogArmed = true;
      setTimeout(() => realExit(wanted), 5000).unref();
    }
  };
}

try {
  installTracking();
  installDeferredExit();
} catch (e) {
  console.error("[exit-teardown] bootstrap failed — store test processes are UNTRACKED: " + (e && e.message ? e.message : String(e)));
}

process.on("exit", drain);
