// session_id persistence layer.
//
// The .ans/session file is the single source of truth for the
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
import { writeStderrSafe } from "./diagnostics.js";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { ansSessionPath } from "./ans-paths.js";

export const ENV_SESSION_ID = "ANS_SESSION_ID";

// User-scoped base directory; ~/.ans on POSIX, %USERPROFILE%/.ans on Windows.
// The session file lives at <userBase>/session (no extension) so its presence
// is enough signal that the user has at least one persisted session.
export function sessionIdPath(env: NodeJS.ProcessEnv = process.env): string {
  return ansSessionPath(env);
}

export function sessionIdBaseDir(env: NodeJS.ProcessEnv = process.env): string {
  return dirname(sessionIdPath(env));
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
      if (v.length > 0) {
        // Successful read: discard any cached temporary ID for this path.
        tempIdByAnchor.delete(resolve(file));
        return v;
      }
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
    const absFile = resolve(file);
    let tempId = tempIdByAnchor.get(absFile);
    if (!tempId) {
      tempId = generateSessionId();
      tempIdByAnchor.set(absFile, tempId);
    }
    writeStderrSafe(
      "[warn] session anchor could not be read at " + file +
      "; using a fresh observation id for this run. Set ANS_SESSION_ID to keep the same observation id.\n",
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
    // Successful write: discard any cached temporary ID for this path.
    tempIdByAnchor.delete(resolve(file));
  } catch {
    // Fail-open: say that the observation id may change on the next run.
    // Chat continuation uses its own explicit handle (#299).
    writeStderrSafe(
      "[warn] could not persist the session anchor; set ANS_SESSION_ID to a stable value or make " +
      sessionIdBaseDir(env) + " writable to keep the same observation id across runs\n",
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
  // Successful write: discard any cached temporary ID for this path.
  tempIdByAnchor.delete(resolve(file));
}
