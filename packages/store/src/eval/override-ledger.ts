// independent append-only override ledger.
// Hash-chain entries, sidecar lock, tmp+rename atomic write, quarantine, and
// fail-loud validation. Unlike skip/gain ledgers, corruption is not silently
// restarted by callers; verifier commands treat malformed history as exit 2.

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { withLedgerLock } from "./ledger-lock";
import {
  isShipOverrideReasonCode,
  parseShipOverridePostmortem,
  type OverrideGovernanceAction,
  type OverridePostmortemStatus,
  type ShipOverridePostmortem,
  type ShipOverrideReasonCode,
} from "./override-core";

export const SHIP_OVERRIDE_LEDGER_SCHEMA = "anysearch/ship-override-ledger@1";
export const SHIP_OVERRIDE_LEDGER_FILE = "ship-override-ledger.json";

const GENESIS_HASH = createHash("sha256").update("anysearch/ship-override-ledger@1:genesis").digest("hex");

export interface OverrideGateStateBefore {
  verdict: string;
  exitCode: number;
  gainTier?: string;
  weakestLinkCritical: string[];
}

export interface OverrideLedgerEntry {
  id: number;
  action: OverrideGovernanceAction;
  at: string;
  epoch: string;
  reasonCode?: ShipOverrideReasonCode;
  gateStateBefore?: OverrideGateStateBefore;
  postmortemDeadline?: string;
  postmortem?: {
    status: OverridePostmortemStatus;
    artifactPath?: string;
    contentHash?: string;
    completedAt?: string;
  };
  prevHash: string;
  hash: string;
}

export interface ShipOverrideLedger {
  schema: typeof SHIP_OVERRIDE_LEDGER_SCHEMA;
  revision: number;
  entries: OverrideLedgerEntry[];
}

export class ShipOverrideLedgerError extends Error {}

export function emptyShipOverrideLedger(): ShipOverrideLedger {
  return { schema: SHIP_OVERRIDE_LEDGER_SCHEMA, revision: 0, entries: [] };
}

function payloadForHash(entry: Omit<OverrideLedgerEntry, "hash">): string {
  const { prevHash, id, action, at, epoch, reasonCode, gateStateBefore, postmortemDeadline, postmortem } = entry;
  return JSON.stringify({
    prevHash,
    id,
    action,
    at,
    epoch,
    reasonCode,
    gateStateBefore,
    postmortemDeadline,
    postmortem,
  });
}

export function hashOverrideEntry(entry: Omit<OverrideLedgerEntry, "hash">): string {
  return createHash("sha256").update(payloadForHash(entry)).digest("hex");
}

export interface OverrideEntryInput {
  action: OverrideGovernanceAction;
  epoch: string;
  reasonCode?: ShipOverrideReasonCode;
  gateStateBefore?: OverrideGateStateBefore;
  postmortemDeadline?: string;
  postmortem?: OverrideLedgerEntry["postmortem"];
}

export function appendOverrideEvent(
  ledger: ShipOverrideLedger,
  input: OverrideEntryInput,
  at: string,
): ShipOverrideLedger {
  if (ledger.schema !== SHIP_OVERRIDE_LEDGER_SCHEMA) {
    throw new ShipOverrideLedgerError("unknown override ledger schema " + ledger.schema);
  }
  const previous = ledger.entries[ledger.entries.length - 1];
  const prevHash = previous?.hash ?? GENESIS_HASH;
  const entryWithoutHash = {
    id: ledger.entries.length + 1,
    action: input.action,
    at,
    epoch: input.epoch,
    reasonCode: input.reasonCode,
    gateStateBefore: input.gateStateBefore,
    postmortemDeadline: input.postmortemDeadline,
    postmortem: input.postmortem,
    prevHash,
  };
  const entry: OverrideLedgerEntry = { ...entryWithoutHash, hash: hashOverrideEntry(entryWithoutHash) };
  return {
    schema: ledger.schema,
    revision: ledger.revision + 1,
    entries: [...ledger.entries, entry],
  };
}

function requireString(value: unknown, message: string): asserts value is string {
  if (typeof value !== "string") throw new ShipOverrideLedgerError(message);
}

function validateEntry(entry: unknown, index: number): void {
  const o = entry as Partial<OverrideLedgerEntry> | null;
  if (!o) throw new ShipOverrideLedgerError(`override ledger entry #${index} is missing`);
  if (typeof o.id !== "number" || !Number.isInteger(o.id)) throw new ShipOverrideLedgerError(`override ledger entry #${index}: invalid id`);
  requireString(o.at, `override ledger entry #${index}: missing at`);
  requireString(o.epoch, `override ledger entry #${index}: missing epoch`);
  requireString(o.prevHash, `override ledger entry #${index}: missing prevHash`);
  requireString(o.hash, `override ledger entry #${index}: missing hash`);
  if (!["override", "acknowledge-late", "complete-postmortem"].includes(String(o.action))) {
    throw new ShipOverrideLedgerError(`override ledger entry #${index}: invalid action ${String(o.action)}`);
  }
  if (o.action === "override" && !isShipOverrideReasonCode(o.reasonCode)) {
    throw new ShipOverrideLedgerError(`override ledger entry #${index}: missing/invalid reasonCode`);
  }
  if (o.reasonCode !== undefined && !isShipOverrideReasonCode(o.reasonCode)) {
    throw new ShipOverrideLedgerError(`override ledger entry #${index}: invalid reasonCode`);
  }
  if (o.gateStateBefore !== undefined && (!o.gateStateBefore || typeof o.gateStateBefore !== "object")) {
    throw new ShipOverrideLedgerError(`override ledger entry #${index}: invalid gateStateBefore`);
  }
  if (o.postmortem !== undefined && (!o.postmortem || typeof o.postmortem !== "object")) {
    throw new ShipOverrideLedgerError(`override ledger entry #${index}: invalid postmortem`);
  }
}

export function parseShipOverrideLedger(text: string): ShipOverrideLedger {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new ShipOverrideLedgerError("override ledger is not valid JSON: " + String((error as Error).message ?? error));
  }
  if (!raw || typeof raw !== "object") throw new ShipOverrideLedgerError("override ledger must be an object");
  const ledger = raw as Partial<ShipOverrideLedger>;
  if (ledger.schema !== SHIP_OVERRIDE_LEDGER_SCHEMA) {
    throw new ShipOverrideLedgerError("override ledger has unknown schema " + String(ledger.schema));
  }
  if (typeof ledger.revision !== "number" || !Number.isInteger(ledger.revision)) {
    throw new ShipOverrideLedgerError("override ledger revision must be an integer");
  }
  if (!Array.isArray(ledger.entries)) throw new ShipOverrideLedgerError("override ledger entries must be an array");
  let expectedPrev = GENESIS_HASH;
  let expectedId = 1;
  for (let i = 0; i < ledger.entries.length; i++) {
    const entry = ledger.entries[i] as OverrideLedgerEntry;
    validateEntry(entry, i);
    if (entry.id !== expectedId) throw new ShipOverrideLedgerError(`override ledger entry #${i}: expected id ${expectedId}, got ${entry.id}`);
    if (entry.prevHash !== expectedPrev) throw new ShipOverrideLedgerError(`override ledger entry #${i}: hash chain break`);
    const computed = hashOverrideEntry(entry);
    if (entry.hash !== computed) throw new ShipOverrideLedgerError(`override ledger entry #${i}: hash mismatch`);
    expectedPrev = entry.hash;
    expectedId += 1;
  }
  return ledger as ShipOverrideLedger;
}

function ledgerPathFor(outDir: string): string {
  return join(outDir, SHIP_OVERRIDE_LEDGER_FILE);
}

function lockPathFor(outDir: string): string {
  return join(outDir, ".ship-override-ledger.lock");
}

export function readShipOverrideLedger(outDir: string): ShipOverrideLedger {
  const p = ledgerPathFor(outDir);
  return existsSync(p) ? parseShipOverrideLedger(readFileSync(p, "utf8")) : emptyShipOverrideLedger();
}

export function writeShipOverrideLedgerAtomic(outDir: string, ledger: ShipOverrideLedger): void {
  mkdirSync(outDir, { recursive: true });
  const p = ledgerPathFor(outDir);
  const tmp = p + ".tmp";
  writeFileSync(tmp, JSON.stringify(ledger, null, 2) + "\n", "utf8");
  renameSync(tmp, p);
}

export function withShipOverrideLedgerLock<T>(outDir: string, fn: (ledger: ShipOverrideLedger) => T): T {
  return withLedgerLock(lockPathFor(outDir), () => fn(readShipOverrideLedger(outDir)));
}

export function readShipOverridePostmortem(path: string): {
  artifact: ShipOverridePostmortem;
  contentHash: string;
} {
  const bytes = readFileSync(path);
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new ShipOverrideLedgerError("postmortem artifact is not valid JSON: " + String((error as Error).message ?? error));
  }
  return {
    artifact: parseShipOverridePostmortem(value),
    contentHash: createHash("sha256").update(bytes).digest("hex"),
  };
}
