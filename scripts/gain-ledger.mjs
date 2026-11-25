// scripts/gain-ledger.mjs
// gain-ledger for the three-tier gain gate — tracks the consecutive-WARN streak.
// Pure functions over plain objects + a tiny file IO wrapper; unit-tested by packages/store/test/gain-ledger.test.mjs.
import fs from "node:fs";
import path from "node:path";

export const GAIN_LEDGER_SCHEMA = "anysearch/gain-ledger@1";
export const GAIN_LEDGER_SCHEMA_V2 = "anysearch/gain-ledger@2";
export const GAIN_LEDGER_SCHEMA_V3 = "anysearch/gain-ledger@3";
export const WARN_STREAK_LIMIT = 3;

// close the dual-writer read-modify-write window on the JSON ledger. Same lock
// protocol as packages/store/src/eval/skip-ledger.ts (same `.skip-ledger.lock`
// sidecar, pid + mtime stale recovery) so `gain-warn-resolve` never races eval's
// `withSkipLedgerLock` writers and never clobbers @3 evidence.
const LOCK_MAX_AGE_MS = 5 * 60 * 1000;
const LOCK_RETRIES = 100;
const LOCK_RETRY_MS = 25;

export function emptyLedger() {
  return {
    schema: GAIN_LEDGER_SCHEMA,
    consecutiveWarn: 0,
    history: [],
    resolutions: [],
    disposition: null,
    verdict: null,
  };
}

export function readGainLedger(file) {
  if (!fs.existsSync(file)) return emptyLedger();
  try {
    const j = JSON.parse(fs.readFileSync(file, "utf8"));
    if (j.schema === GAIN_LEDGER_SCHEMA_V3) {
      // @3 skip-ledger (shared wire family): keep every field byte-for-byte
      // (state / actions / revision / lastSkipKeys, plus entry-level track /
      // reasonCode) so a human resolution never wipes the evidence the lock
      // exists to protect. consecutiveWarn / resolutions are normalized here;
      // disposition / verdict are @1-only fields — writeGainLedger drops them
      // when writing back an @3 schema so eval never sees @1-shaped keys it
      // does not understand.
      return {
        ...j,
        consecutiveWarn: typeof j.consecutiveWarn === "number" ? j.consecutiveWarn : 0,
        history: Array.isArray(j.history) ? j.history : [],
        resolutions: Array.isArray(j.resolutions) ? j.resolutions : [],
      };
    }
    // also accept the @2 skip-ledger (shared wire family; fields/track are
    // additive and preserved untouched on write-back).
    if ((j.schema !== GAIN_LEDGER_SCHEMA && j.schema !== GAIN_LEDGER_SCHEMA_V2) || typeof j.consecutiveWarn !== "number" || !Array.isArray(j.history)) return emptyLedger();
    if (!Array.isArray(j.resolutions)) j.resolutions = [];
    if (j.disposition === undefined) j.disposition = null;
    if (j.verdict === undefined) j.verdict = null;
    return j;
  } catch {
    return emptyLedger();
  }
}

export function writeGainLedger(file, ledger) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  // @3 skip-ledger has no disposition/verdict fields (those are @1-only).
  // applyResolution unconditionally sets them, so strip them when writing an
  // @3 schema back — otherwise eval would persist @1-shaped keys it does not
  // understand and could lose them on its next write.
  const out = ledger.schema === GAIN_LEDGER_SCHEMA_V3
    ? { ...ledger, disposition: undefined, verdict: undefined }
    : ledger;
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(out, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, file);
}

// pidIsAlive mirrors packages/store/src/eval/skip-ledger.ts's stale-lock
// recovery without importing the TS module (scripts are plain stdlib Node).
// Product rule (packages/store/src/process-liveness.ts): only ESRCH proves
// death — EPERM and every other probe failure mean "not proven dead", i.e.
// the holder is treated as alive. Treating unknown errors as dead would reap
// a still-live lock and let two writers clobber one ledger.
function pidIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code !== "ESRCH";
  }
}

function lockIsRecoverable(info) {
  if (!info) return true;
  if (typeof info.pid === "number" && !pidIsAlive(info.pid)) return true;
  if (typeof info.at === "string") {
    const t = Date.parse(info.at);
    if (Number.isFinite(t) && Date.now() - t > LOCK_MAX_AGE_MS) return true;
  }
  return false;
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// Holds the same `.skip-ledger.lock` sidecar eval's withSkipLedgerLock uses,
// so a skip-ledger read-modify-write is mutually exclusive with eval's writers.
// @1 gain-ledger files are NOT locked (unchanged behavior); callers gate on schema.
export function withSkipLedgerLock(ledgerPath, fn) {
  const dir = path.dirname(ledgerPath);
  fs.mkdirSync(dir, { recursive: true });
  const lockPath = path.join(dir, ".skip-ledger.lock");
  for (let attempt = 0; attempt < LOCK_RETRIES; attempt++) {
    let fd;
    try {
      fd = fs.openSync(lockPath, "wx");
      fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }), "utf8");
      fs.closeSync(fd);
      try {
        return fn();
      } finally {
        try { fs.rmSync(lockPath, { force: true }); } catch { /* next lock owner recovers stale lock */ }
      }
    } catch (e) {
      if (fd !== undefined) { try { fs.closeSync(fd); } catch { /* already closed */ } }
      if (e.code !== "EEXIST") throw e;
      let info = null;
      try { info = JSON.parse(fs.readFileSync(lockPath, "utf8")); } catch { info = null; }
      // Unparseable lock or recoverable (dead pid / stale mtime) -> reap and retry on next attempt.
      if (info === null || lockIsRecoverable(info)) { try { fs.rmSync(lockPath, { force: true }); } catch { /* transient filesystem failure; retry */ } }
      sleep(LOCK_RETRY_MS);
    }
  }
  throw new Error("skip-ledger lock timeout: " + lockPath);
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
  ledger.disposition = decision;
  ledger.verdict = decision === "demote" ? "unproven-positive" : null;
  return ledger;
}

export function mustFail(ledger) {
  return ledger.consecutiveWarn >= WARN_STREAK_LIMIT;
}
