// ADR-0050 D9: deterministic beta calibration invariants and held-out dual
// threshold derivation, including the legacy degraded fallback floor.
import assert from "node:assert";
import {
  BETA_IDENTITY,
  betaCalibrate,
  brierScore,
  confusionStats,
  deriveThresholds,
  evaluateThresholdGate,
  fitBetaCalibration,
  LEGACY_ATTRIBUTION_THRESHOLD,
  wilsonLowerBound,
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

// Wilson lower-bound gate uses the one-sided 95% z, matching industry CI
// gates; arithmetic cross-check: 50/100 lower bound is 0.41885.
assert.ok(
  Math.abs(wilsonLowerBound(50, 100) - 0.41884779611252954) < 1e-9,
  "Wilson one-sided 95% lower bound computes 0.41885 for 50/100",
);

// Beta-fit cross-check against the Kull identity property: a deterministic
// quasi-calibrated stream (u_i < p_i with phi-lattice u) has empirical
// hit-rate matching the score, so the fit must return near-identity
// parameters (a, b ~ 1; c ~ 0). Measured reference: a=1.015, b=1.097, c=-0.066.
const calibratedSamples: CalibrationSample[] = [];
for (let i = 1; i <= 200; i++) {
  const p = i / 201;
  const u = (i * 0.6180339887498949) % 1;
  calibratedSamples.push(sample(p, u < p ? 1 : 0));
}
const identityFit = fitBetaCalibration(
  calibratedSamples,
  { learningRate: 0.05, maxIterations: 4000 },
);
assert.ok(identityFit.params.a > 0.7 && identityFit.params.a < 1.4, "well-calibrated input keeps a near 1");
assert.ok(identityFit.params.b > 0.7 && identityFit.params.b < 1.4, "well-calibrated input keeps b near 1");
assert.ok(Math.abs(identityFit.params.c) < 0.25, "well-calibrated input keeps c near 0");

const powerfulSamples = [
  ...Array.from({ length: 100 }, (_, i) => sample(0.5 + i * 0.005, 1)),
  ...Array.from({ length: 100 }, (_, i) => sample(i * 0.0049, 0)),
];
const powerfulThresholds = deriveThresholds(powerfulSamples, 0.9, { minSamplesPerSide: 10 });
assert.equal(powerfulThresholds.degraded, false, "larger held-out set derives thresholds");
assert.equal(evaluateThresholdGate(powerfulSamples, powerfulThresholds, 0.9).decision, "pass", "larger held-out thresholds pass target precision");
assert.equal(
  deriveThresholds(powerfulSamples, 0.9, { minSamplesPerSide: 10, minSamplesTotal: 201 }).degraded,
  true,
  "below the preregistration nMin cold-start gate the line stays degraded",
);

const stats = confusionStats(powerfulSamples, powerfulThresholds);
assert.ok(stats.sensitivity > 0.9 && stats.specificity > 0.9, "separable sample gives strong sens/spec");
assert.ok(Math.abs(stats.prevalence - 0.5) < 1e-9, "prevalence matches the 50/50 mix");

const insufficient = deriveThresholds(
  [sample(0.4, 1), sample(0.6, 0), sample(0.45, 1), sample(0.65, 0)],
  1,
  { minSamplesPerSide: 1 },
);
assert.equal(insufficient.degraded, true, "unreachable target precision degrades");

console.log("calibrate.test: ok");
