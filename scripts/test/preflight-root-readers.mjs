// What the ROOT_READERS table in scripts/preflight-plan.mjs should answer, in
// one place: the plan tests and the CLI tests both read it, so adding or
// dropping a reader is one edit here instead of seven copies drifting apart.
// This is the only mirror; preflight-plan.test.mjs also pins every root row to a
// literal reader list, deliberately, so a table edit cannot hide behind a
// matching edit here — change both when a reader really moves. Each list is
// sorted on export, because the plan prints readers sorted and the tests compare
// against that output directly.
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
