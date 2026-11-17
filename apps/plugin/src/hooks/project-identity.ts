// Project identity for the hook bundle.
//
// The authoritative resolver lives in packages/store/src/project-context.ts.
// Hook bundles are built with esbuild --bundle and must stay free of the store
// (its native dependencies do not bundle), so this file mirrors that resolver
// for the hook processes. The drift check lives in
// apps/plugin/test/project-scope.test.ts ("the hook copy matches the store
// resolver"), so the copy cannot quietly diverge.
//
// A hook only ever runs inside a host's working tree. If that tree is not a
// project (no Git root, no .anysearch/config.toml), the hook must say the
// project-scoped capability is unavailable instead of inventing a project or
// borrowing another one's records.
import { realpathSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

export interface HookProject {
  root: string | null;
  source: "git" | "config" | "unknown";
  /** Why the project is unknown; absent when root is a real project. */
  reason?: string;
}

export function resolveHookProject(cwd: string = process.cwd()): HookProject {
  try {
    let root = realpathSync(cwd);
    if (!statSync(root).isDirectory()) throw new Error("not a directory");
    for (;;) {
      for (const [marker, source] of [[".git", "git"], [join(".anysearch", "config.toml"), "config"]] as const) {
        try {
          const entry = statSync(join(root, marker));
          if (source === "git" ? entry.isDirectory() || entry.isFile() : entry.isFile()) return { root, source };
        } catch (error: any) {
          if (error?.code !== "ENOENT") throw error;
        }
      }
      const parent = dirname(root);
      if (parent === root) break;
      root = parent;
    }
    return { root: null, source: "unknown", reason: "No Git root or .anysearch/config.toml found." };
  } catch {
    return { root: null, source: "unknown", reason: "The project directory could not be read." };
  }
}
