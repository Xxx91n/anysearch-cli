// SQLite `datetime('now')` is stored as "YYYY-MM-DD HH:MM:SS" (UTC); the
// recall/expand JSON speaks ISO-8601. One parser and one formatter, so the read
// surfaces cannot format the same column differently.

/** Parse SQLite's UTC "YYYY-MM-DD HH:MM:SS" into epoch milliseconds. */
export function parseSqliteUtc(ts: string): number {
  return Date.parse(ts.replace(" ", "T") + "Z");
}

/** ISO-8601 UTC for a stored SQLite timestamp; an unparseable value is handed back as-is. */
export function sqliteTimestampToIso(value: string | null | undefined): string | null {
  if (!value) return null;
  const ms = parseSqliteUtc(value);
  if (!Number.isFinite(ms)) return value;
  return new Date(ms).toISOString().replace(/\.\d+Z$/, "Z");
}
