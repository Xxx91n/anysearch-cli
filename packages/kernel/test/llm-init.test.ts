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
ok(s.apiKey === undefined, "kernel never mirrors provider env into the session (ADR-0038 step 7; pi-ai owns provider auth)");


// --- ADR-0037 D4: explicit endpoint kind, three wire protocols against local stubs ---
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { LlmEndpointKind } from "../src/llm-init";

function sseBody(kind: LlmEndpointKind): string {
  if (kind === "chat") return [
    'data: {"id":"c1","object":"chat.completion.chunk","created":1,"model":"stub-model","choices":[{"index":0,"delta":{"role":"assistant","content":"hi"},"finish_reason":null}]}',
    '',
    'data: {"id":"c1","object":"chat.completion.chunk","created":1,"model":"stub-model","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
    '',
    'data: [DONE]',
    ''].join("\n") + "\n";
  if (kind === "messages") return [
    'event: message_start',
    'data: {"type":"message_start","message":{"id":"m1","type":"message","role":"assistant","content":[],"model":"stub-model","stop_reason":null,"usage":{"input_tokens":1,"output_tokens":1}}}',
    '',
    'event: content_block_start',
    'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
    '',
    'event: content_block_delta',
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hi"}}',
    '',
    'event: content_block_stop',
    'data: {"type":"content_block_stop","index":0}',
    '',
    'event: message_delta',
    'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}',
    '',
    'event: message_stop',
    'data: {"type":"message_stop"}',
    ''].join("\n") + "\n";
  // The openai SDK 6.x validates event payloads: a response.completed event is only
  // delivered when the response object carries the full required-field set, and the final
  // SSE entry must be flushed by a trailing blank line.
  return [
    'event: response.created',
    'data: {"type":"response.created","response":{"id":"r1","object":"response","status":"in_progress","output":[]}}',
    '',
    'event: response.output_item.added',
    'data: {"type":"response.output_item.added","output_index":0,"item":{"type":"message","id":"m1","status":"in_progress","role":"assistant","content":[]}}',
    '',
    'event: response.output_text.delta',
    'data: {"type":"response.output_text.delta","item_id":"m1","output_index":0,"content_index":0,"delta":"hi"}',
    '',
    'event: response.output_item.done',
    'data: {"type":"response.output_item.done","output_index":0,"item":{"type":"message","id":"m1","status":"completed","role":"assistant","content":[{"type":"output_text","text":"hi","annotations":[]}]}}',
    '',
    'event: response.completed',
    'data: {"type":"response.completed","response":{"id":"r1","object":"response","status":"completed","created_at":1,"model":"stub-model","output":[{"type":"message","id":"m1","status":"completed","role":"assistant","content":[{"type":"output_text","text":"hi","annotations":[]}]}],"parallel_tool_calls":true,"tool_choice":"auto","tools":[],"metadata":{},"temperature":null,"top_p":null,"max_output_tokens":null,"reasoning":null,"text":null,"truncation":"disabled","usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2},"instructions":null,"background":false,"service_tier":"auto"}}',
    ''].join("\n") + "\n";
}

process.env.ANS_LLM_API_KEY = "test-key";

// pi-ai delegates to the official SDKs: the openai SDK appends "chat/completions" / "responses"
// to baseURL (so baseUrl must already include /v1), while the anthropic SDK appends
// "/v1/messages" itself (so baseUrl must be the host root without /v1). ADR-0037 D4.
const endpointConfig: Record<LlmEndpointKind, { basePath: string; expectedPath: string }> = {
  chat: { basePath: "/v1", expectedPath: "/v1/chat/completions" },
  messages: { basePath: "", expectedPath: "/v1/messages" },
  responses: { basePath: "/v1", expectedPath: "/v1/responses" },
};

let threw3 = false;
try { await createLlmSession({ provider: "stub", model: "stub-model", baseUrl: "http://127.0.0.1:1/v1" }); }
catch (e: any) { threw3 = /api kind|explicit/.test(String(e?.message)); }
ok(threw3, "baseUrl without api kind throws (no protocol sniffing)");

for (const kind of ["chat", "messages", "responses"] as LlmEndpointKind[]) {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    ok(req.url === endpointConfig[kind].expectedPath, kind + " protocol hits " + endpointConfig[kind].expectedPath + " (got " + req.url + ")");
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.end(sseBody(kind));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as { port: number }).port;
  try {
    const ses = await createLlmSession({ provider: "stub-api", model: "stub-model", baseUrl: "http://127.0.0.1:" + port + endpointConfig[kind].basePath, api: kind });
    const stream = ses.streamFn(ses.model, { messages: [{ role: "user", content: "hi" }] } as never, { apiKey: "test-key" } as never);
    let sawText = false;
    for await (const ev of stream) {
      const t = (ev as any).type === "text_delta" ? (ev as any).delta : (ev as any).type === "text" ? (ev as any).content : "";
      if (typeof t === "string" && t.includes("hi")) sawText = true;
    }
    const final = await (stream as any).result?.();
    const finalText = JSON.stringify(final ?? {});
    ok(sawText || finalText.includes("hi"), kind + " endpoint round-trip returns stub content");
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

console.log("llm-init tests: " + passed + " passed, endpoints OK");
