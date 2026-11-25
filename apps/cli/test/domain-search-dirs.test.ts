// #605: the CLI shares hostDomainsDirs with the MCP server. In a source
// checkout the committed repo-root domains/ must win over the build copy in
// apps/cli/domains, so editing a root TOML is visible without a rebuild.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { domainSearchDirs } from "../src/db.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

test("source checkout reads the committed repo-root domains before the generated copy", () => {
  const before = process.cwd();
  const project = mkdtempSync(join(tmpdir(), "ans-cli-domains-"));
  try {
    // Run from a neutral project: a cwd that is apps/cli would make the
    // generated apps/cli/domains look like a project-local domains/ dir.
    process.chdir(project);
    const dirs = domainSearchDirs({});
    const root = join(repoRoot, "domains");
    const pkg = join(repoRoot, "apps", "cli", "domains");
    assert.ok(dirs.includes(root), "the repo-root domains dir is on the chain");
    assert.ok(dirs.includes(pkg), "the package copy stays as a fallback");
    assert.ok(dirs.indexOf(root) < dirs.indexOf(pkg), "the root comes before the generated copy");
  } finally {
    process.chdir(before);
    rmSync(project, { recursive: true, force: true });
  }
});

test("running from a package inside the checkout does not put the build copy first", () => {
  const before = process.cwd();
  try {
    process.chdir(join(repoRoot, "apps", "cli"));
    const dirs = domainSearchDirs({});
    const root = join(repoRoot, "domains");
    const pkg = join(repoRoot, "apps", "cli", "domains");
    assert.ok(dirs.indexOf(root) < dirs.indexOf(pkg), "the root still comes before the package copy");
  } finally {
    process.chdir(before);
  }
});

test("a user project inside the checkout keeps its own domains dir", () => {
  const before = process.cwd();
  const project = mkdtempSync(join(repoRoot, ".tmp-ans-project-"));
  try {
    mkdirSync(join(project, "domains"));
    process.chdir(project);
    const dirs = domainSearchDirs({});
    assert.ok(dirs.includes(join(project, "domains")), "the project-local domains dir is not treated as a build copy");
  } finally {
    process.chdir(before);
    rmSync(project, { recursive: true, force: true });
  }
});
