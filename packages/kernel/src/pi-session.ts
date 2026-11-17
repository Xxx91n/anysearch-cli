// PI session-record location, compaction thresholds, and the cross-process
// session lock windows (#258, #266).
//
// The kernel reads no env, so each host (CLI, MCP) passes its own env in. The
// contract lives here once instead of being copied into both roots.
import { dirname, join } from "node:path";
import { closeSync, openSync, readFileSync, readSync, readdirSync } from "node:fs";
import { StringDecoder } from "node:string_decoder";
import { resolveDbPath } from "./composition";
import type { SessionLockWindows } from "./session-lock";

/**
 * Directory for PI's append-only JSONL session records. Defaults to a
 * `pi-sessions/` folder next to the durable DB; `ANS_PI_SESSION_DIR` overrides.
 */
export function resolvePiSessionDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.ANS_PI_SESSION_DIR?.trim();
  if (override) return override;
  return join(dirname(resolveDbPath(env)), "pi-sessions");
}

// Design: read PI's bounded JSONL headers — listAll reads every transcript
// and silently skips files on errors, which can create a second conversation
// under an existing handle after restart.
function readPiSessionId(file: string): string {
  const fd = openSync(file, "r");
  try {
    const decoder = new StringDecoder("utf8");
    const buffer = Buffer.allocUnsafe(4096);
    const limit = 1024 * 1024;
    let scanned = 0;
    let pending = "";
    const parseLine = (line: string): string | undefined => {
      let entry: unknown;
      try { entry = JSON.parse(line); } catch { return undefined; }
      if (!entry || typeof entry !== "object" || (entry as { type?: unknown }).type !== "session" ||
          typeof (entry as { id?: unknown }).id !== "string") {
        throw new Error("会话记录的开头不是有效的会话信息：" + file);
      }
      return (entry as { id: string }).id;
    };
    while (scanned < limit) {
      const count = readSync(fd, buffer, 0, Math.min(buffer.length, limit - scanned), null);
      if (count === 0) {
        const id = parseLine(pending + decoder.end());
        if (id) return id;
        throw new Error("会话记录没有有效的会话信息：" + file);
      }
      scanned += count;
      pending += decoder.write(buffer.subarray(0, count));
      let newline: number;
      while ((newline = pending.indexOf("\n")) !== -1) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        const id = parseLine(line);
        if (id) return id;
      }
    }
    const probe = Buffer.allocUnsafe(1);
    if (readSync(fd, probe, 0, 1, null) === 0) {
      const id = parseLine(pending + decoder.end());
      if (id) return id;
    }
    throw new Error("会话记录的开头太长，无法确定会话：" + file);
  } finally { closeSync(fd); }
}

/** Scan PI headers once, without filtering by the creating process's cwd. */
export function indexPiSessionRecords(dir: string): (key: string) => string | undefined {
  let files: string[];
  try { files = readdirSync(dir); }
  catch (error: any) {
    if (error?.code === "ENOENT") return () => undefined;
    throw error;
  }
  const records = new Map<string, string[]>();
  const failures: Array<{ namedKey?: string; error: unknown }> = [];
  for (const file of files) {
    if (!file.endsWith(".jsonl")) continue;
    // Design: inspect headers even when filenames name another key — users may
    // have renamed records. An unreadable file bearing another PI key is
    // ignored for this lookup, as another process may be creating it.
    const namedKey = file.match(/_(ans-[0-9a-f]{32})\.jsonl$/)?.[1];
    const path = join(dir, file);
    try {
      const id = readPiSessionId(path);
      const matches = records.get(id) ?? [];
      matches.push(path);
      records.set(id, matches);
    } catch (error) { failures.push({ namedKey, error }); }
  }
  return (key: string) => {
    // Design: only a failure that could BE this key blocks the lookup. A
    // stray unreadable file with no name (or another session's name) says
    // nothing about this session, and letting it fail every lookup would stop
    // brand-new chats over a file they never touch — the runtime asks this
    // same question for a first run.
    const failure = failures.find((item) => item.namedKey === key);
    if (failure) throw failure.error;
    const matches = records.get(key) ?? [];
    // Design: reject duplicate keys — choosing one can hide part of a chat.
    if (matches.length > 1) throw new Error("同一个会话有多份对话记录，请先核对：" + key);
    return matches[0];
  };
}

/** Find one PI record; check again under the caller's session lock before use. */
export function findPiSessionRecord(dir: string, key: string): string | undefined {
  return indexPiSessionRecords(dir)(key);
}

/**
 * Whether a record's message lines all parse, so a resume does not silently
 * become a resume of a shorter history.
 *
 * PI's own loader skips a malformed line and keeps the rest, which is the right
 * behaviour for reading an append-only log and the wrong behaviour for
 * RESURRECTING a conversation: the model would answer as if the missing turn
 * never happened. This check is deliberately narrow — one question, "is the
 * whole file readable as JSON lines?" — and does not judge versions, identity,
 * or a torn tail; that fuller judgment is #316's job and reads this same file.
 *
 * A trailing line without its newline is the tail of an interrupted append. PI
 * itself repairs that with a newline rather than truncating, and the entry it
 * carries is incomplete, so it is reported as a problem here: the safe answer
 * for "can I resume this?" is no.
 */
export function readPiSessionRecord(path: string): { ok: true } | { ok: false; reason: string } {
  let text: string;
  try { text = readFileSync(path, "utf8"); }
  catch (e: any) { return { ok: false, reason: "会话记录读不出来：" + (e?.message || String(e)) }; }
  if (!text.trim()) return { ok: false, reason: "会话记录是空的，没有可以续的内容" };
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    // Check the torn tail BEFORE parsing it: a half-written last line is a
    // half-written line whether or not the bytes happen to parse as JSON, and
    // "last line was not finished" is the accurate thing to say about it.
    // A non-empty last segment with no terminating newline is exactly that.
    if (i === lines.length - 1 && !text.endsWith("\n")) {
      return { ok: false, reason: "会话记录最后一行没有写完（第 " + (i + 1) + " 行）" };
    }
    try { JSON.parse(line); }
    catch { return { ok: false, reason: "会话记录第 " + (i + 1) + " 行无法解析" }; }
  }
  return { ok: true };
}

/**
 * Positive-integer env value, or undefined. An unparsable, zero, or negative
 * value stays undefined so the caller's default applies — never a silent 0.
 */
function positiveIntFromEnv(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  const n = /^[0-9]+$/.test(raw) ? Number(raw) : NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : undefined;
}

/**
 * PI compaction thresholds. The defaults are PI's own; the env overrides exist
 * so a probe or an operator can force compaction on a small context without
 * editing product code. An unparsable value stays undefined (PI's default
 * applies) rather than silently becoming 0.
 */
export function piCompactionFromEnv(env: NodeJS.ProcessEnv = process.env): { reserveTokens?: number; keepRecentTokens?: number } {
  return {
    reserveTokens: positiveIntFromEnv(env.ANS_PI_COMPACTION_RESERVE_TOKENS),
    keepRecentTokens: positiveIntFromEnv(env.ANS_PI_COMPACTION_KEEP_RECENT_TOKENS),
  };
}

/**
 * Cross-process session lock windows (#266). `ANS_PI_LOCK_STALE_MS` bounds how
 * long a lock whose owner this machine cannot confirm is kept (default
 * 10 min); `ANS_PI_LOCK_TIMEOUT_MS` is the same-session wait cap before the
 * run fails with "session busy" (default 120 s). Both exist so tests can
 * observe expiry and recovery in seconds; an unparsable or non-positive value
 * keeps the default rather than silently becoming 0.
 */
export function sessionLockWindowsFromEnv(env: NodeJS.ProcessEnv = process.env): SessionLockWindows {
  const windows: SessionLockWindows = {};
  const staleMs = positiveIntFromEnv(env.ANS_PI_LOCK_STALE_MS);
  const waitMs = positiveIntFromEnv(env.ANS_PI_LOCK_TIMEOUT_MS);
  if (staleMs !== undefined) windows.staleMs = staleMs;
  if (waitMs !== undefined) windows.waitMs = waitMs;
  return windows;
}

/**
 * The PI wiring every host owes the runtime, resolved from one env snapshot:
 * where the session records live, how PI compacts, the credential the provider
 * registration needs, and the working directory the session and resource loader
 * use. Both roots call this, so the contract has one definition instead of two
 * copies drifting apart (#258).
 */
export function piSessionOptions(
  sessionId: string | undefined,
  apiKey: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): { piSessionDir?: string; piCompaction: { reserveTokens?: number; keepRecentTokens?: number }; sessionLock: SessionLockWindows; apiKey?: string; cwd: string } {
  return {
    // No handle means no record to key on, so the session stays in memory.
    piSessionDir: sessionId ? resolvePiSessionDir(env) : undefined,
    piCompaction: piCompactionFromEnv(env),
    sessionLock: sessionLockWindowsFromEnv(env),
    apiKey,
    cwd,
  };
}
