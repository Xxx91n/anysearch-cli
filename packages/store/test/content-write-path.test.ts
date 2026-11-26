// #607: page-body write path and the supersede rules around it.
//
// Covers the seven write branches (snippet-only and page-body), the "a snippet
// never displaces a page body" rule, the archive/quarantine exemptions, the
// in-place fill, and the two other writers that share the rule (adjudicate and
// quarantine keep).
//
// Style: assert-based self-check (no framework), matching the store suite.

import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteSessionStore } from "../src/session-store";
import { applyArchive } from "../src/consolidate.js";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return; }
  passed++;
}

interface Row {
  id: number;
  url: string;
  title: string | null;
  snippet: string | null;
  source: string | null;
  content: string | null;
  fetched: number;
  valid_until: string | null;
  archived: number;
  quarantine: string | null;
  superseded_by: number | null;
  last_accessed: string | null;
  access_count: number | null;
}

async function main() {
  const tmpDir = mkdtempSync(join(tmpdir(), "ans-content-"));
  const dbPath = join(tmpDir, "test.db");
  try {
    const store = new SqliteSessionStore(dbPath);
    const session = await store.createSession("research");

    const row = (id: number): Row => {
      const rows = store.dbQuery<Row>(
        "SELECT id, url, title, snippet, source, content, fetched, valid_until, archived, quarantine, superseded_by, last_accessed, access_count " +
          "FROM retrieval_results WHERE id = ?",
        id,
      );
      if (!rows[0]) throw new Error("missing row " + id);
      return rows[0];
    };
    const rowsFor = (url: string): Row[] => store.dbQuery<Row>(
      "SELECT id, url, title, snippet, source, content, fetched, valid_until, archived, quarantine, superseded_by, last_accessed, access_count " +
        "FROM retrieval_results WHERE url = ? ORDER BY id",
      url,
    );
    const live = (url: string): Row[] => rowsFor(url).filter(
      (r) => r.valid_until === null && r.quarantine === null && r.archived === 0,
    );
    const ftsIds = (term: string): number[] => store.dbQuery<{ rowid: number }>(
      "SELECT rowid FROM retrieval_results_fts WHERE retrieval_results_fts MATCH ?",
      term,
    ).map((r) => r.rowid);

    // ---- 1. snippet-only, no live row -> insert ----------------------------
    const one = await store.saveResultsWithIds(session.id, [
      { url: "https://ex.com/one", title: "One title", snippet: "one snippet", source: "exa" },
    ]);
    const oneId = one[0] as number;
    assert(typeof oneId === "number", "1: snippet write lands a row");
    const oneRow = row(oneId);
    assert(oneRow.content === null && oneRow.fetched === 0, "1: inserted snippet row has no body");
    assert(oneRow.valid_until === null && oneRow.archived === 0, "1: inserted snippet row is live");

    // ---- 3. snippet-only, only snippet rows -> insert + close old --------
    const three = await store.saveResultsWithIds(session.id, [
      { url: "https://ex.com/three", title: "Three v1", snippet: "three snippet v1", source: "exa" },
    ]);
    const threeOld = three[0] as number;
    const threeAgain = await store.saveResultsWithIds(session.id, [
      { url: "https://ex.com/three", title: "Three v2", snippet: "three snippet v2", source: "tavily" },
    ]);
    const threeNew = threeAgain[0] as number;
    assert(threeNew !== threeOld, "3: second snippet opens a new row");
    assert(row(threeOld).valid_until !== null, "3: first snippet row is closed");
    assert(live("ex.com/three").length === 1 && live("ex.com/three")[0]!.id === threeNew,
      "3: exactly the newer snippet row stays live");

    // ---- 4. page body, no live row -> insert -----------------------------
    // Body is longer than the snippet window on purpose: content must not be
    // truncated, while the copied snippet keeps the opening for the FTS index.
    const longBody = "headword " + "x".repeat(5000) + " deepword";
    const four = await store.savePage(session.id, {
      url: "https://ex.com/four",
      title: "Four\u200B page",
      content: longBody,
      source: "tavily",
    });
    assert(four.action === "inserted" && typeof four.id === "number", "4: page with no live row inserts");
    const fourRow = row(four.id as number);
    assert(fourRow.content === longBody, "4: body is stored in full (no truncation)");
    assert(fourRow.content!.length > 5000, "4: long body keeps every character");
    assert(fourRow.fetched === 1, "4: page write marks fetched=1");
    assert(fourRow.snippet === longBody.slice(0, 4000), "4: new page row copies the body opening into snippet");
    assert(fourRow.title === "Four page" && fourRow.source === "tavily", "4: page row keeps (sanitized) title/source");
    assert(fourRow.superseded_by === null, "4: page write never sets superseded_by");
    assert(ftsIds("headword").includes(four.id as number), "4: body opening is searchable through snippet");
    assert(!ftsIds("deepword").includes(four.id as number), "4: body-only text is not (main FTS indexes title/snippet only)");

    // ---- 2. snippet-only, same URL already has a body -> attach ----------
    const before = row(four.id as number);
    const two = await store.saveResultsWithIds(session.id, [
      { url: "https://ex.com/four", title: "search hit title", snippet: "search hit snippet", source: "exa" },
    ]);
    assert(two[0] === four.id, "2: search hit returns the page row id");
    assert(rowsFor("ex.com/four").length === 1, "2: search hit did not insert a row");
    const after = row(four.id as number);
    assert(after.content === before.content && after.snippet === before.snippet && after.title === before.title,
      "2: page row body/title/snippet untouched");
    assert((after.access_count ?? 0) === (before.access_count ?? 0) + 1, "2: page row was touched once");

    // A body in another session must not be closed by a snippet write here.
    const other = await store.createSession("research");
    const otherPage = await store.savePage(other.id, { url: "https://ex.com/shared", content: "shared body", source: "tavily" });
    const sharedHit = await store.saveResultsWithIds(session.id, [
      { url: "https://ex.com/shared", title: "other session hit", snippet: "other session snippet", source: "exa" },
    ]);
    assert(sharedHit[0] === otherPage.id, "2: a snippet write in another session attaches to the shared body");
    assert(rowsFor("ex.com/shared").length === 1, "2: the attaching session writes no duplicate row");
    assert(row(otherPage.id as number).valid_until === null,
      "2: a snippet write in another session keeps the page body live");

    // The version chain is store-wide: the same body found in another session
    // is "no write", never a reason to close that body.
    const crossA = await store.savePage(session.id, { url: "https://ex.com/cross", content: "cross body" });
    const crossB = await store.savePage(other.id, { url: "https://ex.com/cross", content: "cross body" });
    assert(crossB.action === "unchanged" && crossB.id === crossA.id, "2: same body in another session is a no-op");
    assert(rowsFor("ex.com/cross").length === 1, "2: cross-session no-op writes no second row");
    assert(row(crossA.id as number).valid_until === null, "2: cross-session no-op keeps the body live");

    // Fill only rewrites a snippet row in the caller's own session. Another
    // session's snippet is an older version: the caller gets its own body row,
    // and that row is what the session's search can actually see.
    const foreignSnippet = await store.saveResultsWithIds(other.id, [
      { url: "https://ex.com/foreign-fill", title: "other session snippet", snippet: "other session snippet", source: "exa" },
    ]);
    const foreignPage = await store.savePage(session.id, { url: "https://ex.com/foreign-fill", content: "foreign page body" });
    assert(foreignPage.action === "inserted" && foreignPage.id !== foreignSnippet[0],
      "5: another session's snippet is not filled in place");
    const foreignOwner = store.dbQuery<{ session_id: string }>(
      "SELECT session_id FROM retrieval_results WHERE id = ?", foreignPage.id as number,
    )[0]!;
    assert(foreignOwner.session_id === session.id, "5: the new body row belongs to the caller's session");
    assert(row(foreignSnippet[0] as number).valid_until !== null,
      "5: the new body row replaces the other session's snippet");

    // ---- 5. page body, live row has only snippet -> fill in place --------
    const five = await store.saveResultsWithIds(session.id, [
      { url: "https://ex.com/five", title: "Five title", snippet: "five old snippet", source: "exa" },
    ]);
    const fiveId = five[0] as number;
    const fiveFill = await store.savePage(session.id, {
      url: "https://ex.com/five",
      title: "should not replace the old title",
      content: "five body onlyword",
      source: "tavily",
    });
    assert(fiveFill.action === "filled" && fiveFill.id === fiveId, "5: body fills the snippet row in place");
    const fiveRow = row(fiveId);
    assert(fiveRow.title === "Five title" && fiveRow.snippet === "five old snippet",
      "5: fill keeps title and snippet");
    assert(fiveRow.content === "five body onlyword" && fiveRow.fetched === 1, "5: fill writes content and fetched");
    assert(ftsIds("fivebodyonlyword").length === 0, "5: filled body is not indexed by the main FTS");
    assert(ftsIds("snippet").includes(fiveId), "5: fill leaves the original FTS entry intact");

    // ---- 6. same body -> no write ---------------------------------------
    const six = await store.savePage(session.id, {
      url: "https://ex.com/six",
      title: "Six",
      content: "six body",
      source: "tavily",
    });
    const sixAgain = await store.savePage(session.id, {
      url: "https://ex.com/six",
      title: "Six changed title ignored",
      content: "six body",
      source: "exa",
    });
    assert(sixAgain.action === "unchanged" && sixAgain.id === six.id, "6: same body is a no-op");
    assert(rowsFor("ex.com/six").length === 1, "6: no extra row for the same body");
    const sixRow = row(six.id as number);
    assert(sixRow.title === "Six" && sixRow.source === "tavily", "6: no-op leaves the row untouched");

    // ---- 7. different body -> insert + close old -------------------------
    const seven = await store.savePage(session.id, {
      url: "https://ex.com/seven",
      title: "Seven v1",
      content: "seven body v1",
      source: "exa",
    });
    const sevenAgain = await store.savePage(session.id, {
      url: "https://ex.com/seven",
      title: "Seven v2",
      content: "seven body v2",
      source: "tavily",
    });
    assert(sevenAgain.action === "inserted" && sevenAgain.id !== seven.id, "7: different body opens a new row");
    assert(row(seven.id as number).valid_until !== null, "7: old page row is closed");
    assert(live("ex.com/seven").length === 1 && live("ex.com/seven")[0]!.id === sevenAgain.id,
      "7: only the newer page row stays live");
    assert(row(seven.id as number).content === "seven body v1", "7: closed history keeps its body");

    // ---- invalidation skips archived and quarantined rows ----------------
    // Seed two extra live rows for one URL, one archived and one quarantined,
    // then write a new version. Both must keep valid_until NULL so undo/keep
    // can restore them later.
    const skipArchived = await store.saveResultsWithIds(session.id, [
      { url: "https://ex.com/skip-archive", title: "old archived", snippet: "old archived snippet", source: "exa" },
    ]);
    const archived = store.applyArchive([skipArchived[0] as number]);
    assert(archived.archived === 1, "skip: row archived");
    const skipQuarantine = await store.adjudicateMemory(session.id, [
      { url: "https://ex.com/skip-quarantine", title: "low evidence", snippet: "low evidence snippet", source: "exa", evidence: 0.2 },
    ]);
    const quarantinedId = skipQuarantine[0]!.insertedId as number;
    assert(row(quarantinedId).quarantine !== null, "skip: row quarantined");
    await store.saveResultsWithIds(session.id, [
      { url: "https://ex.com/skip-archive", title: "new version", snippet: "new version snippet", source: "tavily" },
      { url: "https://ex.com/skip-quarantine", title: "new version", snippet: "new version snippet", source: "tavily" },
    ]);
    assert(row(skipArchived[0] as number).valid_until === null, "skip: archived row is not closed by a new write");
    assert(row(quarantinedId).valid_until === null, "skip: quarantined row is not closed by a new write");

    // ---- adjudicateMemory follows the same tier rule ---------------------
    const adjudicatedPage = await store.savePage(session.id, { url: "https://ex.com/adjudicated", content: "adjudicated body", source: "tavily" });
    const adjudicatedSnippet = await store.adjudicateMemory(session.id, [
      { url: "https://ex.com/adjudicated", title: "weaker snippet", snippet: "weaker snippet", source: "exa", evidence: 0.9 },
    ]);
    assert(adjudicatedSnippet[0]!.action === "accept" && adjudicatedSnippet[0]!.insertedId === adjudicatedPage.id,
      "adjudicate: snippet attaches to the body row");
    assert(rowsFor("ex.com/adjudicated").length === 1, "adjudicate: no weaker row inserted");
    assert(row(adjudicatedPage.id as number).valid_until === null, "adjudicate: body row stays live");
    assert(row(adjudicatedPage.id as number).content === "adjudicated body", "adjudicate: body untouched");

    // ---- quarantine keep follows the same tier rule ----------------------
    const keepPage = await store.savePage(session.id, { url: "https://ex.com/keep", content: "keep body", source: "tavily" });
    const keepCandidate = await store.adjudicateMemory(session.id, [
      { url: "https://ex.com/keep", title: "kept snippet", snippet: "kept snippet", source: "exa", evidence: 0.2 },
    ]);
    // The low-evidence candidate above attaches to the body row, so seed a
    // genuine quarantine row for the same entity to exercise the keep path.
    const kept = await store.adjudicateMemory(session.id, [
      { url: "https://ex.com/keep-other", title: "quarantined other", snippet: "quarantined other", source: "exa", evidence: 0.2, entity: "ex.com/keep" },
    ]);
    const keptId = kept[0]!.insertedId as number;
    assert(row(keptId).quarantine !== null, "keep: candidate quarantined");
    const keepResult = await store.resolveQuarantinedMemory(keptId, "keep");
    assert(keepResult.ok, "keep: resolves");
    assert(row(keptId).quarantine === null, "keep: quarantine flag cleared");
    assert(row(keepPage.id as number).valid_until === null, "keep: snippet keep does not close the body row");
    assert(row(keepPage.id as number).content === "keep body", "keep: body survives");
    assert(keepCandidate[0]!.insertedId === keepPage.id, "keep: weaker write attached to body earlier");

    // ---- empty body is not a write --------------------------------------
    const empty = await store.savePage(session.id, { url: "https://ex.com/empty", content: "\u200B" });
    assert(empty.action === "empty" && empty.id === null, "empty: sanitized-away body writes nothing");
    assert(rowsFor("ex.com/empty").length === 0, "empty: no row created");

    // ---- untrusted URL text cannot split one page into two identities ----
    const zero = await store.savePage(session.id, {
      url: "https://ex.com/\u200Bzero",
      content: "zero body",
      entity: "zero\u200Bentity",
    });
    assert(zero.action === "inserted" && typeof zero.id === "number", "url: zero-width URL still writes");
    assert(row(zero.id as number).url === "ex.com/zero", "url: zero-width character stripped before identity");
    const zeroEntity = store.dbQuery<{ entity: string | null }>(
      "SELECT entity FROM retrieval_results WHERE id = ?", zero.id as number,
    )[0]!.entity;
    assert(zeroEntity === "zeroentity", "entity: zero-width character stripped before the entity key");

    // ---- title/entity keep the read path's field caps; the body does not --
    const longTitle = "t".repeat(600);
    const capped = await store.savePage(session.id, { url: "https://ex.com/capped", title: longTitle, content: "capped body" });
    assert(capped.action === "inserted" && typeof capped.id === "number", "caps: long title still writes");
    assert(row(capped.id as number).title!.length === 500, "caps: title is capped at 500 chars");
    assert(row(capped.id as number).content === "capped body", "caps: body is not truncated by the title cap");

    // ---- secret guard covers the body, not just title/snippet ------------
    const SK = "sk-testDEADBEEFcafebabe1234abcd1234";
    const secret = await store.savePage(session.id, {
      url: "https://ex.com/secret",
      title: "secret page",
      content: "here is a token: " + SK,
    });
    assert(secret.action === "secret" && secret.id === null, "secret: page with a token is rejected");
    assert(rowsFor("ex.com/secret").length === 0, "secret: rejected page writes no row");

    // ---- correction-superseded rows are history, not live versions ------
    // A row whose fact a later consolidation replaced keeps superseded_by
    // non-null while valid_until stays NULL; it must not attract a hit or
    // count as the current body.
    const raw = new Database(dbPath);
    const deadPageId = Number(raw.prepare(
      "INSERT INTO retrieval_results (session_id, url, title, snippet, source, entity, content, superseded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(session.id, "ex.com/dead-page", "dead", "dead snippet", "exa", "ex.com/dead-page", "dead body", 999).lastInsertRowid);
    const deadSnippetId = Number(raw.prepare(
      "INSERT INTO retrieval_results (session_id, url, title, snippet, source, entity, content, superseded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(session.id, "ex.com/dead-snippet", "dead snippet", "dead snippet", "exa", "ex.com/dead-snippet", "dead snippet body", 999).lastInsertRowid);
    raw.close();

    const deadPageWrite = await store.savePage(session.id, { url: "https://ex.com/dead-page", content: "dead body" });
    assert(deadPageWrite.action === "inserted" && deadPageWrite.id !== deadPageId,
      "superseded: same body opens a new row instead of returning the dead id");
    const deadSnippetWrite = await store.saveResultsWithIds(session.id, [
      { url: "https://ex.com/dead-snippet", title: "live snippet", snippet: "live snippet", source: "exa" },
    ]);
    assert(deadSnippetWrite[0] !== deadSnippetId, "superseded: search hit does not attach to the dead row");
    assert(row(deadSnippetWrite[0] as number).content === null, "superseded: the hit writes its own snippet row");

    store.close();
    console.log("content-write-path.test.ts: " + passed + " passed, " + failed + " failed");
    if (failed > 0) process.exit(1);
  } finally {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
