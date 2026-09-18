// ADR-0049 D11: deterministic recorded-pairs fixture judge + unknown-schema fail + gold diff.
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const script = path.join(repoRoot, "scripts", "eval-calibrate-fixture.mjs");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ans-calibration-fixture-"));
const fixture = path.join(temp, "fixture.json");
const out = path.join(temp, "report.json");
const gold = path.join(temp, "gold.json");

fs.writeFileSync(fixture, JSON.stringify({
  schema: "anysearch/calibration-l2-fixture@1",
  pairs: Array.from({ length: 40 }, (_, i) => [i % 2, i % 2]),
  groups: [{ group: "secret", pairs: [[1, 0], [1, 0], [1, 1]] }],
  thresholds: { ac1Lo: 0.7, po: 0.8, width: 0.4 },
}), "utf8");

function run(args) {
  return spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
}

assert.equal(run(["--fixture", fixture, "--out", out]).status, 0, "fixture judge passes");
fs.copyFileSync(out, gold);
assert.equal(run(["--fixture", fixture, "--out", out, "--gold", gold]).status, 0, "golden report diff matches");
const report = JSON.parse(fs.readFileSync(out, "utf8"));
assert.equal(report.decision, "pass", "fixture report has deterministic pass decision");
assert.ok(report.groupRedFlags.length, "group red flags are included in report");

const wrongGold = path.join(temp, "wrong.json");
fs.writeFileSync(wrongGold, JSON.stringify({ ...report, decision: "fail" }), "utf8");
assert.equal(run(["--fixture", fixture, "--out", out, "--gold", wrongGold]).status, 1, "gold diff fails non-zero");

const unknown = path.join(temp, "unknown.json");
fs.writeFileSync(unknown, JSON.stringify({ schema: "anysearch/unknown@9", pairs: [[1, 1]] }), "utf8");
assert.equal(run(["--fixture", unknown, "--out", out]).status, 2, "unknown fixture schema explicitly fails");

fs.rmSync(temp, { recursive: true, force: true });
console.log("revision-fixture.integration.test: ok");
