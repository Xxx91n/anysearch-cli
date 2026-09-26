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
import type { RetrievalObservationSink } from "../src/ports";

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

// --- R84 T1 / ADR-0085 draft: vertical-eval stub layer -----------------------
// Vertical entries (vert-*/ctrl-* ids) replay the legislated wire/marker/
// degraded semantics through stub providers — the OFFLINE truth layer for
// expected.vertical{domain,sub_domain,paramsKeys,paramsSent,hit,degraded}.
// The capable stub mirrors the anysearch adapter contract: it stamps
// extra.vertical{domain,subDomain?} on every result when req.vertical is set.
// Control entries simulate the two upstream surfaces observed 2026-09-25:
// bogus domain -> silent general fallback (HTTP 200, unmarked results);
// bogus sub_domain -> isError reject (fail-first -> providersFailed).
function fakeSink() {
  const events: Array<{ name: string; attributes: any }> = [];
  const sink: RetrievalObservationSink = {
    addEvent: (name: string, attributes: any) => { events.push({ name, attributes }); },
    setAttributes: () => { },
  };
  return { sink, events };
}

function verticalCapableProvider(id: string, mode: "hit" | "fallback" | "reject"): SearchProvider {
  const p: SearchProvider = {
    id,
    modes: ["fast"],
    verticalDomainSupported: true,
    async search(req: SearchRequest): Promise<ProviderEnvelope> {
      (p as any).lastReq = req;
      if (mode === "reject") throw new Error(id + " upstream isError (invalid vertical combination)");
      const marked = mode === "hit" && !!req.vertical;
      const results: NormalizedResult[] = ["https://fmp.example/earnings", "https://fmp.example/calendar"].map((url, i) => ({
        url, title: id + " v" + i, snippet: "s" + i, source: id,
        ...(marked ? { extra: { vertical: { domain: req.vertical!.domain, ...(req.vertical!.subDomain ? { subDomain: req.vertical!.subDomain } : {}) } } } : {}),
      }));
      return { provider: id, results, answers: [], elapsedMs: 5 };
    },
  };
  return p;
}

// Scenario for a vertical entry. The capable arm's upstream mode is driven by
// the entry's asserted surface: role:subject -> hit (stamped results);
// role:control + subDomain present -> reject (bogus sub_domain surface);
// role:control + domain only -> fallback (bogus domain silent-fallback surface).
function verticalScenarioFor(e: any): Scenario | null {
  if (e.vertical === undefined && e.expected?.vertical === undefined) return null;
  const vexp = e.expected?.vertical ?? {};
  const capMode = vexp.role === "control" ? (e.vertical?.subDomain ? "reject" : "fallback") : "hit";
  return {
    // No urlPolicy: the vertical axis is orthogonal to the host gate —
    // domain:"default" entries carry no allowlist.
    policy: () => ({ allow: [], deny: [], policyVersion: "vertical-stub-r84" }),
    providers: [
      verticalCapableProvider("vcap", capMode),
      stubProvider("vincap", ["https://zhihu.com/p/gen-1", "https://stackoverflow.com/q/gen-2"], false),
    ],
  };
}

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
  return verticalScenarioFor(e);
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
    const { sink, events } = fakeSink();
    const eng = new RetroaererdEngine(sc.providers, { urlPolicy: sc.policy, domainName: e.domain });
    // R84 T1: vertical entries inject their spec at the query level — same
    // surface as the CLI --vertical-* flags.
    const env = await eng.search({ query: e.question, mode: "fast", ...(e.vertical ? { vertical: e.vertical } : {}), span: sink });
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
    // R84 T1 / ADR-0085 draft: expected.vertical assertion surface. Offline the
    // semantics are deterministic — control entries assert hard here too (the
    // soft/degraded treatment is live-leg only, where upstream can drift).
    const vexp = e.expected?.vertical;
    if (vexp !== undefined) {
      const capProvider = sc.providers.find((p) => p.id === "vcap") as any;
      const incapProvider = sc.providers.find((p) => p.id === "vincap") as any;
      const pre = events.find((ev) => ev.name === "retrieval.vertical.pre");
      if (vexp.role === "subject") {
        assert(!!pre, e.id + " vertical.pre event emitted");
        assert(pre?.attributes["anysearch.vertical.domain"] === vexp.domain, e.id + " event domain " + vexp.domain);
        assert(pre?.attributes["anysearch.vertical.sub_domain"] === (vexp.sub_domain ?? ""), e.id + " event sub_domain");
        const pk = pre?.attributes["anysearch.vertical.params_keys"] ?? null;
        assert(Array.isArray(pk) && JSON.stringify([...pk].sort()) === JSON.stringify([...(vexp.paramsKeys ?? [])].sort()), e.id + " event params_keys " + JSON.stringify(pk));
        // Wire truth on the capable arm.
        const vreq = capProvider?.lastReq?.vertical;
        assert(vreq?.domain === vexp.domain, e.id + " wire domain " + vexp.domain);
        assert(vreq?.subDomain === vexp.sub_domain, e.id + " wire subDomain " + String(vexp.sub_domain));
        if (vexp.paramsKeys !== undefined) {
          const sentKeys = Object.keys(vreq?.params ?? {}).sort();
          assert(JSON.stringify(sentKeys) === JSON.stringify([...vexp.paramsKeys].sort()), e.id + " wire params keys " + JSON.stringify(sentKeys));
        }
        if (vexp.paramsSent === false) assert(vreq !== undefined && vreq.params === undefined, e.id + " A-04: params key absent on wire (empty {} never serializes)");
        if (vexp.paramsSent === true) assert(vreq?.params !== undefined, e.id + " params present on wire");
        // Degraded arm received NO vertical spec (capability negotiation).
        assert(incapProvider?.lastReq?.vertical === undefined, e.id + " degraded arm received no vertical spec");
        if (Array.isArray(vexp.degraded)) {
          assert(JSON.stringify(pre?.attributes["anysearch.vertical.degraded"]) === JSON.stringify(vexp.degraded), e.id + " event degraded " + JSON.stringify(vexp.degraded));
        }
      } else if (vexp.role === "control") {
        assert(!!pre === !!e.vertical, e.id + " control: vertical.pre presence matches spec injection");
        // Observed upstream surfaces (matrix 2026-09-25): a bogus sub_domain is
        // rejected upstream (isError) -> the vertical arm lands in
        // providersFailed; a bogus domain silently falls back to general.
        if (e.vertical?.subDomain !== undefined) {
          assert(env.metadata.providersFailed.includes("vcap"), e.id + " reject surface: capable arm in providersFailed");
        }
      }
      if (vexp.hit === true) {
        assert(env.results.some((r: any) => r.extra?.vertical?.domain === vexp.domain), e.id + " verticalHit marker on results (extra.vertical.domain=" + vexp.domain + ")");
      } else if (vexp.hit === false) {
        assert(!env.results.some((r: any) => r.extra?.vertical !== undefined), e.id + " no result carries the vertical marker");
      }
      if (vexp.degraded === "general-fallback") {
        // The vertical arm did not produce marked results; the general fanout
        // answered. Existence asserted — pass/fail handled per leg.
        assert(env.results.length >= 1, e.id + " general-fallback: results exist");
      }
    }
  }

  console.log("--- eval-looks stub executor: " + passed + " passed, " + failed + " failed ---");
  if (failed > 0) process.exit(1);
}
main();
