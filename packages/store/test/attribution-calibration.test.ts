// ADR-0050 D6/D9: calibration bundle registry lifecycle. L2 gold digest,
// L4 rollback and crash drills. Uses a temp copy store, never the real root.
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  calibrationBundleDigest,
  readActiveCalibrationBundle,
  setCalibrationHead,
  writeCalibrationBundle,
  type AttributionCalibrationBundle,
} from "../src/eval/attribution-calibration";

function makeBundle(params: { a: number; b: number; c: number }, createdAt: string): AttributionCalibrationBundle {
  return {
    schema: "anysearch/attribution-calibration-bundle@1",
    createdAt,
    labelsDigest: "sha256:0000000000000000",
    params,
    thresholds: { supported: 0.7, unsupported: 0.4, degraded: false },
  };
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "ans-calibration-"));
const bundleV1 = makeBundle({ a: 1, b: 1, c: 0 }, "2026-09-01T00:00:00.000Z");
const bundleV2 = makeBundle({ a: 1.2, b: 0.9, c: 0.1 }, "2026-09-02T00:00:00.000Z");

// L2: identical content yields an identical digest (gold diff invariant).
const first = writeCalibrationBundle(root, bundleV1, { activate: true });
const repeat = writeCalibrationBundle(root, bundleV1);
assert.equal(repeat.digest, first.digest, "same bundle keeps the same digest");
assert.equal(calibrationBundleDigest(bundleV1), first.digest, "digest is pure content hashing");

// L4: promotion moves the head; rollback is a pointer move only.
const second = writeCalibrationBundle(root, bundleV2, { activate: true });
assert.notEqual(second.digest, first.digest, "new params give a new content address");
assert.equal(readActiveCalibrationBundle(root)?.digest, second.digest, "head follows the activated bundle");
setCalibrationHead(root, first.digest, "2026-09-03T00:00:00.000Z");
const rolledBack = readActiveCalibrationBundle(root);
assert.equal(rolledBack?.digest, first.digest, "rollback restores the older bundle by pointer");
assert.deepEqual(rolledBack?.bundle.params, bundleV1.params, "rolled-back bundle carries the v1 beta params");

// L4 crash drill: a truncated head and a tampered bundle both fail open.
fs.writeFileSync(path.join(root, "calibration-head.json"), "{ truncated", "utf8");
assert.equal(readActiveCalibrationBundle(root), null, "corrupt head fails open");
setCalibrationHead(root, first.digest, "2026-09-04T00:00:00.000Z");
const bundlePath = path.join(root, "calibrations", first.digest + ".json");
fs.writeFileSync(bundlePath, JSON.stringify({ ...bundleV1, params: { a: 9, b: 9, c: 9 } }), "utf8");
assert.equal(readActiveCalibrationBundle(root), null, "tampered bundle fails digest check");
fs.rmSync(bundlePath);
assert.equal(readActiveCalibrationBundle(root), null, "missing bundle fails open");

fs.rmSync(root, { recursive: true, force: true });
console.log("attribution-calibration.test: ok");
