// ADR-0059 D3 (T-2) + round-58 audit R-3: the quarantine SLA needs an EXECUTABLE enforcement point,
// otherwise the ledger is a graveyard. This test fails when an entry is past its TTL or overdue for
// its weekly review, which turns the test job red (turbo test runs in ci and in ship-gate step 3).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expiredEntries, readQuarantine, reviewDue } from "../src/eval/quarantine-ledger";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ledgerPath = path.join(__dirname, "..", "eval-quarantine.json");
if (!fs.existsSync(ledgerPath)) {
  console.error("FAIL: eval-quarantine.json is missing (ADR-0059 D3)");
  process.exit(1);
}
const ledger = readQuarantine(ledgerPath);
const now = new Date().toISOString();

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

const expired = expiredEntries(ledger, now);
assert(expired.length === 0, "no quarantine entry is past its TTL (expired: " + expired.map((e) => e.id).join(", ") + ") - promote, renew (max 2) or retire per ADR-0027 D8");
const overdue = reviewDue(ledger, now);
assert(overdue.length === 0, "no quarantine entry is overdue for its weekly review (overdue: " + overdue.map((e) => e.id).join(", ") + ")");

console.log("eval-quarantine-sla.test.ts: " + passed + " passed, " + failed + " failed");
if (failed > 0) process.exit(1);
