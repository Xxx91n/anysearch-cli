// R62 D-006 (T6): eval-looks golden executor — OFFLINE stub layer (blocking).
// Entries with scope stub|both are replayed through RetroaererdEngine with stub
// providers + the real domain policy. Fixtures come from the OBSERVED badcase
// scene (eval-badcases.json observed.* / documented scenes) — NEVER from
// expected.*, which would make the assertion self-fulfilling (D-006 hard ban).
// The live layer (store test/online/eval-looks-live.online.ts) re-checks the
// same entries against real providers; scope has no default — every entry must
// declare stub|live|both explicitly.
//
// Lives in kernel/test (not store/test) because the executor needs the engine;
// store -> kernel would be a circular workspace dep. Direction note kept here.

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { RetroaererdEngine } from "../src/engine";
import { loadDomainByNameIn, resolvePolicyFromSchema, defaultDomainsDirs } from "@anysearch-cli/store";
import type { SearchProvider, SearchRequest, ProviderEnvelope, NormalizedResult } from "@anysearch-cli/retriever";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return; }
  passed++;
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const looks = JSON.parse(readFileSync(join(root, "eval-looks.json"), "utf8"));
const badcases = JSON.parse(readFileSync(join(root, "eval-badcases.json"), "utf8"));

function stubProvider(id: string, urls: string[], capable: boolean): SearchProvider {
  const p: SearchProvider = {
    id,
    modes: ["fast"],
    async search(_req: SearchRequest): Promise<ProviderEnvelope> {
      const results: NormalizedResult[] = urls.map((url, i) => ({
        url, title: id + " r" + i, snippet: "s" + i, source: id,
      }));
      return { provider: id, results, answers: [], elapsedMs: 5 };
    },
  };
  if (capable) (p as { domainFilterSupported?: boolean }).domainFilterSupported = true;
  return p;
}

interface UrlPolicy { allow: readonly string[]; deny: readonly string[]; policyVersion: string }
interface Scenario { policy: () => UrlPolicy; providers: SearchProvider[] }

// Real docs.toml policy — same loader the CLI composition root uses.
function docsPolicy(): () => UrlPolicy {
  const dirs = defaultDomainsDirs();
  dirs.push(join(root, "domains"));
  const schema = loadDomainByNameIn("docs", dirs);
  const policy = resolvePolicyFromSchema(schema) as UrlPolicy;
  return () => policy;
}

// Observed cold.toml scene (.scratch/grill-round-61/narrow-domains/cold.toml,
// noted on docs-g0014): allowlist pinned to nonexistent.invalid gates everything.
const coldPolicy = (): UrlPolicy => ({ allow: ["nonexistent.invalid"], deny: [], policyVersion: "cold-fixture-r61" });

// Off-domain host pool for replays (all outside every shipped allowlist).
const OFFDOMAIN = ["zhihu.com", "www.cnblogs.com", "csdn.net", "tokio.rs", "kubernetes.io", "stackoverflow.com"];

// Build the observed-scene fixture for one entry. Badcase-anchored entries replay
// observed.results count with observed.topHost first; scene-documented entries
// use their recorded provider topology.
function scenarioFor(e: any): Scenario | null {
  const bc = badcases.badcases.find((b: any) => b.promotedTo === e.id);
  if (e.id === "docs-g0007") {
    // docs-bc0001 observed: 10 results, allowlistHits 0, topHost tencent-cloud.
    const n = bc?.observed?.results ?? 10;
    const urls = Array.from({ length: n }, (_, i) =>
      i === 0 && bc?.observed?.topHost
        ? "https://" + bc.observed.topHost + "/tokio-joinset-observed"
        : "https://" + OFFDOMAIN[i % OFFDOMAIN.length] + "/p/" + i);
    const half = Math.ceil(urls.length / 2);
    return {
      policy: docsPolicy(),
      providers: [
        stubProvider("tavily", urls.slice(0, half), false),
        stubProvider("exa", urls.slice(half), false),
      ],
    };
  }
  if (e.id === "docs-g0013") {
    // Observed scene (kernel domain-filter.test.ts §5): provider WITHOUT
    // domainFilterSupported — authoritative post-gate must still block all
    // off-domain arrivals under the docs policy.
    return {
      policy: docsPolicy(),
      providers: [stubProvider("incapable", ["https://kubernetes.io/docs/pod-eviction", "https://evil.example/k8s"], false)],
    };
  }
  if (e.id === "docs-g0014") {
    // Observed cold-domain scene: every arrival is gated by the narrow allowlist.
    return {
      policy: coldPolicy,
      providers: [stubProvider("tavily", ["https://kubernetes.io/docs/concepts/scheduling-eviction/pod-eviction/"], true)],
    };
  }
  return null;
}

async function main() {
  const entries: any[] = looks.golden.entries;

  // Schema: explicit scope on every entry — no default fallback (D-006).
  // golden.scopes is a sidecar map (entry-id -> scope): explicit per-entry scope
  // without interleaving into r61-owned entry lines.
  const scopes: Record<string, string> = looks.golden.scopes ?? {};
  const SCOPES = new Set(["stub", "live", "both"]);
  for (const e of entries) {
    assert(SCOPES.has(scopes[e.id]), e.id + " scope must be explicit stub|live|both in golden.scopes (got " + scopes[e.id] + ")");
  }
  const mustHit = (e: any) => (e.expected?.mustHitHosts?.length ?? 0) > 0 || (e.expected?.mustHitUrls?.length ?? 0) > 0;
  for (const e of entries) {
    if (e.expected?.verdict === "answer" && mustHit(e))
      assert(scopes[e.id] === "live" || scopes[e.id] === "both", e.id + " answer+mustHit* needs live-capable scope (explicit, not defaulted)");
  }

  // Execute the stub slice.
  const stubEntries = entries.filter((e) => scopes[e.id] === "stub" || scopes[e.id] === "both");
  assert(stubEntries.length >= 3, "stub slice covers the three abstain entries (got " + stubEntries.length + ")");
  for (const e of stubEntries) {
    const sc = scenarioFor(e);
    assert(!!sc, e.id + " has a resolvable observed-scene fixture");
    if (!sc) continue;
    const eng = new RetroaererdEngine(sc.providers, { urlPolicy: sc.policy, domainName: e.domain });
    const env = await eng.search({ query: e.question, mode: "fast" });
    if (e.expected.verdict === "abstain") {
      const ab = env.metadata.abstain;
      assert(ab?.abstain === true, e.id + " => abstain marker");
      assert(ab?.reason === "domain_filter_empty", e.id + " reason domain_filter_empty");
      assert(env.results.length === 0, e.id + " zero survivors (got " + env.results.length + ")");
      assert(typeof ab?.preFiltered === "number" && typeof ab?.postFiltered === "number", e.id + " gate counters present");
    } else {
      assert(env.metadata.abstain === undefined, e.id + " answer verdict has no abstain marker");
      assert(env.results.length >= (e.expected.minResults ?? 1), e.id + " meets minResults structure");
    }
  }

  console.log("--- eval-looks stub executor: " + passed + " passed, " + failed + " failed ---");
  if (failed > 0) process.exit(1);
}
main();
