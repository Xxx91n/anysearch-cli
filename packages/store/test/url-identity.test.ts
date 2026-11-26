// Archive writes use the same URL identity as search dedup.
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { SqliteSessionStore } from "../src/session-store";

test("three spellings of one page land on one identity and retire the old row", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ans-url-identity-"));
  const store = new SqliteSessionStore(join(dir, "data.db"));
  try {
    const session = await store.createSession("url-identity");
    await store.saveResults(session.id, [
      { url: "https://example.com/x", title: "first", snippet: "first body", source: "exa" },
    ]);
    await store.saveResults(session.id, [
      { url: "example.com.:443/x?utm_source=a#frag", title: "second", snippet: "second body", source: "tavily" },
    ]);

    const rows = store.dbQuery<{ id: number; url: string; valid_until: string | null }>(
      "SELECT id, url, valid_until FROM retrieval_results ORDER BY id",
    );
    assert.equal(rows.length, 2, "both writes landed");
    assert.equal(rows[0]!.url, "example.com/x", "the first spelling is stored as the identity");
    assert.equal(rows[1]!.url, "example.com/x", "the second spelling is stored as the same identity");
    assert.ok(rows[0]!.valid_until, "the old version was retired");
    assert.equal(rows[1]!.valid_until, null, "the newest write stays live");
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("adjudicated material rows also use the identity, not the caller's spelling", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ans-url-identity-adj-"));
  const store = new SqliteSessionStore(join(dir, "data.db"));
  try {
    const session = await store.createSession("url-identity");
    const result = await store.adjudicateMemory(session.id, [
      {
        url: "https://www.example.com/page?utm_source=news#top",
        title: "page",
        snippet: "page body",
        source: "exa",
        evidence: 0.9,
      },
    ]);
    assert.equal(result[0]?.action, "accept");

    const row = store.dbQuery<{ url: string; entity: string | null }>(
      "SELECT url, entity FROM retrieval_results WHERE id = ?",
      result[0]!.insertedId,
    )[0]!;
    assert.equal(row.url, "example.com/page");
    assert.equal(row.entity, "example.com/page", "the default entity key is the identity too");
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a citation written before identity storage still resolves to its row", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ans-url-identity-legacy-read-"));
  const dbPath = join(dir, "data.db");
  const store = new SqliteSessionStore(dbPath);
  try {
    const session = await store.createSession("legacy");
    const raw = "https://legacy.example/a";
    // Simulate a row written before the archive stored identities: raw URL and
    // the raw URL as its default entity.
    const db = new Database(dbPath);
    db.prepare(
      "INSERT INTO retrieval_results (session_id, url, title, snippet, source, entity) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(session.id, raw, "legacy", "legacy body", "exa", raw);
    db.close();

    const resolved = store.resolveSummarySources([raw]);
    assert.equal(resolved.length, 1, "the legacy citation resolves");
    assert.equal(resolved[0]?.kind, "material");
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("writing an identity also retires a legacy row with the same raw spelling", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ans-url-identity-legacy-write-"));
  const dbPath = join(dir, "data.db");
  const store = new SqliteSessionStore(dbPath);
  try {
    const session = await store.createSession("legacy");
    const raw = "https://legacy.example/b";
    const db = new Database(dbPath);
    db.prepare(
      "INSERT INTO retrieval_results (session_id, url, title, snippet, source, entity) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(session.id, raw, "old", "old body", "exa", raw);
    const oldId = store.dbQuery<{ id: number }>("SELECT MAX(id) AS id FROM retrieval_results")[0]!.id;
    db.close();

    await store.saveResults(session.id, [
      { url: raw, title: "new", snippet: "new body", source: "tavily" },
    ]);
    const rows = store.dbQuery<{ id: number; url: string; valid_until: string | null }>(
      "SELECT id, url, valid_until FROM retrieval_results ORDER BY id",
    );
    const old = rows.find((r) => r.id === oldId)!;
    const fresh = rows.find((r) => r.id !== oldId)!;
    assert.ok(old.valid_until, "the legacy row is retired by the raw spelling");
    assert.equal(fresh.url, "legacy.example/b", "the new row stores the identity");
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a legacy raw entity is superseded instead of duplicated", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ans-url-identity-legacy-adj-"));
  const dbPath = join(dir, "data.db");
  const store = new SqliteSessionStore(dbPath);
  try {
    const session = await store.createSession("legacy");
    const raw = "https://legacy.example/c";
    const db = new Database(dbPath);
    db.prepare(
      "INSERT INTO retrieval_results (session_id, url, title, snippet, source, entity) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(session.id, raw, "old", "old body", "exa", raw);
    const oldId = store.dbQuery<{ id: number }>("SELECT MAX(id) AS id FROM retrieval_results")[0]!.id;
    db.close();

    const result = await store.adjudicateMemory(session.id, [
      { url: raw, title: "new", snippet: "new body", source: "tavily", evidence: 0.9 },
    ]);
    assert.equal(result[0]?.action, "supersede", "the legacy entity is found and superseded");
    assert.equal(result[0]?.supersededId, oldId);

    const old = store.dbQuery<{ valid_until: string | null }>(
      "SELECT valid_until FROM retrieval_results WHERE id = ?",
      oldId,
    )[0]!;
    assert.ok(old.valid_until, "the legacy row is closed");
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
