// ADR-0027 impl plan step 7: gate contract self-check (path 3/3, ship-gate step's decision table).
// Path 2/3 (CLI) is covered by invoking the CLI below and asserting exit codes + artifacts.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
const __dirname = dirname(fileURLToPath(import.meta.url));
import { join } from "node:path";
import { evaluateGate, type EvalBaseline } from "../src/eval/gate";
import type { EvalReport } from "../src/eval/runner";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return; }
  passed++;
}

function fakeReport(over: Partial<EvalReport["metrics"]> = {}, fp = "abc123"): EvalReport {
  return {
    schema: "anysearch/eval-report@1", generatedAt: "ts", datasetFingerprint: fp,
    totals: { cases: 20, passed: 20, failed: 0 },
    stageBreakdown: { extract: 0, adjudicate: 0, store: 0, retrieve: 0 },
    metrics: { passRate: 1, supersessionSuccess: 1, quarantineFalsePositiveRate: 0, ...over },
    cases: [],
  };
}
const baseline: EvalBaseline = {
  schema: "anysearch/eval-baseline@1", fingerprint: "abc123",
  metrics: { passRate: 1, supersessionSuccess: 1, quarantineFalsePositiveRate: 0 },
  margin: { supersession: 0.05, quarantineFp: 0 }, updatedAt: "2026-08-27", note: "t",
};

// pass
assert(evaluateGate(fakeReport(), baseline).exitCode === 0, "clean report passes");
// passRate fail-closed
assert(evaluateGate(fakeReport({ passRate: 0.95 }), baseline).exitCode === 1, "passRate<1 fails");
// margin respected
assert(evaluateGate(fakeReport({ supersessionSuccess: 0.96 }), baseline).exitCode === 0, "supersession within margin passes");
assert(evaluateGate(fakeReport({ supersessionSuccess: 0.94 }), baseline).exitCode === 1, "supersession below margin fails");
// qfp ceiling
assert(evaluateGate(fakeReport({ quarantineFalsePositiveRate: 0.01 }), baseline).exitCode === 1, "qfp above margin fails");
// fingerprint mismatch = 12, missing baseline = 12
assert(evaluateGate(fakeReport({}, "xyz999"), baseline).exitCode === 12, "fingerprint mismatch exits 12");
assert(evaluateGate(fakeReport(), null).exitCode === 12, "missing baseline exits 12");

// CLI end-to-end: --write-baseline in a scratch copy? No: baseline path is package-anchored.
// Just run the CLI (real baseline committed in repo), assert exit 0 + artifacts in scratch out dir.
const outDir = mkdtempSync(join(tmpdir(), "ans-gate-"));
try {
  execFileSync(process.execPath, ["--import", "tsx", "src/eval/cli.ts", "--out", outDir], { cwd: join(__dirname, ".."), stdio: ["ignore", "pipe", "pipe"] });
  assert(existsSync(join(outDir, "eval-report.json")), "CLI writes eval-report.json");
  assert(existsSync(join(outDir, "eval-report.md")), "CLI writes eval-report.md");
  const rep = JSON.parse(readFileSync(join(outDir, "eval-report.json"), "utf8"));
  assert(rep.gate.exitCode === 0, "CLI gate exit 0 embedded");
  assert(typeof rep.datasetFingerprint === "string" && rep.datasetFingerprint.length === 16, "report carries fingerprint");
  const md = readFileSync(join(outDir, "eval-report.md"), "utf8");
  assert(md.includes("Stage attribution") && md.includes("fingerprint"), "md has stage attribution + fingerprint");
} catch (e) {
  failed++; console.error("FAIL: CLI exited non-zero: " + String((e as { message?: string }).message).slice(0, 300));
} finally {
  try { rmSync(outDir, { recursive: true, force: true }); } catch {}
}

// ship-gate wiring: the memory-eval step must exist (dropped step = dropped gate).
const sg = readFileSync(join(__dirname, "..", "..", "..", "scripts", "ship-gate.mjs"), "utf8");
assert(sg.includes("stepMemoryEval") && sg.includes("memory eval"), "ship-gate wires stepMemoryEval");

console.log("eval-gate.test.ts: " + passed + " passed, " + failed + " failed");
if (failed > 0) process.exit(1);
