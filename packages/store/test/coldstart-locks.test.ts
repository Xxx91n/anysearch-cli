// #257 acceptance (D12), deterministic half: three cases that do NOT depend on
// winning a race — a held lock released inside the window, a held lock outliving
// it, and an unopenable path. These are the causal evidence for the retry policy;
// the five-round two-process race lives in coldstart-race.test.ts.
//
// Split from the race file because each file gets one `--test-timeout` budget from
// the package script (30s), and running both kinds in one file made the whole
// file miss the budget under a loaded runner.
import Database from "better-sqlite3";
import { OBSERVATION_USER_VERSION } from "../src/observation";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return; }
  passed++;
}

const STORE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const CHILD = join(STORE_DIR, "test", "stubs", "coldstart-open-child.ts");
const HOLDER = join(STORE_DIR, "test", "stubs", "coldstart-lock-holder.ts");
const CHILD_TIMEOUT_MS = 120000;
// How long the holder keeps the lock AFTER the child signals that it is about to
// open the stores. A single init attempt fails in ~1.1-1.4s on this host even
// with busy_timeout=500, so a 2.5s hold guarantees at least one attempt fails
// and the application-level retry — not SQLite's own wait — has to carry it.
// (Measured: one `journal_mode = WAL` attempt against a held exclusive lock
// fails after ~1083ms.) The whole hold stays far inside the 6s window.
const SHORT_LOCK_HOLD_MS = 60000;
const SHORT_LOCK_RELEASE_AFTER_SIGNAL_MS = 2500;

interface ChildResult { code: number | null; out: string; elapsedMs: number; timedOut: boolean }

function runChild(dbPath: string, readyFile?: string, mode?: "probe"): Promise<ChildResult> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    // readyFile and mode are positional (argv[3], argv[4]); an empty string
    // keeps the mode in place when only probe mode is asked for.
    const argv = mode ? [CHILD, dbPath, readyFile ?? "", mode] : readyFile ? [CHILD, dbPath, readyFile] : [CHILD, dbPath];
    const p = spawn(process.execPath, ["--import", "tsx", ...argv], { cwd: STORE_DIR });
    let out = "";
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; p.kill(); }, CHILD_TIMEOUT_MS);
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    p.on("close", (code) => { clearTimeout(timer); resolve({ code, out, elapsedMs: Date.now() - t0, timedOut }); });
  });
}

function lastJson(out: string): Record<string, unknown> | undefined {
  const lines = out.trim().split(/\r?\n/).filter((l) => l.trim().startsWith("{"));
  for (let i = lines.length - 1; i >= 0; i--) {
    try { return JSON.parse(lines[i]!) as Record<string, unknown>; } catch { /* keep looking */ }
  }
  return undefined;
}

// Poll for the child's pre-open flag (fs.watch on Windows misses create-then-close).
function waitForFile(path: string, timeoutMs = 60000): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const tick = () => {
      if (existsSync(path)) { resolve(); return; }
      if (Date.now() >= deadline) { reject(new Error("child never signalled before opening the stores: " + path)); return; }
      setTimeout(tick, 20);
    };
    tick();
  });
}

function startHolder(dbPath: string, holdMs: number): Promise<{ kill: () => void }> {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ["--import", "tsx", HOLDER, dbPath, String(holdMs)], { cwd: STORE_DIR });
    let out = "";
    const timer = setTimeout(() => { p.kill(); reject(new Error("lock holder never reported LOCKED")); }, CHILD_TIMEOUT_MS);
    p.stdout.on("data", (d) => {
      out += d;
      if (out.includes("LOCKED")) {
        clearTimeout(timer);
        resolve({ kill: () => p.kill() });
      }
    });
    p.on("error", (e) => { clearTimeout(timer); reject(e); });
    p.on("close", (code) => {
      // Died before taking the lock: fail loudly instead of testing nothing.
      if (!out.includes("LOCKED")) { clearTimeout(timer); reject(new Error("lock holder exited early (code " + code + "): " + out.slice(-200))); }
    });
  });
}

// The full structure bar: a success must leave a complete database, not a live process.
function checkStructure(dbPath: string, label: string): void {
  const db = new Database(dbPath, { readonly: true });
  try {
    assert(db.pragma("integrity_check", { simple: true }) === "ok", label + ": integrity_check is ok");
    assert(db.pragma("journal_mode", { simple: true }) === "wal", label + ": journal_mode is wal");
    const tables = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((r) => r.name));
    for (const t of ["sessions", "retrieval_results", "messages_fts", "retrieval_results_fts",
      "observability_traces", "observability_spans", "access_chain_anchor"]) {
      assert(tables.has(t), label + ": " + t + " exists");
    }
    assert(!tables.has("access_events_switch_migrate"), label + ": no half-migrated scratch table left behind");
    const seeded = db.prepare("SELECT COUNT(*) AS n FROM edge_patterns").get() as { n: number };
    assert(seeded.n === 9, label + ": edge pattern seed has 9 rows (got " + seeded.n + ")");
    const anchor = db.prepare("SELECT COUNT(*) AS n FROM access_chain_anchor").get() as { n: number };
    assert(anchor.n === 1, label + ": exactly one access-chain anchor (got " + anchor.n + ")");
    const obsVersion = (db.pragma("user_version", { simple: true }) as number) | 0;
    assert(obsVersion === OBSERVATION_USER_VERSION, label + ": observation user_version reached the migration target (got " + obsVersion + ")");
  } finally {
    db.close();
  }
}

async function main() {
  const base = mkdtempSync(join(tmpdir(), "ans-coldstart-locks-"));
  try {
    // --- a lock released inside the window is absorbed ---
    {
      // The child signals from inside its own process right before it opens the
      // stores. The lock is then held for a further 2.5s, so at least one
      // attempt is guaranteed to fail (a single attempt dies in ~1.1s here) —
      // the retry, not SQLite's own wait, is what makes this pass. Without the
      // extra hold, a child that reached the lock after it was released would
      // also pass with no retry at all.
      const dbPath = join(base, "short-lock", "anysearch.db");
      const readyFile = join(base, "short-lock", "ready.flag");
      const holder = await startHolder(dbPath, SHORT_LOCK_HOLD_MS);
      let r: ChildResult | undefined;
      try {
        const openPromise = runChild(dbPath, readyFile, "probe");
        await waitForFile(readyFile);
        // Still locked at this instant; keep it for longer than one attempt can wait.
        await new Promise((resolve) => setTimeout(resolve, SHORT_LOCK_RELEASE_AFTER_SIGNAL_MS));
        holder.kill();
        r = await openPromise;
      } finally {
        holder.kill();
      }
      assert(r !== undefined, "short lock: the child produced a result");
      const payload = lastJson(r!.out);
      // The child's own throwaway probe is the observation this used to assume:
      // it tried a WAL switch right before opening the stores and hit the held
      // lock. That is what makes "the first real attempt must have failed" a
      // fact rather than a guess about timing.
      assert(payload?.sawBusyBeforeOpen === true,
        "short lock: the child really met the held lock before opening (probe saw BUSY: " + String(payload?.sawBusyBeforeOpen) + ")");
      assert(r!.code === 0, "short lock: the waiting process still initializes (code " + r!.code + "): " + r!.out.slice(-200));
      // Timing proof that a retry carried it, measured on the store constructors
      // only (`openMs`), so tsx loading and directory creation cannot inflate it.
      // A single attempt dies in ~1.1s here; the lock stayed held past 2.5s after
      // the child announced it was opening, so a success needs a second attempt.
      const openMs = Number(payload?.openMs ?? NaN);
      assert(Number.isFinite(openMs), "short lock: the child reports its own open duration (got " + String(openMs) + ")");
      assert(openMs >= SHORT_LOCK_RELEASE_AFTER_SIGNAL_MS,
        "short lock: the constructors outlived one attempt's wait, so a retry really ran (openMs " + openMs + ")");
      checkStructure(dbPath, "short lock");
    }

    // --- a lock held past the window fails honestly ---
    {
      const dbPath = join(base, "long-lock", "anysearch.db");
      // 30s: far past the 6s window, so the bounded retry must give up.
      const holder = await startHolder(dbPath, 30000);
      try {
        const r = await runChild(dbPath);
        const payload = lastJson(r.out);
        const message = String(payload?.message ?? "");
        const attempts = Number(message.match(/after (\d+) attempts/)?.[1] ?? NaN);
        assert(r.code !== 0, "long lock (30s): initialization fails instead of claiming success (code " + r.code + ")");
        assert(payload?.ok === false, "long lock: child reports ok:false");
        assert(message.includes("still busy"), "long lock: failure names the bounded retry ('still busy'): " + message);
        // Either cap may legitimately end the retry: the attempt count or the
        // wall-clock window. What must be true is that the message says which one
        // and how far it got — never a silent success, never an unbounded loop.
        assert(Number.isFinite(attempts), "long lock: failure states how many attempts ran: " + message);
        assert(attempts >= 2 && attempts <= 5, "long lock: attempt count is inside the cap and it really did retry (got " + attempts + ")");
        assert(message.includes("window 6000ms"), "long lock: failure names the wall-clock window: " + message);
        assert(payload?.causeCode === "SQLITE_BUSY", "long lock: the real SQLITE_BUSY error is preserved as cause (got " + String(payload?.causeCode) + ")");
        // Window plus at most one attempt's own wait is the honest upper bound
        // (measured ~7s here against a 30s lock); an unbounded retry loop would
        // show up as a multi-minute open instead. Measured on `openMs` so a slow
        // process start on a loaded runner cannot fail this assert.
        const openMs = Number(payload?.openMs ?? NaN);
        assert(Number.isFinite(openMs), "long lock: the child reports its own open duration (got " + String(openMs) + ")");
        assert(openMs < 15000, "long lock: gives up inside a bounded time (openMs " + openMs + ")");
      } finally {
        holder.kill();
      }
    }

    // --- other init errors are not retried and are surfaced ---
    {
      // A directory where a database file should be: SQLITE_CANTOPEN_ISDIR —
      // not a busy error, so it must surface at once with no retry backoff.
      const asDir = join(base, "not-a-db");
      mkdirSync(asDir, { recursive: true });
      const r = await runChild(asDir);
      const payload = lastJson(r.out);
      assert(r.code !== 0, "unopenable path: startup fails (code " + r.code + ")");
      assert(String(payload?.code ?? "").startsWith("SQLITE_CANTOPEN"), "unopenable path: reports the real CANTOPEN code (got " + String(payload?.code) + ")");
      // Same reason as above: use the constructor's own duration. 5s also
      // distinguishes "failed at once" from "burned the retry backoff".
      const openMs = Number(payload?.openMs ?? NaN);
      assert(Number.isFinite(openMs), "unopenable path: the child reports its own open duration (got " + String(openMs) + ")");
      assert(openMs < 5000, "unopenable path: fails promptly, no busy-retry backoff burned (openMs " + openMs + ")");
    }
  } finally {
    try { rmSync(base, { recursive: true, force: true }); } catch { /* Windows may hold handles briefly */ }
  }

  console.log("coldstart-locks: " + passed + " passed, " + failed + " failed");
  process.exit(failed ? 1 : 0);
}

main();
