// ADR-0047 D2/D3/D4/D5: pure override core + append-only ledger self-checks.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  decideOverrideGovernance,
  deriveOverrideEpoch,
  parseShipOverridePostmortem,
  postmortemDeadline,
} from "../src/eval/override-core";
import {
  appendOverrideEvent,
  emptyShipOverrideLedger,
  parseShipOverrideLedger,
  readShipOverrideLedger,
  writeShipOverrideLedgerAtomic,
} from "../src/eval/override-ledger";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return; }
  passed++;
}

const epoch = deriveOverrideEpoch("dataset-a", "holdout-b");
assert(epoch === "dataset-a:holdout-b", "override epoch is the fingerprint pair");
const missingEpoch = decideOverrideGovernance([], { epoch: "", action: "override", reasonCode: "provider-emergency" });
assert(!missingEpoch.ok && missingEpoch.code === "missing-epoch", "missing epoch has its own decision code");

const at = "2026-09-01T00:00:00.000Z";
const windowEnd = "2026-09-05T00:00:00.000Z";
assert(postmortemDeadline(at, windowEnd) === windowEnd, "deadline is capped by the containing window");
assert(postmortemDeadline(at) === "2026-09-08T00:00:00.000Z", "deadline defaults to seven days");

// First override allowed; second in the same epoch is blocked by quota.
assert(decideOverrideGovernance([], { epoch, action: "override", reasonCode: "provider-emergency" }).ok, "first override allowed");
assert(!decideOverrideGovernance(
  [{ epoch, action: "override", reasonCode: "provider-emergency" }],
  { epoch, action: "override", reasonCode: "upstream-breaking-change" },
).ok, "second override in epoch is blocked");

// Late obligation blocks the next override until acknowledged once.
const lateEvents = [
  { epoch: "old:a", action: "override" as const, postmortemStatus: "late" as const },
];
const blocked = decideOverrideGovernance(lateEvents, { epoch, action: "override", reasonCode: "data-loss-mitigation" });
assert(!blocked.ok, "outstanding late obligation blocks next override");

const acknowledged = decideOverrideGovernance(
  [
    ...lateEvents,
    { epoch: "old:a", action: "acknowledge-late" as const, postmortemStatus: "late-acknowledged" as const },
  ],
  { epoch, action: "override", reasonCode: "data-loss-mitigation" },
);
assert(acknowledged.ok, "acknowledged late obligation unblocks next override");

// Late acknowledgement is once per epoch and requires an actual LATE override.
const ackOnce = decideOverrideGovernance(
  [
    { epoch, action: "override", reasonCode: "provider-emergency", postmortemStatus: "late" },
    { epoch, action: "acknowledge-late", postmortemStatus: "late-acknowledged" },
  ],
  { epoch, action: "acknowledge-late" },
);
assert(!ackOnce.ok, "late acknowledgement cannot be used twice in one epoch");

// Postmortem artifact schema validation.
const postmortem = parseShipOverridePostmortem({
  schema: "anysearch/ship-override-postmortem@1",
  impact: "one provider down",
  cause: "upstream changed",
  followups: [{ owner: "oncall", action: "add circuit breaker", status: "open" }],
});
assert(postmortem.followups.length === 1, "postmortem schema accepts actionable followup");

// Hash-chain ledger write/read and tamper detection.
const dir = mkdtempSync(join(tmpdir(), "ans-override-"));
try {
  const initial = appendOverrideEvent(emptyShipOverrideLedger(), {
    action: "override",
    epoch,
    reasonCode: "provider-emergency",
    postmortemDeadline: postmortemDeadline(at),
    postmortem: { status: "pending" },
  }, at);
  writeShipOverrideLedgerAtomic(dir, initial);
  const parsed = readShipOverrideLedger(dir);
  assert(parsed.entries.length === 1 && parsed.revision === 1, "ledger persists one hash-chained entry");
  assert(parsed.entries[0]!.reasonCode === "provider-emergency", "ledger preserves closed reasonCode");

  const tampered = { ...parsed, entries: [{ ...parsed.entries[0]!, epoch: "tampered:epoch" }] };
  let threw = false;
  try { parseShipOverrideLedger(JSON.stringify(tampered)); } catch { threw = true; }
  assert(threw, "ledger tampering fails hash-chain validation");
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log("eval-override.test.ts: " + passed + " passed, " + failed + " failed");
if (failed > 0) process.exit(1);
