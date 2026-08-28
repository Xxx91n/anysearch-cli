// SessionStore: SQLite+FTS5 implementation via better-sqlite3 sync API.
// Seam 4 from atomcode-kernel-split-architecture research.
// ADR-0005 decision 1: better-sqlite3 synchronous binding.
// atomcode research: WAL persistent, single shared connection, module-level prepared statements,
// db.transaction(fn) auto-rollback, avoid RETURNING+FTS trigger path (issue #654).

import Database from "better-sqlite3";
import { containsSecret } from "./secret.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { SCHEMA_SQL } from "./schema-content";
import { registerFreshnessFactorFunction, invalidateOldRecords } from "./time-decay.js";
import { fts5EscapeQuery, searchMemoryMultiQuery } from "./fts5.js";
import { extractEntityCandidates, normalizeEntityName, trigramSimilarity, ENTITY_ALIAS_THRESHOLD, ENTITY_REVIEW_THRESHOLD, MAX_ENTITY_CANDIDATES as MAX_CANDIDATES } from "./entity.js";
import type { EntityType, EntityCandidate } from "./entity.js";
import { rrfRank } from "@anysearch/retriever";
import type { NormalizedResult } from "@anysearch/retriever";

// ADR-0023 D4: MemTX-simplified writer adjudication.
// keyMemories carry the three-check inputs for write-path adjudication (D4, Q3=A).
export type AdjudicationAction = "accept" | "supersede" | "quarantine" | "reject";

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
  reason?: "evidence" | "temporal" | "equal_conflict" | "secret";
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
  // ADR-0032 D1/D4: destructive entity merge with full snapshot (single transaction).
  combineEntities(fromId: number, toId: number): Promise<{ ok: boolean; logId?: number; error?: string }>;
  // ADR-0032 D2: bounded unmerge driven by the D1 snapshot; writes override records against re-merge.
  unmergeEntity(logId: number): Promise<{ ok: boolean; error?: string }>;
  // ADR-0031 D5: alias-append undo (exposed for the CLI unmerge entry point).
  undoEntityMerge(logId: number): boolean;
  // ADR-0032 D3: candidate review belt (list + keep/drop resolution, ADR-0025 quarantine pattern).
  listEntityReview(): Promise<EntityReviewRow[]>;
  resolveEntityReview(id: number, action: "keep" | "drop"): Promise<{ ok: boolean; error?: string }>;
}

// ADR-0027 D5 + ADR-0028 D3: secret guard lives in ./secret.ts (shared containsSecret) —
// covers case-insensitive / JSON-escape / whitespace-collapse / NFKC / bounded-base64 variants
// at all 4 write entries and both search exits. Known blind spots: truncated secrets, novel encodings.

// ADR-0032 D3: one unresolved candidate row in the entity review belt.
export interface EntityReviewRow {
  id: number;
  sourceName: string;
  targetEntityId: number;
  targetName: string | null;
  hitCount: number;
  suggested: boolean; // hitCount >= 2 (escalation threshold; value subject to E4 calibration)
  detail: string | null;
  createdAt: string;
}

// ADR-0032 D5: six report-only merge metrics — five counters derived from entity_merge_log
// plus one run-scoped truncation counter; review_pending is a gauge (queue depth).
export interface EntityMergeTelemetry {
  auto_merged: number;
  unmerged: number;
  review_pending: number;
  confirmed: number;
  rejected: number;
  candidates_truncated: number;
}

// better-sqlite3 sync API wrapped in async interface to match SessionStore port.
// ponytail: thinnest wrapper - no extra abstraction, sync calls wrapped in Promise.resolve.
export class SqliteSessionStore implements SessionStore {
  private db: Database.Database;
  // ADR-0031 D2: LLM entity backfill (optional, fail-open) — invoked only when rule extraction finds nothing.
  private readonly entityLlmFallback?: (text: string) => Promise<EntityCandidate[] | null>;
  // ADR-0031 step7: entity arm telemetry counters (report-only in eval).
  private readonly entityTel = { queries: 0, candidates: 0, activations: 0, hits: 0, truncated: 0 };
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

  constructor(dbPath: string, opts?: { entityLlmFallback?: (text: string) => Promise<EntityCandidate[] | null> }) {
    this.entityLlmFallback = opts?.entityLlmFallback;
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
    // ADR-0030 D2: freshness_factor UDF (fused decay+recency+frequency band, supersedes time_decay).
    registerFreshnessFactorFunction(this.db);
    // G019: Migration for existing databases (ALTER TABLE ADD COLUMN is not IF NOT EXISTS safe).
    try { this.db.exec("ALTER TABLE retrieval_results ADD COLUMN valid_until TEXT"); } catch {}
    try { this.db.exec("ALTER TABLE retrieval_results ADD COLUMN pinned BOOLEAN DEFAULT 0"); } catch {}
   try { this.db.exec("ALTER TABLE retrieval_results ADD COLUMN entity TEXT"); } catch {}
    // ADR-0009 D3 L2: access-time signal (align Mem0 1.5×/0.3× — recall hit refreshes last_accessed).
    try { this.db.exec("ALTER TABLE retrieval_results ADD COLUMN last_accessed TEXT"); } catch {}
    // ADR-0030 D3: frequency signal — access_count incremented exactly once per returned hit.
    try { this.db.exec("ALTER TABLE retrieval_results ADD COLUMN access_count INTEGER DEFAULT 0"); } catch {}
    // ADR-0023 D4 (Q3=A): equal-weight conflict quarantine — candidates held for user review at next interaction.
    try { this.db.exec("ALTER TABLE retrieval_results ADD COLUMN quarantine TEXT"); } catch {}
    // ADR-0025 D2: evidence persisted on quarantined rows for the review list (atomcode: confidence for queue ordering, never for auto-adjudication).
    try { this.db.exec("ALTER TABLE retrieval_results ADD COLUMN evidence REAL"); } catch {}
    // ADR-0032 D3: candidate review belt columns on entity_merge_log.
    try { this.db.exec("ALTER TABLE entity_merge_log ADD COLUMN hit_count INTEGER NOT NULL DEFAULT 1"); } catch {}
    try { this.db.exec("ALTER TABLE entity_merge_log ADD COLUMN resolved TEXT"); } catch {}
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
      // ADR-0008 D2 -> ADR-0030: freshness_factor() in ORDER BY + bi-temporal filter (valid_until IS NULL).
     // MemoryHit.role <-- r.title, MemoryHit.content <-- r.snippet (recall_memory maps these fields).
     searchAllResults: this.db.prepare("SELECT r.id as rowid, r.session_id as sessionId, r.title as role, r.snippet as content, freshness_factor(bm25(retrieval_results_fts), r.created_at, r.last_accessed, r.access_count, r.title, r.url, ?, r.pinned) as rank FROM retrieval_results_fts JOIN retrieval_results r ON r.id = retrieval_results_fts.rowid WHERE retrieval_results_fts MATCH ? AND (r.valid_until IS NULL) AND (r.quarantine IS NULL) ORDER BY rank LIMIT ?"),
      // ADR-0009 D3 L2: update last_accessed on recall hit (access-time signal, Mem0 1.5×/0.3×).
      touchAccessed: this.db.prepare("UPDATE retrieval_results SET last_accessed = datetime('now'), access_count = COALESCE(access_count, 0) + 1 WHERE id = ?"),
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
    // ADR-0028 D3 write entry: never persist a message that trips the secret guard.
    if (containsSecret(message.role + " " + message.content)) return;
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
   const rawHits = this.stmts.searchAllResults.all(safeQuery, safeQuery, limit) as MemoryHit[];
   // ADR-0031 D4: entity arm — conditional activation (absent when query has no entity match), weight 0.5 vs FTS 1.0.
   const armHits = this.entityArmRows(query, limit);
   const fusedHits = armHits.length === 0 ? rawHits : (() => {
     const byId = new Map<number, MemoryHit>();
     for (const h of rawHits) byId.set(h.rowid, h);
     for (const h of armHits) byId.set(h.rowid, h);
     const fused = rrfRank([rawHits.map((h) => String(h.rowid)), armHits.map((h) => String(h.rowid))], 60, [1.0, 0.5]);
     const merged: MemoryHit[] = [];
     for (const id of fused) { const h = byId.get(Number(id)); if (h) merged.push(h); if (merged.length >= limit) break; }
     return merged;
   })();
    // ADR-0028 D3 read-side exit: rows written before the write guard (or via seed/test seams)
    // must never surface back to the caller either.
    const hits = fusedHits.filter((h) => !containsSecret(h.role + " " + h.content));
    // ADR-0009 D3 L2: refresh last_accessed for each hit (access-time signal).
    for (const hit of hits) {
      try { this.stmts.touchAccessed.run(hit.rowid); } catch {}
    }
    return hits;
  }

  // ADR-0023 D2 (Q2=B): multi-query + RRF k=60 fusion. queries[0] must be the raw user query.
  async searchMemoryMulti(queries: string[], limit = 20): Promise<MemoryHit[]> {
    // ADR-0031 D4: entity arm on the raw user query (queries[0]); ids passed as extra RRF list (weight 0.5 in fts5.ts).
    const armHits = this.entityArmRows(queries[0] ?? "", limit);
    const hits = await searchMemoryMultiQuery<MemoryHit>(this, queries, limit, rrfRank, armHits.map((h) => String(h.rowid)));
    // ADR-0028 D3 read-side exit: same guard as searchMemory.
    const kept = hits.filter((h) => !containsSecret(h.role + " " + h.content));
    // ADR-0030 D3: same exactly-once touch as searchMemory (both recall paths feed the signals).
    for (const hit of kept) {
      try { this.stmts.touchAccessed.run(hit.rowid); } catch {}
    }
    return kept;
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
       // ADR-0028 D3 write entry: skip secret-bearing results entirely (no row, no FTS).
       if (containsSecret(r.url + " " + (r.title ?? "") + " " + (r.snippet ?? ""))) continue;
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
      // ADR-0027 D5: secret check runs BEFORE the evidence gate — a high-evidence leak is still a leak.
      if (containsSecret(km.url + " " + (km.title ?? "") + " " + (km.snippet ?? ""))) {
        out.push({ action: "reject", reason: "secret" });
        continue;
      }
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
        try { await this.linkEntities(insertedId, km); } catch {} // ADR-0031: entity linking fail-open, covers accept+supersede
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
        try { await this.linkEntities(insertedId, km); } catch {} // ADR-0031: fail-open
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
    // ADR-0028 D3 write entry: anchors are searchable surfaces too — refuse secret payloads.
    if (containsSecret(anchorType + " " + json)) return;
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

  // ---- ADR-0031: entity link layer (write link + query arm) ----

  public entityTelemetry(): { queries: number; candidates: number; activations: number; hits: number; truncated: number } {
    return { ...this.entityTel };
  }

  private liveEntities(): Array<{ id: number; name: string; nameNorm: string; type: string; aliases: string[] }> {
    const rows = this.db.prepare("SELECT id, name, name_norm as nameNorm, entity_type as type, aliases FROM entities WHERE valid_until IS NULL").all() as Array<{ id: number; name: string; nameNorm: string; type: string; aliases: string }>;
    return rows.map((r) => ({ ...r, aliases: JSON.parse(r.aliases || "[]") as string[] }));
  }

  // Write-path linking: declared entity key (non-URL) + rule extraction; LLM backfill only on empty rules (fail-open).
  private async linkEntities(memoryId: number, km: KeyMemoryInput): Promise<void> {
    const text = (km.title ?? "") + " " + (km.snippet ?? "");
    // r74 audit E2: known set includes aliases — alias pass-through on the write path (Neo4j Keep Aliases).
    const known = new Set(this.liveEntities().flatMap((e) => [e.nameNorm, ...e.aliases]));
    const candidates: EntityCandidate[] = [];
    if (km.entity && !km.entity.includes("://")) candidates.push({ name: km.entity, type: "declared" });
    for (const c of extractEntityCandidates(text, known, MAX_CANDIDATES * 2)) candidates.push(c); // ADR-0032 D3: 2x cap — overflow tail feeds the review belt
    if (candidates.length === 0 && this.entityLlmFallback) {
      // ADR-0031 D2: LLM backfill (fail-open) — offline/no-key keeps rule output (here: empty).
      try { const extra = await this.entityLlmFallback(text); if (extra) candidates.push(...extra); } catch {}
    }
    for (const c of candidates.slice(0, MAX_CANDIDATES + 1)) { // r74 audit E5: 1 declared + MAX_CANDIDATES rule/LLM
      const entityId = this.resolveEntity(c.name, c.type);
      this.db.prepare("INSERT OR IGNORE INTO memory_entity (memory_id, entity_id) VALUES (?, ?)").run(memoryId, entityId);
    }
    // ADR-0032 D3: extraction overflow (capped out) enters the candidate review belt — never silent loss.
    const overflow = candidates.slice(MAX_CANDIDATES + 1);
    this.entityTel.truncated += overflow.length;
    for (const c of overflow) this.logOverflowCandidate(c);
  }

  // ADR-0032 D3: dedup'd candidate write — a re-hit of the same unresolved (source, target) pair
  // increments hit_count (Senzing re-resolve evidence accumulation, lightweight proxy).
  private logEntityCandidate(sourceName: string, targetId: number, detail: Record<string, unknown>): void {
    const existing = this.db
      .prepare("SELECT id FROM entity_merge_log WHERE kind = 'candidate' AND source_name = ? AND target_entity_id = ? AND resolved IS NULL AND undone = 0")
      .get(sourceName, targetId) as { id: number } | undefined;
    if (existing) {
      this.db.prepare("UPDATE entity_merge_log SET hit_count = hit_count + 1 WHERE id = ?").run(existing.id);
      return;
    }
    this.db.prepare("INSERT INTO entity_merge_log (kind, source_name, target_entity_id, detail) VALUES (?, ?, ?, ?)")
      .run("candidate", sourceName, targetId, JSON.stringify(detail));
  }

  // Overflow candidates only enter the review belt when they pass the Fellegi-Sunter review band
  // against a live entity (sub-band noise is just dropped by the cap, as before).
  private logOverflowCandidate(c: EntityCandidate): void {
    const norm = normalizeEntityName(c.name);
    let best: { id: number; sim: number } | null = null;
    for (const e of this.liveEntities()) {
      if (e.type !== c.type && c.type !== "declared" && e.type !== "declared") continue;
      const sims = [e.nameNorm, ...e.aliases].map((v) => trigramSimilarity(norm, v));
      const sim = Math.max(...sims);
      if (!best || sim > best.sim) best = { id: e.id, sim };
    }
    if (best && best.sim >= ENTITY_REVIEW_THRESHOLD) {
      this.logEntityCandidate(c.name, best.id, { sim: best.sim, tier: "truncated" });
    }
  }

  // ADR-0031 D5: three-tier match (exact -> trigram) + Fellegi-Sunter two thresholds + type gate.
  // Type gate: fuzzy tiers are same-type only; exact tier also reuses a declared row (declared is authoritative).
  private resolveEntity(name: string, type: EntityType): number {
    const norm = normalizeEntityName(name);
    const live = this.liveEntities();
    const normHit = live.find((e) => e.nameNorm === norm || e.aliases.includes(norm));
    if (normHit && (normHit.type === type || type === "declared" || normHit.type === "declared")) return normHit.id;
    // fuzzy: same-type only (type gate — Mem0 #5438 lesson: no cross-type merge)
    let best: { id: number; sim: number } | null = null;
    for (const e of live) {
      if (e.type !== type) continue;
      const sims = [e.nameNorm, ...e.aliases].map((v) => trigramSimilarity(norm, v));
      const sim = Math.max(...sims);
      if (!best || sim > best.sim) best = { id: e.id, sim };
    }
    if (best && best.sim >= ENTITY_ALIAS_THRESHOLD) {
      // ADR-0032 D2: unmerge wrote kind="override" records for the split pair — auto alias-merge
      // of that pair is blocked until a human merges manually (Splink override precedent).
      const blocked = this.db
        .prepare("SELECT id FROM entity_merge_log WHERE kind = 'override' AND source_name = ? AND target_entity_id = ? LIMIT 1")
        .get(norm, best.id) as { id: number } | undefined;
      if (!blocked) {
        // high-confidence variant: append as alias, reversible via entity_merge_log kind="alias".
        const row = live.find((e) => e.id === (best as { id: number }).id);
        if (row && !row.aliases.includes(norm)) {
          const next = JSON.stringify([...row.aliases, norm]);
          this.db.prepare("UPDATE entities SET aliases = ? WHERE id = ?").run(next, row.id);
          this.db.prepare("INSERT INTO entity_merge_log (kind, source_name, target_entity_id, detail) VALUES (?, ?, ?, ?)")
          .run("alias", name, row.id, JSON.stringify({ sim: best.sim, tier: "alias" }));
        }
        return best.id;
      }
      // override-blocked: fall through and keep the pair separate (flag-don't-silently-merge).
    }
    // new entity row (unique-index race tolerated: on conflict re-read)
    let newId: number;
    try {
      const info = this.db.prepare("INSERT INTO entities (name, name_norm, entity_type) VALUES (?, ?, ?)").run(name, norm, type);
      newId = Number(info.lastInsertRowid);
    } catch {
      const again = this.db.prepare("SELECT id FROM entities WHERE name_norm = ? AND entity_type = ? AND valid_until IS NULL").get(norm, type) as { id: number } | undefined;
      if (!again) throw new Error("entity insert race for " + norm);
      newId = again.id;
    }
    if (best && best.sim >= ENTITY_REVIEW_THRESHOLD) {
      // Fellegi-Sunter review band: keep separate, but log a merge candidate for review (dedup'd).
      this.logEntityCandidate(name, best.id, { sim: best.sim, tier: "review", newEntityId: newId });
    }
    return newId;
  }

  // ADR-0031 D5: reversible merge undo — only alias-appends are undoable (candidate band never mutated anything).
  public undoEntityMerge(logId: number): boolean {
    const log = this.db.prepare("SELECT id, kind, source_name, target_entity_id, undone FROM entity_merge_log WHERE id = ?").get(logId) as { id: number; kind: string; source_name: string; target_entity_id: number; undone: number } | undefined;
    if (!log || log.undone !== 0 || log.kind !== "alias") return false;
    const row = this.db.prepare("SELECT aliases FROM entities WHERE id = ?").get(log.target_entity_id) as { aliases: string } | undefined;
    if (!row) return false;
    const norm = normalizeEntityName(log.source_name);
    const next = (JSON.parse(row.aliases) as string[]).filter((a) => a !== norm);
    this.db.prepare("UPDATE entities SET aliases = ? WHERE id = ?").run(JSON.stringify(next), log.target_entity_id);
    this.db.prepare("UPDATE entity_merge_log SET undone = 1 WHERE id = ?").run(logId);
    return true;
  }

  // ADR-0031 D4: entity arm — read-only resolution (exact/containment, no mutation), arm-level valid_until+quarantine guard.
  // ---- ADR-0032: destructive merge execution (combine / unmerge / review belt / telemetry) ----

  // ADR-0032 D1/D4: destructive redirect merge. Single better-sqlite3 transaction (deferred);
  // snapshot is written in the SAME transaction as the redirect (acceptance requires it).
  // No RETURNING and no FTS-triggered tables touched inside the transaction (better-sqlite3 #654).
  public async combineEntities(fromId: number, toId: number): Promise<{ ok: boolean; logId?: number; error?: string }> {
    const now = (this.db.prepare("SELECT datetime('now') as t").get() as { t: string }).t;
    const tx = this.db.transaction((from: number, toIdArg: number): { ok: boolean; logId?: number; error?: string } => {
      if (from === toIdArg) return { ok: false, error: "same entity id" };
      const a = this.db.prepare("SELECT id, name, name_norm, entity_type, aliases, valid_until FROM entities WHERE id = ?").get(from) as
        { id: number; name: string; name_norm: string; entity_type: string; aliases: string; valid_until: string | null } | undefined;
      const b = this.db.prepare("SELECT id, name, name_norm, entity_type, aliases, valid_until FROM entities WHERE id = ?").get(toIdArg) as
        { id: number; name: string; name_norm: string; entity_type: string; aliases: string; valid_until: string | null } | undefined;
      if (!a || !b) return { ok: false, error: "entity not found" };
      if (a.valid_until || b.valid_until) return { ok: false, error: "one side is already closed (tombstoned)" };
      if (a.entity_type !== b.entity_type && a.entity_type !== "declared" && b.entity_type !== "declared")
        return { ok: false, error: "type gate: cross-type merge rejected (ADR-0031 D5)" };
      const fromAliases = JSON.parse(a.aliases || "[]") as string[];
      const toAliasesBefore = JSON.parse(b.aliases || "[]") as string[];
      const redirected = (this.db.prepare("SELECT memory_id FROM memory_entity WHERE entity_id = ?").all(from) as Array<{ memory_id: number }>)
        .map((r) => r.memory_id);
      // Redirect, tolerating (memory_id, toId) pairs that already exist (UNIQUE(memory_id, entity_id)).
      for (const mid of redirected) {
        const dup = this.db.prepare("SELECT 1 as x FROM memory_entity WHERE memory_id = ? AND entity_id = ?").get(mid, toIdArg) as { x: number } | undefined;
        if (dup) this.db.prepare("DELETE FROM memory_entity WHERE memory_id = ? AND entity_id = ?").run(mid, from);
        else this.db.prepare("UPDATE memory_entity SET entity_id = ? WHERE memory_id = ? AND entity_id = ?").run(toIdArg, mid, from);
      }
      // Keep Aliases (Neo4j): the merged-away name_norm becomes an alias of the survivor.
      const union = Array.from(new Set([...toAliasesBefore, ...fromAliases, a.name_norm]));
      this.db.prepare("UPDATE entities SET aliases = ? WHERE id = ?").run(JSON.stringify(union), toIdArg);
      this.db.prepare("UPDATE entities SET valid_until = ? WHERE id = ?").run(now, from);
      const detail = JSON.stringify({
        fromEntityId: from, fromName: a.name, fromNorm: a.name_norm, fromAliases,
        toAliasesBefore, redirectedMemoryIds: redirected, mergedAt: now,
      });
      const info = this.db.prepare("INSERT INTO entity_merge_log (kind, source_name, target_entity_id, detail) VALUES (?, ?, ?, ?)")
        .run("merge", a.name_norm, toIdArg, detail);
      return { ok: true, logId: Number(info.lastInsertRowid) };
    });
    try {
      return tx(fromId, toId);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  // ADR-0032 D2: bounded unmerge — snapshot-driven redirect-back + revive + alias restore + override.
  // Compensation semantics: writes that landed on the target AFTER the merge stay on it.
  public async unmergeEntity(logId: number): Promise<{ ok: boolean; error?: string }> {
    const tx = this.db.transaction((id: number): { ok: boolean; error?: string } => {
      const logRow = this.db.prepare("SELECT id, kind, source_name, target_entity_id, detail, undone FROM entity_merge_log WHERE id = ?").get(id) as
        { id: number; kind: string; source_name: string; target_entity_id: number; detail: string | null; undone: number } | undefined;
      if (!logRow || logRow.kind !== "merge" || logRow.undone !== 0) return { ok: false, error: "merge log not found (or already undone)" };
      const snap = JSON.parse(logRow.detail ?? "{}") as {
        fromEntityId?: number; fromNorm?: string; fromAliases?: string[]; toAliasesBefore?: string[]; redirectedMemoryIds?: number[];
      };
      if (typeof snap.fromEntityId !== "number" || !snap.fromNorm || !snap.fromAliases || !snap.toAliasesBefore || !snap.redirectedMemoryIds)
        return { ok: false, error: "snapshot incomplete — refusing unmerge (D2: snapshot is the only basis)" };
      // Bounded: only memory rows from the snapshot are redirected back; post-merge rows stay.
      for (const mid of snap.redirectedMemoryIds) {
        const cur = this.db.prepare("SELECT entity_id FROM memory_entity WHERE memory_id = ?").get(mid) as { entity_id: number } | undefined;
        if (cur && cur.entity_id === logRow.target_entity_id) {
          this.db.prepare("UPDATE memory_entity SET entity_id = ? WHERE memory_id = ?").run(snap.fromEntityId, mid);
        } else if (!cur) {
          // Row vanished (dedup'd away at merge time, or memory deleted) — restore if memory still exists.
          const mem = this.db.prepare("SELECT id FROM retrieval_results WHERE id = ?").get(mid) as { id: number } | undefined;
          if (mem) this.db.prepare("INSERT OR IGNORE INTO memory_entity (memory_id, entity_id) VALUES (?, ?)").run(mid, snap.fromEntityId);
        }
      }
      // Revive + restore aliases by whole-value overwrite (overlap-safe: no set subtraction).
      this.db.prepare("UPDATE entities SET valid_until = NULL, aliases = ? WHERE id = ? AND valid_until IS NOT NULL").run(JSON.stringify(snap.fromAliases), snap.fromEntityId);
      const target = this.db.prepare("SELECT valid_until, name_norm FROM entities WHERE id = ?").get(logRow.target_entity_id) as
        { valid_until: string | null; name_norm: string } | undefined;
      if (target && target.valid_until === null)
        this.db.prepare("UPDATE entities SET aliases = ? WHERE id = ?").run(JSON.stringify(snap.toAliasesBefore), logRow.target_entity_id);
      this.db.prepare("UPDATE entity_merge_log SET undone = 1 WHERE id = ?").run(id);
      // Override guard (both directions): the pair must not auto-merge again.
      this.db.prepare("INSERT INTO entity_merge_log (kind, source_name, target_entity_id, detail) VALUES (?, ?, ?, ?)")
        .run("override", snap.fromNorm, logRow.target_entity_id, JSON.stringify({ unmergedLogId: id }));
      this.db.prepare("INSERT INTO entity_merge_log (kind, source_name, target_entity_id, detail) VALUES (?, ?, ?, ?)")
        .run("override", target ? target.name_norm : "", snap.fromEntityId, JSON.stringify({ unmergedLogId: id }));
      return { ok: true };
    });
    try {
      return tx(logId);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  // ADR-0032 D3: candidate review belt — unresolved candidates, hit_count desc (Senzing escalation).
  public async listEntityReview(): Promise<EntityReviewRow[]> {
    const rows = this.db
      .prepare(
        "SELECT l.id, l.source_name, l.target_entity_id, l.hit_count, l.detail, l.created_at, e.name AS target_name" +
        " FROM entity_merge_log l LEFT JOIN entities e ON e.id = l.target_entity_id" +
        " WHERE l.kind = 'candidate' AND l.resolved IS NULL AND l.undone = 0 ORDER BY l.hit_count DESC, l.created_at DESC"
      )
      .all() as Array<{ id: number; source_name: string; target_entity_id: number; hit_count: number; detail: string | null; created_at: string; target_name: string | null }>;
    return rows.map((r) => ({
      id: r.id, sourceName: r.source_name, targetEntityId: r.target_entity_id, targetName: r.target_name,
      hitCount: r.hit_count, suggested: r.hit_count >= 2, detail: r.detail, createdAt: r.created_at,
    }));
  }

  // ADR-0032 D3/D5: keep = execute the merge (writes resolved='confirmed'); drop = keep separate
  // ('rejected'). Outcomes are written back to the log (report-only telemetry source).
  public async resolveEntityReview(id: number, action: "keep" | "drop"): Promise<{ ok: boolean; error?: string }> {
    const row = this.db
      .prepare("SELECT id, source_name, target_entity_id, detail FROM entity_merge_log WHERE id = ? AND kind = 'candidate' AND resolved IS NULL AND undone = 0")
      .get(id) as { id: number; source_name: string; target_entity_id: number; detail: string | null } | undefined;
    if (!row) return { ok: false, error: "candidate not found (or already resolved)" };
    if (action === "drop") {
      this.db.prepare("UPDATE entity_merge_log SET resolved = 'rejected' WHERE id = ?").run(id);
      return { ok: true };
    }
    const detail = JSON.parse(row.detail ?? "{}") as { newEntityId?: number };
    if (typeof detail.newEntityId !== "number")
      return { ok: false, error: "no newEntityId in detail (truncated-tier candidate) — merge manually: ans entity merge <fromId> <toId>" };
    const merged = await this.combineEntities(detail.newEntityId, row.target_entity_id);
    if (!merged.ok) return { ok: false, error: merged.error };
    this.db.prepare("UPDATE entity_merge_log SET resolved = 'confirmed' WHERE id = ?").run(id);
    return { ok: true };
  }

  // ADR-0032 D5: six report-only merge metrics. Counters are derived from the persistent merge log
  // (survive restarts); review_pending is a gauge (queue depth); review pending + truncation reflect
  // the current run's state. NEVER gated (Goodhart clause; n is far below statistical power).
  public entityMergeTelemetry(): EntityMergeTelemetry {
    const count = (where: string): number => (this.db.prepare("SELECT COUNT(*) as n FROM entity_merge_log WHERE " + where).get() as { n: number }).n;
    return {
      auto_merged: count("kind = 'merge'"),
      unmerged: count("kind = 'merge' AND undone = 1"),
      review_pending: count("kind = 'candidate' AND resolved IS NULL AND undone = 0"),
      confirmed: count("kind = 'candidate' AND resolved = 'confirmed'"),
      rejected: count("kind = 'candidate' AND resolved = 'rejected'"),
      candidates_truncated: this.entityTel.truncated,
    };
  }

  private entityArmRows(query: string, limit: number): MemoryHit[] {
    this.entityTel.queries += 1;
    const known = new Set(this.liveEntities().flatMap((e) => [e.nameNorm, ...e.aliases])); // r74 audit E2: aliases recognized read-side too
    const candidates = extractEntityCandidates(query, known);
    if (candidates.length === 0) return [];
    this.entityTel.candidates += 1;
    const norms = candidates.map((c) => normalizeEntityName(c.name));
    const matched = this.liveEntities().filter((e) => norms.some((nm) => e.nameNorm === nm || e.nameNorm.startsWith(nm + "-") || nm.startsWith(e.nameNorm + "-") || e.aliases.includes(nm)));
    if (matched.length === 0) return [];
    this.entityTel.activations += 1;
    const ids = matched.map((e) => e.id);
    const sql = "SELECT DISTINCT r.id as rowid, r.session_id as sessionId, r.title as role, r.snippet as content, 0.0 as rank FROM retrieval_results r " + // r74 audit E5: rank required by MemoryHit
      "JOIN memory_entity me ON me.memory_id = r.id WHERE me.entity_id IN (" + ids.map(() => "?").join(", ") + ") " +
      "AND (r.valid_until IS NULL) AND (r.quarantine IS NULL) ORDER BY r.created_at DESC LIMIT ?";
    const rows = this.db.prepare(sql).all(...ids, limit) as MemoryHit[];
    this.entityTel.hits += rows.length;
    return rows;
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
      // r74 audit E5: dropped memories leave no entity-graph residue.
      this.db.prepare("DELETE FROM memory_entity WHERE memory_id = ?").run(id);
    }
    return { ok: true };
  }

  close(): void {
    this.db.close();
  }
}
