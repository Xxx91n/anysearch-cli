// Retroaererd Engine: bounded budget + serialized sufficiency-gate + fanout convergence + RRF fusion.
// ADR-0005 decision 4: Budget in store layer (BudgetLedger), sufficiency gate in retriever fanout layer.
// atomcode research (paperfoot source-level): JoinSet completion-order collect, enough-results-then-collect,
// 1.5s grace window, abort_all + drain, providers_cancelled distinct state, RRF(k=60) fusion.
// JS adaptation: Promise.allSettled + AbortController + unique-URL counter early stop.

import type { SearchProvider, SearchRequest, NormalizedResult, FusedEnvelope, SufficiencySignal, ProviderAnswer } from "@anysearch/retriever";
import { rrfRank, FUSION_REGISTRY, SCORE_KIND } from "@anysearch/retriever";
import type { Budget, Query, RetrieverPort } from "./ports";
import type { BudgetLedgerPort } from "./ports";
import { attachAttribution, applyJudgeEscalation, type JudgeFn } from "./attribution";

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
  // ADR-0006: per-call dimension wired via BudgetLedgerPort. Token dimension pending LLM integration.
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
    // Handle normalized URLs without protocol (e.g. "a.com/1" after normalizeUrl).
    const withProto = url.includes("://") ? url : "https://" + url;
    return new URL(withProto).host.replace(/^www\./, "");
  } catch {
    return "";
  }
}


// ADR-0014 D7: computeSufficiency pure function — single computation source, dual output.
// control: internal fanout early-stop booleans (SufficiencyGate config stays as internal threshold).
// mvs: MVSS four-segment signal written to FusedEnvelope.metadata for external consumption.
// Academic: Fagin TA (PODS 2001) threshold early-stop + epsilon-approximation dual-use;
// CRAG same confidence dual-use; Qdrant discipline: same statistic computed twice = redundant.
export interface SufficiencyResult {
  control: {
    gatePassed: boolean;
    crossEngineOk: boolean;
    sufficiencyPassed: boolean;
  };
  mvs: SufficiencySignal;
}

export function computeSufficiency(
  rankedResults: NormalizedResult[],
  providerLists: string[][],
  gate: SufficiencyGate,
  rrfRanks: number[] = [],
  providerScores: Record<string, number[]> = {},
): SufficiencyResult {
  const uniqueUrls = new Set(rankedResults.map((r) => normalizeUrl(r.url)));
  const uniqueDomains = new Set(rankedResults.map((r) => extractDomain(r.url)));
  const successfulProviders = providerLists.length;

  // Control booleans (internal fanout early-stop).
  const gatePassed =
    successfulProviders >= gate.minProviders &&
    uniqueUrls.size >= gate.minResults &&
    uniqueDomains.size >= gate.minDomains;
  const crossEngineOk = !gate.crossEngineVerify || checkCrossEngine(providerLists);
  const sufficiencyPassed = gatePassed && crossEngineOk;

  // MVSS: verdict (CRAG three-state quantifier aggregation).
  const allProvidersHaveResults = providerLists.every(l => l.length > 0);
  const someProvidersHaveResults = providerLists.some(l => l.length > 0);
  let verdict: SufficiencySignal["verdict"] = "ambiguous";
  if (sufficiencyPassed) {
    verdict = allProvidersHaveResults ? "correct" : "ambiguous";
  } else if (!someProvidersHaveResults) {
    verdict = "incorrect";
  }

  // MVSS: agreement (Jaccard@K + RBO@K, rank-derived, always computable).
  const K = Math.min(10, ...providerLists.map(l => l.length));
  const jaccardAtK = computeJaccardAtK(providerLists, K);
  const rboAtK = computeRboAtK(providerLists, K);

  // MVSS: spread (rrfVariance + scoreScale).
  const rrfVariance = rrfRanks.length > 1 ? computeVariance(rrfRanks) : 0;
  let scoreScale: { min: number; max: number } | undefined;
  const allScores = Object.values(providerScores).flat();
  if (allScores.length > 0) {
    scoreScale = { min: Math.min(...allScores), max: Math.max(...allScores) };
  }

  const mvs: SufficiencySignal = {
    verdict,
    agreement: { jaccardAtK, rboAtK },
    volume: {
      uniqueResults: uniqueUrls.size,
      uniqueDomains: uniqueDomains.size,
      successfulProviders,
    },
    spread: { rrfVariance, scoreScale },
  };
  if (Object.keys(providerScores).length > 0) {
    mvs.perProvider = providerScores;
  }

  return { control: { gatePassed, crossEngineOk, sufficiencyPassed }, mvs };
}

// Jaccard@K: intersection over union of top-K URLs across all provider pairs.
function computeJaccardAtK(providerLists: string[][], k: number): number {
  if (providerLists.length < 2 || k === 0) return 0;
  let totalJ = 0, pairs = 0;
  for (let i = 0; i < providerLists.length; i++) {
    for (let j = i + 1; j < providerLists.length; j++) {
      const a = new Set(providerLists[i].slice(0, k));
      const b = new Set(providerLists[j].slice(0, k));
      let inter = 0;
      for (const u of a) if (b.has(u)) inter++;
      const union = a.size + b.size - inter;
      totalJ += union > 0 ? inter / union : 0;
      pairs++;
    }
  }
  return pairs > 0 ? totalJ / pairs : 0;
}

// RBO@K: Rank-Biased Overlap (simplified, p=0.9).
function computeRboAtK(providerLists: string[][], k: number): number {
  if (providerLists.length < 2 || k === 0) return 0;
  const p = 0.9;
  let totalRbo = 0, pairs = 0;
  for (let i = 0; i < providerLists.length; i++) {
    for (let j = i + 1; j < providerLists.length; j++) {
      let sum = 0, inter = 0;
      for (let d = 1; d <= k; d++) {
        const a = new Set(providerLists[i].slice(0, d));
        const b = new Set(providerLists[j].slice(0, d));
        for (const u of a) if (b.has(u)) inter++;
        sum += Math.pow(p, d - 1) * (inter / d);
      }
      totalRbo += (1 - p) * sum;
      pairs++;
    }
  }
  return pairs > 0 ? totalRbo / pairs : 0;
}

function computeVariance(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  return values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
}

export class RetroaererdEngine {
  private providers: Map<string, SearchProvider> = new Map();
  private ledger?: BudgetLedgerPort;
  private sessionId?: string;
  // ADR-0034 step 6: host-injected claim judge. The LLM and its budget ledger live in the host;
  // kernel stays pure. r83 audit F2: previously shouldEscalateToJudge had zero callers.
  private attributionJudge?: JudgeFn;
  // ADR-0045 D2/D4: optional domain sources.weights overlay (user preference, never gained from
  // observation). Invalid values are rejected at domain load (fail-fast); absent = equal weights.
  private sourceWeights?: Record<string, number>;

  // ADR-0006 decision 1C: constructor accepts providers array.
  // ADR-0006 decision 2A: optional BudgetLedger + sessionId for per-call billing.
  constructor(providers: SearchProvider[] = [], opts?: { ledger?: BudgetLedgerPort; sessionId?: string; attributionJudge?: JudgeFn; sourceWeights?: Record<string, number> }) {
    this.ledger = opts?.ledger;
    this.sessionId = opts?.sessionId;
    this.attributionJudge = opts?.attributionJudge;
    this.sourceWeights = opts?.sourceWeights;
    for (const p of providers) {
      this.providers.set(p.id, p);
    }
  }

  // Internal convenience, not on RetrieverPort.
  private registerProvider(provider: SearchProvider): void {
    this.providers.set(provider.id, provider);
  }

  // Fanout search: parallel provider queries, enough-results-then-collect, RRF fusion.
  // ADR-0006 decision 1A: implements RetrieverPort.
  // ADR-0006 decision 1B: accepts Query (superset with budget + provider filter).
  async search(
    q: Query,
    config: EngineConfig = {},
  ): Promise<FusedEnvelope> {
    const start = Date.now();
    const gate = { ...DEFAULT_GATE, ...config.gate };
    const graceWindow = config.graceWindowMs ?? 1500;
    const deepMode = config.deepMode ?? false;

    // Select providers: all registered, or subset via Query.providers filter.
    let allProviders = [...this.providers.values()];
    if (q.providers && q.providers.length > 0) {
      const allowed = new Set(q.providers);
      allProviders = allProviders.filter((p) => allowed.has(p.id));
    }
    if (allProviders.length === 0) {
      throw new Error("No providers registered");
    }

    // ADR-0006 decision 2C: reserve per-call budget by provider count (MoleAPI pre-consumption).
    const hasLedger = !!(this.ledger && this.sessionId);
    if (hasLedger) {
      // ADR-0006 2C: per-call cost = 1 unit per provider. Coarse upper bound, settle actual.
      // ADR-0022 P2-3 round-47 fix: answer mode doubles cost for answer-capable providers
      // (Exa answer() is a second upstream /answer call). Reserve 2 units per such provider
      // when mode === "answer"; other modes keep the 1-per-provider upper bound.
      const perCallEstimate = q.mode === "answer"
        ? allProviders.reduce((acc, p) => acc + (p.modes.includes("answer") ? 2 : 1), 0)
        : allProviders.length;
      const reserved = this.ledger!.reserveCalls(this.sessionId!, perCallEstimate);
      if (!reserved) {
        throw new Error("Budget exceeded: per-call cap reached (reserved " + perCallEstimate + " calls)");
      }
    }

    // atomcode research: per-provider AbortController + shared abort for grace window.
    const controllers = allProviders.map(() => new AbortController());
    const providerIds = allProviders.map((p) => p.id);

    // Fire all providers in parallel (atomcode research: attributed tasks).
    const promises = allProviders.map((p, i) =>
      p.search(q, controllers[i].signal)
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
    // ADR-0045 D2: ids + native scores parallel to providerLists (provenance snapshot inputs).
    const listedProviderIds: string[] = [];
    const nativeScores: Record<string, Record<string, number>> = {};
    const allResults = new Map<string, NormalizedResult>(); // keyed by normalized URL
    const providersQueried: string[] = [];
    const providersFailed: string[] = [];
    const providersCancelled: string[] = [];
    const answers: string[] = [];
    // ADR-0022 D3: per-provider attribution in metadata, not in answers[].
    const providerAnswers: ProviderAnswer[] = [];

    for (let i = 0; i < settled.length; i++) {
      const s = settled[i];
      providersQueried.push(providerIds[i]);
      if (s.status === "fulfilled") {
        // Inner promise fulfilled -> check provider result.
        const inner = (s as PromiseFulfilledResult<{ provider: string; status: string; envelope?: any; error?: string }>).value;
        if (inner.status === "fulfilled" && inner.envelope) {
          const urls: string[] = [];
          const native: Record<string, number> = {};
          for (const r of inner.envelope.results) {
            const norm = normalizeUrl(r.url);
            if (!allResults.has(norm)) {
              allResults.set(norm, { ...r, url: norm }); // store normalized URL as key
            }
            urls.push(norm);
            // ADR-0045 D2: web native-score snapshot (raw provider score; never fused).
            const ns = r.extra?.score;
            if (typeof ns === "number" && Number.isFinite(ns)) native[norm] = ns;
          }
          providerLists.push(urls);
          listedProviderIds.push(providerIds[i]);
          nativeScores[providerIds[i]] = native;
          if (inner.envelope.answers) {
            answers.push(...inner.envelope.answers);
            // ADR-0022 D3: prefer provider-supplied answersMeta (citations + verified=false);
            // fall back to re-deriving from answers with verified=false for older adapters.
            if (inner.envelope.answersMeta && inner.envelope.answersMeta.length === inner.envelope.answers.length) {
              for (const m of inner.envelope.answersMeta) providerAnswers.push(m);
            } else {
              for (const text of inner.envelope.answers) {
                providerAnswers.push({ provider: providerIds[i], text, verified: false });
              }
            }
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

    // ADR-0006 decision 2C: settle per-call budget — actual = successful providers.
    if (hasLedger) {
      this.ledger!.settleCalls(this.sessionId!, allProviders.length, providerLists.length);
    }

    // ADR-0045 D2/D4: WebFusion consumes the registry k and registered web weights (equal-weight
    // null model). A domain sources.weights value overrides per provider id (user preference);
    // unregistered/extra providers stay fail-open at weight 1.
    const fusedWeights = listedProviderIds.map((id) =>
      this.sourceWeights?.[id] ?? FUSION_REGISTRY.weights.web[id as keyof typeof FUSION_REGISTRY.weights.web] ?? 1);
    const rankedUrls = rrfRank(providerLists, FUSION_REGISTRY.k_fusion.web, fusedWeights);

    // ADR-0045 D2/D3: pre-truncation provenance snapshot — common six-field shape + web
    // nativeScores extension. scoreKind marks the fused score as a rank_fusion signal only
    // (never confidence / threshold / cross-query comparable); NormalizedResult stays clean.

    // Map back to NormalizedResult in ranked order.
    const rankedResults: NormalizedResult[] = [];
    for (const url of rankedUrls) {
      const r = allResults.get(url);
      if (r) {
        // Restore original URL for output.
        rankedResults.push({ ...r, url: String(r.extra?.originalUrl ?? r.url) });
      }
    }

    // ADR-0014 D7: single computation source, dual output (control + MVSS).
    // Dead booleans deleted; computeSufficiency() replaces scattered logic.
    const suff = computeSufficiency(rankedResults, providerLists, gate);

    const envelope: FusedEnvelope = {
      results: rankedResults,
      answers,
      metadata: {
        providersQueried,
        providersFailed,
        providersCancelled,
        elapsedMs: Date.now() - start,
        // ADR-0014 D3: MVSS four-segment sufficiency signal.
        sufficiency: suff.mvs,
        // ADR-0022 D3/D4: provenance + fail-open marker.
        providerAnswers,
        // ADR-0022 D4: capability marker — provider.modes covers answer mode.
        // Round-47 fix: not output-derived. providerAnswers.length > 0 reflects OUTPUT; if a
        // provider fails to produce an answer for this query (quota/exception/empty), the
        // CAPABILITY still exists; consumers should read this as "can serve answer mode"
        // and inspect providerAnswers (plus its length) for actually-returned answers.
        answersAvailable: allProviders.some((p) => p.modes.includes("answer")),
        fusion: {
          instance: "web",
          labels: [...listedProviderIds],
          lists: providerLists.map((l) => [...l]),
          weights: fusedWeights,
          fusedIds: [...rankedUrls],
          scoreKind: SCORE_KIND,
          nativeScores,
        },
      },
    };
    const attributionReport = attachAttribution(envelope);
    if (this.attributionJudge) {
      // Judge escalation is bounded inside applyJudgeEscalation (max 3 calls/envelope).
      await applyJudgeEscalation(attributionReport, this.attributionJudge);
    }
    return envelope;
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
