import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteSessionStore } from "../src/session-store";

test("project sessions survive reopening; legacy rows stay unassigned and research stays shared", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ans-chat-projects-"));
  const path = join(dir, "data.db");
  let store = new SqliteSessionStore(path);
  try {
    await store.ensureSession("legacy", "default");
    await store.saveResults("legacy", [{ url: "https://intra.example/wiki", title: "internal wiki", snippet: "the intranet wiki proxy runs on port 8080", source: "tavily" }]);
    await store.ensureSession("a", "default");
    store.recordChatProject("a", "/project/a", false);
    assert.equal(store.getChatSession("a")?.projectRoot, "/project/a");
    assert.equal(store.getChatSession("a")?.chatTracked, 1);
    assert.equal(store.listChatSessions("/project/a")[0]?.id, "a");
    assert.equal(store.listChatSessions("/project/a")[0]?.isCompleted, 0);
    store.recordChatProject("a", "/project/b", false);
    assert.equal(store.getChatSession("a")?.projectRoot, "/project/a");
    store.recordChatProject("a", "/project/a");
    await store.ensureSession("b", "default");
    store.recordChatProject("b", "/project/b");
    store.recordChatProject("a", "/project/b");
    assert.deepEqual(store.listChatSessions(null).map((s) => s.id), ["legacy"]);
    assert.equal(store.getChatSession("legacy")?.chatTracked, 0);
    store.recordChatProject("legacy", null);
    store.close();
    store = new SqliteSessionStore(path);
    assert.deepEqual(store.listChatSessions(null).map((s) => s.id), ["legacy"]);
    assert.equal(store.getChatSession("a")?.projectRoot, "/project/a");
    assert.deepEqual(store.listChatSessions("/project/b").map((s) => s.id), ["b"]);
    assert.deepEqual(store.listChatSessions("/missing"), []);
    assert.equal(store.getChatSession("absent"), undefined);
    assert.ok((await store.searchMemory("internal wiki port", 5)).some((h) => h.content?.includes("port 8080")));
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("same-millisecond registrations keep their real order", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ans-chat-order-"));
  const store = new SqliteSessionStore(join(dir, "data.db"));
  try {
    // `b` is registered first, then `a` — both inside one clock tick, which is
    // what a fast CLI invocation or a test does. Sorting by `id DESC` would put
    // `b` first and `--continue` would pick the conversation that was used
    // second-to-last.
    const realNow = Date.now;
    let frozen = realNow();
    Date.now = () => frozen;
    try {
      await store.ensureSession("b", "default");
      await store.ensureSession("a", "default");
      store.recordChatProject("b", "/p", true);
      store.recordChatProject("a", "/p", true);
      assert.deepEqual(store.listChatSessions("/p").map((s) => s.id), ["a", "b"],
        "the last registration wins the order even inside one millisecond");

      // A third write in the same tick still advances past both.
      await store.ensureSession("c", "default");
      store.recordChatProject("c", "/p", true);
      assert.deepEqual(store.listChatSessions("/p").map((s) => s.id), ["c", "a", "b"],
        "a later registration is still later, in the same frozen millisecond");
    } finally {
      frozen = realNow;
      Date.now = realNow;
    }
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
