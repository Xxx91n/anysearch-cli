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
  reasonCode: SkipReasonCode;
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
    history: (Array.isArray(j.history) ? j.history : []).map((h) => ({ ...h, track: "consumed" as const, reasonCode: "gate-not-met" as const })),
    resolutions: Array.isArray(j.resolutions) ? j.resolutions : [],
    lastSkipKeys: Array.isArray(j.lastSkipKeys) ? j.lastSkipKeys : [],
  };
}

export function parseSkipLedger(text: string): SkipLedger {
  try {
    const j = JSON.parse(text) as Omit<SkipLedger, "schema"> & { schema: string };
    if (j.schema === SKIP_LEDGER_SCHEMA_V1) return upcastV1(j);
    if (j.schema !== SKIP_LEDGER_SCHEMA || typeof j.consecutiveWarn !== "number" || !Array.isArray(j.history)) return emptySkipLedger(); // corrupt/unknown -> fail-safe empty
    if (!Array.isArray(j.resolutions)) j.resolutions = [];
    if (!Array.isArray(j.lastSkipKeys)) j.lastSkipKeys = [];
    return j as SkipLedger;
  } catch {
    return emptySkipLedger();
  }
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
    ledger.history = [...ledger.history, { at, tier: "green", look: "", track, reasonCode }].slice(-20);
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
