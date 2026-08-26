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
import { fts5EscapeQuery, searchMemoryMultiQuery } from "./fts5.js";
import { rrfRank } from "@anysearch/retriever";
import type { NormalizedResult } from "@anysearch/retriever";

// ADR-0023 D4: MemTX-simplified writer adjudication.
// keyMemories carry the three-check inputs for write-path adjudication (D4, Q3=A).
export type AdjudicationAction = "accept" | "supersede" | "quarantine";

export interface KeyMemoryInput {
  url: string;
  title: string;
  snippet: string;
  source: string; // provider id — direct user interaction uses source='user'
  evidence: number; // writer confidence score 0.0-1.0
  entity?: string; // override URL as entity key (same as NormalizedResult.entity)
}

export interface AdjudicationResultItem {
  action: AdjudicationAction;
  reason?: "evidence" | "temporal" | "equal_conflict";
  supersededId?: number; // temporal: new write supersedes this id
  counterpartId?: number; // equal_conflict: the live memory in conflict with this write
  insertedId?: number; // rowid if accepted (evidence pass) or supersceded (new row landed)
}

// ADR-0025 D2: equal-conflict review channel row (flag, don't silently pick).
export interface QuarantinedMemory {
  id: number;
  sessionId: string;
  entity: string | null;
  url: string;
  title: string | null;
  snippet: string | null;
  source: string | null;
  createdAt: string;
  evidence: number | null;
  counterpartTitle: string | null; // live counterpart for the same entity, shown for judgment
  counterpartSnippet: string | null;
}
// ADR-0024 D1/D2: T0 hot zone types.
export interface T0PreferenceInput {
  key: string;
  value: string;
  scope?: string; // "global" or project root path; default "global"
  source: "explicit" | "correction"; // C-prime gate channels
  provenance?: { event: string; at: string; why: string };
}

export interface T0PreferenceRow {
  key: string;
  value: string;
  scope: string;
  modified: string;
  lastAccessed: string;
  source: string;
  invalidAt: string | null;
  demoteReason: string | null;
  correctionCount: number;
  provenance: string | null;
}

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
  // ADR-0008 D3: search Research Memory layer for recall_memory MCP tool.
  searchMemory(query: string, limit?: number): Promise<MemoryHit[]>;
  // ADR-0023 D2 (Q2=B): multi-query + RRF k=60 fusion. queries[0] must be the raw user query.
  searchMemoryMulti(queries: string[], limit?: number): Promise<MemoryHit[]>;
  // ADR-0023 D4 (Q3=A): write-path adjudication with keyMemories carrying evidence score.
  // Caller supplies quarantine check readiness (peer-conflict scan split into its own stmt).
  adjudicateMemory(sessionId: string, keyMemories: KeyMemoryInput[]): Promise<AdjudicationResultItem[]>;
  // ADR-0024 D1/D2/D7: T0 hot zone — durable preference layer.
  // promotePreference: deterministic write gated by caller (C-prime channels: /remember explicit, correction-count>=2).
  // demotePreference: conflict(d-i)/user(d-iii)/eviction(d-ii); sets invalid_at only (never drop, recoverable).
  // touchPreference: updates last_accessed (eviction order base).
  // listPreferences: live entries for MEMORY.md projection (global+project scopes, project wins same-key).
  promotePreference(input: T0PreferenceInput): Promise<{ action: "promoted" | "rejected"; reason?: string }>;
  demotePreference(key: string, scope: string, reason: string): Promise<void>;
  touchPreference(key: string, scope: string): Promise<void>;
  listPreferences(projectScope?: string): Promise<T0PreferenceRow[]>;
  // ADR-0024 D3: adjudication hook — correction-count increment + conditional promote.
  recordCorrectionOnPreference(key: string, scope: string): Promise<{ correctionCount: number }>;
  // ADR-0025 D2: equal-conflict review channel over retrieval_results.quarantine.
  listQuarantinedMemories(): Promise<QuarantinedMemory[]>;
  // keep: new value wins (clear quarantine, supersede live counterpart). drop: keep quarantined, mark resolved_drop.
  resolveQuarantinedMemory(id: number, action: "keep" | "drop"): Promise<{ ok: boolean }>;
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
    searchAllResults: Database.Statement;
    touchAccessed: Database.Statement;
    // ADR-0016 D10: UPSERT for state-type anchors (consolidation_state).
    saveAnchorUpsert: Database.Statement;
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
    // ADR-0009 D3 L2: access-time signal (align Mem0 1.5×/0.3× — recall hit refreshes last_accessed).
    try { this.db.exec("ALTER TABLE retrieval_results ADD COLUMN last_accessed TEXT"); } catch {}
    // ADR-0023 D4 (Q3=A): equal-weight conflict quarantine — candidates held for user review at next interaction.
    try { this.db.exec("ALTER TABLE retrieval_results ADD COLUMN quarantine TEXT"); } catch {}
    // ADR-0025 D2: evidence persisted on quarantined rows for the review list (atomcode: confidence for queue ordering, never for auto-adjudication).
    try { this.db.exec("ALTER TABLE retrieval_results ADD COLUMN evidence REAL"); } catch {}
    // ADR-0024 D1/D2: T0 hot zone — t0_preferences is the single source of truth; MEMORY.md is a
    // regenerated materialized projection (temp+fsync+rename). scope: "global" | project root path.
    // correction_count drives the C-prime promote gate (>=2 cross-session corrections = implicit promote).
    // invalid_at non-null = demoted (d-i conflict / d-iii /forget / d-ii eviction); row is quarantined, never dropped.
    this.db.exec(`CREATE TABLE IF NOT EXISTS t0_preferences (
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'global',
  modified TEXT NOT NULL DEFAULT (datetime('now')),
  last_accessed TEXT NOT NULL DEFAULT (datetime('now')),
  source TEXT NOT NULL, -- "explicit" (/remember) | "correction" (C-prime count>=2)
  invalid_at TEXT,
  demote_reason TEXT,
  correction_count INTEGER NOT NULL DEFAULT 0,
  provenance TEXT, -- JSON: {event, at, why}
  PRIMARY KEY (key, scope)
)`);

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
      // ADR-0008 D3: recall_memory searches Research Memory (retrieval_results_fts), not messages.
     // ADR-0008 D2: time_decay() in ORDER BY + bi-temporal filter (valid_until IS NULL).
     // MemoryHit.role <-- r.title, MemoryHit.content <-- r.snippet (recall_memory maps these fields).
     searchAllResults: this.db.prepare("SELECT r.id as rowid, r.session_id as sessionId, r.title as role, r.snippet as content, time_decay(bm25(retrieval_results_fts), r.created_at, r.title, r.url, ?, r.pinned) as rank FROM retrieval_results_fts JOIN retrieval_results r ON r.id = retrieval_results_fts.rowid WHERE retrieval_results_fts MATCH ? AND (r.valid_until IS NULL) AND (r.quarantine IS NULL) ORDER BY rank LIMIT ?"),
      // ADR-0009 D3 L2: update last_accessed on recall hit (access-time signal, Mem0 1.5×/0.3×).
      touchAccessed: this.db.prepare("UPDATE retrieval_results SET last_accessed = datetime('now') WHERE id = ?"),
      // ADR-0016 D10: UPSERT for state-type anchors.
  
      saveAnchorUpsert: this.db.prepare("INSERT INTO resume_anchors (session_id, anchor_type, payload) VALUES (?, ?, ?) ON CONFLICT(session_id, anchor_type) WHERE anchor_type = 'consolidation_state' DO UPDATE SET payload = excluded.payload, created_at = datetime('now')"),
    };
  }

  // ADR-0024 D1/D2/D7: T0 hot zone methods.
  // All writes are deterministic; gate logic lives in caller (A+C+B, not here).

  async promotePreference(input: T0PreferenceInput): Promise<{ action: "promoted" | "rejected"; reason?: string }> {
    const scope = input.scope ?? "global";
    const now = new Date().toISOString();
    const prov = input.provenance ? JSON.stringify(input.provenance) : null;
    // d-i conflict: same key+scope already live → in-place supersede (Zep temporal).
    // modified + provenance updated; old value dereferenced (recoverable via WAL). correction_count preserved.
    this.db
      .prepare(
        `INSERT INTO t0_preferences (key, value, scope, modified, last_accessed, source, invalid_at, demote_reason, correction_count, provenance)
         VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, 0, ?)
         ON CONFLICT (key, scope) DO UPDATE SET
           value = excluded.value,
           modified = excluded.modified,
           last_accessed = excluded.last_accessed,
           source = excluded.source,
           invalid_at = NULL,
           demote_reason = NULL,
           provenance = excluded.provenance`
      )
      .run(input.key, input.value, scope, now, now, input.source, prov);
    return { action: "promoted" };
  }

  async demotePreference(key: string, scope: string, reason: string): Promise<void> {
    const now = new Date().toISOString();
    this.db
      .prepare("UPDATE t0_preferences SET invalid_at = ?, demote_reason = ? WHERE key = ? AND scope = ? AND invalid_at IS NULL")
      .run(now, reason, key, scope);
  }

  async touchPreference(key: string, scope: string): Promise<void> {
    this.db
      .prepare("UPDATE t0_preferences SET last_accessed = ? WHERE key = ? AND scope = ? AND invalid_at IS NULL")
      .run(new Date().toISOString(), key, scope);
  }

  // listPreferences: key-level override merge (project wins same-key, distinct keys merge).
  // Deterministic: order by key asc after merge.
  async listPreferences(projectScope?: string): Promise<T0PreferenceRow[]> {
    const sql = `
      SELECT key, value, scope, modified as modified, last_accessed as last_accessed,
             source, invalid_at as invalid_at, demote_reason as demote_reason,
             correction_count as correction_count, provenance
      FROM t0_preferences
      WHERE invalid_at IS NULL AND (scope = 'global' OR scope = ?)
      ORDER BY CASE WHEN scope = 'global' THEN 0 ELSE 1 END, key ASC
    `;
    const rows = this.db.prepare(sql).all(projectScope ?? "global") as any[];
    // Key-level override: later row (higher scope precedence) wins.
    const merged = new Map<string, T0PreferenceRow>();
    for (const r of rows) {
      merged.set(r.key, {
        key: r.key,
        value: r.value,
        scope: r.scope,
        modified: r.modified,
        lastAccessed: r.last_accessed,
        source: r.source,
        invalidAt: r.invalid_at,
        demoteReason: r.demote_reason,
        correctionCount: r.correction_count,
        provenance: r.provenance,
      });
    }
    return Array.from(merged.values());
  }

  // ADR-0024 D3: C-prime correction-count channel.
  // Increment correction_count; if >=2 and not already promoted, promote implicitly.
  // Returns current count for caller to decide projection trigger.
  async recordCorrectionOnPreference(key: string, scope: string): Promise<{ correctionCount: number }> {
    const row = this.db
      .prepare("SELECT correction_count FROM t0_preferences WHERE key = ? AND scope = ? AND invalid_at IS NULL LIMIT 1")
      .get(key, scope) as { correction_count: number } | undefined;
    if (!row) {
      // First correction: not enough to promote; just track (count=1).
      this.db
        .prepare("INSERT INTO t0_preferences (key, value, scope, modified, last_accessed, source, invalid_at, demote_reason, correction_count, provenance) VALUES (?, ?, ?, datetime('now'), datetime('now'), 'correction', NULL, NULL, 1, NULL)")
        .run(key, "", scope);
      return { correctionCount: 1 };
    }
    const next = row.correction_count + 1;
    this.db
      .prepare("UPDATE t0_preferences SET correction_count = ?, modified = datetime('now') WHERE key = ? AND scope = ? AND invalid_at IS NULL")
      .run(next, key, scope);
    return { correctionCount: next };
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

  // SECURITY: escape FTS5 special chars, then ADR-0023 D2 FTS5 Query Tokenization (CWE-20).
  private fts5Escape(query: string): string {
    return fts5EscapeQuery(query);
  }

  async searchFts5(sessionId: string | null, query: string, limit = 20): Promise<MemoryHit[]> {
    const safeQuery = this.fts5Escape(query);
    if (sessionId) {
      return this.stmts.searchMessages.all(safeQuery, sessionId, limit) as MemoryHit[];
    }
    return this.stmts.searchAllMessages.all(safeQuery, limit) as MemoryHit[];
  }

  async searchMemory(query: string, limit = 20): Promise<MemoryHit[]> {
   const safeQuery = this.fts5Escape(query);
   // Params: (query_for_decay, fts_match_query, limit) — same string passed twice for both ? slots.
   const hits = this.stmts.searchAllResults.all(safeQuery, safeQuery, limit) as MemoryHit[];
    // ADR-0009 D3 L2: refresh last_accessed for each hit (access-time signal).
    for (const hit of hits) {
      try { this.stmts.touchAccessed.run(hit.rowid); } catch {}
    }
    return hits;
  }

  // ADR-0023 D2 (Q2=B): multi-query + RRF k=60 fusion. queries[0] must be the raw user query.
  async searchMemoryMulti(queries: string[], limit = 20): Promise<MemoryHit[]> {
    return searchMemoryMultiQuery<MemoryHit>(this, queries, limit, rrfRank);
  }

  // ADR-0023 D2 structural-typing seam: exposes db.prepare(...).all(...) as a function so
  // private field doesn't escape through structural typing of the SearchableStoreLike contract.
  // Public by design: duck-typed contract with SearchableStoreLike requires assignability.
  dbQuery<Row = unknown>(sql: string, ...params: unknown[]): Row[] {
    return this.db.prepare(sql).all(...params) as Row[];
  }

  async saveResults(sessionId: string, results: NormalizedResult[]): Promise<void> {
    // atomcode research: db.transaction(fn) auto-rollback on throw.
    const insertMany = this.db.transaction((rs: NormalizedResult[]) => {
      for (const r of rs) {
       const info = this.stmts.saveResult.run(sessionId, r.url, r.title, r.snippet, r.source, null, r.entity ?? r.url);
                // ADR-0008 D2: bi-temporal invalidation — close old records for same entity (URL) at write time.
                // Not relying on decay to suppress staleness; valid_until set immediately on new write.
                try { invalidateOldRecords(this.db, r.url, Number(info.lastInsertRowid)); } catch {}
      }
    });
    insertMany(results);
  }

  // ADR-0023 D4 (Q3=A): write-path adjudication (MemTX-simplified three checks).
  // Each KeyMemoryInput is classified by (1) evidence >=0.6, (2) temporal supersede, (3) equal-weight conflict.
  // Quarantined writes get quarantine IS NOT NULL and are excluded from searchMemory until confirmed.
  async adjudicateMemory(sessionId: string, keyMemories: KeyMemoryInput[]): Promise<AdjudicationResultItem[]> {
    const out: AdjudicationResultItem[] = [];
    for (const km of keyMemories) {
      const evidence = typeof km.evidence === "number" && km.evidence >= 0.6;
      // Evidence check: direct user input / high-trust sources bypass (MemTX authority >= 0.9 channel).
      if (evidence || km.source === "user") {
        const entityKey = km.entity ?? km.url;
        // Temporal supersede: new write for same entity wins; close old record with valid_until = now (ADR-0008 D2 pattern).
        const existing = this.db
          .prepare("SELECT id FROM retrieval_results WHERE entity = ? AND session_id = ? AND valid_until IS NULL AND quarantine IS NULL LIMIT 1")
          .get(entityKey, sessionId) as { id: number } | undefined;
        const info = this.stmts.saveResult.run(sessionId, km.url, km.title, km.snippet, km.source, null, entityKey);
        const insertedId = Number(info.lastInsertRowid);
        if (existing) {
          try {
            this.db.prepare("UPDATE retrieval_results SET valid_until = datetime('now') WHERE id = ?").run(existing.id);
            out.push({ action: "supersede", reason: "temporal", supersededId: existing.id, insertedId });
          } catch {
            out.push({ action: "accept", insertedId });
          }
        } else {
          out.push({ action: "accept", insertedId });
        }
      } else {
        // Evidence < 0.6 or non-user source: quarantine candidate (MemTX equal-weight conflict / deferred review).
        const info = this.stmts.saveResult.run(sessionId, km.url, km.title, km.snippet, km.source, null, km.entity ?? km.url);
        const insertedId = Number(info.lastInsertRowid);
        try {
          this.db.prepare("UPDATE retrieval_results SET quarantine = ?, evidence = ? WHERE id = ?").run("equal_conflict", typeof km.evidence === "number" ? km.evidence : null, insertedId);
        } catch {}
        out.push({ action: "quarantine", reason: "equal_conflict", insertedId });
      }
    }
    return out;
  }

  // ADR-0016 D10: saveAnchor with UPSERT semantics for state-type anchors.
  // State-type anchors (consolidation_state) use DELETE-then-INSERT to ensure single row per (session_id, anchor_type).
  // Historical anchors (rolling_summary, l2_recall) remain append-only (INSERT).
  async saveAnchor(sessionId: string, anchorType: string, payload: unknown): Promise<void> {
    const json = JSON.stringify(payload);
    // ponytail: state-type anchors use UPSERT (DELETE-then-INSERT avoids schema migration for UNIQUE constraint).
    if (anchorType === "consolidation_state") {
      this.stmts.saveAnchorUpsert.run(sessionId, anchorType, json);
    } else {
      this.stmts.saveAnchor.run(sessionId, anchorType, json);
    }
  }

  async getAnchors(sessionId: string): Promise<ResumeAnchor[]> {
    const rows = this.stmts.getAnchors.all(sessionId) as Array<Omit<ResumeAnchor, "payload"> & { payload: string }>;
    return rows.map((r) => ({ ...r, payload: JSON.parse(r.payload) }));
  }

  // ADR-0025 D2: equal-conflict review channel. Zero new tables — the quarantine column
  // on retrieval_results is the ledger; keep/drop reuse the bi-temporal valid_until path.
  async listQuarantinedMemories(): Promise<QuarantinedMemory[]> {
    // Left-join the live counterpart of the same entity so the reviewer sees both sides (atomcode: counterpart display is mandatory).
    const rows = this.db
      .prepare(
        "SELECT q.id, q.session_id, q.entity, q.url, q.title, q.snippet, q.source, q.created_at, q.evidence," +
          " c.title AS counterpart_title, c.snippet AS counterpart_snippet" +
          " FROM retrieval_results q" +
          " LEFT JOIN retrieval_results c ON c.session_id = q.session_id AND c.entity = q.entity AND c.id != q.id AND c.valid_until IS NULL AND c.quarantine IS NULL" +
          " WHERE q.quarantine = 'equal_conflict' ORDER BY q.created_at DESC"
      )
      .all() as Array<{ id: number; session_id: string; entity: string | null; url: string; title: string | null; snippet: string | null; source: string | null; created_at: string; evidence: number | null; counterpart_title: string | null; counterpart_snippet: string | null }>;
    return rows.map((r) => ({ id: r.id, sessionId: r.session_id, entity: r.entity, url: r.url, title: r.title, snippet: r.snippet, source: r.source, createdAt: r.created_at, evidence: r.evidence, counterpartTitle: r.counterpart_title, counterpartSnippet: r.counterpart_snippet }));
  }

  async resolveQuarantinedMemory(id: number, action: "keep" | "drop"): Promise<{ ok: boolean }> {
    const row = this.db
      .prepare("SELECT id, session_id, entity FROM retrieval_results WHERE id = ? AND quarantine = 'equal_conflict'")
      .get(id) as { id: number; session_id: string; entity: string | null } | undefined;
    if (!row) return { ok: false };
    if (action === "keep") {
      this.db.prepare("UPDATE retrieval_results SET quarantine = NULL WHERE id = ?").run(id);
      // Kept value wins: close the live counterpart for the same entity (ADR-0008 bi-temporal pattern).
      this.db
        .prepare("UPDATE retrieval_results SET valid_until = datetime('now') WHERE session_id = ? AND entity = ? AND id != ? AND valid_until IS NULL AND quarantine IS NULL")
        .run(row.session_id, row.entity, id);
    } else {
      this.db.prepare("UPDATE retrieval_results SET quarantine = 'resolved_drop' WHERE id = ?").run(id);
    }
    return { ok: true };
  }

  close(): void {
    this.db.close();
  }
}
