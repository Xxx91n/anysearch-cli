// explicit-skip three-tier telemetry — never fail-open, never fail-closed.
// Affected metrics are marked skipped with the triggering condition quoted verbatim in the E3
// observational report (exit 0, ship allowed, traceable). D7 3-streak escalation on the eval
// path was retired in #591; skip markers remain part of the E3 report-as-contract surface.
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

// Legacy ledger key helper for the retired eval 3-streak rule (#591): identical skip = same
// metric + same tier + same clause identity with volatile numerics normalized to '#'. Kept for
// backward-compatible unit contracts while full verdict text stays in SkipMarker.reason.
export function skipKey(metric: string, m: SkipMarker): string {
  return metric + "|" + m.tier + "|" + m.reason.replace(/\d+(?:\.\d+)?/g, "#");
}
