import { realpathSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { ANS_DIR_NAME, ansHomeDir, ansProjectConfigPath, samePath } from "./ans-paths.js";

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
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
      }
      // Skip the user root: `~/.ans/config.toml` is the user's own `[llm]`
      // settings, not a project marker, and accepting it would make the home
      // directory the project of every directory above nothing.
      if (!samePath(join(root, ANS_DIR_NAME), ansHomeDir())) {
        try {
          if (statSync(ansProjectConfigPath(root)).isFile()) return { root, source: "config" };
        } catch (error) {
          if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
        }
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
