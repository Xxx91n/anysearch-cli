// R86 T2 / D-003 P0: AnySearch provider direct-call forensic probe.
// Calls `new AnySearchProvider().search()` once and prints ONE structured
// evidence line — on failure it records the error NAME + truncated message +
// classified lane (the long-term fixture repairing "flag without error text"
// at the forensic layer). Run:
//   node --import tsx scripts/probe-anysearch-provider.ts
//   ANS_PROBE_QUERY="..." node --import tsx scripts/probe-anysearch-provider.ts
// Red lines: ANYSEARCH_ENDPOINT / ANYSEARCH_API_KEY values are NEVER printed —
// only presence classes (endpointSource/keyPresent); occurrences of the
// configured values inside an error message are masked <endpoint>/<key>.
// Exit codes: 0 = arm alive (results returned); 2 = arm failed (class emitted).

import { AnySearchProvider } from "../packages/retriever/src/providers/anysearch";
import { classifyProviderError } from "../packages/retriever/src/contract";

// Probe overrides (P1 env/key/endpoint separation):
//   --default-endpoint  force the baked-in public endpoint (env ignored)
//   --nokey             anonymous call (env key suppressed)
const ARGS = process.argv.slice(2);
const QUERY = process.env.ANS_PROBE_QUERY ?? "cloudflare workers";
const FORCE_DEFAULT = ARGS.includes("--default-endpoint");
const NO_KEY = ARGS.includes("--nokey");
const PUBLIC_ENDPOINT = "https://api.anysearch.com/mcp";

function scrub(s: string): string {
  let t = s;
  const ep = process.env.ANYSEARCH_ENDPOINT;
  const key = process.env.ANYSEARCH_API_KEY;
  if (ep) t = t.split(ep).join("<endpoint>");
  if (key) t = t.split(key).join("<key>");
  return t.slice(0, 200);
}

function hostOf(u: string): string {
  try { return new URL(/^https?:\/\//i.test(u) ? u : "https://" + u).hostname; } catch { return "?"; }
}

async function main(): Promise<void> {
  // Explicit constructor arg wins over env inside the provider —
  // this is the P1 separation lever (endpoint/key attribution).
  const p = new AnySearchProvider(NO_KEY ? "" : undefined, FORCE_DEFAULT ? PUBLIC_ENDPOINT : undefined);
  const t0 = Date.now();
  const envClass = {
    endpointSource: FORCE_DEFAULT ? "default(forced)" : process.env.ANYSEARCH_ENDPOINT ? "env" : "default",
    keyPresent: NO_KEY ? false : !!process.env.ANYSEARCH_API_KEY,
  };
  try {
    const env = await p.search({ query: QUERY, mode: "fast", maxResults: 3 }, AbortSignal.timeout(30000));
    console.log(JSON.stringify({
      schema: "anysearch/provider-probe@1", provider: "anysearch", ok: true,
      results: env.results.length, elapsedMs: Date.now() - t0, serverElapsedMs: env.elapsedMs,
      sampleHosts: env.results.slice(0, 3).map((r) => hostOf(r.url)),
      ...envClass,
    }));
  } catch (e) {
    const name = e instanceof Error ? e.name : typeof e;
    const message = scrub(e instanceof Error ? e.message : String(e));
    console.log(JSON.stringify({
      schema: "anysearch/provider-probe@1", provider: "anysearch", ok: false,
      errorName: name, errorMessage: message,
      errorClass: classifyProviderError(name + ": " + message),
      elapsedMs: Date.now() - t0,
      ...envClass,
    }));
    process.exitCode = 2;
  }
}

await main();
