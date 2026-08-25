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