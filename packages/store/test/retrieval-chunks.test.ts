// Page bodies are searchable: sections/blocks, Chinese bigrams, English
// prefixes, the section list on a recall hit, and the background block-vector
// fill.
//
// Style: assert-based self-check (no framework), run against a temp SQLite file
// like the rest of the store suite.

import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteSessionStore } from "../src/session-store";
import { __setEmbeddingModuleForTest } from "../src/embedding-arm";
import { ensureChunksForPage, pagesMissingChunks, readChunkVectorBacklogFile } from "../src/retrieval-chunks";
import { SCHEMA_SQL } from "../src/schema-content";
import { execDdlAtomically } from "../src/sqlite-init";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return; }
  passed++;
}

interface ChunkRow {
  id: number;
  page_id: number;
  parent_id: number | null;
  level: number;
  ord: number;
  start_offset: number;
  end_offset: number;
  heading_path: string;
}

async function main() {
  // Absent embedding first: the keyword lane must work, and the block backlog
  // must be visible instead of silently reported as "no vectors".
  __setEmbeddingModuleForTest(null);
  const tmpDir = mkdtempSync(join(tmpdir(), "ans-chunks-"));
  const dbPath = join(tmpDir, "test.db");
  try {
    const store = new SqliteSessionStore(dbPath);
    const session = await store.createSession("research");

    const pageMd = [
      "## Windows 安装",
      "",
      "下载安装包，然后运行 ans doctor。中文分词示例在这里。",
      "",
      "## FTS 中文检索",
      "",
      "分词的规则是：中文连续段切成重叠的二元组，中文分词的边界要插分隔符。",
      "",
      "英文前缀示例：vectors are stored as float32 arrays.",
    ].join("\n");
    const page = await store.savePage(session.id, {
      url: "https://example.com/guide",
      title: "部署指南",
      content: pageMd,
      source: "exa",
    });
    assert(page.action === "inserted" && typeof page.id === "number", "a page body lands a row");

    const chunks = (id: number): ChunkRow[] => store.dbQuery<ChunkRow>(
      "SELECT id, page_id, parent_id, level, ord, start_offset, end_offset, heading_path " +
        "FROM retrieval_chunks WHERE page_id = ? ORDER BY level, ord",
      id,
    );
    const rows = chunks(page.id as number);
    const sections = rows.filter((r) => r.level === 0);
    const blocks = rows.filter((r) => r.level === 1);
    assert(sections.length === 2, `two heading sections (got ${sections.length})`);
    assert(blocks.length >= sections.length, "each section owns at least one block");
    assert(sections[0]!.heading_path === "部署指南 > Windows 安装", "heading path is rooted at the page title");
    assert(sections[1]!.heading_path === "部署指南 > FTS 中文检索", "second section keeps its own path");
    assert(blocks.every((b) => b.parent_id !== null), "every block points at a parent section");
    assert(blocks.every((b) => b.start_offset >= 0 && b.end_offset > b.start_offset), "blocks carry a real range");
    // Offsets are code points: SQLite's substr must return exactly the block.
    const firstBlockText = store.dbQuery<{ text: string }>(
      "SELECT substr(content, ?, ?) AS text FROM retrieval_results WHERE id = ?",
      blocks[0]!.start_offset + 1, blocks[0]!.end_offset - blocks[0]!.start_offset, page.id,
    )[0]!.text;
    assert(firstBlockText.includes("下载安装包"), "a block's offsets address its own text through SQL substr");

    // ---- Chinese 2/3/4-character queries hit the body ---------------------
    for (const query of ["中文分词", "中文分", "分词"]) {
      const hits = await store.searchMemory(query, 5);
      assert(hits.length >= 1, `"${query}" finds the page body (got ${hits.length})`);
      assert(hits.some((h) => h.rowid === page.id), `"${query}" names the page row`);
    }
    // A single Han character exists inside bigrams, never as its own FTS token.
    const single = await store.searchMemory("词", 5);
    assert(single.some((h) => h.rowid === page.id), "a one-character Han query falls back to a page-level LIKE");
    // The only hit can be on the heading line itself; that page must not vanish.
    const hanHeadingPage = await store.savePage(session.id, {
      url: "https://example.com/heading-only",
      title: "词表",
      content: "## 词表\n\n这一节只有正文，没有重复的字。",
      source: "exa",
    });
    const headingHit = (await store.searchMemory("词", 5)).find((h) => h.rowid === hanHeadingPage.id)!;
    assert(Boolean(headingHit), "a one-character hit on a heading line still maps to its section");
    assert((headingHit.content ?? "").includes("词"), "the preview contains the character the user searched");

    // ---- English prefix still matches -------------------------------------
    const prefix = await store.searchMemory("vector", 5);
    const prefHit = prefix.find((h) => h.rowid === page.id);
    assert(Boolean(prefHit), "the Latin prefix vector finds vectors");
    assert(prefHit!.arms?.includes("content") === true, "the body match is reported as the content arm");

    // ---- recall hit carries url / fetchedAt / hasContent / sections ------
    const hit = (await store.searchMemory("中文分词", 5)).find((h) => h.rowid === page.id)!;
    assert(typeof hit.url === "string" && hit.url.includes("example.com"), `url is the stored identity (got ${hit.url})`);
    assert(typeof hit.fetchedAt === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(hit.fetchedAt),
      `fetchedAt is ISO-8601 UTC (got ${hit.fetchedAt})`);
    assert(hit.hasContent === true, "hasContent is true for a page row");
    assert(hit.sections!.length === 2, `every level-0 section is listed (got ${hit.sections!.length})`);
    for (const s of hit.sections!) {
      assert(s.sectionId > 0 && s.headingPath.startsWith("部署指南"), "section carries id and heading path");
      assert(s.chars > 0 && s.startOffset >= 0, "section carries its length and start offset");
    }
    assert(hit.sections![0]!.startOffset < hit.sections![1]!.startOffset, "sections are in reading order");

    // ---- non-Han, non-ASCII text is searchable too -----------------------
    const cyrillic = await store.savePage(session.id, {
      url: "https://example.com/ru",
      title: "Русская страница",
      content: "## Раздел\n\nЗдесь описан привет и другие слова.",
      source: "exa",
    });
    const ruHits = await store.searchMemory("привет", 5);
    assert(ruHits.some((h) => h.rowid === cyrillic.id), "a Cyrillic body is searchable (word-prefix lane)");

    // ---- one section hit by several blocks appears once -------------------
    const repeated = ("同一个节里反复提到这个词。" + "填充文字。".repeat(160) + "\n\n" + "同一个节里反复提到这个词。");
    const many = await store.savePage(session.id, {
      url: "https://example.com/repeat",
      title: "重复命中",
      content: "## 一节\n\n" + repeated,
      source: "exa",
    });
    const manySection = chunks(many.id as number).filter((r) => r.level === 1);
    assert(manySection.length >= 2, `the fixture really splits the section into several blocks (got ${manySection.length})`);
    const repeatedHits = await store.searchMemory("同一个节里反复提到这个词", 5);
    const repeatRows = repeatedHits.filter((h) => h.rowid === many.id);
    assert(repeatRows.length === 1, `the page appears once even when both blocks match (got ${repeatRows.length})`);
    const contentList = store.lastArmProvenance!.lists[store.lastArmProvenance!.labels.indexOf("content")]!;
    assert(contentList.filter((id) => id === String(many.id)).length === 1, "the content arm lists the page once (parent-section dedupe)");

    // ---- the main FTS still covers title/snippet only ---------------------
    const padding = "填".repeat(4200);
    const longPage = await store.savePage(session.id, {
      url: "https://example.com/long",
      title: "长页",
      content: "## 长节\n\n" + padding + " zzbodyonly marker lives past the snippet window",
      source: "exa",
    });
    const mainFts = store.dbQuery<{ rowid: number }>(
      "SELECT rowid FROM retrieval_results_fts WHERE retrieval_results_fts MATCH ?", "zzbodyonly*",
    );
    assert(mainFts.length === 0, "the body is not indexed by the main title/snippet FTS");
    const bodyOnly = await store.searchMemory("zzbodyonly", 5);
    const bodyOnlyHit = bodyOnly.find((h) => h.rowid === longPage.id);
    assert(bodyOnlyHit !== undefined, "the content arm still finds a body-only term");

    // The preview is the matched section, not the page opening (and is capped).
    const sectionPage = await store.savePage(session.id, {
      url: "https://example.com/section-text",
      title: "两节",
      content: "## 第一节\n\n" + "填".repeat(4100) + "\n\n## 第二节\n\n只有第二节才有的词 zzsecondmarker。",
      source: "exa",
    });
    const sectionHit = (await store.searchMemory("zzsecondmarker", 5)).find((h) => h.rowid === sectionPage.id);
    assert(sectionHit !== undefined, "the section hit is found");
    assert((sectionHit?.content ?? "").includes("zzsecondmarker"), "content carries the matched section text");
    assert(!(sectionHit?.content ?? "").includes("填"), "content is not the page opening");
    assert((sectionHit?.content ?? "").length <= 1001, "the matched section preview is capped");

    // ---- equal RRF score: the row with a body wins, both paths -----------
    const tieSnippet = (await store.saveResultsWithIds(session.id, [{
      url: "https://example.com/tie-snippet",
      title: "snippet tie",
      snippet: "zzboth alpha",
      source: "exa",
    }]))[0]!;
    const tieBody = await store.savePage(session.id, {
      url: "https://example.com/tie-body",
      title: "body tie",
      content: "## T\n\nzzboth alpha",
      source: "exa",
    });
    const tieQuery = "zzboth";
    const singleTie = await store.searchMemory(tieQuery, 5);
    const singleIds = singleTie.map((h) => Number(h.rowid));
    assert(singleIds.indexOf(Number(tieBody.id)) < singleIds.indexOf(Number(tieSnippet)),
      "single query: a body hit outranks an equal snippet hit");
    const tieBodyHit = singleTie.find((h) => h.rowid === tieBody.id)!;
    assert(tieBodyHit.arms?.includes("content") === true, "the body hit carries the content arm");
    const multiTie = await store.searchMemoryMulti([tieQuery], 5);
    const multiIds = multiTie.map((h) => Number(h.rowid));
    assert(multiIds.indexOf(Number(tieBody.id)) < multiIds.indexOf(Number(tieSnippet)),
      "multi-query path: a body hit outranks an equal snippet hit");

    // ---- block vectors fill in the background, search never waits --------
    assert((readChunkVectorBacklogFile(dbPath)?.pending ?? 0) > 0, "after the write, blocks still owe vectors (durable backlog)");
    const vectorOnly = "数据湖方案";
    const vectorPage = await store.savePage(session.id, {
      url: "https://example.com/lakehouse",
      title: "lakehouse",
      content: "## 架构\n\n" + "填".repeat(4200) + " lakehouse architecture stores parquet files.",
      source: "exa",
    });
    // No vectors yet: the keyword lanes cannot see the synonym, so the query
    // misses but the store still answers (no error, no hang).
    const beforeVectors = await store.searchMemory(vectorOnly, 5);
    assert(!beforeVectors.some((h) => h.rowid === vectorPage.id), "a vector-only question misses before the fill");

    __setEmbeddingModuleForTest({
      embedText: async (text: string) => {
        const v = new Float32Array(384);
        // One axis for "the same topic"; everything else lands on the other axis.
        if (text.includes("数据湖") || text.includes("lakehouse")) v[0] = 1;
        else v[1] = 1;
        return v;
      },
      embeddingTelemetry: () => ({ loads: 1, embeds: 1, failures: 0, circuitOpen: false }),
      EMBEDDING_MODEL_ID: "test-model",
    } as never);
    const filled = await store.backfillChunkVectors();
    assert(filled.embedded > 0 && filled.failed === 0, `backfill embeds every pending block (${JSON.stringify(filled)})`);
    assert((readChunkVectorBacklogFile(dbPath)?.pending ?? 0) === 0, "after the fill nothing is pending");
    assert(store.dbQuery<{ model: string }>("SELECT model FROM retrieval_chunk_vectors LIMIT 1")[0]!.model === "test-model",
      "a block vector records the embedding model that wrote it");
    const otherModel = readChunkVectorBacklogFile(dbPath, "other-model");
    assert(otherModel !== null && otherModel.pending > 0 && otherModel.embedded === 0,
      "a different model makes the whole archive owe vectors (the backlog is model-aware)");
    const afterVectors = await store.searchMemory(vectorOnly, 5);
    const vecHit = afterVectors.find((h) => h.rowid === vectorPage.id);
    assert(Boolean(vecHit), "the block-vector lane finds a synonym that no keyword lane shares");
    assert(vecHit!.arms?.includes("vector") === true, "a block-vector-only hit is labeled as the vector arm");

    // ---- deleting the page cascades the blocks and their FTS rows ---------
    const doomed = await store.savePage(session.id, {
      url: "https://example.com/doomed",
      title: "删页",
      content: "## 删页\n\n这一页会被整页删除。",
      source: "exa",
    });
    const doomedBlocks = chunks(doomed.id as number).filter((r) => r.level === 1);
    const rawDoomed = new Database(dbPath);
    try {
      rawDoomed.pragma("foreign_keys = ON");
      rawDoomed.prepare("DELETE FROM retrieval_results WHERE id = ?").run(doomed.id);
      const leftover = rawDoomed.prepare(
        "SELECT COUNT(*) AS n FROM retrieval_chunks_fts WHERE rowid IN (" + doomedBlocks.map(() => "?").join(", ") + ")",
      ).get(...doomedBlocks.map((r) => r.id)) as { n: number };
      assert(leftover.n === 0, "a page delete cascades and the trigger removes the FTS rows");
    } finally {
      rawDoomed.close();
    }

    // ---- an unchanged save still builds missing blocks -------------------
    const beforeUnchanged = chunks(page.id as number).length;
    assert(beforeUnchanged > 0, "the page has blocks before the repair");
    const rawUnchanged = new Database(dbPath);
    try {
      rawUnchanged.prepare("DELETE FROM retrieval_chunk_vectors WHERE chunk_id IN (SELECT id FROM retrieval_chunks WHERE page_id = ?)").run(page.id);
      rawUnchanged.prepare("DELETE FROM retrieval_chunks WHERE page_id = ?").run(page.id);
      rawUnchanged.prepare("DELETE FROM retrieval_page_chunks WHERE page_id = ?").run(page.id);
    } finally {
      rawUnchanged.close();
    }
    const again = await store.savePage(session.id, {
      url: "https://example.com/guide",
      title: "部署指南",
      content: pageMd,
      source: "exa",
    });
    assert(again.action === "unchanged", "the same body is unchanged");
    assert(chunks(page.id as number).length > 0, "an unchanged save rebuilds missing blocks");

    // ---- a page that lost some blocks is repaired ------------------------
    const partial = await store.savePage(session.id, {
      url: "https://example.com/partial",
      title: "部分块",
      content: "## 第一节\n\n第一段正文。\n\n## 第二节\n\n第二段正文。\n\n## 第三节\n\n第三段正文。",
      source: "exa",
    });
    const partialRows = chunks(partial.id as number);
    const keepBlock = partialRows.find((r) => r.level === 1)!;
    const rawPartial = new Database(dbPath);
    try {
      rawPartial.pragma("foreign_keys = ON");
      rawPartial.prepare("DELETE FROM retrieval_chunks WHERE page_id = ? AND level = 1 AND id <> ?").run(partial.id, keepBlock.id);
    } finally {
      rawPartial.close();
    }
    const rawPartialCheck = new Database(dbPath);
    try {
      assert(pagesMissingChunks(rawPartialCheck, 50).includes(partial.id as number),
        "a page that kept one block but lost others is queued for repair");
    } finally {
      rawPartialCheck.close();
    }
    const partialRepair = await store.backfillChunkVectors(true);
    assert(partialRepair.rebuiltPages >= 1, "the partially lost page is reported for rebuild");
    await store.backfillChunkVectors();
    assert(chunks(partial.id as number).filter((r) => r.level === 1).length > 1, "missing blocks are rebuilt");

    // ---- a heading-only page is attempted once, not every backfill ------
    const headingOnly = await store.savePage(session.id, {
      url: "https://example.com/heading-only",
      title: "只有标题",
      content: "## 只有标题\n",
      source: "exa",
    });
    const rawHeading = new Database(dbPath);
    try {
      assert(!pagesMissingChunks(rawHeading, 50).includes(headingOnly.id as number),
        "a page that yields no section is not queued for repair forever");
    } finally {
      rawHeading.close();
    }
    const headingBacklog = readChunkVectorBacklogFile(dbPath);
    assert(headingBacklog !== null && headingBacklog.pagesWithoutChunks === 0,
      "a page that yields no section does not keep the doctor count up");

    // ---- the schema rejects a row the readers cannot classify -------------
    const rawCheck = new Database(dbPath);
    try {
      let refused = false;
      try {
        rawCheck.prepare(
          "INSERT INTO retrieval_chunks (page_id, parent_id, level, ord, start_offset, end_offset, heading_path) " +
          "VALUES (?, NULL, 2, 0, 0, 0, 'x')",
        ).run(page.id);
      } catch { refused = true; }
      assert(refused, "level outside 0/1 is rejected by the CHECK constraint");
    } finally {
      rawCheck.close();
    }

    // ---- one block failing does not starve the rest -----------------------
    const failDirPage = await store.savePage(session.id, {
      url: "https://example.com/partial-embed",
      title: "部分嵌入",
      content: "## 一\n\nzzfailblock 这一段嵌不出来。\n\n## 二\n\n这一段可以嵌出来，normalblock words。",
      source: "exa",
    });
    __setEmbeddingModuleForTest({
      embedText: async (text: string) => {
        if (text.includes("zzfailblock")) return null;
        const v = new Float32Array(384);
        v[0] = 1;
        return v;
      },
      embeddingTelemetry: () => ({ loads: 1, embeds: 1, failures: 0, circuitOpen: false }),
      EMBEDDING_MODEL_ID: "test-model",
    } as never);
    const partialEmbed = await store.backfillChunkVectors();
    assert(partialEmbed.failed >= 1, "the failing block is counted once");
    assert(partialEmbed.embedded >= 1, "blocks behind the failing one are still embedded");

    // ---- ensureChunksForPage is re-entrant --------------------------------
    // Law: an old row that got its body later is rebuilt, and rebuilding twice
    // does not double the index.
    const raw = new Database(dbPath);
    try {
      const first = ensureChunksForPage(raw, page.id as number);
      const second = ensureChunksForPage(raw, page.id as number);
      assert(first.sections === second.sections && first.blocks === second.blocks,
        `re-entrant rebuild reports the same shape (${JSON.stringify(first)} vs ${JSON.stringify(second)})`);
      const after = raw.prepare(
        "SELECT COUNT(*) AS n FROM retrieval_chunks WHERE page_id = ?",
      ).get(page.id) as { n: number };
      assert(after.n === sections.length + blocks.length, "rebuilding does not duplicate chunk rows");
      const ftsAfter = raw.prepare(
        "SELECT COUNT(*) AS n FROM retrieval_chunks_fts WHERE rowid IN (SELECT id FROM retrieval_chunks WHERE page_id = ?)",
      ).get(page.id) as { n: number };
      assert(ftsAfter.n === blocks.length, "rebuilding leaves exactly one FTS row per block");
    } finally {
      raw.close();
    }

    // ---- a file created by the task registry is not a broken file ---------
    // schema.sql alone (the creator path) has no session-store columns yet;
    // doctor must report "cannot read yet", never an error.
    const creatorPath = join(tmpDir, "creator.db");
    const creator = new Database(creatorPath);
    try {
      execDdlAtomically(creator, SCHEMA_SQL);
    } finally {
      creator.close();
    }
    assert(readChunkVectorBacklogFile(creatorPath) === null,
      "a half-assembled creator-path DB reads as 'not ready' instead of throwing");

    // ---- a snippet row whose body arrives later gets blocks --------------
    const snippetOnly = await store.saveResultsWithIds(session.id, [
      { url: "https://example.com/later", title: "Later body", snippet: "只有摘要", source: "exa" },
    ]);
    const laterId = snippetOnly[0] as number;
    const filledLater = await store.savePage(session.id, {
      url: "https://example.com/later",
      title: "Later body",
      content: "## 后来补上的正文\n\n这一段是后来才补上的整页正文。",
      source: "exa",
    });
    assert(filledLater.id === laterId && filledLater.action === "filled", "the body fills the snippet row in place");
    const laterRows = chunks(laterId);
    assert(laterRows.filter((r) => r.level === 0).length === 1, "the filled row gains its section");
    const laterHits = await store.searchMemory("后来补上的正文", 5);
    assert(laterHits.some((h) => h.rowid === laterId), "the filled body is searchable");

    // ---- a failed chunk write is repairable ------------------------------
    // A page that has a body but no chunks (a failed write) must not be a dead
    // end: backfill rebuilds the chunks before it fills vectors.
    // No embedding model here: the point is the keyword lane and the rebuild,
    // not a semantically-similar vector hit on the title/snippet.
    __setEmbeddingModuleForTest(null);
    const damaged = await store.savePage(session.id, {
      url: "https://example.com/damaged",
      title: "损坏页",
      content: "## 修复\n\n这段正文只有在块表修好后才能搜到。",
      source: "exa",
    });
    const damagedChunks = chunks(damaged.id as number).filter((r) => r.level === 1);
    const rawDamaged = new Database(dbPath);
    try {
      rawDamaged.pragma("foreign_keys = ON");
      rawDamaged.prepare("DELETE FROM retrieval_chunks WHERE page_id = ?").run(damaged.id);
      const leftover = rawDamaged.prepare(
        "SELECT COUNT(*) AS n FROM retrieval_chunks_fts WHERE rowid IN (" + damagedChunks.map(() => "?").join(", ") + ")",
      ).get(...damagedChunks.map((r) => r.id)) as { n: number };
      assert(leftover.n === 0, "a cascade delete also removes the block FTS rows");
    } finally {
      rawDamaged.close();
    }
    const beforeRepair = await store.searchMemory("块表修好后", 5);
    assert(!beforeRepair.some((h) => h.rowid === damaged.id), "a page without chunks is not searchable");
    assert((readChunkVectorBacklogFile(dbPath)?.pagesWithoutChunks ?? 0) >= 1, "the durable backlog names pages with a body but no blocks");
    const repaired = await store.backfillChunkVectors();
    assert(repaired.rebuiltPages >= 1, "backfill rebuilds pages that lost their chunks");
    const afterRepair = await store.searchMemory("块表修好后", 5);
    assert(afterRepair.some((h) => h.rowid === damaged.id), "the rebuilt page is searchable again");
    assert((readChunkVectorBacklogFile(dbPath)?.pagesWithoutChunks ?? 0) === 0, "the repair empties the missing-chunks count");

    // ---- a page that lost only its FTS row is repaired --------------------
    // The chunk rows still add up, so counting blocks cannot see this loss.
    // Without an index check the page never enters the repair queue: the
    // keyword lane stays short and doctor reports no backlog.
    const ftsLost = await store.savePage(session.id, {
      url: "https://example.com/fts-lost",
      title: "索引丢失页",
      content: "## 索引\n\n这一块的行还在，索引行被删掉了。",
      source: "exa",
    });
    const ftsLostBlock = chunks(ftsLost.id as number).find((r) => r.level === 1)!;
    const rawFtsLost = new Database(dbPath);
    try {
      rawFtsLost.prepare("DELETE FROM retrieval_chunks_fts WHERE rowid = ?").run(ftsLostBlock.id);
      const left = rawFtsLost.prepare(
        "SELECT COUNT(*) AS n FROM retrieval_chunks_fts WHERE rowid = ?",
      ).get(ftsLostBlock.id) as { n: number };
      assert.equal(left.n, 0, "the block row survives its index row");
    } finally {
      rawFtsLost.close();
    }
    const rawFtsLostCheck = new Database(dbPath);
    try {
      assert(pagesMissingChunks(rawFtsLostCheck, 50).includes(ftsLost.id as number),
        "a page whose block index went missing is queued for repair");
    } finally {
      rawFtsLostCheck.close();
    }
    assert((readChunkVectorBacklogFile(dbPath)?.pagesWithoutChunks ?? 0) >= 1,
      "the durable backlog names a page whose block index went missing");
    const ftsRepair = await store.backfillChunkVectors();
    assert(ftsRepair.rebuiltPages >= 1, "backfill rebuilds the page whose index row was lost");
    const rebuiltBlocks = chunks(ftsLost.id as number).filter((r) => r.level === 1);
    const rawFtsBack = new Database(dbPath);
    try {
      const back = rawFtsBack.prepare(
        "SELECT COUNT(*) AS n FROM retrieval_chunks_fts WHERE rowid IN (" + rebuiltBlocks.map(() => "?").join(", ") + ")",
      ).get(...rebuiltBlocks.map((r) => r.id)) as { n: number };
      assert.equal(back.n, rebuiltBlocks.length, "every rebuilt block has its index row back");
    } finally {
      rawFtsBack.close();
    }
    assert((readChunkVectorBacklogFile(dbPath)?.pagesWithoutChunks ?? 0) === 0,
      "the index repair empties the missing-chunks count");

    // AUTOINCREMENT: a deleted block id is never handed out again, so a stale
    // FTS row can never attach to a new block.
    const maxIdBefore = (store.dbQuery<{ id: number }>("SELECT MAX(id) AS id FROM retrieval_chunks")[0]!.id);
    const fresh = await store.savePage(session.id, {
      url: "https://example.com/fresh",
      title: "新页",
      content: "## 新节\n\n新的一段正文。",
      source: "exa",
    });
    const freshBlocks = chunks(fresh.id as number).filter((r) => r.level === 1);
    assert(freshBlocks.every((r) => r.id > maxIdBefore), "new blocks never reuse a retired chunk id");

    // ---- knowledge rows never wear page facts -----------------------------
    // The multi-query lane re-reads knowledge rows as `-id`; the material with
    // the same numeric id must keep its own facts and the knowledge row none.
    const collided = await store.saveResultsWithIds(session.id, [
      { url: "https://example.com/collide", title: "collide material", snippet: "collide shared", source: "exa" },
    ]);
    const materialId = collided[0] as number;
    const raw2 = new Database(dbPath);
    try {
      raw2.prepare(
        "INSERT INTO semantic_memories (id, content, source_episode_ids) VALUES (?, ?, ?)",
      ).run(materialId, "collide shared knowledge", "[]");
    } finally {
      raw2.close();
    }
    const multiHits = await store.searchMemoryMulti(["collide"], 10);
    const pageHit = multiHits.find((h) => h.rowid === materialId && h.sessionId.length > 0)!;
    const knowledgeHit = multiHits.find((h) => h.role === "(semantic)")!;
    assert(Boolean(pageHit) && Boolean(knowledgeHit), "both the material and the knowledge row are recalled");
    assert(knowledgeHit.rowid === -materialId, `knowledge row keeps its negative id (got ${knowledgeHit.rowid})`);
    assert(pageHit.url === "example.com/collide" && pageHit.hasContent === false,
      "the material carries its page facts (url present, no body)");
    assert(knowledgeHit.url === undefined && knowledgeHit.hasContent === false,
      "the knowledge row carries no page facts");
    assert(knowledgeHit.sections!.length === 0, "the knowledge row gets no sections");

    store.close();
    console.log(`retrieval-chunks tests: ${passed} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);
  } finally {
    __setEmbeddingModuleForTest("auto");
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

main();
