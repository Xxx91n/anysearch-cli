// AnySearch provider direct-call forensic probe.
// Calls `new AnySearchProvider().search()` once and prints ONE structured
// evidence line — on failure it records the error NAME + truncated message +
// classified lane (the long-term fixture repairing "flag without error text"
// at the forensic layer). Run:
// node providers/anysearch/probe-anysearch-provider.ts
// ANS_PROBE_QUERY="..." node providers/anysearch/probe-anysearch-provider.ts
// Red lines: ANYSEARCH_ENDPOINT / ANYSEARCH_API_KEY values are NEVER printed —
// only classes (endpointSource/keySource); occurrences of the configured values
// inside an error message are masked <endpoint>/<key>. The key is resolved the
// same way the product resolves it (env first, then ~/.ans/credentials.json), so
// a key that lives only in the credential file still reaches the adapter.
// Exit codes: 0 = arm alive (results returned); 2 = arm failed (class emitted), or the
// probe self-check failed (errorName + stage, no arm ran).

// Plain `node` cannot load the adapter from source: `anysearch.ts` imports "../contract"
// without an extension, and the store's credential module imports "./ans-paths.js"; tsc
// (Bundler resolution) and tsx accept both, Node's ESM resolver does not. probe-credentials
// registers the one resolver hook and loads the store module, so it must be the first
// import: the hook has to exist before anything else is loaded through a specifier plain
// node cannot resolve. The alternative — writing extensions into the sources — needs
// allowImportingTsExtensions in the tsconfigs that compile them, too wide a change for a
// manual probe (decision #413: plain `node <file>`, no build, no tsx).
import { maskSecrets, resolveProbeCredentials } from "../probe-credentials.mjs";

const { AnySearchProvider } = await import("../../packages/retriever/src/providers/anysearch.ts");
const { PROVIDER_FACTS } = await import("../../packages/retriever/src/providers/provider-facts.ts");
const { classifyProviderError } = await import("../../packages/retriever/src/contract.ts");

// Probe overrides (P1 env/key/endpoint separation):
// --default-endpoint force the baked-in public endpoint (env ignored)
// --nokey anonymous call (env key suppressed)
const ARGS = process.argv.slice(2);
// `||`, not `??`: POSIX empty ≡ unset, the same rule the raw probe applies —
// an empty ANS_PROBE_QUERY must not send an empty query upstream.
const QUERY = process.env.ANS_PROBE_QUERY || "cloudflare workers";
const FORCE_DEFAULT = ARGS.includes("--default-endpoint");
const NO_KEY = ARGS.includes("--nokey");

// --nokey 显式压掉 key：整段跳过解析，凭据文件坏了也不读。其余情况跟产品同一套解析。
const credentials = resolveProbeCredentials("anysearch", { anonymous: NO_KEY });
const KEY = credentials.apiKey;
// 遮的是「这一跑真用的那个值」，外加环境变量里可能存在的同名值（`--nokey` 时 KEY 是空串，
// 但上游仍可能把 query 回显进错误消息）。key 只在凭据文件里时，环境变量里没有它可遮。
const SECRETS: Array<[string | undefined, string]> = [
  [process.env.ANYSEARCH_ENDPOINT, "<endpoint>"],
  [process.env.ANYSEARCH_API_KEY, "<key>"],
  [KEY, "<key>"],
];

// --default-endpoint 要的是事实表里那个公开地址。常量被改名或搬走时 import 拿到的是
// undefined（plain node 没有类型检查），静默退回 env 会让 endpointSource 说谎——
// 所以先校验再放行，和过去校验 adapter 的那个导出是同一个理由。
const DEFAULT_ENDPOINT: string | undefined = PROVIDER_FACTS?.anysearch?.freeProbe?.endpoint;

// A dropped or renamed export is undefined, and --default-endpoint would then fall back
// to env while envClass still prints default(forced) — refuse instead of lying.
if (FORCE_DEFAULT && (typeof DEFAULT_ENDPOINT !== "string" || DEFAULT_ENDPOINT.length === 0)) {
  const message = "provider-facts has no anysearch.freeProbe.endpoint — --default-endpoint has nothing to send";
  // Nothing was called, so there is no class to report and the endpoint source is unknown.
  console.log(JSON.stringify({
    schema: "anysearch/provider-probe@2", provider: "anysearch", ok: false, stage: "import",
    errorName: "MissingExport", errorMessage: message,
    endpointSource: "unknown", keySource: credentials.keySource,
    ...(credentials.credentialWarning ? { credentialWarning: scrub(credentials.credentialWarning) } : {}),
  }));
  process.exit(2);
}

function scrub(s: string): string {
  return maskSecrets(s, SECRETS).slice(0, 200);
}

function hostOf(u: string): string {
  try { return new URL(/^https?:\/\//i.test(u) ? u: "https://" + u).hostname; } catch { return "?"; }
}

async function main(): Promise<void> {
  // Explicit constructor arg wins over env inside the provider —
  // this is the P1 separation lever (endpoint/key attribution). The key is passed
  // explicitly on purpose: leaving it undefined would let the adapter re-read
  // process.env, and then the probe's resolution and the adapter's fallback fork.
  const p = new AnySearchProvider(KEY, FORCE_DEFAULT ? DEFAULT_ENDPOINT : undefined);
  const t0 = Date.now();
  const envClass = {
    endpointSource: FORCE_DEFAULT ? "default(forced)" : process.env.ANYSEARCH_ENDPOINT ? "env" : "default",
    keySource: credentials.keySource,
    ...(credentials.credentialWarning ? { credentialWarning: scrub(credentials.credentialWarning) } : {}),
  };
  try {
    const env = await p.search({ query: QUERY, mode: "fast", maxResults: 3 }, AbortSignal.timeout(30000));
    console.log(JSON.stringify({
      schema: "anysearch/provider-probe@2", provider: "anysearch", ok: true,
      results: env.results.length, elapsedMs: Date.now() - t0, serverElapsedMs: env.elapsedMs,
      sampleHosts: env.results.slice(0, 3).map((r) => hostOf(r.url)),
      ...envClass,
    }));
  } catch (e) {
    const name = e instanceof Error ? e.name : typeof e;
    const message = scrub(e instanceof Error ? e.message : String(e));
    console.log(JSON.stringify({
      schema: "anysearch/provider-probe@2", provider: "anysearch", ok: false,
      errorName: name, errorMessage: message,
      errorClass: classifyProviderError(name + ": " + message),
      elapsedMs: Date.now() - t0,
      ...envClass,
    }));
    process.exitCode = 2;
  }
}

await main();
