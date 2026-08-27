// Tavily provider adapter test (G006).
// Mock-based: no real API call. Verifies NormalizedResult mapping.
// ponytail: no test framework, assert-based demo.

import { TavilyProvider } from "../src/providers/tavily";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return false; }
  passed++; return true;
}

async function main() {
  const provider = new TavilyProvider("test-key");

  // 1. Provider metadata
  assert(provider.id === "tavily", "provider id = tavily");
  assert(provider.modes.length === 4, "provider has 4 modes");
  assert(provider.modes.includes("deep"), "provider supports deep mode");
  assert(provider.modes.includes("answer"), "provider supports answer mode");

  // 2. search() with mock - override client.search to return controlled data
  const mockResponse = {
    query: "test query",
    results: [
      { title: "Result 1", url: "https://example.com/1", content: "Content of result 1", score: 0.95, publishedDate: "2026-01-01" },
      { title: "Result 2", url: "https://example.com/2", content: "Content of result 2", score: 0.80 },
    ],
    responseTime: 500,
    images: [],
    requestId: "test-req-1",
  };
  // Access the private client and stub its search method.
  (provider as any).client = {
    search: async () => mockResponse,
    extract: async () => ({} as any),
  };

  const envelope = await provider.search({ query: "test query", mode: "deep", maxResults: 5 }, new AbortController().signal);

  // 3. Verify ProviderEnvelope shape
  assert(envelope.provider === "tavily", "envelope provider = tavily");
  assert(envelope.results.length === 2, "envelope has 2 results");
  assert(typeof envelope.elapsedMs === "number", "envelope has elapsedMs");

  // 4. Verify NormalizedResult mapping
  const r0 = envelope.results[0];
  assert(r0.url === "https://example.com/1", "result 0 url mapped");
  assert(r0.title === "Result 1", "result 0 title mapped");
  assert(r0.snippet === "Content of result 1", "result 0 snippet mapped from content");
  assert(r0.source === "tavily", "result 0 source = tavily");
  assert(r0.publishedAt === "2026-01-01", "result 0 publishedAt mapped from publishedDate");
  assert((r0.extra as any)?.score === 0.95, "result 0 extra.score preserved");

  const r1 = envelope.results[1];
  assert(r1.publishedAt === undefined, "result 1 publishedAt undefined when not provided");

  // 5. answer mode includes answer
  const answerResponse = { ...mockResponse, answer: "This is the answer" };
  (provider as any).client.search = async () => answerResponse;
  const answerEnvelope = await provider.search({ query: "test", mode: "answer" }, new AbortController().signal);
  assert(answerEnvelope.answers!.length === 1, "answer mode returns 1 answer");
  assert(answerEnvelope.answers![0] === "This is the answer", "answer content correct");

  // 6. Empty results handling
  (provider as any).client.search = async () => ({ ...mockResponse, results: [] });
  const emptyEnvelope = await provider.search({ query: "empty", mode: "fast" }, new AbortController().signal);
  assert(emptyEnvelope.results.length === 0, "empty results handled");
  assert(emptyEnvelope.answers!.length === 0, "no answers when empty");

  // 7. usage() returns undefined (Tavily has no standalone usage API)
  const usage = await (provider as any).usage?.();
  assert(usage === undefined, "usage returns undefined");

  console.log("--- TavilyProvider tests: " + passed + " passed, " + failed + " failed ---");
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
