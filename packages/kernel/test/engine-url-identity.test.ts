// #606: search dedup reads the shared URL identity, while display keeps the
// provider's full link.
import assert from "node:assert/strict";
import { test } from "node:test";
import { RetroaererdEngine } from "../src/engine";
import type { SearchProvider, SearchRequest, NormalizedResult, ProviderEnvelope } from "@anysearch-cli/retriever";

function provider(id: string, urls: string[]): SearchProvider {
  return {
    id,
    modes: ["fast"],
    async search(_req: SearchRequest): Promise<ProviderEnvelope> {
      const results: NormalizedResult[] = urls.map((url) => ({
        url,
        title: id,
        snippet: "snippet",
        source: id,
      }));
      return { provider: id, results, answers: [], elapsedMs: 1 };
    },
  };
}

test("three spellings of one page collapse to one result with a readable display link", async () => {
  const engine = new RetroaererdEngine([
    provider("p1", [
      "https://example.com/x",
      "example.com/x",
      "example.com.:443/x?utm_source=a#frag",
    ]),
  ]);
  const envelope = await engine.search({ query: "identity", mode: "fast", includeSourceUrls: true });

  assert.equal(envelope.results.length, 1, "one identity means one result");
  assert.equal(envelope.results[0]?.url, "example.com/x", "the archive key is the identity");
  assert.equal(
    envelope.results[0]?.extra?.sourceUrl,
    "https://example.com/x",
    "display keeps the scheme the provider gave",
  );
});
