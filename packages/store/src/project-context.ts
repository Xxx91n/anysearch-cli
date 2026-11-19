import { realpathSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { ansProjectConfigPath } from "./ans-paths.js";

export type ProjectContext =
  | { root: string; source: "git" | "config" }
  | { root: null; source: "unknown"; reason: string };

/** Resolve a local entry's workspace. This does not authorize client-supplied paths. */
export function resolveProjectContext(cwd: string = process.cwd()): ProjectContext {
  try {
    let root = realpathSync(cwd);
    if (!statSync(root).isDirectory()) throw new Error("not a directory");
    for (;;) {
      // Design: accept a worktree's .git file as well as a directory — Git
      // worktrees use files. Resolve symlinks first so aliases share an identity.
      try {
        const git = statSync(join(root, ".git"));
        if (git.isDirectory() || git.isFile()) return { root, source: "git" };
      } catch (error: any) {
        if (error?.code !== "ENOENT") throw error;
      }
      // `ansProjectConfigPath` also answers for a project that still has the
      // pre-#323 `.anysearch/config.toml`, so an existing project keeps its
      // identity across the rename.
      try {
        if (statSync(ansProjectConfigPath(root)).isFile()) return { root, source: "config" };
      } catch (error: any) {
        if (error?.code !== "ENOENT") throw error;
      }
      const parent = dirname(root);
      if (parent === root) break;
      root = parent;
    }
    return { root: null, source: "unknown", reason: "No Git root or .ans/config.toml found." };
  } catch {
    return { root: null, source: "unknown", reason: "The project directory could not be read." };
  }
}
