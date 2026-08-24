// ADR-0023 D2 (Q2=B): S1 rewriteQuery fail-open acceptance test.
// (1) No LLM seam → returns [query] exactly. (2) LLM throws → fail-open to [query].
// (3) LLM returns variants → 3-item cap with original at index 0, dedup'd.
// (4) qdf hint does not alter fail-open behavior.
// Run: tsx test/query-rewrite.test.ts

import { rewriteQuery, classifyQdf } from "../src/query-rewrite";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return false; }
  passed++; return true;
}

async function main() {
  // 1) Fail-open: no llmFn → original query returned as single variant
  const r1 = await rewriteQuery("TypeScript decorators", "neutral");
  assert(r1.length === 1 && r1[0] === "TypeScript decorators", "rewriteQuery without LLM seam fail-opens to [query]");

  // 2) Fail-open: llmFn throws → same result
  const r2 = await rewriteQuery("TypeScript decorators", "neutral", async () => { throw new Error("boom"); });
  assert(r2.length === 1 && r2[0] === "TypeScript decorators", "rewriteQuery with throwing LLM seam fail-opens to [query]");

  // 3) QDF hint classification
  assert(classifyQdf("latest TypeScript release", { isTimeSensitive: () => true, isEvergreen: () => false }) === "time_sensitive", "classifyQdf flags time_sensitive");
  assert(classifyQdf("what is a decorator", { isTimeSensitive: () => false, isEvergreen: () => true }) === "evergreen", "classifyQdf flags evergreen");
  assert(classifyQdf("banana", { isTimeSensitive: () => false, isEvergreen: () => false }) === "neutral", "classifyQdf defaults neutral");
  assert(classifyQdf("banana") === "neutral", "classifyQdf no-classifier defaults neutral");

  // 4) LLM variants returned: 3-item cap, original first, dupes removed
  const r4 = await rewriteQuery("TypeScript decorators", "neutral", async () => [
    "TS decorators", "TypeScript decorators", "ts decorators", "TypeScript decorators",
  ]);
  assert(r4[0] === "TypeScript decorators", "original query is index 0");
  assert(r4.length === 3, `3-item cap enforced (got ${r4.length})`);
  assert(r4.includes("TS decorators"), "paraphrase variant included");
  assert(r4.includes("ts decorators"), "term-swap variant included");
  assert(!r4.slice(1).includes("TypeScript decorators"), "dedupe: no duplicate of original in variants");

  // 5) LLM returning empty strings gets filtered
  const r5 = await rewriteQuery("TypeScript decorators", "neutral", async () => ["", "  ", "\n"]);
  assert(r5.length === 1 && r5[0] === "TypeScript decorators", "empty/blank LLM variants filtered out");

  // 6) Blank input → empty array (no variants)
  const r6 = await rewriteQuery("   ", "neutral");
  assert(r6.length === 0, "blank query → empty variants");

  console.log(`query-rewrite.test.ts: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
