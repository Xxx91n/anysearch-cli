import assert from "node:assert/strict";
import test from "node:test";
import { gitEnv } from "../preflight-git.mjs";

// The one test for the filter: every pointer spelling, in any case, plus the
// `-c` config variables. `GIT_AUTHOR_NAME` stays to show that only the
// redirecting variables are touched.
test("every variable that can redirect a git child is dropped, whatever its case", () => {
  const env = gitEnv({
    PATH: "/bin",
    HOME: "/home/x",
    GIT_DIR: "/elsewhere",
    git_dir: "/elsewhere",
    Git_Work_Tree: "/elsewhere",
    GIT_COMMON_DIR: "/elsewhere",
    GIT_INDEX_FILE: "/elsewhere",
    GIT_OBJECT_DIRECTORY: "/elsewhere",
    GIT_ALTERNATE_OBJECT_DIRECTORIES: "/elsewhere",
    git_config_count: "1",
    GIT_CONFIG_KEY_0: "core.hooksPath",
    GIT_CONFIG_PARAMETERS: "'core.bare'='true'",
    GIT_AUTHOR_NAME: "kept",
  });

  assert.deepEqual(Object.keys(env).sort(), ["GIT_AUTHOR_NAME", "HOME", "PATH"]);
});
