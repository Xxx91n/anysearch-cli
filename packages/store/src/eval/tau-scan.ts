// ADR-0039 D3: tau sensitivity scan — replays the production freshness scoring function
// over a memory row set with candidate tau tables, reporting RANK-DISPLACEMENT distributions
// only (Kendall-tau + position-shift histogram). Never hit-rate (circular per Hu/Koren 2008,
// Joachims 2002). Zero look-ledger contact: this module never touches the eval runner.
import { freshnessFactor, classifyTier, isEvergreen, TAU_TIER, type TauTable, type ContentTier } from "../time-decay";
import { bucketHistogram } from "./day-buckets";

// Same mulberry32 as eval/gate.ts (deterministic seeded RNG precedent).
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface TauScanRow {
  id: number;
  title: string;
  url: string;
  ageDays: number;        // age at scan time (pre-reserved age_at_access interface, ADR-0039 D1)
  lastAccessedAgeDays: number | null;
  accessCount: number;
  pinned?: boolean;
}

// Rank row ids (best first) for one query under one tau table. Base score is held constant:
// the scan isolates the freshness factor contribution (tau is the only moving part).
export function rankForTau(rows: readonly TauScanRow[], query: string, taus: TauTable, now: number): number[] {
  const evergreen = isEvergreen(query);
  const scored = rows.map((r) => {
    const factor = freshnessFactor({
      createdAt: r.ageDays < 0 ? "bad" : daysAgoTimestamp(r.ageDays, now),
      lastAccessed: r.lastAccessedAgeDays === null ? null : daysAgoTimestamp(Math.max(0, r.lastAccessedAgeDays), now),
      accessCount: r.accessCount,
      tier: classifyTier(r.title, r.url) as ContentTier,
      pinned: r.pinned ?? false,
      evergreenQuery: evergreen,
      taus,
      nowMs: now,
    });
    return { id: r.id, score: factor };
  });
  // Stable order: score desc, then id asc — replay must be deterministic (no tie wobble).
  scored.sort((a, b) => b.score - a.score || a.id - b.id);
  return scored.map((s) => s.id);
}

function daysAgoTimestamp(days: number, now: number): string {
  const d = new Date(now - days * 86_400_000);
  return d.toISOString().slice(0, 19).replace("T", " ");
}

// Kendall tau-b over equal-length permutations: 1 = identical, -1 = fully reversed.
export function kendallTau(a: readonly number[], b: readonly number[]): number {
  const posB = new Map(b.map((id, i) => [id, i]));
  let concordant = 0;
  let discordant = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = i + 1; j < a.length; j++) {
      const pb = posB.get(a[j]!)! - posB.get(a[i]!)!;
      if (pb > 0) concordant++;
      else if (pb < 0) discordant++;
    }
  }
  const n = a.length;
  const denom = (n * (n - 1)) / 2;
  return denom === 0 ? 1 : (concordant - discordant) / denom;
}

// |posA - posB| per row id.
export function positionShift(a: readonly number[], b: readonly number[]): number[] {
  const posB = new Map(b.map((id, i) => [id, i]));
  return a.map((id, i) => Math.abs(i - posB.get(id)!));
}

export interface TauScanReportRow {
  factor: number;
  taus: TauTable;
  kendallMean: number;
  kendallMin: number;
  positionShiftMean: number;
  positionShiftMax: number;
}

export interface TauScanReport {
  schema: "anysearch/tau-scan@1";
  baseline: TauTable;
  rows: number;
  queries: number;
  ageHistogram: Record<string, number>;
  candidates: TauScanReportRow[];
}

export function scanTau(rows: readonly TauScanRow[], queries: readonly string[], factors: readonly number[], now: number): TauScanReport {
  const baseTaus: TauTable = { news: TAU_TIER.news, docs: TAU_TIER.docs, evergreen: TAU_TIER.evergreen };
  const baseRanks = queries.map((q) => rankForTau(rows, q, baseTaus, now));
  const candidates: TauScanReportRow[] = [];
  for (const f of factors) {
    const taus: TauTable = { news: baseTaus.news * f, docs: baseTaus.docs * f, evergreen: baseTaus.evergreen * f };
    const ks: number[] = [];
    const shifts: number[] = [];
    for (let qi = 0; qi < queries.length; qi++) {
      const cand = rankForTau(rows, queries[qi]!, taus, now);
      ks.push(kendallTau(baseRanks[qi]!, cand));
      shifts.push(...positionShift(baseRanks[qi]!, cand));
    }
    candidates.push({
      factor: f,
      taus,
      kendallMean: ks.length ? ks.reduce((x, y) => x + y, 0) / ks.length : 1,
      kendallMin: ks.length ? Math.min(...ks) : 1,
      positionShiftMean: shifts.length ? shifts.reduce((x, y) => x + y, 0) / shifts.length : 0,
      positionShiftMax: shifts.length ? Math.max(...shifts) : 0,
    });
  }
  return {
    schema: "anysearch/tau-scan@1",
    baseline: baseTaus,
    rows: rows.length,
    queries: queries.length,
    ageHistogram: bucketHistogram(rows.map((r) => r.ageDays)),
    candidates,
  };
}

// Seeded synthetic corpus for standalone scans/tests (replay determinism anchor).
export function syntheticRows(seed: number, n: number): TauScanRow[] {
  const rnd = mulberry32(seed);
  const urls = ["news", "docs", "blog"] as const;
  const out: TauScanRow[] = [];
  for (let i = 1; i <= n; i++) {
    const age = Math.floor(rnd() * 200);
    out.push({
      id: i,
      title: urls[i % urls.length]! + " item " + i,
      url: "https://example.com/" + urls[i % urls.length] + "/" + i,
      ageDays: age,
      lastAccessedAgeDays: rnd() < 0.5 ? null : Math.floor(rnd() * Math.max(1, age)),
      accessCount: Math.floor(rnd() * 8),
    });
  }
  return out;
}
