// Store test-process exit-teardown bootstrap (#183) — test-only preload.
//
// WHY (evidence, macOS arm64):
// Store test files aborted at exit (`libc++abi: terminating ... mutex lock
// failed: Invalid argument`) only when they called `process.exit(...)` as their
// terminal statement:
//   - run 41913304226 / job 126866247252: 5/76 files abort (#174 promotion gate);
//   - diag run 42031513303: after sqlite handles were closed first, the four
//     remaining aborts were exactly access-chain-telemetry, access-chain-verify,
//     eval-abstain, fusion-registry-memory — the `process.exit` files — while
//     every naturally-exiting file passed;
//   - diag run 42032450895: deferring `process.exit` in store test processes made
//     the whole suite pass on darwin-arm64.
// Mechanism: `process.exit()` runs C++ static destructors (and N-API env
// cleanup) while Node's threadpool/native state can still be alive; on Apple's
// libc++ locking an already-torn-down mutex is fatal (EINVAL ->
// std::system_error -> std::terminate -> SIGABRT). glibc teardown is trivial,
// which is why ubuntu never reproduced it. Not a handle leak: closing every
// sqlite handle first did not stop the aborts.
//
// So this preload applies the composition-root exit contract (apps/cli/src/
// index.ts `exit()`) to store test processes:
//
// - `process.exit(code)` stops terminating synchronously: it records the code,
//   unrefs handles that would hold the loop, and lets the process end on its
//   own. A recorded NONZERO status is sticky — with a synchronous kill,
//   `if (failed) process.exit(1); process.exit(0);` could never reach the second
//   call, so the deferred version must not let a trailing zero mask a failure
//   (CodeRabbit, PR #191; asserted from teardown.test.ts with real children).
// - an unref'd watchdog preserves the old guaranteed-exit semantics if
//   something keeps the loop alive. It force-exits when it fires — the one place
//   a native teardown can still race — so it reports what was still alive
//   (diagnosable from the CI log) instead of failing silently.
//
// NOT done here, deliberately: patching the better-sqlite3 CJS export to track
// raw test handles. Under tsx, ESM imports of the package do not read the
// patched `module.exports`; CI proved it (`tracked` stayed 0 when a test
// constructed a raw handle — diag run 42043443737), and closing handles was
// never what fixed the aborts. Library-created handles are closed through the
// tracked opener in src/db.ts + the src/teardown.ts registry, which is real.
//
// Consequence for test authors: code after `process.exit(...)` keeps running in
// that process. All 51 store call sites use it as their terminal statement or
// inside an already-failing branch, and the exit code is preserved either way,
// so the observable contract (does this file pass?) is unchanged.
//
// Failure policy: a broken preload must not masquerade as a product failure, so
// installation errors are reported loudly on stderr and the suite keeps running
// with synchronous exits (visible in the CI log) instead of throwing at startup.

const realExit = process.exit.bind(process);
const WATCHDOG_MS = 5000;

function unrefPendingHandles() {
  if (typeof process._getActiveHandles !== "function") return;
  for (const h of process._getActiveHandles()) {
    try { h.unref?.(); } catch { /* ignore */ }
  }
}

function activeResources() {
  if (typeof process.getActiveResourcesInfo !== "function") return "unknown";
  try { return process.getActiveResourcesInfo().join(",") || "none"; } catch { return "unknown"; }
}

let watchdogArmed = false;

function installDeferredExit() {
  process.exit = (code) => {
    const wanted = typeof code === "number" ? code : (process.exitCode ?? 0);
    const current = process.exitCode;
    // Nonzero is sticky: a later `process.exit(0)` must never downgrade an
    // already-requested failure (see the fusion-registry-memory pattern).
    process.exitCode = typeof current === "number" && current !== 0 ? current : wanted;
    unrefPendingHandles();
    if (!watchdogArmed) {
      watchdogArmed = true;
      const finalCode = () => (typeof process.exitCode === "number" ? process.exitCode : wanted);
      setTimeout(() => {
        console.error(
          "[exit-teardown] deferred exit did not drain within " + WATCHDOG_MS +
          "ms (active resources: " + activeResources() + ") — forcing exit",
        );
        unrefPendingHandles();
        realExit(finalCode());
      }, WATCHDOG_MS).unref();
    }
  };
}

try {
  installDeferredExit();
} catch (e) {
  console.error("[exit-teardown] deferred exit NOT installed — process.exit stays synchronous: " + (e && e.message ? e.message : String(e)));
}
