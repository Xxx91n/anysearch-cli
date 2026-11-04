// RAG adapter layer tests (#35, decision #90).
// Acceptance criteria covered here:
//   1. adapter="fts" -> retrieved content enters the injection pipeline with a
//      provenance label (block header + structured RagRetrievalResult.label).
//   2. adapter="none" and the legacy "note" path are unchanged (regression).
//   3. unknown adapter id -> fail-open to none + a named stderr warning.
// Plus the fail-open edges: no store, retrieval throw, no hits, and the
// injection seam itself — #131/#154 volatility split: static `note` on the
// first USER message, dynamic `fts` on the latest USER message (hot zone).
// Run: node --import tsx --test test/rag-adapter.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RagAdapterRegistry,
  createFtsRagAdapter,
  createNoteRagAdapter,
  RAG_ADAPTER_FTS,
  RAG_ADAPTER_NONE,
  RAG_ADAPTER_NOTE,
  RAG_BLOCK_MAX_CHARS,
  RAG_CONTEXT_TAG,
  RAG_DEFAULT_LIMIT,
  RAG_HIT_MAX_CHARS,
  RAG_QUERY_MAX_CHARS,
} from "../src/rag-adapter";
import { MemoryPipeline } from "../src/memory-pipeline";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadDomainFromString } from "@anysearch-cli/store";
import type { DomainConfigPort, RetrieverPort, SessionStorePort } from "../src/ports";

const retriever: RetrieverPort = {
  search: async () => ({ query: "", mode: "fast", results: [] }) as any,
};

function domain(rag: DomainConfigPort["rag"]): DomainConfigPort {
  return {
    sources: { enabled: [] },
    prompts: [],
    skills: { active: ["search"] },
    hooks: { toolWhitelist: ["search"] },
    rag,
  };
}

// Minimal store double: only the recall surface the fts adapter touches.
function storeWith(hits: any[], opts: { throwOnSearch?: boolean; spies?: any } = {}): SessionStorePort {
  return {
    getAnchors: async () => [],
    saveAnchor: async () => {},
    listPreferences: async () => [],
    searchMemory: async (q: string, limit?: number) => {
      if (opts.spies) { opts.spies.calls++; opts.spies.query = q; opts.spies.limit = limit; }
      if (opts.throwOnSearch) throw new Error("fts exploded");
      return hits;
    },
  } as any;
}

function pipelineWith(rag: DomainConfigPort["rag"], store: SessionStorePort) {
  return new MemoryPipeline({
    store,
    retriever,
    domain: domain(rag),
    model: {} as any,
    streamFn: () => ({ async *[Symbol.asyncIterator]() {} }) as any,
    sessionId: "s1",
  });
}

// === AC1: adapter="fts" injects retrieved content with provenance ===

test("fts: recalled memory enters Stage-1 injection with a provenance label", async () => {
  const store = storeWith([
    { rowid: 1, sessionId: "s1", role: "assistant", content: "Rust 1.0 shipped in 2015.", rank: 1 },
    { rowid: 2, sessionId: "s1", role: "user", content: "compare against Go", rank: 2 },
  ]);
  const pipeline = pipelineWith({ adapter: RAG_ADAPTER_FTS }, store);
  const out = await pipeline.inject([{ role: "user", content: "when did rust ship?" }]);

  const content: string = (out[0] as any).content;
  assert.ok(content.startsWith("when did rust ship?"), "original user text stays first");
  assert.ok(content.includes(RAG_CONTEXT_TAG), "RAG context block injected");
  assert.ok(content.includes("Rust 1.0 shipped in 2015."), "recalled row content injected");
  assert.ok(content.includes("compare against Go"), "every recalled row injected");
  // provenance: header names the adapter, the trust tier and a trace id;
  // each row carries its role so evidence vs instruction stays separable.
  assert.match(content, /adapter=fts/, "header names the adapter");
  assert.match(content, /provenance=memory/, "header carries the memory (non-user) trust tier");
  assert.match(content, /traceId=rag:fts:2/, "header carries a trace id");
  assert.ok(content.includes("- [assistant] Rust 1.0"), "row carries its role");
  assert.ok(content.includes("- [user] compare against Go"), "row role varies per hit");
});

test("fts: structured result carries the memory label + hit count", async () => {
  const adapter = createFtsRagAdapter(storeWith([
    { rowid: 1, sessionId: "s1", role: "assistant", content: "evidence one", rank: 1 },
  ]));
  const r = await adapter.retrieve("evidence");
  assert.ok(r, "adapter returns a result when hits exist");
  assert.equal(r!.label.source, "memory", "label.source = memory (untrusted at merge)");
  assert.equal(r!.hitCount, 1, "hitCount counts injected rows");
  assert.match(r!.block, /^\[RAG Context\] \(adapter=fts, provenance=memory, hits=1, traceId=rag:fts:1\)/,
    "block header is a stable, parseable shape");
  assert.equal(adapter.id, RAG_ADAPTER_FTS, "adapter id is fts");
});

test("fts: no hits -> null (nothing injected, no empty header)", async () => {
  const adapter = createFtsRagAdapter(storeWith([]));
  assert.equal(await adapter.retrieve("nothing matches"), null);
});

test("fts: blank/whitespace-only query never hits the store", async () => {
  const spies = { calls: 0, query: "", limit: 0 };
  const adapter = createFtsRagAdapter(storeWith([{ rowid: 1, role: "x", content: "y" }], { spies }));
  assert.equal(await adapter.retrieve("   "), null, "blank query -> null");
  assert.equal(await adapter.retrieve("" as any), null, "empty query -> null");
  assert.equal(spies.calls, 0, "no FTS round trip for an empty query");
});

test("fts: query is truncated for recall; limit defaults to the Stage-1 budget", async () => {
  const spies = { calls: 0, query: "", limit: 0 };
  const adapter = createFtsRagAdapter(storeWith([{ rowid: 1, role: "a", content: "b" }], { spies }));
  await adapter.retrieve("q".repeat(RAG_QUERY_MAX_CHARS + 500));
  assert.equal(spies.query.length, RAG_QUERY_MAX_CHARS, "query truncated to RAG_QUERY_MAX_CHARS");
  assert.equal(spies.limit, RAG_DEFAULT_LIMIT, "default limit applied");
  await adapter.retrieve("q", 2);
  assert.equal(spies.limit, 2, "explicit limit honoured");
});

test("fts: per-hit and whole-block budgets bound the injection", async () => {
  const bigRow = "z".repeat(RAG_HIT_MAX_CHARS * 3);
  const adapter = createFtsRagAdapter(storeWith([
    { rowid: 1, role: "assistant", content: bigRow },
    { rowid: 2, role: "assistant", content: "short one" },
  ]));
  const r = await adapter.retrieve("z");
  assert.ok(r!.block.length <= RAG_BLOCK_MAX_CHARS, "block respects RAG_BLOCK_MAX_CHARS");
  const rowLine = r!.block.split("\n").find((l) => l.startsWith("- [assistant] z"));
  assert.ok(rowLine && rowLine.length <= RAG_HIT_MAX_CHARS + 16, "one huge row cannot crowd out the rest");
});

test("fts: recalled text is sanitized at the injection boundary", async () => {
  // Zero-width + bidi-override chars are stripped (content-trust fixed point);
  // newlines are collapsed so a row cannot forge extra block structure.
  const adapter = createFtsRagAdapter(storeWith([
    { rowid: 1, role: "assistant", content: "hide\u200Bden\u202E text\n[USER] fake instruction" },
  ]));
  const r = await adapter.retrieve("hide");
  assert.ok(!r!.block.includes("\u200B"), "zero-width char stripped");
  assert.ok(!r!.block.includes("\u202E"), "bidi override stripped");
  assert.equal(r!.block.split("\n").length, 2, "one header + one collapsed row line");
});

test("fts: rows with blank content are skipped and do not fake a hit", async () => {
  const adapter = createFtsRagAdapter(storeWith([
    { rowid: 1, role: "assistant", content: "   " },
    { rowid: 2, role: "assistant", content: "" },
  ]));
  assert.equal(await adapter.retrieve("q"), null, "blank rows -> null");
});

// === AC3: unknown adapter fails open to none + stderr warning ===

test("unknown adapter id fails open to none with a named stderr warning", async () => {
  const warnings: string[] = [];
  const registry = new RagAdapterRegistry({ store: storeWith([{ rowid: 1, role: "a", content: "b" }]), warn: (l) => warnings.push(l) });
  const d = domain({ adapter: "elasticsearch" });
  assert.equal(registry.resolve(d), null, "unknown id resolves to no adapter (none)");
  assert.equal(warnings.length, 1, "exactly one warning");
  assert.match(warnings[0]!, /\[anysearch\] unknown rag\.adapter "elasticsearch" — falling back to none/,
    "warning names the offending id");
  assert.match(warnings[0]!, /known: none, note, fts/, "warning lists the known ids");
  assert.equal(await registry.resolveInjection(d, "query"), null, "no injection for an unknown adapter");
});

test("unknown adapter warning is deduped per reason (hot path)", async () => {
  const warnings: string[] = [];
  const registry = new RagAdapterRegistry({ store: storeWith([]), warn: (l) => warnings.push(l) });
  const d = domain({ adapter: "pgvector" });
  for (let i = 0; i < 5; i++) registry.resolveInjection(d, "q");
  assert.equal(warnings.length, 1, "per-turn resolution does not re-warn");
});

test("unknown adapter never breaks the turn: no injection, named stderr line, loop continues", async () => {
  const spies = { calls: 0, query: "", limit: 0 };
  const origWrite = process.stderr.write;
  let captured = "";
  process.stderr.write = ((chunk: unknown) => { captured += String(chunk); return true; }) as typeof process.stderr.write;
  try {
    const pipeline = pipelineWith({ adapter: "weaviate" }, storeWith([{ rowid: 1, role: "a", content: "should not appear" }], { spies }));
    const msgs = [{ role: "user", content: "hello" }];
    const out = await pipeline.inject(msgs as any);
    assert.deepEqual(out, msgs, "messages untouched by an unknown adapter");
    assert.equal(spies.calls, 0, "store never consulted for an unknown adapter");
  } finally {
    process.stderr.write = origWrite;
  }
  assert.match(captured, /\[anysearch\] unknown rag\.adapter "weaviate" — falling back to none/,
    "the fallback is named on stderr, not silent");
});

// === AC2: adapter="none" and legacy "note" behavior unchanged ===

test("none: no injection at all (regression)", async () => {
  const spies = { calls: 0, query: "", limit: 0 };
  const pipeline = pipelineWith({ adapter: RAG_ADAPTER_NONE }, storeWith([{ rowid: 1, role: "a", content: "recall" }], { spies }));
  const out = await pipeline.inject([{ role: "user", content: "question" }] as any);
  assert.equal((out[0] as any).content, "question", "content byte-identical to input");
  assert.equal(spies.calls, 0, "none does not touch the store");
});

test("none: a leftover config.note still injects (AC2 — pre-#104 legacy, byte-identical)", async () => {
  // Pre-#104 the condition was `adapter && config.note`, i.e. the string "none"
  // is truthy, so "none" + note DID inject. AC2 requires `none` behavior to be
  // unchanged, so this must keep injecting rather than silently start refusing.
  const pipeline = pipelineWith({ adapter: RAG_ADAPTER_NONE, config: { note: "internal wiki" } }, storeWith([]));
  const out = await pipeline.inject([{ role: "user", content: "question" }] as any);
  assert.equal((out[0] as any).content, "question\n\n[RAG Context] internal wiki",
    "none + note keeps the pre-#104 injection, byte for byte");
});

test("none with no note is silent (the shipped-domain case)", async () => {
  const spies = { calls: 0, query: "", limit: 0 };
  const pipeline = pipelineWith({ adapter: RAG_ADAPTER_NONE }, storeWith([{ rowid: 1, role: "a", content: "recalled" }], { spies }));
  const out = await pipeline.inject([{ role: "user", content: "question" }] as any);
  assert.equal((out[0] as any).content, "question", "no note -> no injection");
  assert.equal(spies.calls, 0, "no store round trip");
});

test("legacy note: injects config.note exactly as before (regression)", async () => {
  const pipeline = pipelineWith({ adapter: RAG_ADAPTER_NOTE, config: { note: "internal wiki is at /wiki" } }, storeWith([]));
  const out = await pipeline.inject([{ role: "user", content: "question" }] as any);
  assert.equal((out[0] as any).content, "question\n\n[RAG Context] internal wiki is at /wiki",
    "byte-identical to the pre-#104 note injection");
});

test("legacy note: note-less domain injects nothing (regression)", async () => {
  const pipeline = pipelineWith({ adapter: RAG_ADAPTER_NOTE }, storeWith([]));
  const out = await pipeline.inject([{ role: "user", content: "question" }] as any);
  assert.equal((out[0] as any).content, "question", "no note -> no injection");
});

test("note adapter carries system provenance (operator-authored, not recalled)", async () => {
  const r = await createNoteRagAdapter("operator text").retrieve("ignored");
  assert.equal(r!.label.source, "system", "note is system-tier");
  assert.equal(r!.hitCount, 0, "note is not a recall result");
  assert.equal(r!.block, "[RAG Context] operator text", "note block unchanged");
});

// === fail-open edges at the registry ===

test("fts without a session store fails open to none with a named warning", async () => {
  const warnings: string[] = [];
  const registry = new RagAdapterRegistry({ warn: (l) => warnings.push(l) });
  assert.equal(registry.resolve(domain({ adapter: RAG_ADAPTER_FTS })), null, "no store -> no adapter");
  assert.match(warnings[0]!, /rag adapter "fts" needs a session store — falling back to none/, "named warning");
});

test("a throwing store degrades to no injection, naming the fault (one line)", async () => {
  const warnings: string[] = [];
  const registry = new RagAdapterRegistry({
    store: storeWith([], { throwOnSearch: true }),
    warn: (l) => warnings.push(l),
  });
  const d = domain({ adapter: RAG_ADAPTER_FTS });
  assert.equal(await registry.resolveInjection(d, "q"), null, "retrieval fault -> null (fail-open)");
  assert.equal(warnings.length, 1, "one warning for the fault");
  assert.match(warnings[0]!, /rag adapter fts retrieval failed — continuing without RAG injection: fts exploded/,
    "warning names the adapter and the cause");
  assert.equal(await registry.resolveInjection(d, "q"), null, "still fails open on the next call");
  assert.equal(warnings.length, 1, "fault warning deduped");
});

test("a missing/mis-built domain resolves to no adapter instead of throwing", async () => {
  const registry = new RagAdapterRegistry({ store: storeWith([{ rowid: 1, role: "a", content: "c" }]), warn: () => {} });
  assert.equal(registry.resolve(undefined as any), null, "undefined domain -> null");
  assert.equal(registry.resolve(null as any), null, "null domain -> null");
  assert.equal(await registry.resolveInjection(undefined as any, "q"), null, "no injection without a domain");
});

test("registry caches per domain object (hot path costs one build)", async () => {
  const spies = { calls: 0, query: "", limit: 0 };
  const d = domain({ adapter: RAG_ADAPTER_FTS });
  const registry = new RagAdapterRegistry({ store: storeWith([{ rowid: 1, role: "a", content: "c" }], { spies }) });
  const first = registry.resolve(d);
  const second = registry.resolve(d);
  assert.equal(first, second, "same domain object -> same adapter instance");
  // A different object (domain TOML reload) is re-resolved, so a live edit
  // of rag.adapter takes effect on the next turn.
  const reloaded = registry.resolve(domain({ adapter: RAG_ADAPTER_NONE }));
  assert.equal(reloaded, null, "reloaded domain re-resolves to its new adapter");
});

// === injection seam: Stage-1, volatility split (#131/#154), no stacking ===

test("dynamic fts lands on the latest USER message, never a leading system turn", async () => {
  const pipeline = pipelineWith({ adapter: RAG_ADAPTER_FTS }, storeWith([
    { rowid: 1, role: "assistant", content: "recalled fact", rank: 1 },
  ]));
  const out = await pipeline.inject([
    { role: "system", content: "system prompt" },
    { role: "user", content: "first question" },
    { role: "assistant", content: "a1" },
    { role: "user", content: "latest question" },
  ] as any);
  assert.equal((out[0] as any).content, "system prompt", "system message untouched");
  assert.equal((out[1] as any).content, "first question", "first user turn bytes unchanged (KV prefix stable)");
  assert.ok(!(out[1] as any).content.includes("recalled fact"), "first user turn stays byte-stable (static slot)");
  assert.ok((out[3] as any).content.includes("recalled fact"), "RAG block on the latest user turn (hot zone)");
});

test("the fts query is the latest user turn's own pre-injection text", async () => {
  const spies = { calls: 0, query: "", limit: 0 };
  const pipeline = pipelineWith({ adapter: RAG_ADAPTER_FTS }, storeWith([{ rowid: 1, role: "a", content: "c" }], { spies }));
  await pipeline.inject([
    { role: "user", content: "turn one question" },
    { role: "assistant", content: "a1" },
    { role: "user", content: "turn two question" },
  ] as any);
  assert.equal(spies.query, "turn two question",
    "follow-up turn recalls on the current question, not the stale turn-1 text");
});

test("the fts query is capped at RAG_QUERY_MAX_CHARS on the latest turn", async () => {
  const spies = { calls: 0, query: "", limit: 0 };
  const pipeline = pipelineWith({ adapter: RAG_ADAPTER_FTS }, storeWith([{ rowid: 1, role: "a", content: "c" }], { spies }));
  const long = "x".repeat(RAG_QUERY_MAX_CHARS + 50);
  await pipeline.inject([
    { role: "user", content: "turn one" },
    { role: "assistant", content: "a1" },
    { role: "user", content: long },
  ] as any);
  assert.equal(spies.query.length, RAG_QUERY_MAX_CHARS, "query truncated to the strict-rung cap");
});

test("static note (none + leftover config.note) stays on the first user turn across turns", async () => {
  const pipeline = pipelineWith({ adapter: RAG_ADAPTER_NONE, config: { note: "internal wiki" } }, storeWith([]));
  const out = await pipeline.inject([
    { role: "user", content: "turn one" },
    { role: "assistant", content: "a1" },
    { role: "user", content: "turn two" },
  ] as any);
  assert.equal((out[0] as any).content, "turn one\n\n[RAG Context] internal wiki",
    "none + note keeps the #104 first-turn slot and bytes");
  assert.equal((out[2] as any).content, "turn two", "latest turn untouched by the static note");
});

test("a re-injected array does not pollute the fts query with the earlier block", async () => {
  const spies = { calls: 0, query: "", limit: 0 };
  const pipeline = pipelineWith({ adapter: RAG_ADAPTER_FTS }, storeWith([{ rowid: 1, role: "a", content: "c" }], { spies }));
  const msgs = [
    { role: "user", content: "turn one" },
    { role: "assistant", content: "a1" },
    { role: "user", content: "turn two question" },
  ];
  const first = await pipeline.inject(msgs as any);
  spies.query = "";
  await pipeline.inject(first as any);
  assert.equal(spies.query, "turn two question",
    "recall key strips the earlier [RAG Context] block instead of searching it");
});

test("content-block turn: Stage-1 + L1/L2 stack in documented order without overwriting user text", async () => {
  const store: any = storeWith([{ rowid: 1, role: "assistant", content: "recalled fact" }]);
  store.getAnchors = async () => [
    { anchorType: "rolling_summary", payload: { summary: "S".repeat(4000) } },
    { anchorType: "l2_recall", payload: { hits: "H".repeat(1500) } },
  ];
  const pipeline = new MemoryPipeline({
    store, retriever, domain: domain({ adapter: RAG_ADAPTER_FTS }),
    model: {} as any, streamFn: (() => ({})) as any, sessionId: "s1",
  });
  const blocks = [{ type: "text", text: "block-form question" }];
  const out = await pipeline.inject([{ role: "user", content: blocks }] as any);
  const content = (out[0] as any).content;
  assert.equal(content.length, 1, "block array keeps its single text block (no shape churn)");
  const text = content[0].text as string;
  assert.ok(text.startsWith("block-form question"), "user text preserved and first");
  const ragAt = text.indexOf("[RAG Context]");
  const l1At = text.indexOf("[Session Memory] ");
  const l2At = text.indexOf("[Research Recall] ");
  assert.ok(ragAt > 0, "Stage-1 RAG block appended");
  assert.ok(l1At > ragAt && l2At > l1At,
    "order: user text -> [RAG Context] -> [Session Memory] -> [Research Recall]");
  assert.ok(text.includes("[RAG Context]") && text.includes("recalled fact"), "RAG not crowded out by L1");
  assert.ok(text.includes("S".repeat(4000)) && !text.includes("S".repeat(4001)), "L1 payload capped at 4000");
  assert.ok(text.includes("H".repeat(1500)) && !text.includes("H".repeat(1501)), "L2 payload capped at 1500");
  assert.deepEqual(blocks[0], { type: "text", text: "block-form question" }, "input message not mutated");
});

test("only the selected adapter runs — note and fts do not stack", async () => {
  const spies = { calls: 0, query: "", limit: 0 };
  const pipeline = pipelineWith(
    { adapter: RAG_ADAPTER_FTS, config: { note: "legacy note" } },
    storeWith([{ rowid: 1, role: "a", content: "recalled" }], { spies }),
  );
  const out = await pipeline.inject([{ role: "user", content: "q" }] as any);
  const content = (out[0] as any).content;
  assert.ok(content.includes("recalled"), "fts ran");
  assert.ok(!content.includes("legacy note"), "note did not run alongside fts");
  assert.equal(spies.calls, 1, "one recall per inject");
});

test("empty message list is a no-op (no adapter work, no crash)", async () => {
  const spies = { calls: 0, query: "", limit: 0 };
  const pipeline = pipelineWith({ adapter: RAG_ADAPTER_FTS }, storeWith([{ rowid: 1, role: "a", content: "c" }], { spies }));
  assert.deepEqual(await pipeline.inject([]), [], "empty stays empty");
  assert.equal(spies.calls, 0, "no recall without a user message");
});

test("no user message at all (assistant-only) is a no-op", async () => {
  const spies = { calls: 0, query: "", limit: 0 };
  const pipeline = pipelineWith({ adapter: RAG_ADAPTER_FTS }, storeWith([{ rowid: 1, role: "a", content: "c" }], { spies }));
  const msgs = [{ role: "assistant", content: "only assistant" }];
  const out = await pipeline.inject(msgs as any);
  assert.deepEqual(out, msgs, "messages untouched");
  assert.equal(spies.calls, 0, "no recall without a user message");
});

test("content-block user turn (the real pi-agent-core shape) is injected in place, not replaced", async () => {
  // pi-agent-core normalizes prompt("…") to [{type:"text",text}] (verified against
  // @earendil-works/pi-agent-core 0.84.2). A string-only seam would either never
  // fire here or overwrite the user's message with the RAG block.
  const spies = { calls: 0, query: "", limit: 0 };
  const pipeline = pipelineWith({ adapter: RAG_ADAPTER_FTS }, storeWith([{ rowid: 1, role: "a", content: "recalled fact" }], { spies }));
  const blocks = [{ type: "text", text: "block-form question" }];
  const out = await pipeline.inject([{ role: "user", content: blocks }] as any);
  const content = (out[0] as any).content;
  assert.equal(content.length, 1, "block array stays one text block (no shape churn)");
  assert.equal(content[0].type, "text", "text block type preserved");
  assert.ok(content[0].text.startsWith("block-form question"), "user text stays first");
  assert.ok(content[0].text.includes("[RAG Context]"), "RAG block appended inside the text block");
  assert.ok(content[0].text.includes("recalled fact"), "recalled row injected");
  assert.equal(spies.query, "block-form question", "recall keyed on the block text");
  assert.deepEqual(blocks[0], { type: "text", text: "block-form question" }, "input message not mutated");
});

test("a content-block turn keeps its non-text blocks", async () => {
  const pipeline = pipelineWith({ adapter: RAG_ADAPTER_FTS }, storeWith([{ rowid: 1, role: "a", content: "recalled" }]));
  const image = { type: "image", data: "b64" };
  const out = await pipeline.inject([{ role: "user", content: [image, { type: "text", text: "what is this?" }] }] as any);
  const content = (out[0] as any).content;
  assert.equal(content.length, 2, "block count preserved");
  assert.deepEqual(content[0], image, "non-text block untouched");
  assert.ok(content[1].text.includes("what is this?") && content[1].text.includes("recalled"), "text block carries question + block");
});

test("a user turn with no text channel is left untouched (nothing to append to)", async () => {
  const spies = { calls: 0, query: "", limit: 0 };
  const pipeline = pipelineWith({ adapter: RAG_ADAPTER_FTS }, storeWith([{ rowid: 1, role: "a", content: "recalled" }], { spies }));
  const msgs = [{ role: "user", content: [{ type: "image", data: "b64" }] }];
  const out = await pipeline.inject(msgs as any);
  assert.deepEqual(out[0], msgs[0], "image-only turn untouched");
  assert.equal(spies.calls, 0, "no recall without a text channel");
});

test("T0 preferences block stays a PREFIX of a content-block user turn", async () => {
  const store: any = storeWith([]);
  store.listPreferences = async () => [{ key: "output.language", value: "Chinese", modified: "2026-08-25T00:00:00.000Z" }];
  const pipeline = new MemoryPipeline({
    store, retriever, domain: domain({ adapter: RAG_ADAPTER_FTS }),
    model: {} as any, streamFn: (() => ({})) as any, sessionId: "s1",
  });
  const out = await pipeline.inject([{ role: "user", content: [{ type: "text", text: "q" }] }] as any);
  const text = (out[0] as any).content[0].text as string;
  assert.ok(text.startsWith("<user_preferences"), "preferences stay the leading text");
  assert.ok(text.includes("q"), "user text preserved after the block");
});

test("string-shaped turns still behave exactly as before (both shapes supported)", async () => {
  const pipeline = pipelineWith({ adapter: RAG_ADAPTER_FTS }, storeWith([{ rowid: 1, role: "a", content: "recalled" }]));
  const out = await pipeline.inject([{ role: "user", content: "plain question" }] as any);
  assert.equal(typeof (out[0] as any).content, "string", "string stays a string");
  assert.ok((out[0] as any).content.startsWith("plain question"), "user text first");
  assert.ok((out[0] as any).content.includes("recalled"), "block appended");
});

test("an empty-string first user turn still receives the note block (no crash on empty text)", async () => {
  const pipeline = pipelineWith({ adapter: RAG_ADAPTER_NOTE, config: { note: "operator note" } }, storeWith([]));
  const out = await pipeline.inject([{ role: "user", content: "" }] as any);
  assert.equal((out[0] as any).content, "\n\n[RAG Context] operator note", "note still appends to an empty turn");
});

// Shipped domains are read from BOTH copies of the domain tree: repo-root
// domains/ and apps/mcp/domains/ (the latter is synced from the former at
// build time; this test also catches drift between them).
function shippedDomainFiles(): string[] {
  const root = fileURLToPath(new URL(".", import.meta.url));
  const dirs = [
    join(root, "..", "..", "..", "domains"),
    join(root, "..", "..", "..", "apps", "mcp", "domains"),
  ];
  const files: string[] = [];
  for (const dir of dirs) for (const f of readdirSync(dir)) if (f.endsWith(".toml")) files.push(join(dir, f));
  return files;
}

test("every shipped domain declares a known adapter (no accidental fail-open)", () => {
  const warnings: string[] = [];
  const registry = new RagAdapterRegistry({ store: storeWith([]), warn: (l) => warnings.push(l) });
  const files = shippedDomainFiles();
  assert.ok(files.length >= 6, "both shipped domain trees were read");
  for (const f of files) registry.resolve(loadDomainFromString(readFileSync(f, "utf8")) as any);
  assert.deepEqual(warnings, [], "no shipped domain triggers the unknown-adapter warning");
});

test("shipped domains resolve to no adapter today (all declare adapter=none)", () => {
  const registry = new RagAdapterRegistry({ store: storeWith([]), warn: () => {} });
  for (const f of shippedDomainFiles()) {
    const schema = loadDomainFromString(readFileSync(f, "utf8"));
    assert.equal(schema.rag.adapter, RAG_ADAPTER_NONE, f + " stays on adapter=none");
    assert.equal(registry.resolve(schema as any), null, f + " resolves to no adapter");
  }
});
