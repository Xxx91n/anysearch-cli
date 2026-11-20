// #311: what build is on disk, in one spelling all four entries agree on.
//
// `dist/build-info.json` is written after the bundle, so it describes the code
// that actually ships. A process reads it once at start and records the answer
// in its process row; reading it again later answers "what is on disk now",
// which is the opposite question during and after a switch.
//
// Shared because the CLI, the MCP launcher and the hook service must not each
// invent their own notion of "which build". Only node builtins: hook bundles
// are esbuild-bundled and pull in no native code.

import { readFileSync } from "node:fs";

/** The schema tag written by `apps/cli/scripts/stamp-dist.mjs`. */
export const BUILD_INFO_SCHEMA = "anysearch/installation@1";

export interface BuildInfo {
  /** Absent in a build stamped before this field existed. */
  packageName?: string;
  version: string;
  /** Full 40-hex commit, or `nogit` for a build made outside a checkout. */
  commit: string;
  /** `null` when git could not be asked at build time. */
  dirty: boolean | null;
  /**
   * When the bundle was stamped, ISO-8601. `null` for a build made before this
   * field existed, which is exactly the case a reader must not guess about: an
   * unknown build time is reported as unknown, never as "just now".
   */
  builtAt: string | null;
}

/**
 * Read one build-info file, or `null` when it is absent or unusable.
 *
 * `null` is the honest answer for "this build never recorded itself": a missing
 * file, a truncated write, a bundle made by a tool that does not stamp, or a
 * file stamped by some other product. The caller reports that as unknown; it
 * must never be filled in with the version of whatever happens to be on disk,
 * which would present an old process as current.
 */
export function readBuildInfo(file: string): BuildInfo | null {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  // The tag is how this file says it is ours. A different (or missing) tag means
  // someone else's file, and reporting its version would describe the wrong
  // program.
  if (record.schema !== BUILD_INFO_SCHEMA) return null;
  if (typeof record.version !== "string" || typeof record.commit !== "string") return null;
  return {
    ...(typeof record.packageName === "string" ? { packageName: record.packageName } : {}),
    version: record.version,
    commit: record.commit,
    dirty: typeof record.dirty === "boolean" ? record.dirty : null,
    builtAt: typeof record.builtAt === "string" ? record.builtAt : null,
  };
}

/**
 * A short, stable label for one build: `0.2.0+cbefccab` (plus `-dirty`).
 *
 * Short on purpose — it goes into a process record and into one line of
 * terminal output. Two builds that differ only past the eighth commit
 * character are not a case an upgrade report has to separate.
 */
export function buildId(info: BuildInfo): string {
  const commit = info.commit === "nogit" ? "nogit" : info.commit.slice(0, 8);
  return info.version + "+" + commit + (info.dirty ? "-dirty" : "");
}
