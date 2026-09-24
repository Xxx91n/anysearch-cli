// AnySearch provider adapter test — MCP-over-HTTP shape (R82 T1, C-13 RESHAPE).
// Mock-based: global fetch is stubbed and the REAL AnySearchProvider is driven
// through its public seam (search()). Covers: handshake sequence, Accept /
// MCP-Protocol-Version headers (incl. negotiated-version echo), markdown
// mapping, SSE-framed replies, isError, wrong-shape 200 (OmniRoute family),
// unexpected Content-Type, reply-id mismatch, /v1/search env tail
// normalization, max_results clamp=10, dead-port fail-open.
// ponytail: no test framework, assert-based demo (same style as pre-R82).

import { AnySearchProvider } from "../src/providers/anysearch";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return false; }
  passed++; return true;
}

type FetchCall = { url: string; method: string; headers: Record<string, string>; body: any };
type RespSpec = { status?: number; ct?: string; body?: string; headers?: Record<string, string> };

// apiKey="" keeps tests hermetic: the constructor never consults the real
// ANYSEARCH_API_KEY env var ("" is not nullish, and falsy → no Bearer header).
function installFetch(handler: (call: FetchCall) => RespSpec | Error) {
  const calls: FetchCall[] = [];
  const orig = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: any) => {
    const headers: Record<string, string> = {};
    const h = init?.headers ?? {};
    for (const k of Object.keys(h)) headers[k.toLowerCase()] = String(h[k]);
    const call: FetchCall = { url: String(input), method: init?.method ?? "GET", headers, body: init?.body ? JSON.parse(init.body) : undefined };
    calls.push(call);
    const r = handler(call);
    if (r instanceof Error) throw r;
    return new Response(r.body ?? "", { status: r.status ?? 200, headers: { "content-type": r.ct ?? "application/json", ...(r.headers ?? {}) } });
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = orig; } };
}

// A real server echoes the request id back — fixtures do the same (re-init
// retries send ids other than 1).
const OK_INIT = (id: unknown) => JSON.stringify({ jsonrpc: "2.0", id, result: { protocolVersion: "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "anysearch-mcp-server", version: "1.0.0" } } });
const MD = "## Search Results (2 results, 847ms)\n\n### 1. Cloudflare Workers - Global Serverless Functions Platform\n- **URL**: https://www.cloudflare.com/products/workers/\n- Deploy serverless functions globally in seconds.\n\n### 2. Workers docs\n- **URL**: https://developers.cloudflare.com/workers/\n- The developer docs site.";
const OK_CALL = (id: unknown) => JSON.stringify({ jsonrpc: "2.0", id, result: { _meta: { request_id: "req-test" }, content: [{ type: "text", text: MD }] } });

function stdHandler(call: FetchCall): RespSpec {
  if (call.body?.method === "initialize") return { body: OK_INIT(call.body.id) };
  if (call.body?.method === "notifications/initialized") return { status: 202, body: "" };
  if (call.body?.method === "tools/call") return { body: OK_CALL(call.body.id) };
  return { status: 500, body: "unexpected method " + call.body?.method };
}

const REQ = { query: "cloudflare workers", mode: "fast" as const };
const SIG = new AbortController().signal;

async function main() {
  // 1. happy path: handshake -> call, headers, mapping, elapsedMs
  {
    const f = installFetch(stdHandler);
    try {
      const p = new AnySearchProvider("", "https://api.anysearch.com/mcp");
      const env = await p.search(REQ, SIG);
      assert(f.calls.length === 3, "three POSTs (initialize+initialized+call), got " + f.calls.length);
      assert(f.calls[0].body.method === "initialize", "first call = initialize");
      assert(f.calls[1].body.method === "notifications/initialized", "second = notifications/initialized");
      assert(f.calls[1].body.id === undefined, "notification carries no id");
      assert(f.calls[2].body.method === "tools/call", "third = tools/call");
      assert(f.calls[2].body.params.name === "search", "tool name = search");
      assert(f.calls.every((c) => c.headers["accept"] === "application/json, text/event-stream"), "Accept double-type on every POST");
      assert(f.calls.every((c) => c.headers["mcp-protocol-version"] === "2025-11-25"), "MCP-Protocol-Version on every POST");
      assert(env.provider === "anysearch" && env.results.length === 2, "2 results mapped");
      assert(env.results[0].url === "https://www.cloudflare.com/products/workers/", "url mapped");
      assert(env.results[0].title.includes("Cloudflare Workers"), "title mapped");
      assert(env.results[0].snippet.includes("serverless functions globally"), "snippet mapped");
      assert(env.results[0].source === "anysearch", "source = anysearch");
      assert(env.elapsedMs === 847, "elapsedMs parsed from envelope header");
    } finally { f.restore(); }
  }

  // 2. SSE-framed tools/call reply parses identically
  {
    const sse = "event: message\ndata: " + OK_CALL(2).replace(/\n/g, "") + "\n\n";
    const f = installFetch((c) => c.body?.method === "tools/call" ? { ct: "text/event-stream", body: sse } : stdHandler(c));
    try {
      const p = new AnySearchProvider("", "https://api.anysearch.com/mcp");
      const env = await p.search(REQ, SIG);
      assert(env.results.length === 2 && env.results[1].url.includes("developers.cloudflare.com"), "SSE-framed reply mapped");
    } finally { f.restore(); }
  }

  // 3. isError:true → throw (arm degrade)
  {
    const bad = JSON.stringify({ jsonrpc: "2.0", id: 2, result: { content: [{ type: "text", text: "invalid_api_key" }], isError: true } });
    const f = installFetch((c) => c.body?.method === "tools/call" ? { body: bad } : stdHandler(c));
    try {
      const p = new AnySearchProvider("", "https://api.anysearch.com/mcp");
      let threw = false;
      try { await p.search(REQ, SIG); } catch (e) { threw = /isError/.test(String(e)); }
      assert(threw, "isError:true throws (invalid_api_key family)");
    } finally { f.restore(); }
  }

  // 4. wrong-shape 200 (OmniRoute enumeration family) → throw, never silent zero
  {
    const wrong = JSON.stringify({ object: "list", data: [{ id: "serper-search", object: "search_provider" }] });
    const f = installFetch((c) => c.body?.method === "tools/call" ? { body: wrong } : stdHandler(c));
    try {
      const p = new AnySearchProvider("", "https://api.anysearch.com/mcp");
      let threw = false;
      try { await p.search(REQ, SIG); } catch { threw = true; }
      assert(threw, "wrong-shape 200 throws (no silent zero results)");
    } finally { f.restore(); }
  }

  // 4b. JSON-RPC envelope but text without '## Search Results' header → throw
  {
    const noHeader = JSON.stringify({ jsonrpc: "2.0", id: 2, result: { content: [{ type: "text", text: "{\"object\":\"list\",\"data\":[]}" }] } });
    const f = installFetch((c) => c.body?.method === "tools/call" ? { body: noHeader } : stdHandler(c));
    try {
      const p = new AnySearchProvider("", "https://api.anysearch.com/mcp");
      let threw = false;
      try { await p.search(REQ, SIG); } catch (e) { threw = /malformed/.test(String(e)); }
      assert(threw, "non-envelope text throws malformed");
    } finally { f.restore(); }
  }

  // 4c. legit empty envelope (## Search Results (0 results,..)) → 0 results, NOT an error
  {
    const empty = JSON.stringify({ jsonrpc: "2.0", id: 2, result: { content: [{ type: "text", text: "## Search Results (0 results, 12ms)\n" }] } });
    const f = installFetch((c) => c.body?.method === "tools/call" ? { body: empty } : stdHandler(c));
    try {
      const p = new AnySearchProvider("", "https://api.anysearch.com/mcp");
      const env = await p.search(REQ, SIG);
      assert(env.results.length === 0 && env.elapsedMs === 12, "empty envelope → 0 results, no throw");
    } finally { f.restore(); }
  }

  // 5. unexpected Content-Type → throw
  {
    const f = installFetch((c) => c.body?.method === "tools/call" ? { ct: "text/html", body: "<html>nope</html>" } : stdHandler(c));
    try {
      const p = new AnySearchProvider("", "https://api.anysearch.com/mcp");
      let threw = false;
      try { await p.search(REQ, SIG); } catch (e) { threw = /Content-Type/.test(String(e)); }
      assert(threw, "unexpected Content-Type throws");
    } finally { f.restore(); }
  }

  // 6. JSON-RPC error field → throw
  {
    const errBody = JSON.stringify({ jsonrpc: "2.0", id: 2, error: { code: -32601, message: "Method not found" } });
    const f = installFetch((c) => c.body?.method === "tools/call" ? { body: errBody } : stdHandler(c));
    try {
      const p = new AnySearchProvider("", "https://api.anysearch.com/mcp");
      let threw = false;
      try { await p.search(REQ, SIG); } catch (e) { threw = /JSON-RPC error -32601/.test(String(e)); }
      assert(threw, "JSON-RPC error field raises");
    } finally { f.restore(); }
  }

  // 7. /v1/search env tail → normalized to base+/mcp
  {
    const f = installFetch(stdHandler);
    try {
      const p = new AnySearchProvider("", "https://api.anysearch.com/v1/search");
      await p.search(REQ, SIG);
      assert(f.calls.every((c) => c.url === "https://api.anysearch.com/mcp"), "/v1/search tail rewritten to /mcp");
    } finally { f.restore(); }
  }

  // 8. max_results silent clamp = 10
  {
    const f = installFetch(stdHandler);
    try {
      const p = new AnySearchProvider("", "https://api.anysearch.com/mcp");
      await p.search({ ...REQ, maxResults: 50 }, SIG);
      assert(f.calls[2].body.params.arguments.max_results === 10, "max_results clamped to 10");
    } finally { f.restore(); }
  }

  // 8b. mode param is never sent on the wire
  {
    const f = installFetch(stdHandler);
    try {
      const p = new AnySearchProvider("", "https://api.anysearch.com/mcp");
      await p.search({ ...REQ, mode: "answer" }, SIG);
      assert(!("mode" in f.calls[2].body.params.arguments), "no mode key on the wire (answer intent degrades)");
    } finally { f.restore(); }
  }

  // 9. dead-port injection → reject (fail-open arm degrade, install-smoke semantic)
  {
    const f = installFetch(() => new Error("connect ECONNREFUSED 127.0.0.1:9"));
    try {
      const p = new AnySearchProvider("", "http://127.0.0.1:9");
      let threw = false;
      try { await p.search(REQ, SIG); } catch { threw = true; }
      assert(threw, "dead-port endpoint rejects (arm degrades fail-open)");
    } finally { f.restore(); }
  }

  // 10. structuredContent preferred when present (forward-compat)
  {
    const sc = JSON.stringify({ jsonrpc: "2.0", id: 2, result: { structuredContent: { results: [{ title: "SC", url: "https://sc.example", snippet: "structured" }] }, content: [{ type: "text", text: MD }] } });
    const f = installFetch((c) => c.body?.method === "tools/call" ? { body: sc } : stdHandler(c));
    try {
      const p = new AnySearchProvider("", "https://api.anysearch.com/mcp");
      const env = await p.search(REQ, SIG);
      assert(env.results.length === 1 && env.results[0].title === "SC", "structuredContent wins over markdown");
    } finally { f.restore(); }
  }

  // 11. title-missing block still yields URL
  {
    const md2 = "## Search Results (1 results, 5ms)\n\n### 1. \n- **URL**: https://titleless.example/\n- snip";
    const b = JSON.stringify({ jsonrpc: "2.0", id: 2, result: { content: [{ type: "text", text: md2 }] } });
    const f = installFetch((c) => c.body?.method === "tools/call" ? { body: b } : stdHandler(c));
    try {
      const p = new AnySearchProvider("", "https://api.anysearch.com/mcp");
      const env = await p.search(REQ, SIG);
      assert(env.results[0]?.url === "https://titleless.example/", "titleless block still yields URL");
    } finally { f.restore(); }
  }

  // 11b. server-assigned MCP-Session-Id is echoed on subsequent POSTs
  {
    const f = installFetch((c) => c.body?.method === "initialize" ? { body: OK_INIT(c.body.id), headers: { "mcp-session-id": "sess-abc" } } : stdHandler(c));
    try {
      const p = new AnySearchProvider("", "https://api.anysearch.com/mcp");
      await p.search(REQ, SIG);
      assert(f.calls[1].headers["mcp-session-id"] === "sess-abc", "notification echoes session id");
      assert(f.calls[2].headers["mcp-session-id"] === "sess-abc", "tools/call echoes session id");
    } finally { f.restore(); }
  }

  // 11c. HTTP 404 on a session-id'd request → re-initialize + one retry (spec MUST)
  {
    let initCount = 0;
    const f = installFetch((c) => {
      if (c.body?.method === "initialize") { initCount++; return { body: OK_INIT(c.body.id), headers: { "mcp-session-id": "sess-" + initCount } }; }
      if (c.body?.method === "notifications/initialized") return { status: 202, body: "" };
      if (c.body?.method === "tools/call" && c.headers["mcp-session-id"] === "sess-1") return { status: 404, body: "gone" };
      if (c.body?.method === "tools/call") return { body: OK_CALL(c.body.id) };
      return { status: 500, body: "unexpected" };
    });
    try {
      const p = new AnySearchProvider("", "https://api.anysearch.com/mcp");
      const env = await p.search(REQ, SIG);
      assert(env.results.length === 2, "session-404 path still yields results");
      assert(initCount === 2, "re-initialized after session 404 (initCount=" + initCount + ")");
    } finally { f.restore(); }
  }

  // 11d. negotiated protocolVersion override is echoed on subsequent POSTs
  {
    const newer = JSON.stringify({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2026-07-28", capabilities: {}, serverInfo: { name: "x", version: "1" } } });
    const f = installFetch((c) => c.body?.method === "initialize" ? { body: newer } : stdHandler(c));
    try {
      const p = new AnySearchProvider("", "https://api.anysearch.com/mcp");
      await p.search(REQ, SIG);
      assert(f.calls[2].headers["mcp-protocol-version"] === "2026-07-28", "negotiated version echoed on tools/call (override, not the default)");
    } finally { f.restore(); }
  }

  // 11e. JSON reply with a mismatched id → throw (spec MUST: id echo)
  {
    const wrongId = JSON.stringify({ jsonrpc: "2.0", id: 99, result: { content: [{ type: "text", text: MD }] } });
    const f = installFetch((c) => c.body?.method === "tools/call" ? { body: wrongId } : stdHandler(c));
    try {
      const p = new AnySearchProvider("", "https://api.anysearch.com/mcp");
      let threw = false;
      try { await p.search(REQ, SIG); } catch (e) { threw = /id mismatch/.test(String(e)); }
      assert(threw, "mismatched JSON reply id throws");
    } finally { f.restore(); }
  }

  // 12. provider metadata (post-migration)
  {
    const p = new AnySearchProvider("", "https://api.anysearch.com/mcp");
    assert(p.id === "anysearch", "id = anysearch");
    assert(p.domainFilterSupported === false, "domainFilterSupported stays false (MCP domain is a vertical enum, not a host allowlist)");
    assert(!p.modes.includes("answer"), "modes still exclude answer");
    assert((await p.usage()) === undefined, "usage() stays undefined");
  }

  console.log("--- AnySearchProvider tests: " + passed + " passed, " + failed + " failed ---");
  if (failed > 0) process.exit(1);
}

await main();
export { }; // tsc: mark as module so top-level names do not collide across test files (check task, ADR-0028 D5)
