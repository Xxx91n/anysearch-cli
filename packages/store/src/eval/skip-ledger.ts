// ADR-0042 D4 (r108 impl): skip-ledger schema @2 — track field + reason-code split.
// data-absent (structural absence of data) never counts toward the 3-streak human-escalation
// rule and breaks any in-flight gate-not-met run; the first gate-not-met after data-absent
// entries starts counting from 1 again. @1 ledgers are upcast losslessly on read
// (npm lockfile read-old/write-new pattern), closing r106 F-08.
export const SKIP_LEDGER_SCHEMA = "anysearch/gain-ledger@2";
export const SKIP_LEDGER_SCHEMA_V1 = "anysearch/gain-ledger@1";
export const SKIP_STREAK_LIMIT = 3;

export type ObsTrack = "consumed" | "synthetic";
export type SkipReasonCode = "data-absent" | "gate-not-met";

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

export interface SkipLedger {
  schema: typeof SKIP_LEDGER_SCHEMA;
  consecutiveWarn: number;
  history: SkipLedgerEntry[];
  resolutions: Array<{ at: string; decision: string; note: string }>;
  lastSkipKeys?: string[];
}

export function emptySkipLedger(): SkipLedger {
  return { schema: SKIP_LEDGER_SCHEMA, consecutiveWarn: 0, history: [], resolutions: [], lastSkipKeys: [] };
}

// @1 -> @2 upcast: entries default to consumed track + gate-not-met reason, matching the
// streak semantics @1 already implemented (D4: lossless migration).
function upcastV1(j: { consecutiveWarn?: number; history?: Array<{ at: string; tier: string; look: string | number }>; resolutions?: Array<{ at: string; decision: string; note: string }>; lastSkipKeys?: string[] }): SkipLedger {
  return {
    schema: SKIP_LEDGER_SCHEMA,
    consecutiveWarn: typeof j.consecutiveWarn === "number" ? j.consecutiveWarn : 0,
    history: (Array.isArray(j.history) ? j.history : []).map((h): SkipLedgerEntry => {
      const base = { ...h, track: "consumed" as const };
      // @1 green rows had no reason code either; warn rows default to gate-not-met (same
      // semantics @1 already implemented — lossless).
      return h.tier === "green" ? base : { ...base, reasonCode: "gate-not-met" as const };
    }),
    resolutions: Array.isArray(j.resolutions) ? j.resolutions : [],
    lastSkipKeys: Array.isArray(j.lastSkipKeys) ? j.lastSkipKeys : [],
  };
}

// r110 SA-F-09: entry-level shape contract for @2 (validated on every read).
const LEDGER_TIERS = ["green", "warn", "data-absent"] as const;
const LEDGER_REASON_CODES: readonly SkipReasonCode[] = ["data-absent", "gate-not-met"];
function validateEntry(e: unknown, idx: number): void {
  const o = e as Partial<SkipLedgerEntry> | null;
  if (!o || typeof o.at !== "string" || typeof o.tier !== "string") throw new Error("skip-ledger entry #" + idx + ": missing at/tier");
  if (!(LEDGER_TIERS as readonly string[]).includes(o.tier)) throw new Error("skip-ledger entry #" + idx + ": unknown tier " + o.tier);
  if (o.track !== "consumed" && o.track !== "synthetic") throw new Error("skip-ledger entry #" + idx + ": unknown track " + String(o.track));
  if (o.tier === "green") {
    if (o.reasonCode !== undefined) throw new Error("skip-ledger entry #" + idx + ": green row must not carry reasonCode");
  } else if (!LEDGER_REASON_CODES.includes(o.reasonCode as SkipReasonCode)) {
    throw new Error("skip-ledger entry #" + idx + ": non-green row missing valid reasonCode");
  }
}

// r110 SA-F-03: reading NEVER silently clears an unknown/corrupt ledger (schema-evolution
// discipline — Confluent/Solace rule: keep unknown data, fail loud). Callers quarantine the
// file aside and restart empty, surfacing the reason, instead of dropping history.
export class SkipLedgerError extends Error {}

export function parseSkipLedger(text: string): SkipLedger {
  let j: Omit<SkipLedger, "schema"> & { schema: string };
  try {
    j = JSON.parse(text) as typeof j;
  } catch (e) {
    throw new SkipLedgerError("skip-ledger: not valid JSON: " + String((e as Error).message ?? e));
  }
  if (j && j.schema === SKIP_LEDGER_SCHEMA_V1) return upcastV1(j);
  if (!j || j.schema !== SKIP_LEDGER_SCHEMA) throw new SkipLedgerError("skip-ledger: unknown schema " + String(j && j.schema));
  if (typeof j.consecutiveWarn !== "number" || !Array.isArray(j.history)) throw new SkipLedgerError("skip-ledger: malformed top-level shape");
  for (let i = 0; i < j.history.length; i++) validateEntry(j.history[i], i);
  if (!Array.isArray(j.resolutions)) throw new SkipLedgerError("skip-ledger: resolutions must be an array");
  if (j.lastSkipKeys !== undefined && !Array.isArray(j.lastSkipKeys)) throw new SkipLedgerError("skip-ledger: lastSkipKeys must be an array");
  if (!Array.isArray(j.lastSkipKeys)) j.lastSkipKeys = [];
  return j as SkipLedger;
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
  if (sorted.length === 0) {
    ledger.consecutiveWarn = 0;
    ledger.lastSkipKeys = [];
    // SA-F-09: green rows carry no reason code (there is nothing to give a reason for).
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
