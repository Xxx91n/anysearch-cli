// ADR-0039 D2/D6/D7 Acceptance C4/C5: spawn contract tests via node stub scripts
// (slow / garbage-stdout / contract schema / non-convergence) + AND-gate independent negatives.
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runBgnbdFit, evaluateTauFitGate, psi, TAU_FIT_GATE, type BgnbdRow } from "../src/eval/bgnbd";
import { isSkip } from "../src/eval/explicit-skip";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return; }
  passed++;
}

const stubsDir = join(dirname(fileURLToPath(import.meta.url)), "stubs");
const stub = (n: string) => join(stubsDir, "bgnbd-" + n + ".mjs");
const NODE = process.execPath;

// A gate that PASSES so spawn actually fires.
const PASS_GATE = { activeRows: 400, fittableUnits: 150, psi: 0.1, windowDays: 120, daysSinceLastFit: 40 };
const ROWS: BgnbdRow[] = [{ frequency: 2, recency: 10, T: 30 }, { frequency: 0, recency: 0, T: 20 }];

async function main() {
  // ---- C5: each AND-gate condition has an independent negative ----
  const bad1 = evaluateTauFitGate({ ...PASS_GATE, activeRows: 299 });
  assert(!bad1.ok && bad1.failures.some((f) => f.startsWith("T1:")), "C5 T1 negative: 299 active rows blocks");
  const bad1b = evaluateTauFitGate({ ...PASS_GATE, fittableUnits: 99 });
  assert(!bad1b.ok && bad1b.failures.some((f) => f.startsWith("T1:")), "C5 T1 negative: 99 fittable units blocks");
  const bad2 = evaluateTauFitGate({ ...PASS_GATE, psi: 0.25 });
  assert(!bad2.ok && bad2.failures.some((f) => f.startsWith("T2:")), "C5 T2 negative: PSI 0.25 blocks");
  const bad2b = evaluateTauFitGate({ ...PASS_GATE, psi: null });
  assert(!bad2b.ok && bad2b.failures.some((f) => f.startsWith("T2:")), "C5 T2 negative: missing PSI blocks");
  const bad3 = evaluateTauFitGate({ ...PASS_GATE, windowDays: 89 });
  assert(!bad3.ok && bad3.failures.some((f) => f.startsWith("T3:")), "C5 T3 negative: 89d window blocks");
  const bad3b = evaluateTauFitGate({ ...PASS_GATE, daysSinceLastFit: 29 });
  assert(!bad3b.ok && bad3b.failures.some((f) => f.startsWith("T3:")), "C5 T3 negative: 29d interval blocks");
  assert(evaluateTauFitGate(PASS_GATE).ok, "C5 positive: all conditions met -> gate ok");
  // Gate shut -> skip, never spawns (tier gate-not-met with verbatim failures).
  const gated = await runBgnbdFit(ROWS, { gate: { ...PASS_GATE, windowDays: 10 }, python: NODE, scriptPath: stub("ok"), timeoutMs: 5000 });
  assert(isSkip(gated) && gated.tier === "gate-not-met" && gated.reason.includes("T3:"), "unsatisfied gate -> explicit skip w/ verbatim reason, no spawn");

  // ---- PSI: symmetric-KL with epsilon smoothing (drop-linkage to D4 buckets at call sites) ----
  assert(Math.abs(psi([0.5, 0.5], [0.5, 0.5])) < 1e-9, "PSI identical distributions ~ 0");
  assert(psi([1, 0], [0, 1]) > 0.25, "PSI disjoint distributions large");
  assert(Number.isFinite(psi([1, 0, 0], [0, 0, 1])), "PSI zero buckets safe via epsilon");
  assert(Math.abs(psi([2, 3], [2, 3])) < 1e-9, "PSI scale-invariant (counts, not just shares)");

  // ---- C4: spawn defense matrix (never throws, never placeholder params) ----
  const ok = await runBgnbdFit(ROWS, { gate: PASS_GATE, python: NODE, scriptPath: stub("ok"), timeoutMs: 10000 });
  assert("status" in ok && ok.status === "ok", "contract schema: converged envelope passes through");
  if (!isSkip(ok)) assert(ok.envelope.params !== undefined && ok.envelope.validation !== undefined, "params + C6 validation present");

  const slow = await runBgnbdFit(ROWS, { gate: PASS_GATE, python: NODE, scriptPath: stub("slow"), timeoutMs: 400 });
  assert(isSkip(slow) && slow.tier === "infra-failure" && slow.reason.includes("timeout"), "slow stub -> timeout SIGKILL -> infra skip (" + (isSkip(slow) ? slow.reason : "") + ")");

  const garbage = await runBgnbdFit(ROWS, { gate: PASS_GATE, python: NODE, scriptPath: stub("garbage"), timeoutMs: 10000 });
  assert(isSkip(garbage) && garbage.tier === "infra-failure" && garbage.reason.includes("not valid JSON"), "garbage stdout -> infra skip");

  const exit2 = await runBgnbdFit(ROWS, { gate: PASS_GATE, python: NODE, scriptPath: stub("exit2"), timeoutMs: 10000 });
  assert(isSkip(exit2) && exit2.tier === "infra-failure" && exit2.reason.includes("exited 2"), "nonzero exit + stderr -> infra skip with stderr snippet");

  const notok = await runBgnbdFit(ROWS, { gate: PASS_GATE, python: NODE, scriptPath: stub("notok"), timeoutMs: 10000 });
  assert(isSkip(notok) && notok.tier === "infra-failure" && notok.reason.includes("lifetimes"), "ok!=true envelope -> infra skip quoting error");

  const nc = await runBgnbdFit(ROWS, { gate: PASS_GATE, python: NODE, scriptPath: stub("nonconverge"), timeoutMs: 10000 });
  assert(isSkip(nc) && nc.tier === "gate-not-met" && nc.reason.includes("converged:false"), "non-convergence -> gate-not-met skip, no placeholder params");

  // all-skips share the contract shape
  for (const s of [gated, slow, garbage, exit2, notok, nc]) assert(isSkip(s) && typeof s.reason === "string" && s.reason.length > 0, "skip marker shape (" + (isSkip(s) ? s.tier : "") + ")");

  console.log("bgnbd-spawn tests: " + passed + " passed, " + failed + " failed");
  if (failed > 0) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
