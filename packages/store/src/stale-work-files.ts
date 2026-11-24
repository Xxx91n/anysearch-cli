// Best-effort removal of staging files a killed run left next to a file it was
// publishing. This lives apart from migration-backup.ts on purpose: that module
// pulls better-sqlite3, and the config resolver has no business loading a native
// database binding to sweep a temp file.

import { readdirSync, rmSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";

/**
 * Drop work files a killed run left next to `target`.
 *
 * Every run names its own staging file, so nothing else clears them and an
 * interrupted copy leaves a whole file's (or directory's) worth of bytes behind.
 * `options.suffix` is the caller's own marker; two names go in a bag so the
 * suffix and the prefix cannot be swapped by mistake. Only files old enough
 * that no live run can still be writing them are removed — an hour is far past
 * the seconds a write holds its temp, and still short enough that leftovers do
 * not pile up.
 *
 * `options.prefix` defaults to the target's own name plus a dot. A caller whose
 * staging name puts anything else in front of that — the config write prefixes
 * a dot — passes its exact prefix, so a sweep never widens beyond its own files.
 *
 * Every failure is swallowed on purpose: cleanup is best-effort and must never
 * decide whether the real write happens.
 */
export function sweepStaleWorkFiles(
  target: string,
  options: { suffix: string; prefix?: string },
): void {
  const dir = dirname(target);
  const prefix = options.prefix ?? basename(target) + ".";
  const cutoff = Date.now() - 60 * 60 * 1000;
  let names: string[];
  try { names = readdirSync(dir); } catch { return; }
  for (const name of names) {
    if (!name.startsWith(prefix) || !name.endsWith(options.suffix)) continue;
    const file = join(dir, name);
    try {
      if (statSync(file).mtimeMs < cutoff) rmSync(file, { force: true });
    } catch { /* leave it */ }
  }
}
