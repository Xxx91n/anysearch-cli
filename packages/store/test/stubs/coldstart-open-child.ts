// #257 helper: open the two stores that createEngine() opens, on one fresh
// database, in a real separate process.
//
// Why a real process and not worker_threads: POSIX fcntl locks are per-process,
// so two threads in one process cannot reproduce the two-host-processes race
// the ticket is about.
//
// Prints one JSON line; exits nonzero when initialization failed so the caller
// can assert both the outer message and the preserved busy error (code + cause).
import { SqliteSessionStore } from "../../src/session-store.js";
import { SqliteObservationStore } from "../../src/observation.js";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const dbPath = process.argv[2];
const t0 = Date.now();

try {
  // Same order as packages/kernel/src/composition.ts createEngine(): the
  // caller's ensureOwnerOnlyDb() creates the parent directory first, then the
  // session store, then the observation store, all on one file.
  mkdirSync(dirname(dbPath), { recursive: true });
  const session = new SqliteSessionStore(dbPath);
  const observation = new SqliteObservationStore(dbPath);
  observation.close();
  session.close();
  process.stdout.write(JSON.stringify({ ok: true, ms: Date.now() - t0 }) + "\n");
} catch (e) {
  const err = e as (Error & { code?: string; cause?: { message?: string; code?: string } }) | undefined;
  process.stdout.write(JSON.stringify({
    ok: false,
    ms: Date.now() - t0,
    message: err?.message ?? String(e),
    code: err?.code,
    causeMessage: err?.cause?.message,
    causeCode: err?.cause?.code,
  }) + "\n");
  process.exitCode = 1;
}