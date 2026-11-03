// RAG adapter layer tests (#35, decision #90).
// Acceptance criteria covered here:
//   1. adapter="fts" -> retrieved content enters the injection pipeline with a
//      provenance label (block header + structured RagRetrievalResult.label).
//   2. adapter="none" and the legacy "note" path are unchanged (regression).
//   3. unknown adapter id -> fail-open to none + a named stderr warning.
// Plus the fail-open edges: no store, retrieval throw, no hits, and the
// injection seam itself (Stage-1 on the first USER message, never stacking).
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

test("none: a configured note is NOT injected (adapter decides, not config presence)", async () => {
  const pipeline = pipelineWith({ adapter: RAG_ADAPTER_NONE, config: { note: "internal wiki" } }, storeWith([]));
  const out = await pipeline.inject([{ role: "user", content: "question" }] as any);
  assert.equal((out[0] as any).content, "question", "pre-#104 behavior required a truthy adapter");
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

// === injection seam: Stage-1, first USER message, no stacking ===

test("injection lands on the first USER message, never a leading system turn", async () => {
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
  assert.ok((out[1] as any).content.includes("recalled fact"), "RAG block on the first user turn");
  assert.ok(!(out[3] as any).content.includes("recalled fact"), "latest user turn untouched (Stage-1 only)");
});

test("the fts query is the first user turn's own text", async () => {
  const spies = { calls: 0, query: "", limit: 0 };
  const pipeline = pipelineWith({ adapter: RAG_ADAPTER_FTS }, storeWith([{ rowid: 1, role: "a", content: "c" }], { spies }));
  await pipeline.inject([{ role: "user", content: "how do I configure the proxy?" }] as any);
  assert.equal(spies.query, "how do I configure the proxy?", "recall keyed on the user question");
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

test("a non-string (content-block) first user turn is preserved, never rewritten", async () => {
  // Stage-1 is a text seam. Dropping a content-block user turn would silently
  // delete the user's message, so the adapter must stand down instead.
  const spies = { calls: 0, query: "", limit: 0 };
  const pipeline = pipelineWith({ adapter: RAG_ADAPTER_FTS }, storeWith([{ rowid: 1, role: "a", content: "recalled" }], { spies }));
  const blocks = [{ type: "text", text: "block-form question" }];
  const out = await pipeline.inject([{ role: "user", content: blocks }] as any);
  assert.deepEqual(out[0], { role: "user", content: blocks }, "content blocks untouched");
  assert.equal(spies.calls, 0, "no recall for a turn with no text slot");
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
