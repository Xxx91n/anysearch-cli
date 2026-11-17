import assert from "node:assert/strict";
import { test } from "node:test";
import { parseChatOptions, selectChatSession } from "../src/commands/chat-session";

test("explicit continuation selects only the current project; unknown and missing handles fail", () => {
  const store = {
    listChatSessions: (root: string | null) => root === "/a" ? [{ id: "a", projectRoot: "/a" }] : [],
    getChatSession: (id: string) => id === "legacy" ? { id, projectRoot: null } : undefined,
  } as any;
  assert.equal(selectChatSession(store, parseChatOptions(["question"]), "/a"), undefined);
  assert.equal(selectChatSession(store, parseChatOptions(["--continue", "question"]), "/a"), "a");
  assert.throws(() => selectChatSession(store, parseChatOptions(["--continue", "question"]), "/b"));
  assert.throws(() => selectChatSession(store, parseChatOptions(["--continue", "question"]), null));
  assert.equal(selectChatSession(store, parseChatOptions(["--session", "legacy", "question"]), "/b"), "legacy");
  assert.throws(() => selectChatSession(store, parseChatOptions(["--session", "missing", "question"]), "/a"));
  for (const args of [["--continue", "--session", "a"], ["--session"], ["--list", "question"], ["--unassigned"]]) {
    assert.throws(() => parseChatOptions(args));
  }
  assert.equal(parseChatOptions(["--", "--continue"]).query, "--continue");
});
