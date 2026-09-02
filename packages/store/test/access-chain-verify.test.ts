// ADR-0040 D5/D7 items 2+3: full-chain positive verify (exit 0) + four tamper-injection
// classes (AuditWeave taxonomy: modify / delete / insert-fork / reorder) -> verifier exit 1 with
// first-error location. The verifier is spawned as a real process against fixture DBs.
import Database from "better-sqlite3";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SqliteSessionStore } from "../src/session-store.js";
import { preUpgradeSchema } from "./access-chain-fixtures.js";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return; }
  passed++;
}

const STORE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = join(STORE_DIR, "..", "..");
const VERIFIER = join(ROOT, "scripts", "verify-access-events.mjs");

function verify(dbPath: string): { status: number | null; out: string } {
  const r = spawnSync(process.execPath, [VERIFIER, dbPath], { cwd: ROOT, encoding: "utf8" });
  return { status: r.status, out: String(r.stdout ?? "") };
}

async function makeChainedFixture(): Promise<{ dir: string; dbPath: string }> {
  const dir = mkdtempSync(join(tmpdir(), "ans-chain-"));
  const dbPath = join(dir, "t.db");
  const store = new SqliteSessionStore(dbPath);
  const session = await store.createSession("code");
  await store.saveResults(session.id, [
    { url: "https://example.com/a", title: "Alpha fusion notes", snippet: "alpha snippet fusion", source: "tavily" },
    { url: "https://example.com/b", title: "Beta fusion notes", snippet: "beta snippet fusion", source: "exa" },
  ]);
  // >= 3 chained events so a middle-row delete is actually detectable (deleting the last
  // row is invisible by construction; deleting a middle row breaks the chain).
  for (let i = 0; i < 3; i++) await store.searchMemory("fusion", 10);
  store.close();
  return { dir, dbPath };
}

/** Old-schema fixture: 2 legacy (3-column) events, then upgrade via store constructor. */
function makeLegacyFixture(): { dir: string; dbPath: string } {
  const dir = mkdtempSync(join(tmpdir(), "ans-chain-legacy-"));
  const dbPath = join(dir, "t.db");
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(preUpgradeSchema(join(STORE_DIR, "src", "schema.sql")));
  db.prepare("INSERT INTO sessions (id, domain) VALUES ('s1', 'code')").run();
  db.prepare("INSERT INTO retrieval_results (session_id, url) VALUES ('s1', 'https://example.com/l1')").run();
  db.prepare("INSERT INTO retrieval_results (session_id, url) VALUES ('s1', 'https://example.com/l2')").run();
  db.prepare("INSERT INTO access_events (memory_id, accessed_at) VALUES (1, '2025-01-01 00:00:01')").run();
  db.prepare("INSERT INTO access_events (memory_id, accessed_at) VALUES (2, '2025-01-02 00:00:02')").run();
  db.close();
  const store = new SqliteSessionStore(dbPath); // upgrade: ALTERs + bootstrap seal
  store.close();
  return { dir, dbPath };
}

async function main() {
  // Positive: untouched chained fixture verifies clean.
  const a = await makeChainedFixture();
  try {
    const r = verify(a.dbPath);
    assert(r.status === 0 && r.out.includes('"verdict":"PASSED"'), "control fixture verifies (exit 0), got " + r.status + " " + r.out.slice(0, 200));
    const meta = JSON.parse(r.out.trim()) as { chainedRows: number; legacyRows: number };
    assert(meta.chainedRows >= 3 && meta.legacyRows === 0, "control reports chained segment (>=3 chained, got " + meta.chainedRows + ")");
  } finally { try { rmSync(a.dir, { recursive: true, force: true }); } catch {} }

  const tamper = async (name: string, mutate: (db: Database.Database) => void, expect: string) => {
    const f = await makeChainedFixture();
    try {
      const db = new Database(f.dbPath);
      try { mutate(db); } finally { db.close(); }
      const r = verify(f.dbPath);
      assert(r.status === 1, name + ": exit 1 (got " + r.status + ")");
      assert(r.out.includes(expect), name + ": first-error location contains " + JSON.stringify(expect) + " (got: " + r.out.slice(0, 220) + ")");
    } finally { try { rmSync(f.dir, { recursive: true, force: true }); } catch {} }
  };

  await tamper("modify", (db) => { db.prepare("UPDATE access_events SET accessed_at = '1999-01-01 00:00:00' WHERE id = 1").run(); }, "chain break at event #");
  await tamper("delete", (db) => { db.prepare("DELETE FROM access_events WHERE id = 2").run(); }, "event #3");
  await tamper("insert-fork", (db) => {
    const head = db.prepare("SELECT prev_hash FROM access_events ORDER BY id DESC LIMIT 1").get() as { prev_hash: string };
    db.prepare("INSERT INTO access_events (memory_id, prev_hash, schema_version, event_type) VALUES (1, ?, 1, 'access')").run(head.prev_hash);
  }, "fork");
  await tamper("reorder", (db) => {
    db.prepare("UPDATE access_events SET id = 9000 WHERE id = 1").run();
    db.prepare("UPDATE access_events SET id = 9001 WHERE id = 2").run();
    db.prepare("UPDATE access_events SET id = 1 WHERE id = 9001").run();
    db.prepare("UPDATE access_events SET id = 2 WHERE id = 9000").run();
  }, "event #");

  // Legacy segment: sealed via upgrade; positive + legacy-tamper negative.
  const lg = makeLegacyFixture();
  try {
    const ok = verify(lg.dbPath);
    assert(ok.status === 0, "sealed legacy fixture verifies (got " + ok.status + " " + ok.out.slice(0, 200) + ")");
    const db = new Database(lg.dbPath);
    db.prepare("UPDATE access_events SET accessed_at = '2025-01-01 00:00:59' WHERE id = 1").run(); db.close();
    const bad = verify(lg.dbPath);
    assert(bad.status === 1 && bad.out.includes("legacy digest mismatch"), "legacy tamper -> digest mismatch (got " + bad.out.slice(0, 220) + ")");
  } finally { try { rmSync(lg.dir, { recursive: true, force: true }); } catch {} }

  console.log("access-chain-verify: " + passed + " passed, " + failed + " failed");
  process.exit(failed ? 1 : 0);
}
main();
