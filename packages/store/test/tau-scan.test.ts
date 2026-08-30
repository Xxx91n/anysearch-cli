// ADR-0039 D3 / Acceptance step 4 + C-displacement: replay determinism + displacement
// property tests with seeded RNG (mulberry32 precedent).
import { scanTau, syntheticRows, rankForTau, kendallTau, positionShift, mulberry32 } from "../src/eval/tau-scan";
import { TAU_TIER } from "../src/time-decay";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return; }
  passed++;
}

const NOW = 1780000000000; // fixed clock — replay must not depend on wall time
const queries = ["latest release notes", "how does the fusion engine work", "architecture docs reference"];

// Determinism: same seed -> identical synthetic corpus.
const r1 = syntheticRows(42, 60);
const r2 = syntheticRows(42, 60);
assert(JSON.stringify(r1) === JSON.stringify(r2), "syntheticRows(seed) reproducible");
const r3 = syntheticRows(43, 60);
assert(JSON.stringify(r1) !== JSON.stringify(r3), "seed 43 differs from seed 42");

// Identity candidate: factor 1 must reproduce the baseline exactly (kendall=1, shift=0).
for (const q of queries) {
  const base = rankForTau(r1, q, { news: 7, docs: 30, evergreen: 90 }, NOW);
  const one = rankForTau(r1, q, { ...TAU_TIER }, NOW);
  assert(JSON.stringify(base) === JSON.stringify(one), "factor-1 replay equals baseline: " + q);
  assert(kendallTau(base, base) === 1, "kendallTau(x,x)=1");
  assert(positionShift(base, base).every((d) => d === 0), "positionShift(x,x)=0");
}

// kendall range + reversal: reversing a distinct-value ranking gives -1.
const a = [1, 2, 3, 4];
assert(kendallTau(a, [4, 3, 2, 1]) === -1, "reversed ranking -> kendall -1");
// no ties in reverse check require concordant+discordant == n(n-1)/2 — numeric sanity below.
const k = kendallTau(a, [1, 3, 2, 4]);
assert(Math.abs(k - (4 / 6)) < 1e-9, "kendallTau of single swap = 2/3 (got " + k + ")");

// Full scan determinism: identical reports for the same seed twice.
const s1 = scanTau(r1, queries, [0.5, 1, 2], NOW);
const s2 = scanTau(syntheticRows(42, 60), queries, [0.5, 1, 2], NOW);
assert(JSON.stringify(s1) === JSON.stringify(s2), "scanTau replay deterministic");
assert(s1.schema === "anysearch/tau-scan@1", "report schema tag");
const f1 = s1.candidates.find((c) => c.factor === 1)!;
assert(f1.kendallMean === 1 && f1.kendallMin === 1 && f1.positionShiftMax === 0, "factor=1 candidate is the identity (no displacement)");
const f2 = s1.candidates.find((c) => c.factor === 2)!;
assert(f2.kendallMean <= 1 && f2.kendallMean >= -1, "kendall within [-1,1]");
// displacement sums sanity: positionShift values are within [0, n-1]
assert(f2.positionShiftMax <= 59, "position shift bounded by n-1");
// age histogram reuses the preregistered day buckets (D4 linkage).
const totalHist = Object.values(s1.ageHistogram).reduce((x, y) => x + y, 0);
assert(totalHist === s1.rows, "age histogram covers every row exactly once");
// mulberry32: same sequence twice.
const m1 = mulberry32(7); const m2 = mulberry32(7);
assert(m1() === m2() && m1() === m2(), "mulberry32 same-seed deterministic");

console.log("tau-scan tests: " + passed + " passed, " + failed + " failed");
if (failed > 0) process.exit(1);
