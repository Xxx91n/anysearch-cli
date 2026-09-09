// ADR-0040 D7 gap items: verifier perf smoke at 10k/100k rows (report-only, never gated),
// schema_version forward/backward behavior, whitelist boundary negatives through the verifier.
import Database from "better-sqlite3";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SqliteSessionStore } from "../src/session-store.js";
import { eventHash, genesisHash, legacyDigest, CHAIN_SCHEMA_VERSION, CHAIN_EVENT_TYPE, type ChainEventRow } from "../src/access-chain.js";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return; }
  passed++;
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const VERIFIER = join(ROOT, "scripts", "verify-access-events.mjs");
const verify = (dbPath: string) => spawnSync(process.execPath, [VERIFIER, dbPath], { cwd: ROOT, encoding: "utf8" });

/** Fresh DB with N fully-chained events (writer-side helpers build the fixture; verifier is independent). */
function makeChainDb(n: number): { dir: string; dbPath: string; ms: number } {
  const dir = mkdtempSync(join(tmpdir(), "ans-chain-perf-"));
  const dbPath = join(dir, "t.db");
  const store = new SqliteSessionStore(dbPath);
  const sessionId = "s1";
  store.close();
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.prepare("INSERT INTO sessions (id, domain) VALUES (?, 'code')").run(sessionId);
  db.prepare("INSERT INTO retrieval_results (session_id, url) VALUES (?, 'https://example.com/p')").run(sessionId);
  const anchor = db.prepare("SELECT genesis_hash FROM access_chain_anchor WHERE id = 1").get() as { genesis_hash: string };
  const ins = db.prepare("INSERT INTO access_events (memory_id, accessed_at, prev_hash, schema_version, event_type, source_label) VALUES (?, ?, ?, ?, ?, ?)");
  const t0 = performance.now();
  const tx = db.transaction(() => {
    let prev = anchor.genesis_hash;
    for (let i = 0; i < n; i++) {
      const accessedAt = "2026-01-01 00:00:00";
      const id = Number((ins.run(1, accessedAt, prev, CHAIN_SCHEMA_VERSION, CHAIN_EVENT_TYPE, "system")).lastInsertRowid);
      prev = eventHash({ id, memory_id: 1, accessed_at: accessedAt, prev_hash: prev, schema_version: CHAIN_SCHEMA_VERSION, event_type: CHAIN_EVENT_TYPE, source_label: "system" });
    }
  });
  tx.immediate();
  const ms = Math.round(performance.now() - t0);
  db.close();
  return { dir, dbPath, ms };
}

function main() {
  // Perf smoke (report-only): 10k and 100k rows, full O(n) verify.
  for (const n of [10_000, 100_000]) {
    const f = makeChainDb(n);
    try {
      const t0 = performance.now();
      const r = verify(f.dbPath);
      const ms = Math.round(performance.now() - t0);
      assert(r.status === 0, "perf fixture " + n + " verifies (exit " + r.status + ": " + String(r.stdout).slice(0, 160) + ")");
      console.log("[perf] verify " + n + " rows: fixture built in " + f.ms + "ms, verified in " + ms + "ms (~" + Math.round(n / (ms / 1000)) + " rows/s) — report-only, never gated");
    } finally { try { rmSync(f.dir, { recursive: true, force: true }); } catch {} }
  }

  // schema_version forward/backward: v3 row -> explicit error; v2 row verifies; REAL -> rejected.
  {
    const f = makeChainDb(3);
    try {
      const db = new Database(f.dbPath);
      db.prepare("UPDATE access_events SET schema_version = 3 WHERE id = 2").run();
      db.close();
      const r = verify(f.dbPath);
      assert(r.status === 1 && String(r.stdout).includes("unknown schema_version"), "v3 row on v2 verifier -> explicit error (got " + r.status + " " + String(r.stdout).slice(0, 160) + ")");
    } finally { try { rmSync(f.dir, { recursive: true, force: true }); } catch {} }
  }
  {
    const f = makeChainDb(2);
    try {
      const db = new Database(f.dbPath);
      db.prepare("UPDATE access_events SET schema_version = 1.5 WHERE id = 2").run(); // REAL into INTEGER column (SQLite affinity keeps REAL)
      db.close();
      const r = verify(f.dbPath);
      assert(r.status === 1, "REAL schema_version rejected by whitelist (got " + r.status + ")");
    } finally { try { rmSync(f.dir, { recursive: true, force: true }); } catch {} }
  }
  // ADR-0053 migration: the writer hashes a pre-existing schema_version=1 row
  // with six fields, matching the independent verifier at the v1/v2 boundary.
  {
    const dir = mkdtempSync(join(tmpdir(), "ans-chain-v1v2-"));
    const dbPath = join(dir, "t.db");
    try {
      const store = new SqliteSessionStore(dbPath);
      store.close();
      const db = new Database(dbPath);
      db.pragma("journal_mode = WAL");
      db.prepare("INSERT INTO sessions (id, domain) VALUES ('s', 'code')").run();
      db.prepare("INSERT INTO retrieval_results (session_id, url) VALUES ('s', 'https://example.com/p')").run();
      const anchor = db.prepare("SELECT genesis_hash FROM access_chain_anchor WHERE id = 1").get() as { genesis_hash: string };
      const v1 = { id: 1, memory_id: 1, accessed_at: "2026-01-01 00:00:00", prev_hash: anchor.genesis_hash, schema_version: 1, event_type: CHAIN_EVENT_TYPE, source_label: null } as ChainEventRow;
      const v1Hash = eventHash(v1);
      db.prepare("INSERT INTO access_events (memory_id, accessed_at, prev_hash, schema_version, event_type, source_label) VALUES (?, ?, ?, ?, ?, NULL)").run(v1.memory_id, v1.accessed_at, v1.prev_hash, v1.schema_version, v1.event_type);
      const v2 = { id: 2, memory_id: 1, accessed_at: "2026-01-01 00:00:01", prev_hash: v1Hash, schema_version: 2, event_type: CHAIN_EVENT_TYPE, source_label: "system" } as ChainEventRow;
      db.prepare("INSERT INTO access_events (memory_id, accessed_at, prev_hash, schema_version, event_type, source_label) VALUES (?, ?, ?, ?, ?, ?)").run(v2.memory_id, v2.accessed_at, v2.prev_hash, v2.schema_version, v2.event_type, v2.source_label);
      db.close();
      const r = verify(dbPath);
      assert(r.status === 0, "v1-to-v2 boundary verifies (exit " + r.status + ": " + String(r.stdout).slice(0, 160) + ")");
    } finally { try { rmSync(dir, { recursive: true, force: true }); } catch {} }
  }
  // Backward: a legacy-sealed DB (v0 rows) verifies with the v2 verifier (covered by access-chain-verify).

  console.log("access-chain-schema: " + passed + " passed, " + failed + " failed");
  process.exit(failed ? 1 : 0);
}
main();
