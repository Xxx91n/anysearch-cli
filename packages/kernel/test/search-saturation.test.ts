// Regression (r19 T2, r18 seal-0 finding): the ans agent loop had no stop
// condition besides the wall-clock timeout — on adversarial questions the model
// kept issuing searches (46–62 per question in r18) until the budget ran out.
// Contract: once searches stop yielding new URLs (or a hard call cap is reached),
// further `search` calls are blocked with a reason that tells the model to answer
// from the evidence it has; the run then completes normally.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createFauxCore, fauxAssistantMessage, fauxToolCall, fauxText } from "@earendil-works/pi-ai";
import { PiAgentRuntime, SearchSaturation, SEARCH_SATURATION_DEFAULTS } from "../src/pi-runtime";
import type { DomainConfigPort, RetrieverPort, Query } from "../src/ports";

const domain: DomainConfigPort = {
  sources: { enabled: [] }, prompts: [], skills: { active: ["search"] }, hooks: { toolWhitelist: ["search"] }, rag: { adapter: "none" },
};

test("SearchSaturation: stops after consecutive searches with no new URLs", () => {
  const s = new SearchSaturation();
  assert.equal(s.exhausted(), false);
  s.record(["a", "b"]); assert.equal(s.exhausted(), false);
  s.record(["a"]); assert.equal(s.exhausted(), false);          // 1 search with nothing new
  s.record(["b", "a"]); assert.equal(s.exhausted(), true);      // 2 in a row -> saturated
  assert.match(s.reason(), /no new results/);
});

test("SearchSaturation: new URLs reset the streak; hard cap still applies", () => {
  const s = new SearchSaturation({ maxCalls: 4, maxNoNewStreak: 2 });
  s.record(["a"]); s.record(["a"]); s.record(["b"]);            // streak reset by b
  assert.equal(s.exhausted(), false);
  s.record(["c"]);                                              // 4th call -> cap
  assert.equal(s.exhausted(), true);
  assert.match(s.reason(), /limit/);
});

test("defaults are sane", () => {
  assert.ok(SEARCH_SATURATION_DEFAULTS.maxCalls >= 6 && SEARCH_SATURATION_DEFAULTS.maxCalls <= 20);
  assert.equal(SEARCH_SATURATION_DEFAULTS.maxNoNewStreak, 2);
});

test("agent loop: a model that keeps searching stale results is stopped and still answers", async () => {
  let calls = 0;
  const retriever: RetrieverPort = {
    async search(q: Query) {
      calls++;
      return { query: q.query, mode: "fast", results: [
        { url: "https://example.com/1", title: "R1", snippet: "S1", source: "tavily", score: 1 },
        { url: "https://example.com/2", title: "R2", snippet: "S2", source: "exa", score: 0.9 },
      ], answers: [], metadata: { providersQueried: [], providersFailed: [], providersCancelled: [], elapsedMs: 1 } } as any;
    },
  };
  const faux = createFauxCore({ provider: "faux", models: [{ id: "faux-1" }] });
  let turns = 0;
  faux.setResponses(Array.from({ length: 40 }, () => (ctx: any) => {
    turns++;
    const last = ctx.messages[ctx.messages.length - 1];
    const lastText = JSON.stringify(last?.content ?? "");
    // Answer once the loop tells us to stop, or give up after 30 turns (pre-fix behaviour).
    if (/no new results|search limit/i.test(lastText) || turns > 30) return fauxAssistantMessage(fauxText("final answer"));
    return fauxAssistantMessage(fauxToolCall("search", { query: "same question " + turns }), { stopReason: "toolUse" });
  }));
  const runtime = new PiAgentRuntime({ retriever, domain, model: faux.getModel(), streamFn: faux.streamSimple });
  let text = "";
  for await (const ev of runtime.run("adversarial question")) if (ev.type === "text") text += ev.content;
  assert.ok(calls <= 3, "searches executed before saturation stop: " + calls);
  assert.match(text, /final answer/);
});
