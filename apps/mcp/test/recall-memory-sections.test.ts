// #609: what recall_memory tells an external host about a hit — url, fetch
// time, whether the row carries a body, and the section list — while keeping
// the existing 200-character preview untouched.
//
// Uses the real registered handler over a real temp store: the JSON below is
// the only contract an MCP host reads.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteSessionStore } from "@anysearch-cli/store";
import { registerRecallMemory } from "../src/tools/recall-memory.tool.js";

type Handler = (args: unknown, ctx?: unknown) => Promise<{ content: Array<{ type: string; text: string }> }>;

interface InternalHit {
  role: string;
  content: string;
  rowid: number;
  url?: string;
  fetchedAt?: string;
  hasContent: boolean;
  sections: Array<{ sectionId: number; headingPath: string; chars: number; startOffset: number }>;
}

test("recall_memory exposes page facts and the section list", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ans-mcp-recall-"));
  const store = new SqliteSessionStore(join(dir, "t.db"));
  try {
    const session = await store.createSession("research");
    await store.savePage(session.id, {
      url: "https://example.com/guide",
      title: "部署指南",
      content: "## 安装\n\n这里是安装说明。\n\n## 检索\n\n这里是检索说明。",
      source: "exa",
    });
    const snippet = "长".repeat(300) + " zzsnippet";
    const snippetIds = await store.saveResultsWithIds(session.id, [
      { url: "https://example.com/snippet", title: "只有摘要", snippet, source: "exa" },
    ]);
    const snippetRowId = snippetIds[0] as number;
    const pageRowId = (await store.dbQuery<{ id: number }>(
      "SELECT id FROM retrieval_results WHERE url = ?", "example.com/guide",
    ))[0]!.id;

    const handlers: Record<string, Handler> = {};
    const fakeServer = { registerTool: (name: string, _config: unknown, handler: Handler) => { handlers[name] = handler; } };
    const fakeSpan = {
      traceId: "t",
      spanId: "s",
      addEvent: () => {},
      setAttributes: () => {},
      startSpan: async (_o: unknown, cb: (span: unknown) => unknown) => cb(fakeSpan),
      finish: () => {},
    };
    registerRecallMemory(fakeServer as never, {
      store,
      observation: { recordOperation: async (_o: unknown, cb: (span: unknown) => unknown) => cb(fakeSpan) },
    } as never);

    // A content hit: the whole page fact set, and the preview never grows.
    const contentBody = JSON.parse((await handlers.recall_memory!({ query: "安装", limit: 1 })!).content[0]!.text) as { internal: InternalHit[] };
    const pageHit = contentBody.internal.find((h) => h.rowid === pageRowId)!;
    assert.ok(pageHit, "the page row is in the answer");
    assert.equal(pageHit.url, "example.com/guide", "url is the stored page identity");
    assert.match(pageHit.fetchedAt ?? "", /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/, "fetchedAt is ISO-8601 UTC");
    assert.equal(pageHit.hasContent, true, "a page row reports hasContent");
    assert.equal(pageHit.sections.length, 2, "both level-0 sections are listed");
    for (const section of pageHit.sections) {
      assert.deepEqual(Object.keys(section).sort(), ["chars", "headingPath", "sectionId", "startOffset"]);
      assert.ok(section.sectionId > 0 && section.chars > 0 && section.startOffset >= 0);
    }
    // The 200-character preview is the pre-#609 truncation, unchanged.
    assert.ok(pageHit.content.length <= 200, "content preview stays at 200 characters");

    // A snippet-only hit: the same shape, honestly empty.
    const snippetBody = JSON.parse((await handlers.recall_memory!({ query: "zzsnippet", limit: 5 })!).content[0]!.text) as { internal: InternalHit[] };
    const snippetHit = snippetBody.internal.find((h) => h.rowid === snippetRowId)!;
    assert.ok(snippetHit, "the snippet row is in the answer");
    assert.equal(snippetHit.hasContent, false, "a snippet-only row reports hasContent false");
    assert.deepEqual(snippetHit.sections, [], "a snippet-only row has no sections");
    assert.equal(snippetHit.url, "example.com/snippet", "a snippet row still carries its page identity");
    assert.equal(snippetHit.content.length, 200, "the 200-character preview truncation is unchanged");

    // The multi-query path with one list (no embedding) must carry the same
    // page facts; a missing body lookup used to leave url/fetchedAt empty.
    const multi = await store.searchMemoryMulti(["zzsnippet"], 5);
    const multiHit = multi.find((h) => h.rowid === snippetRowId)!;
    assert.equal(multiHit.url, "example.com/snippet", "the multi-query path carries the page url");
    assert.equal(multiHit.hasContent, false, "the multi-query path carries hasContent");
  } finally {
    store.close();
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});
