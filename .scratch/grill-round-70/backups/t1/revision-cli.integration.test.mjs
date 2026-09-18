// ADR-0049 D5/D8/D9 drills: migrate -> open/commit/promote -> rollback -> prune -> crash recovery.
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");
const labelsCli = path.join(repoRoot, "scripts", "eval-labels.mjs");
const revisionsCli = path.join(repoRoot, "scripts", "eval-revisions.mjs");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ans-calibration-revisions-"));
const oldLabels = path.join(temp, "calibration-labels.jsonl");
const oldManifest = path.join(temp, "calibration-manifest.json");
const revisionRoot = path.join(temp, "revisions");

function run(file, args, env = {}) {
  return spawnSync(process.execPath, [file, ...args], {
    env: { ...process.env, ANS_CALIBRATION_REVISION_ROOT: revisionRoot, ANS_CALIBRATION_LABELS_PATH: oldLabels, ANS_CALIBRATION_MANIFEST_PATH: oldManifest, ...env },
    encoding: "utf8",
  });
}

function old(args) { return run(labelsCli, args); }
function rev(args) { return run(revisionsCli, ["rev", ...args]); }

const ids = [
  "cal_supersession_1", "cal_supersession_2", "cal_supersession_3", "cal_supersession_4", "cal_supersession_5",
  "cal_temporal_1", "cal_temporal_2", "cal_temporal_3", "cal_temporal_4", "cal_temporal_5",
  "cal_secret_1", "cal_secret_2", "cal_secret_3", "cal_secret_4", "cal_secret_5",
  "cal_cprime_1", "cal_cprime_2", "cal_cprime_3", "cal_cprime_4", "cal_cprime_5",
  "cal_quarantine_1", "cal_quarantine_2", "cal_quarantine_3", "cal_quarantine_4", "cal_quarantine_5",
  "cal_stale_topk_1", "cal_stale_topk_2", "cal_stale_topk_3", "cal_stale_topk_4", "cal_stale_topk_5",
];

fs.writeFileSync(oldLabels, "", "utf8");
fs.writeFileSync(oldManifest, JSON.stringify({
  schema: "anysearch/calibration-manifest@1",
  caseFingerprint: "df7a0a4b63954803",
  labelsFingerprint: "da39a3ee5e6b4b0d",
  annotators: [],
  annotatedAt: null,
  promotedVersion: null,
  promotedAt: null,
  promotedFingerprint: null,
}), "utf8");

for (let i = 0; i < ids.length; i++) {
  const result = old(["add", "--case", ids[i], "--label", String(i % 2), "--annotator", "human", "--at", "2026-09-06T00:00:00.000Z"]);
  assert.equal(result.status, 0, "old add " + ids[i] + " succeeds");
}
assert.equal(old(["validate"]).status, 0, "old label lifecycle remains valid before migration");

assert.equal(rev(["migrate", "--apply"]).status, 0, "migrate apply succeeds");
assert.equal(rev(["verify"]).status, 0, "migrated store verifies");

const v2 = rev(["open"]);
assert.equal(v2.status, 0, "open creates mutable revision");
const v2Id = v2.stdout.trim();
assert.equal(rev(["commit", "--version", v2Id, "--case", ids[0], "--label", "0", "--annotator", "human-2", "--at", "2026-09-06T00:00:01.000Z"]).status, 0, "commit changes mutable revision");
assert.equal(rev(["commit", "--version", v2Id, "--retire-case", ids[3], "--reason", "superseded by new case"]).status, 0, "case retire writes tombstone");
const pairs = JSON.stringify(ids.map((_, i) => [i % 2, i % 2]));
assert.equal(rev(["promote", "--version", v2Id, "--pairs", pairs]).status, 0, "promote passes L0/L1/L2");
assert.equal(rev(["rollback", "--to", "v1"]).status, 0, "rollback moves head to v1");
assert.equal(rev(["switch", "--to", v2Id]).status, 0, "switch moves head back to v2");

const v3 = rev(["open"]);
assert.equal(v3.status, 0, "third revision opens");
const v3Id = v3.stdout.trim();
assert.equal(rev(["commit", "--version", v3Id, "--case", ids[1], "--label", "1", "--annotator", "human-3", "--at", "2026-09-06T00:00:02.000Z"]).status, 0, "third revision commit succeeds");
assert.equal(rev(["promote", "--version", v3Id, "--pairs", pairs]).status, 0, "third revision promotes");
const v4 = rev(["open"]);
const v4Id = v4.stdout.trim();
assert.equal(rev(["commit", "--version", v4Id, "--case", ids[2], "--label", "0", "--annotator", "human-4", "--at", "2026-09-06T00:00:03.000Z"]).status, 0, "fourth revision commit succeeds");
assert.equal(rev(["rollback", "--to", v3Id]).status, 0, "rollback makes fourth revision unreachable");
const dry = rev(["prune", "--dry-run"]);
assert.equal(dry.status, 0, "prune dry-run succeeds");
assert.match(dry.stdout, /protectedByGrace/, "recent unreachable revision is protected by grace");

const registryPath = path.join(revisionRoot, "registry.json");
const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
for (const entry of registry.entries) {
  if (entry.version === v4Id) entry.createdAt = "2026-07-01T00:00:00.000Z";
}
fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2) + "\n", "utf8");
assert.equal(rev(["prune"]).status, 0, "prune apply succeeds after grace");
assert.equal(fs.existsSync(path.join(revisionRoot, "revisions", v4Id)), false, "pruned revision directory is removed");

const seedFile = path.join(revisionRoot, "seeds", JSON.parse(fs.readFileSync(path.join(revisionRoot, "state.json"), "utf8")).seedRef + ".json");
const seedSnapshot = JSON.parse(fs.readFileSync(seedFile, "utf8"));
seedSnapshot.fingerprint = "sha256:" + "0".repeat(64);
fs.writeFileSync(seedFile, JSON.stringify(seedSnapshot), "utf8");
assert.equal(rev(["verify"]).status, 12, "undeclared seed drift exits 12");
assert.equal(rev(["verify", "--seed-flip"]).status, 0, "declared seed flip passes verify");

fs.appendFileSync(path.join(revisionRoot, "journal.jsonl"), "{partial-crash-tail\n", "utf8");
assert.equal(rev(["verify", "--seed-flip"]).status, 0, "verify tolerates a torn journal tail and reconciles state");

fs.rmSync(temp, { recursive: true, force: true });
console.log("revision-cli.integration.test: ok");
