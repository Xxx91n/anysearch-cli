// #607: schema-content.ts is generated from schema.sql. Both are read by the
// store (filesystem in ESM/tsx, inlined constant in bundled CJS), so a hand
// edit to one of them silently changes which schema a build actually runs.
// Pin them byte-for-byte.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SCHEMA_SQL } from "../src/schema-content.js";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return; }
  passed++;
}

const here = dirname(fileURLToPath(import.meta.url));
const schemaPath = join(here, "..", "src", "schema.sql");
const source = readFileSync(schemaPath, "utf8");

assert(SCHEMA_SQL === source, "schema-content.ts matches schema.sql byte-for-byte");
assert(source.includes("content TEXT"), "schema.sql carries the #607 page-body column");
assert(source.includes("fetched BOOLEAN DEFAULT 0"), "schema.sql keeps the fetched marker");
assert(!SCHEMA_SQL.includes("\r\n"), "inlined schema keeps the source line endings (no CRLF drift)");

console.log("schema-content-drift.test.ts: " + passed + " passed, " + failed + " failed");
if (failed > 0) process.exit(1);
