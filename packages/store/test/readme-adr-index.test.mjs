// ADR-0059 D6 (T-5): the README ADR index must be a faithful derived artifact of docs/adr/.
// Round-57 failure mode under test: README claimed 0001-0046 while 59 ADRs existed on disk.
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { adrEntries, BEGIN, END, renderBlock, replaceBlock } from "../../../scripts/gen-adr-index.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..", "..", "..");
const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");

// 1. one row per ADR file, each carrying a number and a title
const entries = adrEntries();
const files = fs.readdirSync(path.join(root, "docs", "adr")).filter((f) => f.endsWith(".md"));
assert(entries.length === files.length, "one index row per ADR file (" + entries.length + " vs " + files.length + ")");
assert(entries.every((e) => /^\d{3,4}$/.test(e.num) && e.title.length > 0), "every row carries a number and a non-empty title");

// 2. README is in sync with docs/adr (regenerate-and-diff)
assert(readme.includes(BEGIN) && readme.includes(END), "README carries the ADR-INDEX markers");
assert(replaceBlock(readme, renderBlock(entries)) === readme, "README index is up to date (regenerate-and-diff)");
assert(readme.includes("ADR-0001 through ADR-0059"), "the range line tracks the real count");
assert(!readme.includes("ADR-0001 through ADR-0046"), "the stale 0001-0046 claim is gone");

// 3. drift is detectable: an injected stale row makes the block disagree
const stale = readme.replace(BEGIN, BEGIN + "\n| STALE-ROW | injected |");
assert(stale !== readme, "the injected stale row actually changed the README text");
assert(replaceBlock(stale, renderBlock(entries)) !== stale, "regenerate-and-diff detects the injected drift");

// 4. the generator is wired into ship-gate (a dropped assertion = a dropped gate)
const sg = fs.readFileSync(path.join(root, "scripts", "ship-gate.mjs"), "utf8");
assert(sg.includes("stepAdrIndex"), "ship-gate wires stepAdrIndex");
assert(sg.includes("gen-adr-index.mjs"), "ship-gate runs the generator in --check mode");

console.log("readme-adr-index.test: ok");
