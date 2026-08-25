// ADR-0025 D2: equal-conflict review channel (keep/drop).
// quarantine rows are listed via listQuarantinedMemories; keep clears the flag (and
// supersedes the live counterpart), drop marks resolved_drop (still excluded from search).
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteSessionStore } from "../src/session-store";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return; }
  passed++;
}

async function main() {
  const tmpDir = mkdtempSync(join(tmpdir(), "ans-review-"));
  const dbPath = join(tmpDir, "test.db");
  try {
    const store = new SqliteSessionStore(dbPath);
    const session = await store.createSession("code");

    // Seed one live row and two quarantined rows.
    await store.adjudicateMemory(session.id, [{ url: "https://ex.com/live", title: "live fact", snippet: "high confidence", source: "tavily", evidence: 0.9, entity: "topic-a" }]);
    const rq = await store.adjudicateMemory(session.id, [
      { url: "https://ex.com/q1", title: "maybe one", snippet: "uncertain one", source: "exa", evidence: 0.3, entity: "topic-a" },
      { url: "https://ex.com/q2", title: "maybe two", snippet: "uncertain two", source: "exa", evidence: 0.2, entity: "topic-b" },
    ]);
    assert(rq[0].action === "quarantine" && rq[1].action === "quarantine", "both low-evidence writes quarantined");
    const q1 = rq[0].insertedId as number;
    const q2 = rq[1].insertedId as number;

    const listed = await store.listQuarantinedMemories();
    assert(listed.length === 2, "list returns 2 quarantined rows (got " + listed.length + ")");
    assert(listed.every((r) => r.source === "exa"), "list carries source for review display");

    // keep: flag cleared, row becomes live, live counterpart superseded.
    const keep = await store.resolveQuarantinedMemory(q1, "keep");
    assert(keep.ok, "keep resolves existing quarantine row");
    const raw = new Database(dbPath, { readonly: true });
    const q1Row = raw.prepare("SELECT quarantine FROM retrieval_results WHERE id = ?").get(q1) as { quarantine: string | null };
    assert(q1Row.quarantine === null, "kept row quarantine cleared");
    const liveCount = (raw.prepare("SELECT COUNT(*) AS n FROM retrieval_results WHERE entity = 'topic-a' AND valid_until IS NULL AND quarantine IS NULL").get() as { n: number }).n;
    assert(liveCount === 1, "keep supersedes live counterpart, exactly 1 live row for topic-a (got " + liveCount + ")");

    // drop: row marked resolved, no longer listed, still excluded from search.
    const drop = await store.resolveQuarantinedMemory(q2, "drop");
    assert(drop.ok, "drop resolves existing quarantine row");
    const q2Row = raw.prepare("SELECT quarantine FROM retrieval_results WHERE id = ?").get(q2) as { quarantine: string | null };
    assert(q2Row.quarantine === "resolved_drop", "dropped row marked resolved_drop");
    assert((await store.listQuarantinedMemories()).length === 0, "review list empty after keep+drop");
    await new Promise((r) => setTimeout(r, 10));
    const hits = await store.searchMemory("uncertain two", 5);
    assert(!hits.some((h) => h.rowid === q2), "dropped row stays excluded from searchMemory");

    // Resolving an already-resolved or unknown id fails cleanly.
    assert((await store.resolveQuarantinedMemory(q1, "drop")).ok === false, "re-resolving cleared row returns ok=false");
    assert((await store.resolveQuarantinedMemory(999999, "keep")).ok === false, "unknown id returns ok=false");

    raw.close();
    console.log("quarantine-review.test.ts: " + passed + " passed, " + failed + " failed");
    if (failed > 0) process.exit(1);
    store.close?.();
  } finally {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}
main();
