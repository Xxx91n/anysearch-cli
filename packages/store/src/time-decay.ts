// Time Edge Effect: BM25 × exp(-Δt/τ) with tiered τ, QDF, bi-temporal, pinned.
// ADR-0008 D2: Full three-layer (Scheme C).
// References: Mem0 Memory Decay, Zep bi-temporal, Google QDF, OpenClaw #5547.

// Tiered half-life (τ) in days: news decays fast, evergreen decays slow.
const TAU_TIER = {
  news: 7,       // 7d half-life for time-sensitive content
  docs: 30,      // 30d half-life for documentation
  evergreen: 90, // 90d half-life for evergreen content
} as const;

// Decay weight w: how much decay affects final score (0=ignore, 1=pure decay).
// ADR-0008 D2: w=0.15~0.4, we use 0.25 as default.
const DEFAULT_W = 0.25;

// Floor: minimum decay multiplier (prevents very old content from being completely zeroed).
const FLOOR = 0.3;

// QDF keyword patterns: time-sensitive queries get freshness boost.
const QDF_KEYWORDS = /最新|最近|news|2024|2025|2026|latest|recent|新闻|更新/i;
const EVERGREEN_KEYWORDS = /什么是|什么是X|定义|概念|原理|解释|how does|what is|explain/i;

// Detect if query is time-sensitive (QDF classification).
export function isTimeSensitive(query: string): boolean {
  return QDF_KEYWORDS.test(query);
}

// Detect if query is evergreen (decay should be disabled).
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

// Calculate time decay multiplier: exp(-Δt/τ).
// ageInDays: days since content was created/indexed.
// tier: content tier determines τ.
// Returns multiplier between FLOOR and 1.0.
export function decayMultiplier(ageInDays: number, tier: ContentTier): number {
  const tau = TAU_TIER[tier];
  const raw = Math.exp(-ageInDays / tau);
  return Math.max(raw, FLOOR);
}

// Apply time edge effect to BM25 score.
// bm25Score: raw BM25 score from FTS5 (lower = better in SQLite bm25() convention).
// We invert bm25 (SQLite returns negative for better matches) and apply decay.
// ageInDays: days since content was created.
// tier: content tier.
// query: original query (for QDF).
// pinned: if true, bypass decay.
export function applyTimeEdgeEffect(
  bm25Score: number,
  ageInDays: number,
  tier: ContentTier,
  query: string,
  pinned: boolean = false,
): number {
  // Pinned exemption: bypass all decay.
  if (pinned) return bm25Score;

  // Evergreen query: disable decay.
  if (isEvergreen(query)) return bm25Score;

  // Time-sensitive query: boost freshness (stronger decay).
  const w = isTimeSensitive(query) ? 0.4 : DEFAULT_W;

  // SQLite bm25() returns negative scores (more negative = better match).
  // We want to penalize old content by making it less negative (worse).
  // decayFactor in [FLOOR, 1.0]: 1.0 = no decay, FLOOR = max decay.
  const decay = decayMultiplier(ageInDays, tier);

  // Apply: adjusted = bm25 * (1 - w * (1 - decay))
  // This makes old content's score less negative (worse) proportionally.
  const factor = 1 - w * (1 - decay);
  return bm25Score * factor;
}

// Register time_decay custom function in better-sqlite3.
// Usage: SELECT bm25(fts) as rank, time_decay(bm25(fts), created_at, title, url, query, pinned) as adjusted
export function registerTimeDecayFunction(db: import("better-sqlite3").Database): void {
  db.function("time_decay", {
    varargs: true,
    deterministic: true,
  }, (bm25Score: number, createdAt: string, title: string, url: string, query: string, pinned: number | undefined) => {
    const ageMs = Date.now() - new Date(createdAt + "Z").getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    const tier = classifyTier(title, url);
    return applyTimeEdgeEffect(bm25Score, ageDays, tier, query, pinned === 1);
  });
}

// Bi-temporal invalidation: close old record's valid_until when new result for same entity arrives.
// Called at write time, not relying on decay to suppress staleness.
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
