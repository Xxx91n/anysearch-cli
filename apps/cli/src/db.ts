// Shared helper: engine backed by the durable anysearch DB.
// ANS_DB_PATH overrides; default ~/.anysearch/anysearch.db via kernel resolveDbPath.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createEngine, resolveDbPath, type CompositionResult } from "@anysearch-cli/kernel";
import { defaultDomainsDirs, ensureOwnerOnlyDb } from "@anysearch-cli/store";

// B1: the domains-dir resolution chain for this CLI.
// 1. ANS_DOMAINS_DIR env (a dir containing the tomls directly)
// 2. <cwd>/domains — project-local convention, wins over builtin
// 3. <pkg>/domains — builtin domains shipped inside the installed package
// (build-time sync from the repo-root domains/)
// 4. repo-root domains — dev fallback when running from source (tsx)
export function domainSearchDirs(env: NodeJS.ProcessEnv = process.env): string[] {
  // dev runs under tsx and the published bundle is ESM, so import.meta.url is
  // the only source; keep the __dirname branch for a CJS-inline build.
  const self = typeof __dirname !== "undefined" ? __dirname : dirname(fileURLToPath(import.meta.url));
  // Shared chain head (ANS_DOMAINS_DIR → cwd/domains) + CLI-specific tails.
  const dirs = defaultDomainsDirs(env);
  dirs.push(join(self, "..", "domains"));
  dirs.push(join(self, "..", "..", "..", "domains"));
  return dirs;
}

// Teardown registry lives in ./teardown (pure leaf).
import { registerTeardown } from "./teardown";

// PI session records live next to the durable DB unless ANS_PI_SESSION_DIR
// overrides. Each AnySearch session handle gets its own JSONL file (#258).
export function piSessionDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.ANS_PI_SESSION_DIR?.trim();
  if (override) return override;
  return join(dirname(resolveDbPath()), "pi-sessions");
}

// PI compaction thresholds. The defaults are PI's own; env overrides exist so a
// probe or an operator can force compaction on a small context without editing
// product code.
export function piCompactionFromEnv(env: NodeJS.ProcessEnv = process.env): { reserveTokens?: number; keepRecentTokens?: number } {
  const parse = (raw: string | undefined): number | undefined => {
    if (raw === undefined || raw.trim() === "") return undefined;
    const n = /^[0-9]+$/.test(raw) ? Number(raw) : NaN;
    return Number.isSafeInteger(n) && n > 0 ? n : undefined;
  };
  return {
    reserveTokens: parse(env.ANS_PI_COMPACTION_RESERVE_TOKENS),
    keepRecentTokens: parse(env.ANS_PI_COMPACTION_KEEP_RECENT_TOKENS),
  };
}

export function createPersistentEngine(domain?: string): CompositionResult {
  const dbPath = resolveDbPath();
  // Owner-only permissions (dir 0700, file 0600) — CWE-732 mitigation.
  // #129 moved `ans chat` onto this store, which made the wider default umask
  // a real exposure on a shared host. The shared helper is called BEFORE
  // createEngine so SQLite never creates files with the umask mode.
  ensureOwnerOnlyDb(dbPath);
  const result = createEngine(domain, { dbPath, domainsDirs: domainSearchDirs() });
  registerTeardown(() => {
    (result.store as { close?: () => void }).close?.();
    result.observation.close();
  });
  return result;
}
