// #257 helper: open the two stores that createEngine() opens, on one fresh
// database, in a real separate process.
//
// Why a real process and not worker_threads: POSIX fcntl locks are per-process,
// so two threads in one process cannot reproduce the two-host-processes race
// the ticket is about.
//
// Prints one JSON line and exits nonzero when initialization failed, so the
// caller can assert both the outer message and the preserved busy error
// (code + cause). Reported fields:
//   - `msBeforeOpen`: how long this process took before the stores started
//     (module loading, directory creation). Lets the caller tell "my own work
//     was slow" apart from "initialization waited on a lock".
//   - `openMs`: how long the store constructors themselves took — the only
//     number a timing assertion about waiting may look at.
//   - `sawBusyBeforeOpen` (probe mode only): whether a throwaway probe open hit
//     SQLITE_BUSY before the stores were constructed. Probe mode makes the
//     "lock was really held when initialization started" claim an observation
//     instead of an assumption about the gap between the marker and the open.
import { SqliteSessionStore } from "../../src/session-store.js";
import { SqliteObservationStore } from "../../src/observation.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";

const dbPath = process.argv[2];
// Optional third arg: a marker file the parent waits on. Written as the last
// statement before the constructor, so the parent's hold can extend past this
// child's first attempt.
const readyFile = process.argv[3];
// Optional fourth arg: "probe" asks for one throwaway open first, reporting
// whether it hit SQLITE_BUSY. The probe is closed immediately and never runs
// schema work, so it cannot itself initialize the database.
const mode = process.argv[4];

const t0 = Date.now();
const beforeOpen = Date.now() - t0;
let sawBusyBeforeOpen: boolean | undefined;

try {
  // Same order as packages/kernel/src/composition.ts createEngine(): the
  // caller's ensureOwnerOnlyDb() creates the parent directory first, then the
  // session store, then the observation store, all on one file.
  mkdirSync(dirname(dbPath), { recursive: true });
  if (mode === "probe") {
    // A single WAL switch on a short busy timeout: this is how a would-be
    // initializer meets a held lock, and it fails in ~1.1s rather than waiting
    // out the 5s steady-state value.
    const probe = new Database(dbPath);
    try {
      probe.pragma("busy_timeout = 500");
      probe.pragma("journal_mode = WAL");
      sawBusyBeforeOpen = false;
    } catch (e) {
      sawBusyBeforeOpen = ((e as { code?: string }).code ?? "").startsWith("SQLITE_BUSY");
    } finally {
      try { probe.close(); } catch { /* probe is disposable */ }
    }
  }
  if (readyFile) writeFileSync(readyFile, "ready");
  const openT0 = Date.now();
  const session = new SqliteSessionStore(dbPath);
  const observation = new SqliteObservationStore(dbPath);
  observation.close();
  session.close();
  process.stdout.write(JSON.stringify({
    ok: true,
    msBeforeOpen: beforeOpen,
    openMs: Date.now() - openT0,
    ...(sawBusyBeforeOpen === undefined ? {} : { sawBusyBeforeOpen }),
  }) + "\n");
} catch (e) {
  const err = e as (Error & { code?: string; cause?: { message?: string; code?: string } }) | undefined;
  process.stdout.write(JSON.stringify({
    ok: false,
    msBeforeOpen: beforeOpen,
    openMs: Date.now() - t0,
    ...(sawBusyBeforeOpen === undefined ? {} : { sawBusyBeforeOpen }),
    message: err?.message ?? String(e),
    code: err?.code,
    causeMessage: err?.cause?.message,
    causeCode: err?.cause?.code,
  }) + "\n");
  process.exitCode = 1;
}