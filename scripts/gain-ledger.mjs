// scripts/gain-ledger.mjs
// ADR-0038 D2: gain-ledger for the three-tier gain gate — tracks the consecutive-WARN streak.
// Pure functions over plain objects + a tiny file IO wrapper; unit-tested by test/gain-ledger.test.mjs.
import fs from "node:fs";
import path from "node:path";

export const GAIN_LEDGER_SCHEMA = "anysearch/gain-ledger@1";
export const WARN_STREAK_LIMIT = 3;

export function emptyLedger() {
  return { schema: GAIN_LEDGER_SCHEMA, consecutiveWarn: 0, history: [], resolutions: [] };
}

export function readGainLedger(file) {
  if (!fs.existsSync(file)) return emptyLedger();
  try {
    const j = JSON.parse(fs.readFileSync(file, "utf8"));
    if (j.schema !== GAIN_LEDGER_SCHEMA || typeof j.consecutiveWarn !== "number" || !Array.isArray(j.history)) return emptyLedger();
    if (!Array.isArray(j.resolutions)) j.resolutions = [];
    return j;
  } catch {
    return emptyLedger();
  }
}

export function writeGainLedger(file, ledger) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(ledger, null, 2) + "\n", "utf8");
}

// applyTier: mutates and returns the ledger; returns the resulting streak for caller decisions.
export function applyTier(ledger, tier, at, look) {
  ledger.history = [...ledger.history, { at, tier, look }].slice(-20);
  ledger.consecutiveWarn = tier === "warn" ? ledger.consecutiveWarn + 1 : 0;
  return ledger;
}

// resolve: a human decision clears the streak and is recorded (disable-arm | demote | stay-warn).
export const RESOLUTIONS = ["disable-arm", "demote", "stay-warn"];
export function applyResolution(ledger, decision, at, note) {
  if (!RESOLUTIONS.includes(decision)) throw new Error("unknown resolution: " + decision);
  ledger.resolutions = [...ledger.resolutions, { at, decision, note: note ?? "" }].slice(-20);
  ledger.consecutiveWarn = 0;
  return ledger;
}

export function mustFail(ledger) {
  return ledger.consecutiveWarn >= WARN_STREAK_LIMIT;
}

