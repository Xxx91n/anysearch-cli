// ADR-0047 D5/D6: independent override verifier command.
// Exit semantics:
//   0 = allowed/success
//   1 = governance denied (quota, late obligation, invalid postmortem, no match)
//   2 = malformed args, corrupt ledger, or internal/IO failure

import { existsSync, readFileSync } from "node:fs";
import {
  decideOverrideGovernance,
  deriveOverrideEpoch,
  isShipOverrideReasonCode,
  postmortemDeadline,
  SHIP_OVERRIDE_REASON_CODES,
  type OverrideGovernanceEvent,
  type ShipOverrideReasonCode,
} from "./override-core";
import {
  appendOverrideEvent,
  readShipOverrideLedger,
  readShipOverridePostmortem,
  withShipOverrideLedgerLock,
  writeShipOverrideLedgerAtomic,
  type OverrideLedgerEntry,
  type ShipOverrideLedger,
} from "./override-ledger";

const args = process.argv.slice(2);
const mode = args[0];

function arg(name: string, required = false): string | undefined {
  const idx = args.indexOf(name);
  if (idx < 0) {
    if (required) {
      console.error("missing required argument: " + name);
      process.exit(2);
    }
    return undefined;
  }
  const value = args[idx + 1];
  if (!value || value.startsWith("--")) {
    console.error("argument requires a value: " + name);
    process.exit(2);
  }
  return value;
}

function usage(): never {
  console.error(
    [
      "usage: tsx packages/store/src/eval/override-verifier.ts <mode> [options]",
      "modes: status | record | acknowledge-late | complete-postmortem | check",
      "required for record: --ledger <dir> --dataset-fingerprint <hex> --holdout-fingerprint <hex> --reason-code <code> --gate-report <path>",
      "optional for record: --override-at <ISO> --window-end <ISO>",
      "required for acknowledge-late/check: --ledger <dir> --dataset-fingerprint <hex> --holdout-fingerprint <hex>",
      "required for complete-postmortem: --ledger <dir> --dataset-fingerprint <hex> --holdout-fingerprint <hex> --artifact <path>",
    ].join("\n"),
  );
  process.exit(2);
}

function requireLedgerDir(): string {
  return arg("--ledger", true)!;
}

function readGateStateBefore(reportPath: string | undefined): OverrideLedgerEntry["gateStateBefore"] {
  if (!reportPath || !existsSync(reportPath)) return undefined;
  const report = JSON.parse(readFileSync(reportPath, "utf8")) as {
    gate?: { verdict?: string; exitCode?: number; gainConclusion?: { tier?: string }; failures?: string[] };
  };
  return {
    verdict: report.gate?.verdict ?? "unknown",
    exitCode: report.gate?.exitCode ?? -1,
    gainTier: report.gate?.gainConclusion?.tier,
    weakestLinkCritical: (report.gate?.failures ?? [])
      .filter((failure) => failure.startsWith("weakest-link RED"))
      .slice(0, 20),
  };
}

function requireConfirmedCriticalRed(gateStateBefore: OverrideLedgerEntry["gateStateBefore"]): void {
  if (!gateStateBefore || gateStateBefore.weakestLinkCritical.length === 0) {
    emitDenied("override requires a confirmed weakest-link RED on a critical arm");
  }
}

function firstOutstandingLateEpoch(events: OverrideGovernanceEvent[]): string | undefined {
  return events.find((event) => event.action === "override" && event.postmortemStatus === "late")?.epoch;
}

function effectivePostmortemStatus(ledger: ShipOverrideLedger, entry: OverrideLedgerEntry, now: string): OverrideGovernanceEvent["postmortemStatus"] {
  if (entry.action !== "override") return entry.postmortem?.status;
  if (ledger.entries.some((e) => e.epoch === entry.epoch && e.action === "complete-postmortem")) return "complete";
  if (ledger.entries.some((e) => e.epoch === entry.epoch && e.action === "acknowledge-late")) return "late-acknowledged";
  if (entry.postmortemDeadline && Date.parse(now) > Date.parse(entry.postmortemDeadline)) return "late";
  return entry.postmortem?.status ?? "pending";
}

function governanceEvents(ledger: ShipOverrideLedger, now: string): OverrideGovernanceEvent[] {
  return ledger.entries.map((entry) => ({
    epoch: entry.epoch,
    action: entry.action,
    reasonCode: entry.reasonCode,
    postmortemDeadline: entry.postmortemDeadline,
    postmortemStatus: effectivePostmortemStatus(ledger, entry, now),
  }));
}

function nowOrArg(): string {
  return arg("--override-at") ?? new Date().toISOString();
}

function emitSuccess(payload: unknown): never {
  process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
  process.exit(0);
}

function emitDenied(detail: string): never {
  process.stderr.write(detail + "\n");
  process.exit(1);
}

function validateReason(value: string | undefined): ShipOverrideReasonCode {
  if (!isShipOverrideReasonCode(value)) {
    console.error("invalid --reason-code; expected one of: " + SHIP_OVERRIDE_REASON_CODES.join(", "));
    process.exit(2);
  }
  return value;
}

if (!mode || !["status", "record", "acknowledge-late", "complete-postmortem", "check"].includes(mode)) usage();

const ledgerDir = requireLedgerDir();

try {
  if (mode === "status") {
    const ledger = readShipOverrideLedger(ledgerDir);
    const now = new Date().toISOString();
    const events = governanceEvents(ledger, now);
    emitSuccess({
      schema: ledger.schema,
      revision: ledger.revision,
      entries: ledger.entries.length,
      outstandingLate: events.filter((event) => event.action === "override" && event.postmortemStatus === "late").length,
    });
  }

  const datasetFingerprint = arg("--dataset-fingerprint");
  const holdoutFingerprint = arg("--holdout-fingerprint");
  const hasEpoch = Boolean(datasetFingerprint && holdoutFingerprint);
  const epoch = hasEpoch ? deriveOverrideEpoch(datasetFingerprint!, holdoutFingerprint!) : undefined;

  function requireEpoch(): string {
    if (!epoch) {
      console.error("missing required arguments: --dataset-fingerprint and --holdout-fingerprint");
      process.exit(2);
    }
    return epoch;
  }

  if (mode === "check") {
    const checkedEpoch = requireEpoch();
    const reasonCode = validateReason(arg("--reason-code", true));
    const ledger = readShipOverrideLedger(ledgerDir);
    const decision = decideOverrideGovernance(governanceEvents(ledger, new Date().toISOString()), {
      epoch: checkedEpoch,
      action: "override",
      reasonCode,
    });
    if (!decision.ok) emitDenied(decision.detail);
    emitSuccess({ ok: true, epoch: checkedEpoch, reasonCode });
  }

  if (mode === "record") {
    const recordEpoch = requireEpoch();
    const reasonCode = validateReason(arg("--reason-code", true));
    const reportPath = arg("--gate-report");
    const gateStateBefore = readGateStateBefore(reportPath);
    requireConfirmedCriticalRed(gateStateBefore);
    const at = nowOrArg();
    const windowEnd = arg("--window-end");
    const deadline = postmortemDeadline(at, windowEnd);
    const ledger = withShipOverrideLedgerLock(ledgerDir, (current) => {
      const decision = decideOverrideGovernance(governanceEvents(current, at), {
        epoch: recordEpoch,
        action: "override",
        reasonCode,
      });
      if (!decision.ok) emitDenied(decision.detail);
      const next = appendOverrideEvent(
        current,
        {
          action: "override",
          epoch: recordEpoch,
          reasonCode,
          gateStateBefore,
          postmortemDeadline: deadline,
          postmortem: { status: "pending" },
        },
        at,
      );
      writeShipOverrideLedgerAtomic(ledgerDir, next);
      return next;
    });
    emitSuccess({ ok: true, epoch: recordEpoch, reasonCode, deadline, revision: ledger.revision });
  }

  if (mode === "acknowledge-late") {
    const at = nowOrArg();
    let ackEpoch = epoch;
    if (!ackEpoch) {
      const current = readShipOverrideLedger(ledgerDir);
      const lateEpoch = firstOutstandingLateEpoch(governanceEvents(current, at));
      if (!lateEpoch) emitDenied("no outstanding late postmortem obligation");
      ackEpoch = lateEpoch;
    }
    const ledger = withShipOverrideLedgerLock(ledgerDir, (current) => {
      const decision = decideOverrideGovernance(governanceEvents(current, at), {
        epoch: ackEpoch!,
        action: "acknowledge-late",
      });
      if (!decision.ok) emitDenied(decision.detail);
      const next = appendOverrideEvent(
        current,
        {
          action: "acknowledge-late",
          epoch: ackEpoch!,
          postmortem: { status: "late-acknowledged" },
        },
        at,
      );
      writeShipOverrideLedgerAtomic(ledgerDir, next);
      return next;
    });
    emitSuccess({ ok: true, epoch: ackEpoch, revision: ledger.revision });
  }

  const completeEpoch = requireEpoch();
  const artifactPath = arg("--artifact", true)!;
  const artifact = readShipOverridePostmortem(artifactPath);
  const at = nowOrArg();
  const ledger = withShipOverrideLedgerLock(ledgerDir, (current) => {
    const overrideExists = current.entries.some((entry) => entry.epoch === completeEpoch && entry.action === "override");
    if (!overrideExists) emitDenied("no override exists for epoch " + completeEpoch);
    const alreadyComplete = current.entries.some((entry) => entry.epoch === completeEpoch && entry.action === "complete-postmortem");
    if (alreadyComplete) emitDenied("postmortem already complete for epoch " + completeEpoch);
    const next = appendOverrideEvent(
      current,
      {
        action: "complete-postmortem",
        epoch: completeEpoch,
        postmortem: {
          status: "complete",
          artifactPath,
          contentHash: artifact.contentHash,
          completedAt: at,
        },
      },
      at,
    );
    writeShipOverrideLedgerAtomic(ledgerDir, next);
    return next;
  });
  emitSuccess({ ok: true, epoch: completeEpoch, contentHash: artifact.contentHash, revision: ledger.revision });
} catch (error) {
  console.error("override verifier internal error: " + String((error as Error).stack ?? error));
  process.exit(2);
}
