// (r108 impl): skip-ledger schema @2 — track field + reason-code split.
// data-absent (structural absence of data) never counts toward the 3-streak human-escalation
// rule and breaks any in-flight gate-not-met run; the first gate-not-met after data-absent
// entries starts counting from 1 again. @1 ledgers are upcast losslessly on read
// (npm lockfile read-old/write-new pattern), closing r106.
// (r42 impl): schema @3 — materialized state block {phase,since,transitionId,
// evidenceHash} + a separate actions log for stage-transition / rollback / freeze / check /
// readiness events. Upcast @1/@2 -> @3 is lossless; unknown versions fail loud (canon of r110 SA-).
// This module owns skip-ledger.json (@3) state, lock, atomic write, and quarantine for switch-run
// and ans switch-state; the eval path no longer runs skip-streak accounting.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { withLedgerLock } from "./ledger-lock";
import type { SwitchPhase } from "./switch-machine";

export const SKIP_LEDGER_SCHEMA = "anysearch/gain-ledger@3";
export const SKIP_LEDGER_SCHEMA_V2 = "anysearch/gain-ledger@2";
export const SKIP_LEDGER_SCHEMA_V1 = "anysearch/gain-ledger@1";

export type ObsTrack = "consumed" | "synthetic";
// reasonCode is open and deprecate-only. Newer ledger versions may carry new
// values; readers preserve them byte-for-byte instead of rejecting the file.
export type SkipReasonCode = string;

export interface SkipLedgerEntry {
  at: string;
  tier: string;
  look: string | number;
  track: ObsTrack;
  // r110 SA-: a green entry means "no skips recorded" — a reason code would be
  // semantically contradictory, so green rows MUST omit reasonCode; warn/data-absent rows
  // MUST carry one. Enforced by validateEntry on read.
  reasonCode?: SkipReasonCode;
}

// the switch state block is a materialized cache of the access_events chain
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
  if (!o || typeof o.at !== "string" || typeof o.tier !== "string") throw new SkipLedgerError("skip-ledger entry #" + idx + ": missing at/tier");
  if (!(LEDGER_TIERS as readonly string[]).includes(o.tier)) throw new SkipLedgerError("skip-ledger entry #" + idx + ": unknown tier " + o.tier);
  if (o.track !== "consumed" && o.track !== "synthetic") throw new SkipLedgerError("skip-ledger entry #" + idx + ": unknown track " + String(o.track));
  if (o.tier === "green") {
    if (o.reasonCode !== undefined) throw new SkipLedgerError("skip-ledger entry #" + idx + ": green row must not carry reasonCode");
  } else if (typeof o.reasonCode !== "string") {
    throw new SkipLedgerError("skip-ledger entry #" + idx + ": non-green row missing valid reasonCode");
  }
}

function validateStateBlock(s: unknown): void {
  const o = s as Partial<SwitchStateBlock> | null;
  if (!o || !PHASES.includes(String(o.phase))) throw new SkipLedgerError("skip-ledger state block: unknown phase " + String(o && o.phase));
  for (const k of ["since", "transitionId", "evidenceHash"] as const) {
    const v = o[k];
    if (v !== null && typeof v !== "string") throw new SkipLedgerError("skip-ledger state block: " + k + " must be string|null");
  }
}

// r110 SA-: reading NEVER silently clears an unknown/corrupt ledger (schema-evolution
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

// switch actions are ledgered separately from legacy skip fields and never touch consecutiveWarn.
// Capped ring, capped reason length.
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

// Serialize read-modify-write cycles on the JSON skip-ledger (used by switch-run).
// A sidecar lock file wraps every read/modify/atomic-rename cycle; the reaping and release rules
// live in ledger-lock so the skip and ship-override ledgers answer the same way.
function ledgerPathFor(outDir: string): string { return join(outDir, "skip-ledger.json"); }
function lockPathFor(outDir: string): string { return join(outDir, ".skip-ledger.lock"); }

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

// Three outcomes, because the callers say three different things: where the file went, that there
// was nothing to move, or why the move failed. A bare path or null cannot tell the last two apart,
// and a caller that reports "quarantined to <path>" must never point at a file still in place.
export type QuarantineResult =
  | { quarantined: string }
  | { absent: true }
  | { failed: unknown };

export function quarantineSkipLedger(outDir: string, at: string): QuarantineResult {
  const p = ledgerPathFor(outDir);
  const q = p.replace(/\.json$/, ".quarantined-" + at.replace(/[:.]/g, "-") + ".json");
  try {
    renameSync(p, q);
    return { quarantined: q };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { absent: true };
    return { failed: e };
  }
}

export function withSkipLedgerLock<T>(outDir: string, fn: (ledger: SkipLedger) => T): T {
  return withLedgerLock(lockPathFor(outDir), () => fn(readSkipLedger(outDir)));
}

// Run a skip-ledger writer (such as advanceSwitch) with narrow corrupt-ledger recovery:
// only SkipLedgerError quarantines the unreadable file aside and retries once; lock contention
// and filesystem errors leave the healthy ledger untouched (#577/#591).
export function runWithSkipLedgerRecovery<T>(
  outDir: string,
  fn: () => T,
  onNote?: (msg: string) => void,
  at: string = new Date().toISOString(),
): T {
  try {
    return fn();
  } catch (e) {
    if (!(e instanceof SkipLedgerError)) throw e;
    const detail = String(e.message ?? e);
    const moved = quarantineSkipLedger(outDir, at);
    if ("quarantined" in moved) {
      onNote?.("skip-ledger fails its contract — quarantined to " + moved.quarantined + " and restarted empty (" + detail + ")");
      return fn();
    }
    if ("absent" in moved) {
      onNote?.("skip-ledger fails its contract — no file to quarantine (" + detail + ")");
    } else {
      const why = String((moved.failed as Error)?.message ?? moved.failed);
      onNote?.("skip-ledger fails its contract and could not be quarantined — left in place (" + why + ")");
    }
    throw e;
  }
}
