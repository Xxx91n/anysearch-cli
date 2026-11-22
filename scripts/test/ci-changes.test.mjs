import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import os from "node:os";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { docsOnly, isDocumentation } from "../ci-changes.mjs";

const CLI = fileURLToPath(new URL("../ci-changes.mjs", import.meta.url));

function runCli(input, options = {}) {
  return spawnSync(process.execPath, [CLI], { input, encoding: "utf8", ...options });
}

test("the doc boundary is docs/ plus the four root markdown files", () => {
  for (const file of [
    "docs/limitations.md",
    "docs/assets/readme/hero.png",
    "README.md",
    "README.zh-CN.md",
    "GLOSSARY.md",
    "CHANGELOG.md",
  ]) {
    assert.equal(isDocumentation(file), true, file);
  }

  for (const file of [
    "apps/plugin/AGENTS.md",
    "apps/plugin/README.md",
    "domains/docs.toml",
    ".github/workflows/ci.yml",
    "docs-tools/check.mjs",
    "docs",
    "README.md.bak",
  ]) {
    assert.equal(isDocumentation(file), false, file);
  }
});

test("docsOnly needs at least one file and every file inside the boundary", () => {
  assert.equal(docsOnly(["README.md"]), true);
  assert.equal(docsOnly(["docs/a.md", "CHANGELOG.md"]), true);
  assert.equal(docsOnly(["docs/a.md", "apps/plugin/AGENTS.md"]), false);
  assert.equal(docsOnly([]), false);
});

test("separators and ./- prefixes do not escape the boundary", () => {
  assert.equal(docsOnly([".\\docs\\a.md"]), true);
  assert.equal(docsOnly(["./apps/plugin/AGENTS.md"]), false);
});

test("the command-line entry reads NUL-separated paths from any cwd", () => {
  const docs = runCli("docs/limitations.md\0README.md\0", { cwd: os.tmpdir() });
  assert.equal(docs.status, 0);
  assert.equal(docs.stdout, "true");

  const mixed = runCli("docs/a.md\0apps/plugin/AGENTS.md\0", { cwd: os.tmpdir() });
  assert.equal(mixed.status, 0);
  assert.equal(mixed.stdout, "false");

  const newline = runCli("README.md\nCHANGELOG.md\n");
  assert.equal(newline.status, 0);
  assert.equal(newline.stdout, "true");

  const empty = runCli("");
  assert.equal(empty.status, 0);
  assert.equal(empty.stdout, "false");
});
