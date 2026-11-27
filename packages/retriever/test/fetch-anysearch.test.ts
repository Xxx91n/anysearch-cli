// #610: AnySearch's page-read arm. The real adapter runs against a stubbed
// global fetch, so these cases pin the MCP `extract` shape, the
// page/failure split, and the arm-vs-page fault split.

import {
  AnySearchFetchProvider,
  createAnySearchFetchProvider,
} from "../src/providers/anysearch-fetch";
import { AnySearchMcpClient } from "../src/providers/anysearch-mcp";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return false; }
  passed++; return true;
}

type FetchCall = { url: string; method: string; headers: Record<string, string>; body: any };
type RespSpec = { status?: number; ct?: string; body?: string; headers?: Record<string, string> };

function installFetch(handler: (call: FetchCall) => RespSpec) {
  const calls: FetchCall[] = [];
  const orig = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: any) => {
    const headers: Record<string, string> = {};
    const h = init?.headers ?? {};
    for (const k of Object.keys(h)) headers[k.toLowerCase()] = String(h[k]);
    const call: FetchCall = { url: String(input), method: init?.method ?? "GET", headers, body: init?.body ? JSON.parse(init.body) : undefined };
    calls.push(call);
    const r = handler(call);
    return new Response(r.body ?? "", { status: r.status ?? 200, headers: { "content-type": r.ct ?? "application/json", ...(r.headers ?? {}) } });
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = orig; } };
}

const OK_INIT = (id: unknown) => JSON.stringify({ jsonrpc: "2.0", id, result: { protocolVersion: "2025-11-25", capabilities: { tools: {} } } });
const extractReply = (id: unknown, structuredContent: unknown, isError = false) => JSON.stringify({
  jsonrpc: "2.0",
  id,
  result: { ...(isError ? { isError: true, content: [{ type: "text", text: String(structuredContent) }] } : { structuredContent }) },
});
const SIG = new AbortController().signal;

function standard(reply: (body: any) => RespSpec): (call: FetchCall) => RespSpec {
  return (call) => {
    if (call.body?.method === "initialize") return { body: OK_INIT(call.body.id) };
    if (call.body?.method === "notifications/initialized") return { status: 202, body: "" };
    if (call.body?.method === "tools/call") return reply(call.body);
    return { status: 500, body: "unexpected method " + call.body?.method };
  };
}

async function main() {
  // ---- one upstream call per URL, structured content becomes the page -----
  {
    const f = installFetch(standard((body) => ({
      body: extractReply(body.id, {
        url: body.params.arguments.url,
        title: "Page " + body.params.arguments.url,
        content: "body for " + body.params.arguments.url,
      }),
    })));
    try {
      const provider = new AnySearchFetchProvider(new AnySearchMcpClient("", "https://api.anysearch.com/mcp"));
      const envelope = await provider.fetch(
        { urls: ["https://example.com/a", "https://example.com/b"], maxCharacters: 100_000 },
        SIG,
      );
      const toolCalls = f.calls.filter((call) => call.body?.method === "tools/call");
      assert(toolCalls.length === 2, "one tools/call per URL");
      assert(toolCalls.every((call) => call.body.params.name === "extract"), "the tool is extract");
      assert(toolCalls[0]!.body.params.arguments.url === "https://example.com/a", "the argument is the bare URL");
      assert(Object.keys(toolCalls[0]!.body.params.arguments).length === 1, "no arguments beyond the URL");
      assert(envelope.provider === "anysearch", "provider id stays anysearch");
      assert(provider.maxUrlsPerCall === 1, "one URL per call");
      assert(envelope.pages.length === 2, "both URLs become pages");
      assert(envelope.pages[0]!.title === "Page https://example.com/a", "the title rides the page");
      assert(envelope.failures.length === 0, "no failures on a clean batch");
    } finally { f.restore(); }
  }

  // ---- an empty body is a retryable page failure --------------------------
  {
    const f = installFetch(standard((body) => ({
      body: extractReply(body.id, { url: body.params.arguments.url, content: "   " }),
    })));
    try {
      const provider = new AnySearchFetchProvider(new AnySearchMcpClient("", "https://api.anysearch.com/mcp"));
      const envelope = await provider.fetch({ urls: ["https://example.com/empty"], maxCharacters: 4000 }, SIG);
      assert(envelope.pages.length === 0 && envelope.failures.length === 1, "an empty body is a failure");
      assert(envelope.failures[0]!.retryable === true, "an empty body may be read by another arm");
      assert(envelope.failures[0]!.message === "该网址没有返回正文", "the plain message is used");
    } finally { f.restore(); }
  }

  // ---- an isError 404 stays a final page failure, not an arm fault --------
  {
    const f = installFetch(standard((body) => ({
      body: extractReply(body.id, "HTTP 404: not found", true),
    })));
    try {
      const provider = new AnySearchFetchProvider(new AnySearchMcpClient("", "https://api.anysearch.com/mcp"));
      const envelope = await provider.fetch({ urls: ["https://example.com/gone"], maxCharacters: 4000 }, SIG);
      assert(envelope.failures.length === 1, "the 404 becomes a failure");
      assert(envelope.failures[0]!.retryable === false, "a 404 is final");
    } finally { f.restore(); }
  }

  // ---- an unsupported format is page-level, not an arm fault --------------
  {
    const f = installFetch(standard((body) => ({
      body: extractReply(body.id, "Unsupported file type: application/pdf", true),
    })));
    try {
      const provider = new AnySearchFetchProvider(new AnySearchMcpClient("", "https://api.anysearch.com/mcp"));
      const envelope = await provider.fetch({ urls: ["https://example.com/paper.pdf"], maxCharacters: 4000 }, SIG);
      assert(envelope.failures.length === 1, "an unreadable format is a page failure");
      assert(envelope.failures[0]!.retryable === true, "the next arm may still read it");
      assert(envelope.failures[0]!.errorClass === "unknown", "it is not an arm-level class");
    } finally { f.restore(); }
  }

  // ---- one bad URL does not retire the arm (#610) -----------------------
  {
    const f = installFetch(standard((body) => ({
      body: extractReply(body.id, "HTTP 400 Bad Request", true),
    })));
    try {
      const provider = new AnySearchFetchProvider(new AnySearchMcpClient("", "https://api.anysearch.com/mcp"));
      const envelope = await provider.fetch({ urls: ["https://example.com/bad"], maxCharacters: 4000 }, SIG);
      assert(envelope.failures.length === 1, "a protocol-looking page reason stays a page failure");
      assert(envelope.failures[0]!.retryable === true, "the page moves to the next arm");
      assert(envelope.failures[0]!.errorClass === "permanent-protocol",
        "the class is kept, but it is not one that retires the arm");
    } finally { f.restore(); }
  }

  // ---- an isError quota reply is an arm-level failure, not a thrown page ----
  {
    let extracts = 0;
    const f = installFetch(standard((body) => {
      extracts++;
      return { body: extractReply(body.id, "Your daily quota exceeded, please sign up", true) };
    }));
    try {
      const provider = new AnySearchFetchProvider(new AnySearchMcpClient("", "https://api.anysearch.com/mcp"));
      const envelope = await provider.fetch(
        { urls: ["https://example.com/q", "https://example.com/q2"], maxCharacters: 4000 },
        SIG,
      );
      assert(envelope.failures.length === 1, "a quota reply becomes a failure, not a thrown call");
      assert(envelope.failures[0]!.errorClass === "quota-exhausted",
        "the shared classifier names the class, and the tool retires the arm on it");
      assert(envelope.failures[0]!.retryable === true, "the page itself may still be readable elsewhere");
      assert(extracts === 1, "a quota wall ends the batch instead of paying for every remaining URL");
    } finally { f.restore(); }
  }

  // ---- a quota reply split across text parts is still an arm fault -------
  {
    const quotaReply = (id: unknown) => JSON.stringify({
      jsonrpc: "2.0",
      id,
      result: { isError: true, content: [{ text: "今日额度已" }, { text: "用完，请稍后重试" }] },
    });
    const f = installFetch(standard((req) => ({ body: quotaReply(req.id) })));
    try {
      const provider = new AnySearchFetchProvider(new AnySearchMcpClient("", "https://api.anysearch.com/mcp"));
      const envelope = await provider.fetch({ urls: ["https://example.com/q"], maxCharacters: 4000 }, SIG);
      assert(envelope.failures[0]!.errorClass === "quota-exhausted",
        "the wording window does not cross a line break, so the parts are joined into one line");
    } finally { f.restore(); }
  }

  // ---- the anonymous wall is not a page -----------------------------------
  {
    const wall = "Your account and API key have been automatically generated. " +
      "Sign up to keep using extract after the daily allowance runs out.";
    const f = installFetch(standard((body) => ({
      body: JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { content: [{ text: wall }] } }),
    })));
    try {
      const provider = new AnySearchFetchProvider(new AnySearchMcpClient("", "https://api.anysearch.com/mcp"));
      const envelope = await provider.fetch({ urls: ["https://example.com/w"], maxCharacters: 4000 }, SIG);
      assert(envelope.pages.length === 0, "the wall text is not stored as a page body");
      assert(envelope.failures[0]!.errorClass === "free-quota-exhausted",
        "it is read as the free-quota wall, so the tool retires the arm");
    } finally { f.restore(); }
  }

  // ---- a text-only page that talks about 403 is still a page ---------------
  {
    const article = [
      "Troubleshooting 403 Forbidden and unauthorized responses.",
      "A 403 usually means the server refused the request; check the key quota.",
    ].join(" ");
    const f = installFetch(standard((body) => ({
      body: JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { content: [{ text: article }] } }),
    })));
    try {
      const provider = new AnySearchFetchProvider(new AnySearchMcpClient("", "https://api.anysearch.com/mcp"));
      const envelope = await provider.fetch({ urls: ["https://example.com/art"], maxCharacters: 4000 }, SIG);
      assert(envelope.pages.length === 1 && envelope.pages[0]!.text === article,
        "an article about 403 is a page, not an arm fault");
      assert(envelope.failures.length === 0, "and no failure is invented for it");
    } finally { f.restore(); }
  }

  // ---- a blank structured half falls back to the text half ----------------
  {
    const f = installFetch(standard((body) => ({
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: body.id,
        result: { structuredContent: { content: "   " }, content: [{ text: "real body" }] },
      }),
    })));
    try {
      const provider = new AnySearchFetchProvider(new AnySearchMcpClient("", "https://api.anysearch.com/mcp"));
      const envelope = await provider.fetch({ urls: ["https://example.com/b"], maxCharacters: 4000 }, SIG);
      assert(envelope.pages.length === 1 && envelope.pages[0]!.text === "real body",
        "an empty structured half does not throw away the text half");
    } finally { f.restore(); }
  }

  // ---- an arm fault later in the batch keeps the pages already read --------
  {
    let extracts = 0;
    const f = installFetch(standard((body) => {
      extracts++;
      return extracts === 1
        ? { body: extractReply(body.id, { url: body.params.arguments.url, content: "first body" }) }
        : { body: extractReply(body.id, "Your daily quota exceeded, please sign up", true) };
    }));
    try {
      const provider = new AnySearchFetchProvider(new AnySearchMcpClient("", "https://api.anysearch.com/mcp"));
      const envelope = await provider.fetch(
        { urls: ["https://example.com/a", "https://example.com/b"], maxCharacters: 4000 },
        SIG,
      );
      assert(envelope.pages.length === 1 && envelope.pages[0]!.text === "first body",
        "the page read before the arm fault is kept");
      assert(envelope.failures[0]!.errorClass === "quota-exhausted", "the arm fault still carries its class");
    } finally { f.restore(); }
  }

  // ---- a request that throws keeps the pages already read (#610) ---------
  {
    let extracts = 0;
    const f = installFetch(standard((body) => {
      extracts++;
      return extracts === 1
        ? { body: extractReply(body.id, { url: body.params.arguments.url, content: "kept body" }) }
        : { status: 500, body: "upstream exploded" };
    }));
    try {
      const provider = new AnySearchFetchProvider(new AnySearchMcpClient("", "https://api.anysearch.com/mcp"));
      const envelope = await provider.fetch(
        { urls: ["https://example.com/ok", "https://example.com/boom"], maxCharacters: 4000 },
        SIG,
      );
      assert(envelope.pages.length === 1 && envelope.pages[0]!.text === "kept body",
        "a thrown request does not take the pages already read with it");
      assert(envelope.failures.length === 1 && envelope.failures[0]!.url === "https://example.com/boom",
        "the URL whose request threw is reported");
      assert(envelope.failures[0]!.armFault === true,
        "it is marked as an arm fault, so the tool retires the arm");
    } finally { f.restore(); }
  }

  // ---- a URL that merely carries 404 in its path is not a gone page -------
  {
    const f = installFetch(standard((body) => ({
      body: extractReply(body.id, "Failed to fetch https://example.com/404-guide", true),
    })));
    try {
      const provider = new AnySearchFetchProvider(new AnySearchMcpClient("", "https://api.anysearch.com/mcp"));
      const envelope = await provider.fetch({ urls: ["https://example.com/404-guide"], maxCharacters: 4000 }, SIG);
      assert(envelope.failures[0]!.retryable === true, "a 404 inside a URL path is not a status code");
    } finally { f.restore(); }
  }

  // ---- an SSE stream with a junk frame still yields the page ----------------
  {
    const f = installFetch((call) => {
      if (call.body?.method === "initialize") return { body: OK_INIT(call.body.id) };
      if (call.body?.method === "notifications/initialized") return { status: 202, body: "" };
      const reply = JSON.stringify({
        jsonrpc: "2.0",
        id: call.body.id,
        result: { structuredContent: { url: call.body.params.arguments.url, content: "sse body" } },
      });
      return {
        ct: "text/event-stream",
        body: "event: message\ndata: keep-alive\n\nevent: message\ndata: " + reply + "\n\n",
      };
    });
    try {
      const provider = new AnySearchFetchProvider(new AnySearchMcpClient("", "https://api.anysearch.com/mcp"));
      const envelope = await provider.fetch({ urls: ["https://example.com/sse"], maxCharacters: 4000 }, SIG);
      assert(envelope.pages.length === 1 && envelope.pages[0]!.text === "sse body",
        "a non-JSON SSE frame is skipped, not treated as a dead arm");
    } finally { f.restore(); }
  }

  // ---- a reply with no text at all is protocol drift ----------------------
  {
    let calls = 0;
    const f = installFetch(standard((body) => {
      calls++;
      return calls === 1
        ? { body: extractReply(body.id, { url: body.params.arguments.url, content: "kept body" }) }
        : { body: JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { content: [] } }) };
    }));
    try {
      const provider = new AnySearchFetchProvider(new AnySearchMcpClient("", "https://api.anysearch.com/mcp"));
      const envelope = await provider.fetch(
        { urls: ["https://example.com/a", "https://example.com/b"], maxCharacters: 4000 },
        SIG,
      );
      assert(envelope.pages.length === 1 && envelope.pages[0]!.text === "kept body",
        "a reply with neither half does not throw away the page before it");
      assert(envelope.failures.length === 1 && envelope.failures[0]!.url === "https://example.com/b",
        "the URL whose reply was malformed is reported");
      assert(String(envelope.failures[0]!.message).includes("malformed"), "the message says malformed");
      assert(envelope.failures[0]!.armFault === true, "a malformed reply retires the arm for this run");
    } finally { f.restore(); }
  }

  // ---- a text-only reply still reads the page ---------------------------
  {
    const f = installFetch(standard((body) => ({
      body: JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { content: [{ text: "plain body" }] } }),
    })));
    try {
      const provider = new AnySearchFetchProvider(new AnySearchMcpClient("", "https://api.anysearch.com/mcp"));
      const envelope = await provider.fetch({ urls: ["https://example.com/t"], maxCharacters: 4000 }, SIG);
      assert(envelope.pages.length === 1 && envelope.pages[0]!.text === "plain body",
        "a reply that carries only the text half is still a page, not a dead arm");
      assert(envelope.failures.length === 0, "and no failure is invented for it");
    } finally { f.restore(); }
  }

  // ---- the tool's own deadline is not a cancellation ---------------------
  {
    const deadline = AbortSignal.timeout(1);
    let calls = 0;
    const client = {
      callTool: async () => {
        calls++;
        if (calls === 1) return { structuredContent: { url: "https://example.com/a", content: "first body" } };
        await new Promise((resolve) => setTimeout(resolve, 25));
        throw new Error("This operation was aborted");
      },
    } as unknown as AnySearchMcpClient;
    const provider = new AnySearchFetchProvider(client);
    const envelope = await provider.fetch(
      { urls: ["https://example.com/a", "https://example.com/b"], maxCharacters: 4000 },
      deadline,
    );
    assert(envelope.pages.length === 1 && envelope.pages[0]!.text === "first body",
      "the deadline keeps the pages already read");
    assert(envelope.failures.length === 1 && envelope.failures[0]!.errorClass === "transient",
      "a slow page is a transient page fault");
    assert(envelope.failures[0]!.armFault !== true,
      "a slow page does not retire the arm: the next chunk gets a fresh deadline");
  }

  // ---- the session-expired retry also covers extract ----------------------
  {
    let extracts = 0;
    const f = installFetch((call) => {
      if (call.body?.method === "initialize") {
        return { body: OK_INIT(call.body.id), headers: { "mcp-session-id": "s1" } };
      }
      if (call.body?.method === "notifications/initialized") return { status: 202, body: "" };
      extracts++;
      if (extracts === 1) return { status: 404, body: "session gone", headers: { "mcp-session-id": "s1" } };
      return { body: extractReply(call.body.id, { url: call.body.params.arguments.url, content: "after re-init" }) };
    });
    try {
      const provider = new AnySearchFetchProvider(new AnySearchMcpClient("", "https://api.anysearch.com/mcp"));
      const envelope = await provider.fetch({ urls: ["https://example.com/s"], maxCharacters: 4000 }, SIG);
      assert(extracts === 2, "the extract call is retried exactly once");
      assert(f.calls.filter((call) => call.body?.method === "initialize").length === 2, "the retry re-initializes");
      assert(envelope.pages[0]!.text === "after re-init", "the retried call still returns the page");
    } finally { f.restore(); }
  }

  // ---- the page is clipped to the requested window ------------------------
  {
    const f = installFetch(standard((body) => ({
      body: extractReply(body.id, { url: body.params.arguments.url, content: "x".repeat(40_000) }),
    })));
    try {
      const provider = new AnySearchFetchProvider(new AnySearchMcpClient("", "https://api.anysearch.com/mcp"));
      const envelope = await provider.fetch({ urls: ["https://example.com/long"], maxCharacters: 3000 }, SIG);
      assert(envelope.pages[0]!.text.length === 3000, "the page is clipped to maxCharacters");
    } finally { f.restore(); }
  }

  // ---- factory keeps the arm id and the one-URL cap ----------------------
  {
    const free = createAnySearchFetchProvider("", "https://api.anysearch.com/mcp");
    assert(free.id === "anysearch", "the factory builds the anysearch arm");
    assert(free.maxUrlsPerCall === 1, "the factory keeps the one-URL cap");
  }

  console.log("fetch-anysearch.test.ts: " + passed + " passed, " + failed + " failed");
  if (failed > 0) process.exit(1);
}

await main();
