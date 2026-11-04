// Reusable helper: tighten SQLite store files to owner-only permissions.
// Extracted from apps/cli/src/db.ts so MCP and plugin server can share the
// same CWE-732 mitigation without duplicating the logic.
//
// Design: the DB holds recalled research + preferences, so it is owner-only
// (dir 0700, file 0600). Only tighten the directory when THIS call creates it:
// ANS_DB_PATH may point into cwd, $HOME or /tmp, and chmod-ing a pre-existing
// directory would strip group access from something we do not own.
//
// Best-effort throughout: Windows ignores POSIX modes and a foreign-owned
// file must not fail the command.

import { chmodSync, closeSync, existsSync, mkdirSync, openSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Ensure the directory and DB file for `dbPath` are owner-only.
 *
 * - Directory: 0700 when created by this call; pre-existing directories are
 *   left untouched (no group-permission stripping on dirs we don't own).
 * - Main DB file: created 0600 if absent; existing file tightened to 0600.
 * - Sidecar files (`-wal`, `-shm`): tightened to 0600 if present.
 *
 * Call this BEFORE the store opens the SQLite client: SQLite creates the main
 * file (and later -wal/-shm) itself, so tightening after createEngine leaves a
 * window where the file exists with the umask mode.
 */
export function ensureOwnerOnlyDb(dbPath: string): void {
  const dir = dirname(dbPath);
  const dirExisted = existsSync(dir);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (!dirExisted) {
    try { chmodSync(dir, 0o700); } catch { /* best-effort (Windows / not owner) */ }
  }
  try {
    if (!existsSync(dbPath)) closeSync(openSync(dbPath, "a", 0o600));
    chmodSync(dbPath, 0o600);
  } catch { /* best-effort */ }
  for (const sidecar of [dbPath + "-wal", dbPath + "-shm"]) {
    try { if (existsSync(sidecar)) chmodSync(sidecar, 0o600); } catch { /* best-effort */ }
  }
}
