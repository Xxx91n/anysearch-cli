// #323: the one place the on-disk layout is decided.
//
// Design: one directory per scope, named after the command (`ans`), instead of
// two families that differed by a suffix — a reader that has to know which of
// `~/.anysearch` and `~/.anysearch-cli` holds a file is a reader that can
// disagree with the writer about it.
//
// Two roots, one name:
//   user     ~/.ans            (USERPROFILE on Windows, HOME elsewhere)
//   project  <project>/.ans
//
// Before #323 the same data lived in two families that differed only by a
// suffix — ~/.anysearch and ~/.anysearch-cli, ./.anysearch and ./.anysearch-cli
// — so "which directory is this file in" was a question every reader answered
// for itself. Both families now resolve to one directory per scope, and every
// file's home is named here.
//
// Each resolver returns the file currently in use: the new one when it exists,
// the old one when only that exists, and the new path otherwise. So an upgrade
// never starts from an empty config or an empty database, and a writer lands on
// the same file its reader does instead of splitting one setting across two.
// Moving the old files is `ans-layout.ts`'s job; this module only guarantees
// nothing is lost meanwhile.
//
// Builtins only, like local-service.ts: hook bundles are esbuild-bundled and
// must not pull the store index's native dependencies.

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** The directory name both scopes use. */
export const ANS_DIR_NAME = ".ans";
/** Pre-#323 user data root (databases, model cache, config.env). */
export const LEGACY_DATA_DIR_NAME = ".anysearch";
/** Pre-#323 user config root (config.toml, token, session, skills). */
export const LEGACY_CONFIG_DIR_NAME = ".anysearch-cli";

/**
 * The user config root every credential/config reader must agree on: an
 * explicit override, else USERPROFILE (Windows), else HOME, else the real home.
 *
 * One function because two readers that disagree would read different files -
 * the resolver would look for the key the writer had just stored somewhere
 * else. An exported-but-empty value falls through, matching this repo's
 * convention for "set but blank means unset".
 *
 * This resolves ONLY the env it is given. It deliberately does not reach for
 * `process.env`: a caller that passes its own env means "this env decides", and
 * borrowing the host's HOME behind its back would point a test - or a GUI host -
 * at a directory nobody in that call wrote. Callers that have no env of their
 * own pass `process.env`.
 */
export function resolveConfigHome(explicit?: string, env: NodeJS.ProcessEnv = process.env): string {
  return explicit || env.USERPROFILE || env.HOME || homedir();
}

function homeOf(env: NodeJS.ProcessEnv): string {
  return resolveConfigHome(undefined, env);
}

/** User root: `~/.ans`. */
export function ansHomeDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(homeOf(env), ANS_DIR_NAME);
}

/** User root for an already-resolved home directory (callers that took one as an argument). */
export function ansHomeDirFor(home: string): string {
  return join(home, ANS_DIR_NAME);
}

/** Project root: `<cwd>/.ans`. */
export function ansProjectDir(cwd: string = process.cwd()): string {
  return join(cwd, ANS_DIR_NAME);
}

/** The two pre-#323 user roots, data first. */
export function legacyHomeDirs(env: NodeJS.ProcessEnv = process.env): string[] {
  return [join(homeOf(env), LEGACY_DATA_DIR_NAME), join(homeOf(env), LEGACY_CONFIG_DIR_NAME)];
}

/** The two pre-#323 project roots, data first. */
export function legacyProjectDirs(cwd: string = process.cwd()): string[] {
  return [join(cwd, LEGACY_DATA_DIR_NAME), join(cwd, LEGACY_CONFIG_DIR_NAME)];
}

/**
 * The path currently in use: `next` when it exists, else `legacy` when that
 * exists, else `next`.
 *
 * Every resolver below goes through this, which is what makes "the old file
 * still works" a property of the layout rather than a rule each caller has to
 * remember. A writer that lands on the old path is not a bug: it keeps one
 * file instead of splitting the same setting across two.
 */
export function pathInUse(next: string, legacy: string): string {
  if (existsSync(next)) return next;
  if (existsSync(legacy)) return legacy;
  return next;
}

// ---------------------------------------------------------------------------
// User scope
// ---------------------------------------------------------------------------

/** The durable database's file name, shared with the migration. */
export const ANS_DB_FILENAME = "anysearch.db";
/** The shared project index's file name, shared with the migration. */
export const ANS_PROJECT_INDEX_FILENAME = "project-index.db";

/** The durable database. */
export function ansDbPath(env: NodeJS.ProcessEnv = process.env): string {
  return pathInUse(
    join(ansHomeDir(env), ANS_DB_FILENAME),
    join(homeOf(env), LEGACY_DATA_DIR_NAME, ANS_DB_FILENAME),
  );
}

/** The shared project index. */
export function ansProjectIndexDbPath(env: NodeJS.ProcessEnv = process.env): string {
  return pathInUse(
    join(ansHomeDir(env), ANS_PROJECT_INDEX_FILENAME),
    join(homeOf(env), LEGACY_DATA_DIR_NAME, ANS_PROJECT_INDEX_FILENAME),
  );
}

/** Attribution calibration revisions. */
export function ansAttributionRoot(env: NodeJS.ProcessEnv = process.env): string {
  return pathInUse(
    join(ansHomeDir(env), "attribution-gold-revisions"),
    join(homeOf(env), LEGACY_DATA_DIR_NAME, "attribution-gold-revisions"),
  );
}

/** The CLI's persisted key=value config (`config.env`). */
export function ansConfigEnvPath(env: NodeJS.ProcessEnv = process.env): string {
  return pathInUse(
    join(ansHomeDir(env), "config.env"),
    join(homeOf(env), LEGACY_DATA_DIR_NAME, "config.env"),
  );
}

/** The user-level `[llm]` config. */
export function ansUserConfigPathFor(home: string): string {
  return pathInUse(
    join(ansHomeDirFor(home), "config.toml"),
    join(home, LEGACY_CONFIG_DIR_NAME, "config.toml"),
  );
}

/** The plaintext, owner-only provider credential file. */
export function ansCredentialsPathFor(home: string): string {
  return pathInUse(
    join(ansHomeDirFor(home), "credentials.json"),
    join(home, LEGACY_CONFIG_DIR_NAME, "credentials.json"),
  );
}

/** The installation's one server token. */
export function ansServerTokenPath(env: NodeJS.ProcessEnv = process.env): string {
  return pathInUse(
    join(ansHomeDir(env), "server-token"),
    join(homeOf(env), LEGACY_CONFIG_DIR_NAME, "server-token"),
  );
}

/** The address record the running plugin server publishes. */
export function ansServerRegistryPath(env: NodeJS.ProcessEnv = process.env): string {
  return pathInUse(
    join(ansHomeDir(env), "server.json"),
    join(homeOf(env), LEGACY_CONFIG_DIR_NAME, "server.json"),
  );
}

/** The observation session anchor. */
export function ansSessionPath(env: NodeJS.ProcessEnv = process.env): string {
  return pathInUse(
    join(ansHomeDir(env), "session"),
    join(homeOf(env), LEGACY_CONFIG_DIR_NAME, "session"),
  );
}

/** User-scope installed skills. */
export function ansUserSkillsDirFor(home: string): string {
  return pathInUse(
    join(ansHomeDirFor(home), "skills"),
    join(home, LEGACY_CONFIG_DIR_NAME, "skills"),
  );
}

/** The user-level MEMORY.md projection. Regenerated, so write-only. */
export function ansUserMemoryPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(ansHomeDir(env), "MEMORY.md");
}

/** The embedding model cache. Write-only. */
export function ansModelCacheDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(ansHomeDir(env), "models");
}

/** User-scope host-wiring journal and backups. */
export function ansUserWiringDirFor(home: string): string {
  return pathInUse(
    join(ansHomeDirFor(home), "host-wiring"),
    join(home, LEGACY_CONFIG_DIR_NAME, "host-wiring"),
  );
}

/**
 * Conversation records. They live under the layout root, not beside the
 * database, so a migration that moved the directory but could not copy the
 * database still leaves history readable. The pre-#323 directory is read when
 * the new one is absent.
 */
export function ansPiSessionsDir(env: NodeJS.ProcessEnv = process.env): string {
  return pathInUse(
    join(ansHomeDir(env), "pi-sessions"),
    join(homeOf(env), LEGACY_DATA_DIR_NAME, "pi-sessions"),
  );
}

// ---------------------------------------------------------------------------
// Project scope
// ---------------------------------------------------------------------------

/**
 * The project's own domain TOMLs.
 *
 * Outside the layout root on purpose: these are files the operator writes by
 * hand, and `ans hitl --allow-url` appends to them. They keep the location they
 * had before #323 (`ANS_DOMAINS_DIR` still overrides it); the only thing this
 * module decides is that the answer is named here rather than re-derived at
 * every call site.
 */
export function ansProjectDomainsDir(cwd: string = process.cwd()): string {
  return join(cwd, "domains");
}

/** The project-level `[llm]` config, and the marker that makes a directory a project. */
export function ansProjectConfigPath(cwd: string = process.cwd()): string {
  return pathInUse(
    join(ansProjectDir(cwd), "config.toml"),
    join(cwd, LEGACY_DATA_DIR_NAME, "config.toml"),
  );
}

/** Project-scope installed skills. */
export function ansProjectSkillsDir(cwd: string = process.cwd()): string {
  return pathInUse(
    join(ansProjectDir(cwd), "skills"),
    join(cwd, LEGACY_DATA_DIR_NAME, "skills"),
  );
}

/** The hook-side URL policy cache. */
export function ansProjectPolicyPath(cwd: string = process.cwd()): string {
  return pathInUse(
    join(ansProjectDir(cwd), "policy.json"),
    join(cwd, LEGACY_CONFIG_DIR_NAME, "policy.json"),
  );
}

/** The headless HITL queue. */
export function ansProjectHitlPath(cwd: string = process.cwd()): string {
  return pathInUse(
    join(ansProjectDir(cwd), "hitl.pending"),
    join(cwd, LEGACY_CONFIG_DIR_NAME, "hitl.pending"),
  );
}

/** The user's routing-card override. */
export function ansProjectRoutingCardPath(cwd: string = process.cwd()): string {
  return pathInUse(
    join(ansProjectDir(cwd), "routing-card.json"),
    join(cwd, LEGACY_DATA_DIR_NAME, "routing-card.json"),
  );
}

/** The project-level MEMORY.md projection. Regenerated, so write-only. */
export function ansProjectMemoryPath(cwd: string = process.cwd()): string {
  return join(ansProjectDir(cwd), "MEMORY.md");
}

/** PI's per-project agent scratch directory. Write-only. */
export function ansProjectPiAgentDir(cwd: string = process.cwd()): string {
  return join(ansProjectDir(cwd), "pi-agent");
}

/** Project-scope host-wiring journal and backups. */
export function ansProjectWiringDir(cwd: string = process.cwd()): string {
  return pathInUse(
    join(ansProjectDir(cwd), "host-wiring"),
    join(cwd, LEGACY_DATA_DIR_NAME, "host-wiring"),
  );
}
