// ADR-0027 impl plan step 7: runner self-check (path 1/3).
// Verifies: golden set shape, runCase pass on golden spec, stage attribution on failure, metrics, fingerprint stability.
import { GOLDEN_CASES } from "../src/eval/golden-cases";
import { computeMetrics, datasetFingerprint, runCase, runAll } from "../src/eval/runner";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return; }
  passed++;
}

async function main() {
  // Shape: 123 cases (ADR-0028: +15 D3/D4 slices; ADR-0031: +4 entity group; ADR-0033: +2 semantic; ADR-0035: +12 relations; ADR-0036: +66 RoR/alias/no-edge expansion; ADR-0037: +4 consolidate/forget groups), 14 groups, every op has a stage.
  assert(GOLDEN_CASES.length === 123, "123 golden cases (got " + GOLDEN_CASES.length + ")");
  const groups = new Set(GOLDEN_CASES.map((c) => c.group));
  assert(groups.size === 14, "14 groups (got " + groups.size + ")");
  assert(GOLDEN_CASES.every((c) => c.ops.every((o) => typeof o.stage === "string")), "every op carries a stage");

  // Fingerprint stable across calls, changes when dataset changes.
  const fp1 = datasetFingerprint(GOLDEN_CASES);
  const fp2 = datasetFingerprint(GOLDEN_CASES);
  assert(fp1 === fp2 && fp1.length === 16, "fingerprint stable 16-hex");
  const mutated = GOLDEN_CASES.map((c) => ({ ...c }));
  mutated[0]!.id = "tampered";
  assert(datasetFingerprint(mutated) !== fp1, "fingerprint changes on dataset mutation");

  // Full golden suite passes as-is (this IS the calibration assert).
  const report = await runAll(GOLDEN_CASES);
  assert(report.totals.failed === 0, "all golden cases PASS (failed: " + report.cases.filter((c) => !c.passed).map((c) => c.id + "@" + c.failedStage).join(", ") + ")");
  assert(report.metrics.passRate === 1, "passRate 1.0");
  assert(report.datasetFingerprint === fp1, "report fingerprint matches dataset");
{
  // r110 SP-F-01: consumed track exposes REAL gate numbers + the data-absence signal.
  const ob = report.metrics.observational;
  assert(!!ob && ob.track === "consumed", "zone track = consumed (no fixture env)");
  assert(typeof ob!.dataAbsent === "boolean", "dataAbsent marker present");
  assert(typeof ob!.fixtureDefinitionHash === "string", "fixtureDefinitionHash pinned in zone");
  assert(ob!.dataAbsent === true, "golden run is structurally data-absent (single-run window can never reach 90d / 100 fittable units)");
  const bk = (ob!.bgnbd as { status?: string; reason?: string });
  assert(bk.status === "skipped" && String(bk.reason).includes("structural data absence"), "report zone labels the absence explicitly (SA-F-05)");
}
  assert(Boolean(report.tierBreakdown.adversarial && report.tierBreakdown.hard), "ADR-0028 D4: tier breakdown present");
  assert(report.metrics.counts && typeof report.metrics.mrr === "number", "ADR-0028 D1/D2: counts + mrr present");

  // Stage attribution: force a retrieve-stage failure, assert failedStage === retrieve.
  const broken = [{
    id: "t_broken", group: "supersession" as const, description: "forced retrieve failure",
    ops: [
      { op: "adjudicate" as const, stage: "adjudicate" as const, items: [{ url: "https://ex.com/x", title: "ttoken marker", snippet: "ttoken marker wording", source: "exa", evidence: 0.9, entity: "ttoken" }], expect: ["accept" as const] },
      { op: "search" as const, stage: "retrieve" as const, query: "ttoken", expectIncludesTitle: "definitely-absent-title" },
    ],
  }];
  const r = await runCase(broken[0]!);
  assert(!r.passed && r.failedStage === "retrieve", "retrieve failure attributed to retrieve stage (got " + r.failedStage + ")");

  // Metrics: supersession success counts only supersede-expected ops.
  const m = computeMetrics(GOLDEN_CASES, report.cases);
  assert(m.supersessionSuccess === 1, "supersessionSuccess 1.0");
  assert(m.quarantineFalsePositiveRate === 0, "qfp 0.0");

  console.log("eval-runner.test.ts: " + passed + " passed, " + failed + " failed");
  if (failed > 0) process.exit(1);
}
main();
