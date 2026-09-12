// ADR-0027 D8 + ADR-0059 D3 (T-2 / F-17): flaky-case quarantine ledger.
//
// A case that is environment-flaky (passes on one runner, fails on another) is quarantined by
// POLICY MARK, never by editing the golden set: the case stays in GOLDEN_CASES, so the dataset
// fingerprint is unchanged and no recalibration is triggered (ADR-0059 D3). The gate then excludes
// ACTIVE quarantined cases from the passRate==1 hard assertion while still reporting them.
//
// SLA (ADR-0027 D8): 30-day TTL, weekly expiry review, at most 2 renewals. Removing a case and
// putting it back is not new evidence and never resets the statistical budget (ADR-0038 symmetry).
// Per-case statistical slack (majority vote / 2-sigma band) is REJECTED (ADR-0027 D7): on a
// deterministic assertion that is rerun-until-pass.
import { existsSync, readFileSync, writeFileSync } from "node:fs";

export const QUARANTINE_SCHEMA = "anysearch/eval-quarantine@1";
export const QUARANTINE_TTL_DAYS = 30;
export const QUARANTINE_REVIEW_INTERVAL_DAYS = 7;
export const QUARANTINE_MAX_RENEWALS = 2;

export interface QuarantineReview {
  at: string;
  decision: "renew" | "promote" | "retire";
  note: string;
}

export interface QuarantineEntry {
  id: string;
  group: string;
  reason: string;
  quarantinedAt: string;
  ttlDays: number;
  expiresAt: string;
  renewals: number;
  issueUrl?: string;
  reviews: QuarantineReview[];
  retired?: boolean;
}

export interface QuarantineLedger {
  schema: string;
  entries: QuarantineEntry[];
}

const DAY_MS = 86_400_000;

export function plusDays(iso: string, days: number): string {
  return new Date(Date.parse(iso) + days * DAY_MS).toISOString();
}

export function emptyQuarantine(): QuarantineLedger {
  return { schema: QUARANTINE_SCHEMA, entries: [] };
}

export function readQuarantine(file: string): QuarantineLedger {
  if (!existsSync(file)) return emptyQuarantine();
  try {
    const j = JSON.parse(readFileSync(file, "utf8")) as Partial<QuarantineLedger>;
    if (!j || j.schema !== QUARANTINE_SCHEMA || !Array.isArray(j.entries)) return emptyQuarantine();
    return { schema: QUARANTINE_SCHEMA, entries: j.entries.filter((e) => !!e && typeof e.id === "string") };
  } catch {
    return emptyQuarantine();
  }
}

export function writeQuarantine(file: string, q: QuarantineLedger): void {
  writeFileSync(file, JSON.stringify(q, null, 2) + "\n", "utf8");
}

// Active = quarantined, not retired, and not past its TTL.
export function isActive(q: QuarantineLedger, id: string, now: string): boolean {
  const e = q.entries.find((x) => x.id === id);
  return !!e && !e.retired && Date.parse(e.expiresAt) > Date.parse(now);
}

export function activeIds(q: QuarantineLedger, now: string): string[] {
  return q.entries.filter((e) => !e.retired && Date.parse(e.expiresAt) > Date.parse(now)).map((e) => e.id);
}

export function expiredEntries(q: QuarantineLedger, now: string): QuarantineEntry[] {
  return q.entries.filter((e) => !e.retired && Date.parse(e.expiresAt) <= Date.parse(now));
}

// Weekly review clock: due when the last review is older than the interval (or never reviewed).
export function reviewDue(q: QuarantineLedger, now: string): QuarantineEntry[] {
  return q.entries.filter((e) => {
    if (e.retired) return false;
    const last = e.reviews.length ? e.reviews[e.reviews.length - 1]!.at : e.quarantinedAt;
    return Date.parse(now) - Date.parse(last) >= QUARANTINE_REVIEW_INTERVAL_DAYS * DAY_MS;
  });
}

// renew: extend the TTL by another window; refuses past the renewal cap (graveyard/landfill guard).
export function renewEntry(q: QuarantineLedger, id: string, at: string, note: string): QuarantineLedger {
  const e = q.entries.find((x) => x.id === id);
  if (!e) throw new Error("renew: unknown quarantined case " + id);
  if (e.renewals >= QUARANTINE_MAX_RENEWALS) {
    throw new Error("renew: " + id + " already renewed " + e.renewals + "x (cap " + QUARANTINE_MAX_RENEWALS + ") — promote or retire");
  }
  e.renewals += 1;
  e.expiresAt = plusDays(at, e.ttlDays);
  e.reviews.push({ at, decision: "renew", note });
  return q;
}

// promote: the flake was fixed and evidence shows the case passing — it leaves quarantine.
export function promoteEntry(q: QuarantineLedger, id: string, at: string, note: string): QuarantineLedger {
  const e = q.entries.find((x) => x.id === id);
  if (!e) throw new Error("promote: unknown quarantined case " + id);
  e.reviews.push({ at, decision: "promote", note });
  q.entries = q.entries.filter((x) => x.id !== id);
  return q;
}

// retire: the case is formally retired (never fixed) — kept in the ledger for the audit trail.
export function retireEntry(q: QuarantineLedger, id: string, at: string, note: string): QuarantineLedger {
  const e = q.entries.find((x) => x.id === id);
  if (!e) throw new Error("retire: unknown quarantined case " + id);
  e.reviews.push({ at, decision: "retire", note });
  e.retired = true;
  return q;
}
