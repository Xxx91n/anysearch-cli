// What ROOT_READERS in scripts/preflight-plan.mjs should answer: the plan
// tests and the CLI tests both read this file. A reader change touches three
// places on purpose — the table in scripts/preflight-plan.mjs, this file, and
// the literal per-row pins in scripts/test/preflight-plan.test.mjs — so a table
// edit cannot hide behind a matching edit here. Each list is sorted on export:
// the plan prints readers sorted and the tests compare against that output.
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
