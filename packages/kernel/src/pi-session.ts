// PI session-record location, compaction thresholds, and the cross-process
// session lock windows (#258, #266).
//
// The kernel reads no env, so each host (CLI, MCP) passes its own env in. The
// contract lives here once instead of being copied into both roots.
import { dirname, join } from "node:path";
import { closeSync, openSync, readSync, readdirSync } from "node:fs";
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

// PI writes its session id in the JSONL header. Read only the bounded header:
// listAll reads every transcript and silently skips files on errors, which can
// make a restart create a second conversation under an existing handle.
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

/** Find existing PI records without filtering by the creating process's cwd. */
export async function listPiSessionRecords(dir: string): Promise<Array<{ id: string; path: string }>> {
  let files: string[];
  try { files = readdirSync(dir); }
  catch (error: any) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const records = files.filter((file) => file.endsWith(".jsonl")).map((file) => {
    const path = join(dir, file);
    return { id: readPiSessionId(path), path };
  });
  // Older releases could create duplicate keys after a cross-directory run.
  // Do not guess which copy is complete or discard either record.
  const seen = new Set<string>();
  for (const record of records) {
    if (seen.has(record.id)) throw new Error("同一个会话有多份对话记录，请先核对：" + record.id);
    seen.add(record.id);
  }
  return records;
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
