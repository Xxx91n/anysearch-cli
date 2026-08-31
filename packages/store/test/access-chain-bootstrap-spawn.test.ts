// ADR-0040 D6/D7 item 5 (Acceptance #2): two real spawned processes race the lazy anchor
// bootstrap on the same DB — exactly one anchor row results, and both processes' subsequent
// chained events verify clean. worker_threads are rejected (POSIX fcntl = per-process locks).
import Database from "better-sqlite3";
import { spawn } from "node:child_process";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripChainAnchorDdl } from "./access-chain-fixtures.js";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return; }
  passed++;
}

const STORE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = join(STORE_DIR, "..", "..");
const CHILD = join(STORE_DIR, "test", "stubs", "access-chain-bootstrap-child.ts");
const VERIFIER = join(ROOT, "scripts", "verify-access-events.mjs");

function runChild(dbPath: string, memoryId: number, writes: number): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, ["--import", "tsx", CHILD, dbPath, String(memoryId), String(writes)], { cwd: STORE_DIR });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    p.on("close", (code) => resolve({ code, out }));
  });
}

async function main() {
  const dir = mkdtempSync(join(tmpdir(), "ans-chain-spawn-"));
  const dbPath = join(dir, "t.db");
  try {
    // Pre-upgrade fixture: full schema minus the anchor DDL, 3-column access_events, 2 legacy rows,
    // and 2 retrieval_results rows the child processes chain events against.
    const schema = readFileSync(join(STORE_DIR, "src", "schema.sql"), "utf8");
    const db0 = new Database(dbPath);
    db0.pragma("journal_mode = WAL");
    db0.pragma("foreign_keys = ON");
    db0.exec(stripChainAnchorDdl(schema));
    db0.prepare("INSERT INTO sessions (id, domain) VALUES ('s1', 'code')").run();
    db0.prepare("INSERT INTO retrieval_results (session_id, url) VALUES ('s1', 'https://example.com/x')").run();
    db0.prepare("INSERT INTO retrieval_results (session_id, url) VALUES ('s1', 'https://example.com/y')").run();
    db0.prepare("INSERT INTO access_events (memory_id) VALUES (1)").run();
    db0.prepare("INSERT INTO access_events (memory_id) VALUES (2)").run();
    db0.close();

    const [a, b] = await Promise.all([runChild(dbPath, 1, 5), runChild(dbPath, 2, 5)]);
    assert(a.code === 0, "child A exit 0 (out: " + a.out.slice(0, 160) + ")");
    assert(b.code === 0, "child B exit 0 (out: " + b.out.slice(0, 160) + ")");

    const check = new Database(dbPath, { readonly: true });
    const anchors = check.prepare("SELECT id, digest, genesis_hash FROM access_chain_anchor").all() as { id: number; digest: string; genesis_hash: string }[];
    assert(anchors.length === 1 && anchors[0]!.id === 1, "exactly one anchor row (got " + anchors.length + ")");
    const chained = check.prepare("SELECT COUNT(*) AS n FROM access_events WHERE prev_hash IS NOT NULL").get() as { n: number };
    assert(chained.n === 10, "both processes wrote 5 chained events each (got " + chained.n + ")");
    const legacy = check.prepare("SELECT COUNT(*) AS n FROM access_events WHERE prev_hash IS NULL").get() as { n: number };
    assert(legacy.n === 2, "legacy rows untouched");
    check.close();

    const r = spawnSync(process.execPath, [VERIFIER, dbPath], { cwd: ROOT, encoding: "utf8" });
    assert(r.status === 0 && String(r.stdout).includes('"verdict":"PASSED"'), "both processes' events verify clean (got " + r.status + " " + String(r.stdout).slice(0, 160) + ")");
  } finally { try { rmSync(dir, { recursive: true, force: true }); } catch {} }

  console.log("access-chain-bootstrap-spawn: " + passed + " passed, " + failed + " failed");
  process.exit(failed ? 1 : 0);
}
main();
