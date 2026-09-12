// ADR-0027 D8 + ADR-0059 D3 (T-2/F-17): quarantine ledger mechanics + gate-exclusion contract.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  activeIds,
  emptyQuarantine,
  expiredEntries,
  isActive,
  plusDays,
  promoteEntry,
  QUARANTINE_MAX_RENEWALS,
  QUARANTINE_SCHEMA,
  QUARANTINE_TTL_DAYS,
  readQuarantine,
  renewEntry,
  retireEntry,
  reviewDue,
  type QuarantineEntry,
  type QuarantineLedger,
} from "../src/eval/quarantine-ledger";
import { evaluateGate, type EvalBaseline } from "../src/eval/gate";
import type { EvalMetrics, EvalReport } from "../src/eval/runner";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..", "..", "..");
let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) {
    failed++;
    console.error("FAIL: " + msg);
    return;
  }
  passed++;
}

const T0 = "2026-09-12T00:00:00.000Z";
function entry(id: string, at: string): QuarantineEntry {
  return { id, group: "semantic", reason: "env-flaky", quarantinedAt: at, ttlDays: QUARANTINE_TTL_DAYS, expiresAt: plusDays(at, QUARANTINE_TTL_DAYS), renewals: 0, reviews: [] };
}

// --- 1. the committed ledger exists next to the baseline -------------------
const ledgerPath = path.join(root, "packages", "store", "eval-quarantine.json");
assert(fs.existsSync(ledgerPath), "eval-quarantine.json is committed next to the baseline");
assert(readQuarantine(ledgerPath).schema === QUARANTINE_SCHEMA, "committed ledger carries the @1 schema");
assert(emptyQuarantine().entries.length === 0, "emptyQuarantine has no entries");

// --- 2. TTL / active / expired ---------------------------------------------
{
  const q: QuarantineLedger = { schema: QUARANTINE_SCHEMA, entries: [entry("a", T0)] };
  assert(isActive(q, "a", plusDays(T0, 29)), "within TTL -> active");
  assert(!isActive(q, "a", plusDays(T0, 31)), "past TTL -> not active");
  assert(activeIds(q, plusDays(T0, 1)).length === 1 && activeIds(q, plusDays(T0, 31)).length === 0, "activeIds honours TTL");
  assert(expiredEntries(q, plusDays(T0, 31)).map((e) => e.id).join() === "a", "expiredEntries surfaces the TTL breach");
}

// --- 3. weekly review clock -------------------------------------------------
{
  const q: QuarantineLedger = { schema: QUARANTINE_SCHEMA, entries: [entry("a", T0)] };
  assert(reviewDue(q, plusDays(T0, 3)).length === 0, "review not due before the weekly interval");
  assert(reviewDue(q, plusDays(T0, 8)).map((e) => e.id).join() === "a", "review due after the weekly interval");
}

// --- 4. renewal cap, promote, retire ---------------------------------------
{
  const q: QuarantineLedger = { schema: QUARANTINE_SCHEMA, entries: [entry("a", T0)] };
  renewEntry(q, "a", plusDays(T0, 30), "still flaky on CI");
  renewEntry(q, "a", plusDays(T0, 60), "still flaky on CI");
  assert(q.entries[0]!.renewals === QUARANTINE_MAX_RENEWALS, "two renewals recorded");
  assert(q.entries[0]!.expiresAt === plusDays(plusDays(T0, 60), 30), "renewal extends from the review date");
  let threw = false;
  try {
    renewEntry(q, "a", plusDays(T0, 90), "third");
  } catch {
    threw = true;
  }
  assert(threw, "third renewal is refused (graveyard guard)");
  const p = promoteEntry(q, "a", plusDays(T0, 91), "fixed: 20/20 green");
  assert(p.entries.length === 0, "promote removes the case from quarantine (gated again)");
  const r = retireEntry({ schema: QUARANTINE_SCHEMA, entries: [entry("b", T0)] }, "b", plusDays(T0, 91), "never fixed");
  assert(r.entries[0]!.retired === true && activeIds(r, plusDays(T0, 1)).length === 0, "retire keeps the audit row but deactivates it");
}

// --- 5. corrupt / missing files degrade to empty ---------------------------
{
  const tmp = path.join(os.tmpdir(), "ans-t2-qz-" + process.pid + ".json");
  fs.writeFileSync(tmp, "{ not json", "utf8");
  assert(readQuarantine(tmp).entries.length === 0, "corrupt ledger degrades to empty");
  fs.rmSync(tmp, { force: true });
  assert(readQuarantine(path.join(os.tmpdir(), "ans-t2-absent-" + process.pid + ".json")).entries.length === 0, "missing ledger degrades to empty");
}

// --- 6. gate exclusion: a quarantined failure does not fail the gate -------
function mkMetrics(passRate: number, cases: number, casesPassed: number): EvalMetrics {
  return {
    passRate,
    supersessionSuccess: 1,
    quarantineFalsePositiveRate: 0,
    counts: { cases, casesPassed, supExpected: 12, supPassed: 12, fpEligible: 4, fpCount: 0 },
    mrr: 1,
    answerableFalseRefusalRate: 0,
    semantic: { queries: 0, hits: 0, served: 0, regressions: 0 },
    forget: { archiveChecks: 0, archives: 0, undoRestores: 0, dryRunExact: 0 },
  };
}
function mkReport(m: EvalMetrics, cases: Array<{ id: string; passed: boolean }>): EvalReport {
  return {
    schema: "anysearch/eval-report@1",
    generatedAt: "ts",
    datasetFingerprint: "abc123",
    holdoutFingerprint: "test-hfp",
    totals: { cases: m.counts.cases, passed: m.counts.casesPassed, failed: m.counts.cases - m.counts.casesPassed },
    stageBreakdown: { extract: 0, adjudicate: 0, store: 0, retrieve: 0 },
    tierBreakdown: { core: { cases: m.counts.cases, passed: m.counts.casesPassed, passRate: m.passRate } },
    metrics: m,
    cases: cases as unknown as EvalReport["cases"],
  };
}
const baseline: EvalBaseline = {
  schema: "anysearch/eval-baseline@1",
  fingerprint: "abc123",
  holdoutFingerprint: "test-hfp",
  metrics: mkMetrics(1, 3, 3),
  allowance: { supersessionFails: 1, quarantineFp: 0 },
  updatedAt: "2026-09-12",
  note: "t",
};
{
  const rep = mkReport(mkMetrics(2 / 3, 3, 2), [{ id: "ok", passed: true }, { id: "ok2", passed: true }, { id: "flaky", passed: false }]);
  assert(evaluateGate(rep, baseline).exitCode === 1, "an un-quarantined failure fails the gate (control)");
  const g = evaluateGate(rep, baseline, { quarantineActiveIds: ["flaky"] });
  assert(g.exitCode === 0, "a quarantined failure does NOT fail the gate");
  assert(g.warnings.some((w) => w.includes("quarantine active")), "the quarantine is disclosed as a warning");
  assert(rep.datasetFingerprint === baseline.fingerprint, "quarantine does not move the dataset fingerprint");
}

console.log("eval-quarantine.test.ts: " + passed + " passed, " + failed + " failed");
if (failed > 0) process.exit(1);
