// ADR-0048 D6: synthetic human/judge integration test. It drives the real
// CLI against a temp label/manifest pair, then runs eval-calibrate's
// deterministic synthetic judge path. No OF looks or local DB are touched.
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");
const cli = path.join(repoRoot, "scripts", "eval-labels.mjs");
const calibrate = path.join(repoRoot, "scripts", "eval-calibrate.mjs");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ans-calibration-labels-"));
const labelsPath = path.join(temp, "calibration-labels.jsonl");
const manifestPath = path.join(temp, "calibration-manifest.json");
const reportPath = path.join(temp, "calibration-report.json");

function writeInitial(overrides = {}) {
  fs.writeFileSync(labelsPath, "", "utf8");
  fs.writeFileSync(
    manifestPath,
    JSON.stringify({
      schema: "anysearch/calibration-manifest@1",
      caseFingerprint: "df7a0a4b63954803",
      labelsFingerprint: "da39a3ee5e6b4b0d",
      annotators: [],
      annotatedAt: null,
      promotedVersion: null,
      promotedAt: null,
      promotedFingerprint: null,
      ...overrides,
    }),
    "utf8",
  );
}

function runCli(args, env = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    env: {
      ...process.env,
      ANS_CALIBRATION_LABELS_PATH: labelsPath,
      ANS_CALIBRATION_MANIFEST_PATH: manifestPath,
      ...env,
    },
    encoding: "utf8",
  });
}

const ids = [
  "cal_supersession_1", "cal_supersession_2", "cal_supersession_3", "cal_supersession_4", "cal_supersession_5",
  "cal_temporal_1", "cal_temporal_2", "cal_temporal_3", "cal_temporal_4", "cal_temporal_5",
  "cal_secret_1", "cal_secret_2", "cal_secret_3", "cal_secret_4", "cal_secret_5",
  "cal_cprime_1", "cal_cprime_2", "cal_cprime_3", "cal_cprime_4", "cal_cprime_5",
  "cal_quarantine_1", "cal_quarantine_2", "cal_quarantine_3", "cal_quarantine_4", "cal_quarantine_5",
  "cal_stale_topk_1", "cal_stale_topk_2", "cal_stale_topk_3", "cal_stale_topk_4", "cal_stale_topk_5",
];

writeInitial();
assert.equal(runCli(["validate"]).status, 0, "initial empty label set validates");

writeInitial({ labelsFingerprint: "ffffffffffffffff" });
assert.equal(runCli(["validate"]).status, 12, "manifest labels fingerprint drift exits 12");

writeInitial();
fs.writeFileSync(labelsPath, "{not-json}\n", "utf8");
assert.equal(runCli(["validate"]).status, 2, "malformed label line exits 2");

writeInitial();
for (let i = 0; i < ids.length; i++) {
  const result = runCli([
    "add",
    "--case", ids[i],
    "--label", String(i % 2),
    "--annotator", "human",
    "--at", "2026-09-05T00:00:00.000Z",
  ]);
  assert.equal(result.status, 0, "add label " + ids[i] + " succeeds");
}
assert.equal(runCli(["validate"]).status, 0, "complete synthetic human labels validate");
assert.equal(runCli(["promote"]).status, 0, "complete synthetic human labels promote");
const promotedManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
assert.equal(promotedManifest.promotedVersion, 1, "promote increments version");

const frozenSet = runCli([
  "set",
  "--case", ids[0],
  "--label", "0",
  "--annotator", "human-2",
  "--at", "2026-09-05T00:00:01.000Z",
]);
assert.equal(frozenSet.status, 2, "promoted label set is frozen");
const frozenManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
assert.equal(frozenManifest.promotedVersion, 1, "frozen mutation does not rewrite promote state");

const judgeRun = spawnSync(process.execPath, [
  calibrate,
  "--human", "1,0,1,0,1,0,1,0,1,0",
  "--judge", "1,0,1,0,1,0,1,0,1,0",
  "--boot", "200",
  "--out", reportPath,
], { encoding: "utf8" });
assert.equal(judgeRun.status, 0, "synthetic perfect agreement passes the deterministic judge path");
assert.ok(fs.existsSync(reportPath), "calibration report is written");

fs.rmSync(temp, { recursive: true, force: true });
console.log("eval-labels.integration.test: ok");
