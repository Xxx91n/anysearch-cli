// Best-effort removal of work files a killed run left next to a file it was
// publishing.
//
// Design: dependency-free — node:fs/node:path only, kept out of
// migration-backup.ts so the config resolver never loads better-sqlite3.

import { readdirSync, rmSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";

/** How old a work file must be before it cannot belong to a live run. */
export const STALE_WORK_FILE_AGE_MS = 60 * 60 * 1000;

/**
 * Drop work files a killed run left next to `target`.
 *
 * `options.suffix` is the caller's marker; `options.prefix` defaults to the
 * target's name plus a dot and is spelled out by a caller whose name differs.
 *
 * Design: one hour — far past the seconds a write holds its work file, and
 * short enough that leftovers do not pile up.
 *
 * Every failure is swallowed: cleanup must never decide whether the real write
 * happens.
 */
export function sweepStaleWorkFiles(
  target: string,
  options: { suffix: string; prefix?: string },
): void {
  const dir = dirname(target);
  const prefix = options.prefix ?? basename(target) + ".";
  const cutoff = Date.now() - STALE_WORK_FILE_AGE_MS;
  let names: string[];
  try { names = readdirSync(dir); } catch { return; }
  for (const name of names) {
    if (!name.startsWith(prefix) || !name.endsWith(options.suffix)) continue;
    const file = join(dir, name);
    try {
      if (statSync(file).mtimeMs < cutoff) {
        // recursive: the cross-volume copy stages a directory, and a plain
        // rmSync refuses directories — swallowing that would leave it forever.
        rmSync(file, { force: true, recursive: true });
      }
    } catch { /* leave it */ }
  }
}
