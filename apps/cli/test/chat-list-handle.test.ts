// The session list and a resume must agree about the same store row (#316).
//
// The earlier tests inject a fake record reader, which cannot catch the mistake
// that matters here: the store speaks in its own session id, the record
// directory speaks in PI handles (`piSessionKey(id)`), and a path that forgets
// that mapping reports "没有对话记录" for every row while a resume works fine.
// This file uses a REAL directory and a REAL store so the mapping is exercised.
//
// Run: pnpm --filter @anysearch-cli/cli run test

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { piSessionKey, sessionVerdictsForDir } from "@anysearch-cli/kernel";
import { formatChatListLine } from "../src/commands/chat-session";

const STORE_ID = "chat-session-abc";
const HANDLE = piSessionKey(STORE_ID);
const HEADER = JSON.stringify({ type: "session", id: HANDLE, version: 3, timestamp: 1, cwd: "anysearch-session" });
const TURN = JSON.stringify({ type: "message", id: "m1", parentId: null, timestamp: 2, message: { role: "user", content: "hi" } });

const dir = mkdtempSync(join(tmpdir(), "ans-316-list-handle-"));
test.after(() => rmSync(dir, { recursive: true, force: true }));

function writeRecord(name: string, lines: string[]): string {
  const path = join(dir, name);
  writeFileSync(path, lines.join("\n") + "\n");
  return path;
}

test("a listed row reads its record through the PI handle, not the store id", () => {
  writeRecord(`2026-01-01T00-00-00_${HANDLE}.jsonl`, [HEADER, TURN]);
  const verdicts = sessionVerdictsForDir(dir);

  // What the resume path does: the store id is mapped to the handle.
  const resumeVerdict = verdicts(piSessionKey(STORE_ID));
  assert.deepEqual(resumeVerdict, { ok: true }, "the record for this store id is usable");

  // What the list does for the same row. Injecting the same mapping here is the
  // point: forgetting it would make this row read as "没有对话记录" while the
  // resume above works, and the two would silently disagree.
  const row = formatChatListLine(
    { id: STORE_ID, updatedAt: "2026-01-01T00:00:00Z", isCompleted: 1 },
    (id) => verdicts(piSessionKey(id)),
  );
  assert.equal(row, `${STORE_ID}\t2026-01-01T00:00:00Z`,
    "a healthy conversation is listed with no complaint (got " + JSON.stringify(row) + ")");
  assert.doesNotMatch(row, /没有对话记录/,
    "the row must not claim the record is missing when the resume finds it");
});

test("a damaged record is marked on its listed row with the same reason a resume gives", () => {
  const brokenId = "chat-session-broken";
  writeRecord(`2026-01-01T00-00-01_${piSessionKey(brokenId)}.jsonl`, [HEADER.replace(HANDLE, piSessionKey(brokenId)), "{oops"]);
  const verdicts = sessionVerdictsForDir(dir);

  const resumeVerdict = verdicts(piSessionKey(brokenId));
  const row = formatChatListLine(
    { id: brokenId, updatedAt: "2026-01-02T00:00:00Z", isCompleted: 1 },
    (id) => verdicts(piSessionKey(id)),
  );

  assert.equal(resumeVerdict.ok, false, "the broken record is refused at resume");
  assert.match(row, /第 2 行/, "the row names the broken line (got " + JSON.stringify(row) + ")");
});

test("a torn tail is shown on the row, because that write really was lost", () => {
  const tornId = "chat-session-torn";
  const path = join(dir, `2026-01-01T00-00-02_${piSessionKey(tornId)}.jsonl`);
  writeFileSync(path,
    [JSON.stringify({ type: "session", id: piSessionKey(tornId), version: 3, timestamp: 1, cwd: "x" }), TURN].join("\n") +
    "\n" + '{"type":"message","id":"m2","timest');
  const verdicts = sessionVerdictsForDir(dir);

  const resumeVerdict = verdicts(piSessionKey(tornId));
  assert.equal(resumeVerdict.ok, true, "a torn tail is not a refusal");

  const row = formatChatListLine(
    { id: tornId, updatedAt: "2026-01-03T00:00:00Z", isCompleted: 1 },
    (id) => verdicts(piSessionKey(id)),
  );
  assert.match(row, /尾行断在第 3 行/,
    "the row says where the tail broke (got " + JSON.stringify(row) + ")");
});

test("an unrelated store id is listed as having no record, not as an error", () => {
  const verdicts = sessionVerdictsForDir(dir);
  const row = formatChatListLine(
    { id: "chat-session-never-ran", updatedAt: "2026-01-04T00:00:00Z", isCompleted: 1 },
    (id) => verdicts(piSessionKey(id)),
  );
  assert.match(row, /没有对话记录/, "an id with no record says exactly that");
  assert.doesNotMatch(row, /无法确认/, "and it is not dressed up as an unreadable directory");
});
