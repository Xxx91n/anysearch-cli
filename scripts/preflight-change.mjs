// Which files a commit or push carries. The pre-push hook hands git's refs on
// stdin; the pre-commit hook asks for the index. A plain run compares against
// origin/HEAD and adds the working tree, so a dry run sees what is still local.
//
// Design: a commit reads only the index, and an unreadable change falls back
// to the whole suite — a scratch file in the tree should not turn every commit
// into a full run, but under-selecting passes silently, which is worse than
// running too much.
//
// A reader that cannot answer returns null; the caller decides what to do.

import { spawnSync } from "node:child_process";

/** A pre-push line that cannot be read; the caller must run everything. */
export const PUSH_UNKNOWN = Symbol("unreadable push");

/** Files staged for the commit about to run. */
export function stagedFiles(root) {
  return gitPaths(root, ["diff", "--cached", "--name-only", "--no-renames", "-z"]);
}

/**
 * Files carried by the refs on a pre-push hook's stdin. Each line is
 * "<local ref> <local sha> <remote ref> <remote sha>".
 *
 * Returns null when the hook got no refs (the caller then looks at the working
 * tree) and PUSH_UNKNOWN when a ref cannot be read.
 */
export function pushedFiles(root, input) {
  const lines = String(input ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return null;

  const files = new Set();
  for (const line of lines) {
    const [localRef, localSha, remoteRef, remoteSha] = line.split(/\s+/);
    if (!localRef || !localSha || !remoteRef || !remoteSha) return PUSH_UNKNOWN;
    if (/^0+$/.test(localSha)) continue; // deleting a ref runs nothing
    const base = /^0+$/.test(remoteSha) ? gitLine(root, ["merge-base", localSha, "origin/HEAD"]) : remoteSha;
    if (!base) return PUSH_UNKNOWN; // a new branch with no known base
    const changed = gitPaths(root, ["diff", "--name-only", "--no-renames", "-z", base, localSha]);
    if (changed === null) return PUSH_UNKNOWN;
    for (const file of changed) files.add(file);
  }
  return [...files];
}

/** Everything not yet on origin/HEAD, plus the working tree and new files. */
export function localFiles(root) {
  const head = gitLine(root, ["rev-parse", "HEAD"]);
  const base = head && gitLine(root, ["merge-base", "HEAD", "origin/HEAD"]);
  if (!head || !base) return null;

  const parts = [
    gitPaths(root, ["diff", "--name-only", "--no-renames", "-z", base, head]),
    gitPaths(root, ["diff", "--name-only", "--no-renames", "-z", "HEAD"]),
    gitPaths(root, ["ls-files", "--others", "--exclude-standard", "-z"]),
  ];
  if (parts.some((part) => part === null)) return null;
  return [...new Set(parts.flat())];
}

function gitPaths(root, args) {
  const stdout = git(root, args);
  return stdout === null ? null : stdout.split("\0").filter(Boolean);
}

function gitLine(root, args) {
  const stdout = git(root, args);
  return stdout === null || stdout.trim() === "" ? null : stdout.trim();
}

function git(root, args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  return result.status === 0 ? result.stdout : null;
}
