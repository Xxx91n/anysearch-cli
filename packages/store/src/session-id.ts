// session_id persistence layer.
//
// The .anysearch-cli/session file is the single source of truth for the
// session_id grouping anchor (mirrors systemd machine-id: generate once,
// atomic write-back, user-scoped base directory). Precedence:
//
// ANS_SESSION_ID env (highest) -- overrides everything for ad-hoc / CI use,
// never written back to disk.
// file content -- if present and non-empty, used as-is.
// fresh randomUUID() -- first run; atomically persisted to file.
//
// The trace store writes session_id as a write-only derived reference (see
// observation.ts); it is NEVER read back to drive identity. Failures degrade
// gracefully to empty string so core CLI/Hook/MCP paths stay fail-open.
//
// Precedent: systemd machine-id(5), K8s Lease/leader election, OPA decision log.
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const ENV_SESSION_ID = "ANS_SESSION_ID";

// User-scoped base directory; ~/.anysearch-cli on POSIX, %USERPROFILE%/.anysearch-cli
// on Windows. Mirrors packages/kernel/composition.ts resolveDbPath convention.
// The session file lives at <userBase>/session (no extension) so its presence
// is enough signal that the user has at least one persisted session.
export function sessionIdBaseDir(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.USERPROFILE || env.HOME || ".";
  return join(home, ".anysearch-cli");
}

export function sessionIdPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(sessionIdBaseDir(env), "session");
}

// Stable 32-hex session_id (same length shape as trace_id; chosen for parity
// with W3C trace_id appearance). The "session" semantic is the file-mtime
// persistence anchor, not the value's structure.
function generateSessionId(): string {
  return randomUUID().replace(/-/g, "");
}

// Process-local cache of temporary IDs for unreadable anchors.
// CodeRabbit #129 review: without this, each readSessionId() call returns a
// different ID when the anchor is unreadable, so events from one process
// can receive different session IDs. Keyed by anchor path so different
// ANS_SESSION_ID / HOME combinations don't collide.
const tempIdByAnchor = new Map<string, string>();

// Best-effort stderr write: a closed/broken stderr (e.g. the MCP parent closed
// the pipe) must not crash the process. Both synchronous write throws and
// asynchronous stream errors are absorbed. Mirrors the pattern in
// packages/kernel/src/composition.ts writeProviderDiagnostic.
// CodeRabbit #129 review: process.stderr.write can emit an asynchronous 'error'
// event that try/catch cannot capture — a broken pipe would terminate the
// process instead of continuing fail-open.
function writeStderr(message: string): void {
  const stderr = process.stderr;
  const swallow = () => {};
  stderr.once("error", swallow);
  try {
    stderr.write(message, (error) => {
      if (!error) stderr.off("error", swallow);
    });
  } catch {
    stderr.off("error", swallow);
  }
}

// readSessionId:
// 1. ANS_SESSION_ID env (if non-empty) wins and is NOT written back.
// 2. file content (if non-empty) is returned as-is.
// 3. otherwise generate + atomically persist a new id.
// Atomic-write is shared with url-policy.ts atomicWriteFile; re-implemented here
// to keep this module dependency-free (the plugin hook bundle esbuild config
// forbids importing @anysearch-cli/store, so hook callers must inline or copy).
export function readSessionId(env: NodeJS.ProcessEnv = process.env): string {
  const envId = env[ENV_SESSION_ID];
  if (typeof envId === "string" && envId.trim().length > 0) return envId.trim();
  const file = sessionIdPath(env);
  let anchorUnreadable = false;
  if (existsSync(file)) {
    try {
      const v = readFileSync(file, "utf8").trim();
      if (v.length > 0) return v;
    } catch {
      // CodeRabbit #129 review: do NOT fall through to fresh generate + write.
      // renameSync does not require write permission on the file itself, only
      // on its directory, so overwriting would silently destroy the anchor.
      // The previous session ID may still be recoverable once permissions are
      // restored; return a fresh ID for this run only.
      anchorUnreadable = true;
    }
  }
  if (anchorUnreadable) {
    // Reuse one process-local temporary ID per anchor path so events from
    // the same process share a session ID even while the anchor is unreadable.
    let tempId = tempIdByAnchor.get(file);
    if (!tempId) {
      tempId = generateSessionId();
      tempIdByAnchor.set(file, tempId);
    }
    writeStderr(
      "[warn] session anchor could not be read at " + file +
      "; using a fresh session id for this run. Set ANS_SESSION_ID to resume a session.\n",
    );
    return tempId;
  }
  // First run (or corrupted empty file): generate and persist.
  const fresh = generateSessionId();
  try {
    mkdirSync(dirname(file), { recursive: true });
    // tmp + rename for atomicity (pattern).
    const tmp = file + ".tmp";
    writeFileSync(tmp, fresh, "utf8");
    renameSync(tmp, file);
  } catch {
    // Fail-open: write failures don't block core CLI flow. #129 makes this
    // identity load-bearing for memory (a new id each run means the previous
    // run's anchors are unreachable), so say it once instead of silently
    // handing out an id that will not survive the process.
    writeStderr(
      "[warn] could not persist the session anchor; set ANS_SESSION_ID to a stable value or make " +
      sessionIdBaseDir(env) + " writable to resume memory across runs\n",
    );
  }
  return fresh;
}

// writeSessionId is exported for tests + explicit reset scenarios. Production
// callers should use readSessionId (which transparently handles first-run
// persistence). Empty input throws to prevent accidental truncation.
export function writeSessionId(value: string, env: NodeJS.ProcessEnv = process.env): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("writeSessionId: empty session id is not allowed");
  }
  const file = sessionIdPath(env);
  mkdirSync(dirname(file), { recursive: true });
  const tmp = file + ".tmp";
  writeFileSync(tmp, value.trim(), "utf8");
  renameSync(tmp, file);
}
