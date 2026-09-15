// ProjectIndexStore: per-project FTS5 index, physically separate from SessionStore.
// ADR-0009 Decision 4: Physical dual-DB. Internal agent reads this only (read-only).
// Written by hooks layer via IPC to long-running MCP server (ADR-0009 Decision 1+2).

import Database from "better-sqlite3";
import { fts5EscapeQuery } from "@anysearch-cli/store";

export interface ProjectIndexEntry {
  rowid: number;
  projectPath: string;
  toolName: string;
  queryHash: string;
  title: string;
  url: string;
  snippet: string;
  source: string;
  contentHash: string;
  createdAt: string;
}

export interface ProjectIndexHit {
  rowid: number;
  title: string;
  url: string;
  snippet: string;
  source: string;
  rank: number;
  createdAt: string;
}

const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS project_index (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_path TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  query_hash TEXT,
  title TEXT,
  url TEXT,
  snippet TEXT,
  source TEXT,
  content_hash TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE VIRTUAL TABLE IF NOT EXISTS project_index_fts USING fts5(
  project_path UNINDEXED,
  tool_name UNINDEXED,
  title,
  url,
  snippet,
  source,
  content='project_index',
  content_rowid='id'
);

CREATE TRIGGER IF NOT EXISTS project_index_ai AFTER INSERT ON project_index BEGIN
  INSERT INTO project_index_fts(rowid, project_path, tool_name, title, url, snippet, source)
  VALUES (new.id, new.project_path, new.tool_name, new.title, new.url, new.snippet, new.source);
END;

CREATE TRIGGER IF NOT EXISTS project_index_ad AFTER DELETE ON project_index BEGIN
  INSERT INTO project_index_fts(project_index_fts, rowid, project_path, tool_name, title, url, snippet, source)
  VALUES ('delete', old.id, old.project_path, old.tool_name, old.title, old.url, old.snippet, old.source);
END;

CREATE TRIGGER IF NOT EXISTS project_index_au AFTER UPDATE ON project_index BEGIN
  INSERT INTO project_index_fts(project_index_fts, rowid, project_path, tool_name, title, url, snippet, source)
  VALUES ('delete', old.id, old.project_path, old.tool_name, old.title, old.url, old.snippet, old.source);
  INSERT INTO project_index_fts(rowid, project_path, tool_name, title, url, snippet, source)
  VALUES (new.id, new.project_path, new.tool_name, new.title, new.url, new.snippet, new.source);
END;

CREATE INDEX IF NOT EXISTS idx_project_path ON project_index(project_path);
CREATE INDEX IF NOT EXISTS idx_content_hash ON project_index(content_hash);
`;

export class ProjectIndexStore {
  private db: Database.Database;
  private stmts: {
    insert: Database.Statement;
    search: Database.Statement;
    purge: Database.Statement;
    exists: Database.Statement;
  };

  constructor(dbPath: string) {
    this.db = new Database(dbPath, { timeout: 5000 });
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.pragma("busy_timeout = 5000");
    this.db.exec(SCHEMA_SQL);

    this.stmts = {
      insert: this.db.prepare(
        `INSERT INTO project_index (project_path, tool_name, query_hash, title, url, snippet, source, content_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ),
    search: this.db.prepare(
      `SELECT p.rowid, p.title, p.url, p.snippet, p.source, p.created_at,
              f.rank,
              bm25(project_index_fts, 0, 0, 10.0, 1.0, 5.0, 1.0) as weighted_rank
       FROM project_index_fts f
       JOIN project_index p ON f.rowid = p.id
       WHERE project_index_fts MATCH ?
       ORDER BY weighted_rank
       LIMIT ?`
    ),
      purge: this.db.prepare(`DELETE FROM project_index WHERE project_path = ?`),
      exists: this.db.prepare(`SELECT COUNT(*) as cnt FROM project_index WHERE project_path = ? AND content_hash = ?`),
    };
  }

  indexEntry(entry: {
    projectPath: string;
    toolName: string;
    queryHash?: string;
    title: string;
    url: string;
    snippet: string;
    source: string;
    contentHash: string;
  }): void {
    // Dedup by content_hash within same project (ADR-0009 D4: de-dup rule).
    const existing = this.stmts.exists.get(entry.projectPath, entry.contentHash) as { cnt: number };
    if (existing.cnt > 0) return;
    this.stmts.insert.run(
      entry.projectPath, entry.toolName, entry.queryHash ?? null,
      entry.title, entry.url, entry.snippet, entry.source, entry.contentHash
    );
  }

  search(query: string, limit = 10): ProjectIndexHit[] {
    const safeQuery = this.fts5Escape(query);
    return this.stmts.search.all(safeQuery, limit) as ProjectIndexHit[];
  }

  purgeProject(projectPath: string): number {
    const result = this.stmts.purge.run(projectPath);
    return result.changes;
  }

  close(): void {
    this.db.close();
  }

  private fts5Escape(query: string): string {
    return fts5EscapeQuery(query);
  }
}
