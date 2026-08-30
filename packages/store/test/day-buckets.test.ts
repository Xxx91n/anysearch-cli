// ADR-0039 D4 / Acceptance C1: day-bucket boundary table + fingerprint linkage.
import { AGE_BUCKETS, bucketForAge, bucketHistogram, dayBucketFingerprint } from "../src/eval/day-buckets";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return; }
  passed++;
}

// C1: table-driven boundary membership (BVA: exact boundary + just-below + representative).
const CASES: [number, string][] = [
  [0, "0-1"], [0.5, "0-1"], [1, "0-1"], [1.9, "0-1"],
  [2, "2-7"], [5, "2-7"], [7, "2-7"], [7.9, "2-7"],
  [8, "8-30"], [15, "8-30"], [30, "8-30"], [30.9, "8-30"],
  [31, "31-90"], [60, "31-90"], [90, "31-90"], [90.9, "31-90"],
  [91, "91+"], [1000, "91+"],
];
for (const [age, want] of CASES) assert(bucketForAge(age) === want, "age " + age + " -> " + want + " (got " + bucketForAge(age) + ")");

// Abnormal input: negative (clock skew) and non-finite clamp into 0-1.
assert(bucketForAge(-3) === "0-1", "negative age clamps to 0-1");
assert(bucketForAge(NaN) === "0-1", "NaN clamps to 0-1");
assert(bucketForAge(Infinity) === "0-1", "non-finite (incl +Inf) clamps to 0-1 — an event with unreadable age still counts");

// Table invariants: ids stable, mins strictly increasing, coverage is total and disjoint
// (no gaps/overlaps by construction with [min, next-min) semantics).
assert(JSON.stringify(AGE_BUCKETS.map((b) => b.id)) === JSON.stringify(["0-1", "2-7", "8-30", "31-90", "91+"]), "bucket ids + order pinned");
for (let i = 1; i < AGE_BUCKETS.length; i++) assert(AGE_BUCKETS[i]!.min > AGE_BUCKETS[i - 1]!.min, "mins strictly increasing (" + i + ")");
assert(AGE_BUCKETS[0]!.min === 0, "coverage starts at 0");
const ages: number[] = [];
for (let a = 0; a <= 200; a += 0.25) ages.push(a);
const h = bucketHistogram(ages);
assert(Object.values(h).reduce((s, n) => s + n, 0) === ages.length, "histogram covers every age exactly once (no gap/overlap)");

// Fingerprint linkage (D4/E5): 16-hex; value pinned so a boundary edit = a forced flip
// (this expected string must be updated together with the eval baseline recalibration).
const fp = dayBucketFingerprint();
assert(/^[0-9a-f]{16}$/.test(fp), "day-bucket fingerprint is 16-hex (got " + fp + ")");
assert(fp === "491711ffacdfa568", "day-bucket fingerprint pinned to 491711ffacdfa568 — change means forced flip + recalibration");

console.log("day-buckets tests: " + passed + " passed, " + failed + " failed");
if (failed > 0) process.exit(1);
