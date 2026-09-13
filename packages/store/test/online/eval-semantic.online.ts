// ADR-0060 D7 / ADR-0057 r59 errata: the vector-arm slice needs the real embedding model, so it is
// online-gated (hermetic-by-default, ADR-0057 D4/D5). The default suite excludes it; this file is
// discovered only by `test:online` (the default glob is **/*.test.ts|mjs).
//   pnpm -C packages/store test:online
import { GOLDEN_CASES, VECTOR_ARM_GROUP } from "../../src/eval/golden-cases";
import { runAll } from "../../src/eval/runner";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return; }
  passed++;
}

async function main() {
  const semantic = GOLDEN_CASES.filter((c) => c.group === VECTOR_ARM_GROUP);
  assert(semantic.length > 0, "vector-arm slice is non-empty (got " + semantic.length + ")");

  // Full run: the online path keeps the real coverage the offline suite gave up.
  const report = await runAll(GOLDEN_CASES);
  const semResults = report.cases.filter((c) => c.group === VECTOR_ARM_GROUP);
  assert(semResults.length === semantic.length, "full run covers every vector-arm case (" + semResults.length + "/" + semantic.length + ")");
  assert(semResults.every((c) => c.passed), "vector-arm cases pass with the real model (failed: " + semResults.filter((c) => !c.passed).map((c) => c.id + "@" + c.failedStage).join(", ") + ")");
  assert(report.totals.failed === 0, "full golden suite PASSES online (failed: " + report.cases.filter((c) => !c.passed).map((c) => c.id + "@" + c.failedStage).join(", ") + ")");

  console.log("eval-semantic.online: " + passed + " passed, " + failed + " failed");
  if (failed > 0) process.exit(1);
}
main();
