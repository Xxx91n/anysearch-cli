// #611: recall_memory's external-host contract for expand — the JSON a host
// reads, the untrusted marker, the correctable errors, and the observation
// event. Real registered handler over a real temp store.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteSessionStore } from "@anysearch-cli/store";
import { registerRecallMemory } from "../src/tools/recall-memory.tool.js";

type Handler = (args: unknown, ctx?: unknown) => Promise<{
  isError?: boolean;
  content: Array<{ type: string; text: string }>;
}>;

interface ExpandJson {
  rowid: number;
  role: string;
  url: string;
  fetchedAt: string | null;
  trust: string;
  totalChars: number;
  offset: number;
  returnedChars: number;
  hasMore: boolean;
  nextOffset: number | null;
  truncatedBy: string | null;
  text: string;
}

function recallHandler(store: SqliteSessionStore, events: Array<{ name: string; attributes?: Record<string, unknown> }>): Handler {
  const handlers: Record<string, Handler> = {};
  const fakeServer = { registerTool: (name: string, _config: unknown, handler: Handler) => { handlers[name] = handler; } };
  const fakeSpan = {
    traceId: "t",
    spanId: "s",
    addEvent: (name: string, attributes?: Record<string, unknown>) => { events.push({ name, attributes }); },
    setAttributes: () => {},
    startSpan: async (_o: unknown, cb: (span: unknown) => unknown) => cb(fakeSpan),
    finish: () => {},
  };
  registerRecallMemory(fakeServer as never, {
    store,
    observation: { recordOperation: async (_o: unknown, cb: (span: unknown) => unknown) => cb(fakeSpan) },
  } as never);
  return handlers.recall_memory!;
}

function json(result: { content: Array<{ text: string }> }): Record<string, unknown> {
  return JSON.parse(result.content[0]!.text) as Record<string, unknown>;
}

test("recall_memory expand reads a section with the untrusted marker", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ans-mcp-expand-"));
  const store = new SqliteSessionStore(join(dir, "t.db"));
  try {
    const session = await store.createSession("research");
    const page = await store.savePage(session.id, {
      url: "https://example.com/guide",
      title: "部署指南",
      content: "## 安装\n\n这里是安装说明。\n\n## 检索\n\n这里是检索说明。",
      source: "exa",
    });
    const events: Array<{ name: string; attributes?: Record<string, unknown> }> = [];
    const recall = recallHandler(store, events);

    const ok = await recall({ query: "安装", expand: { rowid: page.id! } });
    assert(!ok.isError, "a readable section is not an error");
    const body = json(ok) as unknown as ExpandJson;
    assert.equal(body.rowid, page.id);
    assert.equal(body.trust, "untrusted_web", "page text is labelled untrusted");
    assert.equal(body.url, "example.com/guide", "url is the stored identity, same as a recall hit");
    assert.match(body.fetchedAt ?? "", /^\d{4}-\d{2}-\d{2}T/, "fetchedAt is ISO-8601");
    assert.equal(body.hasMore, false);
    assert.equal(body.nextOffset, null);
    assert.equal(body.truncatedBy, null);
    assert.ok(body.text.includes("这里是安装说明"), "the section body is returned");
    assert.ok(body.returnedChars === [...body.text].length, "returnedChars matches the text");
    assert.equal(events.filter((e) => e.name === "memory.expand").length, 1, "one expand observation event");
    assert.equal(events.find((e) => e.name === "memory.expand")!.attributes!["memory.rowid"], page.id);

    const snippetIds = await store.saveResultsWithIds(session.id, [
      { url: "https://example.com/snippet", title: "只有摘要", snippet: "snippet only", source: "exa" },
    ]);
    const noContent = await recall({ query: "x", expand: { rowid: snippetIds[0]! } });
    assert.equal(noContent.isError, true, "a snippet-only row is an execution error");
    assert.equal(json(noContent).error, "no_content");
    assert.equal(typeof json(noContent).message, "string", "the error says what to do next");

    const knowledge = await recall({ query: "x", expand: { rowid: -3 } });
    assert.equal(knowledge.isError, true);
    assert.equal(json(knowledge).error, "knowledge_row");
  } finally {
    store.close();
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

test("recall_memory expand reports hasMore and continues at nextOffset", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ans-mcp-expand-big-"));
  const store = new SqliteSessionStore(join(dir, "t.db"));
  try {
    const session = await store.createSession("research");
    const big = await store.savePage(session.id, {
      url: "https://example.com/big",
      title: "大页面",
      content: "word ".repeat(3000),
      source: "exa",
    });
    const events: Array<{ name: string; attributes?: Record<string, unknown> }> = [];
    const recall = recallHandler(store, events);

    const first = await recall({ query: "x", expand: { rowid: big.id! } });
    assert(!first.isError, "the first read succeeds");
    const head = json(first) as unknown as ExpandJson;
    assert.equal(head.hasMore, true, "a page over 8000 characters reports more");
    assert.equal(head.truncatedBy, "oversized_section", "the hard ceiling names itself");
    assert.ok(head.returnedChars <= 8000, "the hard ceiling holds (got " + head.returnedChars + ")");
    assert.ok(head.nextOffset !== null && head.nextOffset! > 0, "nextOffset is page-level");
    assert.ok(head.text.endsWith("…"), "the cut is marked with an ellipsis");

    const rest = await recall({ query: "x", expand: { rowid: big.id, offset: head.nextOffset! } });
    assert(!rest.isError, "the continuation succeeds");
    const tail = json(rest) as unknown as ExpandJson;
    assert.equal(tail.offset, head.nextOffset, "offset echoes the continuation point");
    assert.equal(tail.hasMore, false, "the rest fits in one read");
    assert.ok(tail.text.length > 0, "the continuation is not empty");
  } finally {
    store.close();
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});
