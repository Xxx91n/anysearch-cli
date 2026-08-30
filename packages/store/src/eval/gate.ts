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
  // ADR-0038 D5: second fingerprint — covers frozen holdout ids + backflow slice family.
  holdoutFingerprint: string;
  updatedAt: string;
  note: string;
}

export interface GateResult {
  verdict: "pass" | "warn" | "fail" | "fingerprint_mismatch";
  exitCode: 0 | 1 | 12;
  failures: string[];
  warnings: string[];
  // ADR-0038 D2: independent three-tier gain conclusion; NOT merged into exitCode.
  gainConclusion?: GainConclusion;
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
export function normPhi(z: number): number { return 0.5 * (1 + erf(z / Math.SQRT2)); }
export function normQ(p: number): number {
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

export interface PairedGainStats { n: number; mean: number; sd: number; bcaLo: number; bcaHi: number; signFlipP: number; signFlipHarmP: number; degenerate: boolean }

// Paired BCa 95% CI (bootstrap resample + jackknife acceleration) + one-sided sign-flip
// permutation p vs H0 mean <= 0. Degenerate (all-equal) deltas report p=1 and NaN CI.
export function pairedGainStats(deltas: number[], alpha: number = 0.05): PairedGainStats | null {
  const n = deltas.length;
  if (n < 2) return null;
  const mean = meanOf(deltas);
  const sd = sdOf(deltas);
  const degenerate = sd === 0;
  const rnd = mulberry32(STAT_SEED);
  // Sign-flip permutation: flip each delta's sign uniformly, recompute mean.
  // signFlipP = one-sided evidence of GAIN (H0: mean <= 0); signFlipHarmP = evidence
  // of HARM (H0: mean >= 0). ADR-0038 D2: only harm-side significance may paint the gate red.
  let flipped = 0;
  let flippedHarm = 0;
  const flipRnd = mulberry32(STAT_SEED ^ 0x9e3779b9);
  for (let b = 0; b < FLIP_B; b++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += flipRnd() < 0.5 ? deltas[i]! : -deltas[i]!;
    if (s / n >= mean) flipped++;
    if (s / n <= mean) flippedHarm++;
  }
  const signFlipP = (flipped + 1) / (FLIP_B + 1);
  const signFlipHarmP = (flippedHarm + 1) / (FLIP_B + 1);
  if (degenerate) return { n, mean, sd, bcaLo: NaN, bcaHi: NaN, signFlipP, signFlipHarmP, degenerate };
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
  return { n, mean, sd, bcaLo: pct(alpha), bcaHi: pct(1 - alpha), signFlipP, signFlipHarmP, degenerate: false };
}


// ---------------------------------------------------------------------------
// ADR-0038 D4: preregistered Lan-DeMets O'Brien-Fleming alpha-spending (one-sided,
// alpha=0.025 per OF track; family budget alpha_1+alpha_2 <= 0.05 per ADR-0038 D5).
// Formula (gsDesign sfLDOF / MetricGate verified, r97 atomcode):
//   alpha*(t) = 2 * (1 - Phi(z_{1-alpha/2} / sqrt(t)))  // one-sided level alpha, t = k/K_max
// k_max convergence clause: after K_MAX looks the claim is either established (promoted to
// constant SPC monitoring, no further significance retesting) or unproven (arm demoted).
// Naive uncorrected FWER at k=10 equal looks ~= 40%; the table keeps the family bound 0.05.
// H0-simulation calibration of these boundaries lives in test/eval-holdout-gate.test.ts.
// ---------------------------------------------------------------------------
export const OF_K_MAX = 5;
export const OF_TRACK_ALPHA = 0.025;
export function ofSpentAlpha(t: number, alpha: number = OF_TRACK_ALPHA): number {
  if (t <= 0) return 0;
  if (t > 1) t = 1;
  return 2 * (1 - normPhi(normQ(1 - alpha / 2) / Math.sqrt(t)));
}
export interface OfLookRow { look: number; t: number; alphaCum: number; alphaInc: number }
export function ofTable(kMax: number = OF_K_MAX, alpha: number = OF_TRACK_ALPHA): OfLookRow[] {
  const rows: OfLookRow[] = [];
  let prev = 0;
  for (let k = 1; k <= kMax; k++) {
    const alphaCum = ofSpentAlpha(k / kMax, alpha);
    rows.push({ look: k, t: k / kMax, alphaCum, alphaInc: alphaCum - prev });
    prev = alphaCum;
  }
  return rows;
}

// ADR-0038 D7: semantic-arm OF family registered as an inert placeholder this round —
// name/alpha/axes preregistered, NOT computed and NOT spent. Activation needs labels past the
// Sakai power threshold AND judge-vs-human kappa at the ADR-0029 bar.
export const SEMANTIC_OF_PLACEHOLDER = {
  name: "semantic-arm-gain",
  alpha: OF_TRACK_ALPHA,
  family: "lan-demets-obrien-fleming",
  axes: ["sign-flip p", "BCa confidence"],
  inert: true,
  activation: "graded-label coverage past Sakai power threshold AND judge kappa CI >= 0.6 (ADR-0029)",
} as const;

// ADR-0038 D2: independent gain-gate conclusion (exit-code decoupled; ship-gate enforces).
export interface GainZoneSnapshot {
  n: number; mean: number; bcaLo: number; bcaHi: number; signFlipP: number; signFlipHarmP: number;
}
export interface GainHoldoutSnapshot extends GainZoneSnapshot { mde: number; underpowered: boolean }
export interface GainConclusion {
  tier: "green" | "warn" | "red";
  look: number;
  kMax: number;
  alphaThreshold: number;
  spentAlpha: number;
  full?: GainZoneSnapshot & { passAtLook: boolean };
  holdout?: GainHoldoutSnapshot;
  reasons: string[];
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

export interface EvaluateGateOptions { look?: number; kMax?: number }
export function evaluateGate(report: EvalReport, baseline: EvalBaseline | null, opts: EvaluateGateOptions = {}): GateResult {
  if (!baseline) {
    return { verdict: "fail", exitCode: 12, warnings: [], failures: ["baseline missing — run pnpm -C packages/store eval --calibrate (review before commit, ADR-0027 D9 / ADR-0028 D1)"] };
  }
  if (report.datasetFingerprint !== baseline.fingerprint) {
    return { verdict: "fingerprint_mismatch", exitCode: 12, warnings: [], failures: [
      `dataset fingerprint ${report.datasetFingerprint} != baseline ${baseline.fingerprint} — golden set changed; run eval --calibrate and commit the new baseline (ADR-0028 D1)`,
    ] };
  }
  // ADR-0038 D5 dual-track: holdout-family fingerprint enforced as fail-closed as the dataset one.
  if (!baseline.holdoutFingerprint || report.holdoutFingerprint !== baseline.holdoutFingerprint) {
    return { verdict: "fingerprint_mismatch", exitCode: 12, warnings: [], failures: [
      "holdout-family fingerprint " + report.holdoutFingerprint + " != baseline " + (baseline.holdoutFingerprint ?? "<missing>") + " — holdout/backflow change = golden change = fingerprint flip + recalibration (ADR-0038 D5)"
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

  // ADR-0038 D2/D4/D5/D6 (supersedes ADR-0036 observational channel): three-tier gain gate.
  // Track A paired counterfactual remains the only causal channel; regression metrics above are
  // unchanged. green = full-sample preregistered rule at the OF look-k threshold AND holdout no
  // contradiction; WARN = unproven-degenerate-underpowered-or-contradicted; red = PROVEN-NEGATIVE
  // ONLY (BCa upper < 0 or harm-side sign-flip p < alpha_k) — unproven-positive is never red.
  // The conclusion ships as gate.gainConclusion (exit-code decoupling); ship-gate enforces it.
  let gainConclusion: GainConclusion | undefined;
  const rg = m.relationGain;
  if (rg) {
    const look = Math.max(1, opts.look ?? 1);
    const kMax = opts.kMax ?? OF_K_MAX;
    const alphaK = ofSpentAlpha(Math.min(look, kMax) / kMax);
    const spentAlpha = alphaK;
    const b = baseline.relationGain;
    const rgH = m.relationGainHoldout;
    const reasons: string[] = [];
    let harm = false;
    let warn = false;
    let fullPass = false;
    let fullSnap: GainConclusion["full"] = undefined;
    let holdoutSnap: GainConclusion["holdout"] = undefined;
    const total = rg.n + rg.excluded;
    if (total > 0 && rg.excluded / total > 0.2) {
      warn = true;
      reasons.push("full-sample exclusion rate " + (rg.excluded / total * 100).toFixed(1) + "% > 20% (ADR-0036 D5 censoring rule)");
    }
    if (rgH) {
      const totalH = rgH.n + rgH.excluded;
      if (totalH > 0 && rgH.excluded / totalH > 0.2) {
        warn = true;
        reasons.push("holdout exclusion rate " + (rgH.excluded / totalH * 100).toFixed(1) + "% > 20% (ADR-0038 D2 WARN)");
      }
    }
    if (!b) {
      warn = true;
      reasons.push("baseline lacks relationGain block — run eval --calibrate (ADR-0036 D2)");
    } else if (rg.n < 2) {
      warn = true;
      reasons.push("only " + rg.n + " paired sample(s) — cannot run the decision rule (ADR-0036 D4)");
    } else {
      const stF = pairedGainStats(rg.deltas, alphaK);
      if (!stF || stF.degenerate) {
        warn = true;
        reasons.push("full sample degenerate (sd=0), mean=" + (stF ? stF.mean.toFixed(4) : "?") + " — unverifiable variance, human review (ADR-0036 D4)");
      } else {
        fullPass = stF.bcaLo > 0 && stF.mean >= b.minGain && stF.signFlipP < alphaK;
        harm = stF.bcaHi < 0 || stF.signFlipHarmP < alphaK;
        fullSnap = { n: stF.n, mean: stF.mean, bcaLo: stF.bcaLo, bcaHi: stF.bcaHi, signFlipP: stF.signFlipP, signFlipHarmP: stF.signFlipHarmP, passAtLook: fullPass };
        const df = "full: mean=" + stF.mean.toFixed(4) + " BCa=[" + stF.bcaLo.toFixed(4) + ", " + stF.bcaHi.toFixed(4) + "] signFlipP=" + stF.signFlipP.toFixed(5) + " harmP=" + stF.signFlipHarmP.toFixed(5) + " alpha(" + look + "/" + kMax + ")=" + alphaK.toFixed(6);
        if (harm) reasons.push(df + " — PROVEN-NEGATIVE on the full sample (ADR-0038 D2 red)");
        else if (fullPass) reasons.push(df + " — preregistered rule holds at look " + look + "/" + kMax);
        else { warn = true; reasons.push(df + " — rule not established at this look's alpha; unproven-positive is never red (ADR-0038 D2)"); }
      }
      if (!rgH) {
        warn = true;
        reasons.push("holdout sample missing from metrics — three-tier gate cannot run contradiction check (ADR-0038 D3 report contract)");
      } else if (rgH.n < 2) {
        warn = true;
        reasons.push("holdout has " + rgH.n + " pair(s) < 2 — no contradiction check possible (ADR-0038 D2 WARN)");
      } else {
        const stH = pairedGainStats(rgH.deltas, alphaK);
        const mdeH = mdeForPaired(rgH.n, b.sigmaDU);
        const under = mdeH > b.minGain;
        holdoutSnap = stH
          ? { n: stH.n, mean: stH.mean, bcaLo: stH.bcaLo, bcaHi: stH.bcaHi, signFlipP: stH.signFlipP, signFlipHarmP: stH.signFlipHarmP, mde: mdeH, underpowered: under }
          : { n: rgH.n, mean: rgH.meanDelta, bcaLo: NaN, bcaHi: NaN, signFlipP: NaN, signFlipHarmP: NaN, mde: mdeH, underpowered: under };
        if (stH && stH.degenerate) { warn = true; reasons.push("holdout degenerate (sd=0) — no-contradiction check unavailable; GREEN requires a live holdout (ADR-0038 D2)"); }
        if (stH && !stH.degenerate && (stH.bcaHi < 0 || stH.signFlipHarmP < alphaK)) {
          harm = true;
          reasons.push("holdout: mean=" + stH.mean.toFixed(4) + " BCa=[" + stH.bcaLo.toFixed(4) + ", " + stH.bcaHi.toFixed(4) + "] harmP=" + stH.signFlipHarmP.toFixed(5) + " — PROVEN-NEGATIVE on the frozen holdout (ADR-0038 D2 red)");
        }
        if (under) { warn = true; reasons.push("holdout underpowered: MDE_paired=" + mdeH.toFixed(3) + " > minGain=" + b.minGain + " (n=" + rgH.n + ", sigmaDU=" + b.sigmaDU + ") — WARN per ADR-0038 D2"); }
        if (stH && !stH.degenerate && fullPass && stH.mean <= 0) { warn = true; reasons.push("full sample passes but holdout mean <= 0 — gain may contain overfit (ADR-0038 D2 WARN)"); }
        if (stH && !stH.degenerate && !harm && !under && !(fullPass && stH.mean <= 0)) reasons.push("holdout: mean=" + stH.mean.toFixed(4) + " n=" + rgH.n + " MDE=" + mdeH.toFixed(3) + " — no contradiction (holdout significance not required)");
      }
    }
    if (look > kMax) {
      warn = true;
      reasons.push("k_max convergence clause: look " + look + " > " + kMax + " — promote to constant SPC monitoring or demote the arm; no further significance retesting (ADR-0038 D4)");
    }
    const tier: GainConclusion["tier"] = harm ? "red" : (warn || !fullPass) ? "warn" : "green";
    gainConclusion = { tier, look, kMax, alphaThreshold: alphaK, spentAlpha, full: fullSnap, holdout: holdoutSnap, reasons };
    for (const r of reasons) warnings.push("relation-gain[" + tier + "] " + r);
    // ADR-0036 D5 sanity channel (observational, still independent of the tier).
    const rel = m.relation;
    if (rel && rel.hopChecks > 0) {
      if (rel.hopHitRate >= 0.5 && Math.abs(rg.meanDelta) < 1 / 60) warnings.push("relation-gain sanity: high 1-hop hit-rate but ~zero RoR delta (hits but useless) — human review (ADR-0036 D5)");
      else if (rel.hopHitRate === 0 && Math.abs(rg.meanDelta) >= 1 / 60) warnings.push("relation-gain sanity: 0 hop hit-rate but RoR delta shifted ranking (arm idle but ranking moved) — human review (ADR-0036 D5)");
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
  return { verdict, exitCode: failures.length ? 1 : 0, failures, warnings, ...(gainConclusion ? { gainConclusion } : {}) };
}
