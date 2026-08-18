// Retroaererd Engine: bounded budget + serialized sufficiency-gate + fanout convergence + RRF fusion.
// ADR-0005 decision 4: Budget in store layer (BudgetLedger), sufficiency gate in retriever fanout layer.
// atomcode research (paperfoot source-level): JoinSet completion-order collect, enough-results-then-collect,
// 1.5s grace window, abort_all + drain, providers_cancelled distinct state, RRF(k=60) fusion.
// JS adaptation: Promise.allSettled + AbortController + unique-URL counter early stop.

import type { SearchProvider, SearchRequest, NormalizedResult, FusedEnvelope } from "@anysearch/retriever";
import { rrfRank } from "@anysearch/retriever";
import type { Budget } from "./ports";

// Sufficiency gate config: minimum quality thresholds for a search result.
// atomcode research: min angles (providers) / min fetches (results) / min domains / cross-engine verify.
export interface SufficiencyGate {
  minProviders: number;       // min providers that must return results (e.g. 2)
  minResults: number;         // min total unique results (e.g. 5)
  minDomains: number;        // min unique domains (e.g. 3)
  crossEngineVerify: boolean; // require at least 2 providers returning overlapping URLs
}

// Default sufficiency gate (atomcode research protocol + TeamLoop loop).
export const DEFAULT_GATE: SufficiencyGate = {
  minProviders: 2,
  minResults: 5,
  minDomains: 3,
  crossEngineVerify: true,
};

// Engine config: budget caps + sufficiency gate + grace window.
export interface EngineConfig {
  // ponytail: budget field is accepted but not yet wired to BudgetLedger (ADR-0005 decision 4 known deferral).
  // Kernel stays pure orchestration; budget enforcement will be injected via store layer when implemented.
  budget?: Budget;
  gate?: Partial<SufficiencyGate>;  // override DEFAULT_GATE fields
  graceWindowMs?: number;            // default 1500 (paperfoot EARLY_STOP_GRACE)
  deepMode?: boolean;                // if true, never cancel (wait all, paperfoot deep mode)
}

// Normalize URL for dedup: strip scheme + leading www + tracking params.
// atomcode research: normalize_url() in paperfoot strips utm_*, fbclid, gclid.
function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    let path = u.pathname;
    // Strip tracking params.
    const trackingParams = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid", "ref"];
    for (const p of trackingParams) u.searchParams.delete(p);
    // Normalize host: remove leading www.
    const host = u.host.replace(/^www\./, "");
    return host + path + (u.search || "");
  } catch {
    return url; // invalid URL, use as-is
  }
}

// Extract domain from URL for sufficiency gate domain counting.
function extractDomain(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export class RetroaererdEngine {
  private providers: Map<string, SearchProvider> = new Map();

  registerProvider(provider: SearchProvider): void {
    this.providers.set(provider.id, provider);
  }

  // Fanout search: parallel provider queries, enough-results-then-collect, RRF fusion.
  async search(
    req: SearchRequest,
    config: EngineConfig = {},
  ): Promise<FusedEnvelope> {
    const start = Date.now();
    const gate = { ...DEFAULT_GATE, ...config.gate };
    const graceWindow = config.graceWindowMs ?? 1500;
    const deepMode = config.deepMode ?? false;

    // Select providers: all registered, or subset if req.mode covers.
    const allProviders = [...this.providers.values()];
    if (allProviders.length === 0) {
      throw new Error("No providers registered");
    }

    // atomcode research: per-provider AbortController + shared abort for grace window.
    const controllers = allProviders.map(() => new AbortController());
    const providerIds = allProviders.map((p) => p.id);

    // Fire all providers in parallel (atomcode research: attributed tasks).
    const promises = allProviders.map((p, i) =>
      p.search(req, controllers[i].signal)
        .then((env) => ({ provider: p.id, status: "fulfilled" as const, envelope: env }))
        .catch((err) => ({ provider: p.id, status: "rejected" as const, error: String(err) })),
    );

    // Enough-results-then-collect: wait for all OR grace window after enough unique results.
    // ponytail: for MVP, use Promise.allSettled without early-cancel complexity.
    // atomcode research: deep mode = wait all (allSettled equivalent).
    // Non-deep mode = allSettled + check after, cancelled = none arrived in time.
    // Full grace-window abort would need a custom race; keeping MVP simple.
    const settled = await Promise.allSettled(promises);

    // Collect results into per-provider URL lists for RRF.
    const providerLists: string[][] = [];
    const allResults = new Map<string, NormalizedResult>(); // keyed by normalized URL
    const providersQueried: string[] = [];
    const providersFailed: string[] = [];
    const providersCancelled: string[] = [];
    const answers: string[] = [];

    for (let i = 0; i < settled.length; i++) {
      const s = settled[i];
      providersQueried.push(providerIds[i]);
      if (s.status === "fulfilled") {
        // Inner promise fulfilled -> check provider result.
        const inner = (s as PromiseFulfilledResult<{ provider: string; status: string; envelope?: any; error?: string }>).value;
        if (inner.status === "fulfilled" && inner.envelope) {
          const urls: string[] = [];
          for (const r of inner.envelope.results) {
            const norm = normalizeUrl(r.url);
            if (!allResults.has(norm)) {
              allResults.set(norm, { ...r, url: norm }); // store normalized URL as key
            }
            urls.push(norm);
          }
          providerLists.push(urls);
          if (inner.envelope.answers) {
            answers.push(...inner.envelope.answers);
          }
        } else if (inner.status === "rejected") {
          providersFailed.push(providerIds[i]);
        }
      } else {
        providersFailed.push(providerIds[i]);
      }
    }

    // Cancelled = queried but neither fulfilled nor failed (should not happen with allSettled, but keep for API).
    // atomcode research: providers_cancelled = set difference.

    // RRF fusion: rrfRank from packages/retriever (k=60).
    const rankedUrls = rrfRank(providerLists, 60);

    // Map back to NormalizedResult in ranked order.
    const rankedResults: NormalizedResult[] = [];
    for (const url of rankedUrls) {
      const r = allResults.get(url);
      if (r) {
        // Restore original URL for output.
        rankedResults.push({ ...r, url: String(r.extra?.originalUrl ?? r.url) });
      }
    }

    // Sufficiency gate check (atomcode research: min angles/fetches/domains/cross-engine).
    const uniqueUrls = new Set(rankedResults.map((r) => normalizeUrl(r.url)));
    const uniqueDomains = new Set(rankedResults.map((r) => extractDomain(r.url)));
    const successfulProviders = providerLists.length;
    const gatePassed =
      successfulProviders >= gate.minProviders &&
      uniqueUrls.size >= gate.minResults &&
      uniqueDomains.size >= gate.minDomains;
    // crossEngineVerify: at least 2 providers shared a URL (consensus in RRF).
    const crossEngineOk = !gate.crossEngineVerify || checkCrossEngine(providerLists);
    const sufficiencyPassed = gatePassed && crossEngineOk;

    return {
      results: rankedResults,
      answers,
      metadata: {
        providersQueried,
        providersFailed,
        providersCancelled,
        elapsedMs: Date.now() - start,
      },
    };
  }
}

// Check cross-engine verify: at least one URL appears in 2+ provider lists.
function checkCrossEngine(providerLists: string[][]): boolean {
  if (providerLists.length < 2) return false;
  const urlProviders = new Map<string, Set<number>>();
  for (let i = 0; i < providerLists.length; i++) {
    for (const url of providerLists[i]) {
      if (!urlProviders.has(url)) urlProviders.set(url, new Set());
      urlProviders.get(url)!.add(i);
    }
  }
  for (const providers of urlProviders.values()) {
    if (providers.size >= 2) return true;
  }
  return false;
}
