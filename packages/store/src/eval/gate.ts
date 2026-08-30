// ADR-0027 D4/D9: gate = fail-closed vs baseline, never auto-lowered by CI.
// ADR-0028 D1: integer-op allowance semantics + statistical-power WARN band.
// Exit-code contract (EvalGate-style partition): 0 pass-or-warn / 1 metric regression / 2 internal error / 12 fingerprint mismatch.
import type { EvalMetrics, EvalReport } from "./runner";

export interface EvalBaseline {
  schema: "anysearch/eval-baseline@1";
  fingerprint: string;
  metrics: EvalMetrics;
  // ADR-0028 D1: integer allowances = max tolerated op-level failures per family,
  // calibrated by `eval --calibrate` (worst observed failures + 1). Never fraction margins.
  allowance: { supersessionFails: number; quarantineFp: number };
  // ADR-0036 D4: paired-design calibration derived from the pilot — sigma_d upper 95% CI and
  // the Sakai-locked sample size (n locked ONCE; rawN records the uncapped demand for the report).
  relationGain?: { sigmaDU: number; rawN: number; lockedN: number; minGain: number };
  updatedAt: string;
  note: string;
}

export interface GateResult {
  verdict: "pass" | "warn" | "fail" | "fingerprint_mismatch";
  exitCode: 0 | 1 | 12;
  failures: string[];
  warnings: string[];
}

// Wilson score interval (95%) for a binomial proportion.
export function wilson95(k: number, n: number): [number, number] {
  if (n === 0) return [0, 1];
  const z = 1.96;
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z / denom) * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

// Minimum detectable effect as a failure-count fraction at 80% power, two-sided 95%.
// ponytail: normal approx at p=0.5, (z_a+z_b)*sqrt(p(1-p))/sqrt(n) = (1.96+0.84)*0.5/sqrt(n) = 1.4/sqrt(n).
// Exact binomial power calc would need a dependency; ceiling here = small-n conservatism.
export function mdeFor(n: number): number {
  if (n <= 0) return 0;
  return 1.4 / Math.sqrt(n);
}

// Family size for the gated fraction metrics (passRate is a separate hard gate).
export const GATE_FAMILY_SIZE = 2;

// ---------------- ADR-0036 D4: paired arm-gain statistics ----------------
// Deterministic by construction: fixed seeds, Monte-Carlo counts fixed at 10k/9999,
// and no library dependency (ponytail — n<=80 makes every computation trivial).
const BOOT_B = 9999;
const FLIP_B = 10000;
const STAT_SEED = 0x5eeda36;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function meanOf(xs: number[]): number { return xs.reduce((a, b) => a + b, 0) / xs.length; }
export function sdOf(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = meanOf(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) * (x - m), 0) / (xs.length - 1));
}
function erf(x: number): number {
  // Abramowitz & Stegun 7.1.26 (|err| <= 1.5e-7) — enough for gate decisions.
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-ax * ax);
  return sign * y;
}
function normPhi(z: number): number { return 0.5 * (1 + erf(z / Math.SQRT2)); }
function normQ(p: number): number {
  // ponytail: bisection on the monotone CDF over [-10, 10]; no magic constants needed.
  let lo = -10, hi = 10;
  if (p <= 0) return -10;
  if (p >= 1) return 10;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (normPhi(mid) < p) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}
// Wilson-Hilferty chi-square quantile (lower tail p=0.05 is what sigma-DU needs).
export function chiSquareQuantile(p: number, df: number): number {
  const z = normQ(p);
  const t = 2 / (9 * df);
  return df * Math.pow(1 - t + z * Math.sqrt(t), 3);
}

// Paired MDE (Sakai two-sided 95%, 80% power, paired mean): (z_a + z_b) * sigma_d / sqrt(n).
export function mdeForPaired(n: number, sigmaDU: number): number {
  if (n <= 0 || sigmaDU <= 0) return Number.POSITIVE_INFINITY;
  return 2.8 * sigmaDU / Math.sqrt(n);
}

export interface PairedGainStats { n: number; mean: number; sd: number; bcaLo: number; bcaHi: number; signFlipP: number; degenerate: boolean }

// Paired BCa 95% CI (bootstrap resample + jackknife acceleration) + one-sided sign-flip
// permutation p vs H0 mean <= 0. Degenerate (all-equal) deltas report p=1 and NaN CI.
export function pairedGainStats(deltas: number[]): PairedGainStats | null {
  const n = deltas.length;
  if (n < 2) return null;
  const mean = meanOf(deltas);
  const sd = sdOf(deltas);
  const degenerate = sd === 0;
  const rnd = mulberry32(STAT_SEED);
  // Sign-flip permutation: flip each delta's sign uniformly, recompute mean.
  let flipped = 0;
  const flipRnd = mulberry32(STAT_SEED ^ 0x9e3779b9);
  for (let b = 0; b < FLIP_B; b++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += flipRnd() < 0.5 ? deltas[i]! : -deltas[i]!;
    if (s / n >= mean) flipped++;
  }
  const signFlipP = (flipped + 1) / (FLIP_B + 1);
  if (degenerate) return { n, mean, sd, bcaLo: NaN, bcaHi: NaN, signFlipP, degenerate };
  // Bootstrap means
  const boots = new Array<number>(BOOT_B);
  for (let b = 0; b < BOOT_B; b++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += deltas[Math.floor(rnd() * n)]!;
    boots[b] = s / n;
  }
  boots.sort((a, b) => a - b);
  const below = boots.filter((x) => x < mean).length;
  const z0 = normQ((below + 0.5) / (BOOT_B + 1));
  // Jackknife acceleration
  const jack: number[] = [];
  for (let i = 0; i < n; i++) jack.push((n * mean - deltas[i]!) / (n - 1));
  const jm = meanOf(jack);
  let num = 0, den = 0;
  for (const j of jack) { const d = jm - j; num += d * d * d; den += d * d; }
  const a = den > 0 ? num / (6 * Math.pow(den, 1.5)) : 0;
  const pct = (alpha: number): number => {
    const zA = normQ(alpha);
    const adj = normPhi(z0 + (z0 + zA) / (1 - a * (z0 + zA)));
    const idx = Math.min(BOOT_B - 1, Math.max(0, Math.round(adj * (BOOT_B + 1)) - 1));
    return boots[idx]!;
  };
  return { n, mean, sd, bcaLo: pct(0.05), bcaHi: pct(0.95), signFlipP, degenerate: false };
}

// Sakai topic-set size formula: n = 2 * sigma^2 * (z_a + z_b)^2 / minD^2, capped (ADR-0036 D2).
export const RELATION_GAIN_MIN_GAIN = 0.1;      // MEI = 10pp of the RRF window (~= 6 ranks)
export const RELATION_GAIN_LOCKED_N_CAP = 80;
export function lockN(sigmaDU: number, minGain: number = RELATION_GAIN_MIN_GAIN): { rawN: number; lockedN: number } {
  const rawN = Math.ceil((2 * sigmaDU * sigmaDU * Math.pow(2.8, 2)) / (minGain * minGain));
  return { rawN, lockedN: Math.min(RELATION_GAIN_LOCKED_N_CAP, rawN) };
}

// sigma_d upper 95% CI from the pilot deltas: s^2 * df / chi^2_{0.05}(df), then sqrt.
export function sigmaDUpper(deltas: number[]): number {
  if (deltas.length < 2) return NaN;
  const df = deltas.length - 1;
  const s = sdOf(deltas);
  return s * Math.sqrt(df / chiSquareQuantile(0.05, df));
}

function allowanceCheck(
  label: string, fails: number, n: number, allowance: number, failures: string[], warnings: string[],
): void {
  if (fails <= allowance) return;
  const frac = n > 0 ? allowance / n : 1;
  const mde = mdeFor(n);
  const msg = `${label}: ${fails} failure(s) > allowance ${allowance} (n=${n})`;
  if (frac < mde) {
    // ADR-0028 D1: under-powered allowance — FAIL downgraded to WARN so the metric
    // cannot gate on noise. Widening the golden set restores power.
    warnings.push(`${msg} — DOWNGRADED to WARN: allowance fraction ${frac.toFixed(3)} < MDE ${mde.toFixed(3)} (under-powered; widen the dataset)`);
  } else {
    failures.push(`${msg} (allowance fraction ${frac.toFixed(3)} >= MDE ${mde.toFixed(3)})`);
  }
}

export function evaluateGate(report: EvalReport, baseline: EvalBaseline | null): GateResult {
  if (!baseline) {
    return { verdict: "fail", exitCode: 12, warnings: [], failures: ["baseline missing — run pnpm -C packages/store eval --calibrate (review before commit, ADR-0027 D9 / ADR-0028 D1)"] };
  }
  if (report.datasetFingerprint !== baseline.fingerprint) {
    return { verdict: "fingerprint_mismatch", exitCode: 12, warnings: [], failures: [
      `dataset fingerprint ${report.datasetFingerprint} != baseline ${baseline.fingerprint} — golden set changed; run eval --calibrate and commit the new baseline (ADR-0028 D1)`,
    ] };
  }
  if (!baseline.allowance) {
    return { verdict: "fail", exitCode: 12, warnings: [], failures: ["baseline lacks integer allowance block — regenerate with eval --calibrate (ADR-0028 D1 replaced fraction margins)"] };
  }
  const failures: string[] = [];
  const warnings: string[] = [];
  const m = report.metrics;
  if (m.passRate < 1) failures.push(`passRate ${m.passRate.toFixed(3)} < 1.0 (D4: case lifecycle pass rate must be 100%)`);
  allowanceCheck("supersessionFails", m.counts.supExpected - m.counts.supPassed, m.counts.supExpected, baseline.allowance.supersessionFails, failures, warnings);
  allowanceCheck("quarantineFp", m.counts.fpCount, m.counts.fpEligible, baseline.allowance.quarantineFp, failures, warnings);

  // ADR-0036 D3/D4/D5: relation-arm gain gate — Track A paired counterfactual is the only
  // causal judgment channel; raw historical baselines never gate (ADR-0027 D9).
  const rg = m.relationGain;
  if (rg) {
    const total = rg.n + rg.excluded;
    const exclRate = total > 0 ? rg.excluded / total : 0;
    if (exclRate > 0.2) warnings.push(`relation-gain: exclusion rate ${(exclRate * 100).toFixed(1)}% > 20% — round degraded to WARN (ADR-0036 D5 censoring rule)`);
    const b = baseline.relationGain;
    if (!b) {
      warnings.push("relation-gain: baseline lacks relationGain block — run eval --calibrate to lock n and sigma_d (ADR-0036 D2/D4)");
    } else if (!Number.isFinite(b.sigmaDU) || b.sigmaDU <= 0) {
      warnings.push("relation-gain: pilot was degenerate (sigmaDU=0) — lockedN=" + b.lockedN + " at cap; recalibrate after RoR-heavy golden expansion (ADR-0036 D2)");
    } else if (rg.n < 2) {
      warnings.push(`relation-gain: only ${rg.n} paired sample(s) — cannot run the decision rule (ADR-0036 D4)`);
    } else {
      const st = pairedGainStats(rg.deltas);
      const mdeP = mdeForPaired(rg.n, b.sigmaDU);
      if (!st || st.degenerate) {
        if (st && st.mean > 0) warnings.push(`relation-gain: degenerate sample (sd=0), mean=${st.mean.toFixed(4)} — unverifiable variance, human review (ADR-0036 D4)`);
        else warnings.push(`relation-gain: degenerate sample (sd=0, mean=${st ? st.mean.toFixed(4) : "?"}) — relation arm shows no measurable effect here`);
      } else if (mdeP > b.minGain) {
        warnings.push(
          `relation-gain: paired check UNDER-POWERED (MDE_paired=${mdeP.toFixed(3)} > minGain=${b.minGain}; n=${rg.n}, sigmaDU=${b.sigmaDU.toFixed(3)}) ` +
          `— rule dormant, widen the golden set or accept observational mode (ADR-0036 D4 paired WARN band)`
        );
      } else {
        const passGain = st.bcaLo > 0 && st.mean >= b.minGain && st.signFlipP < 0.05;
        const detail = `relation-gain: mean=${st.mean.toFixed(4)} BCa95=[${st.bcaLo.toFixed(4)}, ${st.bcaHi.toFixed(4)}] signFlipP=${st.signFlipP.toFixed(4)} (minGain=${b.minGain}, n=${st.n})`;
        if (passGain) warnings.push(detail + " — meets the preregistered rule (observational this round; promotion is a separate ADR)");
        else failures.push(detail + " — FAILS preregistered rule: BCa lower bound > 0 AND mean >= minGain AND signFlip p < 0.05 (ADR-0036 D4)");
      }
      // ADR-0036 D5 sanity channel (never gates): the two anomaly combos raise WARN + human review.
      const rel = m.relation;
      if (rel && rel.hopChecks > 0) {
        if (rel.hopHitRate >= 0.5 && Math.abs(rg.meanDelta) < 1 / 60) warnings.push("relation-gain sanity: high 1-hop hit-rate but ~zero RoR delta (hits but useless) — human review (ADR-0036 D5)");
        else if (rel.hopHitRate === 0 && Math.abs(rg.meanDelta) >= 1 / 60) warnings.push("relation-gain sanity: 0 hop hit-rate but RoR delta shifted ranking (arm idle but ranking moved) — human review (ADR-0036 D5)");
      }
    }
  }
  // ADR-0037 D6 Phase-2: semantic arm live (weight 0.5, conditional activation) —
  // regression gate fail-closed on per-case RoR counterfactual; gain is observation-zone only
  // (promotion threshold preregistered in ADR-0036 formula, promoted after one window).
  if (m.semantic) {
    if (m.semantic.regressions > 0)
      failures.push(`semantic-arm: ${m.semantic.regressions} case(s) where the semantic arm worsened the fused rank of the expected memory vs the five-arm baseline — serve is forbidden from regressing (ADR-0037 D6 Phase-2)`);
    if (m.semantic.gain)
      warnings.push(`semantic-gain: n=${m.semantic.gain.n} meanDelta=${m.semantic.gain.meanDelta.toFixed(4)} — observational (Phase-2 cite; promotion after one window, ADR-0037 D6)`);
  }
  if (m.forget && m.forget.archiveChecks > 0) {
    if (m.forget.dryRunExact < m.forget.archiveChecks) failures.push(`forget: ${m.forget.dryRunExact}/${m.forget.archiveChecks} archive ops had exact dry-run===apply (D7-6 violated)`);
    if (m.forget.undoRestores === 0) warnings.push("forget: no undo restores observed (D5 reversibility untested this round)");
  }
  const verdict: GateResult["verdict"] = failures.length ? "fail" : warnings.length ? "warn" : "pass";
  return { verdict, exitCode: failures.length ? 1 : 0, failures, warnings };
}
