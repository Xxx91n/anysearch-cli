// R63 T3 (D-003): quarantine ratchet — the live-drift quarantine set may only ever SHRINK.
//
// Three hard assertions over packages/store/eval-quarantine.json against the frozen baseline
// (eval-quarantine.baseline.json — the 10 ids ratified 2026-09-15):
//   1. entries ⊆ baseline ids — a new quarantined case is publish-red (新增即红).
//   2. every entry.renewals === 0 — a renewal is publish-red (续期即红).
//   3. an entry past expiresAt with no promote/retire/longterm ruling RECORD is publish-red —
//      TTL expiry forces a ruling; a bare retired/longterm flag never satisfies it. The ledger
//      API co-writes flag + review record, so a flag without its record (drift by hand-edit)
//      is itself red. "longterm" (permanent known-issue) is capped at 1 use across flag ∪ record.
// Dates fail closed: an unparseable `now` or `expiresAt` is an error, never a skip.
// Pure function so ship-gate and the fixture test share one implementation.
export function checkQuarantineRatchet(ledger, baselineIds, now) {
  const errors = [];
  const base = new Set(baselineIds);
  const nowMs = Date.parse(now ?? new Date().toISOString());
  if (Number.isNaN(nowMs)) {
    errors.push("ratchet: unparseable now " + JSON.stringify(now) + " — fail-closed on clock input");
  }
  let longtermUsed = 0;
  for (const e of ledger.entries ?? []) {
    if (!base.has(e.id)) {
      errors.push("ratchet: entry " + e.id + " not in baseline — quarantine entries are shrink-only (new id = red)");
    }
    if ((e.renewals ?? 0) !== 0) {
      errors.push("ratchet: entry " + e.id + " renewals=" + e.renewals + " — renewals must stay 0 (renewal = red)");
    }
    const decisions = new Set((e.reviews ?? []).filter((r) => r && typeof r === "object").map((r) => r.decision));
    const hasRuling = decisions.has("promote") || decisions.has("retire") || decisions.has("longterm");
    const expiresMs = Date.parse(e.expiresAt);
    if (Number.isNaN(expiresMs)) {
      errors.push("ratchet: entry " + e.id + " unparseable expiresAt " + JSON.stringify(e.expiresAt) + " — fail-closed on dates");
    } else if (!Number.isNaN(nowMs) && expiresMs <= nowMs && !hasRuling) {
      errors.push("ratchet: entry " + e.id + " expired " + e.expiresAt + " with no promote/retire/longterm ruling — TTL expiry forces a ruling");
    }
    // Flag/record consistency: the ledger API (retireEntry/longtermEntry) co-writes the flag
    // and the review record, so a flag without its record means the file was hand-edited.
    if (e.retired === true && !decisions.has("retire")) {
      errors.push("ratchet: entry " + e.id + " retired flag set with no retire review record — flag/record drift (hand-edit = red)");
    }
    if (e.longterm === true && !decisions.has("longterm")) {
      errors.push("ratchet: entry " + e.id + " longterm flag set with no longterm review record — flag/record drift (hand-edit = red)");
    }
    // Cap mirrors QUARANTINE_MAX_LONGTERM (=1) in packages/store/src/eval/quarantine-ledger.ts
    // (this .mjs cannot import the .ts constant — keep the numbers in sync by hand). Counted
    // as flag ∪ record so a lone hand-edited flag still spends the one-time exit.
    if (e.longterm === true || decisions.has("longterm")) longtermUsed++;
  }
  if (longtermUsed > 1) {
    errors.push("ratchet: " + longtermUsed + " longterm exits used — cap is 1 (longterm conversion is a one-time exit)");
  }
  return errors;
}
