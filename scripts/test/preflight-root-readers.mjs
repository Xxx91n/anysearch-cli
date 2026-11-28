// What ROOT_READERS in scripts/preflight-plan.mjs should answer. A reader change
// edits three places: that table, this file, and the per-row pins in
// scripts/test/preflight-plan.test.mjs. Lists are sorted on export because the
// plan prints readers sorted and the tests compare against that output.
const ANSWERS = {
  domains: ["@anysearch-cli/cli", "@anysearch-cli/kernel", "@anysearch-cli/store"],
  "AGENTS.md": ["@anysearch-cli/store"],
  "eval-badcases.json": ["@anysearch-cli/kernel", "@anysearch-cli/store"],
  "eval-golden.json": ["@anysearch-cli/kernel", "@anysearch-cli/store"],
  "eval-looks.coverage.json": ["@anysearch-cli/store"],
  "eval-looks.json": ["@anysearch-cli/store"],
};

export const EXPECTED_ROOT_READERS = Object.fromEntries(
  Object.entries(ANSWERS).map(([path, readers]) => [path, [...readers].sort()]),
);
