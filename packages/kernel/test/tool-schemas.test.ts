import { strict as assert } from "node:assert/strict";
import { Value } from "@sinclair/typebox/value";
import {
  KernelJsonSchemas
} from "../src/tool-json-schemas";
// KernelJsonSchemas is Record<string, JsonSchema-ish>; the declared value type stays {} for
// wire-purity in the bridge. Tests need property access — alias once to a loose shape (noise fix).
const KS = (KernelJsonSchemas) as unknown as Record<string, {
  required?: string[];
  additionalProperties?: boolean;
  properties?: Record<string, { minLength?: number; maxLength?: number; pattern?: string; anyOf?: Array<{ const: string }> }>;
}>;
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
  Object.keys(KS).sort(),
  ["ans_chat", "query_knowledge", "recall_memory", "research_web", "search_web"],
);

// 2. Structural mirror check (D3 single-source): kernel JSON schemas are
// *derived* from TypeBox, not hand-written in parallel.
for (const name of Object.keys(KernelToolSchemas) as Array<keyof typeof KernelToolSchemas>) {
  const derivedFromTypeBox = JSON.parse(JSON.stringify(KernelToolSchemas[name]));
  assert.deepEqual(
    KS[name],
    derivedFromTypeBox,
    `KS.${name} must equal JSON round-trip of KernelToolSchemas.${name}`,
  );
}

// 3. Required markers (AJV-enforced business validation).
assert.ok(KS.search_web.required?.includes("query"));
assert.ok(KS.research_web.required?.includes("question"));
assert.ok(KS.recall_memory.required?.includes("query"));
assert.ok(KS.query_knowledge.required?.includes("query"));
assert.ok(KS.ans_chat.required?.includes("message"));

// 4. Keyword signatures — minLength on required strings.
assert.equal(KS.search_web.properties?.query?.minLength, 1);
assert.equal(KS.research_web.properties?.question?.minLength, 1);
assert.equal(KS.recall_memory.properties?.query?.minLength, 1);
assert.equal(KS.query_knowledge.properties?.query?.minLength, 1);
assert.equal(KS.ans_chat.properties?.message?.minLength, 1);

// 4b. #132 explicit session handle: optional. The wire schema stays permissive
// on purpose — a malformed handle must fail open in the handler (no memory,
// call still answers), so apps/mcp enforces the 1..128 visible-ASCII rule at
// the DB-key boundary instead of AJV rejecting the call here.
assert.ok(
  !KS.ans_chat.required?.includes("sessionId"),
  "ans_chat: sessionId is optional (omitting it means single-shot)",
);
assert.equal(KS.ans_chat.properties?.sessionId?.minLength, undefined);
assert.equal(KS.ans_chat.properties?.sessionId?.maxLength, undefined);
assert.equal(KS.ans_chat.properties?.sessionId?.pattern, undefined);
assert.equal(Value.Check(AnsChatInput, { message: "m", sessionId: "abc-123" }), true,
  "ans_chat accepts a valid session handle");
assert.equal(Value.Check(AnsChatInput, { message: "m", sessionId: "bad handle" }), true,
  "ans_chat passes a malformed handle through (fail-open contract)");
assert.equal(Value.Check(AnsChatInput, { message: "m", sessionId: "x".repeat(129) }), true,
  "ans_chat passes an over-long handle through (fail-open contract)");
assert.equal(Value.Check(AnsChatInput, { message: "m", sessionId: "" }), true,
  "ans_chat passes an empty handle through (fail-open contract)");
assert.equal(Value.Check(AnsChatInput, { message: "m", sessionId: 42 }), false,
  "ans_chat rejects a non-string session handle");

// 5. Enum-as-anyOf — research_web.depth has brief/standard/deep.
const depthEnum = KS.research_web.properties?.depth;
assert.ok(depthEnum?.anyOf);
assert.deepEqual(
  depthEnum.anyOf.map((x: { const: string }) => x.const).sort(),
  ["brief", "deep", "standard"],
);

// 6. Closed-object: additionalProperties: false on every tool (wire-level strict
// shape — AJV will reject unknown fields; matches envelope).
for (const name of Object.keys(KS) as Array<keyof typeof KS>) {
  assert.equal(KS[name].additionalProperties, false, `${name}.additionalProperties`);
}

// 7. Plain JSON: no TypeBox symbol tags survive the bridge.
assert.ok(!Object.getOwnPropertySymbols(KS.search_web).length);

// 8. Type surface truth (TypeBox source still governs TS types).
const sw: typeof SearchWebInput.static = { query: "x", mode: "fast" };
const rw: typeof ResearchWebInput.static = { question: "q", depth: "deep" };
const rm: typeof RecallMemoryInput.static = { query: "q", limit: 5 };
const qk: typeof QueryKnowledgeInput.static = { query: "q" };
const ac: typeof AnsChatInput.static = { message: "m" };
const acThreaded: typeof AnsChatInput.static = { message: "m", sessionId: "abc-123" };
assert.equal(sw.mode, "fast");
assert.equal(rw.depth, "deep");
assert.equal(rm.limit, 5);
assert.equal(qk.query, "q");
assert.equal(ac.message, "m");
assert.equal(acThreaded.sessionId, "abc-123");

// 9.: maxResults contract rejection — the key is not
// in the schema and additionalProperties:false makes the check hard-fail.
// Exposing it is a feature decision; this assert is the CI counterpart so a
// schema-entropy regression cannot silently reopen the surface.
assert.equal(Value.Check(SearchWebInput, { query: "x" }), true, "search_web accepts minimal input");
assert.equal(
  Value.Check(SearchWebInput, { query: "x", maxResults: 5 }),
  false,
  "search_web rejects maxResults key (additionalProperties:false)",
);

// 10. / ⑤: Static inference must equal the declared
// aliases — naming consistency between the schema and its TS surface is
// enforced at the tsc level (mutual assignability, both directions).
type StaticEq<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const _searchWebStaticEq: StaticEq<typeof SearchWebInput.static, SearchWebInput> = true;
const _researchWebStaticEq: StaticEq<typeof ResearchWebInput.static, ResearchWebInput> = true;
void _searchWebStaticEq;
void _researchWebStaticEq;

console.log("tool-schemas: 33 structural asserts OK");
