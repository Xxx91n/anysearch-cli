// #607: an existing database that predates the page-body column must gain it
// on open, be writable/readable afterwards, and must NOT be treated as a new
// migration (no fresh pre-migration snapshot for a file the current line has
// already laid out).
//
// Style: assert-based self-check (no framework), matching the store suite.

import Database from "better-sqlite3";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SqliteSessionStore } from "../src/session-store";
import { preMigrationBackupPath, preMigrationRecordPath, writeStoreLayout } from "../src/migration-backup.js";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return; }
  passed++;
}

const here = dirname(fileURLToPath(import.meta.url));
const schemaPath = join(here, "..", "src", "schema.sql");
const currentSchema = readFileSync(schemaPath, "utf8");

// The one column #607 added. Everything else stays identical so the fixture
// really is "this layout, minus content".
const legacySchema = currentSchema.replace(
  "  -- Full page body from a fetch, already passed through sanitizeText and not\n" +
  "  -- truncated. NULL/empty means this row only carries a search snippet. The\n" +
  "  -- main FTS table still indexes title/snippet only — the body is not a\n" +
  "  -- keyword-search surface here (#607).\n" +
  "  content TEXT,\n",
  "",
);
if (legacySchema.includes("keyword-search surface here (#607)")) {
  throw new Error("fixture still carries the retrieval_results content column");
}

async function main() {
  const tmpDir = mkdtempSync(join(tmpdir(), "ans-content-migration-"));
  const dbPath = join(tmpDir, "legacy.db");
  try {
    const seed = new Database(dbPath);
    seed.pragma("journal_mode = WAL");
    seed.exec(legacySchema);
    seed.prepare("INSERT INTO sessions (id, domain) VALUES ('old-1', 'research')").run();
    const oldRow = seed.prepare(
      "INSERT INTO retrieval_results (session_id, url, title, snippet, source, rrf_score) VALUES ('old-1', 'ex.com/old-page', 'Old title', 'old snippet', 'exa', 0.4)",
    ).run();
    const oldId = Number(oldRow.lastInsertRowid);
    writeStoreLayout(seed);
    seed.close();

    assert(!existsSync(preMigrationBackupPath(dbPath)), "no backup exists before the open");
    assert(!existsSync(preMigrationRecordPath(dbPath)), "no backup record exists before the open");

    const store = new SqliteSessionStore(dbPath);
    try {
      const hasContent = store.dbQuery<{ name: string }>("PRAGMA table_info(retrieval_results)")
        .some((c) => c.name === "content");
      assert(hasContent, "old database gained the content column");

      assert(!existsSync(preMigrationBackupPath(dbPath)), "current-layout file did not trigger a new backup");
      assert(!existsSync(preMigrationRecordPath(dbPath)), "current-layout file did not write a backup record");

      // The old row is still readable, and a fetched body upgrades it in place.
      const before = store.dbQuery<{ id: number; content: string | null }>(
        "SELECT id, content FROM retrieval_results WHERE url = 'ex.com/old-page'",
      )[0]!;
      assert(before.id === oldId && before.content === null, "old row survives the open without a body");
      const fill = await store.savePage("old-1", { url: "https://ex.com/old-page", content: "body from the page" });
      assert(fill.action === "filled" && fill.id === oldId, "old row can be upgraded in place after the open");
      const read = store.dbQuery<{ content: string | null; fetched: number }>(
        "SELECT content, fetched FROM retrieval_results WHERE id = ?", oldId,
      )[0]!;
      assert(read.content === "body from the page" && read.fetched === 1, "body and fetched are readable after the open");

      // A brand-new page row also works on the migrated file.
      const fresh = await store.savePage("old-1", { url: "https://ex.com/new-page", content: "fresh body" });
      assert(fresh.action === "inserted" && typeof fresh.id === "number", "migrated file accepts a new page row");
      const freshRow = store.dbQuery<{ content: string | null }>(
        "SELECT content FROM retrieval_results WHERE id = ?", fresh.id as number,
      )[0]!;
      assert(freshRow.content === "fresh body", "new body is readable");
    } finally {
      store.close();
    }

    console.log("content-column-migration.test.ts: " + passed + " passed, " + failed + " failed");
    if (failed > 0) process.exit(1);
  } finally {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
