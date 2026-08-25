// ADR-0025 D1: Native Smoke assertion for better-sqlite3 prebuilds.
// Run by CI matrix (.github/workflows/native-smoke.yml) on win32-x64 / darwin-arm64 /
// linux-x64 / linux-arm64. allowBuilds=false in pnpm-workspace.yaml is intentional:
// source builds are disabled so a missing prebuild fails loudly instead of being
// hidden by a silent node-gyp compile (sweet-search b33e732 / nchat e94ab08 class).
//
// Resolution is anchored at packages/store (pnpm isolated layout: the dep is not
// visible from the repo root). Exports map may hide ./package.json, so resolve the
// main entry and walk up to the package root.
import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(ROOT, "packages/store/package.json"));
let dir = path.dirname(require.resolve("better-sqlite3"));
while (!existsSync(path.join(dir, "package.json")) && path.dirname(dir) !== dir) {
  dir = path.dirname(dir);
}
assert.ok(existsSync(path.join(dir, "package.json")), "better-sqlite3 package root not found from " + require.resolve("better-sqlite3"));

const prebuildsDir = path.join(dir, "prebuilds");
assert.ok(existsSync(prebuildsDir), "better-sqlite3 prebuilds/ missing: " + prebuildsDir);

const want = process.platform + "-" + process.arch;
const entries = readdirSync(prebuildsDir);
const hit = entries.find((e) => e.includes(want)) ?? entries.find((e) => e.includes(process.platform));
assert.ok(hit, "no prebuild for " + want + " in " + prebuildsDir + " (found: " + entries.join(", ") + ")");

const Database = require("better-sqlite3");
const db = new Database(":memory:");
db.exec("CREATE TABLE t (x INTEGER)");
db.prepare("INSERT INTO t VALUES (1)").run();
assert.equal(db.prepare("SELECT x FROM t").get().x, 1);
db.close();
console.log("verify-native OK: " + want + " prebuild=" + hit);
