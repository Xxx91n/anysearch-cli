// Read a stored page back by rowid + section(s). Offsets are code points, the
// unit SQLite's substr/length use, so an emoji cannot shift the next offset.

import type Database from "better-sqlite3";
import { sanitizeText } from "@anysearch-cli/retriever";
import { HAS_PAGE_BODY_EXPR } from "./retrieval-content.js";
import { LIVE_PAGE_SQL, sectionsForPages, type MemorySection } from "./retrieval-chunks.js";
import { sqliteTimestampToIso } from "./sqlite-time.js";

/** Hard ceiling for one expansion, in code points. */
const EXPAND_MAX_CHARS = 8000;
/** How far back a cut may move to land on whitespace. */
const WHITESPACE_LOOKBACK = 200;
const ELLIPSIS = "…";

export interface MemoryExpandRequest {
  /** Positive retrieval_results id (a material row; negative ids are knowledge rows). */
  rowid: number;
  /** One section id or a list, concatenated in the order given. */
  sectionId?: number | number[];
  /** Page-level character offset; when set, sectionId is ignored. */
  offset?: number;
  /** Requested size; clamped to EXPAND_MAX_CHARS. */
  limitChars?: number;
}

export type MemoryExpandErrorCode =
  | "knowledge_row"
  | "not_found"
  | "no_content"
  | "offset_out_of_range"
  | "section_not_found";

export interface MemoryExpandSuccess {
  ok: true;
  rowid: number;
  /** Heading path of the expanded section(s), joined by " | " when several. */
  role: string;
  /** Stored URL identity (scheme-less), the same form recall hits carry. */
  url: string;
  fetchedAt: string | null;
  totalChars: number;
  /** Page-level offset of the first returned character. */
  offset: number;
  returnedChars: number;
  hasMore: boolean;
  /** Page-level offset to pass back as `offset`; null when nothing was cut. */
  nextOffset: number | null;
  truncatedBy: "limit_chars" | "oversized_section" | null;
  text: string;
}

export interface MemoryExpandFailure {
  ok: false;
  rowid: number;
  error: MemoryExpandErrorCode;
  totalChars?: number;
  sectionIds?: number[];
}

export type MemoryExpandResult = MemoryExpandSuccess | MemoryExpandFailure;

interface PageRow {
  id: number;
  url: string;
  title: string | null;
  createdAt: string;
  hasBody: number;
  totalChars: number | null;
}

/** One contiguous read from the page, with an optional heading line in front. */
interface ReadPart {
  pageStart: number;
  pageEnd: number;
  heading: string;
}

function sectionKey(input: MemoryExpandRequest["sectionId"]): { ids: number[]; bad: number[] } {
  if (input === undefined) return { ids: [], bad: [] };
  const raw = Array.isArray(input) ? input : [input];
  const seen = new Set<number>();
  const ids: number[] = [];
  const bad: number[] = [];
  for (const id of raw) {
    if (!Number.isInteger(id) || id <= 0) { bad.push(id); continue; }
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return { ids, bad };
}

/** How many characters fit, moving the cut to whitespace when one is close. */
function fitAtWhitespace(chars: string[], budget: number): number {
  if (chars.length <= budget) return chars.length;
  const hard = Math.max(0, Math.floor(budget));
  if (hard === 0) return 0;
  const floor = Math.max(0, hard - WHITESPACE_LOOKBACK);
  let cut = hard;
  for (let i = hard - 1; i >= floor; i--) {
    if (/\s/.test(chars[i]!)) { cut = i; break; }
  }
  while (cut > 0 && /\s/.test(chars[cut - 1]!)) cut--;
  return cut > 0 ? cut : hard;
}

function containingSection(sections: MemorySection[], offset: number): MemorySection | undefined {
  return sections.find((s) => offset >= s.startOffset && offset < s.startOffset + s.chars);
}

/**
 * Read one page body by rowid + section(s), or by a page-level offset.
 * Returns an `ok: false` record (never throws) for the cases the caller can
 * correct: a knowledge row, no body, an out-of-range offset, an unknown section.
 */
export function expandMemoryRow(db: Database.Database, req: MemoryExpandRequest): MemoryExpandResult {
  if (!Number.isInteger(req.rowid) || req.rowid <= 0) {
    return { ok: false, rowid: req.rowid, error: req.rowid < 0 ? "knowledge_row" : "not_found" };
  }
  const row = db.prepare(
    "SELECT r.id AS id, r.url AS url, r.title AS title, r.created_at AS createdAt, " +
    "CASE WHEN " + HAS_PAGE_BODY_EXPR + " THEN 1 ELSE 0 END AS hasBody, " +
    "length(r.content) AS totalChars FROM retrieval_results r WHERE r.id = ? AND" + LIVE_PAGE_SQL,
  ).get(req.rowid) as PageRow | undefined;
  if (!row) return { ok: false, rowid: req.rowid, error: "not_found" };
  if (row.hasBody !== 1) return { ok: false, rowid: req.rowid, error: "no_content" };
  const totalChars = row.totalChars ?? 0;
  const sections = sectionsForPages(db, [row.id]).get(row.id) ?? [];

  let parts: ReadPart[];
  let role: string;
  if (req.offset !== undefined) {
    const offset = Math.floor(req.offset);
    if (!Number.isFinite(offset) || offset < 0 || offset >= totalChars) {
      return { ok: false, rowid: row.id, error: "offset_out_of_range", totalChars };
    }
    role = containingSection(sections, offset)?.headingPath ?? row.title ?? "";
    parts = [{ pageStart: offset, pageEnd: totalChars, heading: "" }];
  } else {
    const parsed = sectionKey(req.sectionId);
    if (req.sectionId !== undefined) {
      const raw = Array.isArray(req.sectionId) ? req.sectionId : [req.sectionId];
      if (parsed.bad.length > 0) {
        return { ok: false, rowid: row.id, error: "section_not_found", totalChars, sectionIds: parsed.bad };
      }
      // The wire schema requires at least one id; a direct store caller gets
      // the same answer instead of silently falling back to the first section.
      if (raw.length === 0) return { ok: false, rowid: row.id, error: "section_not_found", totalChars, sectionIds: [] };
    }
    const ids = parsed.ids;
    if (ids.length > 0) {
      const byId = new Map(sections.map((s) => [s.sectionId, s]));
      const missing = ids.filter((id) => !byId.has(id));
      if (missing.length > 0) {
        return { ok: false, rowid: row.id, error: "section_not_found", totalChars, sectionIds: missing };
      }
      const picked = ids.map((id) => byId.get(id)!);
      role = picked.map((s) => s.headingPath).join(" | ");
      // One section comes back as its body (role names it); several get their
      // heading path in front so the pieces cannot run together.
      const prefix = picked.length > 1 ? (s: MemorySection) => s.headingPath + "\n\n" : () => "";
      parts = picked.map((s) => ({ pageStart: s.startOffset, pageEnd: s.startOffset + s.chars, heading: prefix(s) }));
    } else if (sections.length > 0) {
      const first = sections[0]!;
      role = first.headingPath;
      parts = [{ pageStart: first.startOffset, pageEnd: first.startOffset + first.chars, heading: "" }];
    } else {
      // A body with no section rows (an older row): read it from the start
      // rather than claiming there is no content.
      role = row.title ?? "";
      parts = [{ pageStart: 0, pageEnd: totalChars, heading: "" }];
    }
  }

  const requested = req.limitChars === undefined ? EXPAND_MAX_CHARS : Math.floor(req.limitChars);
  const budget = Number.isFinite(requested) ? Math.min(Math.max(1, requested), EXPAND_MAX_CHARS) : EXPAND_MAX_CHARS;
  const cappedByCaller = Number.isFinite(requested) && requested < EXPAND_MAX_CHARS;
  const truncatedBy = cappedByCaller ? "limit_chars" as const : "oversized_section" as const;

  const readText = db.prepare(
    "SELECT substr(content, ?, ?) AS text FROM retrieval_results r WHERE r.id = ? AND" + LIVE_PAGE_SQL,
  );
  let out = "";
  let used = 0;
  let nextOffset: number | null = null;
  let hasMore = false;
  let cutHappened = false;
  for (let p = 0; p < parts.length; p++) {
    const part = parts[p]!;
    if (part.pageEnd <= part.pageStart) continue;
    const heading = [...part.heading];
    const headingRoom = budget - used;
    if (heading.length > headingRoom) {
      const room = Math.max(0, headingRoom);
      out += heading.slice(0, Math.max(0, room - 1)).join("") + (room > 0 ? ELLIPSIS : "");
      if (room > 0) cutHappened = true;
      hasMore = true;
      nextOffset = part.pageStart;
      break;
    }
    out += part.heading;
    used += heading.length;
    const body = (readText.get(part.pageStart + 1, part.pageEnd - part.pageStart, row.id) as { text: string | null } | undefined)?.text ?? "";
    const chars = [...body];
    const room = budget - used;
    if (room <= 0) {
      // The heading line used the last character; the next read starts at the
      // body (offset mode has no heading), so nothing is lost or repeated.
      hasMore = true;
      nextOffset = part.pageStart;
      break;
    }
    if (chars.length <= room) {
      out += body;
      used += chars.length;
      if (used >= budget && p < parts.length - 1) {
        // A section boundary, not a cut: more sections wait, but no character
        // of this answer was dropped, so truncatedBy stays null.
        hasMore = true;
        nextOffset = parts[p + 1]!.pageStart;
        break;
      }
      continue;
    }
    // At a one-character cap the ellipsis would leave no body character and the
    // next offset would repeat this read; return one code point instead.
    const cut = room === 1 ? 1 : fitAtWhitespace(chars, room - 1);
    out += chars.slice(0, cut).join("");
    used += cut;
    if (room >= 2) {
      out += ELLIPSIS;
      used += 1;
    }
    cutHappened = true;
    nextOffset = part.pageStart + cut;
    hasMore = true;
    break;
  }

  const text = sanitizeText(out);
  return {
    ok: true,
    rowid: row.id,
    role,
    url: row.url,
    fetchedAt: sqliteTimestampToIso(row.createdAt),
    totalChars,
    offset: parts[0]!.pageStart,
    returnedChars: [...text].length,
    hasMore,
    nextOffset,
    truncatedBy: cutHappened ? truncatedBy : null,
    text,
  };
}
