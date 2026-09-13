// Shared helper: engine backed by the durable anysearch DB (ADR-0037 D6).
// ANS_DB_PATH overrides; default ~/.anysearch/anysearch.db via kernel resolveDbPath.
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createEngine, resolveDbPath, type CompositionResult } from "@anysearch/kernel";

// ADR-0061 B1: the domains-dir resolution chain for this CLI.
//   1. ANS_DOMAINS_DIR env (a dir containing the tomls directly)
//   2. <cwd>/domains — project-local convention, wins over builtin
//   3. <pkg>/domains — builtin domains shipped inside the installed package
//      (build-time sync from the repo-root domains/)
//   4. repo-root domains — dev fallback when running from source (tsx)
export function domainSearchDirs(env: NodeJS.ProcessEnv = process.env): string[] {
  // dist/index.js is a CJS bundle (tsup) — import.meta.url is undefined there;
  // dev runs under tsx as ESM. Cover both.
  const self = typeof __dirname !== "undefined" ? __dirname : dirname(fileURLToPath(import.meta.url));
  const dirs: string[] = [];
  if (env.ANS_DOMAINS_DIR?.trim()) dirs.push(env.ANS_DOMAINS_DIR.trim());
  dirs.push(join(process.cwd(), "domains"));
  dirs.push(join(self, "..", "domains"));
  dirs.push(join(self, "..", "..", "..", "domains"));
  return dirs;
}

export function createPersistentEngine(domain?: string): CompositionResult {
  const dbPath = resolveDbPath();
  mkdirSync(dirname(dbPath), { recursive: true });
  return createEngine(domain, { dbPath, domainsDirs: domainSearchDirs() });
}
