// The session list and a resume must agree about the same store row (#316).
//
// The store speaks in its own session id; the record directory speaks in PI
// handles (`piSessionKey(id)`). A path that forgets that mapping reports "没有对话记录"
// for every row while a resume of the same id works fine — and an earlier
// version of this ticket shipped exactly that.
//
// This file therefore calls the PRODUCTION reader (`chatRecordReader`) instead
// of rebuilding the mapping locally. A test that rebuilt it would stay green
// while the product broke, which is how the bug survived one round already.
//
// Run: pnpm --filter @anysearch-cli/cli run test

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { piSessionKey } from "@anysearch-cli/kernel";
import { chatRecordReader, formatChatList, formatChatListLine } from "../src/commands/chat-session";

const STORE_ID = "chat-session-abc";
const HANDLE = piSessionKey(STORE_ID);
const TURN = JSON.stringify({ type: "message", id: "m1", parentId: null, timestamp: 2, message: { role: "user", content: "hi" } });

function headerFor(handle: string): string {
  return JSON.stringify({ type: "session", id: handle, version: 3, timestamp: 1, cwd: "anysearch-session" });
}

const dir = mkdtempSync(join(tmpdir(), "ans-316-list-handle-"));
test.after(() => rmSync(dir, { recursive: true, force: true }));

function writeRecord(name: string, content: string): void {
  writeFileSync(join(dir, name), content);
}

test("the production reader finds a record by store id, not by its raw text", () => {
  writeRecord(`2026-01-01T00-00-00_${HANDLE}.jsonl`, [headerFor(HANDLE), TURN].join("\n") + "\n");
  const readRecord = chatRecordReader(dir);

  // This is the exact mapping under test: the store id goes in, the record is
  // found. A reader that skipped piSessionKey would answer "missing" here.
  assert.deepEqual(readRecord(STORE_ID), { ok: true },
    "the production reader maps the store id to its PI handle");

  // And the same reader, on a store id whose record does not exist, still
  // answers "missing" — so the check above is not passing by accident.
  assert.equal(readRecord("chat-session-never-ran").ok, false,
    "an id with no record is not found");
});

test("a listed row uses that same reader and shows no complaint for a healthy record", () => {
  // A DIFFERENT handle: writing another file for the first test's handle would
  // make that handle ambiguous, which is a different case (covered below).
  const healthyId = "chat-session-healthy";
  const healthyHandle = piSessionKey(healthyId);
  writeRecord(`2026-01-01T00-00-00b_${healthyHandle}.jsonl`, [headerFor(healthyHandle), TURN].join("\n") + "\n");
  const row = formatChatListLine(
    { id: healthyId, updatedAt: "2026-01-01T00:00:00Z", isCompleted: 1 },
    chatRecordReader(dir),
  );
  assert.equal(row, `${healthyId}\t2026-01-01T00:00:00Z`,
    "a healthy conversation is listed with no note (got " + JSON.stringify(row) + ")");
  assert.doesNotMatch(row, /没有对话记录/, "the row must not claim the record is missing");
});

test("a damaged record is marked on its listed row with the same reason a resume gives", () => {
  const brokenId = "chat-session-broken";
  const brokenHandle = piSessionKey(brokenId);
  writeRecord(`2026-01-01T00-00-01_${brokenHandle}.jsonl`, [headerFor(brokenHandle), "{oops"].join("\n") + "\n");
  const readRecord = chatRecordReader(dir);

  const resumeVerdict = readRecord(brokenId);
  const row = formatChatListLine(
    { id: brokenId, updatedAt: "2026-01-02T00:00:00Z", isCompleted: 1 },
    readRecord,
  );

  assert.equal(resumeVerdict.ok, false, "the broken record is refused at resume");
  assert.match(row, /第 2 行/, "the row names the broken line (got " + JSON.stringify(row) + ")");
});

test("a torn tail is shown on the row, because that write really was lost", () => {
  const tornId = "chat-session-torn";
  const tornHandle = piSessionKey(tornId);
  writeRecord(`2026-01-01T00-00-02_${tornHandle}.jsonl`,
    [headerFor(tornHandle), TURN].join("\n") + "\n" + '{"type":"message","id":"m2","timest');
  const readRecord = chatRecordReader(dir);

  assert.equal(readRecord(tornId).ok, true, "a torn tail is not a refusal");

  const row = formatChatListLine(
    { id: tornId, updatedAt: "2026-01-03T00:00:00Z", isCompleted: 1 },
    readRecord,
  );
  assert.match(row, /尾行断在第 3 行/,
    "the row says where the tail broke (got " + JSON.stringify(row) + ")");
});

test("two records for one row are marked ambiguous on the list and refused at resume", () => {
  const dupId = "chat-session-dup";
  const dupHandle = piSessionKey(dupId);
  writeRecord(`2026-01-01T00-00-03_${dupHandle}.jsonl`, [headerFor(dupHandle), TURN].join("\n") + "\n");
  writeRecord(`2026-01-01T00-00-04_${dupHandle}.jsonl`, [headerFor(dupHandle), TURN].join("\n") + "\n");
  const readRecord = chatRecordReader(dir);

  assert.equal(readRecord(dupId).ok, false, "the resume refuses an ambiguous handle");
  const row = formatChatListLine(
    { id: dupId, updatedAt: "2026-01-05T00:00:00Z", isCompleted: 1 },
    readRecord,
  );
  assert.match(row, /多份/, "the row says there are several records to check (got " + JSON.stringify(row) + ")");
});

// The command's own rendering path, end to end: real directory, real rows, the
// production reader. A break anywhere in that chain shows up here — including
// the store-id→handle mapping, which a test that rebuilt it would miss.
test("the whole --list rendering agrees with what a resume would decide", () => {
  const rows = [
    { id: "chat-session-abc", updatedAt: "2026-01-01T00:00:00Z", isCompleted: 1 },
    { id: "chat-session-broken", updatedAt: "2026-01-02T00:00:00Z", isCompleted: 1 },
    { id: "chat-session-torn", updatedAt: "2026-01-03T00:00:00Z", isCompleted: 1 },
    { id: "chat-session-dup", updatedAt: "2026-01-05T00:00:00Z", isCompleted: 1 },
    { id: "chat-session-never-ran", updatedAt: "2026-01-06T00:00:00Z", isCompleted: 0 },
  ];
  const lines = formatChatList(dir, rows);
  assert.equal(lines.length, rows.length, "one line per conversation, none dropped");

  const [healthy, broken, torn, dup, neverRan] = lines as [string, string, string, string, string];

  // The decisive assertion for the bug this ticket hit: a store id WITH a
  // record must not be listed as having none.
  assert.match(healthy, /^chat-session-abc\t/, "the healthy row is the healthy conversation");
  assert.doesNotMatch(healthy, /没有对话记录/, "a conversation with a record is not listed as missing");

  assert.match(broken, /第 2 行/, "the broken record names its line");
  assert.match(torn, /尾行断在第 3 行/, "the torn record says where the tail broke");
  assert.match(dup, /多份/, "the duplicated record says it is ambiguous");
  assert.match(neverRan, /未完成/, "an unfinished attempt is still marked unfinished");
  assert.match(neverRan, /没有对话记录/, "an id with no record says so");

  // And every row's verdict is the one a resume of the same id would act on.
  const readRecord = chatRecordReader(dir);
  for (const row of rows) {
    const verdict = readRecord(row.id);
    const listed = lines[rows.indexOf(row)]!;
    if (!verdict.ok) {
      assert.match(listed, /对话记录|尾行|第 \d+ 行|多份|没有对话记录/,
        "a refused record is explained on its line: " + listed);
    } else if (verdict.tornTail) {
      assert.match(listed, /尾行断在第/, "a torn tail is explained on its line: " + listed);
    } else {
      assert.doesNotMatch(listed, /没有对话记录|坏了|对不上|多份/,
        "a usable record shows no complaint: " + listed);
    }
  }
});
