// Git children of the push gate and its fixtures: which repository they read
// must come from `cwd`, not from the environment they inherit.
//
// A pre-push hook in a linked worktree exports GIT_DIR, which makes git ignore
// `cwd` — a fixture's `git init` would then write into the operator's own
// checkout.

import { spawnSync } from "node:child_process";

// Design: strip every variable that can redirect a git child, `GIT_CONFIG_*`
// included, rather than pin GIT_DIR back at `cwd` — pinning one leaves the rest
// free to redirect the same write, and a `-c` value reaches the child through
// config too. Names match case-insensitively because Windows env names do: an
// exported `git_dir` must not slip past.
const REPOSITORY_POINTER_VARIABLES =
  /^GIT_(DIR|WORK_TREE|COMMON_DIR|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|CONFIG_.*)$/i;

/** A copy of `env` without the repository pointers, so `cwd` alone chooses. */
export function gitEnv(env = process.env) {
  const clean = { ...env };
  for (const key of Object.keys(clean)) {
    if (REPOSITORY_POINTER_VARIABLES.test(key)) delete clean[key];
  }
  return clean;
}

/** Run git in `root`, with the caller's repository pointers removed. */
export function gitIn(root, args) {
  return spawnSync("git", args, { cwd: root, env: gitEnv(), encoding: "utf8" });
}
