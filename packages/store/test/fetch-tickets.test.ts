// #608: fetch tickets are session-scoped and cascade with their session.
//
// Style: assert-based self-check, matching the store suite.

import Database from "better-sqlite3";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
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
      "a raw user URL is not stored under its raw spelling");
    assert(store.hasFetchTicket(a.id, "user", "example.com/raw"),
      "a raw user URL is normalized before storage");
    await store.saveFetchTickets(a.id, "user", ["Example.COM./Pasted?utm_source=x"]);
    assert(store.hasFetchTicket(a.id, "user", "example.com/Pasted"),
      "case, trailing dot and tracking are normalized before storage");

    // Repeating a write is a no-op, not an error.
    await store.saveFetchTickets(a.id, "search", [String(rowId), String(rowId)]);
    assert(store.hasFetchTicket(a.id, "search", String(rowId)), "duplicate ticket write stays present");

    // #612: a trusted site is a bare domain, normalized like a user URL.
    await store.saveFetchTickets(a.id, "tofu", ["Docs.Example.COM."]);
    assert(store.hasFetchTicket(a.id, "tofu", "docs.example.com"),
      "a tofu domain is lowercased and loses its trailing dot");
    assert(!store.hasFetchTicket(b.id, "tofu", "docs.example.com"),
      "another session does not see the tofu ticket");
    await store.saveFetchTickets(a.id, "tofu", ["https://raw.example", "nodot", "example.com/path", "m:1"]);
    assert(!store.hasFetchTicket(a.id, "tofu", "https://raw.example"),
      "a URL is not stored as a tofu domain");
    assert(!store.hasFetchTicket(a.id, "tofu", "nodot"), "a dotless value is not stored as a tofu domain");
    assert(!store.hasFetchTicket(a.id, "tofu", "example.com/path"),
      "a domain with a path is not stored as a tofu ticket");

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
    await store.saveFetchTickets(b.id, "user", ["example.com/survivor"]);

    store.close();

    // #612: an older database whose CHECK only knew search/user is rebuilt once.
    {
      const legacy = new Database(dbPath);
      legacy.pragma("foreign_keys = OFF");
      legacy.exec(`
        CREATE TABLE fetch_tickets_old (
          session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          kind TEXT NOT NULL CHECK (kind IN ('search', 'user')),
          value TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (session_id, kind, value)
        );
        INSERT INTO fetch_tickets_old (session_id, kind, value, created_at)
          SELECT session_id, kind, value, created_at FROM fetch_tickets;
        DROP TABLE fetch_tickets;
        ALTER TABLE fetch_tickets_old RENAME TO fetch_tickets;
      `);
      legacy.close();
    }
    const backupPath = dbPath + ".pre-migration.db";
    assert(!existsSync(backupPath), "the fresh store needed no snapshot before the legacy CHECK");
    const reopened = new SqliteSessionStore(dbPath);
    try {
      assert(existsSync(backupPath),
        "a current marker plus an old fetch_tickets CHECK still gets a pre-migration snapshot");
      assert(reopened.hasFetchTicket(b.id, "user", "example.com/survivor"),
        "the fetch-ticket rebuild keeps the rows it already had");
      await reopened.saveFetchTickets(b.id, "tofu", ["kept.example"]);
      assert(reopened.hasFetchTicket(b.id, "tofu", "kept.example"),
        "the rebuilt CHECK admits tofu tickets");
      const ddl = reopened.dbQuery<{ sql: string }>(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'fetch_tickets'",
      )[0]!;
      assert(ddl.sql.includes("'tofu'"), "the rebuilt table carries the widened CHECK");
    } finally {
      reopened.close();
    }

    console.log("fetch-tickets.test.ts: " + passed + " passed, " + failed + " failed");
  } finally {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
  if (failed > 0) process.exit(1);
}

await main();
