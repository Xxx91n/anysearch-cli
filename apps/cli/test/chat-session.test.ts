import assert from "node:assert/strict";
import { test } from "node:test";
import { parseChatOptions, selectChatSession } from "../src/commands/chat-session";

test("explicit continuation selects only the current project; unknown and missing handles fail", () => {
  const store = {
    listChatSessions: (root: string | null) => root === "/a" ? [{ id: "a", projectRoot: "/a" }] : [],
    getChatSession: (id: string) => id === "legacy" ? { id, projectRoot: null } : undefined,
  } as any;
  assert.equal(selectChatSession(store, parseChatOptions(["question"]), "/a", () => true), undefined);
  assert.equal(selectChatSession(store, parseChatOptions(["--continue", "question"]), "/a", () => true), "a");
  assert.throws(() => selectChatSession(store, parseChatOptions(["--continue", "question"]), "/b", () => true));
  assert.throws(() => selectChatSession(store, parseChatOptions(["--continue", "question"]), null, () => true));
  assert.equal(selectChatSession(store, parseChatOptions(["--session", "legacy", "question"]), "/b", () => true), "legacy");
  assert.throws(() => selectChatSession(store, parseChatOptions(["--session", "missing", "question"]), "/a", () => true));
  assert.throws(() => selectChatSession(store, parseChatOptions(["--session", "legacy", "question"]), "/b", () => false));
  assert.throws(() => selectChatSession(store, parseChatOptions(["--continue", "question"]), "/a", () => false));
  assert.equal(parseChatOptions(["--session=--llm.provider", "question"]).sessionId, "--llm.provider");
  for (const args of [["--continue", "--session", "a"], ["--session"], ["--list", "question"], ["--unassigned"]]) {
    assert.throws(() => parseChatOptions(args));
  }
  assert.equal(parseChatOptions(["--", "--continue"]).query, "--continue");
});
