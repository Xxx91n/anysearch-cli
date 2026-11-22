import assert from "node:assert/strict";
import test from "node:test";
import { docsOnly, isDocumentation } from "../ci-changes.mjs";

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
