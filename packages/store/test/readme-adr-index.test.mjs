// ADR-0059 D6 (T-5) + round-58 audit R-1: the README ADR index must be a faithful derived artifact
// of the docs/adr tree. Round-57 failure mode: README claimed 0001-0046 while 59 existed. Round-58
// R-1 failure mode: the index was generated from the dirty workspace filesystem, so it was stale on
// a clean checkout. The source is therefore the git tree, not the filesystem.
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { adrEntries, BEGIN, END, renderBlock, replaceBlock } from "../../../scripts/gen-adr-index.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..", "..", "..");
const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");

// 1. one row per ADR in the GIT TREE (staged/other-branch files must not leak in)
const entries = adrEntries("HEAD");
const tracked = execFileSync("git", ["ls-tree", "-r", "--name-only", "HEAD", "--", "docs/adr"], { cwd: root, encoding: "utf8" })
  .split("\n")
  .filter((f) => f.endsWith(".md"));
assert(entries.length === tracked.length, "one index row per tracked ADR (" + entries.length + " vs " + tracked.length + ")");
assert(entries.every((e) => /^\d{3,4}$/.test(e.num) && e.title.length > 0), "every row carries a number and a non-empty title");

// 2. the source is the git tree, not the filesystem: the on-disk count may differ (staged files)
const onDisk = fs.readdirSync(path.join(root, "docs", "adr")).filter((f) => f.endsWith(".md")).length;
assert(entries.length <= onDisk, "git-tree count never exceeds the on-disk count (" + entries.length + " <= " + onDisk + ")");

// 3. README is in sync with the git tree (regenerate-and-diff)
assert(readme.includes(BEGIN) && readme.includes(END), "README carries the ADR-INDEX markers");
assert(replaceBlock(readme, renderBlock(entries)) === readme, "README index is up to date (regenerate-and-diff)");
assert(!readme.includes("ADR-0001 through ADR-0046"), "the stale 0001-0046 claim is gone");

// 4. drift is detectable: an injected stale row makes the block disagree
const stale = readme.replace(BEGIN, BEGIN + "\n| STALE-ROW | injected |");
assert(stale !== readme, "the injected stale row actually changed the README text");
assert(replaceBlock(stale, renderBlock(entries)) !== stale, "regenerate-and-diff detects the injected drift");

// 5. the generator is wired into ship-gate (a dropped assertion = a dropped gate)
const sg = fs.readFileSync(path.join(root, "scripts", "ship-gate.mjs"), "utf8");
assert(sg.includes("stepAdrIndex"), "ship-gate wires stepAdrIndex");
assert(sg.includes("gen-adr-index.mjs"), "ship-gate runs the generator in --check mode");

console.log("readme-adr-index.test: ok");
