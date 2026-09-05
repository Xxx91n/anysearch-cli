// ADR-0047 D1/D2: pure emergency ship override decision core.
// This module never reads files, git, or the clock. Callers assemble facts and
// pass every time value explicitly, so quota/deadline decisions are deterministic.

export const SHIP_OVERRIDE_REASON_CODES = [
  "provider-emergency",
  "upstream-breaking-change",
  "data-loss-mitigation",
] as const;

export type ShipOverrideReasonCode = (typeof SHIP_OVERRIDE_REASON_CODES)[number];

export type OverrideGovernanceAction =
  | "override"
  | "acknowledge-late"
  | "complete-postmortem";

export type OverridePostmortemStatus =
  | "pending"
  | "complete"
  | "late"
  | "late-acknowledged";

export interface OverrideGovernanceEvent {
  epoch: string;
  action: OverrideGovernanceAction;
  reasonCode?: ShipOverrideReasonCode;
  postmortemDeadline?: string;
  postmortemStatus?: OverridePostmortemStatus;
}

export type OverrideDecisionCode =
  | "missing-epoch"
  | "invalid-reason-code"
  | "quota-exhausted"
  | "late-obligation-blocks"
  | "late-ack-unavailable";

export type OverrideDecision =
  | { ok: true }
  | { ok: false; code: OverrideDecisionCode; detail: string };

export class OverrideCoreError extends Error {}

export function isShipOverrideReasonCode(value: unknown): value is ShipOverrideReasonCode {
  return typeof value === "string" && (SHIP_OVERRIDE_REASON_CODES as readonly string[]).includes(value);
}

export function deriveOverrideEpoch(datasetFingerprint: string, holdoutFingerprint: string): string {
  if (!datasetFingerprint || !holdoutFingerprint) {
    throw new OverrideCoreError("override epoch requires datasetFingerprint and holdoutFingerprint");
  }
  return `${datasetFingerprint}:${holdoutFingerprint}`;
}

function parseTime(label: string, value: string): number {
  const t = Date.parse(value);
  if (!Number.isFinite(t)) throw new OverrideCoreError(`${label} is not a valid ISO timestamp: ${value}`);
  return t;
}

// ADR-0047 D3: event-anchored deadline, capped by the containing release window.
// No release-window configuration exists yet; callers may pass null/undefined and
// the deadline is then the seven-day cap.
export function postmortemDeadline(
  overrideAt: string,
  windowEndContainingOverrideAt?: string | null,
): string {
  const atMs = parseTime("overrideAt", overrideAt);
  const sevenDayMs = atMs + 7 * 24 * 60 * 60 * 1000;
  if (!windowEndContainingOverrideAt) return new Date(sevenDayMs).toISOString();
  const endMs = parseTime("windowEndContainingOverrideAt", windowEndContainingOverrideAt);
  return new Date(Math.min(sevenDayMs, endMs)).toISOString();
}

function latestEvent(events: readonly OverrideGovernanceEvent[], predicate: (event: OverrideGovernanceEvent) => boolean): OverrideGovernanceEvent | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    if (predicate(events[i]!)) return events[i];
  }
  return undefined;
}

// ADR-0047 D2/D3/D5:
// - one override per epoch;
// - an outstanding LATE obligation blocks the next override;
// - late acknowledgement is once per epoch and never marks the postmortem complete.
export function decideOverrideGovernance(
  events: readonly OverrideGovernanceEvent[],
  request: { epoch: string; action: "override" | "acknowledge-late"; reasonCode?: ShipOverrideReasonCode },
): OverrideDecision {
  if (!request.epoch) return { ok: false, code: "missing-epoch", detail: "missing override epoch" };
  if (request.action === "override" && !isShipOverrideReasonCode(request.reasonCode)) {
    return { ok: false, code: "invalid-reason-code", detail: "invalid ship override reasonCode: " + String(request.reasonCode) };
  }

  const overrideEvents = events.filter((event) => event.epoch === request.epoch && event.action === "override");
  if (request.action === "override") {
    if (overrideEvents.length > 0) {
      return { ok: false, code: "quota-exhausted", detail: "override quota already consumed for epoch " + request.epoch };
    }
    for (const event of events) {
      if (event.postmortemStatus === "late" && event.action === "override") {
        const acknowledged = events.some((ack) => ack.epoch === event.epoch && ack.action === "acknowledge-late");
        if (!acknowledged) {
          return {
            ok: false,
            code: "late-obligation-blocks",
            detail: `outstanding late postmortem obligation for epoch ${event.epoch} blocks the next override`,
          };
        }
      }
    }
    return { ok: true };
  }

  const latestOverride = latestEvent(overrideEvents, () => true);
  if (!latestOverride) {
    return { ok: false, code: "late-ack-unavailable", detail: "no override exists for epoch " + request.epoch };
  }
  if (latestOverride.postmortemStatus !== "late") {
    return { ok: false, code: "late-ack-unavailable", detail: "postmortem is not LATE for epoch " + request.epoch };
  }
  if (events.some((event) => event.epoch === request.epoch && event.action === "acknowledge-late")) {
    return { ok: false, code: "late-ack-unavailable", detail: "late acknowledgement already used for epoch " + request.epoch };
  }
  return { ok: true };
}

export interface ShipOverridePostmortemFollowup {
  owner: string;
  action: string;
  status: "open" | "done";
}

export interface ShipOverridePostmortem {
  schema: "anysearch/ship-override-postmortem@1";
  impact: string;
  cause: string;
  followups: ShipOverridePostmortemFollowup[];
}

export function parseShipOverridePostmortem(value: unknown): ShipOverridePostmortem {
  if (!value || typeof value !== "object") {
    throw new OverrideCoreError("postmortem artifact must be an object");
  }
  const o = value as Partial<ShipOverridePostmortem>;
  if (o.schema !== "anysearch/ship-override-postmortem@1") {
    throw new OverrideCoreError("postmortem artifact schema must be anysearch/ship-override-postmortem@1");
  }
  if (typeof o.impact !== "string" || !o.impact.trim()) {
    throw new OverrideCoreError("postmortem artifact impact must be a non-empty string");
  }
  if (typeof o.cause !== "string" || !o.cause.trim()) {
    throw new OverrideCoreError("postmortem artifact cause must be a non-empty string");
  }
  if (!Array.isArray(o.followups) || o.followups.length === 0) {
    throw new OverrideCoreError("postmortem artifact must contain at least one followup");
  }
  for (let i = 0; i < o.followups.length; i++) {
    const f = o.followups[i] as Partial<ShipOverridePostmortemFollowup> | undefined;
    if (!f || typeof f.owner !== "string" || !f.owner.trim()) {
      throw new OverrideCoreError(`postmortem followup #${i} owner must be a non-empty string`);
    }
    if (typeof f.action !== "string" || !f.action.trim()) {
      throw new OverrideCoreError(`postmortem followup #${i} action must be a non-empty string`);
    }
    if (f.status !== "open" && f.status !== "done") {
      throw new OverrideCoreError(`postmortem followup #${i} status must be open or done`);
    }
  }
  return o as ShipOverridePostmortem;
}
