// #257 acceptance (D12, T3): two REAL processes open one brand-new database at
// the same instant, five rounds, and every round must end with a fully
// initialized database — not merely two live processes.
//
// What is asserted per round:
//   - both children exit 0 (a locked database never gets reported as a start);
//   - PRAGMA integrity_check is ok, journal_mode is wal;
//   - the tables, both FTS5 indexes, all five triggers, the edge seed and the
//     chain anchor are present, and the observation store reached user_version 2;
//   - no half-initialized leftovers (the migration scratch table is gone).
//
// Deterministic retry evidence lives in the locked-database cases below: a lock
// released inside the window is absorbed, a lock held past it ends in an honest
// failure that keeps the real SQLITE_BUSY error reachable. Those are the causal
// part; the five-round race is a sample, not a frequency proof (a pre-fix run of
// this loop did not reproduce the original race at all — see the ticket note).
import Database from "better-sqlite3";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
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
const ROUNDS = 5;
// Generous per-child budget: the point is "did it finish", not "how fast".
const CHILD_TIMEOUT_MS = 120000;

interface ChildResult { code: number | null; out: string; elapsedMs: number; timedOut: boolean }

function runChild(dbPath: string): Promise<ChildResult> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const p = spawn(process.execPath, ["--import", "tsx", CHILD, dbPath], { cwd: STORE_DIR });
    let out = "";
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; p.kill(); }, CHILD_TIMEOUT_MS);
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    p.on("close", (code) => { clearTimeout(timer); resolve({ code, out, elapsedMs: Date.now() - t0, timedOut }); });
  });
}

// Last JSON line: a child may also emit incidental stderr noise.
function lastJson(out: string): Record<string, unknown> | undefined {
  const lines = out.trim().split(/\r?\n/).filter((l) => l.trim().startsWith("{"));
  for (let i = lines.length - 1; i >= 0; i--) {
    try { return JSON.parse(lines[i]!) as Record<string, unknown>; } catch { /* keep looking */ }
  }
  return undefined;
}

const REQUIRED_TABLES = [
  "sessions", "messages", "retrieval_results", "resume_anchors", "budget_ledger",
  "t0_preferences", "entities", "memory_entity", "entity_merge_log", "memory_embeddings",
  "edges", "edge_patterns", "semantic_memories", "archive_log", "access_events",
  "access_chain_anchor", "switch_events",
  "observability_traces", "observability_spans", "observability_evaluations", "observability_scores",
];
const REQUIRED_FTS = ["messages_fts", "retrieval_results_fts"];
const REQUIRED_TRIGGERS = ["messages_ai", "messages_ad", "messages_au", "retrieval_ai", "retrieval_ad"];
// relation.ts EDGE_PATTERN_ROWS: proves the seeding step ran, not that the table exists.
const EDGE_SEED_ROWS = 9;

function checkStructure(dbPath: string, label: string): void {
  const db = new Database(dbPath, { readonly: true });
  try {
    const integrity = db.pragma("integrity_check", { simple: true });
    assert(integrity === "ok", label + ": PRAGMA integrity_check is ok (got " + String(integrity) + ")");

    const mode = db.pragma("journal_mode", { simple: true });
    assert(mode === "wal", label + ": journal_mode is wal (got " + String(mode) + ")");

    const tables = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((r) => r.name));
    const missingTables = REQUIRED_TABLES.filter((t) => !tables.has(t));
    assert(missingTables.length === 0, label + ": all required tables exist (missing: " + missingTables.join(",") + ")");

    for (const fts of REQUIRED_FTS) {
      assert(tables.has(fts), label + ": FTS5 index " + fts + " exists");
    }

    const triggers = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all() as Array<{ name: string }>).map((r) => r.name));
    const missingTriggers = REQUIRED_TRIGGERS.filter((t) => !triggers.has(t));
    assert(missingTriggers.length === 0, label + ": all five FTS triggers exist (missing: " + missingTriggers.join(",") + ")");

    // Scratch table from the access_events switch rebuild must not survive.
    assert(!tables.has("access_events_switch_migrate"), label + ": no half-migrated access_events scratch table left behind");

    const seeded = db.prepare("SELECT COUNT(*) AS n FROM edge_patterns").get() as { n: number };
    assert(seeded.n === EDGE_SEED_ROWS, label + ": edge pattern seed has " + EDGE_SEED_ROWS + " rows (got " + seeded.n + ")");

    const anchor = db.prepare("SELECT COUNT(*) AS n FROM access_chain_anchor").get() as { n: number };
    assert(anchor.n === 1, label + ": exactly one access-chain anchor row (got " + anchor.n + ")");

    // Observation store: migration target reached, so both stores completed on
    // the same shared file (session store does not touch user_version).
    const obsVersion = (db.pragma("user_version", { simple: true }) as number) | 0;
    assert(obsVersion === 2, label + ": observation schema user_version is 2 (got " + obsVersion + ")");
  } finally {
    db.close();
  }
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

async function main() {
  const base = mkdtempSync(join(tmpdir(), "ans-coldstart-"));
  try {
    // --- five rounds, fresh database each round, two real processes at once ---
    let roundsWithFailure = 0;
    for (let round = 1; round <= ROUNDS; round++) {
      const dbPath = join(base, "round-" + round, "anysearch.db");
      const [a, b] = await Promise.all([runChild(dbPath), runChild(dbPath)]);
      const okA = a.code === 0;
      const okB = b.code === 0;
      if (!okA || !okB) roundsWithFailure++;
      assert(okA, "round " + round + ": process A finished initialization (code " + a.code + (a.timedOut ? ", timed out" : "") + ", " + a.elapsedMs + "ms): " + a.out.slice(-200));
      assert(okB, "round " + round + ": process B finished initialization (code " + b.code + (b.timedOut ? ", timed out" : "") + ", " + b.elapsedMs + "ms): " + b.out.slice(-200));
      assert(!a.timedOut && !b.timedOut, "round " + round + ": neither process hit the " + CHILD_TIMEOUT_MS + "ms child budget");
      // Only claim a start once the database itself is whole.
      if (okA && okB) checkStructure(dbPath, "round " + round);
    }
    assert(roundsWithFailure === 0, "all " + ROUNDS + " rounds completed with both processes initialized (failures: " + roundsWithFailure + ")");

    // --- deterministic: a lock released inside the window is absorbed ---
    {
      const dbPath = join(base, "short-lock", "anysearch.db");
      const holder = await startHolder(dbPath, 1500);
      try {
        const r = await runChild(dbPath);
        assert(r.code === 0, "short lock (1.5s): the waiting process still initializes (code " + r.code + "): " + r.out.slice(-200));
        checkStructure(dbPath, "short lock");
      } finally {
        holder.kill();
      }
    }

    // --- deterministic: a lock held past the window fails honestly ---
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
        // wall-clock window. What must be true is that the message says which
        // one and how far it got — never a silent success, never an unbounded loop.
        assert(Number.isFinite(attempts), "long lock: failure states how many attempts ran: " + message);
        assert(attempts >= 2 && attempts <= 5, "long lock: attempt count is inside the cap and it really did retry (got " + attempts + ")");
        assert(message.includes("window 6000ms"), "long lock: failure names the wall-clock window: " + message);
        assert(payload?.causeCode === "SQLITE_BUSY", "long lock: the real SQLITE_BUSY error is preserved as cause (got " + String(payload?.causeCode) + ")");
        // Window plus at most one attempt's own wait is the honest upper bound
        // (measured ~7s here against a 30s lock); an unbounded retry loop would
        // show up as a multi-minute child instead.
        assert(r.elapsedMs < 15000, "long lock: gives up inside a bounded time (" + r.elapsedMs + "ms)");
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
      assert(r.elapsedMs < 5000, "unopenable path: fails promptly, no busy-retry backoff burned (" + r.elapsedMs + "ms)");
    }
  } finally {
    try { rmSync(base, { recursive: true, force: true }); } catch { /* Windows may hold handles briefly */ }
  }

  console.log("coldstart-race: " + passed + " passed, " + failed + " failed");
  process.exit(failed ? 1 : 0);
}

main();
