// Project identity for the hook bundle.
//
// Design: mirror packages/store/src/project-context.ts here — hook bundles are
// built with esbuild --bundle and must stay free of the store's native
// dependencies; the drift check in project-scope.test.ts keeps the copy
// honest. The authoritative resolver lives in the store.
//
// A hook only ever runs inside a host's working tree. If that tree is not a
// project (no Git root, no .ans/config.toml), the hook must say the
// project-scoped capability is unavailable instead of inventing a project or
// borrowing another one's records.
import { realpathSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { ANS_DIR_NAME, ansHomeDir, ansProjectConfigPath, samePath } from "@anysearch-cli/store/paths";

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
      try {
        const git = statSync(join(root, ".git"));
        if (git.isDirectory() || git.isFile()) return { root, source: "git" };
      } catch (error) {
        // Only a missing marker means "keep walking"; other fs errors are real.
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
