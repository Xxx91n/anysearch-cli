// ADR-0050 D2/D5: beta calibration and held-out dual-threshold derivation.
// Pure functions only. No runtime dependency. Small-sample default is beta
// calibration (Kull 2017); isotonic/conformal are explicitly deferred.

export interface BetaCalibrationParams {
  a: number;
  b: number;
  c: number;
}

export interface CalibrationSample {
  score: number;
  label: 0 | 1;
}

export interface BetaFitResult {
  params: BetaCalibrationParams;
  n: number;
  iterations: number;
  loss: number;
  brier: number;
}

export interface AttributionThresholds {
  supported: number;
  unsupported: number;
  degraded: boolean;
  supportedCoverage?: number;
  unsupportedCoverage?: number;
  supportedN?: number;
  unsupportedN?: number;
  supportedPrecision?: number;
  unsupportedPrecision?: number;
}

export interface AttributionCalibration {
  params: BetaCalibrationParams;
  thresholds: AttributionThresholds;
}

export interface ThresholdDerivationOptions {
  minSamplesPerSide?: number;
  // Preregistration cold-start gate (D4): below this many total binary fit
  // samples the line stays degraded regardless of per-side counts.
  minSamplesTotal?: number;
  legacySupported?: number;
  legacyUnsupported?: number;
}

export interface ThresholdGateResult {
  decision: "pass" | "warn" | "fail";
  supportedWilsonLower: number;
  unsupportedWilsonLower: number;
  targetPrecision: number;
}

export const BETA_IDENTITY: BetaCalibrationParams = { a: 1, b: 1, c: 0 };
export const LEGACY_ATTRIBUTION_THRESHOLD = 0.6;
// One-sided 95% z for the precision floor gate, matching industry CI gates
// (vLLM lm-eval gate, sigeval). Lower-bound gates are one-sided by nature;
// a two-sided z would silently make the nominal 95% gate a ~97.5% one.
export const WILSON_Z_ONE_SIDED_95 = 1.6448536269514722;
const EPSILON = 1e-6;
const MAX_ITERATIONS = 1000;
const LEARNING_RATE = 0.1;
const MIN_LOSS_DELTA = 1e-9;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function clampProbability(value: number, epsilon = EPSILON): number {
  return Math.min(1 - epsilon, Math.max(epsilon, value));
}

function stableSigmoid(value: number): number {
  const z = Math.max(-30, Math.min(30, value));
  return 1 / (1 + Math.exp(-z));
}

export function betaCalibrate(score: number, params: BetaCalibrationParams): number {
  const s = clampProbability(score);
  const logit = params.c + params.a * Math.log(s) - params.b * Math.log(1 - s);
  return stableSigmoid(logit);
}

// Beta calibration (Kull 2017) logistic features for a raw score s:
// log(s), -log(1-s), and the bias term.
function features(score: number): { logS: number; negLog1mS: number; bias: 1 } {
  const s = clampProbability(score);
  return { logS: Math.log(s), negLog1mS: -Math.log(1 - s), bias: 1 };
}

export function brierScore(samples: CalibrationSample[], params: BetaCalibrationParams): number {
  if (!samples.length) return Number.NaN;
  let sum = 0;
  for (const sample of samples) {
    const p = betaCalibrate(sample.score, params);
    sum += (p - sample.label) ** 2;
  }
  return sum / samples.length;
}

export function logLoss(samples: CalibrationSample[], params: BetaCalibrationParams): number {
  if (!samples.length) return Number.NaN;
  let sum = 0;
  for (const sample of samples) {
    const p = clampProbability(betaCalibrate(sample.score, params));
    sum += -(
      sample.label * Math.log(p) +
      (1 - sample.label) * Math.log(1 - p)
    );
  }
  return sum / samples.length;
}

export function fitBetaCalibration(
  samples: CalibrationSample[],
  options: { maxIterations?: number; learningRate?: number } = {},
): BetaFitResult {
  if (!samples.length) {
    return { params: { ...BETA_IDENTITY }, n: 0, iterations: 0, loss: Number.NaN, brier: Number.NaN };
  }

  let a = BETA_IDENTITY.a;
  let b = BETA_IDENTITY.b;
  let c = BETA_IDENTITY.c;
  const maxIterations = options.maxIterations ?? MAX_ITERATIONS;
  const learningRate = options.learningRate ?? LEARNING_RATE;
  const n = samples.length;
  const prepared = samples.map((sample) => {
    return { ...sample, ...features(sample.score) };
  });

  let previousLoss = Number.POSITIVE_INFINITY;
  let iterations = 0;
  for (; iterations < maxIterations; iterations++) {
    let gradA = 0;
    let gradB = 0;
    let gradC = 0;
    let currentLoss = 0;

    for (const sample of prepared) {
      const z = c + a * sample.logS + b * sample.negLog1mS;
      const p = stableSigmoid(z);
      const error = p - sample.label;
      gradA += error * sample.logS;
      gradB += error * sample.negLog1mS;
      gradC += error;
      currentLoss += -(
        sample.label * Math.log(Math.max(EPSILON, p)) +
        (1 - sample.label) * Math.log(Math.max(EPSILON, 1 - p))
      );
    }
    currentLoss /= n;

    if (Math.abs(previousLoss - currentLoss) < MIN_LOSS_DELTA) break;
    previousLoss = currentLoss;

    a = Math.max(0, a - learningRate * gradA / n);
    b = Math.max(0, b - learningRate * gradB / n);
    c -= learningRate * gradC / n;
  }

  const params = { a, b, c };
  return {
    params,
    n,
    iterations,
    loss: logLoss(samples, params),
    brier: brierScore(samples, params),
  };
}

function uniqueThresholds(scores: number[]): number[] {
  const unique = [...new Set(scores.map((score) => clamp01(score)))].sort((x, y) => x - y);
  if (!unique.length) return [0, 1];
  if (unique[0] !== 0) unique.unshift(0);
  if (unique[unique.length - 1] !== 1) unique.push(1);
  return unique;
}

function precisionAtOrAbove(samples: CalibrationSample[], threshold: number): { precision: number; n: number } {
  const selected = samples.filter((sample) => sample.score >= threshold);
  if (!selected.length) return { precision: 0, n: 0 };
  return { precision: selected.reduce((sum, sample) => sum + sample.label, 0) / selected.length, n: selected.length };
}

function precisionAtOrBelow(samples: CalibrationSample[], threshold: number): { precision: number; n: number } {
  const selected = samples.filter((sample) => sample.score <= threshold);
  if (!selected.length) return { precision: 0, n: 0 };
  return { precision: selected.reduce((sum, sample) => sum + (1 - sample.label), 0) / selected.length, n: selected.length };
}

export function deriveThresholds(
  samples: CalibrationSample[],
  targetPrecision: number,
  options: ThresholdDerivationOptions = {},
): AttributionThresholds {
  const minSamplesPerSide = options.minSamplesPerSide ?? 10;
  const minSamplesTotal = options.minSamplesTotal ?? 0;
  const legacySupported = options.legacySupported ?? LEGACY_ATTRIBUTION_THRESHOLD;
  const legacyUnsupported = options.legacyUnsupported ?? LEGACY_ATTRIBUTION_THRESHOLD;
  const fallback: AttributionThresholds = {
    supported: legacySupported,
    unsupported: legacyUnsupported,
    degraded: true,
  };

  if (!samples.length || targetPrecision < 0 || targetPrecision > 1) return fallback;
  if (samples.length < minSamplesTotal) return fallback;

  const thresholds = uniqueThresholds(samples.map((sample) => sample.score));
  const supportedCandidates = thresholds
    .map((threshold) => {
      const { precision, n } = precisionAtOrAbove(samples, threshold);
      return { threshold, precision, n, coverage: n / samples.length };
    })
    .filter((candidate) => candidate.n >= minSamplesPerSide && candidate.precision >= targetPrecision);

  const unsupportedCandidates = thresholds
    .map((threshold) => {
      const { precision, n } = precisionAtOrBelow(samples, threshold);
      return { threshold, precision, n, coverage: n / samples.length };
    })
    .filter((candidate) => candidate.n >= minSamplesPerSide && candidate.precision >= targetPrecision);

  // ponytail: O(T^2) pair scan. Calibration sets are small; optimize to a
  // pointer sweep only if held-out threshold selection becomes a hot path.
  let best: AttributionThresholds | undefined;
  for (const supported of supportedCandidates) {
    for (const unsupported of unsupportedCandidates) {
      if (supported.threshold <= unsupported.threshold) continue;
      const minPrecision = Math.min(supported.precision, unsupported.precision);
      const coverage = supported.coverage + unsupported.coverage;
      if (!best || minPrecision > Math.min(best.supportedPrecision!, best.unsupportedPrecision!) || (minPrecision === Math.min(best.supportedPrecision!, best.unsupportedPrecision!) && coverage > best.supportedCoverage! + best.unsupportedCoverage!)) {
        best = {
          supported: supported.threshold,
          unsupported: unsupported.threshold,
          degraded: false,
          supportedCoverage: supported.coverage,
          unsupportedCoverage: unsupported.coverage,
          supportedN: supported.n,
          unsupportedN: unsupported.n,
          supportedPrecision: supported.precision,
          unsupportedPrecision: unsupported.precision,
        };
      }
    }
  }

  if (!best) return fallback;
  return {
    supported: best.supported,
    unsupported: best.unsupported,
    degraded: false,
    supportedCoverage: best.supportedCoverage,
    unsupportedCoverage: best.unsupportedCoverage,
    supportedN: best.supportedN,
    unsupportedN: best.unsupportedN,
    supportedPrecision: best.supportedPrecision,
    unsupportedPrecision: best.unsupportedPrecision,
  };
}

export function wilsonLowerBound(successes: number, total: number): number {
  if (!total) return 0;
  const p = successes / total;
  const z = WILSON_Z_ONE_SIDED_95;
  const denominator = 1 + z * z / total;
  const centre = p + z * z / (2 * total);
  const margin = z * Math.sqrt((p * (1 - p) + z * z / (4 * total)) / total);
  return Math.max(0, (centre - margin) / denominator);
}

export function evaluateThresholdGate(
  samples: CalibrationSample[],
  thresholds: AttributionThresholds,
  targetPrecision: number,
): ThresholdGateResult {
  const supported = samples.filter((sample) => sample.score >= thresholds.supported);
  const unsupported = samples.filter((sample) => sample.score <= thresholds.unsupported);
  const supportedLower = wilsonLowerBound(supported.reduce((sum, sample) => sum + sample.label, 0), supported.length);
  const unsupportedLower = wilsonLowerBound(unsupported.reduce((sum, sample) => sum + (1 - sample.label), 0), unsupported.length);
  const decision =
    thresholds.degraded || !supported.length || !unsupported.length
      ? "warn"
      : supportedLower >= targetPrecision && unsupportedLower >= targetPrecision
        ? "pass"
        : "fail";
  return { decision, supportedWilsonLower: supportedLower, unsupportedWilsonLower: unsupportedLower, targetPrecision };
}

// ADR-0050 D2: binary sens/spec + prevalence as a cross-check on the
// dual-threshold decision, computed on a held-out segment.
export interface ConfusionStats {
  sensitivity: number;
  specificity: number;
  prevalence: number;
  positives: number;
  negatives: number;
  truePositives: number;
  trueNegatives: number;
  falsePositives: number;
  falseNegatives: number;
}

export function confusionStats(samples: CalibrationSample[], thresholds: AttributionThresholds): ConfusionStats {
  let truePositives = 0;
  let trueNegatives = 0;
  let falsePositives = 0;
  let falseNegatives = 0;
  let positives = 0;
  let negatives = 0;
  for (const sample of samples) {
    if (sample.label === 1) {
      positives += 1;
      if (sample.score >= thresholds.supported) truePositives += 1;
      else falseNegatives += 1;
    } else {
      negatives += 1;
      if (sample.score <= thresholds.unsupported) trueNegatives += 1;
      else falsePositives += 1;
    }
  }
  return {
    sensitivity: positives ? truePositives / positives : 0,
    specificity: negatives ? trueNegatives / negatives : 0,
    prevalence: samples.length ? positives / samples.length : 0,
    positives,
    negatives,
    truePositives,
    trueNegatives,
    falsePositives,
    falseNegatives,
  };
}
