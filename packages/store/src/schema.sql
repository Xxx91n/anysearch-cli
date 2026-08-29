-- Session Store FTS5 schema.
-- Seam 4 from atomcode-kernel-split-architecture research.
-- Uses external content table (content=) to avoid duplicate storage.
-- WAL mode for CLI/MCP concurrency.

PRAGMA journal_mode = WAL;

-- Sessions table: one row per research session.
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  domain TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Messages table: conversation entries within a session.
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL, -- "user" | "assistant" | "tool"
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- FTS5 virtual table with external content (avoids storing content twice).
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  session_id UNINDEXED,
  role UNINDEXED,
  content,
  content='messages',
  content_rowid='id'
);

-- Triggers to keep FTS index in sync with messages table.
CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, session_id, role, content)
  VALUES (new.id, new.session_id, new.role, new.content);
END;

CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, session_id, role, content)
  VALUES('delete', old.id, old.session_id, old.role, old.content);
END;

CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, session_id, role, content)
  VALUES('delete', old.id, old.session_id, old.role, old.content);
  INSERT INTO messages_fts(rowid, session_id, role, content)
  VALUES (new.id, new.session_id, new.role, new.content);
END;

-- Retrieval results table: consolidated search results per session.
CREATE TABLE IF NOT EXISTS retrieval_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  title TEXT,
  snippet TEXT,
  source TEXT, -- provider id
  rrf_score REAL,
  fetched BOOLEAN DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- G019: Time Edge Effect columns.
  valid_until TEXT, -- bi-temporal: NULL = still valid, non-null = invalidated timestamp.
  pinned BOOLEAN DEFAULT 0, -- pinned exemption: bypasses time decay.
  entity TEXT -- entity key for bi-temporal invalidation (URL for MVP).
);

-- FTS5 for retrieval results (search within session results).
CREATE VIRTUAL TABLE IF NOT EXISTS retrieval_results_fts USING fts5(
  session_id UNINDEXED,
  title,
  snippet,
  content='retrieval_results',
  content_rowid='id'
);

CREATE TRIGGER IF NOT EXISTS retrieval_ai AFTER INSERT ON retrieval_results BEGIN
  INSERT INTO retrieval_results_fts(rowid, session_id, title, snippet)
  VALUES (new.id, new.session_id, new.title, new.snippet);
END;

CREATE TRIGGER IF NOT EXISTS retrieval_ad AFTER DELETE ON retrieval_results BEGIN
  INSERT INTO retrieval_results_fts(retrieval_results_fts, rowid, session_id, title, snippet)
  VALUES('delete', old.id, old.session_id, old.title, old.snippet);
END;

-- Resume anchors: checkpoint state for resume anchoring on timeout/crash.
CREATE TABLE IF NOT EXISTS resume_anchors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  anchor_type TEXT NOT NULL, -- "query" | "fetch" | "sufficiency" | "consolidation_state" | "rolling_summary"
  payload TEXT NOT NULL, -- JSON blob
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- ADR-0016 D10 audit: partial UNIQUE INDEX for state-type anchors (consolidation_state).
-- Allows INSERT ... ON CONFLICT DO UPDATE (atomic UPSERT, SQLite 3.24.0+).
-- Historical anchors (rolling_summary, query, fetch, sufficiency) remain append-only.
CREATE UNIQUE INDEX IF NOT EXISTS idx_anchors_state_unique ON resume_anchors(session_id, anchor_type) WHERE anchor_type = 'consolidation_state';

-- Budget Ledger: Mole reserve-then-settle pattern (ADR-0005 decision 4).
-- Non-negative constraints in DB schema layer (not application layer).
-- Budget = resource consumption, belongs to store layer (not kernel).
-- Three dimensions: token-cap / usd-cap / time-limit (ADR-0005).
CREATE TABLE IF NOT EXISTS budget_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  token_cap INTEGER NOT NULL DEFAULT 0 CHECK (token_cap >= 0),
  usd_cap REAL NOT NULL DEFAULT 0 CHECK (usd_cap >= 0),
  time_limit_ms INTEGER NOT NULL DEFAULT 0 CHECK (time_limit_ms >= 0),
  call_cap INTEGER NOT NULL DEFAULT 0 CHECK (call_cap >= 0),
  reserved_tokens INTEGER NOT NULL DEFAULT 0 CHECK (reserved_tokens >= 0),
  spent_tokens INTEGER NOT NULL DEFAULT 0 CHECK (spent_tokens >= 0),
  reserved_usd REAL NOT NULL DEFAULT 0 CHECK (reserved_usd >= 0),
  spent_usd REAL NOT NULL DEFAULT 0 CHECK (spent_usd >= 0),
  -- ADR-0006 decision 2B: per-call billing dimension (reserved_calls + billable_calls).
  reserved_calls INTEGER NOT NULL DEFAULT 0 CHECK (reserved_calls >= 0),
  billable_calls INTEGER NOT NULL DEFAULT 0 CHECK (billable_calls >= 0),
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- G019 migration: add time edge effect columns to existing retrieval_results table.
-- ALTER TABLE ADD COLUMN is idempotent-safe: errors if column already exists, caught by try/catch in SessionStore constructor.
-- These run after the CREATE TABLE IF NOT EXISTS, so new databases already have the columns.
-- For existing databases, these add the missing columns.

-- ADR-0024 D1/D2: T0 hot zone durable preference layer.
-- t0_preferences is the single source of truth; MEMORY.md is a regenerated materialized projection
-- (temp+fsync+rename atomic write in kernel t0-projection.ts). scope: 'global' | project root path.
-- correction_count drives the C-prime promote gate (>=2 cross-session corrections = implicit promote).
-- invalid_at non-null = demoted (d-i conflict / d-iii /forget / d-ii eviction); row quarantined, never dropped.
CREATE TABLE IF NOT EXISTS t0_preferences (
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'global',
  modified TEXT NOT NULL DEFAULT (datetime('now')),
  last_accessed TEXT NOT NULL DEFAULT (datetime('now')),
  source TEXT NOT NULL,
  invalid_at TEXT,
  demote_reason TEXT,
  correction_count INTEGER NOT NULL DEFAULT 0,
  provenance TEXT,
  PRIMARY KEY (key, scope)
);
-- ADR-0031 D3: Entity link layer. Global (session-agnostic) entity registry.
-- Reuses bi-temporal discipline: valid_until NULL = live. Soft-close only, never DELETE.
CREATE TABLE IF NOT EXISTS entities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,            -- display name as first asserted
  name_norm TEXT NOT NULL,       -- normalized match key (lowercase, edge punctuation stripped)
  entity_type TEXT NOT NULL,     -- url | handle | phrase | ident | declared (type gate: cross-type never merges at fuzzy tiers)
  aliases TEXT NOT NULL DEFAULT '[]', -- JSON array of normalized alias strings
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  valid_until TEXT
);
-- Partial unique index: one live entity per (name_norm, entity_type). Closed rows do not block re-creation.
CREATE UNIQUE INDEX IF NOT EXISTS idx_entities_norm_type ON entities(name_norm, entity_type) WHERE valid_until IS NULL;

-- Memory-to-entity link. Composite unique key keeps writes idempotent (INSERT OR IGNORE).
CREATE TABLE IF NOT EXISTS memory_entity (
  memory_id INTEGER NOT NULL REFERENCES retrieval_results(id) ON DELETE CASCADE,
  entity_id INTEGER NOT NULL REFERENCES entities(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (memory_id, entity_id)
);

-- ADR-0031 D5 + ADR-0032: merge decision log — alias append, destructive merge (full snapshot),
-- candidate review belt (hit_count re-hit escalation), and unmerge override records.
-- kind: 'alias' | 'candidate' | 'merge' | 'override'
-- merge rows carry a complete snapshot in detail: fromEntityId, fromName, fromNorm, fromAliases,
-- toAliasesBefore, redirectedMemoryIds, mergedAt (the sole basis for bounded unmerge).
CREATE TABLE IF NOT EXISTS entity_merge_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  source_name TEXT NOT NULL,     -- the variant text that triggered the merge decision
  target_entity_id INTEGER NOT NULL REFERENCES entities(id),
  detail TEXT,                   -- JSON: similarity, tier, snapshot (kind='merge'), etc.
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  undone INTEGER NOT NULL DEFAULT 0,
  -- ADR-0032 D3: review belt — re-hit counter (>=2 = suggested review) and resolution outcome.
  hit_count INTEGER NOT NULL DEFAULT 1,
  resolved TEXT                  -- NULL = pending; 'confirmed' | 'rejected' after review
);

-- ADR-0033 D4: vector semantic arm side table. BLOB = Float32Array bytes (384 dims, q8 model output).
-- No index: full-scan JS cosine is the designed path (<50k vectors). pendingVectors = retrieval_results rows
-- lacking a matching row here (embedded at write; backfilled by `ans memory backfill-vectors`).
CREATE TABLE IF NOT EXISTS memory_embeddings (
  memory_id INTEGER PRIMARY KEY REFERENCES retrieval_results(id) ON DELETE CASCADE,
  embedding BLOB NOT NULL,
  model TEXT NOT NULL,
  embedded_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ADR-0035 D1/D2: KG-lite entity-relation edge layer (fifth retrieval arm).
-- Closed predicate set enforced by CHECK; bi-temporal soft-close (valid_until); the partial
-- unique index keeps one live row per (source, relation, target); re-assertion supersedes.
CREATE TABLE IF NOT EXISTS edges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_entity_id INTEGER NOT NULL REFERENCES entities(id),
  target_entity_id INTEGER NOT NULL REFERENCES entities(id),
  relation TEXT NOT NULL CHECK (relation IN ('works_on','depends_on','uses','part_of','member_of','located_at','authored_by','related_to')),
  description TEXT,
  confidence REAL NOT NULL DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
  episode_memory_id INTEGER REFERENCES retrieval_results(id) ON DELETE CASCADE,
  rules_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  valid_until TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_edges_active_triple ON edges(source_entity_id, relation, target_entity_id) WHERE valid_until IS NULL;
CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_entity_id) WHERE valid_until IS NULL;
CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_entity_id) WHERE valid_until IS NULL;
CREATE INDEX IF NOT EXISTS idx_edges_episode ON edges(episode_memory_id);

-- Edge-pattern constraint table (LlamaIndex edge_pattern style): allowed
-- (head_type, relation, tail_type) triples; '*' wildcard. Seeded from relation.ts
-- EDGE_PATTERN_ROWS via INSERT OR IGNORE at store construction.
CREATE TABLE IF NOT EXISTS edge_patterns (
  head_type TEXT NOT NULL,
  relation TEXT NOT NULL,
  tail_type TEXT NOT NULL,
  UNIQUE (head_type, relation, tail_type)
);
