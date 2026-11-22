import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { join } from "node:path";

// A fixture's git must be the repository in its own directory. `gitDir` is what
// `git rev-parse --absolute-git-dir` printed inside the fixture; a mismatch
// means an inherited repository pointer sent the fixture somewhere else.
export function assertOwnRepo(root, gitDir) {
  assert.equal(
    realpathSync.native(gitDir),
    realpathSync.native(join(root, ".git")),
    "the fixture's git is not its own repository",
  );
}
