// ADR-0038 impl: OF alpha-spending, dual-track holdout, three-tier mapping, H0 FWER sim, nDCG@k.
import { evaluateGate, lockN, mdeForPaired, pairedGainStats, ofSpentAlpha, ofTable, OF_K_MAX, OF_TRACK_ALPHA, type EvalBaseline } from "../src/eval/gate";
import { ndcgAtK, type EvalMetrics, type EvalReport } from "../src/eval/runner";
import { GOLDEN_CASES } from "../src/eval/golden-cases";
import { HOLDOUT_IDS, HOLDOUT_VERSION, isHoldout, assertBackflowNoOverlap, holdoutFingerprint, caseInputHash, BACKFLOW_SLICES, type BackflowSlice } from "../src/eval/holdout";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return; }
  passed++;
}

function mkMetrics(full: number[], hold: number[] | null, extra: { excluded?: number; holdExcluded?: number } = {}): EvalMetrics {
  const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  return {
    passRate: 1, supersessionSuccess: 1, quarantineFalsePositiveRate: 0,
    counts: { cases: 120, casesPassed: 120, supExpected: 12, supPassed: 12, fpEligible: 4, fpCount: 0 },
    mrr: 1, answerableFalseRefusalRate: 0,
    relationGain: { n: full.length, excluded: extra.excluded ?? 0, meanDelta: mean(full), deltas: full },
    ...(hold ? { relationGainHoldout: { n: hold.length, excluded: extra.holdExcluded ?? 0, meanDelta: mean(hold), deltas: hold } } : {}),
    semantic: { queries: 1, hits: 1, served: 1, regressions: 0 },
    forget: { archiveChecks: 0, archives: 0, undoRestores: 0, dryRunExact: 0 },
  } as unknown as EvalMetrics;
}

function fakeReport(metrics: EvalMetrics): EvalReport {
  return {
    schema: "anysearch/eval-report@1", generatedAt: "ts",
    datasetFingerprint: "fp-t38", holdoutFingerprint: "test-hfp",
    totals: { cases: 120, passed: 120, failed: 0 },
    stageBreakdown: { extract: 0, adjudicate: 0, store: 0, retrieve: 0 },
    tierBreakdown: { core: { cases: 120, passed: 120, passRate: 1 } },
    metrics, cases: [],
  };
}

function mkBaseline(sigmaDU: number): EvalBaseline {
  const { rawN, lockedN } = lockN(sigmaDU);
  return {
    schema: "anysearch/eval-baseline@1", fingerprint: "fp-t38", holdoutFingerprint: "test-hfp", metrics: mkMetrics([], null),
    allowance: { supersessionFails: 1, quarantineFp: 1 },
    relationGain: { sigmaDU, rawN, lockedN, minGain: 0.1 },
    updatedAt: "2026-08-30", note: "test fixture",
  };
}

// --- holdout freeze set ---
{
  const ids = new Set(GOLDEN_CASES.map((c) => c.id));
  assert(HOLDOUT_IDS.length === 40, "holdout has exactly 40 frozen ids");
  assert(HOLDOUT_IDS.every((x) => ids.has(x)), "every holdout id exists in the golden set");
  const rorHold = HOLDOUT_IDS.filter((x) => x.startsWith("rel33_ror_"));
  assert(rorHold.length === 19, "19 RoR pairs frozen into the holdout (15 EN even + 4 CN even)");
  const h1 = holdoutFingerprint();
  assert(h1 === holdoutFingerprint() && h1.length === 16, "holdout fingerprint deterministic 16-hex");
  assert(HOLDOUT_VERSION === "baseline-v1", "holdout version pinned baseline-v1");
}

// --- backflow overlap guard (negative included) ---
{
  assertBackflowNoOverlap(GOLDEN_CASES); // empty family passes
  const fresh = { ...structuredClone(GOLDEN_CASES[0]!), id: "backflow_probe_1" };
  (BACKFLOW_SLICES as BackflowSlice[]).push({ schema: "anysearch/holdout-slice@1", sliceId: "probe-0", backflowRound: "test", addedAt: "2026-08-30", items: [{ inputHash: caseInputHash(fresh), sourceTraceId: "t", payload: fresh }] });
  assertBackflowNoOverlap(GOLDEN_CASES); // a genuinely new case does NOT overlap the baseline
  const dupe = GOLDEN_CASES[0]!;
  (BACKFLOW_SLICES as BackflowSlice[]).push({ schema: "anysearch/holdout-slice@1", sliceId: "probe-1", backflowRound: "test", addedAt: "2026-08-30", items: [{ inputHash: caseInputHash(dupe), sourceTraceId: "t", payload: dupe }] });
  let threw = false;
  try { assertBackflowNoOverlap(GOLDEN_CASES); } catch { threw = true; }
  assert(threw, "duplicating a baseline-golden case into a backflow slice throws (ADR-0038 D5)");
  (BACKFLOW_SLICES as unknown as unknown[]).length = 0; // restore the empty family
}

// --- OF spending table ---
{
  assert(Math.abs(ofSpentAlpha(1) - OF_TRACK_ALPHA) < 1e-9, "OF table spends exactly the track alpha at t=1");
  const rows = ofTable(OF_K_MAX);
  assert(rows.length === OF_K_MAX, "ofTable has k_max rows");
  let prev = 0; let mono = true;
  for (const r of rows) { if (r.alphaCum <= prev) mono = false; prev = r.alphaCum; }
  assert(mono, "cumulative spent alpha strictly increases per look");
  assert(Math.abs(rows[OF_K_MAX - 1]!.alphaCum - OF_TRACK_ALPHA) < 1e-9, "family budget fully spent (not exceeded) by look k_max");
  assert(rows[0]!.alphaCum < 0.001, "OF first-look boundary is extreme-conservative (" + rows[0]!.alphaCum.toExponential(2) + ")");
}

// --- three-tier mapping ---
{
  // green at the final preregistered look: strong positive full + holdout aligned
  const pos = [0.14, 0.16, 0.15, 0.13, 0.17, 0.14, 0.16, 0.15, 0.14, 0.16, 0.15, 0.14];
  const g = evaluateGate(fakeReport(mkMetrics(pos, [0.13, 0.11, 0.15, 0.14, 0.16, 0.12, 0.14, 0.13])), mkBaseline(0.05), { look: OF_K_MAX });
  assert(g.exitCode === 0, "green tier exits 0 (exit-code decoupled; ship-gate enforces)");
  assert(g.gainConclusion?.tier === "green", "strong positive at final look => GREEN (got " + g.gainConclusion?.tier + ": " + g.gainConclusion?.reasons.join(" | ") + ")");
}
{
  // unproven-positive is never red
  const low = [0.04, 0.06, 0.05, 0.05, 0.06, 0.04, 0.05, 0.06, 0.05, 0.04, 0.06, 0.05];
  const g = evaluateGate(fakeReport(mkMetrics(low, null)), mkBaseline(0.05), { look: OF_K_MAX });
  assert(g.gainConclusion?.tier !== "red", "below-minGain point estimate is NOT red");
  assert(g.gainConclusion?.tier === "warn", "below-minGain => WARN (got " + g.gainConclusion?.tier + ")");
  assert(g.gainConclusion?.reasons.some((r) => r.includes("unproven-positive is never red")) ?? false, "WARN reason cites the unproven-positive rule");
}
{
  // proven-negative => red
  const neg = [-0.14, -0.16, -0.15, -0.13, -0.17, -0.14, -0.16, -0.15, -0.14, -0.16, -0.15, -0.14];
  const g = evaluateGate(fakeReport(mkMetrics(neg, null)), mkBaseline(0.05), { look: OF_K_MAX });
  assert(g.gainConclusion?.tier === "red", "BCa upper < 0 => RED (got " + g.gainConclusion?.tier + ": " + g.gainConclusion?.reasons.join(" | ") + ")");
  assert(g.exitCode === 0, "red tier leaves exit code 0 (ship-gate is the enforcing layer)");
}
{
  // degenerate full sample => WARN, never red
  const g = evaluateGate(fakeReport(mkMetrics([0, 0, 0, 0], null)), mkBaseline(0.05), { look: OF_K_MAX });
  assert(g.gainConclusion?.tier === "warn", "degenerate => WARN");
  assert(g.gainConclusion?.reasons.some((r) => r.includes("degenerate")) ?? false, "degenerate reason present");
}
{
  // k_max convergence clause
  const pos = [0.14, 0.16, 0.15, 0.13, 0.17, 0.14, 0.16, 0.15, 0.14, 0.16, 0.15, 0.14];
  const g = evaluateGate(fakeReport(mkMetrics(pos, [0.13, 0.11, 0.15, 0.14, 0.16, 0.12, 0.14, 0.13])), mkBaseline(0.05), { look: OF_K_MAX + 1 });
  assert(g.gainConclusion?.tier === "warn", "look>k_max => WARN convergence");
  assert(g.gainConclusion?.reasons.some((r) => r.includes("k_max convergence")) ?? false, "convergence reason present");
}
{
  // holdout contradiction mid-warn: full passes but holdout mean <= 0
  const pos = [0.14, 0.16, 0.15, 0.13, 0.17, 0.14, 0.16, 0.15, 0.14, 0.16, 0.15, 0.14];
  const g = evaluateGate(fakeReport(mkMetrics(pos, [-0.02, 0.0, -0.01, 0.01, -0.02, 0.0, -0.01, -0.005])), mkBaseline(0.05), { look: OF_K_MAX });
  assert(g.gainConclusion?.tier === "warn", "full-pass + holdout mean<=0 => WARN (overfit suspicion)");
}
{
  // degenerate holdout (sd=0): no-contradiction check unavailable => WARN, never GREEN (r98 audit F3)
  const pos = [0.14, 0.16, 0.15, 0.13, 0.17, 0.14, 0.16, 0.15, 0.14, 0.16, 0.15, 0.14];
  const g = evaluateGate(fakeReport(mkMetrics(pos, [0, 0, 0, 0, 0, 0, 0, 0])), mkBaseline(0.05), { look: OF_K_MAX });
  assert(g.gainConclusion?.tier === "warn", "degenerate holdout => WARN (got " + g.gainConclusion?.tier + ")");
  assert(g.gainConclusion?.reasons.some((r) => r.indexOf("holdout degenerate") >= 0) ?? false, "degenerate-holdout reason present");
}
{
  // holdout power check against the deployed constants: 19 pairs, sigmaDU=0.126239 (r97 calibration) must NOT be underpowered
  const mde = mdeForPaired(19, 0.126239);
  assert(mde < 0.1, "deployed holdout n=19 MDE (" + mde.toFixed(4) + ") < minGain 0.1 — no permanent WARN");
}

// --- H0 FWER simulation (three-tier boundary calibration evidence) ---
{
  const R = 600; // replications like the ADR-0038 audit mandate
  let fwer = 0;
  for (let rep = 0; rep < R; rep++) {
    // deterministic per-rep PRNG (mulberry32)
    let seed = 0x9e3779b9 ^ (rep * 2654435761);
    const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let z = Math.imul(seed ^ (seed >>> 15), 1 | seed); z = (z + Math.imul(z ^ (z >>> 7), 61 | z)) ^ z; return ((z ^ (z >>> 14)) >>> 0) / 4294967296; };
    const deltas = Array.from({ length: 19 }, () => rnd() - 0.5);
    const st = pairedGainStats(deltas);
    if (!st || st.degenerate) continue;
    // significant at any look up to k_max?
    let hit = false;
    for (let k = 1; k <= OF_K_MAX; k++) if (st.signFlipP < ofSpentAlpha(k / OF_K_MAX)) { hit = true; break; }
    if (hit) fwer++;
  }
  const rate = fwer / R;
  console.log("  H0 FWER sim: " + fwer + "/" + R + " = " + rate.toFixed(4) + " (track alpha " + OF_TRACK_ALPHA + ")");
  assert(rate < 0.05, "empirical FWER under H0 stays below the 0.05 family level (got " + rate.toFixed(4) + ")");
}

// --- nDCG@k ---
{
  const grades = { a3: 3, a2: 2, a1: 1 };
  assert(Math.abs(ndcgAtK(["document a3 body", "document a2 body", "document a1 body"], grades, 3) - 1) < 1e-12, "perfect order => nDCG@3 = 1");
  assert(ndcgAtK(["unj doc", "document a3 body", "document a1 body"], grades, 3) < 1, "imperfect order < 1");
  assert(ndcgAtK(["unj doc", "nothing"], grades, 3) === 0, "no graded hits => 0");
  // hand-computed: DCG = 1(1/log2(2)=1) + 3/log2(3); try ranks [a1, a3]
  const v = ndcgAtK(["x a1 y", "x a3 y"], grades, 2);
  const expect = (1 + 7 / Math.log2(3)) / (7 + 3 / Math.log2(3));
  assert(Math.abs(v - expect) < 1e-9, "nDCG@2 matches the hand computation (" + v.toFixed(6) + ")");
}

console.log("eval-holdout-gate.test.ts: " + passed + " passed, " + failed + " failed");
if (failed > 0) process.exit(1);

