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
  const verdict: GateResult["verdict"] = failures.length ? "fail" : warnings.length ? "warn" : "pass";
  return { verdict, exitCode: failures.length ? 1 : 0, failures, warnings };
}
