// #455: one remedy sentence per class, plus the one slot a sentence may carry.
// The wait value is per arm (from its retry-after), so it cannot live in the
// table; this test pins that the slot is filled and never printed raw.
import { PROVIDER_ERROR_HINTS, providerErrorHint, providerErrorHints } from "../src/provider-error-hints";
import type { ProviderErrorClass } from "@anysearch-cli/retriever";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return false; }
  passed++; return true;
}

const FREE_QUOTA_SENTENCE = PROVIDER_ERROR_HINTS["free-quota-exhausted"] ?? "";

{
  // The retry-after the arm reported becomes the number in the sentence.
  assert(
    providerErrorHint("free-quota-exhausted", 3600) === "the free quota is used up — wait 3600 seconds and retry, or add a key for this provider",
    "a known wait fills the number",
  );
  // No number: the sentence says "a moment" rather than inventing one.
  assert(
    providerErrorHint("free-quota-exhausted") === "the free quota is used up — wait a moment and retry, or add a key for this provider",
    "a missing wait says a moment",
  );
  // Zero and negatives are "not known", not "wait 0 seconds".
  assert(providerErrorHint("free-quota-exhausted", 0)?.includes("wait a moment") === true, "zero seconds reads as unknown");
}

{
  // Every sentence renders without leaving a slot behind, and `{` appears only
  // in the sentences that carry one — a stray brace in prose is a bug the
  // reader would see.
  for (const [cls, sentence] of Object.entries(PROVIDER_ERROR_HINTS) as Array<[ProviderErrorClass, string | undefined]>) {
    if (!sentence) continue;
    const rendered = providerErrorHint(cls, 42) ?? "";
    assert(!rendered.includes("{"), "rendered sentence has no slot left (" + cls + ")");
    if (!sentence.includes("{wait}")) {
      assert(!sentence.includes("{"), "no other slot exists outside the wait (" + cls + ")");
      assert(rendered === sentence, "a class without a slot renders as written (" + cls + ")");
    }
  }
  assert(FREE_QUOTA_SENTENCE.includes("{wait}"), "the free-quota sentence is the one that carries the wait");
}

{
  // Per arm, not per class: two arms of the same class keep their own numbers.
  const hints = providerErrorHints(
    ["tavily", "anysearch", "exa"],
    { tavily: "free-quota-exhausted", anysearch: "free-quota-exhausted", exa: "unknown" },
    { tavily: 3600, anysearch: 90 },
  );
  assert(hints.tavily.includes("wait 3600 seconds"), "tavily keeps its own wait");
  assert(hints.anysearch.includes("wait 90 seconds"), "anysearch keeps its own wait");
  assert(!("exa" in hints), "a class with no sentence gets no hint");
}

console.log("--- provider-error-hints: " + passed + " passed, " + failed + " failed ---");
if (failed > 0) process.exit(1);
