// Best-effort removal of work files a killed run left next to a file it was
// publishing.
//
// Design: no database binding — node:fs/node:path plus budget-ledger's pid
// check, kept out of migration-backup.ts so config writes never load
// better-sqlite3.

import { readdirSync, rmSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { pidIsAlive } from "./budget-ledger.js";

/** How old a work file must be before it cannot belong to a live run. */
export const STALE_WORK_FILE_AGE_MS = 60 * 60 * 1000;

/**
 * Drop work files — files or staged directories — a killed run left next to
 * `target`.
 *
 * `options.suffix` is the caller's marker; `options.prefix` defaults to the
 * target's name plus a dot and is spelled out by a caller whose name differs.
 * `options.recursive` is off unless the caller stages a directory: a plain
 * `rmSync` must not turn a name match into a whole tree deletion.
 * `options.isLive` skips a name whose owner still runs, for work named after the
 * pid that created it; `workFileOwnerIsLive` builds that check.
 *
 * Every failure is swallowed: cleanup must never decide whether the real write
 * happens.
 */
export function sweepStaleWorkFiles(
  target: string,
  options: {
    suffix: string;
    prefix?: string;
    recursive?: boolean;
    isLive?: (name: string) => boolean;
  },
): void {
  const dir = dirname(target);
  const prefix = options.prefix ?? basename(target) + ".";
  const recursive = options.recursive === true;
  const cutoff = Date.now() - STALE_WORK_FILE_AGE_MS;
  let names: string[];
  try { names = readdirSync(dir); } catch { return; }
  for (const name of names) {
    if (!name.startsWith(prefix) || !name.endsWith(options.suffix)) continue;
    if (options.isLive?.(name)) continue;
    const file = join(dir, name);
    try {
      if (!hasRecentWrite(file, recursive, cutoff)) {
        rmSync(file, { force: true, recursive });
      }
    } catch { /* leave it */ }
  }
}

/**
 * Live-owner check for a work name that ends in the pid that created it:
 * `<target>.<pid><suffix>`. The current process does not protect its own name —
 * its work is swept before it starts, and a pid reused after a crash must not
 * leave a stale entry behind.
 */
export function workFileOwnerIsLive(suffix: string): (name: string) => boolean {
  return (name) => {
    if (!name.endsWith(suffix)) return false;
    const pid = Number(name.slice(0, -suffix.length).split(".").pop());
    return Number.isInteger(pid) && pid > 0 && pid !== process.pid && pidIsAlive(pid);
  };
}

/**
 * Whether anything in the entry was written since `cutoff`. A directory's own
 * mtime does not move while children are written, so a staged copy is judged by
 * its newest child; the first fresh hit returns.
 */
function hasRecentWrite(entry: string, recursive: boolean, cutoff: number): boolean {
  const entryStat = statSync(entry);
  if (!recursive || !entryStat.isDirectory()) return entryStat.mtimeMs >= cutoff;
  if (entryStat.mtimeMs >= cutoff) return true;
  for (const name of readdirSync(entry, { recursive: true, encoding: "utf8" })) {
    try {
      if (statSync(join(entry, name)).mtimeMs >= cutoff) return true;
    } catch { /* raced */ }
  }
  return false;
}
