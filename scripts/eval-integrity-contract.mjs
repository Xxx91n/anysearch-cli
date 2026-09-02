// ADR-0044 D3: isolated publish-red contract for the eval report's run-level integrity block.
// Ship-gate consumes this helper so the negative case is testable without running the whole gate.
export function evalIntegrityCheck(report) {
  const integrity = report && typeof report === "object" ? report.integrity : undefined;
  if (!integrity || typeof integrity !== "object") {
    return { ok: false, detail: "memory-eval integrity contract missing" };
  }
  // r116 fix: decision-grade runs are the publish boundary (ADR-0044 D3). The verdict
  // producer must not default to "pass" without a valid signal; ship-gate must publish-red
  // when a decision run arrives without an explicit pass verdict from the eval orchestrator.
  // This mirrors K8s PSA enforce/audit and NIST 800-207 PEP enforcement at the decision point.
  if (integrity.verdict !== "pass" && integrity.verdict !== "failed") {
    return { ok: false, detail: "memory-eval integrity verdict invalid: " + integrity.verdict + " (ADR-0044 D3 fail-closed)" };
  }
  if (integrity.runPurpose !== "observational" && integrity.runPurpose !== "decision") {
    return { ok: false, detail: "memory-eval integrity runPurpose invalid: " + integrity.runPurpose };
  }
  if (integrity.runPurpose === "decision" && integrity.verdict !== "failed") {
    return { ok: false, detail: "memory-eval decision-grade integrity verdict not fail-closed (ADR-0044 D3)" };
  }
  if (integrity.verdict === "failed") {
    return { ok: false, detail: "memory-eval integrity verdict failed (ADR-0044 D3 fail-closed)" };
  }
  return { ok: true, detail: "verdict=" + integrity.verdict + " runPurpose=" + integrity.runPurpose };
}
