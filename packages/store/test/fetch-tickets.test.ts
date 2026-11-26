// #608: fetch tickets are session-scoped and cascade with their session.
//
// Style: assert-based self-check, matching the store suite.

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
  const tmpDir = mkdtempSync(join(tmpdir(), "ans-fetch-tickets-"));
  const dbPath = join(tmpDir, "test.db");
  try {
    const store = new SqliteSessionStore(dbPath);
    const a = await store.createSession("research");
    const b = await store.createSession("research");

    const ids = await store.saveResultsWithIds(a.id, [
      { url: "https://example.com/page", title: "Page title", snippet: "snippet", source: "exa" },
    ]);
    const rowId = ids[0] as number;

    await store.saveFetchTickets(a.id, "search", [String(rowId)]);
    await store.saveFetchTickets(a.id, "user", ["example.com/pasted"]);

    assert(store.hasFetchTicket(a.id, "search", String(rowId)), "search ticket is stored for its session");
    assert(!store.hasFetchTicket(b.id, "search", String(rowId)), "another session does not see the search ticket");
    assert(store.hasFetchTicket(a.id, "user", "example.com/pasted"), "user ticket is stored by normalized identity");
    assert(!store.hasFetchTicket(b.id, "user", "example.com/pasted"), "another session does not see the user ticket");

    const row = store.searchRowForFetch(a.id, rowId);
    assert(row?.url === "example.com/page" && row.title === "Page title", "search handle returns its row");
    assert(store.searchRowForFetch(b.id, rowId) === undefined,
      "another session's ticket cannot read this row");
    assert(store.searchRowForFetch(a.id, rowId)?.url === "example.com/page", "the ticketed row is readable");
    store.dbQuery("UPDATE retrieval_results SET archived = 1 WHERE id = ? RETURNING id", rowId);
    assert(store.searchRowForFetch(a.id, rowId) === undefined, "an archived row is not a readable handle target");

    await store.saveFetchTickets(a.id, "search", ["m:1", "https://example.com/raw"]);
    assert(!store.hasFetchTicket(a.id, "search", "m:1"), "a non-numeric search ticket is not stored");
    await store.saveFetchTickets(a.id, "user", ["https://example.com/raw"]);
    assert(!store.hasFetchTicket(a.id, "user", "https://example.com/raw"),
      "a raw user URL is not stored as an identity");

    // Repeating a write is a no-op, not an error.
    await store.saveFetchTickets(a.id, "search", [String(rowId), String(rowId)]);
    assert(store.hasFetchTicket(a.id, "search", String(rowId)), "duplicate ticket write stays present");

    // Deleting the session takes its tickets with it.
    const raw = new Database(dbPath);
    raw.pragma("foreign_keys = ON");
    raw.prepare("DELETE FROM sessions WHERE id = ?").run(a.id);
    raw.close();
    const left = store.dbQuery<{ n: number }>(
      "SELECT COUNT(*) AS n FROM fetch_tickets WHERE session_id = ?", a.id,
    )[0]!;
    assert(left.n === 0, "tickets cascade when the session is deleted");
    assert(!store.hasFetchTicket(a.id, "search", String(rowId)), "deleted session has no ticket");
    assert(store.hasFetchTicket(b.id, "user", "example.com/pasted") === false,
      "the surviving session still has none");

    store.close();
    console.log("fetch-tickets.test.ts: " + passed + " passed, " + failed + " failed");
  } finally {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
  if (failed > 0) process.exit(1);
}

await main();
