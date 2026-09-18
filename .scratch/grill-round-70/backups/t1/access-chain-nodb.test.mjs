// ADR-0040 D5/D7 item 4: no-database run -> verifier exit 2 ("no input"); ship-gate maps it to
// an explicit skip + WARN ledger with 3-streak escalation. Verifier behavior is asserted by
// process spawn; gate mapping is asserted as a wiring contract over scripts/ship-gate.mjs.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return; }
  passed++;
}

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");
const VERIFIER = join(ROOT, "scripts", "verify-access-events.mjs");

const noDb = join(mkdtempSync(join(tmpdir(), "ans-chain-nodb-")), "missing.db");
try {
  const r = spawnSync(process.execPath, [VERIFIER, noDb], { cwd: ROOT, encoding: "utf8" });
  assert(r.status === 2, "no-db -> exit 2 (got " + r.status + ")");
  assert(String(r.stdout ?? "").includes("NO_DATABASE"), "no-db verdict JSON carries NO_DATABASE");

  const gate = readFileSync(join(ROOT, "scripts", "ship-gate.mjs"), "utf8");
  assert(gate.includes("verify-access-events.mjs"), "ship-gate spawns the verifier");
  assert(gate.includes("stepAccessChainVerify"), "ship-gate step-1 wiring present");
  assert(gate.includes("access-chain-skip-ledger.json"), "exit 2 mapped to skip-ledger");
  assert(gate.includes("consecutiveWarn >= 3"), "3-streak escalation wired");

  // Also: default-path resolution (no argv) hits NO_DATABASE via ANS_DB_PATH override.
  const r2 = spawnSync(process.execPath, [VERIFIER], { cwd: ROOT, encoding: "utf8", env: { ...process.env, ANS_DB_PATH: noDb } });
  assert(r2.status === 2, "ANS_DB_PATH honored for db resolution");
} finally { try { rmSync(join(noDb, ".."), { recursive: true, force: true }); } catch {} }

console.log("access-chain-nodb: " + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
