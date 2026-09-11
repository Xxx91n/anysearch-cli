// ADR-0056 D-006: session_id persistence layer.
//
// The .anysearch-cli/session file is the single source of truth for the
// session_id grouping anchor (mirrors systemd machine-id: generate once,
// atomic write-back, user-scoped base directory). Precedence:
//
//   ANS_SESSION_ID env (highest) -- overrides everything for ad-hoc / CI use,
//                                    never written back to disk.
//   file content                 -- if present and non-empty, used as-is.
//   fresh randomUUID()           -- first run; atomically persisted to file.
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

// readSessionId:
//   1. ANS_SESSION_ID env (if non-empty) wins and is NOT written back.
//   2. file content (if non-empty) is returned as-is.
//   3. otherwise generate + atomically persist a new id.
// Atomic-write is shared with url-policy.ts atomicWriteFile; re-implemented here
// to keep this module dependency-free (the plugin hook bundle esbuild config
// forbids importing @anysearch/store, so hook callers must inline or copy).
export function readSessionId(env: NodeJS.ProcessEnv = process.env): string {
  const envId = env[ENV_SESSION_ID];
  if (typeof envId === "string" && envId.trim().length > 0) return envId.trim();
  const file = sessionIdPath(env);
  if (existsSync(file)) {
    try {
      const v = readFileSync(file, "utf8").trim();
      if (v.length > 0) return v;
    } catch { /* fall through to fresh generate */ }
  }
  // First run (or corrupted empty file): generate and persist.
  const fresh = generateSessionId();
  try {
    mkdirSync(dirname(file), { recursive: true });
    // tmp + rename for atomicity (ADR-0055 D5 pattern).
    const tmp = file + ".tmp";
    writeFileSync(tmp, fresh, "utf8");
    renameSync(tmp, file);
  } catch {
    // Fail-open: write failures don't block core CLI flow.
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
