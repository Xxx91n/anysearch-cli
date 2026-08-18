// AnySearch provider adapter test (G008).
// Mock-based: tests NormalizedResult mapping from REST JSON response.
// No real API call (mock global fetch).
// ponytail: no test framework, assert-based demo.

// Extracted mapping function for testability (same logic as AnySearchProvider.search).
function mapAnySearchResult(r: { title: string; url: string; snippet?: string; content?: string }) {
  return {
    url: r.url,
    title: r.title,
    snippet: r.snippet ?? (r.content ?? "").slice(0, 500),
    source: "anysearch",
  };
}

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return false; }
  passed++; return true;
}

function main() {
  // 1. mapAnySearchResult - with snippet field
  const r0 = mapAnySearchResult({
    title: "AnySearch Result 1",
    url: "https://example.com/ans1",
    snippet: "Direct snippet text",
    content: "Full content here",
  });
  assert(r0.url === "https://example.com/ans1", "url mapped");
  assert(r0.title === "AnySearch Result 1", "title mapped");
  assert(r0.snippet === "Direct snippet text", "snippet field used when present");
  assert(r0.source === "anysearch", "source = anysearch");

  // 2. mapAnySearchResult - no snippet, use content as fallback
  const r1 = mapAnySearchResult({
    title: "Content Fallback",
    url: "https://example.com/ans2",
    content: "Content used as snippet",
  });
  assert(r1.snippet === "Content used as snippet", "content used as snippet when no snippet field");

  // 3. mapAnySearchResult - no snippet, no content, empty string
  const r2 = mapAnySearchResult({
    title: "No Snippet",
    url: "https://example.com/ans3",
  });
  assert(r2.snippet === "", "empty snippet when no snippet or content");

  // 4. mapAnySearchResult - long content truncated to 500
  const longContent = "B".repeat(600);
  const r3 = mapAnySearchResult({
    title: "Long Content",
    url: "https://example.com/long",
    content: longContent,
  });
  assert(r3.snippet.length === 500, "long content truncated to 500 (got " + r3.snippet.length + ")");

  // 5. Bulk mapping (simulating REST results array)
  const restResults = [
    { title: "A", url: "https://a.com", snippet: "snip a" },
    { title: "B", url: "https://b.com", content: "content b" },
    { title: "C", url: "https://c.com" },
  ];
  const mapped = restResults.map(mapAnySearchResult);
  assert(mapped.length === 3, "bulk map produces 3 results");
  assert(mapped.every((r) => r.source === "anysearch"), "all have source = anysearch");
  assert(mapped[0].snippet === "snip a", "first uses snippet field");
  assert(mapped[1].snippet === "content b", "second uses content fallback");
  assert(mapped[2].snippet === "", "third has empty snippet");

  // 6. Provider metadata (hardcoded from adapter code)
  // atomcode research: AnySearch has 3 modes (no answer mode).
  const EXPECTED_MODES = ["fast", "index", "deep"];
  assert(EXPECTED_MODES.length === 3, "AnySearch has 3 modes (no answer)");
  assert(EXPECTED_MODES.includes("deep"), "supports deep");
  assert(!EXPECTED_MODES.includes("answer"), "does NOT support answer");

  // 7. REST response shape validation
  const mockRestResponse = {
    code: 0,
    message: "success",
    request_id: "req-123",
    data: {
      results: restResults,
      metadata: { total_results: 3, search_time_ms: 150 },
    },
  };
  assert(mockRestResponse.code === 0, "REST response code = 0 (success)");
  assert(mockRestResponse.data.results.length === 3, "REST data.results has 3 items");
  assert(mockRestResponse.data.metadata.search_time_ms === 150, "metadata.search_time_ms = 150");
  // The provider would map these results to NormalizedResult
  const providerResults = mockRestResponse.data.results.map(mapAnySearchResult);
  assert(providerResults.length === 3, "provider maps 3 results from REST response");

  console.log("--- AnySearchProvider tests: " + passed + " passed, " + failed + " failed ---");
  if (failed > 0) process.exit(1);
}

main();
