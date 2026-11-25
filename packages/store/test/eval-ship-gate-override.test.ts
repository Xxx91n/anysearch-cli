// ship-gate verifier wiring and independent command integration.
import { spawnSync } from "node:child_process";
import { mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { withShipOverrideLedgerLock } from "../src/eval/override-ledger";
import { LedgerLockTimeoutError } from "../src/eval/ledger-lock";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..", "..", "..");
const verifier = join(root, "packages", "store", "src", "eval", "override-verifier.ts");
const require = createRequire(import.meta.url);
const { evalIntegrityCheck } = require(join(root, "scripts", "eval-integrity-contract.mjs")) as {
  evalIntegrityCheck: (report: unknown) => { ok: boolean; detail: string };
};

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return; }
  passed++;
}

function verifierRun(args: string[]): { code: number; stdout: string; stderr: string } {
  const res = spawnSync(process.execPath, ["--import", "tsx", verifier, ...args], {
    cwd: join(root, "packages", "store"),
    encoding: "utf8",
  });
  return { code: res.status ?? -1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

// Ship-gate source must contain the actual verifier step, not just token checks.
{
  const shipGate = readFileSync(join(root, "scripts", "ship-gate.mjs"), "utf8");
  assert(shipGate.includes("stepOverrideGovernance"), "ship-gate wires stepOverrideGovernance");
  assert(shipGate.includes("override-verifier.ts"), "ship-gate references override-verifier.ts");
  assert(shipGate.includes("record") && shipGate.includes("acknowledge-late"), "ship-gate supports override record and late acknowledgement");
  assert(shipGate.includes('"src/eval/cli.ts", "--calibrate"'), "ship-gate forces rebaseline after override");
}

// Independent verifier 0/1/2 semantics.
const dir = mkdtempSync(join(tmpdir(), "ans-override-verifier-"));
try {
  const status = verifierRun(["status", "--ledger", dir]);
  assert(status.code === 0, "empty ledger status exits 0");

  const criticalReportPath = join(dir, "critical-gate-report.json");
  writeFileSync(criticalReportPath, JSON.stringify({
    gate: {
      verdict: "fail",
      exitCode: 1,
      failures: ["weakest-link RED relation: critical arm must demote and block ship "],
    },
  }), "utf8");
  const record = verifierRun([
    "record",
    "--ledger", dir,
    "--dataset-fingerprint", "ds",
    "--holdout-fingerprint", "h",
    "--reason-code", "provider-emergency",
    "--gate-report", criticalReportPath,
    "--override-at", "2020-01-01T00:00:00.000Z",
    "--window-end", "2020-01-03T00:00:00.000Z",
  ]);
  assert(record.code === 0, "record override exits 0");
  const ledgerAfterRecord = JSON.parse(readFileSync(join(dir, "ship-override-ledger.json"), "utf8"));
  assert(ledgerAfterRecord.entries[0].gateStateBefore.weakestLinkCritical.length > 0, "record preserves critical weakest-link evidence");

  const duplicate = verifierRun([
    "record",
    "--ledger", dir,
    "--dataset-fingerprint", "ds",
    "--holdout-fingerprint", "h",
    "--reason-code", "upstream-breaking-change",
  ]);
  assert(duplicate.code === 1, "same-epoch duplicate override exits 1");

  const ack = verifierRun([
    "acknowledge-late",
    "--ledger", dir,
  ]);
  assert(ack.code === 0, "late acknowledgement exits 0 for a LATE obligation");

  const nonCriticalDir = mkdtempSync(join(tmpdir(), "ans-override-noncritical-"));
  try {
    const nonCriticalReportPath = join(nonCriticalDir, "gate-report.json");
    writeFileSync(nonCriticalReportPath, JSON.stringify({
      gate: { verdict: "fail", exitCode: 1, failures: ["passRate 0.500 < 1.0"] },
    }), "utf8");
    const denied = verifierRun([
      "record",
      "--ledger", nonCriticalDir,
      "--dataset-fingerprint", "ds2",
      "--holdout-fingerprint", "h2",
      "--reason-code", "provider-emergency",
      "--gate-report", nonCriticalReportPath,
    ]);
    assert(denied.code === 1, "non-critical publish-red cannot be overridden");
  } finally {
    rmSync(nonCriticalDir, { recursive: true, force: true });
  }

  const artifactPath = join(dir, "postmortem.json");
  writeFileSync(artifactPath, JSON.stringify({
    schema: "anysearch/ship-override-postmortem@1",
    impact: "provider down",
    cause: "upstream broke",
    followups: [{ owner: "oncall", action: "add fallback", status: "open" }],
  }), "utf8");
  const complete = verifierRun([
    "complete-postmortem",
    "--ledger", dir,
    "--dataset-fingerprint", "ds",
    "--holdout-fingerprint", "h",
    "--artifact", artifactPath,
  ]);
  assert(complete.code === 0, "schema-validated postmortem completion exits 0");

  const corruptDir = mkdtempSync(join(tmpdir(), "ans-override-corrupt-"));
  writeFileSync(join(corruptDir, "ship-override-ledger.json"), "{}", "utf8");
  const corrupt = verifierRun(["status", "--ledger", corruptDir]);
  assert(corrupt.code === 2, "malformed ledger exits 2");
  rmSync(corruptDir, { recursive: true, force: true });
} finally {
  rmSync(dir, { recursive: true, force: true });
}

// #570: a live owner's lock survives a probe that cannot be classified. Only
// ESRCH proves the owner is gone; the old catch-all treated an EPERM probe as
// death and deleted a fresh lock out from under a running writer.
{
  const lockDir = mkdtempSync(join(tmpdir(), "ans-override-lock-"));
  const lock = join(lockDir, ".ship-override-ledger.lock");
  writeFileSync(lock, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
  const realKill = process.kill;
  const unconfirmable: typeof process.kill = (pid, signal) => {
    if (pid === process.pid && signal === 0) {
      throw Object.assign(new Error("probe could not classify this pid"), { code: "EPERM" });
    }
    return realKill(pid, signal);
  };
  process.kill = unconfirmable;
  let survived = false;
  try {
    try {
      withShipOverrideLedgerLock(lockDir, () => {});
    } catch {
      // Expected: with the lock kept, the 100 × 25 ms retry loop runs out.
    }
    survived = existsSync(lock);
  } finally {
    process.kill = realKill;
    rmSync(lockDir, { recursive: true, force: true });
  }
  assert(survived, "an unconfirmable probe keeps a live override writer's lock");
}

// #577: a live owner keeps the override lock however old the record is. Age is not proof of death,
// and deleting a live lock is how two writers end up appending to the same ledger.
{
  const dir = mkdtempSync(join(tmpdir(), "ans-override-lock-age-"));
  const lock = join(dir, ".ship-override-ledger.lock");
  const record = JSON.stringify({ pid: process.pid, at: new Date(Date.now() - 10 * 60 * 1000).toISOString() });
  writeFileSync(lock, record, "utf8");
  let entered = false;
  let timedOut = false;
  try {
    withShipOverrideLedgerLock(dir, () => { entered = true; return null; });
  } catch (e) {
    timedOut = e instanceof LedgerLockTimeoutError;
  }
  assert(!entered && timedOut && readFileSync(lock, "utf8") === record, "a live owner keeps the override lock however old its record");
  rmSync(dir, { recursive: true, force: true });
}

// #577: releasing removes only the record this call wrote, never a successor's lock.
{
  const dir = mkdtempSync(join(tmpdir(), "ans-override-lock-release-"));
  const lock = join(dir, ".ship-override-ledger.lock");
  const successor = JSON.stringify({ pid: 4242, at: new Date().toISOString() });
  withShipOverrideLedgerLock(dir, () => {
    writeFileSync(lock, successor, "utf8");
    return null;
  });
  assert(existsSync(lock) && readFileSync(lock, "utf8") === successor, "releasing leaves a lock this call no longer owns");
  rmSync(dir, { recursive: true, force: true });
}

// #577: the override ledger is wired to the same lock, so a proven-dead owner is still reaped at
// once. This pins the wiring; the age rules themselves are covered once, where they live.
{
  const dir = mkdtempSync(join(tmpdir(), "ans-override-lock-dead-"));
  const lock = join(dir, ".ship-override-ledger.lock");
  writeFileSync(lock, JSON.stringify({ pid: 999999, at: new Date().toISOString() }), "utf8");
  const realKill = process.kill;
  process.kill = ((pid: number, signal?: string | number) => {
    if (pid === 999999 && signal === 0) throw Object.assign(new Error("no such process"), { code: "ESRCH" });
    return realKill(pid, signal as NodeJS.Signals);
  }) as typeof process.kill;
  let entered = false;
  try {
    withShipOverrideLedgerLock(dir, () => { entered = true; return null; });
  } finally {
    process.kill = realKill;
  }
  assert(entered && !existsSync(lock), "a proven-dead owner is reaped on the override lock");
  rmSync(dir, { recursive: true, force: true });
}

// #577: a held lock is exit 3 (contention, nothing changed), not exit 2 (corrupt ledger).
{
  const dir = mkdtempSync(join(tmpdir(), "ans-override-lock-exit3-"));
  writeFileSync(join(dir, ".ship-override-ledger.lock"), JSON.stringify({ pid: process.pid, at: new Date().toISOString() }), "utf8");
  const gateReport = join(dir, "eval-report.json");
  writeFileSync(gateReport, JSON.stringify({ gate: { verdict: "fail", exitCode: 1, failures: ["weakest-link RED arm-a"] } }), "utf8");
  const res = verifierRun([
    "record",
    "--ledger", dir,
    "--dataset-fingerprint", "ds",
    "--holdout-fingerprint", "h",
    "--reason-code", "provider-emergency",
    "--gate-report", gateReport,
  ]);
  assert(res.code === 3, "lock contention exits 3, not 2");
  assert(res.stderr.includes(".ship-override-ledger.lock") && res.stderr.includes("delete the lock file"), "the exit-3 message names the lock file and the way out");
  rmSync(dir, { recursive: true, force: true });
}

// Eval integrity contract accepts override only with a closed reasonCode.
{
  const ok = evalIntegrityCheck({ integrity: { verdict: "pass", runPurpose: "override", overrideReasonCode: "provider-emergency" } });
  assert(ok.ok, "override runPurpose with valid reason is accepted");
  const bad = evalIntegrityCheck({ integrity: { verdict: "pass", runPurpose: "override", overrideReasonCode: "made-up" } });
  assert(!bad.ok, "override runPurpose rejects unknown reasonCode");
}

console.log("eval-ship-gate-override.test.ts: " + passed + " passed, " + failed + " failed");
if (failed > 0) process.exit(1);
