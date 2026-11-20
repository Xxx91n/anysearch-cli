// Where the product keeps its user-level files, for the release and ops scripts.
//
// The product's answer is `packages/store/src/ans-paths.ts`, and this is the
// scripts' copy of just the two rules those scripts need. It exists because a
// standalone `.mjs` script cannot import a TypeScript module without a loader,
// and four scripts each spelling out the same chain is how #323 happened in the
// first place. Keep this in step with `ans-paths.ts`; nothing enforces it.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const NEW_DIR = ".ans";
const LEGACY_DATA_DIR = ".anysearch";
const LEGACY_CONFIG_DIR = ".anysearch-cli";
const ATTRIBUTION_DIR = "attribution-gold-revisions";

/** The user's home directory: USERPROFILE (Windows), else HOME, else the platform's. */
export function resolveHome(env = process.env) {
  return env.USERPROFILE || env.HOME || os.homedir();
}

/** The path currently in use: the new one when it exists, the old one when only that does. */
export function pathInUse(next, legacy) {
  if (fs.existsSync(next)) return next;
  if (fs.existsSync(legacy)) return legacy;
  return next;
}

/** The user-level database file. */
export function ansDbPath(env = process.env) {
  const home = resolveHome(env);
  return pathInUse(
    path.join(home, NEW_DIR, "anysearch.db"),
    path.join(home, LEGACY_DATA_DIR, "anysearch.db"),
  );
}

/**
 * A user-level directory under the layout root that lived in the data root before
 * the rename.
 *
 * Only the data root: `skills/` and `host-wiring/` lived under `.anysearch-cli`,
 * and the product resolves those with their own rule, so a helper that consulted
 * both old roots would answer for a directory the product never reads.
 */
export function ansDataDirPath(name, env = process.env) {
  const home = resolveHome(env);
  return pathInUse(path.join(home, NEW_DIR, name), path.join(home, LEGACY_DATA_DIR, name));
}

/** The attribution calibration revisions directory. */
export function ansAttributionRoot(env = process.env) {
  return ansDataDirPath(ATTRIBUTION_DIR, env);
}

export { NEW_DIR, LEGACY_DATA_DIR, LEGACY_CONFIG_DIR, ATTRIBUTION_DIR };
