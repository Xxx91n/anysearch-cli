// explicit-skip three-tier telemetry — never fail-open, never fail-closed.
// Affected metrics are marked skipped with the triggering condition quoted verbatim in the E3
// observational report (exit 0, ship allowed, traceable).
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
