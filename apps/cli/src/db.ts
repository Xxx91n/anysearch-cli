// Shared helper: engine backed by the durable anysearch DB.
// ANS_DB_PATH overrides; default ~/.anysearch/anysearch.db via kernel resolveDbPath.
import { chmodSync, closeSync, existsSync, mkdirSync, openSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createEngine, resolveDbPath, type CompositionResult } from "@anysearch-cli/kernel";
import { defaultDomainsDirs } from "@anysearch-cli/store";

// B1: the domains-dir resolution chain for this CLI.
// 1. ANS_DOMAINS_DIR env (a dir containing the tomls directly)
// 2. <cwd>/domains — project-local convention, wins over builtin
// 3. <pkg>/domains — builtin domains shipped inside the installed package
// (build-time sync from the repo-root domains/)
// 4. repo-root domains — dev fallback when running from source (tsx)
export function domainSearchDirs(env: NodeJS.ProcessEnv = process.env): string[] {
  // dist/index.js is a CJS bundle (tsup) — import.meta.url is undefined there;
  // dev runs under tsx as ESM. Cover both.
  const self = typeof __dirname !== "undefined" ? __dirname : dirname(fileURLToPath(import.meta.url));
  // Shared chain head (ANS_DOMAINS_DIR → cwd/domains) + CLI-specific tails.
  const dirs = defaultDomainsDirs(env);
  dirs.push(join(self, "..", "domains"));
  dirs.push(join(self, "..", "..", "..", "domains"));
  return dirs;
}

// Teardown registry lives in ./teardown (pure leaf).
import { registerTeardown } from "./teardown";
export function createPersistentEngine(domain?: string): CompositionResult {
  const dbPath = resolveDbPath();
  const dir = dirname(dbPath);
  // Design: the DB holds recalled research + preferences, so it is owner-only
  // (dir 0700, file 0600). #129 moved `ans chat` onto this store, which made the
  // wider default umask a real exposure on a shared host (CWE-732).
  // Only tighten the directory when THIS call creates it: ANS_DB_PATH may point
  // into cwd, $HOME or /tmp, and chmod-ing a pre-existing directory would strip
  // group access from something we do not own.
  const dirExisted = existsSync(dir);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (!dirExisted) {
    try { chmodSync(dir, 0o700); } catch { /* best-effort (Windows / not owner) */ }
  }
  // Permissions must be in place BEFORE the store opens the client: SQLite
  // creates the main file (and later -wal/-shm) itself, so tightening after
  // createEngine leaves a window where the file exists with the umask mode.
  // Create the main file 0600 up front; existing -wal/-shm are tightened too
  // because their modes persist across runs. Best-effort throughout: Windows
  // ignores POSIX modes and a foreign-owned file must not fail the command.
  try {
    if (!existsSync(dbPath)) closeSync(openSync(dbPath, "a", 0o600));
    chmodSync(dbPath, 0o600);
  } catch { /* best-effort */ }
  for (const sidecar of [dbPath + "-wal", dbPath + "-shm"]) {
    try { if (existsSync(sidecar)) chmodSync(sidecar, 0o600); } catch { /* best-effort */ }
  }
  const result = createEngine(domain, { dbPath, domainsDirs: domainSearchDirs() });
  registerTeardown(() => {
    (result.store as { close?: () => void }).close?.();
    result.observation.close();
  });
  return result;
}
