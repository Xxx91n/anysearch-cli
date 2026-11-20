// The move of the two old directory names into `.ans`, on every start.
//
// Small files and directories are renamed, or copied then dropped when the two
// roots sit on different volumes. Databases are never renamed: a live WAL
// database can be held open by a running server, and moving the main file out
// from under its -wal is how a database gets corrupted. They are copied with
// SQLite's own online backup (`VACUUM INTO`) and the old file stays where it is
// as the pre-upgrade copy.
//
// What cannot be moved is not lost: `ans-paths.ts` reads the old location when
// the new one is absent, so a file left behind keeps working and the next run
// retries it. The marker at ~/.ans/.layout.json records what moved, what was
// left, and why.
//
// Project scope has no marker: nothing that moves there is a database of the
// new layout's, so the move is a plain rename that is safe to retry on every
// run, and a marker file in every project would cost more than a few `stat`
// calls. A database found in one is a leftover from an older layout; it stays
// where it is, with a message saying why (see projectDatabaseNotice).
//
// This module pulls better-sqlite3 through migration-backup, so it is imported
// by the CLI, MCP and plugin-server entries only. Hook bundles stay on
// `ans-paths.ts` and read the old location directly.

import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  rmdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  ANS_DB_FILENAME,
  ANS_PROJECT_INDEX_FILENAME,
  ANS_DOMAINS_DIR_NAME,
  ansDbPath,
  ansHomeDir,
  ansProjectConfigPath,
  ansProjectIndexDbPath,
  ansProjectDir,
  samePath,
  legacyHomeDirs,
  legacyProjectDirs,
} from "./ans-paths.js";
import { adoptDatabase, opensAsDatabase, setAsideUnreadable } from "./migration-backup.js";

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
 * Whether anything wrote to this database after `since`.
 *
 * The databases run in WAL mode, so an old build's writes land in the `-wal`
 * while the main file's mtime stays put; checking only the main file would miss
 * exactly the case this warning exists for.
 */
function writtenSince(path: string, since: number): boolean {
  for (const file of [path, path + "-wal"]) {
    try {
      if (statSync(file).mtimeMs > since) return true;
    } catch { /* absent */ }
  }
  return false;
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
  // Across volumes the copy is staged beside the target and published with a
  // rename. Copying straight to `to` would leave a half-written entry under the
  // name the reader prefers when an interrupted run is retried, and the intact
  // source would then be ignored forever.
  const staging = to + "." + process.pid + ".copying";
  try {
    cpSync(from, staging, { recursive: true, errorOnExist: false, force: false });
    renameSync(staging, to);
  } catch (error) {
    try { rmSync(staging, { recursive: true, force: true }); } catch { /* best effort */ }
    throw error;
  }
  rmSync(from, { recursive: true, force: true });
  return "copied";
}

/**
 * What to say about a database found in a project's old directory.
 *
 * A leftover either way: the product keeps both databases in the user root, so
 * the new layout has no place for this file, and moving it would present stale
 * rows as live ones. The two files are pointed at by different variables, and
 * naming the wrong one would send an operator's session data into the index.
 */
function projectDatabaseNotice(path: string, entry: string, env: NodeJS.ProcessEnv): string {
  const isIndex = entry === ANS_PROJECT_INDEX_FILENAME;
  const live = isIndex ? ansProjectIndexDbPath(env) : ansDbPath(env);
  const override = isIndex ? "ANS_PROJECT_DB" : "ANS_DB_PATH";
  return "[anysearch] " + path + " 没有搬：现在这个库在 " + live + "，不在项目目录里。" +
    "这份是旧布局留下的，产品不再读它，确认不要了可以删掉，或用 " + override + " 指过去。\n";
}

/** True for a directory that is part of this product rather than a user project. */
function isProductCheckout(root: string): boolean {
  try {
    const name = (JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { name?: unknown }).name;
    return typeof name === "string" && (name === "anysearch-cli" || name.startsWith("@anysearch-cli/"));
  } catch {
    return false;
  }
}

/**
 * Move `<project>/domains` into the layout root, in one rename.
 *
 * The domain TOMLs used to sit at the project root; the move puts them with
 * everything else. It is all-or-nothing on purpose: `ans-paths.ts` picks the new
 * directory as soon as it exists, so a half-moved set would hide the TOMLs still
 * sitting in the old one. `moveEntry` stages a cross-volume copy and publishes it
 * with a rename, which keeps that promise on both paths.
 *
 * `ANS_DOMAINS_DIR` pointing at the old directory is an operator saying where the
 * domains live, so it wins over the move. A `domains/` that already exists in the
 * layout root is left alone and reported.
 *
 * Only a user project is touched: a checkout of this product ships its own
 * `domains/` as builtin source, and moving that out would break the build.
 */
function adoptProjectDomains(
  cwd: string,
  target: string,
  warn: (message: string) => void,
  env: NodeJS.ProcessEnv,
): void {
  const from = join(cwd, ANS_DOMAINS_DIR_NAME);
  const to = join(target, ANS_DOMAINS_DIR_NAME);
  if (!existsSync(from) || samePath(from, to)) return;
  if (!existsSync(join(cwd, ".git")) && !existsSync(ansProjectConfigPath(cwd))) return;
  if (isProductCheckout(cwd)) return;
  const override = env.ANS_DOMAINS_DIR?.trim();
  if (override && samePath(override, from)) return;
  if (existsSync(to)) {
    warn("[anysearch] " + from + " 没有搬：" + to + " 已经存在，保留新的那份。\n");
    return;
  }
  try {
    // The rename needs the root to exist; creating the root alone keeps the
    // reader on the old directory until the whole move lands.
    mkdirSync(target, { recursive: true });
    moveEntry(from, to);
  } catch (error) {
    warn("[anysearch] " + from + " 没有搬：" + errorText(error) + "；本次继续从旧位置读取。\n");
  }
}

/**
 * Move one project's old directories into `<project>/.ans`.
 *
 * No marker, and nothing in it that the new layout keeps at project scope, so
 * this is a plain rename that is safe to retry. A name that already exists in
 * the new directory is kept and reported, never overwritten. A database is the
 * exception: the product keeps both of them in the user root, so a file here has
 * no counterpart to move to, and renaming it would present dead rows as live
 * ones. It stays put, with a message saying so.
 */
function adoptProjectLayout(cwd: string, env: NodeJS.ProcessEnv, warn: (message: string) => void): void {
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
      // A database here has no place in the new layout and is not ours to
      // rename: a live WAL database moved out from under its -wal is the
      // corruption this module exists to avoid, and the product reads the user
      // root anyway, so a moved copy would only look live.
      if (DATABASE_SIDECAR.test(entry)) {
        warn("[anysearch] " + join(dir, entry) + " 没有搬：它是旧库的附随文件，跟着库留在原处。\n");
        continue;
      }
      if (DATABASE_ENTRIES.has(entry)) {
        warn(projectDatabaseNotice(join(dir, entry), entry, env));
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
  adoptProjectDomains(cwd, target, warn, env);
}

/**
 * Move the old directories into `.ans`: the user roots always, and
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
  if (!samePath(ansProjectDir(cwd), ansHomeDir(env))) adoptProjectLayout(cwd, env, warn);

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
  const createdHome = !existsSync(home);
  try {
    // The root holds the database, the token and the credentials file, so it is
    // owner-only by the same rule those files are. Only a root this call created
    // is tightened: an operator who widened an existing one made a choice this
    // module should not silently undo.
    mkdirSync(home, { recursive: true, mode: 0o700 });
    if (createdHome) { try { chmodSync(home, 0o700); } catch { /* Windows ACL path */ } }
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
        // A database that was already copied stays behind on purpose (it is the
        // pre-upgrade copy), so "the target exists" is the finished state here,
        // not a conflict to report on every run.
        if (DATABASE_ENTRIES.has(entry) && adopted.has(from)) {
          // The old file stays behind as the pre-upgrade copy, so a newer mtime
          // means something wrote to it after the snapshot. Those rows are not in
          // the new database, and no later run will bring them over.
          try {
            const copiedAt = recorded?.migratedAt ? Date.parse(recorded.migratedAt) : NaN;
            if (Number.isFinite(copiedAt) && writtenSince(from, copiedAt)) {
              warn(
                "[anysearch] " + from + " 在升级之后又被写过，那些内容不在 " + to +
                " 里；新的库才是现在在用的那个，旧文件确认不要了可以删掉。\n",
              );
            }
          } catch { /* stat failed: nothing to report */ }
          continue;
        }
        // A target that will not open is not a newer file to preserve: it is
        // what an interrupted snapshot left half-written. Keeping it would
        // strand the real database in the old directory forever — and `pathInUse`
        // reads the new path whenever it exists, so the reader would get the torn
        // file, not the fallback. Clear it and let the adoption below run.
        const tornDatabase = DATABASE_ENTRIES.has(entry) && !opensAsDatabase(to);
        if (!tornDatabase) {
          pending.push({ path: from, reason: "新目录里已经有同名文件，保留新的那份" });
          continue;
        }
        // Moved aside, not deleted: "will not open" also covers a lock held
        // elsewhere, a permission problem, or a second `ans` mid-publish, and
        // none of those are a file this module may destroy unread.
        try {
          const aside = setAsideUnreadable(to);
          warn("[anysearch] " + to + " 读不出来，已挪到 " + aside + "，这次重新做一份。\n");
        } catch (error) {
          pending.push({ path: from, reason: "新目录里的同名文件读不出来，也挪不开：" + errorText(error) });
          continue;
        }
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
export function ensureAnsLayoutOrExit(
  program: string,
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): void {
  try {
    ensureAnsLayout(env, undefined, cwd);
  } catch (error) {
    process.stderr.write(program + ": " + errorText(error) + "\n");
    process.exit(1);
  }
}
