// Truth table for the five-value outcome classifier (issue #514).
// Run: pnpm --filter @anysearch-cli/retriever run test
//
// Only inputs and outputs: no engine, no span, no envelope assembly. The
// precedence is the point of the table, so every row that could be read two
// ways sits next to the row it must not be confused with.

import { classifySearchOutcome, isPartialPool, shouldAbstain, SEARCH_OUTCOMES, type SearchOutcomeEvidence } from "../src/outcome";

let passed = 0;
let failed = 0;

function check(label: string, cond: boolean) {
  if (cond) { passed++; } else { failed++; console.error("FAIL: " + label); }
}

function evidence(overrides: Partial<SearchOutcomeEvidence> = {}): SearchOutcomeEvidence {
  return {
    resultCount: 0,
    answerCount: 0,
    providersQueried: ["anysearch"],
    providersFailed: [],
    providersCancelled: [],
    domainActive: false,
    gateDropped: 0,
    ...overrides,
  };
}

function row(label: string, e: Partial<SearchOutcomeEvidence>, want: ReturnType<typeof classifySearchOutcome>) {
  const got = classifySearchOutcome(evidence(e));
  check(label + " => " + want + " (got " + got + ")", got === want);
}

// The union the audit attribute, the CLI field and the MCP field all carry.
check("five values, no sixth", SEARCH_OUTCOMES.join(",") === "answer,failed,cancelled,abstain,empty");
check("isPartialPool: no arms cut", !isPartialPool([]));
check("isPartialPool: one arm cut", isPartialPool(["anysearch"]));

// 1. answer wins outright: a result is an answer even when an arm failed.
row("results beat a failed arm", { resultCount: 2, providersFailed: ["anysearch"] }, "answer");
row("provider answer is an answer with zero results", { answerCount: 1 }, "answer");
row("an answer beats every arm failing", { answerCount: 1, providersFailed: ["anysearch"] }, "answer");

// 2. failed: nothing came back and every queried arm failed.
row("single arm failed", { providersFailed: ["anysearch"] }, "failed");
row("every queried arm failed", { providersQueried: ["exa", "tavily"], providersFailed: ["exa", "tavily"] }, "failed");
row(
  "one arm failed, one answered with nothing => not failed",
  { providersQueried: ["exa", "anysearch"], providersFailed: ["exa"] },
  "empty",
);

// 3. cancelled: an arm was cut off and it was not all-failed.
row("arm cut off, no arm answered", { providersCancelled: ["anysearch"] }, "cancelled");
row(
  "one failed and one cut off => cancelled, not failed",
  { providersQueried: ["exa", "anysearch"], providersFailed: ["exa"], providersCancelled: ["anysearch"] },
  "cancelled",
);
row(
  "one answered with nothing and one cut off => cancelled",
  { providersQueried: ["exa", "anysearch"], providersCancelled: ["anysearch"] },
  "cancelled",
);
// 4. A cut-off arm rules out abstain even when the gate dropped arrivals: the
//    fanout never finished, so "not in this domain" would be an overreach.
row(
  "gate dropped results but an arm was cut off => cancelled",
  { domainActive: true, gateDropped: 3, providersFailed: [], providersCancelled: ["anysearch"] },
  "cancelled",
);

// 5. abstain, post: the gate itself threw arrivals away.
row("gate dropped arrivals => abstain", { domainActive: true, gateDropped: 2 }, "abstain");
row(
  "gate dropped arrivals while another arm failed => still abstain",
  { domainActive: true, gateDropped: 2, providersQueried: ["exa", "anysearch"], providersFailed: ["exa"] },
  "abstain",
);

// 6. abstain, pre: no arrivals and no failures — every arm answered with nothing.
row("cold domain: arm answered with nothing => abstain", { domainActive: true }, "abstain");
row(
  "cold domain with two arms, both empty => abstain",
  { domainActive: true, providersQueried: ["exa", "anysearch"] },
  "abstain",
);

// 6b. The unroutable combination the tables above cannot produce: gate counters
//     claiming a drop while every queried arm failed. The verdict is still the
//     outage, and the predicate agrees — the classifier's order is the rule.
row(
  "all arms failed with a stale drop counter => failed",
  { domainActive: true, gateDropped: 2, providersFailed: ["anysearch"] },
  "failed",
);

// 7. The two near-misses that used to be reported as abstain.
row(
  "cold domain, an arm failed => empty, not abstain and not failed",
  { domainActive: true, providersQueried: ["exa", "anysearch"], providersFailed: ["exa"] },
  "empty",
);
row(
  "cold domain, the only arm failed => failed, not abstain",
  { domainActive: true, providersFailed: ["anysearch"] },
  "failed",
);
row("no domain policy => empty", { domainActive: false }, "empty");
row("answers only, no marker either way", { answerCount: 1, domainActive: true, gateDropped: 1 }, "answer");

// 8. Predicate shape reads the same rule, so a caller that only asks "should
//    this abstain?" cannot drift from the five-value answer.
const abstainCases: Array<[string, Partial<SearchOutcomeEvidence>, boolean]> = [
  ["post gate", { domainActive: true, gateDropped: 1 }, true],
  ["pre gate", { domainActive: true }, true],
  ["domain off", { domainActive: false, gateDropped: 1 }, false],
  ["arm cut off", { domainActive: true, gateDropped: 1, providersCancelled: ["anysearch"] }, false],
  ["a result survived", { domainActive: true, resultCount: 1, gateDropped: 1 }, false],
  ["provider answer", { domainActive: true, answerCount: 1 }, false],
  ["no drop and a failure", { domainActive: true, providersQueried: ["exa", "anysearch"], providersFailed: ["exa"] }, false],
  ["every arm failed", { domainActive: true, gateDropped: 2, providersFailed: ["anysearch"] }, false],
];
for (const [label, e, want] of abstainCases) {
  const got = shouldAbstain(evidence(e));
  check("shouldAbstain: " + label + " => " + want + " (got " + got + ")", got === want);
}
// Every verdict the predicate accepts must classify as abstain, and nothing else may.
for (const [label, e] of abstainCases) {
  const verdict = classifySearchOutcome(evidence(e));
  check(
    "classifier agrees with the predicate: " + label,
    (verdict === "abstain") === shouldAbstain(evidence(e)),
  );
}

console.log("--- outcome truth table: " + passed + " passed, " + failed + " failed ---");
if (failed > 0) process.exit(1);
