// #265: the confirmed Acme data, including the existing reused-recall-block
// input shape, through consolidate()/flush(). No real provider is called.
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteSessionStore } from "@anysearch-cli/store";
import { MemoryPipeline } from "../src/memory-pipeline";

const TASK = "Find out when Acme support is reachable. Keep the answer short.";
const OLD = "Acme support runs weekdays 9:00-17:00.";

test("compression refuses an unresolved old recall block even with a sourced latest summary", async () => {
  const root = mkdtempSync(join(tmpdir(), "ans-265-compress-"));
  const store = new SqliteSessionStore(join(root, "memory.db"));
  try {
    for (const carryLegacyBlock of [false, true]) {
      const sessionId = carryLegacyBlock ? "legacy-carried" : "sourced-control";
      await store.ensureSession(sessionId, "acme");
      const [sourceId] = await store.saveResultsWithIds(sessionId, [{
        url: "https://acme.example/hours-v1", title: "acme hours v1", snippet: OLD, source: "tavily",
      }]);
      // It exists in both cases. Only a block the generator actually reads
      // should block compression; its mere presence in the store is irrelevant.
      await store.saveAnchor(sessionId, "l2_recall", { hits: OLD });
      const legacyId = (await store.getAnchors(sessionId)).at(-1)!.id;
      await store.saveAnchor(sessionId, "rolling_summary", {
        summary: OLD, sources: [{ kind: "material", id: sourceId }],
      });
      let calls = 0;
      const pipeline = new MemoryPipeline({
        store, models: {}, sessionId,
        retriever: { search: async () => ({ results: [] }) } as any,
        domain: { sources: { enabled: [] }, prompts: [], skills: { active: [] },
          hooks: { toolWhitelist: [] }, rag: { adapter: "none" }, compaction: { lowWatermark: 1 } },
        model: { id: "probe-model", name: "Probe", api: "openai-completions", provider: "openai",
          baseUrl: "http://127.0.0.1:1/v1", reasoning: false, input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100000, maxTokens: 8192 },
        getApiKey: async () => "test-key-not-real",
        streamFn: () => ({ async *[Symbol.asyncIterator]() {
          calls++;
          yield { type: "done", reason: "stop", message: { role: "assistant",
            content: [{ type: "text", text: OLD }], api: "openai-completions", provider: "openai", model: "probe-model",
            usage: { input: 60, output: 8, totalTokens: 68, cost: { total: 0 } }, stopReason: "stop", timestamp: 0 } };
        } }),
      });
      const messages = [
        { role: "user", content: TASK + (carryLegacyBlock ? "\n\n[Research Recall] " + OLD : ""), timestamp: 0 },
        { role: "toolResult", toolCallId: "original-read", toolName: "search", isError: false, timestamp: 0,
          content: [{ type: "text", text: JSON.stringify({ results: [{ archiveRowId: sourceId,
            url: "https://acme.example/hours-v1", snippet: OLD }] }) }] },
      ];
      await pipeline.consolidate(messages, 1000, true);
      await pipeline.flush();
      const summaries = (await store.getAnchors(sessionId)).filter((a) => a.anchorType === "rolling_summary");
      assert.equal(calls, carryLegacyBlock ? 0 : 1);
      assert.equal(summaries.length, carryLegacyBlock ? 1 : 2);
      if (carryLegacyBlock) assert.equal(store.prepareLegacySummary(sessionId, legacyId)!.status, "incomplete");
    }
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});

test("compression uses the checked snapshot when messages change during adjudication", async () => {
  const root = mkdtempSync(join(tmpdir(), "ans-265-snapshot-"));
  const store = new SqliteSessionStore(join(root, "memory.db"));
  try {
    const sessionId = "delayed-reuse";
    await store.ensureSession(sessionId, "acme");
    const [sourceId] = await store.saveResultsWithIds(sessionId, [{
      url: "https://acme.example/hours-v1", title: "acme hours v1", snippet: OLD, source: "tavily",
    }]);
    await store.saveAnchor(sessionId, "l2_recall", { hits: OLD });
    await store.saveAnchor(sessionId, "rolling_summary", {
      summary: OLD, sources: [{ kind: "material", id: sourceId }],
    });
    let releaseDecision!: () => void;
    let decisionStarted!: () => void;
    const gate = new Promise<void>((resolve) => { releaseDecision = resolve; });
    const started = new Promise<void>((resolve) => { decisionStarted = resolve; });
    let calls = 0;
    let summaryInput: unknown;
    const pipeline = new MemoryPipeline({
      store, models: {}, sessionId,
      retriever: { search: async () => ({ results: [] }) } as any,
      domain: { sources: { enabled: [] }, prompts: [], skills: { active: [] },
        hooks: { toolWhitelist: [] }, rag: { adapter: "none" }, compaction: { lowWatermark: 100000 } },
      model: { id: "probe-model", name: "Probe", api: "openai-completions", provider: "openai",
        baseUrl: "http://127.0.0.1:1/v1", reasoning: false, input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100000, maxTokens: 8192 },
      getApiKey: async () => "test-key-not-real",
      streamFn: (_model: unknown, context: unknown) => {
        const call = ++calls;
        if (call === 2) summaryInput = context;
        return { async *[Symbol.asyncIterator]() {
          if (call === 1) {
            decisionStarted();
            await gate;
            yield { type: "text_delta", delta: "compress" };
          } else {
            yield { type: "done", reason: "stop", message: { role: "assistant",
              content: [{ type: "text", text: OLD }], api: "openai-completions", provider: "openai", model: "probe-model",
              usage: { input: 60, output: 8, totalTokens: 68, cost: { total: 0 } }, stopReason: "stop", timestamp: 0 } };
          }
        } };
      },
    });
    const messages: any[] = [
      { role: "user", content: TASK, timestamp: 0 },
      { role: "toolResult", toolCallId: "original-read", toolName: "search", isError: false, timestamp: 0,
        content: [{ type: "text", text: JSON.stringify({ results: [{ archiveRowId: sourceId,
          url: "https://acme.example/hours-v1", snippet: OLD }] }) }] },
      ...Array.from({ length: 3 }, () => ({ role: "user", content: TASK, timestamp: 0 })),
    ];
    await pipeline.consolidate(messages, 1000, true);
    await started;
    messages.push({ role: "user", content: TASK + "\n\n[Research Recall] " + OLD, timestamp: 0 });
    releaseDecision();
    await pipeline.flush();
    assert.equal(calls, 2);
    assert.ok(summaryInput);
    assert.ok(!JSON.stringify(summaryInput).includes("[Research Recall] " + OLD));
    const summaries = (await store.getAnchors(sessionId)).filter((a) => a.anchorType === "rolling_summary");
    assert.equal(summaries.length, 2);
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});
