// SessionStore: SQLite+FTS5 implementation via better-sqlite3 sync API.
// Seam 4 from atomcode-kernel-split-architecture research.
// ADR-0005 decision 1: better-sqlite3 synchronous binding.
// atomcode research: WAL persistent, single shared connection, module-level prepared statements,
// db.transaction(fn) auto-rollback, avoid RETURNING+FTS trigger path (issue #654).

import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { SCHEMA_SQL } from "./schema-content";
import { registerTimeDecayFunction, invalidateOldRecords } from "./time-decay.js";
import type { NormalizedResult } from "@anysearch/retriever";

export interface Session {
  id: string;
  domain: string;
  createdAt: string;
}

export interface Message {
  role: "user" | "assistant" | "tool";
  content: string;
}

export interface MemoryHit {
  rowid: number;
  sessionId: string;
  role: string;
  content: string;
  rank: number;
}

export interface ResumeAnchor {
  id: number;
  sessionId: string;
  anchorType: string;
  payload: unknown;
  createdAt: string;
}

// Port interface: kernel imports this, CLI composition root injects implementation.
export interface SessionStore {
  createSession(domain: string): Promise<Session>;
  append(sessionId: string, message: Message): Promise<void>;
  searchFts5(sessionId: string | null, query: string, limit?: number): Promise<MemoryHit[]>;
  saveResults(sessionId: string, results: NormalizedResult[]): Promise<void>;
  saveAnchor(sessionId: string, anchorType: string, payload: unknown): Promise<void>;
  getAnchors(sessionId: string): Promise<ResumeAnchor[]>;
}

// better-sqlite3 sync API wrapped in async interface to match SessionStore port.
// ponytail: thinnest wrapper - no extra abstraction, sync calls wrapped in Promise.resolve.
export class SqliteSessionStore implements SessionStore {
  private db: Database.Database;
  private stmts: {
    createSession: Database.Statement;
    append: Database.Statement;
    searchMessages: Database.Statement;
    searchAllMessages: Database.Statement;
    saveResult: Database.Statement;
    searchResults: Database.Statement;
    saveAnchor: Database.Statement;
    getAnchors: Database.Statement;
  };

  constructor(dbPath: string) {
    this.db = new Database(dbPath, { timeout: 5000 });
    // atomcode research: WAL persistent, set once, single shared connection.
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("busy_timeout = 5000");
    // Apply schema (idempotent IF NOT EXISTS).
    // ESM dev mode: read schema.sql from source dir via import.meta.url.
    // CJS bundled mode: import.meta is empty, use inlined SCHEMA_SQL constant.
    let schema: string;
    try {
      const schemaPath = join(dirname(fileURLToPath(import.meta.url)), "schema.sql");
      schema = readFileSync(schemaPath, "utf8");
    } catch {
      schema = SCHEMA_SQL;
    }
    this.db.exec(schema);
    // G019: Register time_decay custom function for FTS5 queries with time edge effect.
    registerTimeDecayFunction(this.db);
    // G019: Migration for existing databases (ALTER TABLE ADD COLUMN is not IF NOT EXISTS safe).
    try { this.db.exec("ALTER TABLE retrieval_results ADD COLUMN valid_until TEXT"); } catch {}
    try { this.db.exec("ALTER TABLE retrieval_results ADD COLUMN pinned BOOLEAN DEFAULT 0"); } catch {}
    try { this.db.exec("ALTER TABLE retrieval_results ADD COLUMN entity TEXT"); } catch {}
    // Module-level prepared statements (atomcode research pattern).
    this.stmts = {
      createSession: this.db.prepare("INSERT INTO sessions (id, domain) VALUES (?, ?) RETURNING id, domain, created_at as createdAt"),
      append: this.db.prepare("INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)"),
      searchMessages: this.db.prepare("SELECT m.id as rowid, m.session_id as sessionId, m.role, m.content, bm25(messages_fts) as rank FROM messages_fts JOIN messages m ON m.id = messages_fts.rowid WHERE messages_fts MATCH ? AND m.session_id = ? ORDER BY rank LIMIT ?"),
      searchAllMessages: this.db.prepare("SELECT m.id as rowid, m.session_id as sessionId, m.role, m.content, bm25(messages_fts) as rank FROM messages_fts JOIN messages m ON m.id = messages_fts.rowid WHERE messages_fts MATCH ? ORDER BY rank LIMIT ?"),
      saveResult: this.db.prepare("INSERT INTO retrieval_results (session_id, url, title, snippet, source, rrf_score, entity) VALUES (?, ?, ?, ?, ?, ?, ?)"),
      searchResults: this.db.prepare("SELECT r.id as rowid, r.session_id as sessionId, r.title, r.snippet, bm25(retrieval_results_fts) as rank FROM retrieval_results_fts JOIN retrieval_results r ON r.id = retrieval_results_fts.rowid WHERE retrieval_results_fts MATCH ? AND r.session_id = ? ORDER BY rank LIMIT ?"),
      saveAnchor: this.db.prepare("INSERT INTO resume_anchors (session_id, anchor_type, payload) VALUES (?, ?, ?)"),
      getAnchors: this.db.prepare("SELECT id, session_id as sessionId, anchor_type as anchorType, payload, created_at as createdAt FROM resume_anchors WHERE session_id = ? ORDER BY id"),
    };
  }

  async createSession(domain: string): Promise<Session> {
    // ponytail: crypto.randomUUID is stdlib, no need for uuid package.
    const id = crypto.randomUUID();
    const row = this.stmts.createSession.get(id, domain) as Session;
    return row;
  }

  async append(sessionId: string, message: Message): Promise<void> {
    // atomcode research: avoid RETURNING inside transaction with FTS triggers (#654).
    // Simple INSERT, no RETURNING - trigger syncs FTS automatically.
    this.stmts.append.run(sessionId, message.role, message.content);
  }

  async searchFts5(sessionId: string | null, query: string, limit = 20): Promise<MemoryHit[]> {
    // bm25() returns smaller=better. ORDER BY rank ascending (best first).
    if (sessionId) {
      return this.stmts.searchMessages.all(query, sessionId, limit) as MemoryHit[];
    }
    return this.stmts.searchAllMessages.all(query, limit) as MemoryHit[];
  }

  async saveResults(sessionId: string, results: NormalizedResult[]): Promise<void> {
    // atomcode research: db.transaction(fn) auto-rollback on throw.
    const insertMany = this.db.transaction((rs: NormalizedResult[]) => {
      for (const r of rs) {
        this.stmts.saveResult.run(sessionId, r.url, r.title, r.snippet, r.source, null, r.url);
      }
    });
    insertMany(results);
  }

  async saveAnchor(sessionId: string, anchorType: string, payload: unknown): Promise<void> {
    this.stmts.saveAnchor.run(sessionId, anchorType, JSON.stringify(payload));
  }

  async getAnchors(sessionId: string): Promise<ResumeAnchor[]> {
    const rows = this.stmts.getAnchors.all(sessionId) as Array<Omit<ResumeAnchor, "payload"> & { payload: string }>;
    return rows.map((r) => ({ ...r, payload: JSON.parse(r.payload) }));
  }

  close(): void {
    this.db.close();
  }
}
