// SQLite `datetime('now')` is stored as "YYYY-MM-DD HH:MM:SS" (UTC); the
// recall JSON speaks ISO-8601. Kept beside the parser both callers use, so the
// two read surfaces cannot format the same column differently.

import { parseSqliteUtc } from "./consolidate.js";

/** ISO-8601 UTC for a stored SQLite timestamp; an unparseable value is handed back as-is. */
export function sqliteTimestampToIso(value: string | null | undefined): string | null {
  if (!value) return null;
  const ms = parseSqliteUtc(value);
  if (!Number.isFinite(ms)) return value;
  return new Date(ms).toISOString().replace(/\.\d+Z$/, "Z");
}
