// Shared helper: engine backed by the durable anysearch DB.
// ANS_DB_PATH overrides; default ~/.anysearch/anysearch.db via kernel resolveDbPath.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createEngine, resolveDbPath, type CompositionResult } from "@anysearch-cli/kernel";
import { defaultDomainsDirs, ensureOwnerOnlyDb, resolveSearchCredentials } from "@anysearch-cli/store";
import { resolveActiveDomain } from "@anysearch-cli/store/local-service";

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

/**
 * Engine for the command that just wants "whatever domain is in effect", with
 * the #306 rule applied: a name the operator declared must resolve, while the
 * `default` convention falling back stays legal. One spelling, so a new command
 * cannot pick up the rule half-right.
 */
export function createEngineForActiveDomain(): CompositionResult {
  const active = resolveActiveDomain();
  return createPersistentEngine(active.name, { domainDeclared: active.declared });
}

export function createPersistentEngine(
  domain?: string,
  // #306: `domainDeclared: false` says the name is the caller's convention
  // default, so a missing TOML keeps the old no-filtering fallback instead of
  // stopping the command. Omitted means the name is a real declaration.
  opts?: { domainDeclared?: boolean },
): CompositionResult {
  const dbPath = resolveDbPath();
  // Owner-only permissions (dir 0700, file 0600) — CWE-732 mitigation.
  // #129 moved `ans chat` onto this store, which made the wider default umask
  // a real exposure on a shared host. The shared helper is called BEFORE
  // createEngine so SQLite never creates files with the umask mode.
  ensureOwnerOnlyDb(dbPath);
  // #301: search keys may live in the user credential file, not only in the
  // process env — a GUI host inherits no shell env, so resolving here is what
  // makes "enter the key once" actually reach the real search clients.
  const result = createEngine(domain, {
    dbPath,
    domainsDirs: domainSearchDirs(),
    searchCredentials: resolveSearchCredentials,
    ...(opts?.domainDeclared !== undefined ? { domainDeclared: opts.domainDeclared } : {}),
  });
  registerTeardown(() => {
    (result.store as { close?: () => void }).close?.();
    result.observation.close();
  });
  return result;
}
