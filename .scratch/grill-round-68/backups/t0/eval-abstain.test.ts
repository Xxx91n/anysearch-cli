// ADR-0054 D2/D3: abstain smoke — three-tier verdict, llm_fallback, observational zone.
import { runAbstainProbe } from "../src/eval/abstain";
import { runAll } from "../src/eval/runner";
import { ABSTAIN_CASES, GOLDEN_CASES } from "../src/eval/golden-cases";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return; }
  passed++;
}

async function main() {
  // tier 1: access-chain trace
  const t1 = await runAbstainProbe({ family: "chain_empty", prompt: "anything" });
  assert(t1.abstain && t1.tier === "chain", "chain_empty forces abstain via chain tier");
  // tier 2: refusal regex
  const t2 = await runAbstainProbe({ family: "refusal_keyword", prompt: "Sorry, I cannot answer that." });
  assert(t2.abstain && t2.tier === "regex", "refusal keyword -> abstain via regex");
  const t3 = await runAbstainProbe({ family: "answered", prompt: "Paris is the capital of France." });
  assert(!t3.abstain && t3.tier === "regex", "confident answer -> no abstain via regex");
  // tier 3: llm judge + fallback
  const t4 = await runAbstainProbe({ family: "answered", prompt: "uncertain text", judgeFn: async () => true });
  assert(t4.abstain && t4.tier === "llm", "llm judge verdict wins when it returns boolean");
  const t5 = await runAbstainProbe({ family: "answered", prompt: "confident", judgeFn: async () => { throw new Error("boom"); } });
  assert(!t5.abstain && t5.tier === "llm_fallback", "judge failure degrades to llm_fallback of tier 2");

  // golden corpus unchanged; abstain group surfaces in ObservationalZone only.
  assert(GOLDEN_CASES.every((c) => c.group !== "abstain"), "abstain cases stay out of GOLDEN_CASES (fingerprint pinned)");
  assert(ABSTAIN_CASES.some((c) => c.ops.some((o) => o.op === "abstain" && o.expectAbstain)), "has expectAbstain=true case");
  assert(ABSTAIN_CASES.some((c) => c.ops.some((o) => o.op === "abstain" && !o.expectAbstain)), "has expectAbstain=false case");

  const report = await runAll(GOLDEN_CASES);
  const z = report.metrics.observational;
  assert(!!z && !!z.abstain && typeof z.abstain === "object", "observational zone carries abstain");
  if (z && typeof z.abstain === "object" && "n" in z.abstain) {
    assert(z.abstain.n >= 3, "abstain zone counts all cases");
    assert(z.abstain.abstainRate > 0, "abstainRate > 0");
    assert(z.abstain.falseAbstainRate === 0, "falseAbstainRate == 0 for the negative control");
  }
  assert(report.metrics.passRate === 1, "abstain smoke never turns the eval red (passRate stays 1)");

  console.log("eval-abstain: " + passed + " passed, " + failed + " failed");
  process.exit(failed ? 1 : 0);
}

main();
