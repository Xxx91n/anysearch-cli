// ponytail: no test framework, assert-based demo for ADR-0017 D2/D3 llm-init.
// Covers the branch logic introduced in c0f4a42c: unknown provider, missing model,
// env-key failure contamination (D3 spec: no cache poisoning on failure).
import { strict as assert } from "node:assert";
import { createLlmSession, PROVIDER_FACTORIES, PROVIDER_NAMES, MODELS, API_KEYS } from "../src/llm-init";

let passed = 0;
function ok(cond: boolean, msg: string) { if (!cond) { console.error("FAIL: " + msg); process.exit(1); } passed++; }

// Single source of truth: PROVIDER_NAMES derived from PROVIDER_FACTORIES keys, no drift.
ok(PROVIDER_NAMES.length === 3, "PROVIDER_NAMES has 3 providers");
ok(PROVIDER_NAMES.includes("openai") && PROVIDER_NAMES.includes("anthropic") && PROVIDER_NAMES.includes("google"), "PROVIDER_NAMES covers all PROVIDER_FACTORIES keys");
ok(Object.keys(PROVIDER_FACTORIES).length === PROVIDER_NAMES.length, "factories/names same cardinality");
ok(PROVIDER_NAMES.every(n => typeof PROVIDER_FACTORIES[n] === "function"), "every name has a factory");
// Catalog aligned: every PROVIDER_NAMES entry has a MODELS list and an API_KEYS entry.
ok(PROVIDER_NAMES.every(n => Array.isArray(MODELS[n]) && MODELS[n].length > 0), "every provider has a model list");
ok(PROVIDER_NAMES.every(n => typeof API_KEYS[n] === "string"), "every provider has an API key env name");

// D3 env-key failure isolation: unknown provider throws, no state cached, retry clean.
let threw = false;
try { await createLlmSession({ provider: "not-a-provider" as any, model: "x" }); }
catch (e: any) { threw = true; ok(e.message.includes("not-a-provider"), "unknown provider error names the provider"); }
ok(threw, "unknown provider throws");

let threw2 = false;
try { await createLlmSession({ provider: "openai", model: "this-model-does-not-exist" }); }
catch (e: any) { threw2 = true; ok(e.message.includes("not found"), "missing model error says 'not found'"); }
ok(threw2, "missing model throws");

// Retry after failure succeeds — no cache poisoning (ADR-0017 D3 spec).
const s = await createLlmSession({ provider: "openai", model: "gpt-5" });
ok(s.providerName === "openai" && s.modelName === "gpt-5", "session identity correct");
ok(typeof s.streamFn === "function", "streamFn bound");
ok(s.models && typeof s.models.getModel === "function", "models registry returned");
if (process.env.OPENAI_API_KEY) ok(s.apiKey === process.env.OPENAI_API_KEY, "apiKey mirrors OPENAI_API_KEY env"); else ok(s.apiKey === undefined, "apiKey undefined without env (pi-ai fallback path)");

console.log(`llm-init tests: ${passed} passed`);
