// Self-check for RRF pure function.
// Run: pnpm --filter @anysearch/retriever run test

import { rrfScores, rrfRank } from "../src/rrf";
import { FUSION_REGISTRY } from "../src/fusion-registry";

// ADR-0045 D2: probe with the registered rank_window (was the implicit default).
const K = FUSION_REGISTRY.rank_window;

let passed = 0;
let failed = 0;

function assert(label: string, cond: boolean) {
  if (cond) { passed++; } else { failed++; console.error("FAIL: " + label); }
}

// Test 1: single list, k=60
// rank 0: 1/(60+1) = 0.01639, rank 1: 1/(60+2) = 0.01613
const single = rrfScores([["a", "b", "c"]], K);
assert("doc a score = 1/61", Math.abs(single.get("a")! - 1/61) < 1e-6);
assert("doc b score = 1/62", Math.abs(single.get("b")! - 1/62) < 1e-6);
assert("doc c score = 1/63", Math.abs(single.get("c")! - 1/63) < 1e-6);

// Test 2: two lists, same doc in both -> score sums
// doc "x" rank 0 in list1: 1/61, rank 1 in list2: 1/62. total = 1/61 + 1/62
const twoLists = rrfScores([["x", "y"], ["z", "x"]], K);
assert("doc x fused score = 1/61 + 1/62", Math.abs(twoLists.get("x")! - (1/61 + 1/62)) < 1e-6);

// Test 3: dedup within single list
const dup = rrfScores([["a", "a", "b"]], K);
assert("dedup: a counted once", Math.abs(dup.get("a")! - 1/61) < 1e-6);

// Test 4: rrfRank orders by score descending
const ranked = rrfRank([["x", "y"], ["z", "x"]], K);
assert("x ranked first (highest score)", ranked[0] === "x");

// Test 5: empty lists
const empty = rrfScores([], K);
assert("empty lists -> empty map", empty.size === 0);

// Test 6: custom k value
const customK = rrfScores([["a"]], 10);
assert("k=10: score = 1/11", Math.abs(customK.get("a")! - 1/11) < 1e-6);

console.log(`RRF tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);