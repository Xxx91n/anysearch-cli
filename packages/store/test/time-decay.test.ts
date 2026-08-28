// Fused freshness factor tests (ADR-0030).
// Covers: band boundaries, pinned/evergreen exemptions, fusion monotonicity,
// year-literal-free QDF, kernel decayMultiplier legacy checks.

import { freshnessFactor, scoreWithFreshness, decayMultiplier, classifyTier, isTimeSensitive, isEvergreen, invalidateOldRecords } from "../src/time-decay.js";

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string) {
  if (cond) { passed++; } else { failed++; console.error("FAIL: " + msg); }
}

const NOW = Date.now();
const DAY = 86_400_000;
function ts(daysAgo: number): string {
  return new Date(NOW - daysAgo * DAY).toISOString().replace("T", " ").slice(0, 19);
}

// 1. Band boundaries: factor always within [0.3, 1.5] over a wide fuzz grid.
let minSeen = 2, maxSeen = -1;
for (const tier of ["news", "docs", "evergreen"] as const) {
  for (let age = 0; age <= 730; age += 7) {
    for (const accDays of [null, 0, 3, 30, 400]) {
      for (const cnt of [0, 1, 3, 10, 100, 10000]) {
        const f = freshnessFactor({
          createdAt: ts(age),
          lastAccessed: accDays === null ? null : ts(accDays),
          accessCount: cnt, tier, nowMs: NOW,
        });
        assert(f >= 0.3 && f <= 1.5, "factor in band [0.3,1.5]: " + age + "d/" + accDays + "/" + cnt + " tier=" + tier + " => " + f);
        if (f < minSeen) minSeen = f;
        if (f > maxSeen) maxSeen = f;
      }
    }
  }
}
assert(Math.abs(minSeen - 0.3) < 1e-9, "band lower bound reachable (min=" + minSeen + ")");
// ts() truncates to seconds: band head is approached, not exactly hit.
assert(Math.abs(maxSeen - 1.5) < 1e-6, "band upper bound reachable (max=" + maxSeen + ")");

// 2. Pinned bypass: factor exactly 1.0 even for inputs that would floor.
assert(freshnessFactor({ createdAt: ts(400), lastAccessed: null, accessCount: 0, tier: "news", pinned: true, nowMs: NOW }) === 1.0, "pinned bypasses factor");
// ts() truncates to seconds: band head is approached, not exactly hit.
const bm = -10;
assert(scoreWithFreshness(bm, { createdAt: ts(400), lastAccessed: null, accessCount: 0, tier: "news", pinned: true, nowMs: NOW }) === bm, "pinned score unchanged");

// 3. Evergreen query: decay half bypassed, reinforcement still applies (ADR-0030 D4).
//    Same row, never accessed: evergreen query pins factor at exactly 1.0 (no decay).
const evNoAccess = freshnessFactor({ createdAt: ts(400), lastAccessed: null, accessCount: 0, tier: "news", evergreenQuery: true, nowMs: NOW });
assert(evNoAccess === 1.0, "evergreen query bypasses decay exactly (got " + evNoAccess + ")");
//    Recently accessed + frequently accessed row keeps reinforcement under evergreen query.
const evBoost = freshnessFactor({ createdAt: ts(400), lastAccessed: ts(0), accessCount: 3, tier: "news", evergreenQuery: true, nowMs: NOW });
assert(evBoost > 1.4 && evBoost <= 1.5, "evergreen query keeps access reinforcement (got " + evBoost + ")");
//    Same row without evergreen query: decayed band clearly below the evergreen one.
const evDecayed = freshnessFactor({ createdAt: ts(400), lastAccessed: ts(0), accessCount: 3, tier: "news", nowMs: NOW });
assert(evDecayed < evBoost, "evergreen query outranks decayed same-row (" + evDecayed + " vs " + evBoost + ")");

// 4. Fusion monotonicity: fresh+accessed ranks above stale+untouched at equal BM25.
const stale = scoreWithFreshness(bm, { createdAt: ts(180), lastAccessed: null, accessCount: 0, tier: "news", nowMs: NOW });
const freshAccessed = scoreWithFreshness(bm, { createdAt: ts(1), lastAccessed: ts(0), accessCount: 5, tier: "news", nowMs: NOW });
// bm25 negative: better => more negative
assert(freshAccessed < stale, "fresh+accessed beats stale+untouched at equal BM25 (" + freshAccessed + " vs " + stale + ")");
assert(Math.abs(stale - bm * 0.3) < 1e-9, "stale+untouched sits at 0.3 floor");

// 5. Year-literal-free QDF regex (ADR-0030 D5): 4-digit years no longer trigger;
//    behavior survives every future rollover.
assert(!isTimeSensitive("AI 2026 全景回顾"), "year literal 2026 no longer triggers QDF");
assert(!isTimeSensitive("deep dive into 2099 retro"), "no future year literal triggers QDF");
assert(isTimeSensitive("最新AI新闻"), "still detects 最新");
assert(isTimeSensitive("latest news"), "still detects latest");
assert(!isTimeSensitive("what is RRF"), "still neutral for evergreen query");

// 6. Evergreen classifier kept.
assert(isEvergreen("什么是RRF"), "evergreen detects 什么是");
assert(isEvergreen("what is RRF"), "evergreen detects what is");
assert(!isEvergreen("latest AI news"), "evergreen does not trigger on time-sensitive");

// 7. decayMultiplier legacy invariants (tau table unchanged: 7/30/90).
assert(Math.abs(decayMultiplier(0, "news") - 1.0) < 0.01, "fresh decay ~1.0");
assert(decayMultiplier(14, "news") <= 0.3 + 1e-9, "14d news at floor region");
assert(decayMultiplier(30, "evergreen") > 0.5, "30d evergreen decay > 0.5");
assert(decayMultiplier(365, "news") >= 0.3, "365d news floor >= 0.3");

// 8. classifyTier unchanged.
assert(classifyTier("Breaking news update", "https://news.example.com") === "news", "classify news");
assert(classifyTier("API Reference Guide", "https://docs.example.com") === "docs", "classify docs");
assert(classifyTier("What is RRF", "https://wiki.example.com") === "evergreen", "classify evergreen");

console.log("time-decay tests: " + passed + " passed, " + failed + " failed");
if (failed > 0) process.exit(1);
