// ADR-0050 D9: deterministic beta calibration invariants and held-out dual
// threshold derivation, including the legacy degraded fallback floor.
import assert from "node:assert";
import {
  BETA_IDENTITY,
  betaCalibrate,
  brierScore,
  deriveThresholds,
  evaluateThresholdGate,
  fitBetaCalibration,
  LEGACY_ATTRIBUTION_THRESHOLD,
  type CalibrationSample,
} from "../src/calibrate";

function sample(score: number, label: 0 | 1): CalibrationSample {
  return { score, label };
}

assert.equal(betaCalibrate(0.7, BETA_IDENTITY), 0.7, "identity beta calibration preserves probability");
assert.ok(Math.abs(betaCalibrate(0.5, BETA_IDENTITY) - 0.5) < 1e-12, "identity beta calibration preserves midpoint");

const empty = fitBetaCalibration([]);
assert.equal(empty.n, 0, "empty fit is identity");
assert.deepEqual(empty.params, BETA_IDENTITY, "empty fit parameters are identity");

const goodSamples = [
  sample(0.9, 1),
  sample(0.8, 1),
  sample(0.2, 0),
  sample(0.1, 0),
];
const fit = fitBetaCalibration(goodSamples);
assert.ok(fit.params.a >= 0 && fit.params.b >= 0, "beta parameters remain constrained");
assert.ok(fit.loss <= brierScore(goodSamples, BETA_IDENTITY), "fit improves identity brier on separable sample");

const fallback = deriveThresholds([], 0.9);
assert.equal(fallback.degraded, true, "empty held-out set degrades");
assert.equal(fallback.supported, LEGACY_ATTRIBUTION_THRESHOLD, "empty held-out set keeps legacy floor");

const thresholdSamples = [
  ...Array.from({ length: 12 }, (_, i) => sample(0.95 - i * 0.01, 1)),
  ...Array.from({ length: 12 }, (_, i) => sample(0.05 + i * 0.01, 0)),
];
const thresholds = deriveThresholds(thresholdSamples, 0.9, { minSamplesPerSide: 3 });
assert.equal(thresholds.degraded, false, "non-empty held-out set derives thresholds");
assert.ok(thresholds.supported > thresholds.unsupported, "supported threshold is above unsupported threshold");
const thresholdGate = evaluateThresholdGate(thresholdSamples, thresholds, 0.9);
assert.ok(Number.isFinite(thresholdGate.supportedWilsonLower), "supported gate has a finite Wilson lower bound");

const powerfulSamples = [
  ...Array.from({ length: 100 }, (_, i) => sample(0.5 + i * 0.005, 1)),
  ...Array.from({ length: 100 }, (_, i) => sample(i * 0.0049, 0)),
];
const powerfulThresholds = deriveThresholds(powerfulSamples, 0.9, { minSamplesPerSide: 10 });
assert.equal(powerfulThresholds.degraded, false, "larger held-out set derives thresholds");
assert.equal(evaluateThresholdGate(powerfulSamples, powerfulThresholds, 0.9).decision, "pass", "larger held-out thresholds pass target precision");

const insufficient = deriveThresholds(
  [sample(0.4, 1), sample(0.6, 0), sample(0.45, 1), sample(0.65, 0)],
  1,
  { minSamplesPerSide: 1 },
);
assert.equal(insufficient.degraded, true, "unreachable target precision degrades");

console.log("calibrate.test: ok");
