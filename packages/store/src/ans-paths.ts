// #323: the one place the on-disk layout is decided.
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
// Old names are still READ, never written. Each resolver returns the new file
// when it exists, the old one when only that exists, and the new path
// otherwise, so an upgrade never starts from an empty config or an empty
// database. Moving the old files is `ans-layout.ts`'s job; this module only
// guarantees nothing is lost meanwhile.
//
// Builtins only, like local-service.ts: hook bundles are esbuild-bundled and
// must not pull the store index's native dependencies.

import { existsSync } from "node:fs";
import { join } from "node:path";

/** The directory name both scopes use. */
export const ANS_DIR_NAME = ".ans";
/** Pre-#323 user data root (databases, model cache, config.env). */
export const LEGACY_DATA_DIR_NAME = ".anysearch";
/** Pre-#323 user config root (config.toml, token, session, skills). */
export const LEGACY_CONFIG_DIR_NAME = ".anysearch-cli";

function homeOf(env: NodeJS.ProcessEnv): string {
  return env.USERPROFILE || env.HOME || ".";
}

/** User root: `~/.ans`. */
export function ansHomeDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(homeOf(env), ANS_DIR_NAME);
}

/** User root under an already-resolved home directory (callers that took one as an argument). */
export function ansHomeDirIn(home: string): string {
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
 * Read `next` when it exists, else `legacy` when that exists, else `next`.
 *
 * Every resolver below goes through this, which is what makes "the old file
 * still works" a property of the layout rather than a rule each caller has to
 * remember. A writer that lands on the old path is not a bug: it keeps one
 * file instead of splitting the same setting across two.
 */
export function legacyReadPath(next: string, legacy: string): string {
  if (existsSync(next)) return next;
  if (existsSync(legacy)) return legacy;
  return next;
}

// ---------------------------------------------------------------------------
// User scope
// ---------------------------------------------------------------------------

/** The durable database. */
export function ansDbPath(env: NodeJS.ProcessEnv = process.env): string {
  return legacyReadPath(
    join(ansHomeDir(env), "anysearch.db"),
    join(homeOf(env), LEGACY_DATA_DIR_NAME, "anysearch.db"),
  );
}

/** The shared project index. */
export function ansProjectIndexDbPath(env: NodeJS.ProcessEnv = process.env): string {
  return legacyReadPath(
    join(ansHomeDir(env), "project-index.db"),
    join(homeOf(env), LEGACY_DATA_DIR_NAME, "project-index.db"),
  );
}

/** Attribution calibration revisions. */
export function ansAttributionRoot(env: NodeJS.ProcessEnv = process.env): string {
  return legacyReadPath(
    join(ansHomeDir(env), "attribution-gold-revisions"),
    join(homeOf(env), LEGACY_DATA_DIR_NAME, "attribution-gold-revisions"),
  );
}

/** The CLI's persisted key=value config (`config.env`). */
export function ansConfigEnvPath(env: NodeJS.ProcessEnv = process.env): string {
  return legacyReadPath(
    join(ansHomeDir(env), "config.env"),
    join(homeOf(env), LEGACY_DATA_DIR_NAME, "config.env"),
  );
}

/** The user-level `[llm]` config. */
export function ansUserConfigPathIn(home: string): string {
  return legacyReadPath(
    join(ansHomeDirIn(home), "config.toml"),
    join(home, LEGACY_CONFIG_DIR_NAME, "config.toml"),
  );
}

/** The plaintext, owner-only provider credential file. */
export function ansCredentialsPathIn(home: string): string {
  return legacyReadPath(
    join(ansHomeDirIn(home), "credentials.json"),
    join(home, LEGACY_CONFIG_DIR_NAME, "credentials.json"),
  );
}

/** The installation's one server token. */
export function ansServerTokenPath(env: NodeJS.ProcessEnv = process.env): string {
  return legacyReadPath(
    join(ansHomeDir(env), "server-token"),
    join(homeOf(env), LEGACY_CONFIG_DIR_NAME, "server-token"),
  );
}

/** The address record the running plugin server publishes. */
export function ansServerRegistryPath(env: NodeJS.ProcessEnv = process.env): string {
  return legacyReadPath(
    join(ansHomeDir(env), "server.json"),
    join(homeOf(env), LEGACY_CONFIG_DIR_NAME, "server.json"),
  );
}

/** The observation session anchor. */
export function ansSessionPath(env: NodeJS.ProcessEnv = process.env): string {
  return legacyReadPath(
    join(ansHomeDir(env), "session"),
    join(homeOf(env), LEGACY_CONFIG_DIR_NAME, "session"),
  );
}

/** User-scope installed skills. */
export function ansUserSkillsDirIn(home: string): string {
  return legacyReadPath(
    join(ansHomeDirIn(home), "skills"),
    join(home, LEGACY_CONFIG_DIR_NAME, "skills"),
  );
}

export function ansUserSkillsDir(env: NodeJS.ProcessEnv = process.env): string {
  return ansUserSkillsDirIn(homeOf(env));
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
export function ansUserWiringDirIn(home: string): string {
  return legacyReadPath(
    join(ansHomeDirIn(home), "host-wiring"),
    join(home, LEGACY_CONFIG_DIR_NAME, "host-wiring"),
  );
}

export function ansUserWiringDir(env: NodeJS.ProcessEnv = process.env): string {
  return ansUserWiringDirIn(homeOf(env));
}

// ---------------------------------------------------------------------------
// Project scope
// ---------------------------------------------------------------------------

/** The project-level `[llm]` config, and the marker that makes a directory a project. */
export function ansProjectConfigPath(cwd: string = process.cwd()): string {
  return legacyReadPath(
    join(ansProjectDir(cwd), "config.toml"),
    join(cwd, LEGACY_DATA_DIR_NAME, "config.toml"),
  );
}

/** Project-scope installed skills. */
export function ansProjectSkillsDir(cwd: string = process.cwd()): string {
  return legacyReadPath(
    join(ansProjectDir(cwd), "skills"),
    join(cwd, LEGACY_DATA_DIR_NAME, "skills"),
  );
}

/** The hook-side URL policy cache. */
export function ansProjectPolicyPath(cwd: string = process.cwd()): string {
  return legacyReadPath(
    join(ansProjectDir(cwd), "policy.json"),
    join(cwd, LEGACY_CONFIG_DIR_NAME, "policy.json"),
  );
}

/** The headless HITL queue. */
export function ansProjectHitlPath(cwd: string = process.cwd()): string {
  return legacyReadPath(
    join(ansProjectDir(cwd), "hitl.pending"),
    join(cwd, LEGACY_CONFIG_DIR_NAME, "hitl.pending"),
  );
}

/** The user's routing-card override. */
export function ansProjectRoutingCardPath(cwd: string = process.cwd()): string {
  return legacyReadPath(
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
  return legacyReadPath(
    join(ansProjectDir(cwd), "host-wiring"),
    join(cwd, LEGACY_DATA_DIR_NAME, "host-wiring"),
  );
}
