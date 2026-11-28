// #611: recall_memory's expand reads a page body back by rowid + section.
//
// Style: assert-based self-check (no framework) over a temp SQLite file, like
// the rest of the store suite. The shape asserted here is the store seam the
// MCP tool copies into its JSON.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { SqliteSessionStore } from "../src/session-store";
import { __setEmbeddingModuleForTest } from "../src/embedding-arm";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return; }
  passed++;
}

async function main() {
  __setEmbeddingModuleForTest(null); // keep the background vector fill out of this test
  const dir = mkdtempSync(join(tmpdir(), "ans-expand-"));
  const store = new SqliteSessionStore(join(dir, "t.db"));
  try {
    const session = await store.createSession("research");

    // ---- a normal page: first section by default, several by request ------
    const page = await store.savePage(session.id, {
      url: "https://example.com/guide",
      title: "部署指南",
      content: "## 安装\n\n这里是安装说明。\n\n## 检索\n\n这里是检索说明。",
      source: "exa",
    });
    const rowid = page.id!;
    const sections = await store.dbQuery<{ sectionId: number; headingPath: string; chars: number; startOffset: number }>(
      "SELECT id AS sectionId, heading_path AS headingPath, start_offset AS startOffset, " +
      "end_offset - start_offset AS chars FROM retrieval_chunks WHERE page_id = ? AND level = 0 ORDER BY ord",
      rowid,
    );
    assert(sections.length === 2, "the page has two sections");

    const first = store.expandMemory({ rowid });
    assert(first.ok, "default expansion succeeds");
    if (first.ok) {
      assert(first.offset === sections[0]!.startOffset, "default starts at the first section");
      assert(first.role === sections[0]!.headingPath, "role is the section heading path");
      assert(first.url === "example.com/guide", "url is the stored identity, like a recall hit");
      assert(/^\d{4}-\d{2}-\d{2}T/.test(first.fetchedAt ?? ""), "fetchedAt is ISO-8601");
      assert(first.text.includes("这里是安装说明"), "the section body comes back");
      assert(!first.text.includes("这里是检索说明"), "the default stops at the section end");
      assert(!first.text.includes("部署指南 > 安装"), "one section is not prefixed with its heading");
      assert(first.returnedChars === sections[0]!.chars, "one section returns exactly its body chars");
      assert(first.hasMore === false && first.nextOffset === null, "a whole section is not truncated");
      assert(first.truncatedBy === null, "no truncation marker on a whole section");
      assert(first.returnedChars === [...first.text].length, "returnedChars counts the returned text");
      assert(first.totalChars > first.returnedChars, "totalChars is the whole page");
    }

    const two = store.expandMemory({ rowid, sectionId: [sections[1]!.sectionId, sections[0]!.sectionId] });
    assert(two.ok, "several sections expand");
    if (two.ok) {
      assert(two.text.indexOf(sections[1]!.headingPath) < two.text.indexOf(sections[0]!.headingPath),
        "sections keep the requested order");
      assert(two.text.includes("这里是检索说明") && two.text.includes("这里是安装说明"),
        "both section bodies are present");
      assert(two.offset === sections[1]!.startOffset, "offset is the first requested section");
      assert(two.role.split(" | ").length === 2, "role names both sections");
    }

    // ---- the 8000 ceiling, an ellipsis, and continuation -------------------
    const bigText = "😀".repeat(9000) + " tail";
    const big = await store.savePage(session.id, {
      url: "https://example.com/big",
      title: "大页面",
      content: bigText,
      source: "exa",
    });
    const bigId = big.id!;
    const cut = store.expandMemory({ rowid: bigId });
    assert(cut.ok, "a page over the ceiling still expands");
    if (cut.ok) {
      assert(cut.hasMore === true, "an oversized section reports more");
      assert(cut.truncatedBy === "oversized_section", "the 8000 ceiling names itself");
      assert(cut.text.endsWith("…"), "a cut answer writes an ellipsis");
      assert(cut.returnedChars <= 8000, "the hard ceiling holds (got " + cut.returnedChars + ")");
      assert(cut.nextOffset !== null && cut.nextOffset > 0, "nextOffset names where to continue");
      // Code-point slicing: 9005 - 7999 (the cut) leaves 1006, starting on a whole emoji.
      const next = store.expandMemory({ rowid: bigId, offset: cut.nextOffset! });
      assert(next.ok, "the continuation reads");
      if (next.ok) {
        assert(next.offset === cut.nextOffset, "offset reports the continuation point");
        assert(next.hasMore === false, "the rest fits in one read");
        assert(next.text.startsWith("😀") && next.text.endsWith(" tail"), "no emoji was split at the offset");
        assert(!next.text.includes("\uFFFD"), "the continuation has no broken surrogate");
        assert([...next.text].length === 1006, "the continuation is the remaining 1006 code points (got " + [...next.text].length + ")");
      }
    }

    // ---- correctable errors travel in the result --------------------------
    const snippetIds = await store.saveResultsWithIds(session.id, [
      { url: "https://example.com/snippet", title: "只有摘要", snippet: "snippet only", source: "exa" },
    ]);
    const noContent = store.expandMemory({ rowid: snippetIds[0]! });
    assert(!noContent.ok && noContent.error === "no_content", "a snippet-only row reports no_content");

    const knowledge = store.expandMemory({ rowid: -1 });
    assert(!knowledge.ok && knowledge.error === "knowledge_row", "a negative rowid reports knowledge_row");

    const outOfRange = store.expandMemory({ rowid, offset: 10_000 });
    assert(!outOfRange.ok && outOfRange.error === "offset_out_of_range", "an offset past the page is refused");
    if (!outOfRange.ok) assert(typeof outOfRange.totalChars === "number", "the refusal says how long the page is");

    const missingSection = store.expandMemory({ rowid, sectionId: 999_999 });
    assert(!missingSection.ok && missingSection.error === "section_not_found", "an unknown section is named");

    const emptySections = store.expandMemory({ rowid, sectionId: [] });
    assert(!emptySections.ok && emptySections.error === "section_not_found", "an empty section list is refused, not read as the first section");

    const missingRow = store.expandMemory({ rowid: 999_999 });
    assert(!missingRow.ok && missingRow.error === "not_found", "a missing material row is named");

    // ---- limitChars lowers the cap and says why it cut ---------------------
    const small = store.expandMemory({ rowid, limitChars: 4 });
    assert(small.ok, "limitChars still reads");
    if (small.ok) {
      assert(small.hasMore === true, "a small cap reports more");
      assert(small.truncatedBy === "limit_chars", "an explicit cap names itself");
      assert(small.returnedChars <= 4, "the requested cap holds (got " + small.returnedChars + ")");
    }

    // ---- a one-character cap still advances one code point -----------------
    const one = store.expandMemory({ rowid, limitChars: 1 });
    assert(one.ok, "a one-character cap still reads");
    if (one.ok) {
      assert(one.returnedChars === 1, "a one-character cap returns one character (got " + one.returnedChars + ")");
      assert(!one.text.endsWith("…"), "the one character is body text, not only an ellipsis");
      assert(one.nextOffset === one.offset + 1, "the next offset advances one code point instead of repeating");
      assert(one.truncatedBy === "limit_chars", "the caller's cap still names itself");
    }

    // ---- a section boundary is not a cut ----------------------------------
    const boundary = await store.savePage(session.id, {
      url: "https://example.com/boundary",
      title: "边界",
      content: "## A\n\n11111\n\n## B\n\n22222",
      source: "exa",
    });
    const boundarySections = await store.dbQuery<{ sectionId: number; headingPath: string; chars: number; startOffset: number }>(
      "SELECT id AS sectionId, heading_path AS headingPath, start_offset AS startOffset, " +
      "end_offset - start_offset AS chars FROM retrieval_chunks WHERE page_id = ? AND level = 0 ORDER BY ord",
      boundary.id!,
    );
    if (boundarySections.length === 2) {
      const exact = store.expandMemory({
        rowid: boundary.id!,
        sectionId: [boundarySections[0]!.sectionId, boundarySections[1]!.sectionId],
        limitChars: [...(boundarySections[0]!.headingPath + "\n\n")].length + boundarySections[0]!.chars,
      });
      assert(exact.ok, "a read that ends exactly on a section boundary succeeds");
      if (exact.ok) {
        assert(exact.hasMore === true, "the next section is reported as waiting");
        assert(exact.nextOffset === boundarySections[1]!.startOffset, "nextOffset names the next section");
        assert(exact.truncatedBy === null, "a boundary reports no truncation marker");
      }
    } else {
      assert(false, "the boundary page has two sections");
    }

    // ---- archived rows are not readable -----------------------------------
    const raw = new Database(join(dir, "t.db"));
    try {
      raw.prepare("UPDATE retrieval_results SET archived = 1 WHERE id = ?").run(rowid);
    } finally {
      raw.close();
    }
    const archived = store.expandMemory({ rowid });
    assert(!archived.ok && archived.error === "not_found", "an archived page is not expandable");
  } finally {
    store.close();
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
  console.log("--- retrieval-expand tests: " + passed + " passed, " + failed + " failed ---");
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
