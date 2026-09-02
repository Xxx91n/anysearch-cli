// ADR-0042 D4 (r108 impl): skip-ledger schema @2 — track field + reason-code split.
// data-absent (structural absence of data) never counts toward the 3-streak human-escalation
// rule and breaks any in-flight gate-not-met run; the first gate-not-met after data-absent
// entries starts counting from 1 again. @1 ledgers are upcast losslessly on read
// (npm lockfile read-old/write-new pattern), closing r106 F-08.
// ADR-0043 D7 (r42 impl): schema @3 — materialized state block {phase,since,transitionId,
// evidenceHash} + a separate actions log for stage-transition / rollback / freeze / check /
// readiness events. Actions NEVER influence the skip streak (a rollback is an action, not a
// skip). Upcast @2 -> @3 is lossless; unknown versions fail loud (canon of r110 SA-F-03).
import { existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync, closeSync } from "node:fs";
import { join } from "node:path";
import type { SwitchPhase } from "./switch-machine";

export const SKIP_LEDGER_SCHEMA = "anysearch/gain-ledger@3";
export const SKIP_LEDGER_SCHEMA_V2 = "anysearch/gain-ledger@2";
export const SKIP_LEDGER_SCHEMA_V1 = "anysearch/gain-ledger@1";
export const SKIP_STREAK_LIMIT = 3;

export type ObsTrack = "consumed" | "synthetic";
// ADR-0044 D2: reasonCode is open and deprecate-only. Newer ledger versions may carry new
// values; readers preserve them byte-for-byte instead of rejecting the file.
export type SkipReasonCode = string;

export interface SkipLedgerEntry {
  at: string;
  tier: string;
  look: string | number;
  track: ObsTrack;
  // r110 SA-F-09: a green entry means "no skips recorded" — a reason code would be
  // semantically contradictory, so green rows MUST omit reasonCode; warn/data-absent rows
  // MUST carry one. Enforced by validateEntry on read.
  reasonCode?: SkipReasonCode;
}

// ADR-0043 D7: the switch state block is a materialized cache of the access_events chain
// (the chain is the immutable source of truth; on conflict the chain wins).
export interface SwitchStateBlock {
  phase: SwitchPhase;
  since: string | null; // ISO timestamp of entering the current phase
  transitionId: string | null; // access_events.id of the transition row that set this phase
  evidenceHash: string | null; // eventHash of that chain row (cross-bind for --verify)
}

export interface SwitchActionEntry {
  at: string;
  kind: "stage-transition" | "rollback" | "freeze" | "check" | "readiness";
  from: string;
  to: string;
  reason: string;
  provenance?: "real" | "drill";
}

export interface SkipLedger {
  schema: typeof SKIP_LEDGER_SCHEMA;
  consecutiveWarn: number;
  history: SkipLedgerEntry[];
  resolutions: Array<{ at: string; decision: string; note: string }>;
  lastSkipKeys?: string[];
  state: SwitchStateBlock;
  actions: SwitchActionEntry[];
  revision: number;
}

export function emptySwitchState(at?: string): SwitchStateBlock {
  return { phase: "S0", since: at ?? null, transitionId: null, evidenceHash: null };
}

export function emptySkipLedger(): SkipLedger {
  return { schema: SKIP_LEDGER_SCHEMA, consecutiveWarn: 0, history: [], resolutions: [], lastSkipKeys: [], state: emptySwitchState(), actions: [], revision: 0 };
}

// @1/@2 -> @3: entries default to consumed track + gate-not-met reason (@1), and the state
// block boots as S0 with `since` from the earliest history entry (lossless: no @1/@2
// semantics are altered; @2 simply carried no state).
function upcastLegacy(j: {
  schema?: string;
  consecutiveWarn?: number;
  history?: Array<{ at: string; tier: string; look: string | number; track?: ObsTrack; reasonCode?: SkipReasonCode }>;
  resolutions?: Array<{ at: string; decision: string; note: string }>;
  lastSkipKeys?: string[];
}): SkipLedger {
  const hist = Array.isArray(j.history) ? j.history : [];
  const isV1 = j.schema === SKIP_LEDGER_SCHEMA_V1;
  return {
    schema: SKIP_LEDGER_SCHEMA,
    consecutiveWarn: typeof j.consecutiveWarn === "number" ? j.consecutiveWarn : 0,
    history: hist.map((h): SkipLedgerEntry => {
      const base: SkipLedgerEntry = { at: h.at, tier: h.tier, look: h.look, track: h.track ?? "consumed" };
      if (h.reasonCode !== undefined) base.reasonCode = h.reasonCode;
      else if (isV1 && h.tier !== "green") base.reasonCode = "gate-not-met";
      return base;
    }),
    resolutions: Array.isArray(j.resolutions) ? j.resolutions : [],
    lastSkipKeys: Array.isArray(j.lastSkipKeys) ? j.lastSkipKeys : [],
    state: emptySwitchState(hist.length > 0 ? hist[0]!.at : undefined),
    actions: [],
    revision: 0,
  };
}

const LEDGER_TIERS = ["green", "warn", "data-absent"] as const;
const PHASES: readonly string[] = ["S0", "S1", "S2", "S3", "S4"];
const ACTION_KINDS: readonly string[] = ["stage-transition", "rollback", "freeze", "check", "readiness"];

function validateEntry(e: unknown, idx: number): void {
  const o = e as Partial<SkipLedgerEntry> | null;
  if (!o || typeof o.at !== "string" || typeof o.tier !== "string") throw new Error("skip-ledger entry #" + idx + ": missing at/tier");
  if (!(LEDGER_TIERS as readonly string[]).includes(o.tier)) throw new Error("skip-ledger entry #" + idx + ": unknown tier " + o.tier);
  if (o.track !== "consumed" && o.track !== "synthetic") throw new Error("skip-ledger entry #" + idx + ": unknown track " + String(o.track));
  if (o.tier === "green") {
    if (o.reasonCode !== undefined) throw new Error("skip-ledger entry #" + idx + ": green row must not carry reasonCode");
  } else if (typeof o.reasonCode !== "string") {
    throw new Error("skip-ledger entry #" + idx + ": non-green row missing valid reasonCode");
  }
}

function validateStateBlock(s: unknown): void {
  const o = s as Partial<SwitchStateBlock> | null;
  if (!o || !PHASES.includes(String(o.phase))) throw new Error("skip-ledger state block: unknown phase " + String(o && o.phase));
  for (const k of ["since", "transitionId", "evidenceHash"] as const) {
    const v = o[k];
    if (v !== null && typeof v !== "string") throw new Error("skip-ledger state block: " + k + " must be string|null");
  }
}

// r110 SA-F-03: reading NEVER silently clears an unknown/corrupt ledger (schema-evolution
// discipline — Confluent/Solace rule: keep unknown data, fail loud). Callers quarantine the
// file aside and restart empty, surfacing the reason, instead of dropping history.
export class SkipLedgerError extends Error {}

export function parseSkipLedger(text: string): SkipLedger {
  let j: { schema?: unknown } & Record<string, unknown>;
  try {
    j = JSON.parse(text) as typeof j;
  } catch (e) {
    throw new SkipLedgerError("skip-ledger: not valid JSON: " + String((e as Error).message ?? e));
  }
  if (j && (j.schema === SKIP_LEDGER_SCHEMA_V1 || j.schema === SKIP_LEDGER_SCHEMA_V2)) return upcastLegacy(j as Parameters<typeof upcastLegacy>[0]);
  if (!j || j.schema !== SKIP_LEDGER_SCHEMA) throw new SkipLedgerError("skip-ledger: unknown schema " + String(j && j.schema));
  if (typeof j.consecutiveWarn !== "number" || !Array.isArray(j.history)) throw new SkipLedgerError("skip-ledger: malformed top-level shape");
  for (let i = 0; i < j.history.length; i++) validateEntry(j.history[i], i);
  if (!Array.isArray(j.resolutions)) throw new SkipLedgerError("skip-ledger: resolutions must be an array");
  if (j.lastSkipKeys !== undefined && !Array.isArray(j.lastSkipKeys)) throw new SkipLedgerError("skip-ledger: lastSkipKeys must be an array");
  if (!Array.isArray(j.lastSkipKeys)) j.lastSkipKeys = [];
  validateStateBlock(j.state);
  if (!Array.isArray(j.actions)) throw new SkipLedgerError("skip-ledger: actions must be an array");
  for (let i = 0; i < j.actions.length; i++) {
    const a = j.actions[i]!;
    if (typeof a.at !== "string" || !ACTION_KINDS.includes(a.kind)) throw new SkipLedgerError("skip-ledger action #" + i + ": malformed (at/kind)");
    if (a.provenance !== undefined && a.provenance !== "real" && a.provenance !== "drill") throw new SkipLedgerError("skip-ledger action #" + i + ": invalid provenance");
  }
  if (typeof j.revision !== "number" || !Number.isInteger(j.revision)) j.revision = 0;
  return j as unknown as SkipLedger;
}

// Record one eval run's skip-key set (skips are "identical" when the key set repeats).
// Multi-tier alignment with ADR-0038: consecutive identical sets bump the streak; a run with
// zero skips resets it. ADR-0042 D4: a data-absent run never bumps the streak and breaks the
// run (streak back to 0), so the next gate-not-met run starts at 1.
export function recordSkips(
  ledger: SkipLedger,
  skipKeys: string[],
  at: string,
  meta: { track?: ObsTrack; reasonCode?: SkipReasonCode } = {},
): number {
  const track = meta.track ?? "consumed";
  const reasonCode = meta.reasonCode ?? "gate-not-met";
  const sorted = [...skipKeys].sort();
  // ADR-0044 D4: synthetic drills are a separate plane. Their skip history is retained for
  // provenance, but they never advance the consumed three-streak escalation budget.
  if (track === "synthetic") {
    if (sorted.length === 0) {
      ledger.history = [...ledger.history, { at, tier: "green", look: "", track }].slice(-20);
      return 0;
    }
    if (reasonCode === "data-absent") {
      ledger.history = [...ledger.history, { at, tier: "data-absent", look: sorted.join("; ").slice(0, 200), track, reasonCode }].slice(-20);
      return 0;
    }
    ledger.history = [...ledger.history, { at, tier: "warn", look: sorted.join("; ").slice(0, 200), track, reasonCode }].slice(-20);
    return 0;
  }
  if (sorted.length === 0) {
    ledger.consecutiveWarn = 0;
    ledger.lastSkipKeys = [];
    // r115 audit S5/C5: evaluation cadence is the count of evaluation rounds, not access
    // events. The orchestrator seeds evaluationCount from the ledger's readiness actions
    // ring; advanceSwitch takes care of incrementing it elsewhere, so nothing to do here.
    ledger.history = [...ledger.history, { at, tier: "green", look: "", track }].slice(-20);
    return 0;
  }
  if (reasonCode === "data-absent") {
    ledger.consecutiveWarn = 0;
    ledger.lastSkipKeys = [];
    ledger.history = [...ledger.history, { at, tier: "data-absent", look: sorted.join("; ").slice(0, 200), track, reasonCode }].slice(-20);
    return 0;
  }
  const same = JSON.stringify(sorted) === JSON.stringify(ledger.lastSkipKeys ?? []);
  ledger.consecutiveWarn = same ? ledger.consecutiveWarn + 1 : 1;
  ledger.lastSkipKeys = sorted;
  ledger.history = [...ledger.history, { at, tier: "warn", look: sorted.join("; ").slice(0, 200), track, reasonCode }].slice(-20);
  return ledger.consecutiveWarn;
}

export function skipMustFail(ledger: SkipLedger): boolean {
  return ledger.consecutiveWarn >= SKIP_STREAK_LIMIT;
}

// ADR-0043 D5/D7: switch actions are ledgered separately from skip entries — an action is
// never a skip and never touches consecutiveWarn. Capped ring, capped reason length.
export function appendSwitchAction(ledger: SkipLedger, a: SwitchActionEntry): void {
  ledger.actions = [...ledger.actions, { at: a.at, kind: a.kind, from: a.from, to: a.to, reason: a.reason.slice(0, 400), ...(a.provenance ? { provenance: a.provenance } : {}) }].slice(-100);
}

// consecutive trailing actions matching pred (anti-flap / streak inputs for decideSwitch).
export function tailStreak(actions: SwitchActionEntry[], pred: (a: SwitchActionEntry) => boolean): number {
  let n = 0;
  for (let i = actions.length - 1; i >= 0; i--) {
    if (!pred(actions[i]!)) break;
    n++;
  }
  return n;
}

// ADR-0044 D5: close the dual-writer read-modify-write window for the JSON skip-ledger.
// A sidecar lock file wraps every read/modify/atomic-rename cycle. Stale locks are recovered
// when the owning process no longer exists.
function ledgerPathFor(outDir: string): string { return join(outDir, "skip-ledger.json"); }
function lockPathFor(outDir: string): string { return join(outDir, ".skip-ledger.lock"); }

// r115 audit S6: under Windows file-locking semantics a still-running owner cannot be
// rmSync'd from a sibling, leaving a stuck lock file. The default lock max age (5 minutes)
// bounds the recovery window without making healthy locks flappable.
const LOCK_MAX_AGE_MS = 5 * 60 * 1000;

function sleep(ms: number): void { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

function processAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function lockIsRecoverable(info: { pid?: number; at?: string } | null): boolean {
  if (!info) return true;
  if (typeof info.pid === "number" && !processAlive(info.pid)) return true;
  if (typeof info.at === "string") {
    const t = Date.parse(info.at);
    if (Number.isFinite(t) && Date.now() - t > LOCK_MAX_AGE_MS) return true;
  }
  return false;
}

export function readSkipLedger(outDir: string): SkipLedger {
  const p = ledgerPathFor(outDir);
  return existsSync(p) ? parseSkipLedger(readFileSync(p, "utf8")) : emptySkipLedger();
}

export function writeSkipLedgerAtomic(outDir: string, ledger: SkipLedger): void {
  mkdirSync(outDir, { recursive: true });
  ledger.revision = (ledger.revision ?? 0) + 1;
  const p = ledgerPathFor(outDir);
  const tmp = p + ".tmp";
  writeFileSync(tmp, JSON.stringify(ledger, null, 2) + "\n", "utf8");
  renameSync(tmp, p);
}

export function quarantineSkipLedger(outDir: string, at: string): string {
  const p = ledgerPathFor(outDir);
  const q = p.replace(/\.json$/, ".quarantined-" + at.replace(/[:.]/g, "-") + ".json");
  try { renameSync(p, q); } catch { /* restart empty regardless */ }
  return q;
}

export function withSkipLedgerLock<T>(outDir: string, fn: (ledger: SkipLedger) => T): T {
  mkdirSync(outDir, { recursive: true });
  const lockPath = lockPathFor(outDir);
  for (let attempt = 0; attempt < 100; attempt++) {
    let fd: number | undefined;
    try {
      fd = openSync(lockPath, "wx");
      writeFileSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }), "utf8");
      closeSync(fd);
      try {
        const ledger = readSkipLedger(outDir);
        return fn(ledger);
      } finally {
        try { rmSync(lockPath, { force: true }); } catch { /* next lock owner recovers stale lock */ }
      }
    } catch (e) {
      if (fd !== undefined) { try { closeSync(fd); } catch { /* already closed */ } }
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      try {
        let info: { pid?: number; at?: string } | null = null;
        try { info = JSON.parse(readFileSync(lockPath, "utf8")) as { pid?: number; at?: string }; } catch { info = null; }
        // Unparseable lock or recoverable (dead pid / stale mtime) -> reap and retry on next attempt.
        if (info === null || lockIsRecoverable(info)) rmSync(lockPath, { force: true });
      } catch { /* transient filesystem failure; retry */ }
      sleep(25);
    }
  }
  throw new SkipLedgerError("skip-ledger lock timeout: " + lockPath);
}
