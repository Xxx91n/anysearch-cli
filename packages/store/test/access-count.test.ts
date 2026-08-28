// ADR-0030 D3: access signal exactly-once tests.
// Every returned recall hit increments access_count exactly once and refreshes last_accessed,
// for BOTH recall paths (searchMemory and searchMemoryMulti).

import Database from "better-sqlite3";
import { SqliteSessionStore } from "../src/session-store";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return false; }
  passed++; return true;
}

async function main() {
  const tmpDir = mkdtempSync(join(tmpdir(), "ans-access-"));
  const dbPath = join(tmpDir, "test.db");
  try {
    const store = new SqliteSessionStore(dbPath);
    const session = await store.createSession("code");

    await store.saveResults(session.id, [
      { url: "https://example.com/a", title: "Alpha fusion notes", snippet: "alpha snippet about fusion", source: "tavily" },
      { url: "https://example.com/b", title: "Beta fusion notes", snippet: "beta snippet about fusion", source: "exa" },
    ]);

    // searchMemory twice: each returned hit must be touched exactly once per call.
    const hits1 = await store.searchMemory("fusion", 10);
    assert(hits1.length >= 2, "searchMemory returns seeded hits (got " + hits1.length + ")");
    await store.searchMemory("fusion", 10);

    const ro = new Database(dbPath, { readonly: true });
    let rows = ro.prepare("SELECT id, access_count, last_accessed FROM retrieval_results ORDER BY id").all() as any[];
    assert(rows.length === 2, "rows present");
    for (const r of rows) {
      assert(r.access_count === 2, "access_count exactly 2 after two searchMemory calls (got " + r.access_count + ")");
      assert(typeof r.last_accessed === "string" && r.last_accessed.length > 0, "last_accessed populated");
    }

    // searchMemoryMulti: same exactly-once rule on the RRF path.
    const hits2 = await store.searchMemoryMulti(["fusion"], 10);
    assert(hits2.length >= 2, "searchMemoryMulti returns hits");
    rows = ro.prepare("SELECT id, access_count FROM retrieval_results ORDER BY id").all() as any[];
    for (const r of rows) {
      assert(r.access_count === 3, "access_count exactly 3 after one searchMemoryMulti (got " + r.access_count + ")");
    }

    // New rows start at access_count = 0 (default via migration).
    await store.saveResults(session.id, [
      { url: "https://example.com/c", title: "Gamma fusion notes", snippet: "gamma snippet", source: "tavily" },
    ]);
    const gamma = ro.prepare("SELECT access_count FROM retrieval_results WHERE url = ?").get("https://example.com/c") as any;
    assert(gamma.access_count === 0, "fresh row starts at access_count = 0");

    ro.close();
    store.close();
  } finally {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* Windows WAL lock */ }
  }
  console.log("access-count tests: " + passed + " passed, " + failed + " failed");
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
