// #323: one-time move of the pre-#323 user directories into ~/.ans.
//
// The rule, in one paragraph: on the first run after the rename, everything
// under ~/.anysearch and ~/.anysearch-cli is moved into ~/.ans. Small files and
// directories are renamed (a copy-then-verify-then-drop when the two roots sit
// on different volumes). Databases are NOT renamed: a live WAL database can be
// held open by a running server, and moving the main file out from under its
// -wal is how a database gets corrupted. They are copied with SQLite's own
// online backup (`VACUUM INTO`, the same mechanism #310 trusts) and the old
// file is left where it is as the pre-upgrade copy.
//
// What cannot be moved is not lost: `ans-paths.ts` reads the old location when
// the new one is absent, so a file left behind keeps working, and the next run
// retries it. The marker at ~/.ans/.layout.json records what moved, what was
// left, and why — so "did the rename finish" is a question with an answer on
// disk instead of a guess.
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
  renameSync,
  rmSync,
  rmdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { ansHomeDir, legacyHomeDirs } from "./ans-paths.js";
import { adoptDatabase } from "./migration-backup.js";

/** Marker file inside the user root; its presence means "the rename ran". */
export const ANS_LAYOUT_MARKER = ".layout.json";

/** Databases that must be copied, never renamed (see the header). */
const DATABASE_ENTRIES = new Set(["anysearch.db", "project-index.db"]);

/** A database's write-ahead sidecars belong to the file that stays behind. */
const DATABASE_SIDECAR = /\.db-(wal|shm)$/;

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
 * Move the pre-#323 user directories into `~/.ans`, once.
 *
 * Idempotent and self-healing: a run with nothing left to do costs two `stat`
 * calls, and an entry that could not be moved last time is retried. Returns
 * undefined when there was no old directory to begin with, so a fresh install
 * never creates `~/.ans` just to record that it had nothing to do.
 *
 * @throws only when `~/.ans` itself cannot be created — at that point nothing
 *   can be written at all, and continuing would mean silently writing nowhere.
 */
export function ensureAnsLayout(
  env: NodeJS.ProcessEnv = process.env,
  warn: (message: string) => void = (message) => process.stderr.write(message),
): AnsLayoutRecord | undefined {
  const legacy = legacyHomeDirs(env).filter((dir) => existsSync(dir));
  if (legacy.length === 0) return undefined;

  const recorded = readAnsLayoutRecord(env);
  if (recorded && recorded.pending.length === 0) return recorded;

  const home = ansHomeDir(env);
  try {
    mkdirSync(home, { recursive: true });
  } catch (error) {
    throw new Error(
      "无法创建新的配置目录 " + home + "：" + errorText(error) +
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
  const unchanged = recorded !== undefined && JSON.stringify(record) === JSON.stringify(recorded);
  if (unchanged) return record;
  try {
    writeRecord(env, record);
  } catch (error) {
    // The move already happened; failing here would make the next run redo it
    // and report every entry as "already exists". Say so instead of throwing.
    warn("[anysearch] 目录已经搬到 " + home + "，但迁移记录写不进去（" + errorText(error) + "）；不影响使用。\n");
  }

  if (pending.length > 0) {
    warn(
      "[anysearch] 有 " + pending.length + " 项旧文件没能搬进 " + home +
      "，本次继续从旧位置读取，下次运行会再试：\n" +
      pending.map((item) => "  - " + item.path + "：" + item.reason + "\n").join(""),
    );
  }
  return record;
}
