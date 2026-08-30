// Time Edge Effect: BM25 x freshness factor with tiered tau, fused recency+frequency reinforcement.
// ADR-0030: fused freshness factor band [0.3, 1.5] replaces ADR-0008 interpolation (w retired).
// References: Mem0 production band 0.3/1.5 (score factor docs), Mem0 issue #5330 half-life defaults,
// Zep bi-temporal invalidation, Google QDF (spike-driven, no year literals).

// Tiered half-life (tau) in days: news decays fast, evergreen decays slow.
export const TAU_TIER = {
  news: 7,       // 7d half-life for time-sensitive content
  docs: 30,      // 30d half-life for documentation
  evergreen: 90, // 90d half-life for evergreen content
} as const;

// Fused factor band (ADR-0030 D4/D6). Floor prevents zero-ing; ceiling prevents over-boost.
const FACTOR_FLOOR = 0.3;
const FACTOR_CEILING = 1.5;

// Reinforcement terms (ADR-0030 D3/D6, calibration-pending: ADR-0027 eval harness owns tuning).
// Recency dominant (max +0.35, 7d half-life); frequency capped at +0.15 (0.03 per access).
const RECENCY_MAX = 0.35;
const RECENCY_TAU_DAYS = 7;
const FREQ_STEP = 0.03;
const FREQ_CAP = 0.15;

// QDF keyword patterns (ADR-0030 D5): time-sensitive queries. No year literals — QDF is
// spike/hotness-driven, not a literal calendar match (year literals silently die at each rollover).
const QDF_KEYWORDS = /最新|最近|news|latest|recent|新闻|更新/i;
const EVERGREEN_KEYWORDS = /什么是|定义|概念|原理|解释|how does|what is|explain/i;

// Detect if query is time-sensitive (QDF classification).
export function isTimeSensitive(query: string): boolean {
  return QDF_KEYWORDS.test(query);
}

// Detect if query is evergreen (decay component bypassed; reinforcement still applies, ADR-0030 D4).
export function isEvergreen(query: string): boolean {
  return EVERGREEN_KEYWORDS.test(query);
}

// Classify content tier from URL/title/source.
export type ContentTier = "news" | "docs" | "evergreen";

export function classifyTier(title: string, url: string): ContentTier {
  const lower = (title + " " + url).toLowerCase();
  // ponytail: simple keyword-based classification. Upgrade to ML when needed.
  if (/news|blog|article|post|update|breaking/.test(lower)) return "news";
  if (/docs|documentation|guide|tutorial|reference/.test(lower)) return "docs";
  return "evergreen";
}

// Decay multiplier: exp(-age/tau), floored at 0.3. Returns [FACTOR_FLOOR, 1.0].
export function decayMultiplier(ageInDays: number, tier: ContentTier): number {
  if (!Number.isFinite(ageInDays) || ageInDays <= 0) return 1.0;
  const raw = Math.exp(-ageInDays / TAU_TIER[tier]);
  return Math.max(raw, FACTOR_FLOOR);
}

function sqliteTsToMs(ts: string | null): number | null {
  if (!ts || typeof ts !== "string") return null;
  const ms = new Date(ts.replace(" ", "T") + "Z").getTime();
  return Number.isFinite(ms) ? ms : null;
}

export interface FreshnessInput {
  createdAt: string;              // SQLite datetime('now') UTC
  lastAccessed: string | null;    // refreshed on recall hit (ADR-0009 D3 L2)
  accessCount: number;            // incremented exactly once per returned hit
  tier: ContentTier;
  pinned?: boolean;               // full bypass
  evergreenQuery?: boolean;       // decay-half bypass, reinforcement kept
  nowMs?: number;                 // test seam
}

// Fused freshness factor (ADR-0030 D2/D3/D4): ONE multiplicative band combining
//  creation-age decay, last-accessed recency, access-count frequency.
//  Bounds hold by construction: decay in [0.3, 1], reinforcement in [1, 1.5];
//  clamped to [0.3, 1.5] to stay safe under any input.
export function freshnessFactor(input: FreshnessInput): number {
  if (input.pinned) return 1.0;
  const now = input.nowMs ?? Date.now();
  const createdMs = sqliteTsToMs(input.createdAt);
  const ageDays = createdMs === null ? 0 : Math.max(0, (now - createdMs) / 86_400_000);
  const decay = input.evergreenQuery ? 1.0 : decayMultiplier(ageDays, input.tier);

  // Recency: fall back to creation age when never accessed.
  const accessedMs = sqliteTsToMs(input.lastAccessed);
  const recencyDays = accessedMs === null ? ageDays : Math.max(0, (now - accessedMs) / 86_400_000);
  const recencyBoost = RECENCY_MAX * Math.exp(-recencyDays / RECENCY_TAU_DAYS);
  const freqBoost = Math.min(FREQ_CAP, FREQ_STEP * Math.max(0, input.accessCount));
  const reinforcement = 1 + recencyBoost + freqBoost;

  const factor = decay * reinforcement;
  return Math.min(FACTOR_CEILING, Math.max(FACTOR_FLOOR, factor));
}

// Apply the fused factor to a BM25 score. SQLite bm25() returns negative scores
// (more negative = better match); multiplying by the factor moves worst -> least negative.
export function scoreWithFreshness(bm25Score: number, input: FreshnessInput): number {
  return bm25Score * freshnessFactor(input);
}

// Register freshness_factor custom function in better-sqlite3.
// ADR-0030 D2: supersedes time_decay (interpolation form retired with w).
// Usage: freshness_factor(bm25(fts), created_at, last_accessed, access_count, title, url, query, pinned)
export function registerFreshnessFactorFunction(db: import("better-sqlite3").Database): void {
  db.function("freshness_factor", { varargs: true }, (
    bm25Score: number,
    createdAt: string,
    lastAccessed: string | null,
    accessCount: number | null,
    title: string,
    url: string,
    query: string,
    pinned: number | undefined,
  ) => {
    return scoreWithFreshness(bm25Score, {
      createdAt,
      lastAccessed: typeof lastAccessed === "string" ? lastAccessed : null,
      accessCount: typeof accessCount === "number" ? accessCount : 0,
      tier: classifyTier(title, url),
      pinned: pinned === 1,
      evergreenQuery: isEvergreen(query),
    });
  });
}

// Bi-temporal invalidation: close old record's valid_until when new result for same entity arrives.
// Called at write time, not relying on decay to suppress staleness (ADR-0030 D1: explicit
// invalidation stays on the write path; soft decay is a ranking bias, never a filter).
export function invalidateOldRecords(
  db: import("better-sqlite3").Database,
  entityKey: string,
  newRecordId: number,
): void {
  // ponytail: entity matching is URL-based for MVP. Upgrade to entity extraction when needed.
  // Close all previous records with same URL that are still valid.
  db.prepare(
    "UPDATE retrieval_results SET valid_until = datetime('now') " +
    "WHERE url = ? AND id != ? AND valid_until IS NULL"
  ).run(entityKey, newRecordId);
}
