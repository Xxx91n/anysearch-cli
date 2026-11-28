// #613 — the summary reply shape: <quotes> first, then <conclusion>.
//
// Only the conclusion is persisted, and only the reply's own prose can become
// it: quoted page text is never promoted to a conclusion. A reply that does not
// follow the exact shape is kept without its tags and flagged. An empty
// <quotes> block still counts as missing evidence: the judges must not receive
// an empty string with no alarm.
//
// Run: pnpm --filter @anysearch-cli/store run test

import { splitConsolidateSummary } from "../src/consolidate";

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) passed++;
  else { failed++; console.error("FAIL: " + msg); }
}

{
  const ok = splitConsolidateSummary(
    "<quotes>\n[1] Notice \"support is 24x7\"\n</quotes>\n<conclusion>支持改为 7×24。</conclusion>",
  );
  assert(ok.conclusion === "支持改为 7×24。", "shaped: only the conclusion is returned");
  assert(ok.quotes === "[1] Notice \"support is 24x7\"", "shaped: the quotes are returned verbatim");
  assert(ok.quotesMissing === false, "shaped: quotes are present");
  assert(ok.quotesMalformed === false, "shaped: not malformed");
}

{
  const plain = splitConsolidateSummary("support is 24x7");
  assert(plain.conclusion === "support is 24x7", "no tags: the whole reply is the conclusion");
  assert(plain.quotes === null && plain.quotesMissing === true, "no tags: quotes are missing");
  assert(plain.quotesMalformed === true, "no tags: reported as malformed, not merely quote-less");
}

{
  const reversed = splitConsolidateSummary("<conclusion>done</conclusion><quotes>q</quotes>");
  assert(reversed.conclusion === "done",
    "reversed order: malformed, the reply's own prose is kept without its tags");
  assert(!reversed.conclusion.includes("q"),
    "reversed order: the quoted page text never becomes the conclusion");
  assert(!/<\/?conclusion>|<\/?quotes>/.test(reversed.conclusion),
    "reversed order: no markup reaches stored knowledge");
  assert(reversed.quotesMissing === true, "reversed order: flagged");
  assert(reversed.quotesMalformed === true,
    "reversed order: the shape was wrong, so it counts as malformed, not quote-less");
  assert(reversed.conclusionMissing === false, "reversed order: it did state a conclusion");
}

{
  const preamble = splitConsolidateSummary("Here is the result:\n<quotes>q</quotes><conclusion>done</conclusion>");
  assert(preamble.conclusion.includes("Here is the result"), "text outside the blocks: malformed, whole reply kept");
  assert(preamble.quotesMissing === true, "text outside the blocks: flagged");
}

{
  const emptyQuotes = splitConsolidateSummary("<quotes>  </quotes><conclusion>done</conclusion>");
  assert(emptyQuotes.conclusion === "done", "empty quotes: the conclusion still persists");
  assert(emptyQuotes.quotes === null && emptyQuotes.quotesMissing === true,
    "empty quotes: flagged as missing evidence");
  assert(emptyQuotes.quotesMalformed === false,
    "empty quotes: the shape was fine, so it is not reported as malformed");
}

{
  const emptyConclusion = splitConsolidateSummary("<quotes>q</quotes><conclusion> </conclusion>");
  assert(emptyConclusion.conclusion === "",
    "empty conclusion: nothing to persist, so the quotes do not become the conclusion");
  assert(emptyConclusion.quotes === "q", "empty conclusion: quotes retained for the report");
  assert(emptyConclusion.quotesMissing === false,
    "empty conclusion: the quotes exist, so evidence is not missing");
  assert(emptyConclusion.quotesMalformed === false,
    "empty conclusion: the shape was fine, so it is not reported as malformed");
  assert(emptyConclusion.conclusionMissing === true,
    "empty conclusion: reported as no-conclusion, not as a missing model");
}

{
  const onlyQuotes = splitConsolidateSummary("<quotes>q</quotes>");
  assert(onlyQuotes.conclusion === "" && onlyQuotes.conclusionMissing === true,
    "only a quote block: no conclusion to persist");
}

console.log("consolidate-summary-shape: " + passed + " passed, " + failed + " failed");
if (failed > 0) process.exit(1);
