// Judging a whole session record before it is opened (#316; the narrower check
// this replaces came from #299).
//
// PI's own loader skips a malformed line and keeps the rest, so resuming a
// record whose middle turn is unreadable would answer from a shorter history
// than the user remembers. #316 widens that one question into the full verdict
// the resume path needs:
//
//   R1 a well-formed record is accepted, and the judgment changes nothing;
//   R2 a malformed middle line is refused, and the sentence names its line;
//   R3 a torn tail is not a fact: it is dropped and reported for repair, then a
//      repair cuts exactly those bytes so the next append is not stranded;
//   R4 a blank line is not a failure; an empty record has nothing to resume;
//   R5 the format version is checked against this build, not guessed;
//   R6 identity is checked three ways: header id, file-name id, requested handle;
//   R7 an event kind this build does not know is refused.
//
// The four damaged samples below each say a DIFFERENT sentence on purpose: a
// user must be able to tell "line 3 is broken" from "this file is newer than my
// program", and every one of them must leave the file byte-for-byte unchanged.
//
// Run: pnpm --filter @anysearch-cli/kernel run test

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PI_SESSION_FORMAT_VERSION,
  describePiSessionVerdict,
  findPiSessionRecord,
  indexPiSessionRecords,
  judgePiSessionRecord,
  lookupPiSessionRecord,
  repairPiSessionTornTail,
  type PiSessionRecordVerdict,
} from "../src/pi-session";

const KEY = "ans-" + "0123456789abcdef".repeat(2);
const OTHER_KEY = "ans-" + "fedcba9876543210".repeat(2);
const HEADER = (id = KEY, version = 3) =>
  JSON.stringify({ type: "session", id, version, timestamp: 1, cwd: "anysearch-session" });
const USER = JSON.stringify({ type: "message", id: "m1", parentId: null, timestamp: 2, message: { role: "user", content: "hello" } });
const ASSISTANT = JSON.stringify({ type: "message", id: "m2", parentId: "m1", timestamp: 3, message: { role: "assistant", content: "hi" } });

function record(dir: string, name: string, lines: string[], trailingNewline = true): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, lines.join("\n") + (trailingNewline ? "\n" : ""));
  return path;
}

/** Run a judgment twice and prove the bytes did not move. */
function judgmentIsReadOnly(path: string, expectedKey: string): PiSessionRecordVerdict {
  const before = readFileSync(path);
  const verdict = judgePiSessionRecord(path, expectedKey);
  assert.deepEqual(readFileSync(path), before, "the judgment must not modify the file: " + path);
  assert.deepEqual(judgePiSessionRecord(path, expectedKey), verdict, "the judgment must be repeatable: " + path);
  return verdict;
}

function refusal(verdict: PiSessionRecordVerdict): Extract<PiSessionRecordVerdict, { ok: false }> {
  assert.equal(verdict.ok, false, "expected a refusal, got " + JSON.stringify(verdict));
  return verdict as Extract<PiSessionRecordVerdict, { ok: false }>;
}

const dir = mkdtempSync(join(tmpdir(), "ans-316-record-"));
try {
  // ---------- R0: the copied format version still matches the SDK ----------
  // PI_SESSION_FORMAT_VERSION is copied so the kernel does not load the SDK at
  // module load (#258). This case is what turns a PI upgrade into a failure
  // instead of a wrong answer: if PI bumps its version, this build would start
  // refusing records it can actually read, or worse, accept ones it cannot.
  {
    const sdk = await import("@earendil-works/pi-coding-agent");
    assert.equal(PI_SESSION_FORMAT_VERSION, sdk.CURRENT_SESSION_VERSION,
      "the kernel's format version must match the PI SDK this build ships");
  }

  // ---------- R1: a healthy record ----------
  {
    const healthy = record(dir, `2026-01-01T00-00-00_${KEY}.jsonl`, [HEADER(), USER, ASSISTANT]);
    const verdict = judgmentIsReadOnly(healthy, KEY);
    assert.deepEqual(verdict, { ok: true }, "R1: a well-formed record is accepted with no torn tail");
    assert.equal(findPiSessionRecord(dir, KEY), healthy, "R1: the healthy record is found by its handle");
    assert.deepEqual(lookupPiSessionRecord(dir, KEY), { path: healthy, verdict: { ok: true } },
      "R1: the lookup the resume path uses agrees");
  }

  // ---------- R2: a malformed middle line, and its line number ----------
  const brokenDir = join(dir, "broken-middle");
  const broken = record(brokenDir, `2026-01-01T00-00-01_${KEY}.jsonl`, [HEADER(), USER, "{not json at all", ASSISTANT]);
  {
    const verdict = judgmentIsReadOnly(broken, KEY);
    const refused = refusal(verdict);
    assert.equal(refused.problem, "bad-line", "R2: the problem is a broken line");
    assert.equal(refused.line, 3, "R2: the broken line is number 3");
    assert.match(refused.message, /第 3 行/, "R2: the sentence names line 3 (got " + refused.message + ")");
  }

  // ---------- R3: a torn tail is dropped, then cut ----------
  {
    const tornDir = join(dir, "torn");
    const body = [HEADER(), USER];
    // Two complete lines, then a fragment with no newline of its own: the
    // shape a write that died partway through leaves behind.
    const torn = record(tornDir, `2026-01-01T00-00-02_${KEY}.jsonl`, body, true);
    const full = readFileSync(torn, "utf8");
    const tornLine = '{"type":"message","id":"m2","parentId":"m1","timest';
    writeFileSync(torn, full + tornLine);
    const sizeWithTorn = statSync(torn).size;

    const verdict = judgmentIsReadOnly(torn, KEY);
    assert.equal(verdict.ok, true, "R3: a half-written last line is not a failure — it is not a fact");
    assert.equal(verdict.ok && verdict.tornTail?.line, 3, "R3: the torn tail is reported as line 3");
    assert.equal(verdict.ok && verdict.tornTail?.bytes, Buffer.byteLength(tornLine, "utf8"),
      "R3: the report says exactly how many bytes the fragment occupies");

    // Repair is the separate, explicit step: cut those bytes and nothing else.
    assert.equal(repairPiSessionTornTail(torn, verdict), true, "R3: the repair reports that it cut something");
    assert.equal(readFileSync(torn, "utf8"), full, "R3: after repair the file is exactly its complete lines");
    assert.equal(statSync(torn).size, sizeWithTorn - Buffer.byteLength(tornLine, "utf8"),
      "R3: only the fragment was removed");
    assert.deepEqual(judgePiSessionRecord(torn, KEY), { ok: true }, "R3: the repaired record is whole");

    // A repair on a healthy record is a no-op, not a truncation.
    const untouched = record(join(dir, "torn-noop"), `2026-01-01T00-00-02_${OTHER_KEY}.jsonl`, [HEADER(OTHER_KEY), USER]);
    const complete = readFileSync(untouched, "utf8");
    assert.equal(repairPiSessionTornTail(untouched, { ok: true }), false, "R3: nothing to cut, nothing cut");
    assert.equal(readFileSync(untouched, "utf8"), complete, "R3: a healthy file is never shortened");
  }

  // ---------- R3b: a fragment cut mid-character does not eat the line before it ----------
  // The byte count must come from the raw file. An append killed inside a
  // multi-byte character decodes that partial character to U+FFFD, and counting
  // the decoded string would over-measure by 1-2 bytes. Cutting that larger
  // number slices the previous line's newline, and the NEXT read then treats a
  // real, complete message as the new torn tail — losing a turn from a repair
  // that was supposed to save the file.
  {
    const prefix = [HEADER(), USER, ASSISTANT].join("\n") + "\n";
    const prefixBytes = Buffer.byteLength(prefix, "utf8");
    // "中" is 3 bytes; keep only its first one.
    const fullFragment = Buffer.from('{"type":"message","text":"中', "utf8");
    const fragment = fullFragment.subarray(0, fullFragment.length - 2);
    const midChar = record(join(dir, "torn-midchar"), `2026-01-01T00-00-20_${KEY}.jsonl`, [""], false);
    writeFileSync(midChar, Buffer.concat([Buffer.from(prefix, "utf8"), fragment]));

    const verdict = judgmentIsReadOnly(midChar, KEY);
    assert.equal(verdict.ok, true, "R3b: a fragment cut mid-character is still just an unfinished tail");
    assert.equal(verdict.ok && verdict.tornTail?.bytes, fragment.length,
      "R3b: the fragment is measured in REAL bytes, not decoded-string bytes (got " +
      JSON.stringify(verdict.ok && verdict.tornTail) + ", real=" + fragment.length + ")");

    const completeBefore = readFileSync(midChar).subarray(0, prefixBytes);
    assert.equal(repairPiSessionTornTail(midChar, verdict), true, "R3b: the repair cuts the fragment");
    const after = readFileSync(midChar);
    assert.deepEqual(after, completeBefore,
      "R3b: the cut leaves exactly the complete lines — the line before is not eaten");
    // The real proof: re-judging finds a whole record, not a new torn tail.
    assert.deepEqual(judgePiSessionRecord(midChar, KEY), { ok: true },
      "R3b: after repair the earlier complete lines are all still there");
  }

  // ---------- R4: blank lines are fine; an empty record is not ----------
  {
    const blank = record(join(dir, "blank"), `2026-01-01T00-00-03_${KEY}.jsonl`, [HEADER(), "", USER]);
    assert.deepEqual(judgmentIsReadOnly(blank, KEY), { ok: true }, "R4: a blank line does not break the read");

    const empty = record(join(dir, "empty"), `2026-01-01T00-00-06_${KEY}.jsonl`, [""]);
    const refused = refusal(judgmentIsReadOnly(empty, KEY));
    assert.equal(refused.problem, "empty", "R4: an empty record has nothing to resume");
    assert.match(refused.message, /空/, "R4: the sentence says the record is empty");
  }

  // ---------- R5: a newer format is refused, not guessed ----------
  {
    const newer = record(join(dir, "newer"), `2026-01-01T00-00-07_${KEY}.jsonl`,
      [HEADER(KEY, PI_SESSION_FORMAT_VERSION + 1), USER]);
    const refused = refusal(judgmentIsReadOnly(newer, KEY));
    assert.equal(refused.problem, "newer-format", "R5: a higher version is refused");
    assert.match(refused.message, /格式版本/, "R5: the sentence says the format is newer");
    assert.match(refused.message, new RegExp(String(PI_SESSION_FORMAT_VERSION + 1)), "R5: it names the version it found");

    // An older version is readable: PI itself migrates those forward.
    const older = record(join(dir, "older"), `2026-01-01T00-00-08_${KEY}.jsonl`, [HEADER(KEY, 2), USER]);
    assert.equal(judgmentIsReadOnly(older, KEY).ok, true, "R5: an older version is accepted");

    // A header with no version at all is PI's version 1.
    const v1Header = JSON.stringify({ type: "session", id: KEY, timestamp: 1, cwd: "anysearch-session" });
    const v1 = record(join(dir, "v1"), `2026-01-01T00-00-09_${KEY}.jsonl`, [v1Header, USER]);
    assert.equal(judgmentIsReadOnly(v1, KEY).ok, true, "R5: a header without a version is version 1");
  }

  // ---------- R6: identity is three-way ----------
  {
    // Header id disagrees with the file name and the requested handle.
    const headerOther = record(join(dir, "id-header"), `2026-01-01T00-00-10_${KEY}.jsonl`, [HEADER(OTHER_KEY), USER]);
    const refusedHeader = refusal(judgmentIsReadOnly(headerOther, KEY));
    assert.equal(refusedHeader.problem, "identity-mismatch", "R6: a header id that disagrees is refused");
    assert.match(refusedHeader.message, /身份对不上/, "R6: the sentence says identity does not match");

    // The file name disagrees while header and handle agree.
    const renamed = record(join(dir, "id-name"), `2026-01-01T00-00-11_${OTHER_KEY}.jsonl`, [HEADER(KEY), USER]);
    assert.equal(refusal(judgmentIsReadOnly(renamed, KEY)).problem, "identity-mismatch",
      "R6: a renamed file is refused, not silently accepted under its old handle");

    // The requested handle disagrees: the caller asked for a different chat.
    const healthyPath = record(join(dir, "id-request"), `2026-01-01T00-00-12_${KEY}.jsonl`, [HEADER(), USER]);
    assert.equal(refusal(judgmentIsReadOnly(healthyPath, OTHER_KEY)).problem, "identity-mismatch",
      "R6: asking for another handle is refused");
  }

  // ---------- R7: an unknown event kind is refused ----------
  {
    const unknown = record(join(dir, "unknown-event"), `2026-01-01T00-00-13_${KEY}.jsonl`,
      [HEADER(), USER, JSON.stringify({ type: "quantum_branch", id: "x1", parentId: "m1", timestamp: 4 })]);
    const refused = refusal(judgmentIsReadOnly(unknown, KEY));
    assert.equal(refused.problem, "unknown-event", "R7: an unknown event kind is refused");
    assert.equal(refused.line, 3, "R7: the sentence names the line");
    assert.match(refused.message, /不认识/, "R7: the sentence says the event is unknown");
  }

  // ---------- The four samples from the ticket say four different things ----------
  // Middle broken line / torn tail / newer format / identity mismatch: a user
  // must be able to tell these apart at a glance in the list.
  {
    // A FRESH torn file: the one above was repaired, so judging it now says
    // "normal". Reusing it here would quietly weaken this check.
    const freshTorn = record(join(dir, "sentence-torn"), `2026-01-01T00-00-19_${KEY}.jsonl`,
      [HEADER(), USER, '{"type":"message","id":"m2"'], false);
    const newer = record(join(dir, "sentence-newer"), `2026-01-01T00-00-14_${KEY}.jsonl`,
      [HEADER(KEY, PI_SESSION_FORMAT_VERSION + 1), USER]);
    const mismatch = record(join(dir, "sentence-mismatch"), `2026-01-01T00-00-16_${OTHER_KEY}.jsonl`, [HEADER(KEY), USER]);
    const sentences = [broken, freshTorn, newer, mismatch].map((path) =>
      describePiSessionVerdict(judgePiSessionRecord(path, KEY)));
    // The torn record's one-liner names the repair rather than refusing.
    assert.match(sentences[1]!, /尾行断在第 3 行/, "the list line says where the tail broke (got " + sentences[1] + ")");
    assert.equal(new Set(sentences).size, sentences.length,
      "the four damaged samples must not collapse into one sentence: " + JSON.stringify(sentences));
    for (const sentence of sentences) assert.ok(sentence.length > 0, "every verdict has a line for the list");
  }

  // ---------- R8: lookup never throws, and an unrelated file blocks nothing ----------
  {
    const mixedDir = join(dir, "mixed");
    const healthy = record(mixedDir, `2026-01-01T00-00-17_${KEY}.jsonl`, [HEADER(), USER]);
    // A file whose header cannot be read at all, and whose name carries no key:
    // it cannot be any session's record, so it must not fail every lookup — the
    // runtime asks this question for brand-new chats too.
    writeFileSync(join(mixedDir, "stray.jsonl"), "{ this is not json\n");
    const lookup = indexPiSessionRecords(mixedDir);
    assert.equal(lookup(KEY), healthy, "R8: a stray unreadable file does not hide a healthy record");
    assert.equal(lookup(OTHER_KEY), undefined, "R8: an unrelated handle still resolves to nothing");

    // A broken file that DOES name this handle is reported as this session's
    // problem, in words, rather than thrown at the caller.
    const namedBroken = join(dir, "named-broken");
    const namedBrokenPath = record(namedBroken, `2026-01-01T00-00-18_${KEY}.jsonl`, ["{ not json"]);
    assert.throws(() => indexPiSessionRecords(namedBroken)(KEY),
      "R8: the raw index still refuses a record naming this handle");
    const found = lookupPiSessionRecord(namedBroken, KEY);
    // The path is kept on purpose: a caller asking "does this session have a
    // transcript?" must answer yes-and-damaged, not "no". Answering "no" is what
    // would mint a fresh empty conversation under a handle that already has one.
    assert.equal(found.path, namedBrokenPath, "R8: the damaged record's path is still reported");
    assert.equal(refusal(found.verdict).problem, "unreadable", "R8: it is a stated problem, not a thrown error");

    // No record at all is its own answer, not an exception.
    const missing = lookupPiSessionRecord(join(dir, "nowhere"), KEY);
    assert.equal(refusal(missing.verdict).problem, "missing", "R8: a missing record is a verdict");
    assert.equal(missing.path, undefined, "R8: an absent record has no path");
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log("pi-session-strict: all cases passed");
