import { strict as assert } from "node:assert/strict";
import {
  KernelJsonSchemas
} from "../src/tool-json-schemas";
import {
  AnsChatInput,
  KernelToolSchemas,
  QueryKnowledgeInput,
  RecallMemoryInput,
  ResearchWebInput,
  SearchWebInput,
} from "../src/tool-schemas";

// 1. Registry shape: exactly the 5 ans_* tool names.
assert.deepEqual(
  Object.keys(KernelToolSchemas).sort(),
  ["ans_chat", "query_knowledge", "recall_memory", "research_web", "search_web"],
);
assert.deepEqual(
  Object.keys(KernelJsonSchemas).sort(),
  ["ans_chat", "query_knowledge", "recall_memory", "research_web", "search_web"],
);

// 2. Structural mirror check (D3 single-source): kernel JSON schemas are
// *derived* from TypeBox, not hand-written in parallel.
for (const name of Object.keys(KernelToolSchemas) as Array<keyof typeof KernelToolSchemas>) {
  const derivedFromTypeBox = JSON.parse(JSON.stringify(KernelToolSchemas[name]));
  assert.deepEqual(
    KernelJsonSchemas[name],
    derivedFromTypeBox,
    `KernelJsonSchemas.${name} must equal JSON round-trip of KernelToolSchemas.${name}`,
  );
}

// 3. Required markers (AJV-enforced business validation).
assert.ok(KernelJsonSchemas.search_web.required?.includes("query"));
assert.ok(KernelJsonSchemas.research_web.required?.includes("question"));
assert.ok(KernelJsonSchemas.recall_memory.required?.includes("query"));
assert.ok(KernelJsonSchemas.query_knowledge.required?.includes("query"));
assert.ok(KernelJsonSchemas.ans_chat.required?.includes("message"));

// 4. Keyword signatures — minLength on required strings.
assert.equal(KernelJsonSchemas.search_web.properties?.query?.minLength, 1);
assert.equal(KernelJsonSchemas.research_web.properties?.question?.minLength, 1);
assert.equal(KernelJsonSchemas.recall_memory.properties?.query?.minLength, 1);
assert.equal(KernelJsonSchemas.query_knowledge.properties?.query?.minLength, 1);
assert.equal(KernelJsonSchemas.ans_chat.properties?.message?.minLength, 1);

// 5. Enum-as-anyOf — research_web.depth has brief/standard/deep.
const depthEnum = KernelJsonSchemas.research_web.properties?.depth;
assert.ok(depthEnum?.anyOf);
assert.deepEqual(
  depthEnum.anyOf.map((x: { const: string }) => x.const).sort(),
  ["brief", "deep", "standard"],
);

// 6. Closed-object: additionalProperties: false on every tool (wire-level strict
// shape — AJV will reject unknown fields; matches ADR-0019 D3 envelope).
for (const name of Object.keys(KernelJsonSchemas) as Array<keyof typeof KernelJsonSchemas>) {
  assert.equal(KernelJsonSchemas[name].additionalProperties, false, `${name}.additionalProperties`);
}

// 7. Plain JSON: no TypeBox symbol tags survive the bridge.
assert.ok(!Object.getOwnPropertySymbols(KernelJsonSchemas.search_web).length);

// 8. Type surface truth (TypeBox source still governs TS types).
const sw: typeof SearchWebInput.static = { query: "x", mode: "fast" };
const rw: typeof ResearchWebInput.static = { question: "q", depth: "deep" };
const rm: typeof RecallMemoryInput.static = { query: "q", limit: 5 };
const qk: typeof QueryKnowledgeInput.static = { query: "q" };
const ac: typeof AnsChatInput.static = { message: "m" };
assert.equal(sw.mode, "fast");
assert.equal(rw.depth, "deep");
assert.equal(rm.limit, 5);
assert.equal(qk.query, "q");
assert.equal(ac.message, "m");

console.log("tool-schemas: 31 structural asserts OK");
