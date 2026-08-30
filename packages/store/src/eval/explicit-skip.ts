// ADR-0039 D7: explicit-skip three-tier telemetry — never fail-open, never fail-closed.
// Affected metrics are marked skipped with the triggering condition quoted verbatim; every
// skip lands in the WARN ledger (exit 0, ship allowed, traceable); three consecutive
// identical skips escalate to forced human review (ADR-0038 WARN-streak mechanic).
export type SkipTier = "gate-not-met" | "offline-deferred" | "infra-failure";

export interface SkipMarker {
  status: "skipped";
  tier: SkipTier;
  reason: string;
}

export function skip(reason: string, tier: SkipTier = "gate-not-met"): SkipMarker {
  return { status: "skipped", tier, reason };
}

export function isSkip(v: unknown): v is SkipMarker {
  return !!v && typeof v === "object" && (v as SkipMarker).status === "skipped";
}

// Ledger key for the 3-streak rule: identical skip = same metric + same reason.
export function skipKey(metric: string, m: SkipMarker): string {
  return metric + "|" + m.tier + "|" + m.reason;
}
