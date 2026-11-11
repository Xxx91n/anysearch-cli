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
// This file is a SAMPLE, not a frequency proof: a pre-fix run of the same loop
// did not reproduce the original race at all (see the ticket note). The causal
// half of the acceptance — a lock released inside the window being absorbed, a
// lock outliving it failing honestly, and an unopenable path surfacing at once —
// lives in coldstart-locks.test.ts, which does not depend on winning a race.
//
// Kept separate from that file because the package script gives each file a
// single 30s budget; five rounds of compiled tsx children plus the lock cases
// did not fit in one file under a loaded runner.
import Database from "better-sqlite3";
import { OBSERVATION_USER_VERSION } from "../src/observation";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
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
    assert(obsVersion === OBSERVATION_USER_VERSION, label + ": observation schema reached the migration target (got " + obsVersion + ")");
  } finally {
    db.close();
  }
}

async function main() {
  const base = mkdtempSync(join(tmpdir(), "ans-coldstart-"));
  try {
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
  } finally {
    try { rmSync(base, { recursive: true, force: true }); } catch { /* Windows may hold handles briefly */ }
  }

  console.log("coldstart-race: " + passed + " passed, " + failed + " failed");
  process.exit(failed ? 1 : 0);
}

main();
