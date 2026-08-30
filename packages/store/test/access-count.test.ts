// ADR-0030 D3: access signal exactly-once tests.
// Every returned recall hit increments access_count exactly once and refreshes last_accessed,
// for BOTH recall paths (searchMemory and searchMemoryMulti).
// ADR-0039 D5: each touch also appends exactly one row to access_events (append-only event log).

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

    // ADR-0039 D5 (C2): access_events mirror — exactly one event per returned hit per call,
    // on BOTH read paths. Rows a/b saw 3 touches each; gamma (created but never returned) zero.
    const evFor = (id: number): number => (ro.prepare("SELECT COUNT(*) c FROM access_events WHERE memory_id = ?").get(id) as any).c;
    const ids = (ro.prepare("SELECT id FROM retrieval_results ORDER BY id").all() as any[]).map((r) => r.id);
    for (const id of ids.slice(0, 2)) assert(evFor(id) === 3, "access_events exactly 3 for row " + id + " (got " + evFor(id) + ")");
    assert(evFor(ids[2]) === 0, "fresh untouched row has zero access events");
    const total0 = (ro.prepare("SELECT COUNT(*) c FROM access_events").get() as any).c;
    assert(total0 === 6, "total access events = 6 (3 touches x 2 hit rows; got " + total0 + ")");
    ro.close();

    // ADR-0039 C3 negative: archived rows never enter read paths -> accumulate no events.
    const rw = new Database(dbPath);
    rw.prepare("UPDATE retrieval_results SET archived = 1 WHERE archived = 0").run();
    rw.close();
    const hitsArchived = await store.searchMemory("fusion", 10);
    assert(hitsArchived.length === 0, "archived rows filtered from searchMemory (got " + hitsArchived.length + ")");
    const ro2 = new Database(dbPath, { readonly: true });
    const total1 = (ro2.prepare("SELECT COUNT(*) c FROM access_events").get() as any).c;
    assert(total1 === total0, "no access events written for archived rows (still " + total1 + ")");
    // ADR-0039 Boundaries: undo never rewrites or deletes events — flip archived back and
    // confirm the event log is untouched by the undo-direction state change itself.
    ro2.close();
    const rw2 = new Database(dbPath);
    rw2.prepare("UPDATE retrieval_results SET archived = 0").run();
    rw2.close();
    const ro3 = new Database(dbPath, { readonly: true });
    const total2 = (ro3.prepare("SELECT COUNT(*) c FROM access_events").get() as any).c;
    assert(total2 === total0, "undo leaves access_events append-only (still " + total2 + ")");
    ro3.close();

    store.close();
  } finally {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* Windows WAL lock */ }
  }
  console.log("access-count tests: " + passed + " passed, " + failed + " failed");
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
