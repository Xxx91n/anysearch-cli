// ADR-0049 D2-D13: table-driven pure-core coverage for immutable revisions,
// score bridge, L2 gate, prune reachability, and expand-contract migration plan.
import assert from "node:assert";
import {
  canonicalLabelsPayload,
  diffLabels,
  evaluateL2,
  labelsDigest,
  l0Invariants,
  migrationPlan,
  prunePlan,
  rejectNoOpPromote,
  revisionDigest,
  shadowReplay,
  type CalibrationLabelRecord,
  type CalibrationPair,
} from "../src/eval/revision-core";
import { CALIBRATION_CASES } from "../src/eval/calibration-cases";
import { buildManifest } from "../src/eval/calibration-labels";

function recordsFor(cases = CALIBRATION_CASES, flip = 0): CalibrationLabelRecord[] {
  return cases.map((item, index) => ({
    schema: "anysearch/calibration-label@1",
    caseId: item.id,
    label: index % 5 === 0 && flip > 0 ? (item.humanRelevant === 1 ? 0 : 1) as 0 | 1 : (index % 2) as 0 | 1,
    annotator: "human",
    annotatedAt: "2026-09-06T00:00:00.000Z",
  }));
}

const all = recordsFor();
const digest = revisionDigest(all);
assert.ok(digest.startsWith("sha256:"), "revision digest is full sha256");
assert.equal(labelsDigest(all), digest.slice(7), "digest derives from semantic payload");
assert.equal(canonicalLabelsPayload(all), canonicalLabelsPayload([...all].reverse()), "JCS ordering is deterministic");
assert.equal(l0Invariants(all, CALIBRATION_CASES, digest).ok, true, "complete immutable labels pass L0");
assert.equal(l0Invariants(all.slice(0, 2), CALIBRATION_CASES, digest).code, 2, "partial labels fail L0 coverage");
assert.equal(l0Invariants(all, CALIBRATION_CASES, "sha256:" + "0".repeat(64)).code, 12, "digest drift exits 12");
assert.equal(rejectNoOpPromote(all, all).code, 2, "no-op promote is rejected");

const changed = all.map((record, index) => index === 0 ? { ...record, label: record.label === 1 ? 0 as const : 1 as const } : record);
const bridge = diffLabels(all, changed);
assert.equal(bridge.unchanged, all.length - 1, "score bridge counts unchanged cases");
assert.equal(bridge.revisedCase, 1, "score bridge counts revised case");
assert.equal(bridge.mcnemar.n, 1, "exact McNemar sees one discordant pair");

const passPairs: CalibrationPair[] = Array.from({ length: 60 }, (_, i) => [(i % 2) as 0 | 1, (i % 2) as 0 | 1]);
const pass = evaluateL2(passPairs);
assert.equal(pass.decision, "pass", "perfect agreement passes formal L2");
const fail = evaluateL2([...Array.from({ length: 20 }, (_, i) => [1, 0] as const), ...Array.from({ length: 20 }, (_, i) => [0, 1] as const)] as CalibrationPair[]);
assert.notEqual(fail.decision, "pass", "systematic disagreement does not pass");
const red = evaluateL2([...Array.from({ length: 20 }, (_, i) => [1, 1] as const), ...Array.from({ length: 20 }, (_, i) => [0, 0] as const)] as CalibrationPair[], [{ group: "secret", pairs: [[1, 0], [1, 0], [1, 1]] as CalibrationPair[] }]);
assert.ok(red.groupRedFlags.length, "small group with low agreement is red-flagged");

const entry = {
  schema: "anysearch/calibration-revision@1" as const,
  version: "v1",
  digest: revisionDigest(all),
  createdAt: "2026-08-01T00:00:00.000Z",
  parent: null,
  seedRef: "calibration-set-x",
  labelsFingerprint: revisionDigest(all),
  archivedAt: null,
};
const pruned = prunePlan([entry], { heads: ["v1"], labels: ["v1"], seedRefs: ["calibration-set-x"] }, "2026-09-06T00:00:00.000Z");
assert.equal(pruned.prune.length, 0, "pinned roots are never pruned");
assert.equal(prunePlan([entry], { heads: ["v2"], labels: ["v2"], seedRefs: [] }, "2026-09-06T00:00:00.000Z").prune.length, 1, "unreachable old revision becomes pruneable after grace");

const manifest = buildManifest(all);
const replay = shadowReplay(all, manifest);
assert.equal(replay.ok, true, "shadow replay matches legacy manifest fingerprint");
const plan = migrationPlan(all);
assert.equal(plan.version, "v1", "migration creates v1");
assert.equal(plan.state.head, "v1", "migration atomically points head to v1");

console.log("revision-core.test: ok");
