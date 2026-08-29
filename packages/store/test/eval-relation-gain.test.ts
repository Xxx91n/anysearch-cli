// ADR-0036 (r33) impl: relation-arm gain gate self-check.
// Covers paired-stats formulas (D2), the preregistered decision rule both directions (D4),
// the sanity channel (D5), and an end-to-end counterfactual recompute on a real RoR case.
import { evaluateGate, lockN, mdeForPaired, pairedGainStats, sigmaDUpper, RELATION_GAIN_LOCKED_N_CAP, type EvalBaseline } from "../src/eval/gate";
import { runCase, type EvalMetrics, type EvalReport } from "../src/eval/runner";
import { GOLDEN_CASES } from "../src/eval/golden-cases";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return; }
  passed++;
}

function mkMetrics(relDeltas: number[], extra: { meanDelta?: number; hopChecks?: number; hopHitRate?: number } = {}): EvalMetrics {
  return {
    passRate: 1, supersessionSuccess: 1, quarantineFalsePositiveRate: 0,
    counts: { cases: 20, casesPassed: 20, supExpected: 12, supPassed: 12, fpEligible: 4, fpCount: 0 },
    mrr: 1, answerableFalseRefusalRate: 0,
    relationGain: { n: relDeltas.length, excluded: 0, meanDelta: extra.meanDelta ?? (relDeltas.reduce((a, b) => a + b, 0) / Math.max(1, relDeltas.length)), deltas: relDeltas },
    ...(extra.hopChecks !== undefined ? { relation: { noEdgeChecks: 0, noEdgeViolations: 0, hopChecks: extra.hopChecks, hopHits: Math.round(extra.hopChecks * (extra.hopHitRate ?? 0)), hopHitRate: extra.hopHitRate ?? 0, tel: { ruleHits: 0, llmActivations: 0, llmFailures: 0, triplesWritten: 0, dedupSkipped: 0, relatedToWriteOnce: 0, schemaRejected: 0, armQueries: 0, armHits: 0 } } } : {}),
  } as unknown as EvalMetrics;
}

function fakeReport(metrics: EvalMetrics): EvalReport {
  return {
    schema: "anysearch/eval-report@1", generatedAt: "ts", datasetFingerprint: "fp-r33",
    totals: { cases: 20, passed: 20, failed: 0 },
    stageBreakdown: { extract: 0, adjudicate: 0, store: 0, retrieve: 0 },
    tierBreakdown: { core: { cases: 20, passed: 20, passRate: 1 } },
    metrics,
    cases: [],
  };
}

function mkBaseline(sigmaDU: number): EvalBaseline {
  const { rawN, lockedN } = lockN(sigmaDU);
  return {
    schema: "anysearch/eval-baseline@1", fingerprint: "fp-r33", metrics: mkMetrics([]),
    allowance: { supersessionFails: 1, quarantineFp: 1 },
    relationGain: { sigmaDU, rawN, lockedN, minGain: 0.1 },
    updatedAt: "2026-08-29", note: "test fixture",
  };
}

// --- D2: paired-stats formulas ---
assert(Math.abs(mdeForPaired(16, 1) - 0.7) < 1e-9, "mdeForPaired(16,1) == 0.7 (2.8*1/4)");
assert(mdeForPaired(0, 1) === Number.POSITIVE_INFINITY, "mdeForPaired(0,1) = Infinity");
assert(pairedGainStats([0.1]) === null, "pairedGainStats rejects n<2");
const det = pairedGainStats([0.1, 0.16, 0.12, 0.18, 0.14, 0.11, 0.15, 0.13]);
const det2 = pairedGainStats([0.1, 0.16, 0.12, 0.18, 0.14, 0.11, 0.15, 0.13]);
assert(det !== null && JSON.stringify(det) === JSON.stringify(det2), "pairedGainStats deterministic (seeded PRNG)");
assert(det !== null && det.bcaLo < det.mean && det.mean < det.bcaHi, "BCa bracket contains the mean");
assert(det !== null && det.signFlipP < 0.01, "sign-flip p small for clearly positive sample");
const deg = pairedGainStats([2, 2, 2]); // exactly-representable ints so sd is exactly 0
assert(deg !== null && deg.degenerate && Number.isNaN(deg.bcaLo), "all-equal sample is degenerate with NaN CI");
assert(lockN(10).lockedN === RELATION_GAIN_LOCKED_N_CAP, "lockN caps at " + RELATION_GAIN_LOCKED_N_CAP);
assert(lockN(0.05).rawN === 4, "lockN(0.05) rawN = ceil(2*0.0025*7.84/0.01) = ceil(3.92) = 4");
assert(sigmaDUpper([0.1, 0.2, 0.15, 0.12]) > 0.036, "sigmaDUpper is an upper CI on sd");

// --- D4: decision rule, both directions ---
{
  const deltas = [0.14, 0.16, 0.15, 0.13, 0.17, 0.14, 0.16, 0.15, 0.14, 0.16, 0.15, 0.14];
  const g = evaluateGate(fakeReport(mkMetrics(deltas)), mkBaseline(0.05));
  assert(g.exitCode === 0, "positive-paired sample passes (exit 0, observational WARN allowed)");
  assert(g.warnings.some((w) => w.includes("observational")), "positive sample reports observational WARN");
}
{
  const deltas = [0.04, 0.06, 0.05, 0.05, 0.06, 0.04, 0.05, 0.06, 0.05, 0.04, 0.06, 0.05];
  const g = evaluateGate(fakeReport(mkMetrics(deltas)), mkBaseline(0.05));
  assert(g.exitCode === 1 && g.failures.some((f) => f.includes("FAILS preregistered")), "point estimate below minGain must FAIL even when CI excludes 0");
}
{
  const g = evaluateGate(fakeReport(mkMetrics([0.3, -0.1, 0.2])), mkBaseline(2));
  assert(g.exitCode === 0 && g.warnings.some((w) => w.includes("UNDER-POWERED")), "tiny n + huge sigmaDU -> under-powered WARN, never gate on noise");
}
{
  const g = evaluateGate(fakeReport(mkMetrics([0, 0, 0, 0])), mkBaseline(0.05));
  assert(g.exitCode === 0 && g.warnings.some((w) => w.includes("degenerate")), "all-zero sample -> degenerate WARN");
}
{
  const g = evaluateGate(fakeReport(mkMetrics([0, 0, 0, 0], { meanDelta: 0, hopChecks: 6, hopHitRate: 1 })), mkBaseline(0.05));
  assert(g.warnings.some((w) => w.includes("hits but useless")), "sanity channel: high hop hit-rate + zero delta raises WARN");
}

// --- D5: end-to-end counterfactual on a real RoR golden case ---
{
  const spec = GOLDEN_CASES.find((c) => c.id === "rel33_ror_works_on_00");
  assert(spec !== undefined, "RoR golden case exists");
  const res = await runCase(spec!);
  assert(res.passed, "RoR case passes: " + (res.failedStage ?? ""));
  const searchOp = res.ops.find((o) => o.kind === "search");
  assert(searchOp !== undefined && typeof searchOp.rorRankOn === "number" && typeof searchOp.rorRankOff === "number", "counterfactual ranks recorded");
  assert((searchOp!.rorRankOff ?? 0) > (searchOp!.rorRankOn ?? 0), "dropping the relation arm worsens the target rank (off " + searchOp!.rorRankOff + " > on " + searchOp!.rorRankOn + ")");
}

console.log("eval-relation-gain.test.ts: " + passed + " passed, " + failed + " failed");
if (failed > 0) process.exit(1);
