// Time Edge Effect tests.
// G019 test closure: verify decay, QDF, tier classification, pinned exemption.

import { applyTimeEdgeEffect, decayMultiplier, classifyTier, isTimeSensitive, isEvergreen, invalidateOldRecords } from "../src/time-decay.js";

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string) {
  if (cond) { passed++; } else { failed++; console.error("FAIL: " + msg); }
}

// Test 1: decayMultiplier — fresh content has high multiplier.
const fresh = decayMultiplier(0, "news");
assert(Math.abs(fresh - 1.0) < 0.01, "fresh content decay ≈ 1.0 (got " + fresh + ")");

// Test 2: decayMultiplier — old news decays fast (7d half-life).
const oldNews = decayMultiplier(14, "news");
assert(oldNews < 0.3 || Math.abs(oldNews - 0.3) < 0.01, "14d news decay ≈ 0.25 (got " + oldNews + ")");

// Test 3: decayMultiplier — evergreen decays slow (90d half-life).
const oldEvergreen = decayMultiplier(30, "evergreen");
assert(oldEvergreen > 0.5, "30d evergreen decay > 0.5 (got " + oldEvergreen + ")");

// Test 4: decayMultiplier — floor 0.3 prevents zero.
const veryOld = decayMultiplier(365, "news");
assert(veryOld >= 0.3, "365d news floor >= 0.3 (got " + veryOld + ")");

// Test 5: isTimeSensitive — detects time keywords.
assert(isTimeSensitive("最新AI新闻"), "QDF detects '最新'");
assert(isTimeSensitive("latest news 2026"), "QDF detects 'latest'");
assert(!isTimeSensitive("what is RRF"), "QDF does not trigger on evergreen query");

// Test 6: isEvergreen — detects evergreen keywords.
assert(isEvergreen("什么是RRF"), "evergreen detects '什么是'");
assert(isEvergreen("how does RRF work"), "evergreen detects 'how does'");
assert(!isEvergreen("latest AI news"), "evergreen does not trigger on time-sensitive");

// Test 7: classifyTier — news content.
assert(classifyTier("Breaking news update", "https://news.example.com") === "news", "classify news");
assert(classifyTier("API Reference Guide", "https://docs.example.com") === "docs", "classify docs");
assert(classifyTier("What is RRF", "https://wiki.example.com") === "evergreen", "classify evergreen");

// Test 8: applyTimeEdgeEffect — pinned bypasses decay.
const bm25 = -10.0;
const pinnedResult = applyTimeEdgeEffect(bm25, 365, "news", "latest news", true);
assert(pinnedResult === bm25, "pinned bypasses decay (got " + pinnedResult + ")");

// Test 9: applyTimeEdgeEffect — evergreen query disables decay.
const evergreenResult = applyTimeEdgeEffect(bm25, 365, "news", "什么是X");
assert(evergreenResult === bm25, "evergreen query disables decay (got " + evergreenResult + ")");

// Test 10: applyTimeEdgeEffect — time-sensitive query applies stronger decay.
const ts1 = applyTimeEdgeEffect(bm25, 14, "news", "latest news 2026");
const ts0 = applyTimeEdgeEffect(bm25, 0, "news", "latest news 2026");
assert(ts1 !== ts0, "time-sensitive query applies decay");

// Test 11: applyTimeEdgeEffect — non-time-sensitive applies weaker decay.
const nts1 = applyTimeEdgeEffect(bm25, 14, "news", "RRF fusion");
const nts0 = applyTimeEdgeEffect(bm25, 0, "news", "RRF fusion");
assert(nts1 !== nts0, "non-time-sensitive also applies decay but weaker");

console.log("--- Time Edge Effect tests: " + passed + " passed, " + failed + " failed ---");
if (failed > 0) process.exit(1);
