// ADR-0027 / round63 atomcode audit finding 1: the gate must PROVE it can catch a regression.
// Mutation test — simulate "SECRET_RE deleted" by a malicious subclass that rewrites reject->accept,
// then run the real golden secret case and assert: case FAILS at the adjudicate stage, and
// the gate (passRate < 1) exits 1. If the harness were decorative, both assertions would break.
// ponytail: mutation surface covers the adjudicate seam only (the highest-risk path); upgrade
// path = mutation-test runner over more seams when eval scope grows.
import { GOLDEN_CASES } from "../src/eval/golden-cases";
import { runCase, computeMetrics } from "../src/eval/runner";
import { evaluateGate, type EvalBaseline } from "../src/eval/gate";
import { SqliteSessionStore } from "../src/session-store";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return; }
  passed++;
}

// The mutation: a store whose adjudicateMemory silently accepts secrets (reject -> accept).
class MutatedStore extends SqliteSessionStore {
  override async adjudicateMemory(sessionId: string, keyMemories: Parameters<SqliteSessionStore["adjudicateMemory"]>[1]) {
    const res = await super.adjudicateMemory(sessionId, keyMemories);
    return res.map((r) => (r.action === "reject" ? { ...r, action: "accept" as const, reason: undefined } : r));
  }
}

async function main() {
  const secretCase = GOLDEN_CASES.find((c) => c.group === "secret");
  assert(Boolean(secretCase), "golden set has a secret case");

  // Sanity: unmutated store passes the secret case.
  const clean = await runCase(secretCase!);
  assert(clean.passed, "unmutated store passes secret case");

  // Mutated: same case must now FAIL, attributed to the adjudicate stage.
  const mutated = await runCase(secretCase!, (p) => new MutatedStore(p));
  assert(!mutated.passed, "mutated store FAILS the secret case (gate catches the injected regression)");
  assert(mutated.failedStage === "adjudicate", "failure attributed to adjudicate stage (got " + mutated.failedStage + ")");

  // Gate-level: a report produced by the mutated run has passRate < 1 => exit 1.
  const dirtyReport = {
    schema: "anysearch/eval-report@1" as const, generatedAt: "t", datasetFingerprint: "fp123",
    totals: { cases: 1, passed: 0, failed: 1 },
    stageBreakdown: { extract: 0, adjudicate: 1, store: 0, retrieve: 0 },
    tierBreakdown: {},
    metrics: computeMetrics([secretCase!], [mutated]),
    cases: [mutated],
  };
  const baseline: EvalBaseline = {
    schema: "anysearch/eval-baseline@1", fingerprint: "fp123",
    metrics: computeMetrics([], []),
    allowance: { supersessionFails: 0, quarantineFp: 0 }, updatedAt: "t", note: "t",
  };
  const g = evaluateGate(dirtyReport, baseline);
  assert(dirtyReport.metrics.passRate === 0, "mutated report passRate 0");
  assert(g.exitCode === 1, "gate exits 1 on mutated run (got " + g.exitCode + ")");

  console.log("eval-mutation.test.ts: " + passed + " passed, " + failed + " failed");
  if (failed > 0) process.exit(1);
}
main();
