// ADR-0027 impl plan step 7 + ADR-0028 D1: gate contract self-check (integer allowance + WARN band).
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const __dirname = dirname(fileURLToPath(import.meta.url));
import { evaluateGate, evaluateWeakestLink, type EvalBaseline } from "../src/eval/gate";
import type { EvalMetrics, EvalReport } from "../src/eval/runner";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return; }
  passed++;
}

function mkMetrics(over: Partial<EvalMetrics> & { supExpected?: number; supPassed?: number; fpEligible?: number; fpCount?: number } = {}): EvalMetrics {
  const supExpected = over.supExpected ?? 12;
  const supPassed = over.supPassed ?? supExpected;
  const fpEligible = over.fpEligible ?? 4;
  const fpCount = over.fpCount ?? 0;
  return {
    passRate: over.passRate ?? 1,
    supersessionSuccess: supExpected ? supPassed / supExpected : 1,
    quarantineFalsePositiveRate: fpEligible ? fpCount / fpEligible : 0,
    counts: { cases: 20, casesPassed: 20, supExpected, supPassed, fpEligible, fpCount },
    mrr: 1,
    answerableFalseRefusalRate: 0, semantic: over.semantic ?? { queries: 0, hits: 0, served: 0, regressions: 0 }, forget: { archiveChecks: 0, archives: 0, undoRestores: 0, dryRunExact: 0 },
  };
}

function fakeReport(metrics: EvalMetrics = mkMetrics(), fp = "abc123"): EvalReport {
  return {
    schema: "anysearch/eval-report@1", generatedAt: "ts", datasetFingerprint: fp,
  holdoutFingerprint: "test-hfp",
    totals: { cases: 20, passed: 20, failed: 0 },
    stageBreakdown: { extract: 0, adjudicate: 0, store: 0, retrieve: 0 },
    tierBreakdown: { core: { cases: 20, passed: 20, passRate: 1 } },
    metrics,
    cases: [],
  };
}
const baseline: EvalBaseline = {
  schema: "anysearch/eval-baseline@1", fingerprint: "abc123", holdoutFingerprint: "test-hfp",
  metrics: mkMetrics(),
  allowance: { supersessionFails: 1, quarantineFp: 0 }, updatedAt: "2026-08-27", note: "t",
};

// pass
assert(evaluateGate(fakeReport(), baseline).exitCode === 0, "clean report passes");
// passRate fail-closed
assert(evaluateGate(fakeReport(mkMetrics({ passRate: 0.95 })), baseline).exitCode === 1, "passRate<1 fails");
// integer allowance respected: 1 supersession fail <= allowance 1 passes
assert(evaluateGate(fakeReport(mkMetrics({ supPassed: 11 })), baseline).exitCode === 0, "supersession within allowance passes");
// over allowance but UNDER-POWERED (allowance/n=1/12 < MDE~0.404) -> WARN, exit 0
{ const g = evaluateGate(fakeReport(mkMetrics({ supPassed: 10 })), baseline);
  assert(g.verdict === "warn" && g.exitCode === 0 && g.warnings.some((w) => w.includes("DOWNGRADED to WARN")), "under-powered overage downgrades to WARN (got " + g.verdict + ", warnings=" + g.warnings.length + ")"); }
// over allowance WITH power (allowance 3/n=4 => 0.75 >= MDE(4)~0.7) -> FAIL, exit 1
{ const b2: EvalBaseline = { ...baseline, allowance: { supersessionFails: 3, quarantineFp: 0 } };
  const g = evaluateGate(fakeReport(mkMetrics({ supExpected: 4, supPassed: 0 })), b2);
  assert(g.verdict === "fail" && g.exitCode === 1, "powered overage fails (got " + g.verdict + " exit " + g.exitCode + ")"); }
// qfp over zero allowance -> under-powered WARN (1/4 frac 0 < MDE)
{ const g = evaluateGate(fakeReport(mkMetrics({ fpCount: 1 })), baseline);
  assert(g.verdict === "warn" && g.exitCode === 0, "qfp over zero allowance warns when under-powered"); }
// fingerprint mismatch = 12, missing baseline = 12, missing allowance block = 12
// ADR-0037 D6 Phase-2: semantic-arm regression fail-closed
{ const g = evaluateGate(fakeReport(mkMetrics({ semantic: { queries: 1, hits: 1, served: 1, regressions: 1 } } as never)), baseline);
  assert(g.verdict === "fail" && g.exitCode === 1, "semantic regression fails closed (got " + g.verdict + ")"); }
assert(evaluateGate(fakeReport(undefined, "xyz999"), baseline).exitCode === 12, "fingerprint mismatch exits 12");
assert(evaluateGate(fakeReport(), null).exitCode === 12, "missing baseline exits 12");
{ const legacy = { ...baseline, allowance: undefined } as unknown as EvalBaseline;
  assert(evaluateGate(fakeReport(), legacy).exitCode === 12, "legacy fraction-margin baseline exits 12 (recalibrate)"); }

// CLI end-to-end: run eval against committed baseline, assert exit 0 + artifacts in scratch out dir.
const outDir = mkdtempSync(join(tmpdir(), "ans-gate-"));
try {
  execFileSync(process.execPath, ["--import", "tsx", "src/eval/cli.ts", "--out", outDir], { cwd: join(__dirname, ".."), stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ANS_EVAL_NO_LOOK: "1" } });
  assert(existsSync(join(outDir, "eval-report.json")), "CLI writes eval-report.json");
  assert(existsSync(join(outDir, "eval-report.md")), "CLI writes eval-report.md");
  const rep = JSON.parse(readFileSync(join(outDir, "eval-report.json"), "utf8"));
  assert(rep.gate.exitCode === 0, "CLI gate exit 0 embedded");
  assert(typeof rep.datasetFingerprint === "string" && rep.datasetFingerprint.length === 16, "report carries fingerprint");
  const md = readFileSync(join(outDir, "eval-report.md"), "utf8");
  assert(md.includes("Stage attribution") && md.includes("fingerprint"), "md has stage attribution + fingerprint");
  assert(md.includes("Statistical power") && md.includes("Wilson95") && md.includes("family size"), "md has ADR-0028 power block (MDE/Wilson/family)");
  assert(md.includes("Difficulty tiers"), "md has difficulty tier breakdown");
} catch (e) {
  failed++; console.error("FAIL: CLI exited non-zero: " + String((e as { message?: string }).message).slice(0, 300));
} finally {
  try { rmSync(outDir, { recursive: true, force: true }); } catch {}
}

// ADR-0039 N1: observational metrics NEVER gate — verdict invariance under injected
// observational content (Goodhart clause, ship-gate only asserts presence elsewhere).
{
  const m = mkMetrics();
  (m as unknown as Record<string, unknown>).observational = { schema: "anysearch/observational@1", accessAge: "garbage-injected-value" };
  const g = evaluateGate(fakeReport(m), baseline);
  assert(g.exitCode === 0, "N1: observational injection must not change gate outcome (got " + g.exitCode + ")");
}
// N2: read-path contamination guard — no aggregation SQL over access_events in session-store's
// read statements (touch path only INSERTs; aggregation lives in the runner's offline snapshot).
{
  const src = readFileSync(join(__dirname, "..", "src", "session-store.ts"), "utf8");
  const reads = src.match(/searchAllResults[^`]*?prepare("([^"]+)")/g) ?? [];
  for (const r of reads) assert(!r.includes("access_events"), "N2: read path must never query access_events");
}

// ADR-0046 D4: reverse weakest-link harm gate — clear negative paired sample is a confirmed
// critical red; n<10 degrades to WARN.
{
  const armDeltas = {
    relation: { n: 12, excluded: 0, meanDelta: -0.14, deltas: [-0.14, -0.16, -0.15, -0.13, -0.17, -0.14, -0.16, -0.15, -0.14, -0.16, -0.12, -0.14], role: "critical" as const },
  };
  const wl = evaluateWeakestLink(armDeltas, { ...baseline, relationGain: { sigmaDU: 0.05, rawN: 4, lockedN: 4, minGain: 0.1 } }, 0.025);
  assert(wl !== undefined && wl.arms[0]!.confirmedHarm === true, "ADR-0046: negative sample confirms weakest-link harm");
  const m = { ...mkMetrics(), observational: { schema: "anysearch/observational@1", armDeltas } } as unknown as EvalMetrics;
  const g = evaluateGate(fakeReport(m), { ...baseline, relationGain: { sigmaDU: 0.05, rawN: 4, lockedN: 4, minGain: 0.1 } }, { look: 5 });
  assert(g.exitCode === 1 && g.failures.some((f) => f.includes("weakest-link RED relation")), "ADR-0046: critical weakest-link red blocks gate");
}

// ship-gate wiring: the memory-eval step must exist (dropped step = dropped gate).
const sg = readFileSync(join(__dirname, "..", "..", "..", "scripts", "ship-gate.mjs"), "utf8");
assert(sg.includes("stepMemoryEval") && sg.includes("memory eval"), "ship-gate wires stepMemoryEval");
// ADR-0028 D5: task-parity gate wired at step 1.
assert(sg.includes("task-parity"), "ship-gate wires task parity check");

console.log("eval-gate.test.ts: " + passed + " passed, " + failed + " failed");
if (failed > 0) process.exit(1);
