// Tool Schema Registry test (ADR-0019 D4 layer-1).
// Verifies both the TypeBox schemas reject malformed inputs via structural introspection,
// and the plain JSON Schema counterparts explicitly reject via AJV-style keyword semantics.
// ponytail: structural assertion in kernel; AJV runtime check is at apps/mcp layer.

import {
  KernelToolSchemas,
  SearchWebInput,
  ResearchWebInput,
  AnsChatInput,
} from "../src/tool-schemas";
import { KernelJsonSchemas } from "../src/tool-json-schemas";

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error("FAIL: " + msg);
  }
}

// 1. All 5 tool names are present in the registry.
const expected = ["search_web", "research_web", "recall_memory", "query_knowledge", "ans_chat"];
for (const name of expected) {
  assert(name in KernelToolSchemas, "registry contains " + name);
  assert(name in KernelJsonSchemas, "plain JSON registry contains " + name);
}

// 2. search_web: query is required with minLength 1 (AJV rejects empty string).
const searchProps = (SearchWebInput as { properties?: Record<string, unknown> }).properties ?? {};
const searchRequired = (SearchWebInput as { required?: string[] }).required ?? [];
assert(searchRequired.includes("query"), "search_web requires query");
const querySchema = searchProps["query"] as { minLength?: number };
assert(querySchema.minLength === 1, "search_web query has minLength=1 (rejects empty)");

// 3. research_web: depth enum restricted to brief/standard/deep via Union of Literals.
const depthProp = (ResearchWebInput as { properties?: Record<string, unknown> }).properties?.["depth"] ?? {};
const depthSchema = (depthProp as { anyOf?: Array<{ const?: string }> }).anyOf ?? [];
const depthValues = depthSchema.map((v) => v.const).sort();
assert(
  JSON.stringify(depthValues) === JSON.stringify(["brief", "deep", "standard"]),
  "research_web depth is enum[brief,standard,deep] (got " + JSON.stringify(depthValues) + ")"
);

// 4. ans_chat: message required.
const ansRequired = (AnsChatInput as { required?: string[] }).required ?? [];
assert(ansRequired.includes("message"), "ans_chat requires message");

// 5. Plain JSON schemas required/property shape matches TypeBox contracts.
for (const name of expected) {
  const s = KernelJsonSchemas[name as keyof typeof KernelJsonSchemas] as { type?: string; required?: string[]; properties?: Record<string, unknown> };
  assert(s.type === "object", name + " plain JSON is type=object");
  assert(Array.isArray(s.required) && s.required.length >= 1, name + " plain JSON has required");
  assert(Boolean(s.properties), name + " plain JSON has properties");
}

// 6. Plain JSON schemas carry keyword semantics AJV would reject on (minLength/enum).
const pjSearchQuery = (KernelJsonSchemas.search_web.properties as Record<string, unknown>).query as Record<string, unknown>;
assert(pjSearchQuery.minLength === 1, "plain search_web query minLength=1");
const pjDepth = KernelJsonSchemas.research_web.properties?.depth as Record<string, unknown>;
assert(Array.isArray((pjDepth as { anyOf?: unknown[] }).anyOf), "plain research_web depth has enum-as-anyOf");

console.log("--- kernel tool-schemas tests: " + passed + " passed, " + failed + " failed ---");
if (failed > 0) process.exit(1);
