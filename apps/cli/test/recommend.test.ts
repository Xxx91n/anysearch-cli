// `ans recommend` output/exit-code contract (#110) — pure presentation layer
// (recommend-format.ts has no runtime store/kernel imports, so this test stays
// loadable without the ESM-only kernel graph, same pattern as abstain.test.ts).

import { formatRecommendText, formatRecommendJson, recommendExitCode } from "../src/commands/recommend-format";
import type { RecommendResult } from "@anysearch-cli/store";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return; }
  passed++;
}

const high: RecommendResult = {
  query: "deep web research with exa and tavily",
  decision: "high",
  candidates: [
    { id: "research", name: "research", description: "Deep web research with Exa + Tavily", rank: 1, score: 1, relative: 1, coverage: 1, arms: ["fts"] },
  ],
  recommendation: { id: "research", name: "research", confidence: 1 },
  confidence: 1,
  why: null,
  arms: { embedding: "absent" },
  topK: 3,
};

const low: RecommendResult = {
  query: "research docs",
  decision: "low",
  candidates: [
    { id: "research", name: "research", description: "Deep web research with Exa + Tavily", rank: 1, score: 1, relative: 1, coverage: 0.5, arms: ["fts"] },
    { id: "docs", name: "docs", description: "Technical-docs retrieval: MCP spec / TypeScript tsconfig / pnpm settings", rank: 2, score: 0.9, relative: 0.9, coverage: 0.5, arms: ["fts"] },
  ],
  recommendation: null,
  confidence: 0.05,
  why: { code: "low_confidence", detail: "low confidence 0.05 < 0.50 (coverage 0.50, margin 0.10)", confidence: 0.05, margin: 0.1, coverage: 0.5, threshold: 0.5 },
  arms: { embedding: "absent" },
  topK: 3,
};

const none: RecommendResult = {
  query: "xyzzy gibberishplugh",
  decision: "none",
  candidates: [],
  recommendation: null,
  confidence: null,
  why: { code: "no_match", detail: "no domain metadata matched any query term" },
  arms: { embedding: "absent" },
  topK: 3,
};

// 1. Exit codes: high/low → 0 (low is a first-class candidate list, abstain-homomorphic), none → 1.
assert(recommendExitCode(high) === 0, "high => exit 0");
assert(recommendExitCode(low) === 0, "low => exit 0 (candidate list, not failure)");
assert(recommendExitCode(none) === 1, "none => exit 1");

// 2. High-confidence text: suggests the real switch command, marks no switch performed.
const ht = formatRecommendText(high);
assert(ht.includes("ans domain research"), "high text suggests 'ans domain research'");
assert(ht.includes("Confidence: high"), "high text shows confidence");
assert(ht.includes("no switch performed"), "high text states no switch performed");

// 3. Low-confidence text: candidate list + structured why, and NO single-guess suggestion.
const lt = formatRecommendText(low);
assert(lt.includes("Candidates"), "low text lists candidates");
assert(lt.includes("why no recommendation"), "low text carries why-no-recommendation line");
assert(lt.includes("low_confidence"), "why line names the low_confidence code");
assert(!lt.includes("Suggestion:"), "low text never prints a single-guess suggestion");
assert(lt.includes("ans domain <name>"), "low text points at manual switch command");

// 4. None text: structured no_match reason.
const nt = formatRecommendText(none);
assert(nt.includes("no_match"), "none text carries no_match code");

// 5. --json envelope: parseable, switched:false marker, decision + why + candidates + arms.
const env = JSON.parse(formatRecommendJson(low));
assert(env.switched === false, "json switched:false (never auto-switches)");
assert(env.decision === "low" && env.recommendation === null, "json decision low + null recommendation");
assert(env.why?.code === "low_confidence", "json why.code");
assert(Array.isArray(env.candidates) && env.candidates.length === 2 && env.candidates[0].id === "research", "json candidate list ordered");
assert(env.arms?.embedding === "absent", "json arms.embedding visible (FTS-only regression surface)");
const envHigh = JSON.parse(formatRecommendJson(high));
assert(envHigh.recommendation?.suggest === "ans domain research", "json high recommendation carries suggest command");

console.log("--- recommend format tests: " + passed + " passed, " + failed + " failed ---");
if (failed > 0) process.exit(1);
