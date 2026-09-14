// Retroaererd Engine: bounded budget + serialized sufficiency-gate + fanout convergence + RRF fusion.
// ADR-0005 decision 4: Budget in store layer (BudgetLedger), sufficiency gate in retriever fanout layer.
// atomcode research (paperfoot source-level): JoinSet completion-order collect, enough-results-then-collect,
// 1.5s grace window, abort_all + drain, providers_cancelled distinct state, RRF(k=60) fusion.
// JS adaptation: Promise.allSettled + AbortController + unique-URL counter early stop.

import type { SearchProvider, SearchRequest, NormalizedResult, FusedEnvelope, SufficiencySignal, ProviderAnswer, WebProviderLedger, ProviderEnvelope } from "@anysearch/retriever";
import { rrfRank, FUSION_REGISTRY, SCORE_KIND, sanitizeRetrieved, shouldAllowUrl } from "@anysearch/retriever";
import { randomUUID } from "node:crypto";
import type { Budget, Query, RetrieverPort } from "./ports";
import type { BudgetLedgerPort } from "./ports";
import { attachAttribution, applyJudgeEscalation, type JudgeFn } from "./attribution";
import type { AttributionCalibration } from "./calibrate";

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

// ponytail: Resume Anchoring on timeout/crash is not implemented - resume_anchors exists in the store schema but this engine never writes a checkpoint (no replay/recovery wiring). | Implement when long-running research sessions need crash recovery
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

// ADR-0062 D2 (T2): post-filter adjudication — reuses shouldAllowUrl so the gate
// shares the store-level policy semantics (deny evaluated first; an allow entry
// matches host or subdomain suffix; the user-labelled early-allow branch is
// irrelevant because the label here is always "retrieved"). Scheme-less
// normalized URLs get an https:// prefix so URL parsing sees the same host.
function adjudicateUrlPolicy(
  url: string,
  policy: { allow: readonly string[]; deny: readonly string[] },
): boolean {
  const withScheme = url.includes("://") ? url : "https://" + url;
  return shouldAllowUrl(
    withScheme,
    { source: "retrieved", traceId: "domain-filter" },
    policy.allow,
    policy.deny,
  ).allowed;
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
  // ADR-0051 D1: active attribution calibration, injected once by the composition
  // root (which owns the revision-root file I/O). Absent = legacy 0.6 floor.
  private attributionCalibration?: AttributionCalibration;
  // ADR-0062 D2 (T2): request-time domain URL policy resolver (allow/deny/
  // policyVersion) + active domain name for audit attributes. Absent resolver or
  // empty allow = domain filtering inactive (full fanout, legacy behavior). The
  // resolver is invoked inside every search() — no cached policy snapshot lives
  // in the retriever (AFR tag-freshness lesson: 9.7% re-leak on stale snapshots).
  private urlPolicy?: () => { allow: readonly string[]; deny: readonly string[]; policyVersion: string };
  private domainName?: string;

  // ADR-0006 decision 1C: constructor accepts providers array.
  // ADR-0006 decision 2A: optional BudgetLedger + sessionId for per-call billing.
  constructor(providers: SearchProvider[] = [], opts?: { ledger?: BudgetLedgerPort; sessionId?: string; attributionJudge?: JudgeFn; sourceWeights?: Record<string, number>; attributionCalibration?: AttributionCalibration; urlPolicy?: () => { allow: readonly string[]; deny: readonly string[]; policyVersion: string }; domainName?: string }) {
    this.ledger = opts?.ledger;
    this.sessionId = opts?.sessionId;
    this.attributionJudge = opts?.attributionJudge;
    this.sourceWeights = opts?.sourceWeights;
    // ADR-0051 D1: immutable at the injection seam, even when the caller
    // bypasses the composition root.
    const cal = opts?.attributionCalibration;
    this.attributionCalibration = cal
      ? Object.freeze({ params: Object.freeze({ ...cal.params }), thresholds: Object.freeze({ ...cal.thresholds }) })
      : undefined;
    this.urlPolicy = opts?.urlPolicy;
    this.domainName = opts?.domainName;
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
    const retrievalTraceId = randomUUID().replace(/-/g, "");

    // Select providers: all registered, or subset via Query.providers filter.
    let allProviders = [...this.providers.values()];
    if (q.providers && q.providers.length > 0) {
      const allowed = new Set(q.providers);
      allProviders = allProviders.filter((p) => allowed.has(p.id));
    }
    if (allProviders.length === 0) {
      throw new Error("No providers registered");
    }

    // ADR-0062 D2 (T2): domain policy resolved per request — the resolver reads
    // the ADR-0055 single source via a lazy-mtime reloader; nothing is cached in
    // the retriever. Empty allow = policy inactive (fail-open full fanout).
    const domainPolicy = this.urlPolicy?.() ?? null;
    const domainActive = !!domainPolicy && domainPolicy.allow.length > 0;
    // Capability-negotiated pre-filter: includeDomains is sent only to providers
    // that declare domainFilterSupported; the rest degrade to post-filter-only
    // and are named in the pre audit event (no faked filtering).
    const sentProviders = domainActive
      ? allProviders.filter((p) => p.domainFilterSupported).map((p) => p.id)
      : [];
    const degradedProviders = domainActive
      ? allProviders.filter((p) => !p.domainFilterSupported).map((p) => p.id)
      : [];
    if (domainActive) {
      q.span?.addEvent("retrieval.domain_filter.pre", {
        "anysearch.domain": this.domainName ?? "",
        "anysearch.policy_version": domainPolicy.policyVersion,
        "anysearch.domain_filter.allow_count": domainPolicy.allow.length,
        "anysearch.domain_filter.deny_count": domainPolicy.deny.length,
        "anysearch.domain_filter.sent": sentProviders,
        "anysearch.domain_filter.degraded": degradedProviders,
      });
    }
    // Provider-facing request carries only SearchRequest fields — kernel-side
    // Query extras (budget/providers/span) never cross the provider boundary.
    const providerRequest = (p: SearchProvider): SearchRequest => {
      const req: SearchRequest = { query: q.query, mode: q.mode };
      if (q.maxResults !== undefined) req.maxResults = q.maxResults;
      if (domainActive && p.domainFilterSupported) req.includeDomains = [...domainPolicy.allow];
      return req;
    };

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

    // ADR-0061 G1: graceWindowMs / deepMode are wired now (was ADR-0014/ADR-0059 debt).
    // Each provider outcome lands in out[i] on arrival. Once the fused pool covers
    // q.maxResults unique URLs, stragglers get graceWindowMs, then their controllers
    // abort and they surface as providersCancelled. deepMode never cancels (waits all).
    // A rejected provider counts as arrived — failure is a completed fanout answer.
    type ProviderOutcome =
      | { provider: string; status: "fulfilled"; envelope: ProviderEnvelope }
      | { provider: string; status: "rejected"; error: string };
    const out: Array<ProviderOutcome | null> = new Array(allProviders.length).fill(null);
    const uniqueUrls = new Set<string>();
    // ADR-0062 D2: post-gate counters — gateIn = raw provider results that reached
    // the authoritative gate (post-pre-filter arrivals); gateDropped counts only
    // gate removals (dedup collapse must not inflate it); survivors = allResults.size.
    let gateIn = 0;
    let gateDropped = 0;
    let gateSurvivors = 0;
    const needed = Math.max(1, q.maxResults ?? 10);
    let graceResolve: () => void = () => { };
    const graceExpired = new Promise<void>((r) => { graceResolve = r; });
    let graceArmed = false;
    const promises = allProviders.map((p, i) =>
      p.search(providerRequest(p), controllers[i].signal)
        .then((env) => {
          out[i] = { provider: p.id, status: "fulfilled", envelope: env };
          // Grace-window enough-results counts only what would survive the gate —
          // otherwise an all-out-of-domain fanout could end the wait early.
          for (const r of env.results ?? []) {
            if (domainActive && !adjudicateUrlPolicy(r.url, domainPolicy)) continue;
            uniqueUrls.add(normalizeUrl(r.url));
          }
          if (!deepMode && !graceArmed && uniqueUrls.size >= needed) {
            graceArmed = true;
            setTimeout(() => {
              for (let j = 0; j < controllers.length; j++) if (out[j] == null) controllers[j].abort();
              graceResolve();
            }, graceWindow).unref();
          }
        })
        .catch((err) => {
          out[i] = { provider: p.id, status: "rejected", error: String(err) };
        }),
    );

    // Wait for every provider, or for the grace window once enough unique results exist.
    await Promise.race([Promise.all(promises).then(() => undefined), graceExpired]);
    // Cancelled = queried but still unsettled when the grace window closed.
    // Array.prototype.map skips sparse holes — fill(null) keeps every slot materialized.
    const collected: Array<ProviderOutcome | "cancelled"> = out.map((w) => w ?? "cancelled");

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

    for (let i = 0; i < collected.length; i++) {
      const s = collected[i];
      providersQueried.push(providerIds[i]);
      if (s === "cancelled") {
        providersCancelled.push(providerIds[i]);
        continue;
      }
      {
        // Inner outcome: provider resolved (fulfilled) or threw (rejected).
        const inner = s;
        if (inner.status === "fulfilled" && inner.envelope) {
          const urls: string[] = [];
          const native: Record<string, number> = {};
          for (const original of inner.envelope.results) {
            gateIn += 1;
            const trusted = sanitizeRetrieved({
              url: original.url,
              title: original.title,
              snippet: original.snippet,
              entity: original.entity,
              source: original.source,
              label: { source: "retrieved", traceId: retrievalTraceId },
            });
            const r: NormalizedResult = {
              ...original,
              url: trusted.content.url,
              title: trusted.content.title,
              snippet: trusted.content.snippet,
              ...(trusted.content.entity !== undefined ? { entity: trusted.content.entity } : {}),
              extra: {
                ...(original.extra ?? {}),
                trustLabel: trusted.content.label,
                trustDisposal: trusted.content.disposal,
                trustSuspicious: trusted.suspicious,
              },
            };
            // ADR-0062 D2 (T2): authoritative egress gate — adjudicated on the
            // sanitized result URL so out-of-domain entries never reach fusion,
            // MVSS, attribution, or output. Deny wins (shouldAllowUrl order).
            if (domainActive && !adjudicateUrlPolicy(r.url, domainPolicy)) { gateDropped += 1; continue; }
            gateSurvivors += 1;
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
      }
    }

    // providersCancelled now populated by the grace window above (was always-empty debt).

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

    // Map back to NormalizedResult in full ranked order.
    const fullRankedResults: NormalizedResult[] = [];
    for (const url of rankedUrls) {
      const r = allResults.get(url);
      if (r) {
        // Restore original URL for output.
        fullRankedResults.push({ ...r, url: String(r.extra?.originalUrl ?? r.url) });
      }
    }

    // ADR-0045 D3: top-k is a pure prefix truncation. MVSS still sees the full fused pool.
    const rankedResults = q.maxResults && q.maxResults > 0
      ? fullRankedResults.slice(0, q.maxResults)
      : fullRankedResults;

    // ADR-0014 D7: single computation source, dual output (control + MVSS).
    // Dead booleans deleted; computeSufficiency() replaces scattered logic.
    const suff = computeSufficiency(fullRankedResults, providerLists, gate);

    // ADR-0046 D5: observational-only ledger. It is emitted next to, never consumed
    // by, the sufficiency/fusion gate.
    const webProviderLedger = buildWebProviderLedger(listedProviderIds, providerLists, nativeScores, providersFailed);

    // ADR-0062 D2/D3 (T2): post-gate audit event + outcome dimension. abstain is
    // its own outcome value on the span — criterion 6 keeps it out of error counts.
    if (domainActive) {
      const outcome = allResults.size === 0 ? "abstain" : "answer";
      q.span?.addEvent("retrieval.domain_filter.post", {
        "anysearch.domain": this.domainName ?? "",
        "anysearch.policy_version": domainPolicy.policyVersion,
        "anysearch.domain_filter.pre": gateIn,
        // survivors counted at the gate (pre-dedup) so pre = post + dropped
        // arithmetically closes; allResults.size stays the fused unique pool.
        "anysearch.domain_filter.post": gateSurvivors,
        "anysearch.domain_filter.dropped": gateDropped,
        "anysearch.outcome": outcome,
      });
      q.span?.setAttributes?.({ "anysearch.outcome": outcome });
    }

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
        observational: { webProviderLedger },
        // ADR-0062 D3 (T2): first-class abstain marker — domain_filter_empty when
        // the authoritative gate leaves zero results (empty post-gate pool is
        // structurally abstain; eval/abstain.ts chain_empty is the sibling rule,
        // shouldBridgeToAbstain is the weak-claims counterpart). Never an error.
        ...(domainActive && allResults.size === 0
          ? { abstain: { abstain: true as const, reason: "domain_filter_empty" as const, ...(this.domainName ? { domain: this.domainName } : {}), preFiltered: gateIn, postFiltered: 0, gate: gateIn === 0 ? "pre" as const : "post" as const } }
          : {}),
      },
    };
    // ADR-0051 D1/D2: claim-level fused confidence is the only calibrated object;
    // an absent or degraded calibration keeps the legacy 0.6 floor.
    const attributionReport = attachAttribution(
      envelope,
      this.attributionCalibration ? { calibration: this.attributionCalibration } : undefined,
    );
    if (this.attributionJudge) {
      // Judge escalation is bounded inside applyJudgeEscalation (max 3 calls/envelope).
      await applyJudgeEscalation(attributionReport, this.attributionJudge);
    }
    return envelope;
  }
}

function buildWebProviderLedger(
  providerIds: string[],
  providerLists: string[][],
  nativeScores: Record<string, Record<string, number>>,
  providersFailed: string[],
): WebProviderLedger {
  const providerOverlap: Record<string, number> = {};
  const exclusiveHits: Record<string, number> = {};
  const nativeScoresMissing: Record<string, number> = {};
  const sets = providerLists.map((list) => new Set(list));
  for (let i = 0; i < providerIds.length; i++) {
    const pid = providerIds[i]!;
    let exclusive = 0;
    let missing = 0;
    for (const url of sets[i]!) {
      let seenElsewhere = false;
      for (let j = 0; j < sets.length; j++) {
        if (j !== i && sets[j]!.has(url)) {
          seenElsewhere = true;
          const other = providerIds[j]!;
          const pair = [pid, other].sort().join("|");
          providerOverlap[pair] = (providerOverlap[pair] ?? 0) + 1;
        }
      }
      if (!seenElsewhere) exclusive += 1;
      if (typeof nativeScores[pid]?.[url] !== "number") missing += 1;
    }
    exclusiveHits[pid] = exclusive;
    nativeScoresMissing[pid] = missing;
  }
  return { providerOverlap, exclusiveHits, nativeScoresMissing, failures: [...providersFailed] };
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
