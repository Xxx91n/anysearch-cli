// ADR-0044 D6: negative ship-gate contract for a failed run-level integrity verdict.
import { evalIntegrityCheck } from "../../../scripts/eval-integrity-contract.mjs";

let passed = 0, failed = 0;
function assert(cond, msg) { if (!cond) { failed++; console.error("FAIL: " + msg); return; } passed++; }

assert(evalIntegrityCheck({ integrity: { verdict: "pass", runPurpose: "observational" } }).ok, "observational pass contract is accepted");
assert(evalIntegrityCheck({ integrity: { verdict: "pass", runPurpose: "decision" } }).ok, "decision pass verdict is accepted (ship-gate happy path)");
assert(!evalIntegrityCheck({ integrity: { verdict: "failed", runPurpose: "decision" } }).ok, "failed decision verdict is publish-red");
assert(!evalIntegrityCheck({ integrity: { verdict: "pass", runPurpose: "invalid" } }).ok, "invalid runPurpose is rejected");
assert(!evalIntegrityCheck({}).ok, "missing integrity contract is rejected");

console.log("eval-ship-gate-integrity.test: " + passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
