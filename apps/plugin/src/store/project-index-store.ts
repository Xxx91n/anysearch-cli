// ProjectIndexStore: per-project FTS5 index, physically separate from SessionStore.
// Physical dual-DB. Internal agent reads this only (read-only).
// Written by hooks layer via IPC to long-running MCP server ( +2).
//
// Every read states its project scope. One project is the normal case; more
// than one is a deliberate cross-project read the caller asked for. There is
// no "all projects" mode: a query that carries no project condition would let
// one project's records leak into another's context.
//
// Design: the project condition is a required parameter, not an optional
// filter — a default of "everything" is the failure mode this store exists to
// prevent (S3/N2).


import Database from "better-sqlite3";
import { fts5EscapeQuery, fts5RelaxedQuery, relaxedTerms, coversMajority, appendRelaxed } from "@anysearch-cli/store";

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
  projectPath: string;
  title: string;
  url: string;
  snippet: string;
  source: string;
  rank: number;
  createdAt: string;
}

function scopeProjects(scope: readonly string[]): string[] {
  const unique = new Set<string>();
  for (const value of scope) {
    const project = typeof value === "string" ? value.trim() : "";
    if (project) unique.add(project);
  }
  return [...unique];
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

function requireProject(projectPath: string): string {
  const project = typeof projectPath === "string" ? projectPath.trim() : "";
  if (!project) throw new Error("projectPath required: refusing to use a project-unscoped row");
  return project;
}

export class ProjectIndexStore {
  private db: Database.Database;
  private readonly stmts: {
    insert: Database.Statement;
    purge: Database.Statement;
    exists: Database.Statement;
  };
  /** One prepared read per distinct scope size (the project list is a parameter list). */
  private readonly scopeStmts = new Map<number, Database.Statement>();

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
      purge: this.db.prepare(`DELETE FROM project_index WHERE project_path = ?`),
      exists: this.db.prepare(`SELECT COUNT(*) as cnt FROM project_index WHERE project_path = ? AND content_hash = ?`),
    };
  }

  /**
   * Search only the named projects. A single root is the default scoped read;
   * two or more roots are the explicit cross-project read (N2 / S3).
   */
  search(query: string, projects: readonly string[], limit = 10): ProjectIndexHit[] {
    const scopedProjects = scopeProjects(projects);
    if (scopedProjects.length === 0) throw new Error("project scope required: refusing an unscoped project-index read");
    const searchStmt = this.readStatement(scopedProjects.length);
    const safeQuery = this.fts5Escape(query);
    const strict = searchStmt.all(safeQuery, ...scopedProjects, limit) as ProjectIndexHit[];
    // host recall questions are natural language — relax when the strict rung under-fills.
    if (strict.length >= limit) return strict;
    const relaxed = fts5RelaxedQuery(query);
    if (!relaxed) return strict;
    // `p.rowid` on an INTEGER PRIMARY KEY table comes back under the PK's name (`id`), so dedupe on it.
    const idOf = (h: ProjectIndexHit) => (h as unknown as { id?: number }).id ?? h.rowid;
    const terms = relaxedTerms(query);
    const wide = (searchStmt.all(relaxed, ...scopedProjects, limit * 4) as ProjectIndexHit[])
      .filter((h) => coversMajority(terms, `${h.title ?? ""} ${h.snippet ?? ""} ${h.url ?? ""}`));
    return appendRelaxed(strict, wide, limit, idOf);
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
    const projectPath = requireProject(entry.projectPath);
    // Dedup by content_hash within same project (: de-dup rule).
    const existing = this.stmts.exists.get(projectPath, entry.contentHash) as { cnt: number };
    if (existing.cnt > 0) return;
    this.stmts.insert.run(
      projectPath, entry.toolName, entry.queryHash ?? null,
      entry.title, entry.url, entry.snippet, entry.source, entry.contentHash
    );
  }

  purgeProject(projectPath: string): number {
    const result = this.stmts.purge.run(requireProject(projectPath));
    return result.changes;
  }

  close(): void {
    this.db.close();
    this.scopeStmts.clear();
  }

  private readStatement(scopeSize: number): Database.Statement {
    let stmt = this.scopeStmts.get(scopeSize);
    if (!stmt) {
      const placeholders = new Array(scopeSize).fill("?").join(", ");
      stmt = this.db.prepare(
        `SELECT p.rowid, p.project_path AS projectPath, p.title, p.url, p.snippet, p.source,
                p.created_at AS createdAt,
                f.rank,
                bm25(project_index_fts, 0, 0, 10.0, 1.0, 5.0, 1.0) as weighted_rank
         FROM project_index_fts f
         JOIN project_index p ON f.rowid = p.id
         WHERE project_index_fts MATCH ? AND p.project_path IN (${placeholders})
         ORDER BY weighted_rank
         LIMIT ?`
      );
      this.scopeStmts.set(scopeSize, stmt);
    }
    return stmt;
  }

  private fts5Escape(query: string): string {
    return fts5EscapeQuery(query);
  }
}
