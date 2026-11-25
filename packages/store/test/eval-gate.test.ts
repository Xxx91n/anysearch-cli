// impl plan step 7 +: gate contract self-check (integer allowance + WARN band).
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const __dirname = dirname(fileURLToPath(import.meta.url));
import { evaluateGate, evaluateWeakestLink, type EvalBaseline } from "../src/eval/gate";
import { SqliteSessionStore } from "../src/session-store";
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
// Phase-2: semantic-arm regression fail-closed
{ const g = evaluateGate(fakeReport(mkMetrics({ semantic: { queries: 1, hits: 1, served: 1, regressions: 1 } } as never)), baseline);
  assert(g.verdict === "fail" && g.exitCode === 1, "semantic regression fails closed (got " + g.verdict + ")"); }
assert(evaluateGate(fakeReport(undefined, "xyz999"), baseline).exitCode === 12, "fingerprint mismatch exits 12");
assert(evaluateGate(fakeReport(), null).exitCode === 12, "missing baseline exits 12");
{ const legacy = { ...baseline, allowance: undefined } as unknown as EvalBaseline;
  assert(evaluateGate(fakeReport(), legacy).exitCode === 12, "legacy fraction-margin baseline exits 12 (recalibrate)"); }

// CLI end-to-end: run eval against committed baseline, assert exit 0 + artifacts in scratch out dir.
const outDir = mkdtempSync(join(tmpdir(), "ans-gate-"));
try {
  // the eval CLI writes observations into the durable DB
  // (ANS_DB_PATH or ~/.ans/anysearch.db) and then advances the switch state machine
  // against that same DB. The fixture must hand it a DB that carries the store schema
  // (access_events et al.) - i.e. reuse the schema-application path. Otherwise the switch step
  // hits the no-such-table error on a clean machine (fail-closed by design, but the fixture
  // had bypassed the schema-application path).
  const durableDb = join(outDir, "durable.db");
  new SqliteSessionStore(durableDb).close();
  // #591: pre-seed a @3 skip-ledger with consecutiveWarn=3 so we verify eval CLI no longer
  // escalates or mutates skip streak/history, while advanceSwitch() still writes state/actions.
  const seedLedgerPath = join(outDir, "skip-ledger.json");
  writeFileSync(seedLedgerPath, JSON.stringify({
    schema: "anysearch/gain-ledger@3",
    consecutiveWarn: 3,
    history: [{ at: "2026-01-01T00:00:00.000Z", tier: "warn", look: "seeded", track: "consumed", reasonCode: "gate-not-met" }],
    resolutions: [],
    lastSkipKeys: ["seeded"],
    state: { phase: "S0", since: null, transitionId: null, evidenceHash: null },
    actions: [],
    revision: 1,
  }, null, 2) + "\n", "utf8");
  const run = spawnSync(process.execPath, ["--import", "tsx", "src/eval/cli.ts", "--out", outDir, "--offline"], { cwd: join(__dirname, ".."), encoding: "utf8", env: { ...process.env, ANS_EVAL_NO_LOOK: "1", ANS_DB_PATH: durableDb } });
  if (run.status !== 0) {
    failed++; console.error("FAIL: CLI exited " + run.status + ": " + String(run.stderr).slice(0, 300));
  } else {
  const stderr = String(run.stderr);
  assert(!stderr.includes("no such table"), "eval CLI switch step does not hit no-such-table (schema-application path reused)");
  assert(!stderr.includes("OBSERVATIONAL skip streak") && !stderr.includes("gain-warn-resolve"), "#591: eval CLI does not emit D7 skip streak escalation or gain-warn-resolve hint");
  assert(existsSync(join(outDir, "eval-report.json")), "CLI writes eval-report.json");
  assert(existsSync(join(outDir, "eval-report.md")), "CLI writes eval-report.md");
  const rep = JSON.parse(readFileSync(join(outDir, "eval-report.json"), "utf8"));
  assert(rep.gate.exitCode === 0, "CLI gate exit 0 embedded");
  assert(typeof rep.datasetFingerprint === "string" && rep.datasetFingerprint.length === 16, "report carries fingerprint");
  assert(!("skipLedger" in rep), "#591: eval report omits retired skipLedger disclosure field");
  const ob = rep.metrics?.observational;
  const e3Keys = ["accessAge", "tauScan", "bgnbd", "revival", "undoReentryEvents", "dayBucketDefinition", "eventWriteFailures", "armDeltas", "maxLexicalOverlap", "exclusiveHits", "nativeScoresMissing"];
  assert(ob && ob.schema === "anysearch/observational@1" && e3Keys.every((k) => k in ob), "#591: E3 observational zone stays complete in eval-report.json");
  const afterLedger = JSON.parse(readFileSync(seedLedgerPath, "utf8"));
  assert(afterLedger.schema === "anysearch/gain-ledger@3" && afterLedger.state?.phase === "S0" && Array.isArray(afterLedger.actions) && afterLedger.actions.length >= 1, "#591: advanceSwitch() still writes @3 state/actions to skip-ledger.json");
  assert(afterLedger.consecutiveWarn === 3 && Array.isArray(afterLedger.history) && afterLedger.history.length === 1, "#591: eval CLI does not mutate skip streak or history in skip-ledger.json");
  const md = readFileSync(join(outDir, "eval-report.md"), "utf8");
  assert(md.includes("Stage attribution") && md.includes("fingerprint"), "md has stage attribution + fingerprint");
  assert(md.includes("Statistical power") && md.includes("Wilson95") && md.includes("family size"), "md has power block (MDE/Wilson/family)");
  assert(md.includes("Difficulty tiers"), "md has difficulty tier breakdown");
  assert(!md.includes("OBSERVATIONAL skip-ledger"), "#591: eval-report.md omits retired observational skip-ledger notes");
  }
} finally {
  try { rmSync(outDir, { recursive: true, force: true }); } catch {}
}

// N1: observational metrics NEVER gate — verdict invariance under injected
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

// reverse weakest-link harm gate — clear negative paired sample is a confirmed
// critical red; n<10 degrades to WARN.
{
  const armDeltas = {
    relation: { n: 12, excluded: 0, meanDelta: -0.14, deltas: [-0.14, -0.16, -0.15, -0.13, -0.17, -0.14, -0.16, -0.15, -0.14, -0.16, -0.12, -0.14], role: "critical" as const },
  };
  const wl = evaluateWeakestLink(armDeltas, { ...baseline, relationGain: { sigmaDU: 0.05, rawN: 4, lockedN: 4, minGain: 0.1 } }, 0.025);
  assert(wl !== undefined && wl.arms[0]!.confirmedHarm === true, "negative sample confirms weakest-link harm");
  const m = { ...mkMetrics(), observational: { schema: "anysearch/observational@1", armDeltas } } as unknown as EvalMetrics;
  const g = evaluateGate(fakeReport(m), { ...baseline, relationGain: { sigmaDU: 0.05, rawN: 4, lockedN: 4, minGain: 0.1 } }, { look: 5 });
  assert(g.exitCode === 1 && g.failures.some((f) => f.includes("weakest-link RED relation")), "critical weakest-link red blocks gate");
}

// ship-gate wiring: the memory-eval step must exist (dropped step = dropped gate).
const sg = readFileSync(join(__dirname, "..", "..", "..", "scripts", "ship-gate.mjs"), "utf8");
assert(sg.includes("stepMemoryEval") && sg.includes("memory eval"), "ship-gate wires stepMemoryEval");
// #591: step 7 retires D7 observational skip-streak failure while keeping E3 presence check,
// switch-state readout, and step 1 access-chain skip-ledger escalation.
const step7Start = sg.indexOf("async function stepMemoryEval");
const step7End = step7Start >= 0 ? sg.indexOf("\nasync function ", step7Start + 1) : -1;
const step7Src = step7Start >= 0 ? sg.slice(step7Start, step7End > step7Start ? step7End : undefined) : "";
assert(step7Start >= 0 && step7End > step7Start, "#591: located stepMemoryEval body in scripts/ship-gate.mjs");
assert(!step7Src.includes("observational explicit-skip streak") && !step7Src.includes("sl.consecutiveWarn >= 3"), "#591: ship-gate step 7 retires observational skip-streak fail branch");
assert(!step7Src.includes("handled by eval quarantine"), "#591: ship-gate step 7 no longer claims eval quarantines unreadable skip-ledger");
assert(step7Src.includes("anysearch/observational@1") && step7Src.includes("switch-state:"), "#591: ship-gate step 7 keeps E3 check and switch-state readout");
assert(sg.includes("access-chain-skip-ledger.json") && sg.includes("access-chain verify skip streak"), "#591: ship-gate step 1 access-chain 3-streak gate remains intact");
const evalCliSrc = readFileSync(join(__dirname, "..", "src", "eval", "cli.ts"), "utf8");
assert(!evalCliSrc.includes('from "./skip-ledger"') && !evalCliSrc.includes("OBSERVATIONAL skip streak"), "#591: eval cli.ts drops retired skip-ledger import and D7 escalation output");
// task-parity gate wired at step 1.
assert(sg.includes("task-parity"), "ship-gate wires task parity check");

console.log("eval-gate.test.ts: " + passed + " passed, " + failed + " failed");
if (failed > 0) process.exit(1);
