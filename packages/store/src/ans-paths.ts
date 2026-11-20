// The one place the on-disk layout is decided: one directory per scope, named
// after the command (`ans`).
//
//   user     ~/.ans            (USERPROFILE on Windows, HOME elsewhere)
//   project  <project>/.ans
//
// Each resolver returns the file currently in use: the new one when it exists,
// the old pre-#323 one when only that exists, and the new path otherwise. So an
// upgrade never starts from an empty config or database, and a writer lands on
// the same file its reader does. Moving the old files is `ans-layout.ts`'s job;
// this module only guarantees nothing is lost meanwhile. Builtins only: hook
// bundles are esbuild-bundled and must not pull the store index's native
// dependencies.

import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

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

/**
 * Whether two paths name the same directory.
 *
 * Windows answers to several spellings of one directory — another drive-letter
 * case, an 8.3 short name, a junction — and comparing `join`-ed strings calls
 * those different. Callers use this to decide whether a directory IS the user
 * root, so a wrong "no" hands the user roots to the project rules.
 */
export function samePath(left: string, right: string): boolean {
  const a = canonicalPath(left);
  const b = canonicalPath(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function canonicalPath(target: string): string {
  const resolved = resolve(target);
  const missing: string[] = [];
  let head = resolved;
  for (;;) {
    try {
      // The nearest existing ancestor is what the filesystem can answer for;
      // `~/.ans` itself usually does not exist yet, and resolving only the leaf
      // would leave a junction in the parent unexpanded.
      return join(realpathSync.native(head), ...missing.reverse());
    } catch {
      const parent = dirname(head);
      if (parent === head) return resolved;
      missing.push(basename(head));
      head = parent;
    }
  }
}

function homeOf(env: NodeJS.ProcessEnv): string {
  return resolveConfigHome(undefined, env);
}

/** User root: `~/.ans`. */
export function ansHomeDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(homeOf(env), ANS_DIR_NAME);
}

/** User root for an already-resolved home directory (callers that took one as an argument). */
function ansHomeDirFor(home: string): string {
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
function pathInUse(next: string, legacy: string): string {
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
/** The provider credentials file. */
export const CREDENTIALS_FILENAME = "credentials.json";

export function ansDbPath(env: NodeJS.ProcessEnv = process.env): string {
  return pathInUse(
    join(ansHomeDir(env), ANS_DB_FILENAME),
    join(homeOf(env), LEGACY_DATA_DIR_NAME, ANS_DB_FILENAME),
  );
}

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
    join(ansHomeDirFor(home), CREDENTIALS_FILENAME),
    join(home, LEGACY_CONFIG_DIR_NAME, CREDENTIALS_FILENAME),
  );
}

export function ansServerTokenPath(env: NodeJS.ProcessEnv = process.env): string {
  return pathInUse(
    join(ansHomeDir(env), "server-token"),
    join(homeOf(env), LEGACY_CONFIG_DIR_NAME, "server-token"),
  );
}

export function ansServerRegistryPath(env: NodeJS.ProcessEnv = process.env): string {
  return pathInUse(
    join(ansHomeDir(env), "server.json"),
    join(homeOf(env), LEGACY_CONFIG_DIR_NAME, "server.json"),
  );
}

export function ansSessionPath(env: NodeJS.ProcessEnv = process.env): string {
  return pathInUse(
    join(ansHomeDir(env), "session"),
    join(homeOf(env), LEGACY_CONFIG_DIR_NAME, "session"),
  );
}

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
 * The project's own domain TOMLs, inside the layout root like everything else.
 *
 * They lived at `<project>/domains` before the rename, so the old location is
 * read while it is the only one that exists; `ans-layout.ts` moves it on the
 * next run in that project. `ANS_DOMAINS_DIR` still overrides both.
 */
export const ANS_DOMAINS_DIR_NAME = "domains";

export function ansProjectDomainsDir(cwd: string = process.cwd()): string {
  return pathInUse(
    join(ansProjectDir(cwd), ANS_DOMAINS_DIR_NAME),
    join(cwd, ANS_DOMAINS_DIR_NAME),
  );
}

/** The project-level `[llm]` config, and the marker that makes a directory a project. */
export function ansProjectConfigPath(cwd: string = process.cwd()): string {
  return pathInUse(
    join(ansProjectDir(cwd), "config.toml"),
    join(cwd, LEGACY_DATA_DIR_NAME, "config.toml"),
  );
}

export function ansProjectSkillsDir(cwd: string = process.cwd()): string {
  return pathInUse(
    join(ansProjectDir(cwd), "skills"),
    join(cwd, LEGACY_DATA_DIR_NAME, "skills"),
  );
}

export function ansProjectPolicyPath(cwd: string = process.cwd()): string {
  return pathInUse(
    join(ansProjectDir(cwd), "policy.json"),
    join(cwd, LEGACY_CONFIG_DIR_NAME, "policy.json"),
  );
}

export function ansProjectHitlPath(cwd: string = process.cwd()): string {
  return pathInUse(
    join(ansProjectDir(cwd), "hitl.pending"),
    join(cwd, LEGACY_CONFIG_DIR_NAME, "hitl.pending"),
  );
}

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

export function ansProjectWiringDir(cwd: string = process.cwd()): string {
  return pathInUse(
    join(ansProjectDir(cwd), "host-wiring"),
    join(cwd, LEGACY_DATA_DIR_NAME, "host-wiring"),
  );
}
