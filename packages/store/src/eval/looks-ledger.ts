// the preregistered OF look ledger is a git-committed, append-only
// file at the repo root (`eval-looks.json`). It records one row per release-grade peek so the
// OF alpha-spending sequence survives across runs without depending on local `.ship-gate/` state.
//
// Write policy (why ordinary runs never write it):
// - merge-gate / CI runs set ANS_EVAL_NO_LOOK=1 -> read-only, never spend a look;
// - only a release-grade peek sets ANS_EVAL_LOOKS_WRITE=1 -> appends exactly one row.
// Reading always happens, so the caller computes the next look number from committed state.
//
// Compaction: a hard row cap keeps the file bounded; when exceeded the oldest
// rows are dropped and the SHA-256 of the pre-compaction row set is preserved in `compaction`.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { GOLDEN_FILE } from "./golden-file";

export const LOOKS_LEDGER_SCHEMA = "anysearch/eval-looks@2";
export const LOOKS_LEDGER_LEGACY_SCHEMA = "anysearch/eval-looks@1";
export const LOOKS_LEDGER_MAX_ROWS = 50;

export interface LooksLedgerEntry {
  key: string; // datasetFingerprint + ":" + holdoutFingerprint
  at: string; // ISO timestamp of the peek
  look: number; // the OF look number this row spent
  verdict: string; // gate verdict at that look (pass | warn | fail | fingerprint_mismatch)
  exitCode: number; // gate exit code (0 pass/warn, 1 publish-red, 2 unverifiable, 12 mismatch)
  integrity?: string; // run-level integrity verdict (pass | failed) when available
}

export interface LooksLedgerCompaction {
  at: string;
  droppedRows: number;
  preCompactionHash: string; // sha256 of the pre-compaction rows (canonical JSON)
  cap: number;
}

export interface LooksLedger {
  schema: string;
  looks: LooksLedgerEntry[];
  compaction?: LooksLedgerCompaction;
  // Tolerant Reader — unknown root fields ride on the object
  // verbatim so a read->modify->write cycle never strips fields the writer does
  // not model (the schema_version:1 sentinel was lost exactly this way).
  [key: string]: unknown;
}

export function emptyLooksLedger(): LooksLedger {
  return { schema: LOOKS_LEDGER_SCHEMA, looks: [] };
}

function hashRows(rows: LooksLedgerEntry[]): string {
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

// Accepts both the legacy @1 shape ({key, at}) and @2; corrupt/unknown input degrades to empty.
export function readLooksLedger(file: string): LooksLedger {
  if (!existsSync(file)) return emptyLooksLedger();
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return emptyLooksLedger();
  }
  const j = parsed as Record<string, unknown>;
  if (!j || typeof j !== "object" || !Array.isArray(j.looks)) return emptyLooksLedger();
  // A stale `golden` copy from an old checkout or merge conflict must not be
  // resurrected by the spread below.
  if (Object.hasOwn(j, "golden")) {
    console.error("[eval] ignoring stale golden block in " + file + " (corpus lives in " + GOLDEN_FILE + ")");
    delete j.golden;
  }
  const looks: LooksLedgerEntry[] = [];
  for (const raw of j.looks as Array<Record<string, unknown>>) {
    if (!raw || typeof raw.key !== "string" || typeof raw.at !== "string") continue;
    // Row-level Tolerant Reader: fields the normalizer does not model ride
    // through the spread instead of being rebuilt away.
    looks.push({
      ...raw,
      key: raw.key,
      at: raw.at,
      look: typeof raw.look === "number" ? raw.look : 0,
      verdict: typeof raw.verdict === "string" ? raw.verdict : "unknown",
      exitCode: typeof raw.exitCode === "number" ? raw.exitCode : -1,
    } as LooksLedgerEntry);
  }
  // Spread the parsed object first so every unknown root field keeps its
  // original position, then override the managed keys with normalized values.
  return {
    ...j,
    schema: typeof j.schema === "string" ? j.schema : LOOKS_LEDGER_LEGACY_SCHEMA,
    looks,
    ...(j.compaction && typeof j.compaction === "object" ? { compaction: j.compaction as LooksLedgerCompaction } : {}),
  } as LooksLedger;
}

export function nextLook(ledger: LooksLedger, key: string): number {
  return ledger.looks.filter((l) => l.key === key).length + 1;
}

// Append one peek row; compact when the cap is exceeded, preserving the pre-compaction hash.
export function appendLook(ledger: LooksLedger, entry: LooksLedgerEntry, now: string): LooksLedger {
  const rows = [...ledger.looks, entry];
  // The spread carries every unknown root field through the write —
  // rebuilding the object field-by-field is how the schema_version:1 sentinel
  // got stripped.
  if (rows.length <= LOOKS_LEDGER_MAX_ROWS) {
    return { ...ledger, schema: LOOKS_LEDGER_SCHEMA, looks: rows };
  }
  const preCompactionHash = hashRows(rows);
  const dropped = rows.length - LOOKS_LEDGER_MAX_ROWS;
  return {
    ...ledger,
    schema: LOOKS_LEDGER_SCHEMA,
    looks: rows.slice(-LOOKS_LEDGER_MAX_ROWS),
    compaction: { at: now, droppedRows: dropped, preCompactionHash, cap: LOOKS_LEDGER_MAX_ROWS },
  };
}

export function writeLooksLedger(file: string, ledger: LooksLedger): void {
  writeFileSync(file, JSON.stringify(ledger, null, 2) + "\n", "utf8");
}

// Latest row for a fingerprint pair; used by the release post-tag assertion.
export function latestLook(ledger: LooksLedger, key: string): LooksLedgerEntry | undefined {
  for (let i = ledger.looks.length - 1; i >= 0; i--) {
    const row = ledger.looks[i]!;
    if (row.key === key) return row;
  }
  return undefined;
}
