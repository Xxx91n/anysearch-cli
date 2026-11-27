// Sections and blocks of a page body, and the search that reads them.
//
// Offsets count code points — the unit SQLite's substr/length use. The body
// itself stays in retrieval_results.content; a row here only records where a
// section/block sits and its heading path. Governance columns stay on the
// page row and are joined when filtering.
//
// The FTS index is contentless and has no triggers of its own; writes and
// deletes go through this module. A cascade delete of retrieval_results still
// reaches the blocks, so a schema trigger removes their FTS rows.

import type Database from "better-sqlite3";
import { FUSION_REGISTRY, rrfRank } from "@anysearch-cli/retriever";
import { cosineSimilarity } from "./embedding-arm.js";
import { openDatabase } from "./db.js";
import { HAS_PAGE_BODY_EXPR } from "./retrieval-content.js";
import { blockSearchText, chunkIndexText, chunkMarkdownFromChars, chunkQueryTerms } from "./chunk-text.js";

/** Section row (level 0) in `retrieval_chunks`. */
const LEVEL_SECTION = 0;
/** Block row (level 1) in `retrieval_chunks`. */
const LEVEL_BLOCK = 1;

/** Pages whose read-side state is still live: not expired, quarantined, archived or replaced. */
const LIVE_PAGE_SQL =
  " r.valid_until IS NULL AND r.quarantine IS NULL AND r.archived = 0 AND r.superseded_by IS NULL";

/** How many candidates each lane may bring before the section fusion. */
const CANDIDATE_SLACK = 4;
/**
 * Block-vector scan ceiling: the lane reads the newest blocks only. Past this
 * count older pages stay keyword-only; a real vector index is future work and
 * `ans doctor` reports the truncation.
 */
const VECTOR_SCAN_MAX = 2_000;
/** Preview cap for a matched section in recall JSON. */
const MATCH_PREVIEW_MAX_CHARS = 1000;
/** Blocks the keyword lane may read before it has enough distinct sections. */
const KEYWORD_BLOCK_SCAN_MAX = 2_000;
/** Default batch for a repair/backfill pass. */
export const PENDING_BATCH_DEFAULT = 200;

/** A block owes a vector when no row for this model has one. */
function owesVectorSql(model?: string): { sql: string; params: string[] } {
  return {
    sql: "NOT EXISTS (SELECT 1 FROM retrieval_chunk_vectors v WHERE v.chunk_id = c.id AND v.embedding IS NOT NULL" +
      (model === undefined ? "" : " AND v.model = ?") + ")",
    params: model === undefined ? [] : [model],
  };
}

/** Blocks of live pages with a body, optionally for one page, that owe a vector. */
function owedBlocksFrom(model?: string, pageId?: number): { from: string; params: Array<string | number> } {
  const owes = owesVectorSql(model);
  return {
    from: "FROM retrieval_chunks c JOIN retrieval_results r ON r.id = c.page_id " +
      "WHERE c.level = " + LEVEL_BLOCK + " AND " + HAS_PAGE_BODY_EXPR + " AND" + LIVE_PAGE_SQL +
      " AND " + owes.sql + (pageId === undefined ? "" : " AND c.page_id = ?"),
    params: [...owes.params, ...(pageId === undefined ? [] : [pageId])],
  };
}

/** A block of a live page that still has no usable vector. */
function missingVectorFrom(model?: string): { sql: string; params: Array<string | number> } {
  const owed = owedBlocksFrom(model);
  return { sql: "SELECT COUNT(*) AS n " + owed.from, params: owed.params };
}

export interface MemorySection {
  sectionId: number;
  headingPath: string;
  /** Section body length in code points (end_offset - start_offset). */
  chars: number;
  startOffset: number;
}

export interface EnsureChunksResult {
  sections: number;
  blocks: number;
}

/**
 * Rebuild a page's sections and blocks from `retrieval_results.content`.
 *
 * Safe to call again: a row that only got its body later (the in-place fill)
 * gets its blocks now, and a changed body never leaves a stale FTS row.
 * Missing/empty content clears the page's chunks.
 */
export function ensureChunksForPage(db: Database.Database, pageId: number): EnsureChunksResult {
  const row = db
    .prepare("SELECT content, title FROM retrieval_results WHERE id = ?")
    .get(pageId) as { content: string | null; title: string | null } | undefined;
  const content = row && typeof row.content === "string" ? row.content : "";
  const chars = [...content];
  const sections = content.length > 0 ? chunkMarkdownFromChars(chars, row?.title ?? null) : [];
  const blocks = sections.reduce((n, s) => n + s.blocks.length, 0);
  // Tokenizing is the expensive half and must not run under BEGIN IMMEDIATE.
  const ftsTexts = sections.map((section) =>
    section.blocks.map((block) =>
      chunkIndexText(blockSearchText(section.headingPath, chars.slice(block.start, block.end).join(""))),
    ),
  );

  const write = db.transaction(() => {
    // Deleting the chunk rows fires retrieval_chunks_ad, which removes their
    // FTS rows; the contentless table needs no separate rebuild.
    db.prepare("DELETE FROM retrieval_chunk_vectors WHERE chunk_id IN (SELECT id FROM retrieval_chunks WHERE page_id = ?)").run(pageId);
    db.prepare("DELETE FROM retrieval_chunks WHERE page_id = ?").run(pageId);
    // A page that yields no section is still "attempted": without this marker,
    // a heading-only page would be picked up by every backfill run forever.
    db.prepare(
      "INSERT INTO retrieval_page_chunks (page_id, blocks) VALUES (?, ?) ON CONFLICT(page_id) DO UPDATE SET blocks = excluded.blocks",
    ).run(pageId, blocks);
    if (sections.length === 0) return;

    const insertSection = db.prepare(
      "INSERT INTO retrieval_chunks (page_id, parent_id, level, ord, start_offset, end_offset, heading_path) VALUES (?, NULL, " + LEVEL_SECTION + ", ?, ?, ?, ?)",
    );
    const insertBlock = db.prepare(
      "INSERT INTO retrieval_chunks (page_id, parent_id, level, ord, start_offset, end_offset, heading_path) VALUES (?, ?, " + LEVEL_BLOCK + ", ?, ?, ?, ?)",
    );
    const insertFts = db.prepare("INSERT INTO retrieval_chunks_fts (rowid, body) VALUES (?, ?)");
    sections.forEach((section, sectionOrd) => {
      const sectionId = Number(insertSection.run(
        pageId, sectionOrd, section.start, section.end, section.headingPath,
      ).lastInsertRowid);
      section.blocks.forEach((block, blockOrd) => {
        const blockId = Number(insertBlock.run(
          pageId, sectionId, blockOrd, block.start, block.end, section.headingPath,
        ).lastInsertRowid);
        insertFts.run(blockId, ftsTexts[sectionOrd]![blockOrd]!);
      });
    });
  });
  write.immediate();

  return { sections: sections.length, blocks };
}

/**
 * A live page with a body whose sections or blocks were never built (or were
 * lost). A heading-only page stores `blocks = 0` and is not retried forever.
 */
const PAGES_NEEDING_CHUNKS_SQL =
  HAS_PAGE_BODY_EXPR + " AND " + LIVE_PAGE_SQL +
  " AND NOT EXISTS (SELECT 1 FROM retrieval_page_chunks p WHERE p.page_id = r.id AND p.blocks = 0)" +
  " AND (NOT EXISTS (SELECT 1 FROM retrieval_chunks c WHERE c.page_id = r.id AND c.level = " + LEVEL_SECTION + ")" +
  " OR NOT EXISTS (SELECT 1 FROM retrieval_chunks c WHERE c.page_id = r.id AND c.level = " + LEVEL_BLOCK + ")" +
  " OR (SELECT COUNT(*) FROM retrieval_chunks c WHERE c.page_id = r.id AND c.level = " + LEVEL_BLOCK + ")" +
  "   < (SELECT p.blocks FROM retrieval_page_chunks p WHERE p.page_id = r.id))";

export interface ChunkVectorBacklog {
  /** Blocks that carry a usable vector for `model` (any model when it is omitted). */
  embedded: number;
  /** Blocks of live pages that still owe a vector for `model`. */
  pending: number;
  /** Live pages with a body whose sections or blocks are missing. */
  pagesWithoutChunks: number;
  /** The block-vector scan ceiling: beyond it, the lane is truncated. */
  vectorScanLimit: number;
}

/** Blocks that have a vector, and blocks of live pages that still owe one. */
export function chunkVectorBacklog(db: Database.Database, model?: string): ChunkVectorBacklog {
  const missing = missingVectorFrom(model);
  const pending = (db.prepare(missing.sql).get(...missing.params) as { n: number }).n;
  const embedded = (db.prepare(
    "SELECT COUNT(*) AS n FROM retrieval_chunk_vectors v " +
      "JOIN retrieval_chunks c ON c.id = v.chunk_id " +
      "JOIN retrieval_results r ON r.id = c.page_id " +
      "WHERE c.level = " + LEVEL_BLOCK + " AND v.embedding IS NOT NULL" +
      (model === undefined ? "" : " AND v.model = ?") + " AND " + HAS_PAGE_BODY_EXPR + " AND" + LIVE_PAGE_SQL,
  ).get(...(model === undefined ? [] : [model])) as { n: number }).n;
  const without = db.prepare(
    "SELECT COUNT(*) AS n FROM retrieval_results r WHERE " + PAGES_NEEDING_CHUNKS_SQL,
  ).get() as { n: number };
  return {
    embedded,
    pending,
    pagesWithoutChunks: without.n,
    vectorScanLimit: VECTOR_SCAN_MAX,
  };
}

/**
 * The durable backlog, read from a file without running the store constructor
 * (doctor must not migrate or back up just to print a number). `null` means
 * the file has not been assembled by the session store yet, or predates these
 * tables.
 */
export function readChunkVectorBacklogFile(dbPath: string, model?: string): ChunkVectorBacklog | null {
  const db = openDatabase(dbPath, { readonly: true, fileMustExist: true });
  try {
    const tables = new Set(
      (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((r) => r.name),
    );
    if (!tables.has("retrieval_chunks") || !tables.has("retrieval_page_chunks") ||
        !tables.has("retrieval_chunk_vectors") || !tables.has("retrieval_results")) return null;
    // A file first created by the task registry carries schema.sql only; the
    // session store adds the rest of its columns when it next opens the file.
    const requiredColumns: Record<string, string[]> = {
      retrieval_results: ["content", "valid_until", "quarantine", "archived", "superseded_by"],
      retrieval_chunks: ["page_id", "parent_id", "level", "start_offset", "end_offset"],
      retrieval_page_chunks: ["blocks"],
      retrieval_chunk_vectors: ["chunk_id", "embedding", "model"],
    };
    for (const [table, columns] of Object.entries(requiredColumns)) {
      const present = new Set(
        (db.prepare("PRAGMA table_info(" + table + ")").all() as Array<{ name: string }>).map((c) => c.name),
      );
      if (columns.some((column) => !present.has(column))) return null;
    }
    return chunkVectorBacklog(db, model);
  } finally {
    db.close();
  }
}

export interface PendingChunkVector {
  chunkId: number;
  headingPath: string;
  /** The block's own body, read with SQL substr so code points stay aligned. */
  text: string;
}

function chunksOwingVectors(
  db: Database.Database,
  opts: { pageId?: number; limit?: number; model?: string; afterChunkId?: number },
): PendingChunkVector[] {
  // Same builder as the backlog count: a model-aware reader also re-claims
  // blocks whose vector belongs to a previous model.
  const owed = owedBlocksFrom(opts.model, opts.pageId);
  const cursor = opts.afterChunkId === undefined ? "" : " AND c.id > ?";
  // `0` asks for nothing; only `undefined` means "no limit".
  const limit = opts.limit === undefined ? "" : " LIMIT " + Math.max(0, Math.floor(opts.limit));
  return db.prepare(
    "SELECT c.id AS chunkId, c.heading_path AS headingPath, " +
      "substr(r.content, c.start_offset + 1, c.end_offset - c.start_offset) AS text " +
      owed.from + cursor + " ORDER BY c.id" + limit,
  ).all(...owed.params, ...(opts.afterChunkId === undefined ? [] : [Math.floor(opts.afterChunkId)])) as PendingChunkVector[];
}

/** Blocks of one page that still have no vector for this model. */
export function chunksMissingVectors(db: Database.Database, pageId: number, model?: string): PendingChunkVector[] {
  return chunksOwingVectors(db, { pageId, model });
}

/** Blocks anywhere in the archive that still owe a vector, in batches. */
export function pendingChunkVectors(db: Database.Database, limit = PENDING_BATCH_DEFAULT, model?: string, afterChunkId = 0): PendingChunkVector[] {
  return chunksOwingVectors(db, { limit, model, afterChunkId });
}


/** Pages for the repair pass, in id order, after an optional cursor. */
export function pagesMissingChunks(db: Database.Database, limit = PENDING_BATCH_DEFAULT, afterId = 0): number[] {
  return (db.prepare(
    "SELECT r.id FROM retrieval_results r WHERE " + PAGES_NEEDING_CHUNKS_SQL +
      " AND r.id > ? ORDER BY r.id LIMIT ?",
  ).all(Math.floor(afterId), Math.max(0, Math.floor(limit)) as number) as Array<{ id: number }>).map((r) => r.id);
}

/** True once a page's blocks have been built (the marker survives an empty page). */
export function pageChunksBuilt(db: Database.Database, pageId: number): boolean {
  return db.prepare("SELECT 1 FROM retrieval_page_chunks WHERE page_id = ?").get(pageId) !== undefined;
}

export function insertChunkVector(db: Database.Database, chunkId: number, embedding: Float32Array, model: string): void {
  db.prepare("INSERT OR REPLACE INTO retrieval_chunk_vectors (chunk_id, embedding, model) VALUES (?, ?, ?)")
    .run(chunkId, Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength), model);
}

/**
 * Level-0 sections for a batch of pages, in reading order. One statement for
 * every page, so a recall of N hits is not N+1 queries.
 */
export function sectionsForPages(db: Database.Database, pageIds: number[]): Map<number, MemorySection[]> {
  const out = new Map<number, MemorySection[]>();
  if (pageIds.length === 0) return out;
  const rows = db.prepare(
    "SELECT id AS sectionId, page_id AS pageId, heading_path AS headingPath, " +
      "start_offset AS startOffset, end_offset AS endOffset FROM retrieval_chunks " +
      "WHERE level = " + LEVEL_SECTION + " AND page_id IN (" + pageIds.map(() => "?").join(", ") + ") " +
      "ORDER BY page_id, ord",
  ).all(...pageIds) as Array<{ sectionId: number; pageId: number; headingPath: string; startOffset: number; endOffset: number }>;
  for (const row of rows) {
    const list = out.get(row.pageId) ?? [];
    list.push({
      sectionId: row.sectionId,
      headingPath: row.headingPath,
      chars: row.endOffset - row.startOffset,
      startOffset: row.startOffset,
    });
    out.set(row.pageId, list);
  }
  return out;
}

export interface ChunkPageHit {
  pageId: number;
  sessionId: string;
  title: string | null;
  /** Text of the section that matched; null when the page has no section row. */
  matchText: string | null;
  /** The row's snippet column: usually the body's first 4000 characters, but a
   *  snippet row filled with a body later keeps its original search snippet. */
  snippet: string | null;
  /** Position in the section fusion order (higher = better); not a confidence. */
  order: number;
}

/** One section enters a list once; every lane dedupes through this. */
function pushUnique(out: number[], seen: Set<number>, sectionId: number): void {
  if (seen.has(sectionId)) return;
  seen.add(sectionId);
  out.push(sectionId);
}

/** Deduplicate blocks to their parent section, keeping fusion order. */
function sectionIds(rows: Array<{ id: number; parent_id: number | null }>): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  for (const row of rows) pushUnique(out, seen, row.parent_id ?? row.id);
  return out;
}

/** Keyword lane: block MATCH results plus the page-level LIKE fallback for lone Han characters. */
function keywordSections(db: Database.Database, query: string, limit: number): number[] {
  const terms = chunkQueryTerms(query);
  const fetchLimit = limit * CANDIDATE_SLACK;
  const out: number[] = [];
  const seen = new Set<number>();
  const push = (sectionId: number): void => pushUnique(out, seen, sectionId);

  if (terms.fts) {
    // A long page can own dozens of matching blocks in one section; page
    // through the block ranking until enough DISTINCT sections are found, so
    // the section budget is not consumed by one page's blocks.
    const pageSize = Math.max(64, Math.min(256, fetchLimit));
    for (let offset = 0; offset < KEYWORD_BLOCK_SCAN_MAX && out.length < fetchLimit; offset += pageSize) {
      const rows = db.prepare(
        "SELECT c.id, c.parent_id FROM retrieval_chunks_fts " +
          "JOIN retrieval_chunks c ON c.id = retrieval_chunks_fts.rowid " +
          "JOIN retrieval_results r ON r.id = c.page_id " +
          "WHERE retrieval_chunks_fts MATCH ? AND" + LIVE_PAGE_SQL +
          " ORDER BY bm25(retrieval_chunks_fts) LIMIT ? OFFSET ?",
      ).all(terms.fts, pageSize, offset) as Array<{ id: number; parent_id: number | null }>;
      if (rows.length === 0) break;
      for (const sectionId of sectionIds(rows)) if (out.length < fetchLimit) push(sectionId);
      if (rows.length < pageSize) break;
    }
  }

  // A lone Han character cannot be an FTS token in a bigram index. SQLite's
  // instr counts characters, the same unit as the stored offsets, so the first
  // position comes from SQL and no page body crosses into JS. Recency is the
  // order: counting occurrences would copy every matching page body in SQL.
  for (const ch of terms.singleHan) {
    if (out.length >= fetchLimit) break;
    const pages = db.prepare(
      "SELECT id, instr(content, ?) - 1 AS at " +
        "FROM retrieval_results r WHERE " + HAS_PAGE_BODY_EXPR + " AND instr(r.content, ?) > 0 AND" + LIVE_PAGE_SQL +
        " ORDER BY r.id DESC LIMIT ?",
    ).all(ch, ch, fetchLimit) as Array<{ id: number; at: number }>;
    const sectionMap = sectionsForPages(db, pages.map((p) => p.id));
    for (const page of pages) {
      const sections = sectionMap.get(page.id);
      if (!sections || sections.length === 0) continue;
      // The hit can land on a heading line or in trimmed whitespace between
      // sections; then there is no honest section to point at, so skip it.
      const hit = sections.find((s) => page.at >= s.startOffset && page.at < s.startOffset + s.chars);
      if (hit) push(hit.sectionId);
      if (out.length >= fetchLimit) break;
    }
  }
  return out;
}

/** Vector lane: cosine over block vectors of live pages, then up to their sections. */
function vectorSections(db: Database.Database, queryVector: Float32Array, limit: number, model: string): number[] {
  const rows = db.prepare(
    "SELECT c.id, c.parent_id, v.embedding FROM retrieval_chunk_vectors v " +
      "JOIN retrieval_chunks c ON c.id = v.chunk_id " +
      "JOIN retrieval_results r ON r.id = c.page_id " +
      "WHERE c.level = " + LEVEL_BLOCK + " AND v.embedding IS NOT NULL AND v.model = ? AND" + LIVE_PAGE_SQL +
      " ORDER BY c.page_id DESC LIMIT ?",
  ).all(model, VECTOR_SCAN_MAX) as Array<{ id: number; parent_id: number; embedding: Buffer }>;
  const scored = rows.map((row) => {
    const v = new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4);
    return { row, s: cosineSimilarity(queryVector, v) };
  });
  scored.sort((a, b) => b.s - a.s);
  return sectionIds(scored.slice(0, limit * CANDIDATE_SLACK).map(({ row }) => ({ id: row.id, parent_id: row.parent_id as number | null })));
}

/**
 * Search a page body through its sections.
 *
 * Keyword and vector lanes fuse at section granularity first, so a section hit
 * by several blocks appears once; the resulting page ids are ordered by their
 * best section.
 */
export function searchChunkPages(
  db: Database.Database,
  query: string,
  limit: number,
  queryVector: Float32Array | null,
  model: string | null,
): ChunkPageHit[] {
  const keyword = keywordSections(db, query, limit);
  const vector = queryVector && model ? vectorSections(db, queryVector, limit, model) : [];
  const lists = [keyword, vector].filter((l) => l.length > 0).map((l) => l.map(String));
  if (lists.length === 0) return [];
  // Same registry weights as the page-level arms: keyword fts 1.0, block
  // vector 0.5 (a semantic match is weaker than a lexical one).
  const sectionOrder: number[] = lists.length === 1
    ? lists[0]!.map(Number)
    : rrfRank(lists, FUSION_REGISTRY.k_fusion.memory, [
        FUSION_REGISTRY.weights.memory.fts,
        FUSION_REGISTRY.weights.memory.vector,
      ]).map(Number);

  const sections = sectionOrder.length === 0
    ? []
    : db.prepare(
        "SELECT id, page_id FROM retrieval_chunks WHERE id IN (" + sectionOrder.map(() => "?").join(", ") + ")",
      ).all(...sectionOrder) as Array<{ id: number; page_id: number }>;
  const sectionToPage = new Map(sections.map((s) => [s.id, s.page_id]));

  // One page appears once, at the position of its best-ranked section.
  const pageIds: number[] = [];
  const seenPages = new Set<number>();
  const bestRank = new Map<number, number>();
  const bestSection = new Map<number, number>();
  for (let i = 0; i < sectionOrder.length; i++) {
    const pageId = sectionToPage.get(sectionOrder[i]!);
    if (pageId === undefined) continue;
    if (!bestRank.has(pageId)) {
      bestRank.set(pageId, i);
      bestSection.set(pageId, sectionOrder[i]!);
    }
    if (seenPages.has(pageId)) continue;
    seenPages.add(pageId);
    pageIds.push(pageId);
    if (pageIds.length >= limit) break;
  }
  if (pageIds.length === 0) return [];

  const pages = db.prepare(
    "SELECT id, session_id AS sessionId, title, snippet FROM retrieval_results WHERE id IN (" +
      pageIds.map(() => "?").join(", ") + ")",
  ).all(...pageIds) as Array<{ id: number; sessionId: string; title: string | null; snippet: string | null }>;
  const byPage = new Map(pages.map((p) => [p.id, p]));
  // The matched section's own text, not the page opening: a hit deep in the
  // body must carry the passage that matched. Offsets are code points, which
  // is what substr counts.
  const sectionIdsForText = [...bestSection.values()];
  const texts = sectionIdsForText.length === 0
    ? []
    : db.prepare(
        "SELECT s.id, substr(r.content, s.start_offset + 1, " +
        "CASE WHEN s.end_offset - s.start_offset > " + MATCH_PREVIEW_MAX_CHARS + " THEN " + MATCH_PREVIEW_MAX_CHARS +
        " ELSE s.end_offset - s.start_offset END) AS text, " +
        "(s.end_offset - s.start_offset > " + MATCH_PREVIEW_MAX_CHARS + ") AS truncated " +
          "FROM retrieval_chunks s JOIN retrieval_results r ON r.id = s.page_id " +
          "WHERE s.id IN (" + sectionIdsForText.map(() => "?").join(", ") + ")",
      ).all(...sectionIdsForText) as Array<{ id: number; text: string; truncated: number }>;
  const textBySection = new Map(texts.map((t) => [t.id, t.truncated ? t.text + "…" : t.text]));
  const hits: ChunkPageHit[] = [];
  for (const pageId of pageIds) {
    const page = byPage.get(pageId);
    if (!page) continue;
    const rank = bestRank.get(pageId)!;
    const bestSectionId = bestSection.get(pageId)!;
    hits.push({
      pageId,
      sessionId: page.sessionId,
      title: page.title,
      matchText: textBySection.get(bestSectionId) ?? null,
      snippet: page.snippet,
      order: sectionOrder.length - rank,
    });
  }
  return hits;
}
