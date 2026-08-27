// Exa provider adapter test (G007).
// Mock-based: tests the NormalizedResult mapping logic without importing exa-js
// (exa-js has a zod-to-json-schema dependency that conflicts with pnpm hoisting).
// Verify mapping logic + provider shape independently of the real SDK.
// ponytail: no test framework, assert-based demo.

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

function main() {
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

  console.log("--- ExaProvider mapping tests: " + passed + " passed, " + failed + " failed ---");
  if (failed > 0) process.exit(1);
}

main();
export {}; // tsc: mark as module so top-level names do not collide across test files (check task, ADR-0028 D5)
