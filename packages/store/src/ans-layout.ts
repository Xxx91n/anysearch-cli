// #323: one-time move of the pre-#323 directories into `.ans`.
//
// Design: move the old directories once, at the entry points, instead of
// teaching every reader two names — a reader that has to try two paths is a
// reader that can disagree with the writer about which one is live.
//
// The rule, in one paragraph: on the first run after the rename, everything
// under ~/.anysearch and ~/.anysearch-cli is moved into ~/.ans, and everything
// under <project>/.anysearch and <project>/.anysearch-cli is moved into
// <project>/.ans. Small files and directories are renamed (a copy-then-drop
// when the two roots sit on different volumes). Databases are NOT renamed: a
// live WAL database can be held open by a running server, and moving the main
// file out from under its -wal is how a database gets corrupted. They are
// copied with SQLite's own online backup (`VACUUM INTO`, the same mechanism
// #310 trusts) and the old file is left where it is as the pre-upgrade copy.
//
// What cannot be moved is not lost: `ans-paths.ts` reads the old location when
// the new one is absent, so a file left behind keeps working, and the next run
// retries it. The marker at ~/.ans/.layout.json records what moved, what was
// left, and why — so "did the rename finish" is a question with an answer on
// disk instead of a guess.
//
// Project scope has no marker: a project directory holds no database, so the
// move is a plain rename that is safe to retry on every run, and a marker file
// in every project would be a worse trade than a few `stat` calls.
//
// This module pulls better-sqlite3 through migration-backup, so it is imported
// by the CLI, MCP and plugin-server entries only. Hook bundles stay on
// `ans-paths.ts` and read the old location directly.

import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  rmdirSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import {
  ANS_DB_FILENAME,
  ANS_PROJECT_INDEX_FILENAME,
  ansHomeDir,
  ansProjectDir,
  legacyHomeDirs,
  legacyProjectDirs,
} from "./ans-paths.js";
import { adoptDatabase } from "./migration-backup.js";

/** Marker file inside the user root; its presence means "the rename ran". */
export const ANS_LAYOUT_MARKER = ".layout.json";

/** Databases that must be copied, never renamed (see the header). */
const DATABASE_ENTRIES = new Set([ANS_DB_FILENAME, ANS_PROJECT_INDEX_FILENAME]);

/**
 * The files a live SQLite connection keeps next to the main one. They belong to
 * the file that stays behind: `-journal` is the rollback-mode equivalent of
 * `-wal`, and moving it away from its database is the same corruption.
 */
const DATABASE_SIDECAR = /\.db-(wal|shm|journal)$/;

export interface AnsLayoutMove {
  from: string;
  to: string;
  /** `moved`/`copied` for a rename or a cross-volume copy; `snapshot` for a database. */
  how: "moved" | "copied" | "snapshot";
}

export interface AnsLayoutPending {
  /** The old path that is still in use. */
  path: string;
  /** Why it was not moved, in the operator's words. */
  reason: string;
}

export interface AnsLayoutRecord {
  version: 1;
  migratedAt: string;
  moved: AnsLayoutMove[];
  pending: AnsLayoutPending[];
}

export function ansLayoutMarkerPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(ansHomeDir(env), ANS_LAYOUT_MARKER);
}

/** The recorded outcome, or undefined when the rename has not run here. */
export function readAnsLayoutRecord(env: NodeJS.ProcessEnv = process.env): AnsLayoutRecord | undefined {
  try {
    const parsed = JSON.parse(readFileSync(ansLayoutMarkerPath(env), "utf8")) as AnsLayoutRecord;
    if (parsed?.version !== 1 || !Array.isArray(parsed.moved) || !Array.isArray(parsed.pending)) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

function writeRecord(env: NodeJS.ProcessEnv, record: AnsLayoutRecord): void {
  const target = ansLayoutMarkerPath(env);
  const tmp = target + "." + process.pid + ".tmp";
  writeFileSync(tmp, JSON.stringify(record, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
  renameSync(tmp, target);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Whether two paths name the same directory.
 *
 * The layout guard asks "is this cwd the home directory", and on Windows the
 * same directory answers to several spellings: a drive letter in another case,
 * an 8.3 short name (`ADMINI~1`), a junction. Comparing `join`-ed strings calls
 * those different, and a wrong "not the home directory" verdict hands the user
 * roots to the project pass, which renames a database instead of snapshotting
 * it. `realpath` asks the filesystem; the case fold covers a path that does not
 * exist yet, where `realpath` has nothing to canonicalize.
 */
function sameDir(left: string, right: string): boolean {
  const a = canonicalPath(left);
  const b = canonicalPath(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function canonicalPath(target: string): string {
  try {
    return realpathSync.native(target);
  } catch {
    return resolve(target);
  }
}

/**
 * Rename one entry, falling back to a copy when the two roots are on different
 * volumes. A copy that cannot be completed leaves the source untouched.
 */
function moveEntry(from: string, to: string): "moved" | "copied" {
  try {
    renameSync(from, to);
    return "moved";
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "EXDEV") throw error;
  }
  cpSync(from, to, { recursive: true, errorOnExist: true, force: false });
  rmSync(from, { recursive: true, force: true });
  return "copied";
}

/**
 * Move one project's pre-#323 directories into `<project>/.ans`.
 *
 * No marker and no database of its own: a project directory holds neither, so
 * this is a plain rename that is safe to retry. A name that already exists in
 * the new directory is kept and reported, never overwritten. A database found
 * here is a leftover: the product keeps the project index in the user root, so
 * it has no counterpart in the new layout and moving it would present dead rows
 * as live ones. It stays put, with a message saying so.
 */
function adoptProjectLayout(cwd: string, warn: (message: string) => void): void {
  const target = ansProjectDir(cwd);
  for (const dir of legacyProjectDirs(cwd)) {
    if (!existsSync(dir)) continue;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch (error) {
      warn("[anysearch] 读不出 " + dir + "：" + errorText(error) + "；本次继续从旧位置读取。\n");
      continue;
    }
    for (const entry of entries) {
      // A project directory holds no database. If one is here anyway, it is not
      // ours to rename: a live WAL database moved out from under its -wal is
      // the corruption this module exists to avoid.
      if (DATABASE_ENTRIES.has(entry) || DATABASE_SIDECAR.test(entry)) {
        warn(
          "[anysearch] " + join(dir, entry) + " 没有搬：新的索引库在 ~/.ans/project-index.db，" +
          "按项目分列，不在项目目录里。这份是旧布局留下的，产品不再读它，" +
          "确认不要了可以删掉，或用 ANS_PROJECT_DB 指过去。\n",
        );
        continue;
      }
      const from = join(dir, entry);
      const to = join(target, entry);
      if (existsSync(to)) {
        warn("[anysearch] " + from + " 没有搬：新目录里已经有同名文件，保留新的那份。\n");
        continue;
      }
      try {
        mkdirSync(target, { recursive: true });
        moveEntry(from, to);
      } catch (error) {
        warn("[anysearch] " + from + " 没有搬：" + errorText(error) + "；本次继续从旧位置读取。\n");
      }
    }
    try { rmdirSync(dir); } catch { /* not empty, or already gone */ }
  }
}

/**
 * Move the pre-#323 directories into `.ans`, once: the user roots always, and
 * the current project's roots when `cwd` names one.
 *
 * Idempotent and self-healing: a run with nothing left to do costs a handful of
 * `stat` calls, and an entry that could not be moved last time is retried.
 * Returns undefined when there was no old user directory to begin with, so a
 * fresh install never creates `~/.ans` just to record that it had nothing to do.
 *
 * @throws only when `~/.ans` itself cannot be created — at that point nothing
 *   can be written at all, and continuing would mean silently writing nowhere.
 */
export function ensureAnsLayout(
  env: NodeJS.ProcessEnv = process.env,
  warn: (message: string) => void = (message) => process.stderr.write(message),
  cwd: string = process.cwd(),
): AnsLayoutRecord | undefined {
  // `ans` run from the home directory is a normal thing to do, and there the
  // project roots ARE the user roots. Letting the project pass handle them would
  // rename the databases instead of snapshotting them — the one thing this
  // module exists to prevent — so the user branch owns that case.
  if (!sameDir(ansProjectDir(cwd), ansHomeDir(env))) adoptProjectLayout(cwd, warn);

  const legacy = legacyHomeDirs(env).filter((dir) => existsSync(dir));
  if (legacy.length === 0) return undefined;

  // No "already recorded, skip the scan" shortcut. The record describes what
  // the move found, not a promise that the old directory stays empty: an older
  // `ans` on the same machine, or a tool that still writes `~/.anysearch`, can
  // drop a file there after the marker exists. A skipped scan would leave that
  // file unmigrated forever, which for a database means the snapshot this
  // module exists to take never happens. The scan itself is the steady-state
  // fast path — both directories are gone after a clean move, so the loop below
  // costs two `existsSync` calls and the `unchanged` check keeps the marker
  // from being rewritten.
  const recorded = readAnsLayoutRecord(env);

  const home = ansHomeDir(env);
  try {
    mkdirSync(home, { recursive: true });
  } catch (error) {
    throw new Error(
      "无法创建配置根 " + home + "：" + errorText(error) +
      "。旧目录 " + legacy.join("、") + " 原样保留，没有丢任何东西；" +
      "修好这个目录的写权限后重新运行即可。",
      { cause: error },
    );
  }

  // A database that was already copied stays behind on purpose (it is the
  // pre-upgrade copy), so "the target exists" is the finished state for it, not
  // a conflict to report on every run.
  const adopted = new Set((recorded?.moved ?? []).filter((m) => m.how === "snapshot").map((m) => m.from));
  const moved: AnsLayoutMove[] = [...(recorded?.moved ?? [])];
  const pending: AnsLayoutPending[] = [];

  for (const dir of legacy) {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch (error) {
      pending.push({ path: dir, reason: "读不出这个目录：" + errorText(error) });
      continue;
    }
    for (const entry of entries) {
      if (DATABASE_SIDECAR.test(entry)) continue;
      const from = join(dir, entry);
      const to = join(home, entry);
      if (existsSync(to)) {
        if (DATABASE_ENTRIES.has(entry) && adopted.has(from)) continue;
        pending.push({ path: from, reason: "新目录里已经有同名文件，保留新的那份" });
        continue;
      }
      try {
        if (DATABASE_ENTRIES.has(entry)) {
          adoptDatabase(from, to);
          moved.push({ from, to, how: "snapshot" });
        } else {
          moved.push({ from, to, how: moveEntry(from, to) });
        }
      } catch (error) {
        pending.push({ path: from, reason: errorText(error) });
      }
    }
    // Only an emptied directory goes away; anything left behind keeps its home.
    try { rmdirSync(dir); } catch { /* not empty, or already gone */ }
  }

  const record: AnsLayoutRecord = {
    version: 1,
    migratedAt: recorded?.migratedAt ?? new Date().toISOString(),
    moved,
    pending,
  };
  // The warning goes before the "nothing changed" shortcut: an entry that could
  // not be moved produces the same record every run, so short-circuiting first
  // would report it once and then go quiet while the file was still unmigrated.
  if (pending.length > 0) {
    warn(
      "[anysearch] 有 " + pending.length + " 项旧文件没能搬进 " + home +
      "，本次继续从旧位置读取，下次运行会再试：\n" +
      pending.map((item) => "  - " + item.path + "：" + item.reason + "\n").join(""),
    );
  }

  const unchanged = recorded !== undefined && JSON.stringify(record) === JSON.stringify(recorded);
  if (unchanged) return record;
  try {
    writeRecord(env, record);
  } catch (error) {
    // The move already happened; failing here would make the next run redo it
    // and report every entry as "already exists". Say so instead of throwing.
    warn("[anysearch] 目录已经搬到 " + home + "，但迁移记录写不进去（" + errorText(error) + "）；不影响使用。\n");
  }
  return record;
}

/**
 * Run the migration, or stop the process with a message naming `program`.
 *
 * One helper because the three entry points (CLI, MCP, plugin server) must fail
 * the same way: a layout that could not be established is not something to
 * carry on past, and three hand-written copies of that decision drift.
 */
export function ensureAnsLayoutOrExit(program: string, env: NodeJS.ProcessEnv = process.env): void {
  try {
    ensureAnsLayout(env);
  } catch (error) {
    process.stderr.write(program + ": " + errorText(error) + "\n");
    process.exit(1);
  }
}
