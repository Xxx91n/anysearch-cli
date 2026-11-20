// #311: what build is this, in one spelling all three entries agree on.
//
// `dist/build-info.json` travels inside the package and is written after the
// bundle, so it describes the code that is actually on disk. A process reads it
// at start and records the answer in its process row; that recorded value is
// what makes "this MCP server is still running the old build" observable from
// another process. Reading the file again later would answer "what is on disk
// now", which is the opposite question — the whole point of #311's version
// report is that the two are different during and after a switch.
//
// Kept in the shared library because the CLI, the MCP launcher and the hook
// service must not each invent their own notion of "which build". Only node
// builtins here: hook bundles are esbuild-bundled and pull in no native code.

import { readFileSync } from "node:fs";

/** The schema tag written by `apps/cli/scripts/stamp-dist.mjs`. */
export const BUILD_INFO_SCHEMA = "anysearch/installation@1";

export interface BuildInfo {
  schema: string;
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
 * file, a truncated write, or a bundle made by a tool that does not stamp. The
 * caller reports that as unknown; it must never be filled in with the version
 * of whatever happens to be on disk, which would present an old process as
 * current.
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
  if (typeof record.version !== "string" || typeof record.commit !== "string") return null;
  return {
    schema: typeof record.schema === "string" ? record.schema : BUILD_INFO_SCHEMA,
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
