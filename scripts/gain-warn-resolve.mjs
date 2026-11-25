#!/usr/bin/env node
// scripts/gain-warn-resolve.mjs —: human resolution of a WARN streak on the gain ledger.
// Usage: node scripts/gain-warn-resolve.mjs --decision disable-arm|demote|stay-warn [--note "..."] [--ledger path]
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { readGainLedger, writeGainLedger, applyResolution, RESOLUTIONS, withSkipLedgerLock, GAIN_LEDGER_SCHEMA_V2, GAIN_LEDGER_SCHEMA_V3 } from "./gain-ledger.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const get = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const decision = get("--decision");
const note = get("--note") ?? "";
const ledgerPath = get("--ledger") ?? path.join(ROOT, ".ship-gate", "gain-ledger.json");

if (!decision || !RESOLUTIONS.includes(decision)) {
  console.error("usage: gain-warn-resolve --decision " + RESOLUTIONS.join("|") + " [--note ...] [--ledger path]");
  process.exit(2);
}
const now = new Date().toISOString();
const commit = (ledger) => {
  applyResolution(ledger, decision, now, note);
  writeGainLedger(ledgerPath, ledger);
  return ledger;
};
let ledger;
if (fs.existsSync(ledgerPath)) {
  const probe = readGainLedger(ledgerPath);
  if (probe.schema === GAIN_LEDGER_SCHEMA_V2 || probe.schema === GAIN_LEDGER_SCHEMA_V3) {
    // skip-ledger: hold the same lock eval's withSkipLedgerLock uses, so this
    // read-modify-write cannot race eval's dual writers or clobber @3 evidence.
    ledger = withSkipLedgerLock(ledgerPath, () => commit(readGainLedger(ledgerPath)));
  } else {
    ledger = commit(probe);
  }
} else {
  ledger = commit(readGainLedger(ledgerPath));
}
console.log("[gain-warn-resolve] decision=" + decision + " recorded; consecutiveWarn reset (ledger: " + ledgerPath + ")");

