#!/usr/bin/env node
// scripts/gain-warn-resolve.mjs — ADR-0038 D2: human resolution of a WARN streak on the gain ledger.
// Usage: node scripts/gain-warn-resolve.mjs --decision disable-arm|demote|stay-warn [--note "..."] [--ledger path]
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readGainLedger, writeGainLedger, applyResolution, RESOLUTIONS } from "./gain-ledger.mjs";

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
const ledger = readGainLedger(ledgerPath);
applyResolution(ledger, decision, new Date().toISOString(), note);
writeGainLedger(ledgerPath, ledger);
console.log("[gain-warn-resolve] decision=" + decision + " recorded; consecutiveWarn reset (ledger: " + ledgerPath + ")");

