// ADR-0039 D7: WARN ledger for observational explicit-skips. Same wire shape as the
// gain ledger (scripts/gain-ledger.mjs) so the human-resolution tool resolves either ledger
// via --ledger. Schema string shared on purpose: one semantics, two files.
export const SKIP_LEDGER_SCHEMA = "anysearch/gain-ledger@1";
export const SKIP_STREAK_LIMIT = 3;

export interface SkipLedger {
  schema: typeof SKIP_LEDGER_SCHEMA;
  consecutiveWarn: number;
  history: Array<{ at: string; tier: string; look: string | number }>;
  resolutions: Array<{ at: string; decision: string; note: string }>;
  lastSkipKeys?: string[];
}

export function emptySkipLedger(): SkipLedger {
  return { schema: SKIP_LEDGER_SCHEMA, consecutiveWarn: 0, history: [], resolutions: [], lastSkipKeys: [] };
}

export function parseSkipLedger(text: string): SkipLedger {
  try {
    const j = JSON.parse(text) as SkipLedger;
    if (j.schema !== SKIP_LEDGER_SCHEMA || typeof j.consecutiveWarn !== "number" || !Array.isArray(j.history)) return emptySkipLedger();
    if (!Array.isArray(j.resolutions)) j.resolutions = [];
    if (!Array.isArray(j.lastSkipKeys)) j.lastSkipKeys = [];
    return j;
  } catch {
    return emptySkipLedger();
  }
}

// Record one eval run's skip-key set (skips are "identical" when the key set repeats).
// Multi-tier alignment with ADR-0038: consecutive identical sets bump the streak; a run with
// zero skips resets it. Returns the post-write streak.
export function recordSkips(ledger: SkipLedger, skipKeys: string[], at: string): number {
  const sorted = [...skipKeys].sort();
  const same = sorted.length > 0 && JSON.stringify(sorted) === JSON.stringify(ledger.lastSkipKeys ?? []);
  ledger.consecutiveWarn = sorted.length === 0 ? 0 : same ? ledger.consecutiveWarn + 1 : 1;
  ledger.lastSkipKeys = sorted;
  ledger.history = [...ledger.history, { at, tier: sorted.length === 0 ? "green" : "warn", look: sorted.join("; ").slice(0, 200) }].slice(-20);
  return ledger.consecutiveWarn;
}

export function skipMustFail(ledger: SkipLedger): boolean {
  return ledger.consecutiveWarn >= SKIP_STREAK_LIMIT;
}
