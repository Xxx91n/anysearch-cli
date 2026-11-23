// What the ROOT_READERS table in scripts/preflight-plan.mjs should answer, in
// one place: the plan tests and the CLI tests both read it, so adding or
// dropping a reader is one edit instead of seven copies drifting apart.
export const EXPECTED_ROOT_READERS = {
  domains: ["@anysearch-cli/cli", "@anysearch-cli/kernel", "@anysearch-cli/store"],
  "AGENTS.md": ["@anysearch-cli/store"],
  "eval-badcases.json": ["@anysearch-cli/kernel", "@anysearch-cli/store"],
  "eval-looks.coverage.json": ["@anysearch-cli/store"],
  "eval-looks.json": ["@anysearch-cli/kernel", "@anysearch-cli/store"],
};
