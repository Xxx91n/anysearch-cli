// Shared helper: engine backed by the durable anysearch DB.
// ANS_DB_PATH overrides; default ~/.ans/anysearch.db via kernel resolveDbPath.
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createEngine, resolveDbPath, type CompositionResult } from "@anysearch-cli/kernel";
import { hostDomainsDirs, ensureOwnerOnlyDb, resolveSearchCredentials, type CredentialFileContents, type ResolvedSearchCredentials } from "@anysearch-cli/store";
import { resolveActiveDomain } from "@anysearch-cli/store/local-service";

// The CLI's domains-dir chain. The tail (repo-root vs package copy, and the
// source-checkout guard) lives in store's hostDomainsDirs.
export function domainSearchDirs(env: NodeJS.ProcessEnv = process.env): string[] {
  // dev runs under tsx and the published bundle is ESM, so import.meta.url is
  // the only source; keep the __dirname branch for a CJS-inline build.
  const self = typeof __dirname !== "undefined" ? __dirname : dirname(fileURLToPath(import.meta.url));
  return hostDomainsDirs(self, env);
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

/**
 * The search-credential seam for an engine built from the caller's one parse of
 * the user credential file: env first, then that parse, and the file is never
 * read a second time (#301). Both product assembly points use it, so "which
 * keys does this engine see" is answered in one place.
 */
export function searchCredentialSeam(
  credentialsFile?: CredentialFileContents,
): (env?: NodeJS.ProcessEnv) => ResolvedSearchCredentials {
  return (env) => resolveSearchCredentials(env, { credentialsFile });
}

export function createPersistentEngine(
  domain?: string,
  // #306: `domainDeclared: false` says the name is the caller's convention
  // default, so a missing TOML keeps the old no-filtering fallback instead of
  // stopping the command. Omitted means the name is a real declaration.
  opts?: {
    domainDeclared?: boolean;
    /**
     * Design: the caller's one parse of the user credential file, handed in
     * so this engine's search arms never read the file themselves — that caller
     * hands the same parse to its other resolver too, and reports the fault once.
     * Omitted means this engine parses the file, as it always has.
     */
    credentialsFile?: CredentialFileContents;
    /**
     * #649: this command's own wait budget, handed through to the engine
     * unchanged. Omitted keeps the engine's 4s default.
     */
    requestTimeoutMs?: number;
  },
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
  const credentialsFile = opts?.credentialsFile;
  const result = createEngine(domain, {
    dbPath,
    domainsDirs: domainSearchDirs(),
    searchCredentials: searchCredentialSeam(credentialsFile),
    ...(opts?.domainDeclared !== undefined ? { domainDeclared: opts.domainDeclared } : {}),
    ...(opts?.requestTimeoutMs !== undefined ? { requestTimeoutMs: opts.requestTimeoutMs } : {}),
  });
  registerTeardown(() => {
    (result.store as { close?: () => void }).close?.();
    result.observation.close();
  });
  return result;
}
