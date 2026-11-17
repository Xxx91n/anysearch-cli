import assert from "node:assert/strict";
import { test } from "node:test";
import { parseChatArgv, parseChatOptions, selectChatSession, formatChatListLine } from "../src/commands/chat-session";
import type { PiSessionRecordVerdict } from "@anysearch-cli/kernel";

const usable: PiSessionRecordVerdict = { ok: true };

test("explicit continuation selects only the current project; unknown and missing handles fail", () => {
  const store = {
    listChatSessions: (root: string | null) => root === "/a" ? [{ id: "a", projectRoot: "/a", isCompleted: 1 }] : [],
    getChatSession: (id: string) => id === "legacy" ? { id, projectRoot: null } : undefined,
  } as any;
  assert.equal(selectChatSession(store, parseChatOptions(["question"]), "/a", () => usable), undefined);
  assert.equal(selectChatSession(store, parseChatOptions(["--continue", "question"]), "/a", () => usable), "a");
  const incomplete = { ...store, listChatSessions: () => [{ id: "a", projectRoot: "/a", isCompleted: 0 }] } as any;
  assert.equal(selectChatSession(incomplete, parseChatOptions(["--continue", "question"]), "/a", () => usable), "a");
  assert.throws(() => selectChatSession(store, parseChatOptions(["--continue", "question"]), "/b", () => usable));
  assert.throws(() => selectChatSession(store, parseChatOptions(["--continue", "question"]), null, () => usable));
  assert.equal(selectChatSession(store, parseChatOptions(["--session", "legacy", "question"]), "/b", () => usable), "legacy");
  assert.throws(() => selectChatSession(store, parseChatOptions(["--session", "missing", "question"]), "/a", () => usable));
  assert.throws(() => selectChatSession(store, parseChatOptions(["--session", "legacy", "question"]), "/b", () => ({ ok: false, problem: "missing", message: "没有这段会话的对话记录" })));
  assert.throws(() => selectChatSession(store, parseChatOptions(["--continue", "question"]), "/a", () => ({ ok: false, problem: "missing", message: "没有这段会话的对话记录" })));
  assert.equal(parseChatOptions(["--session=--llm.provider", "question"]).sessionId, "--llm.provider");
  for (const args of [["--continue", "--session", "a"], ["--session"], ["--list", "question"], ["--unassigned"]]) {
    assert.throws(() => parseChatOptions(args));
  }
  assert.equal(parseChatOptions(["--", "--continue"]).query, "--continue");
  const literal = parseChatArgv(["--", "--llm.provider=openai", "hello"]);
  assert.equal(literal.flags.provider, undefined);
  assert.equal(literal.options.query, "--llm.provider=openai hello");
});

test("a damaged record is refused with its own reason, never as a fresh conversation", () => {
  const store = {
    listChatSessions: () => [{ id: "a", projectRoot: "/a", isCompleted: 1 }],
    getChatSession: (id: string) => ({ id, projectRoot: "/a" }),
  } as any;
  const cases: Array<[PiSessionRecordVerdict, RegExp]> = [
    [{ ok: false, problem: "bad-line", message: "会话记录第 3 行坏了", line: 3 }, /第 3 行/],
    [{ ok: false, problem: "newer-format", message: "格式版本是 9" }, /格式版本/],
    [{ ok: false, problem: "identity-mismatch", message: "身份对不上" }, /身份对不上/],
  ];
  for (const [verdict, expected] of cases) {
    for (const args of [["--continue", "question"], ["--session", "a", "question"]]) {
      assert.throws(
        () => selectChatSession(store, parseChatOptions(args), "/a", () => verdict),
        expected,
        "a damaged record must be refused with its reason for " + args.join(" "),
      );
    }
  }
  // The torn tail is not a refusal: the record is usable and gets repaired.
  assert.equal(
    selectChatSession(store, parseChatOptions(["--session", "a", "question"]), "/a",
      () => ({ ok: true, tornTail: { line: 4, bytes: 20 } })),
    "a",
    "a torn tail is repaired, not refused",
  );
});

test("the list keeps every conversation and says what is wrong with each", () => {
  // One healthy, one unfinished, one with a broken line, one that is gone.
  const verdicts: Record<string, PiSessionRecordVerdict> = {
    good: { ok: true },
    partial: { ok: false, problem: "missing", message: "没有这段会话的对话记录" },
    broken: { ok: false, problem: "bad-line", message: "会话记录第 7 行坏了", line: 7 },
  };
  const entries = [
    { id: "good", updatedAt: "2026-01-01T00:00:00Z", isCompleted: 1 },
    { id: "partial", updatedAt: "2026-01-02T00:00:00Z", isCompleted: 0 },
    { id: "broken", updatedAt: "2026-01-03T00:00:00Z", isCompleted: 1 },
  ];
  const lines = entries.map((entry) => formatChatListLine(entry, (id) => verdicts[id]!));

  assert.equal(lines.length, 3, "a bad record must not remove its row from the list");
  assert.equal(lines[0], "good\t2026-01-01T00:00:00Z", "a healthy conversation has no complaint");
  assert.match(lines[1]!, /未完成/, "an unfinished attempt is still marked");
  assert.match(lines[1]!, /没有对话记录/, "a missing record is named");
  assert.match(lines[2]!, /第 7 行/, "a broken record names its line");
  assert.equal(new Set([lines[1], lines[2]]).size, 2, "two different problems read differently");

  // A judgment that itself throws must not take the list down.
  const survived = formatChatListLine(
    { id: "explodes", updatedAt: "2026-01-04T00:00:00Z", isCompleted: 1 },
    () => { throw new Error("disk on fire"); },
  );
  assert.match(survived, /explodes/, "the row is still listed");
  assert.match(survived, /无法确认/, "and says the record could not be checked");
});
