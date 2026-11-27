// Self-check for RRF pure function.
// Run: pnpm --filter @anysearch-cli/retriever run test

import { rrfScores, rrfRank, rrfRankWithPreferred } from "../src/rrf";
import { FUSION_REGISTRY } from "../src/fusion-registry";

// probe with the registered rank_window (was the implicit default).
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

// Test 7: equal-score tie — the preferred id moves ahead without changing the score.
// "snippet" and "body" each sit at rank 0 of their own list, so both score 1/61.
const tie = rrfRankWithPreferred([["1"], ["2"]], K, new Set(["2"]));
assert("preferred id wins an exact tie", tie[0] === "2" && tie[1] === "1");
const noPref = rrfRankWithPreferred([["1"], ["2"]], K, new Set<string>());
assert("no preference keeps the stable order", noPref.join(",") === "1,2");

// Test 8: preference never outranks a higher score.
const notATie = rrfRankWithPreferred([["1", "2"], ["1"]], K, new Set(["2"]));
assert("preference does not beat a higher fused score", notATie[0] === "1" && notATie[1] === "2");

// Test 9: any string id works — the primitive is key-agnostic (URLs included).
const urlTie = rrfRankWithPreferred([["https://a.example/x"], ["https://b.example/y"]], K, new Set(["https://b.example/y"]));
assert("URL document ids keep the tie-break", urlTie[0] === "https://b.example/y");

console.log(`RRF tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
