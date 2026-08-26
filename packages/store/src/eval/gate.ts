// ADR-0027 D4/D9: gate = baseline - margin, deterministic fail-closed, never auto-lowered by CI.
// Exit-code contract (EvalGate-style partition): 0 pass / 1 metric regression / 2 internal error / 12 fingerprint mismatch.
import type { EvalMetrics, EvalReport } from "./runner";

export interface EvalBaseline {
  schema: "anysearch/eval-baseline@1";
  fingerprint: string;
  metrics: EvalMetrics;
  margin: { supersession: number; quarantineFp: number };
  updatedAt: string;
  note: string;
}

export interface GateResult {
  verdict: "pass" | "fail" | "fingerprint_mismatch";
  exitCode: 0 | 1 | 12;
  failures: string[];
}

export function evaluateGate(report: EvalReport, baseline: EvalBaseline | null): GateResult {
  if (!baseline) {
    return { verdict: "fail", exitCode: 12, failures: ["baseline missing — run pnpm -C packages/store eval --write-baseline (review before commit, ADR-0027 D9)"] };
  }
  if (report.datasetFingerprint !== baseline.fingerprint) {
    return { verdict: "fingerprint_mismatch", exitCode: 12, failures: [
      `dataset fingerprint ${report.datasetFingerprint} != baseline ${baseline.fingerprint} — golden set changed; recalibrate and commit new baseline (ADR-0027 D9)`,
    ] };
  }
  const failures: string[] = [];
  const m = report.metrics;
  if (m.passRate < 1) failures.push(`passRate ${m.passRate.toFixed(3)} < 1.0 (D4: case lifecycle pass rate must be 100%)`);
  const supFloor = baseline.metrics.supersessionSuccess - baseline.margin.supersession;
  if (m.supersessionSuccess < supFloor - 1e-9) failures.push(`supersessionSuccess ${m.supersessionSuccess.toFixed(3)} < ${supFloor.toFixed(3)} (baseline - margin)`);
  const qfpCeil = baseline.metrics.quarantineFalsePositiveRate + baseline.margin.quarantineFp;
  if (m.quarantineFalsePositiveRate > qfpCeil + 1e-9) failures.push(`quarantineFalsePositiveRate ${m.quarantineFalsePositiveRate.toFixed(3)} > ${qfpCeil.toFixed(3)} (baseline + margin)`);
  return { verdict: failures.length ? "fail" : "pass", exitCode: failures.length ? 1 : 0, failures };
}
