// AnySearch provider direct-call forensic probe.
// Calls `new AnySearchProvider().search()` once and prints ONE structured
// evidence line — on failure it records the error NAME + truncated message +
// classified lane (the long-term fixture repairing "flag without error text"
// at the forensic layer). Run:
// node providers/anysearch/probe-anysearch-provider.ts
// ANS_PROBE_QUERY="..." node providers/anysearch/probe-anysearch-provider.ts
// Red lines: ANYSEARCH_ENDPOINT / ANYSEARCH_API_KEY values are NEVER printed —
// only presence classes (endpointSource/keyPresent); occurrences of the
// configured values inside an error message are masked <endpoint>/<key>.
// Exit codes: 0 = arm alive (results returned); 2 = arm failed (class emitted).

// Plain `node` cannot load the adapter from source: `anysearch.ts` imports
// "../contract" without an extension, which tsc (Bundler resolution) and tsx
// both accept and Node's ESM resolver does not. ".ts" is appended only when
// that file really exists, so a genuinely bad specifier still fails loudly.
// The alternative — writing ".ts" into the adapter — needs
// allowImportingTsExtensions in the three tsconfigs that compile the adapter
// (retriever, kernel, apps/cli), which is too wide a change for a manual probe
// (decision #413: plain `node <file>`).
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && !/\.[cm]?[jt]s$/.test(specifier) && context.parentURL) {
      const candidate = new URL(specifier + ".ts", context.parentURL);
      if (existsSync(fileURLToPath(candidate))) return nextResolve(specifier + ".ts", context);
    }
    return nextResolve(specifier, context);
  },
});

const { AnySearchProvider } = await import("../../packages/retriever/src/providers/anysearch.ts");
const { classifyProviderError } = await import("../../packages/retriever/src/contract.ts");

// Probe overrides (P1 env/key/endpoint separation):
// --default-endpoint force the baked-in public endpoint (env ignored)
// --nokey anonymous call (env key suppressed)
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
  try { return new URL(/^https?:\/\//i.test(u) ? u: "https://" + u).hostname; } catch { return "?"; }
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
