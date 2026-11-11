// #257 helper process: take and hold an EXCLUSIVE lock on a database, so the
// other process meets a real locked file (not a simulated busy error).
//
// Prints LOCKED once the lock is held, then RELEASED after the hold ends. The
// caller kills it either way; `holdMs` decides whether the waiter's bounded
// retry window outlives the lock or not.
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const dbPath = process.argv[2];
const holdMs = Number(process.argv[3] ?? 1500);

mkdirSync(dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
// No CREATE TABLE here on purpose: the ticket says the database is not pre-created
// or pre-initialized, and SQLite takes BEGIN EXCLUSIVE on an empty file just fine.
db.exec("BEGIN EXCLUSIVE");
process.stdout.write("LOCKED\n");

Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, holdMs);

try { db.exec("COMMIT"); } catch { /* the waiter's failure is the point */ }
db.close();
// No trailing RELEASED marker: the caller kills this process either way, and an
// unread line is just noise (this stub is spawned, never imported).
