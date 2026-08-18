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
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
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
  anchor_type TEXT NOT NULL, -- "query" | "fetch" | "sufficiency"
  payload TEXT NOT NULL, -- JSON blob
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

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
  reserved_tokens INTEGER NOT NULL DEFAULT 0 CHECK (reserved_tokens >= 0),
  spent_tokens INTEGER NOT NULL DEFAULT 0 CHECK (spent_tokens >= 0),
  reserved_usd REAL NOT NULL DEFAULT 0 CHECK (reserved_usd >= 0),
  spent_usd REAL NOT NULL DEFAULT 0 CHECK (spent_usd >= 0),
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
