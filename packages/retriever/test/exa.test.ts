// Exa provider adapter test (G007).
// Mock-based: mapping logic runs standalone, and the real ExaProvider is driven
// through its public seam with a stubbed SDK client (same pattern as
// tavily.test.ts) to assert #216 request-option forwarding without a network call.
// ponytail: no test framework, assert-based demo.

import { ExaProvider } from "../src/providers/exa";

// The mapping function extracted for testability: same logic as ExaProvider.search().
function mapExaResult(r: { title: string | null; url: string; text?: string; publishedDate?: string; score?: number }) {
  return {
    url: r.url,
    title: r.title ?? r.url,
    snippet: (r.text ?? "").slice(0, 500),
    source: "exa",
    publishedAt: r.publishedDate,
    extra: r.score ? { score: r.score } : undefined,
  };
}

// Mode mapping (same as exa.ts).
const MODE_TYPE: Record<string, string> = {
  fast: "fast",
  index: "auto",
  deep: "deep",
  answer: "auto",
};

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return false; }
  passed++; return true;
}

// SDK call recorder: captures every method's argument list so the trailing
// request-options argument can be inspected.
type SdkCall = { method: "search" | "answer"; args: any[] };
function mockExaClient(): { client: { search: (...args: any[]) => Promise<any>; answer: (...args: any[]) => Promise<any> }; calls: SdkCall[] } {
  const calls: SdkCall[] = [];
  return {
    calls,
    client: {
      search: async (...args: any[]) => {
        calls.push({ method: "search", args });
        return { results: [{ title: "S", url: "https://example.com/s", text: "body" }] };
      },
      answer: async (...args: any[]) => {
        calls.push({ method: "answer", args });
        return { answer: "A", citations: [] };
      },
    },
  };
}

async function main() {
  // 1. Mode mapping
  assert(MODE_TYPE["fast"] === "fast", "mode fast -> fast");
  assert(MODE_TYPE["index"] === "auto", "mode index -> auto");
  assert(MODE_TYPE["deep"] === "deep", "mode deep -> deep");
  assert(MODE_TYPE["answer"] === "auto", "mode answer -> auto");

  // 2. mapExaResult - full result with all fields
  const r0 = mapExaResult({
    title: "Exa Result 1",
    url: "https://example.com/exa1",
    score: 0.92,
    publishedDate: "2026-03-15",
    text: "Exa content snippet here",
  });
  assert(r0.url === "https://example.com/exa1", "url mapped");
  assert(r0.title === "Exa Result 1", "title mapped");
  assert(r0.snippet === "Exa content snippet here", "snippet from text");
  assert(r0.source === "exa", "source = exa");
  assert(r0.publishedAt === "2026-03-15", "publishedAt mapped");
  assert((r0.extra as any)?.score === 0.92, "extra.score preserved");

  // 3. mapExaResult - null title fallback to url
  const r1 = mapExaResult({
    title: null,
    url: "https://example.com/exa2",
    score: 0.75,
  });
  assert(r1.title === "https://example.com/exa2", "null title falls back to url");
  assert(r1.snippet === "", "empty snippet when no text");
  assert(r1.publishedAt === undefined, "no publishedAt when undefined");

  // 4. mapExaResult - no score (extra undefined)
  const r2 = mapExaResult({
    title: "No Score",
    url: "https://example.com/3",
    text: "content",
  });
  assert(r2.extra === undefined, "extra undefined when no score");
  assert((r2.extra as any)?.score === undefined, "no score in extra");

  // 5. mapExaResult - long text truncated to 500 chars
  const longText = "A".repeat(600);
  const r3 = mapExaResult({ title: "Long", url: "https://example.com/long", text: longText });
  assert(r3.snippet.length === 500, "long text truncated to 500 chars (got " + r3.snippet.length + ")");

  // 6. Bulk mapping (simulating search results array)
  const bulk = [
    { title: "A", url: "https://a.com", text: "a" },
    { title: "B", url: "https://b.com", text: "b", score: 0.5, publishedDate: "2026-01-01" },
    { title: null, url: "https://c.com" },
  ].map(mapExaResult);
  assert(bulk.length === 3, "bulk map produces 3 results");
  assert(bulk.every((r) => r.source === "exa"), "all have source = exa");
  assert(bulk[2].title === "https://c.com", "third result null title -> url");

  // 7. #216: the contract signal rides the trailing SDK request options.
  {
    const provider = new ExaProvider("test-key");
    const { client, calls } = mockExaClient();
    (provider as any).client = client;
    const ac = new AbortController();
    await provider.search({ query: "q", mode: "fast" }, ac.signal);
    const call = calls[0];
    assert(call.method === "search", "search() is the SDK call");
    assert(call.args.length === 3, "search() gets (query, options, requestOptions), got " + call.args.length);
    assert(call.args[2]?.signal === ac.signal, "search() request options carry the contract signal");
  }

  // 8. #216: an already-aborted signal is still forwarded, not swallowed.
  {
    const provider = new ExaProvider("test-key");
    const { client, calls } = mockExaClient();
    (provider as any).client = client;
    const ac = new AbortController();
    ac.abort();
    await provider.search({ query: "q", mode: "answer" }, ac.signal);
    assert(calls.length === 2, "answer mode calls search + answer, got " + calls.length);
    assert(calls[0].args[2]?.signal === ac.signal, "search() receives the aborted signal");
    assert(calls[0].args[2]?.signal.aborted === true, "search() signal is already aborted");
    assert(calls[1].method === "answer", "second SDK call is answer()");
    assert(calls[1].args[2]?.signal === ac.signal, "answer() receives the aborted signal");
    assert(calls[1].args[2]?.signal.aborted === true, "answer() signal is already aborted");
  }

  console.log("--- ExaProvider mapping tests: " + passed + " passed, " + failed + " failed ---");
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
export {}; // tsc: mark as module so top-level names do not collide across test files (check task)
