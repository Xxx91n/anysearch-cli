// ADR-0047 D6: ship-gate verifier wiring and independent command integration.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
}

// Independent verifier 0/1/2 semantics.
const dir = mkdtempSync(join(tmpdir(), "ans-override-verifier-"));
try {
  const status = verifierRun(["status", "--ledger", dir]);
  assert(status.code === 0, "empty ledger status exits 0");

  const record = verifierRun([
    "record",
    "--ledger", dir,
    "--dataset-fingerprint", "ds",
    "--holdout-fingerprint", "h",
    "--reason-code", "provider-emergency",
    "--override-at", "2020-01-01T00:00:00.000Z",
    "--window-end", "2020-01-03T00:00:00.000Z",
  ]);
  assert(record.code === 0, "record override exits 0");

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
    "--dataset-fingerprint", "ds",
    "--holdout-fingerprint", "h",
  ]);
  assert(ack.code === 0, "late acknowledgement exits 0 for a LATE obligation");

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

// Eval integrity contract accepts override only with a closed reasonCode.
{
  const ok = evalIntegrityCheck({ integrity: { verdict: "pass", runPurpose: "override", overrideReasonCode: "provider-emergency" } });
  assert(ok.ok, "override runPurpose with valid reason is accepted");
  const bad = evalIntegrityCheck({ integrity: { verdict: "pass", runPurpose: "override", overrideReasonCode: "made-up" } });
  assert(!bad.ok, "override runPurpose rejects unknown reasonCode");
}

console.log("eval-ship-gate-override.test.ts: " + passed + " passed, " + failed + " failed");
if (failed > 0) process.exit(1);
