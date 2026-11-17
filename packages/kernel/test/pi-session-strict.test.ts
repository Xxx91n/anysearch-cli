// Reading a session record in full before resuming it (#299, thread on
// pi-runtime.ts:891).
//
// PI's own loader skips a malformed line and keeps the rest, so resuming a
// record whose middle turn is unreadable would answer from a shorter history
// than the user remembers. These cases pin the narrower check this ticket adds:
//
//   R1 a well-formed record is resumable;
//   R2 a malformed middle line is refused, with its line number;
//   R3 a torn tail (no terminating newline) is refused;
//   R4 a blank line is not a failure;
//   R5 an unrelated broken file does not block a new chat or another session.
//
// Run: pnpm --filter @anysearch-cli/kernel run test

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findPiSessionRecord, indexPiSessionRecords, readPiSessionRecord } from "../src/pi-session";

const KEY = "ans-" + "0123456789abcdef".repeat(2);
const HEADER = JSON.stringify({ type: "session", id: KEY, version: 3, timestamp: 1, cwd: "anysearch-session" });

function record(dir: string, name: string, lines: string[], trailingNewline = true): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, lines.join("\n") + (trailingNewline ? "\n" : ""));
  return path;
}

const dir = mkdtempSync(join(tmpdir(), "ans-299-record-"));
try {
  // ---------- R1: a healthy record ----------
  const good = record(dir, `2026-01-01T00-00-00_${KEY}.jsonl`, [
    HEADER,
    JSON.stringify({ type: "message", role: "user", content: "hello" }),
    JSON.stringify({ type: "message", role: "assistant", content: "hi" }),
  ]);
  assert.deepEqual(readPiSessionRecord(good), { ok: true }, "R1: a well-formed record is resumable");
  assert.equal(findPiSessionRecord(dir, KEY), good, "R1: the healthy record is found by its key");

  // ---------- R2: a malformed middle line, with its line number ----------
  const brokenDir = join(dir, "broken-middle");
  const broken = record(brokenDir, `2026-01-01T00-00-01_${KEY}.jsonl`, [
    HEADER,
    JSON.stringify({ type: "message", role: "user", content: "hello" }),
    "{not json at all",
    JSON.stringify({ type: "message", role: "assistant", content: "hi" }),
  ]);
  const verdict = readPiSessionRecord(broken);
  assert.equal(verdict.ok, false, "R2: a malformed middle line is refused");
  assert.match((verdict as any).reason, /第 3 行/, "R2: the reason names the broken line (got " + JSON.stringify(verdict) + ")");
  const before = readFileSync(broken, "utf8");
  readPiSessionRecord(broken);
  assert.equal(readFileSync(broken, "utf8"), before, "R2: the judgment does not modify the file");

  // ---------- R3: a torn tail ----------
  const tornDir = join(dir, "torn");
  const torn = record(tornDir, `2026-01-01T00-00-02_${KEY}.jsonl`, [
    HEADER,
    JSON.stringify({ type: "message", role: "user", content: "hello" }),
  ], false);
  const tornVerdict = readPiSessionRecord(torn);
  assert.equal(tornVerdict.ok, false, "R3: a tail without its newline is refused");
  assert.match((tornVerdict as any).reason, /最后一行/, "R3: the reason says the last line is unfinished");

  // ---------- R4: a blank line is not a failure ----------
  const blankDir = join(dir, "blank");
  const blank = record(blankDir, `2026-01-01T00-00-03_${KEY}.jsonl`, [
    HEADER,
    "",
    JSON.stringify({ type: "message", role: "user", content: "hello" }),
  ]);
  assert.deepEqual(readPiSessionRecord(blank), { ok: true }, "R4: a blank line does not break the read");

  // ---------- R4b: an empty record has nothing to resume ----------
  const emptyDir = join(dir, "empty");
  const empty = record(emptyDir, `2026-01-01T00-00-06_${KEY}.jsonl`, [""]);
  const emptyVerdict = readPiSessionRecord(empty);
  assert.equal(emptyVerdict.ok, false, "R4b: an empty record is not resumable");
  assert.match((emptyVerdict as any).reason, /空/, "R4b: the reason says the record is empty");

  // ---------- R5: an unrelated broken file blocks nothing ----------
  const mixedDir = join(dir, "mixed");
  const healthy = record(mixedDir, `2026-01-01T00-00-04_${KEY}.jsonl`, [
    HEADER,
    JSON.stringify({ type: "message", role: "user", content: "hello" }),
  ]);
  // A file whose header cannot be read at all, and whose name carries no key:
  // it cannot be any session's record, so it must not fail every lookup — the
  // runtime asks this question for brand-new chats too.
  writeFileSync(join(mixedDir, "stray.jsonl"), "{ this is not json\n");
  const lookup = indexPiSessionRecords(mixedDir);
  assert.equal(lookup(KEY), healthy, "R5: a stray unreadable file does not hide a healthy record");
  assert.equal(lookup("ans-" + "f".repeat(32)), undefined, "R5: an unrelated key still resolves to nothing");

  // A broken file that DOES name this key is still a refusal — that one could
  // be this session's record.
  const namedBroken = join(dir, "named-broken");
  record(namedBroken, `2026-01-01T00-00-05_${KEY}.jsonl`, ["{ not json"]);
  assert.throws(() => indexPiSessionRecords(namedBroken)(KEY),
    "R5: a record naming this session is still refused when it cannot be read");

  console.log("pi-session-strict: all cases passed");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
