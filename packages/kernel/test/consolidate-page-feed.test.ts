// #613 — whole-page evidence, the 24k budget, and the language-aware estimate.
//
// The pure planner is where the budget decision lives, so it is tested without
// a model call: under the cap the body wins over the snippet; over the cap
// sections are selected from metadata and the feed says what was dropped or
// truncated.
//
// Run: pnpm --filter @anysearch-cli/kernel run test

import { estimatePromptTokens, planClusterEvidence } from "../src/consolidation";
import type { ConsolidateEvidence } from "@anysearch-cli/store";

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) passed++;
  else { failed++; console.error("FAIL: " + msg); }
}

// --- language-aware estimate ----------------------------------------------

assert(estimatePromptTokens("你好世界") === 4, "estimate: four CJK code points are four tokens");
assert(estimatePromptTokens("abcd") === 1, "estimate: four Latin characters are one token");
assert(estimatePromptTokens("abcde") === 2, "estimate: a partial Latin token rounds up");
assert(estimatePromptTokens("a你b") === 2, "estimate: the two scripts are counted separately");

// --- under budget: the full body, not the snippet -------------------------

{
  const eps: ConsolidateEvidence[] = [{
    title: "Acme notice", snippet: "short snippet", url: "https://acme.example/full",
    content: "the whole page body", materialId: 7,
  }];
  const planned = planClusterEvidence(eps, 1000);
  assert(planned.overBudget === false, "under budget: the whole-page path");
  assert(planned.prompt.includes("the whole page body"), "under budget: the body reaches the prompt");
  assert(!planned.prompt.includes("short snippet"), "under budget: the snippet is not used when a body exists");
  assert(planned.materials.length === 1 && planned.materials[0]!.source === "content",
    "under budget: the feed names the body as the source");
  assert(planned.materials[0]!.fedChars === "the whole page body".length,
    "under budget: every body code point was fed");
  assert(planned.materials[0]!.materialId === 7, "under budget: the material id is echoed");
}

// --- snippet-only, under budget ------------------------------------------

{
  const planned = planClusterEvidence([{ title: "Snippet only", snippet: "only a snippet", url: "https://a.example/s" }], 1000);
  assert(planned.materials[0]!.source === "snippet", "snippet-only: the snippet is the source");
  assert(planned.prompt.includes("only a snippet"), "snippet-only: the snippet reaches the prompt");
}

// --- over budget: select a section from metadata, then truncate ----------

{
  const body = "x".repeat(400);
  const eps: ConsolidateEvidence[] = [{
    title: "Target note", snippet: "", url: "https://a.example/long", content: body,
    sections: [{ sectionId: 11, headingPath: "Target", startOffset: 0, chars: body.length }],
  }];
  const planned = planClusterEvidence(eps, 80);
  assert(planned.overBudget === true, "over budget: the planner says so");
  assert(planned.materials[0]!.sections.length === 1, "over budget: the selected section is reported");
  assert(planned.materials[0]!.truncated === true, "over budget: a too-large section is truncated");
  assert(planned.materials[0]!.fedChars > 0 && planned.materials[0]!.fedChars < body.length,
    "over budget: only the fitting head is fed");
  assert(planned.prompt.includes("Target"), "over budget: the heading path is in the block header");
}

// --- over budget: one huge snippet-only material is truncated, not dropped -

{
  const eps: ConsolidateEvidence[] = [
    { title: "Small", snippet: "small fact", url: "https://a.example/small" },
    { title: "Huge", snippet: "y".repeat(800), url: "https://a.example/huge" },
  ];
  const planned = planClusterEvidence(eps, 80);
  const huge = planned.materials.find((m) => m.title === "Huge")!;
  const small = planned.materials.find((m) => m.title === "Small")!;
  assert(planned.overBudget === true, "mixed sizes: over budget");
  assert(small.fedChars > 0, "mixed sizes: the small material fits");
  assert(huge.fedChars > 0 && huge.truncated, "mixed sizes: the huge material keeps a truncated head");
  assert(planned.materials.reduce((n, m) => n + m.fedChars, 0) > 0, "mixed sizes: something is fed");
}

// --- over budget: current knowledge is pinned, never dropped --------------

{
  const eps: ConsolidateEvidence[] = [
    { title: "Big one", snippet: "x".repeat(500), url: "https://a.example/big-1" },
    { title: "Big two", snippet: "y".repeat(500), url: "https://a.example/big-2" },
    { title: "CURRENT KNOWLEDGE", snippet: "keep this fact", url: "knowledge://semantic/1", pinned: true },
  ];
  const planned = planClusterEvidence(eps, 15);
  assert(planned.overBudget === true, "pinned: the cluster is over budget");
  assert(planned.prompt.includes("keep this fact"),
    "pinned: current knowledge survives even when it alone exceeds the cap");
  assert(planned.materials.length === 2 && planned.materials.every((m) => m.title !== "CURRENT KNOWLEDGE"),
    "pinned: current knowledge is not reported as a retrieval material");
  assert(planned.materials.every((m) => m.fedChars === 0),
    "pinned: reserved budget can leave no room for material bodies");
}

// --- over budget: most relevant LAST, least relevant in the middle --------

{
  const body = "A".repeat(610);
  const eps: ConsolidateEvidence[] = [{
    title: "Most",
    snippet: "opening",
    url: "https://a.example/order",
    content: body,
    sections: [
      { sectionId: 1, headingPath: "Most", startOffset: 0, chars: 10 },
      { sectionId: 2, headingPath: "Other", startOffset: 300, chars: 10 },
      { sectionId: 3, headingPath: "Mid", startOffset: 600, chars: 10 },
    ],
  }];
  const planned = planClusterEvidence(eps, 100);
  const most = planned.prompt.indexOf("Most");
  const other = planned.prompt.indexOf("Other");
  const mid = planned.prompt.indexOf("Mid");
  assert(planned.overBudget === true, "order: over budget");
  assert(other >= 0 && mid > other && most > mid,
    "order: least relevant is in the middle and most relevant is last");
}

console.log("consolidate-page-feed: " + passed + " passed, " + failed + " failed");
if (failed > 0) process.exit(1);
