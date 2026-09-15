// ADR-0030 D5: kernel must use store classifiers — this test locks the drift fix in.
// Historical bug: memory-pipeline.ts carried an inline QDF/evergreen regex copy that
// drifted from @anysearch-cli/store (missing forms, hardcoded year literals).

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return false; }
  passed++; return true;
}

const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "src", "memory-pipeline.ts"),
  "utf8",
);

// No inline QDF/evergreen regex replicas (the historical drifted copies started with /最新 and /什么是).
assert(!src.includes("/最新"), "no inline QDF regex replica"); 
assert(!src.includes("/什么是"), "no inline evergreen regex replica");
// Classifiers are imported from the store package.
assert(src.includes('from "@anysearch-cli/store"'), "classifiers imported from @anysearch-cli/store");
assert(/classifyQdf\(l2Query, \{ isTimeSensitive, isEvergreen \}\)/.test(src), "classifyQdf receives store classifiers");

console.log("qdf-store-import tests: " + passed + " passed, " + failed + " failed");
if (failed > 0) process.exit(1);
