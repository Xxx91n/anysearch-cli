// Shared helper: engine backed by the durable anysearch DB.
// ANS_DB_PATH overrides; default ~/.anysearch/anysearch.db via kernel resolveDbPath.
import { chmodSync, existsSync, mkdirSync } from "node:fs";
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
  // wider default umask a real exposure on a shared host (CWE-732). chmod is
  // best-effort: Windows ignores POSIX modes, and a pre-existing file owned by
  // someone else must not fail the command.
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { chmodSync(dir, 0o700); } catch { /* best-effort (Windows / not owner) */ }
  const result = createEngine(domain, { dbPath, domainsDirs: domainSearchDirs() });
  try { if (existsSync(dbPath)) chmodSync(dbPath, 0o600); } catch { /* best-effort */ }
  registerTeardown(() => {
    (result.store as { close?: () => void }).close?.();
    result.observation.close();
  });
  return result;
}
