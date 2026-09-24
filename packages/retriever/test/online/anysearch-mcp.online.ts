// Live probe: real POST /mcp handshake + tools/call search against the public
// endpoint (R82 T1 — the CI watershed补课: provider live-search had zero CI
// surface). Runs ONLY under test:online (optional non-blocking CI job);
// the offline suite never reaches the network.
// Env semantics unchanged: ANYSEARCH_ENDPOINT / ANYSEARCH_API_KEY win when set
// (user config domain — the probe asserts whatever they point at).

import { AnySearchProvider } from "../../src/providers/anysearch";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return false; }
  passed++; return true;
}

async function main() {
  const p = new AnySearchProvider();
  const env = await p.search({ query: "cloudflare workers", mode: "fast", maxResults: 3 }, AbortSignal.timeout(30000));
  assert(env.provider === "anysearch", "provider id");
  assert(env.results.length >= 1, "live tools/call returns >=1 result");
  assert(typeof env.results[0]?.url === "string" && env.results[0].url.startsWith("http"), "result url shape");
  assert(typeof env.results[0]?.title === "string" && env.results[0].title.length > 0, "result title shape");
  assert(env.elapsedMs > 0, "elapsedMs positive");
  console.log("--- anysearch live probe: " + passed + " passed, " + failed + " failed (" + env.results.length + " results, " + env.elapsedMs + "ms server-side) ---");
  if (failed > 0) process.exit(1);
}

await main();
