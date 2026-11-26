// What the ROOT_READERS table in scripts/preflight-plan.mjs should answer, in
// one place: the plan tests and the CLI tests both read it, so adding or
// dropping a reader is one edit instead of seven copies drifting apart. Each
// list is sorted on export, because the plan prints readers sorted and the
// tests compare against that output directly — typing a new name in the wrong
// spot cannot turn a correct table red.
const ANSWERS = {
  domains: ["@anysearch-cli/cli", "@anysearch-cli/kernel", "@anysearch-cli/store"],
  "AGENTS.md": ["@anysearch-cli/store"],
  "eval-badcases.json": ["@anysearch-cli/kernel", "@anysearch-cli/store"],
  "eval-looks.coverage.json": ["@anysearch-cli/store"],
  "eval-looks.json": ["@anysearch-cli/store"],
};

export const EXPECTED_ROOT_READERS = Object.fromEntries(
  Object.entries(ANSWERS).map(([path, readers]) => [path, [...readers].sort()]),
);
