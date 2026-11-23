// #493: the sufficiency gate's reround bound must come from a validated domain
// config, and a bad value must never pay for a gap model call.
// Runs under the package's normal `node --import tsx --test` command.
import { SufficiencyEvaluator } from "../src/sufficiency-gate";
import type { DomainConfigPort } from "../src/ports";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return; }
  passed++;
}

// The shape SufficiencyEvaluator looks for: a tool result whose text parses as a
// fused envelope carrying a non-"correct" sufficiency verdict.
function envelopeText(): string {
  return JSON.stringify({
    query: "reround probe",
    mode: "fast",
    results: [
      { url: "https://outer.example/a", title: "Outer A", snippet: "a" },
      { url: "https://outer.example/b", title: "Outer B", snippet: "b" },
    ],
    metadata: { sufficiency: { verdict: "insufficient" } },
  });
}

function domainWith(compaction?: DomainConfigPort["compaction"]): DomainConfigPort {
  return {
    sources: { enabled: ["tavily"] },
    prompts: [],
    skills: { active: ["search"] },
    hooks: { toolWhitelist: ["search"] },
    rag: { adapter: "none" },
    ...(compaction ? { compaction } : {}),
  };
}

async function run(value: unknown) {
  let searches = 0, modelCalls = 0;
  const retriever = {
    async search() {
      searches++;
      // A brand-new URL each round keeps "no new info" from ending the loop early.
      return {
        query: "gap",
        mode: "fast",
        results: [{ url: "https://reround-" + searches + ".example/x", title: "R", snippet: "r" }],
      };
    },
  };
  const streamFn = async function* () {
    modelCalls++;
    yield { type: "text_delta", delta: "a reround gap query" };
  };
  // The absent-key case passes no compaction section at all, not an empty one:
  // "section absent" and "field absent" are different reads of the config.
  const domain = value === undefined ? domainWith() : domainWith({ sufficiencyMaxRerounds: value } as any);
  const gate = new SufficiencyEvaluator({
    retriever: retriever as any,
    domain,
    streamFn: streamFn as any,
    model: { id: "test-model" } as any,
  });
  const messages = [
    { role: "user", content: "question" },
    { role: "toolResult", content: [{ type: "text", text: envelopeText() }] },
  ];
  const env = await gate.evaluate(messages as any);
  return { searches, modelCalls, env };
}

// 1. Absent key keeps the historical default of one reround.
{
  const r = await run(undefined);
  assert(r.searches === 1, "absent key rerounds once (got " + r.searches + ")");
  assert(r.modelCalls === 1, "absent key asks the model once (got " + r.modelCalls + ")");
}

// 2. 0 is the documented "gate off": no search, no model call, no evidence claim.
{
  const r = await run(0);
  assert(r.searches === 0, "0 runs no reround (got " + r.searches + ")");
  assert(r.modelCalls === 0, "0 makes no model call (got " + r.modelCalls + ")");
  assert(r.env.enrichedEnvelope === null && !r.env.hasRetrievalEvidence,
    "0 returns the empty envelope");
}

// 3. A legal bound is honoured exactly.
{
  const one = await run(1);
  assert(one.searches === 1, "1 rerounds once (got " + one.searches + ")");
  const three = await run(3);
  assert(three.searches === 3, "3 rerounds three times (got " + three.searches + ")");
  assert(three.modelCalls === 1, "3 generates the gap query once (got " + three.modelCalls + ")");
  assert(three.searches > 0 && three.env.hasRetrievalEvidence,
    "a real reround still reports retrieval evidence");
}

// 4. The backstop: a hand-built domain bypassing the loader cannot burn a gap
// model call and then claim it rerounded. This was the expensive failure mode.
for (const [label, value] of [
  ["NaN", NaN],
  ["string \"3\"", "3"],
  ["string \"abc\"", "abc"],
  ["out-of-range 4", 4],
  ["negative -1", -1],
] as Array<[string, unknown]>) {
  const r = await run(value);
  assert(r.modelCalls === 0, label + " makes no model call (got " + r.modelCalls + ")");
  assert(r.searches === 0, label + " runs no reround (got " + r.searches + ")");
  assert(r.env.enrichedEnvelope === null && !r.env.hasRetrievalEvidence,
    label + " does not claim retrieval evidence");
}

console.log("---");
console.log(` sufficiency reround tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
