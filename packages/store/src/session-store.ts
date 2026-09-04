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
import { extractRelations, parseLlmTriples, dedupeTriples, patternAllows, EDGE_PATTERN_ROWS, RELATION_RULES_VERSION } from "./relation.js";
import type { ExtractedTriple, LinkedEntityRef } from "./relation.js";
import type { EntityType, EntityCandidate } from "./entity.js";
import { rrfRank, FUSION_REGISTRY, SCORE_KIND, registryWeight } from "@anysearch/retriever";
import { consolidateMemoryRun, scanArchiveCandidates, applyArchive, undoArchive } from "./consolidate.js";
import type { ConsolidateSummarizeFn, ConsolidateClassifyFn, ConsolidateReport, ArchiveCandidate, ArchiveApplyReport } from "./consolidate.js";
import { bootstrapAccessChain, eventHash, CHAIN_SCHEMA_VERSION, CHAIN_EVENT_TYPE, type ChainEventRow } from "./access-chain.js";
import { embedText, embeddingTelemetry as pkgEmbeddingTelemetry, cosineSimilarity, EMBEDDING_MODEL_ID } from "@anysearch/embedding";
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

// ADR-0037 D3/D6: semantic arm mode. Phase-1 was shadow; landed Phase-2 serve below.
// Phase-2 = "serve" (conditioned activation, weight 0.5 via fts5.ts extra arms).
// ADR-0037 D6 Phase-2: arm live at weight 0.5, conditional activation; regression gate fail-closed (runner sem counterfactual).
const SEMANTIC_ARM_MODE: "shadow" | "serve" = "serve";

export interface MemoryHit {
  rowid: number;
  sessionId: string;
  role: string;
  content: string;
  rank: number;
  // ADR-0033 D8: arm provenance ("fts" | "entity" | "vector"); absent on legacy paths. A vector-only hit is weak evidence (answer-layer abstain signal).
  arms?: string[];
}

// ADR-0036 D3: eval-only snapshot of one searchMemory call's RRF inputs, so the runner can
// recompute the relation-arm-off counterfactual without a second retrieval (single-run cost ~1x).
export interface ArmProvenance {
  // ADR-0045 D2/D3: common fusion provenance shape fields.
  instance: "memory";
  labels: string[];      // parallel to lists/weights; five-arm order: fts, entity, vector, relation
  lists: string[][];     // rowid strings per arm, rank order
  weights: number[];
  fusedIds: string[];    // full fused id order (pre-limit, pre-secret-filter)
  scoreKind: "rank_fusion"; // fused score is a rank_fusion signal only (ADR-0045 D3)
  texts: Map<number, string>; // rowid -> role + " " + content for title matching
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
  // ADR-0035 D3/D5: entity-relation edge layer (KG-lite fifth retrieval arm).
  relationArmRows(query: string, limit?: number): MemoryHit[];
  listRelations(opts?: { entity?: string; limit?: number }): Promise<RelationRow[]>;
  backfillRelations(opts: { apply: boolean; batch?: number; fromId?: number; limit?: number; reprocess?: boolean; fullRefresh?: boolean }): Promise<BackfillRelationsResult>;
  relationTelemetry(): RelationTelemetry;
  // ADR-0040 D2: alert-on-silence telemetry — event write failures are counted, never silent.
  accessEventTelemetry(): AccessEventTelemetry;
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

// ADR-0035 D3: one live edge joined to both endpoint entity display names (relation list).
export interface RelationRow {
  id: number;
  sourceEntityId: number;
  sourceName: string;
  relation: string;
  targetEntityId: number;
  targetName: string;
  confidence: number;
  episodeMemoryId: number | null;
  rulesVersion: number;
  createdAt: string;
}

// ADR-0035 D7: dry-run/apply report through the same shape. Dry-run executes the identical
// apply pipeline inside a rolled-back transaction, so every counter is an exact prediction
// (r87 audit F1) — never an upper bound. Exit code is a CLI concern (0/1/2).
export interface BackfillRelationsResult {
  apply: boolean;
  scanned: number;
  written: number;
  dedupSkipped: number;
  schemaRejected: number;
  lastId: number;
}

// ADR-0035 D8: report-only relation telemetry. pendingEdges is a derived gauge (linked memories
// lacking an edge episode row) — the backfill coverage signal, recomputed at read time.
export interface RelationTelemetry {
  ruleHits: number;
  llmActivations: number;
  llmFailures: number;
  triplesWritten: number;
  dedupSkipped: number;
  // repeat-episode attempts against a live write-once related_to edge — NOT dedup (r87 audit F2/F7)
  relatedToWriteOnce: number;
  schemaRejected: number;
  pendingEdges: number;
  armQueries: number;
  armHits: number;
}

// ADR-0040 D2/D6: access-event chain telemetry (observational zone; report-only, never gated).
export interface AccessEventTelemetry {
  writeFailures: number;   // chained event insert failures (alert-on-silence counter)
  bootstrapFailed: boolean; // constructor anchor bootstrap degraded (stderr WARN emitted)
}

// better-sqlite3 sync API wrapped in async interface to match SessionStore port.
// ponytail: thinnest wrapper - no extra abstraction, sync calls wrapped in Promise.resolve.
// ADR-0044 D5: legacy access_events had memory_id NOT NULL, forcing a fake retrieval_results
// sentinel for switch edges. Rebuild that table once so switch edges can use NULL memory_id
// while real access events still satisfy the FK through the same CHECK.
function migrateSwitchEventSchema(db: Database.Database): void {
  const cols = db.prepare("PRAGMA table_info(access_events)").all() as Array<{ name: string; notnull: number }>;
  const memory = cols.find((c) => c.name === "memory_id");
  const hasChainColumns = cols.some((c) => c.name === "prev_hash");
  if (!memory || memory.notnull !== 1 || !hasChainColumns) return;
  db.pragma("foreign_keys = OFF");
  const run = db.transaction((): void => {
    db.exec(`
      CREATE TABLE access_events_switch_migrate (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_id INTEGER REFERENCES retrieval_results(id) ON DELETE CASCADE,
        accessed_at TEXT NOT NULL DEFAULT (datetime('now')),
        prev_hash TEXT,
        schema_version INTEGER,
        event_type TEXT,
        CHECK (memory_id IS NOT NULL OR event_type IS NOT NULL)
      );
      INSERT INTO access_events_switch_migrate (id, memory_id, accessed_at, prev_hash, schema_version, event_type)
        SELECT id, memory_id, accessed_at, prev_hash, schema_version, event_type FROM access_events;
      DROP TABLE access_events;
      ALTER TABLE access_events_switch_migrate RENAME TO access_events;
      CREATE INDEX IF NOT EXISTS idx_access_events_memory ON access_events(memory_id);
      CREATE INDEX IF NOT EXISTS idx_access_events_time ON access_events(accessed_at);
    `);
  });
  run.immediate();
  db.pragma("foreign_keys = ON");
}

export class SqliteSessionStore implements SessionStore {
  private db: Database.Database;
  // ADR-0031 D2: LLM entity backfill (optional, fail-open) — invoked only when rule extraction finds nothing.
  private readonly entityLlmFallback?: (text: string) => Promise<EntityCandidate[] | null>;
  // ADR-0035 D4: LLM relation seam (optional, fail-open) — returns RAW model text; relation.ts
  // parseLlmTriples does the Graphiti-style json_schema to json_object degrade.
  private readonly relationLlmFallback?: (text: string) => Promise<string | null>;
  // ADR-0037 D4: consolidation seams (summarize = bounded LLM per cluster; classify = kernel
  // classifyClaim-shaped fidelity gate). Both optional and fail-open.
  private readonly consolidateSummarize?: ConsolidateSummarizeFn;
  private readonly consolidateClassify?: ConsolidateClassifyFn;
  // ADR-0037 D3/D6: semantic arm telemetry (serve mode; Phase-1 shadow contract retired).
  private readonly semTel = { queries: 0, hits: 0, served: 0 };
  // ADR-0031 step7: entity arm telemetry counters (report-only in eval).
  private readonly entityTel = { queries: 0, candidates: 0, activations: 0, hits: 0, truncated: 0 };
  // ADR-0033 D5/D6: vector arm telemetry (fail-open writes; pendingVectors = rows lacking an embedding).
  private readonly embedTel = { writes: 0, pendingVectors: 0, armQueries: 0, armHits: 0 };
  // ADR-0035 D8: relation extraction + arm telemetry (report-only, never gated).
  // ADR-0040 D2: alert-on-silence — event write failures and bootstrap degradation are counted.
  private readonly accessEventTel: AccessEventTelemetry = { writeFailures: 0, bootstrapFailed: false };
  private readonly relationTel = { ruleHits: 0, llmActivations: 0, llmFailures: 0, triplesWritten: 0, dedupSkipped: 0, relatedToWriteOnce: 0, schemaRejected: 0, armQueries: 0, armHits: 0 };
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
    // ADR-0039 D5: append-only access event twin of touchAccessed (transaction-time log; never gated).
    insertAccessEvent: Database.Statement;
    // ADR-0040 D4: chain head lookup (latest event with non-NULL prev_hash).
    lastChainedEvent: Database.Statement;
    // ADR-0016 D10: UPSERT for state-type anchors (consolidation_state).
    saveAnchorUpsert: Database.Statement;
  };

  constructor(dbPath: string, opts?: {
    entityLlmFallback?: (text: string) => Promise<EntityCandidate[] | null>;
    relationLlmFallback?: (text: string) => Promise<string | null>;
    // ADR-0037 D4: consolidation seams (same injection discipline as relationLlmFallback).
    consolidateSummarize?: ConsolidateSummarizeFn;
    consolidateClassify?: ConsolidateClassifyFn;
  }) {
    this.entityLlmFallback = opts?.entityLlmFallback;
    this.relationLlmFallback = opts?.relationLlmFallback;
    this.consolidateSummarize = opts?.consolidateSummarize;
    this.consolidateClassify = opts?.consolidateClassify;
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
    migrateSwitchEventSchema(this.db);
    // ADR-0035 D2: edge-pattern constraint seed (idempotent; mirrors EDGE_PATTERN_ROWS in relation.ts;
    // existing rows are preserved via INSERT OR IGNORE).
    const seedPattern = this.db.prepare("INSERT OR IGNORE INTO edge_patterns (head_type, relation, tail_type) VALUES (?, ?, ?)");
    for (const [h, r, t] of EDGE_PATTERN_ROWS) seedPattern.run(h, r, t);
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
    // ADR-0037 D5: soft archive (reversible forgetting).
    try { this.db.exec("ALTER TABLE retrieval_results ADD COLUMN archived INTEGER NOT NULL DEFAULT 0"); } catch {}
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

    // ADR-0040 step 1/3: chain columns (idempotent ALTER per existing convention) + one-off
    // anchor bootstrap in an IMMEDIATE transaction (D6). Persistent busy/IO failure degrades to
    // stderr WARN + telemetry bit (ADR-0009 D6 fail-open); the write path re-probes the anchor.
    try { this.db.exec("ALTER TABLE access_events ADD COLUMN prev_hash TEXT"); } catch {}
    try { this.db.exec("ALTER TABLE access_events ADD COLUMN schema_version INTEGER"); } catch {}
    try { this.db.exec("ALTER TABLE access_events ADD COLUMN event_type TEXT"); } catch {}
    try {
      bootstrapAccessChain(this.db);
    } catch (e) {
      this.accessEventTel.bootstrapFailed = true;
      process.stderr.write("anysearch: access-chain bootstrap degraded (fail-open): " + String((e as Error)?.message ?? e) + "\n");
    }

   // Module-level prepared statements (atomcode research pattern).
    this.stmts = {
      createSession: this.db.prepare("INSERT INTO sessions (id, domain) VALUES (?, ?) RETURNING id, domain, created_at as createdAt"),
      append: this.db.prepare("INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)"),
      searchMessages: this.db.prepare("SELECT m.id as rowid, m.session_id as sessionId, m.role, m.content, bm25(messages_fts) as rank FROM messages_fts JOIN messages m ON m.id = messages_fts.rowid WHERE messages_fts MATCH ? AND m.session_id = ? ORDER BY rank LIMIT ?"),
      searchAllMessages: this.db.prepare("SELECT m.id as rowid, m.session_id as sessionId, m.role, m.content, bm25(messages_fts) as rank FROM messages_fts JOIN messages m ON m.id = messages_fts.rowid WHERE messages_fts MATCH ? ORDER BY rank LIMIT ?"),
      saveResult: this.db.prepare("INSERT INTO retrieval_results (session_id, url, title, snippet, source, rrf_score, entity) VALUES (?, ?, ?, ?, ?, ?, ?)"),
      searchResults: this.db.prepare("SELECT r.id as rowid, r.session_id as sessionId, r.title, r.snippet, bm25(retrieval_results_fts) as rank FROM retrieval_results_fts JOIN retrieval_results r ON r.id = retrieval_results_fts.rowid WHERE retrieval_results_fts MATCH ? AND r.session_id = ? AND r.archived = 0 ORDER BY rank LIMIT ?"),
      saveAnchor: this.db.prepare("INSERT INTO resume_anchors (session_id, anchor_type, payload) VALUES (?, ?, ?)"),
      getAnchors: this.db.prepare("SELECT id, session_id as sessionId, anchor_type as anchorType, payload, created_at as createdAt FROM resume_anchors WHERE session_id = ? ORDER BY id"),
      // ADR-0008 D3: recall_memory searches Research Memory (retrieval_results_fts), not messages.
      // ADR-0008 D2 -> ADR-0030: freshness_factor() in ORDER BY + bi-temporal filter (valid_until IS NULL).
     // MemoryHit.role <-- r.title, MemoryHit.content <-- r.snippet (recall_memory maps these fields).
     searchAllResults: this.db.prepare("SELECT r.id as rowid, r.session_id as sessionId, r.title as role, r.snippet as content, freshness_factor(bm25(retrieval_results_fts), r.created_at, r.last_accessed, r.access_count, r.title, r.url, ?, r.pinned) as rank FROM retrieval_results_fts JOIN retrieval_results r ON r.id = retrieval_results_fts.rowid WHERE retrieval_results_fts MATCH ? AND (r.valid_until IS NULL) AND (r.quarantine IS NULL) AND (r.archived = 0) ORDER BY rank LIMIT ?"),
      // ADR-0009 D3 L2: update last_accessed on recall hit (access-time signal, Mem0 1.5×/0.3×).
      touchAccessed: this.db.prepare("UPDATE retrieval_results SET last_accessed = datetime('now'), access_count = COALESCE(access_count, 0) + 1 WHERE id = ?"),
      // ADR-0039 D5: same exactly-once site — each returned hit logs one access event.
      // ADR-0040 D4: chained insert — prev_hash + schema_version(v1) + event_type per event.
      insertAccessEvent: this.db.prepare("INSERT INTO access_events (memory_id, prev_hash, schema_version, event_type) VALUES (?, ?, ?, ?)"),
      lastChainedEvent: this.db.prepare("SELECT id, memory_id, accessed_at, prev_hash, schema_version, event_type FROM access_events WHERE prev_hash IS NOT NULL ORDER BY id DESC LIMIT 1"),
      // ADR-0016 D10: UPSERT for state-type anchors.
  
      saveAnchorUpsert: this.db.prepare("INSERT INTO resume_anchors (session_id, anchor_type, payload) VALUES (?, ?, ?) ON CONFLICT(session_id, anchor_type) WHERE anchor_type = 'consolidation_state' DO UPDATE SET payload = excluded.payload, created_at = datetime('now')"),
    };
  }

  // ADR-0040 D4/D6: chain an access event onto the hash chain. Head-read + insert run in one
  // IMMEDIATE transaction so CLI+MCP dual-process writes cannot interleave into a fork. The anchor
  // is re-probed before the first chained insert so cut-over survives a crashed constructor (D6).
  // Never throws into recall paths: call sites catch and increment accessEventTel.writeFailures.
  private recordAccessEventChained(memoryId: number): void {
    const write = this.db.transaction(() => {
      const last = this.stmts.lastChainedEvent.get() as ChainEventRow | undefined;
      let prevHash: string;
      if (last) {
        prevHash = eventHash(last);
      } else {
        let anchor = this.db.prepare("SELECT genesis_hash FROM access_chain_anchor WHERE id = 1").get() as { genesis_hash: string } | undefined;
        if (!anchor) {
          bootstrapAccessChain(this.db);
          anchor = this.db.prepare("SELECT genesis_hash FROM access_chain_anchor WHERE id = 1").get() as { genesis_hash: string } | undefined;
        }
        if (!anchor) throw new Error("access-chain anchor unavailable");
        prevHash = anchor.genesis_hash;
      }
      this.stmts.insertAccessEvent.run(memoryId, prevHash, CHAIN_SCHEMA_VERSION, CHAIN_EVENT_TYPE);
    });
    write.immediate();
  }

  // ADR-0040 D2: alert-on-silence telemetry — observational zone only, never gated (Goodhart).
  accessEventTelemetry(): AccessEventTelemetry {
    return { ...this.accessEventTel };
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

  // ADR-0036 D3: eval-only capture of the latest searchMemory arm inputs. Written on every
  // searchMemory call; the eval runner (golden search ops) is the only reader. Never part of
  // the external contract — do not consume from apps/ or kernel.
  public lastArmProvenance: ArmProvenance | null = null;

  async searchMemory(query: string, limit = 20): Promise<MemoryHit[]> {
   const safeQuery = this.fts5Escape(query);
   // Params: (query_for_decay, fts_match_query, limit) — same string passed twice for both ? slots.
   const rawHits = this.stmts.searchAllResults.all(safeQuery, safeQuery, limit) as MemoryHit[];
   // ADR-0031 D4: entity arm — conditional activation (absent when query has no entity match), weight 0.5 vs FTS 1.0.
   const armHits = this.entityArmRows(query, limit);
   const vecHits = await this.vectorArmRows(query, limit);
   // ADR-0035 D5: relation arm (fifth, weight 0.5) — 1-hop neighbor memories via active edges.
   const relHits = this.relationArmRows(query, limit);
   // ADR-0037 D6 Phase-2: semantic arm (sixth, weight 0.5, conditional activation).
   const semHits = await this.semanticArmRows(query, limit);
   const byId = new Map<number, MemoryHit>();
    for (const h of rawHits) byId.set(h.rowid, h);
    for (const h of armHits) byId.set(h.rowid, h);
    for (const h of vecHits) byId.set(h.rowid, h);
    for (const h of relHits) byId.set(h.rowid, h);
    for (const h of semHits) byId.set(h.rowid, h); // r94 audit A1: semantic ids must resolve on the single-query path (was silent drop, atomcode Spec-1)
   // ADR-0033 D5: RRF arms = FTS (1.0) + entity (0.5) + vector (0.5); an absent arm adds no list (conditional activation).
   // ADR-0045 D2: MemoryFusion consumes the registry — k_fusion.memory + weights.memory
   // (FTS anchor 1.0; side arms 0.5). Values identical to the pre-registry literals.
   const lists = [rawHits.map((h) => String(h.rowid))];
   const weights: number[] = [registryWeight("memory", "fts")];
   if (armHits.length > 0) { lists.push(armHits.map((h) => String(h.rowid))); weights.push(registryWeight("memory", "entity")); }
   if (vecHits.length > 0) { lists.push(vecHits.map((h) => String(h.rowid))); weights.push(registryWeight("memory", "vector")); }
   if (relHits.length > 0) { lists.push(relHits.map((h) => String(h.rowid))); weights.push(registryWeight("memory", "relation")); }
    if (SEMANTIC_ARM_MODE === "serve" && semHits.length > 0) { lists.push(semHits.map((h) => String(h.rowid))); weights.push(registryWeight("memory", "semantic")); }
   const fusedIds = lists.length === 1 ? lists[0]! : rrfRank(lists, FUSION_REGISTRY.k_fusion.memory, weights);
   const fusedHits: MemoryHit[] = [];
   for (const id of fusedIds) { const h = byId.get(Number(id)); if (h) fusedHits.push(h); if (fusedHits.length >= limit) break; }
   // ADR-0033 D8: arm provenance — a hit recalled ONLY by the vector arm is weak evidence.
   const ftsIds = new Set(rawHits.map((h) => h.rowid));
   const entIds = new Set(armHits.map((h) => h.rowid));
   const vecIds = new Set(vecHits.map((h) => h.rowid));
   const relIds = new Set(relHits.map((h) => h.rowid));
   const semIds = new Set(semHits.map((h) => h.rowid));
   // ADR-0036 D3: provenance snapshot taken BEFORE the read-side secret filter (the filter can
   // only remove rows; golden fixtures carry no secrets, so on/off deltas are unaffected).
   { const armLabels: string[] = ["fts"];
     if (armHits.length > 0) armLabels.push("entity");
     if (vecHits.length > 0) armLabels.push("vector");
     if (relHits.length > 0) armLabels.push("relation");
      if (SEMANTIC_ARM_MODE === "serve" && semHits.length > 0) armLabels.push("semantic");
     const provTexts = new Map<number, string>();
     for (const h of byId.values()) provTexts.set(h.rowid, h.role + " " + h.content);
     this.lastArmProvenance = { instance: "memory", labels: armLabels, lists: lists.map((l) => [...l]), weights: [...weights], fusedIds: [...fusedIds], scoreKind: SCORE_KIND, texts: provTexts }; }
   for (const h of fusedHits) { const al: string[] = []; if (ftsIds.has(h.rowid)) al.push("fts"); if (entIds.has(h.rowid)) al.push("entity"); if (vecIds.has(h.rowid)) al.push("vector"); if (relIds.has(h.rowid)) al.push("relation"); if (SEMANTIC_ARM_MODE === "serve" && semIds.has(h.rowid)) al.push("semantic"); h.arms = al; }
    // ADR-0028 D3 read-side exit: rows written before the write guard (or via seed/test seams)
    // must never surface back to the caller either.
    const hits = fusedHits.filter((h) => !containsSecret(h.role + " " + h.content));
    // ADR-0009 D3 L2: refresh last_accessed for each hit (access-time signal).
    for (const hit of hits) {
      try { this.stmts.touchAccessed.run(hit.rowid); this.recordAccessEventChained(hit.rowid); } catch { this.accessEventTel.writeFailures += 1; }
    }
    return hits;
  }

  // ADR-0023 D2 (Q2=B): multi-query + RRF k=60 fusion. queries[0] must be the raw user query.
  async searchMemoryMulti(queries: string[], limit = 20): Promise<MemoryHit[]> {
    // ADR-0031 D4: entity arm on the raw user query (queries[0]); ids passed as extra RRF list (weight 0.5 in fts5.ts).
    const armHits = this.entityArmRows(queries[0] ?? "", limit);
    const vecHits = await this.vectorArmRows(queries[0] ?? "", limit);
    // ADR-0033 D5: entity + vector arms, each weight 0.5 against FTS 1.0.
    // ADR-0033 D8: labeled arms so searchMemoryMultiQuery can annotate hit.arms provenance.
    const arms: { label: string; ids: string[] }[] = [];
    if (armHits.length > 0) arms.push({ label: "entity", ids: armHits.map((h) => String(h.rowid)) });
    if (vecHits.length > 0) arms.push({ label: "vector", ids: vecHits.map((h) => String(h.rowid)) });
    // ADR-0035 D5: relation arm on the raw query (weight 0.5 in fts5.ts like the other side arms).
    // ADR-0035 D5: the relation arm attaches to queries[0] only — the multi-query lane keeps the
    // conditional-activation contract on the primary query (r87 audit F5: documented to avoid
    // misreading as all-queries activation).
    const relHitsM = this.relationArmRows(queries[0] ?? "", limit);
    if (relHitsM.length > 0) arms.push({ label: "relation", ids: relHitsM.map((h) => String(h.rowid)) });
    // ADR-0037 D3/D6 Phase-2: semantic arm fused into RRF in serve mode (negative ids resolved
    // from semantic_memories in fts5.ts); telemetry still runs in both modes.
    const semHits = await this.semanticArmRows(queries[0] ?? "", limit);
    if (SEMANTIC_ARM_MODE === "serve" && semHits.length > 0) arms.push({ label: "semantic", ids: semHits.map((h) => String(h.rowid)) });
    const hits = await searchMemoryMultiQuery<MemoryHit>(this, queries, limit, rrfRank, arms);
    // ADR-0028 D3 read-side exit: same guard as searchMemory.
    const kept = hits.filter((h) => !containsSecret(h.role + " " + h.content));
    // ADR-0030 D3: same exactly-once touch as searchMemory (both recall paths feed the signals).
    for (const hit of kept) {
      try { this.stmts.touchAccessed.run(hit.rowid); this.recordAccessEventChained(hit.rowid); } catch { this.accessEventTel.writeFailures += 1; }
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
          .prepare("SELECT id FROM retrieval_results WHERE entity = ? AND session_id = ? AND valid_until IS NULL AND quarantine IS NULL AND archived = 0 LIMIT 1")
          .get(entityKey, sessionId) as { id: number } | undefined;
        const info = this.stmts.saveResult.run(sessionId, km.url, km.title, km.snippet, km.source, null, entityKey);
        const insertedId = Number(info.lastInsertRowid);
        await this.embedWrite(insertedId, km.title ?? null, km.snippet ?? null);
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
        await this.embedWrite(insertedId, km.title ?? null, km.snippet ?? null);
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
  // ADR-0033 D5/D6: vector arm telemetry + breaker state (report-only).
  public vectorTelemetry(): { writes: number; pendingVectors: number; armQueries: number; armHits: number; embeds: number; failures: number; circuitOpen: boolean; fromDb: number } {
    const pkg = pkgEmbeddingTelemetry();
    return { ...this.embedTel, embeds: pkg.embeds, failures: pkg.failures, circuitOpen: pkg.circuitOpen,
      fromDb: (this.db.prepare("SELECT COUNT(*) as n FROM memory_embeddings").get() as { n: number }).n };
  }

  // ADR-0033 D6: synchronous embed at write; failure records pendingVector (recoverable via backfill-vectors).
  private async embedWrite(memoryId: number, title: string | null, snippet: string | null): Promise<void> {
    const text = ((title ?? "") + " " + (snippet ?? "")).trim();
    if (!text) return;
    const v = await embedText(text, "passage");
    if (!v) { this.embedTel.pendingVectors++; return; }
    this.embedTel.writes++;
    this.db.prepare("INSERT OR REPLACE INTO memory_embeddings (memory_id, embedding, model) VALUES (?, ?, ?)")
      .run(memoryId, Buffer.from(v.buffer, v.byteOffset, v.byteLength), EMBEDDING_MODEL_ID);
  }

  // ADR-0033 D4/D5: vector arm — full-scan JS cosine over live, non-quarantined rows. Absent on CB-open.
  private async vectorArmRows(query: string, limit: number): Promise<MemoryHit[]> {
    this.embedTel.armQueries++;
    const qv = await embedText(query, "query");
    if (!qv) return [];
    const rows = this.db.prepare(
      "SELECT r.id as rowid, r.session_id as sessionId, r.title as role, r.snippet as content, me.embedding as emb " +
      "FROM memory_embeddings me JOIN retrieval_results r ON r.id = me.memory_id " +
      "WHERE r.valid_until IS NULL AND r.quarantine IS NULL AND r.archived = 0"
    ).all() as Array<{ rowid: number; sessionId: string; role: string | null; content: string | null; emb: Buffer }>;
    const scored: Array<{ h: MemoryHit; s: number }> = [];
    for (const r of rows) {
      const v = new Float32Array(r.emb.buffer, r.emb.byteOffset, r.emb.byteLength / 4);
      const s = cosineSimilarity(qv, v);
      scored.push({ h: { rowid: r.rowid, sessionId: r.sessionId, role: r.role ?? "", content: r.content ?? "", rank: -s } as MemoryHit, s });
    }
    scored.sort((a, b) => b.s - a.s);
    const out = scored.slice(0, limit).map((x) => x.h);
    this.embedTel.armHits += out.length;
    return out;
  }

  // ADR-0033 D6: idempotent backfill for rows missing an embedding (write failures, pre-rename upgrade, model re-embed).
  async backfillEmbeddings(dryRun = false, limit?: number): Promise<{ scanned: number; embedded: number; failed: number }> {
    const rows = this.db.prepare(
      "SELECT r.id, r.title, r.snippet FROM retrieval_results r LEFT JOIN memory_embeddings m ON m.memory_id = r.id WHERE m.memory_id IS NULL AND r.archived = 0" +
      (limit ? " LIMIT " + Math.max(1, Math.floor(limit)) : "")
    ).all() as Array<{ id: number; title: string | null; snippet: string | null }>;
    let embedded = 0, failed = 0;
    if (!dryRun) {
      for (const r of rows) {
        const text = ((r.title ?? "") + " " + (r.snippet ?? "")).trim();
        if (!text) { failed++; continue; }
        const v = await embedText(text, "passage");
        if (!v) { failed++; continue; }
        this.db.prepare("INSERT OR REPLACE INTO memory_embeddings (memory_id, embedding, model) VALUES (?, ?, ?)")
          .run(r.id, Buffer.from(v.buffer, v.byteOffset, v.byteLength), EMBEDDING_MODEL_ID);
        embedded++;
      }
    }
    return { scanned: rows.length, embedded, failed };
  }
  // ---- ADR-0037: episodic-to-semantic consolidation (D2/D4) + reversible forgetting (D5) ----

  async consolidateMemory(opts?: { dryRun?: boolean; limit?: number }): Promise<ConsolidateReport> {
    return consolidateMemoryRun(this.db, { summarize: this.consolidateSummarize, classify: this.consolidateClassify }, opts ?? {});
  }

  scanArchive(opts?: { ageFactor?: number; now?: number; limit?: number }): ArchiveCandidate[] {
    return scanArchiveCandidates(this.db, opts ?? {});
  }

  applyArchive(ids?: number[], opts?: { dryRun?: boolean }): ArchiveApplyReport {
    return applyArchive(this.db, ids, opts ?? {});
  }

  undoArchive(logId: number): { ok: boolean; memoryId?: number } {
    return undoArchive(this.db, logId);
  }

  // ADR-0037 D3/D6: semantic arm scoring (served in Phase-2). Full-table JS cosine over live semantic
  // rows, same pattern as vectorArmRows. Synthetic negative rowids (-semantic_memories.id) keep
  // the RRF id-space collision-free vs retrieval_results.
  private async semanticArmRows(query: string, limit: number): Promise<MemoryHit[]> {
    this.semTel.queries++;
    const qv = await embedText(query, "query");
    if (!qv) return [];
    const rows = this.db
      .prepare("SELECT id, content, embedding FROM semantic_memories WHERE valid_until IS NULL AND embedding IS NOT NULL")
      .all() as Array<{ id: number; content: string; embedding: Buffer }>;
    const scored: Array<{ h: MemoryHit; s: number }> = [];
    for (const r of rows) {
      const v = new Float32Array(r.embedding.buffer, r.embedding.byteOffset, r.embedding.byteLength / 4);
      const sv = cosineSimilarity(qv, v);
      scored.push({ h: { rowid: -r.id, sessionId: "", role: "(semantic)", content: r.content, rank: -sv } as MemoryHit, s: sv });
    }
    scored.sort((a, b) => b.s - a.s);
    const out = scored.slice(0, limit).map((x) => x.h);
    this.semTel.hits += out.length;
    if (SEMANTIC_ARM_MODE === "serve") this.semTel.served += out.length;
    return out;
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
    // ADR-0035 D4: relation extraction piggybacks this pass; preKnown marks entities that
    // existed before this write (co-occurrence related_to edges only fire between two preKnown refs).
    const linkedRefs: LinkedEntityRef[] = [];
    for (const c of candidates.slice(0, MAX_CANDIDATES + 1)) { // r74 audit E5: 1 declared + MAX_CANDIDATES rule/LLM
      const entityId = this.resolveEntity(c.name, c.type);
      this.db.prepare("INSERT OR IGNORE INTO memory_entity (memory_id, entity_id) VALUES (?, ?)").run(memoryId, entityId);
      const refNorm = normalizeEntityName(c.name);
      linkedRefs.push({ id: entityId, name: c.name, nameNorm: refNorm, entityType: c.type, preKnown: known.has(refNorm) });
    }
    try { await this.linkRelations(memoryId, km, linkedRefs); } catch {} // ADR-0035: fail-open, same discipline as linkEntities
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
      // r77 audit P1: memories linked to BOTH entities pre-merge are recorded in bothLinked —
      // unmerge must restore the from-link WITHOUT dropping the target link.
      const bothLinked: number[] = [];
      for (const mid of redirected) {
        const dup = this.db.prepare("SELECT 1 as x FROM memory_entity WHERE memory_id = ? AND entity_id = ?").get(mid, toIdArg) as { x: number } | undefined;
        if (dup) {
          bothLinked.push(mid);
          this.db.prepare("DELETE FROM memory_entity WHERE memory_id = ? AND entity_id = ?").run(mid, from);
        } else this.db.prepare("UPDATE memory_entity SET entity_id = ? WHERE memory_id = ? AND entity_id = ?").run(toIdArg, mid, from);
      }
      // Keep Aliases (Neo4j): the merged-away name_norm becomes an alias of the survivor.
      const union = Array.from(new Set([...toAliasesBefore, ...fromAliases, a.name_norm]));
      this.db.prepare("UPDATE entities SET aliases = ? WHERE id = ?").run(JSON.stringify(union), toIdArg);
      this.db.prepare("UPDATE entities SET valid_until = ? WHERE id = ?").run(now, from);
      // ADR-0035 D6: edges move with the merge. Self-loops and live-triple conflicts are
      // closed, not redirected; pre-merge endpoints land in the snapshot for bounded unmerge.
      const edgeRows = this.db
        .prepare("SELECT id, source_entity_id, target_entity_id, relation FROM edges WHERE valid_until IS NULL AND (source_entity_id = ? OR target_entity_id = ?)")
        .all(from, from) as Array<{ id: number; source_entity_id: number; target_entity_id: number; relation: string }>;
      const redirectedEdges: Array<{ id: number; sourceWas: number; targetWas: number }> = [];
      const closedDupEdgeIds: number[] = [];
      for (const e of edgeRows) {
        const ns = e.source_entity_id === from ? toIdArg : e.source_entity_id;
        const nt = e.target_entity_id === from ? toIdArg : e.target_entity_id;
        if (ns === nt) { closedDupEdgeIds.push(e.id); continue; }
        const conflict = this.db
          .prepare("SELECT id FROM edges WHERE source_entity_id = ? AND relation = ? AND target_entity_id = ? AND valid_until IS NULL AND id != ?")
          .get(ns, e.relation, nt, e.id) as { id: number } | undefined;
        if (conflict) { closedDupEdgeIds.push(e.id); continue; }
        this.db.prepare("UPDATE edges SET source_entity_id = ?, target_entity_id = ? WHERE id = ?").run(ns, nt, e.id);
        redirectedEdges.push({ id: e.id, sourceWas: e.source_entity_id, targetWas: e.target_entity_id });
      }
      for (const edgeId of closedDupEdgeIds) this.db.prepare("UPDATE edges SET valid_until = ? WHERE id = ?").run(now, edgeId);
      const detail = JSON.stringify({
        fromEntityId: from, fromName: a.name, fromNorm: a.name_norm, fromAliases,
        toAliasesBefore, redirectedMemoryIds: redirected, bothLinkedIds: bothLinked, mergedAt: now,
        redirectedEdges, closedDupEdgeIds,
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
        fromEntityId?: number; fromNorm?: string; fromAliases?: string[]; toAliasesBefore?: string[]; redirectedMemoryIds?: number[]; bothLinkedIds?: number[];
        redirectedEdges?: Array<{ id: number; sourceWas: number; targetWas: number }>; closedDupEdgeIds?: number[];
      };
      if (typeof snap.fromEntityId !== "number" || !snap.fromNorm || !snap.fromAliases || !snap.toAliasesBefore || !snap.redirectedMemoryIds)
        return { ok: false, error: "snapshot incomplete — refusing unmerge (D2: snapshot is the only basis)" };
      // Bounded: only memory rows from the snapshot are redirected back; post-merge rows stay.
      const bothSet = new Set(snap.bothLinkedIds ?? []);
      for (const mid of snap.redirectedMemoryIds) {
        const curTarget = this.db.prepare("SELECT 1 as x FROM memory_entity WHERE memory_id = ? AND entity_id = ?").get(mid, logRow.target_entity_id) as { x: number } | undefined;
        if (bothSet.has(mid)) {
          // r77 audit P1 (G4): pre-merge this memory was linked to BOTH entities. Merge deleted the
          // from-row and kept the target-row. Undo restores the from-link and keeps the target link.
          const mem = this.db.prepare("SELECT id FROM retrieval_results WHERE id = ?").get(mid) as { id: number } | undefined;
          if (mem) this.db.prepare("INSERT OR IGNORE INTO memory_entity (memory_id, entity_id) VALUES (?, ?)").run(mid, snap.fromEntityId);
          continue;
        }
        if (curTarget) {
          this.db.prepare("UPDATE memory_entity SET entity_id = ? WHERE memory_id = ? AND entity_id = ?").run(snap.fromEntityId, mid, logRow.target_entity_id);
        } else if (!curTarget) {
          // Row vanished (dedup'd away at merge time, or memory deleted) — restore if memory still exists.
          const mem = this.db.prepare("SELECT id FROM retrieval_results WHERE id = ?").get(mid) as { id: number } | undefined;
          if (mem) this.db.prepare("INSERT OR IGNORE INTO memory_entity (memory_id, entity_id) VALUES (?, ?)").run(mid, snap.fromEntityId);
        }
      }
      // ADR-0035 D6: bounded edge restore — redirected edges return to the snapshot endpoints;
      // closed duplicates revive only when no live row covers the same triple (conflict guard).
      for (const e of snap.redirectedEdges ?? []) {
        this.db.prepare("UPDATE edges SET source_entity_id = ?, target_entity_id = ? WHERE id = ?").run(e.sourceWas, e.targetWas, e.id);
      }
      for (const edgeId of snap.closedDupEdgeIds ?? []) {
        const row = this.db.prepare("SELECT source_entity_id, relation, target_entity_id, valid_until FROM edges WHERE id = ?").get(edgeId) as
          { source_entity_id: number; relation: string; target_entity_id: number; valid_until: string | null } | undefined;
        if (!row || row.valid_until === null) continue;
        const live = this.db
          .prepare("SELECT id FROM edges WHERE source_entity_id = ? AND relation = ? AND target_entity_id = ? AND valid_until IS NULL")
          .get(row.source_entity_id, row.relation, row.target_entity_id) as { id: number } | undefined;
        if (!live) this.db.prepare("UPDATE edges SET valid_until = NULL WHERE id = ?").run(edgeId);
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

  // ADR-0032 D5: six report-only merge metrics. Five counters are derived from the persistent merge
  // log (survive restarts); review_pending is a gauge (queue depth); candidates_truncated is run-scoped
  // in-memory (resets on restart — truncation is a transient signal, not ledger state).
  // NEVER gated (Goodhart clause; n is far below statistical power).
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
      "AND (r.valid_until IS NULL) AND (r.quarantine IS NULL) AND (r.archived = 0) ORDER BY r.created_at DESC LIMIT ?";
    const rows = this.db.prepare(sql).all(...ids, limit) as MemoryHit[];
    this.entityTel.hits += rows.length;
    return rows;
  }

  // ---- ADR-0035: KG-lite entity-relation edge layer ----

  // Write-path extraction: rules first; LLM seam only when rules found nothing (fail-open).
  private async linkRelations(memoryId: number, km: KeyMemoryInput, linked: LinkedEntityRef[]): Promise<void> {
    if (linked.length === 0) return;
    // ". " keeper: the rule pass splits on sentence boundaries, so title and snippet must join
    // with a period — a bare space merge lets a clause span backtrack across both fields.
    const text = (km.title ?? "") + ". " + (km.snippet ?? "");
    let triples = extractRelations(text, linked);
    this.relationTel.ruleHits += triples.filter((t) => t.sourceKind !== "llm").length;
    if (triples.length === 0 && this.relationLlmFallback) {
      this.relationTel.llmActivations += 1;
      try {
        const raw = await this.relationLlmFallback(text);
        const parsed = raw ? parseLlmTriples(raw) : null;
        if (parsed && parsed.length > 0) triples = dedupeTriples(parsed);
        else this.relationTel.llmFailures += 1;
      } catch {
        this.relationTel.llmFailures += 1;
      }
    }
    // ADR-0035 D7 contract: live-path inserts are single-statement autocommit ops (no explicit
    // tx here) — safe under WAL single-writer + busy_timeout. Backfill paths wrap their own tx.
    for (const t of triples) this.insertEdge(memoryId, t, linked);
  }

  // Triple to edge row. Pattern check against edge_patterns; same-episode re-write is a dedup
  // skip; a live row for the same triple from another episode is superseded (close old, insert new).
  // ADR-0035: a rule-side spans a clause ("CraneLib for batch scheduling"), not an entity name.
  // Resolve by prefix-containment against any of the entity's surface forms (name + aliases).
  private resolveTripleEnd(surface: string, linked: LinkedEntityRef[]): LinkedEntityRef | undefined {
    const norm = normalizeEntityName(surface);
    if (!norm) return undefined;
    const cands = linked.filter((e) => {
      const forms = [e.nameNorm, ...this.aliasNorms(e.id)];
      return forms.some((f) => norm === f || norm.startsWith(f + " "));
    });
    if (cands.length === 0) return undefined;
    cands.sort((a2_, b2) => b2.nameNorm.length - a2_.nameNorm.length); // longest match wins
    return cands[0];
  }

  private aliasNorms(entityId: number): string[] {
    const row = this.db.prepare("SELECT aliases FROM entities WHERE id = ?").get(entityId) as { aliases: string } | undefined;
    if (!row) return [];
    try { return JSON.parse(row.aliases || "[]") as string[]; } catch { return []; }
  }

  private insertEdge(memoryId: number, t: ExtractedTriple, linked: LinkedEntityRef[]): void {
    const s = this.resolveTripleEnd(t.subject, linked);
    const o = this.resolveTripleEnd(t.object, linked);
    if (!s || !o || s.id === o.id) return;
    if (!patternAllows(s.entityType, t.relation, o.entityType)) { this.relationTel.schemaRejected += 1; return; }
    const dup = this.db
      .prepare("SELECT id FROM edges WHERE episode_memory_id = ? AND source_entity_id = ? AND relation = ? AND target_entity_id = ? AND valid_until IS NULL")
      .get(memoryId, s.id, t.relation, o.id) as { id: number } | undefined;
    if (dup) { this.relationTel.dedupSkipped += 1; return; }
    const live = this.db
      .prepare("SELECT id FROM edges WHERE source_entity_id = ? AND relation = ? AND target_entity_id = ? AND valid_until IS NULL")
      .get(s.id, t.relation, o.id) as { id: number } | undefined;
    if (live && t.relation === "related_to") { this.relationTel.relatedToWriteOnce += 1; return; } // ADR-0035 + r87 audit F7: write-once = first co-occurrence materializes the edge; repeat-episode attempts skip (noise control), counted separately from dedup
    if (live) this.db.prepare("UPDATE edges SET valid_until = datetime('now') WHERE id = ?").run(live.id);
    this.db
      .prepare("INSERT INTO edges (source_entity_id, target_entity_id, relation, description, confidence, episode_memory_id, rules_version) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(s.id, o.id, t.relation, null, t.confidence, memoryId, RELATION_RULES_VERSION);
    this.relationTel.triplesWritten += 1;
  }

  // ADR-0035 D5: fifth arm — query-matched entities plus their 1-hop edge neighbors feed a
  // DISTINCT memory pull through memory_entity (live, non-quarantined rows), capped at 100.
  public relationArmRows(query: string, limit = 100): MemoryHit[] {
    this.relationTel.armQueries += 1;
    const known = new Set(this.liveEntities().flatMap((e) => [e.nameNorm, ...e.aliases]));
    const candidates = extractEntityCandidates(query, known);
    if (candidates.length === 0) return [];
    const norms = candidates.map((c) => normalizeEntityName(c.name));
    const matched = this.liveEntities().filter((e) => norms.some((nm) => e.nameNorm === nm || e.nameNorm.startsWith(nm + "-") || nm.startsWith(e.nameNorm + "-") || e.aliases.includes(nm)));
    if (matched.length === 0) return [];
    const ids = matched.map((e) => e.id);
    const ph = ids.map(() => "?").join(", ");
    const neighbors = this.db
      .prepare(
        "SELECT DISTINCT CASE WHEN e.source_entity_id IN (" + ph + ") THEN e.target_entity_id ELSE e.source_entity_id END as nid" +
        " FROM edges e WHERE e.valid_until IS NULL AND (e.source_entity_id IN (" + ph + ") OR e.target_entity_id IN (" + ph + "))"
      )
      .all(...ids, ...ids, ...ids) as Array<{ nid: number }>;
    const allIds = Array.from(new Set([...ids, ...neighbors.map((n) => n.nid)]));
    const ph2 = allIds.map(() => "?").join(", ");
    const rows = this.db
      .prepare(
        "SELECT DISTINCT r.id as rowid, r.session_id as sessionId, r.title as role, r.snippet as content, 0.0 as rank" +
        " FROM retrieval_results r JOIN memory_entity me ON me.memory_id = r.id" +
        " WHERE me.entity_id IN (" + ph2 + ") AND r.valid_until IS NULL AND (r.quarantine IS NULL) AND r.archived = 0" +
        " ORDER BY r.created_at DESC LIMIT ?"
      )
      .all(...allIds, Math.min(limit, 100)) as MemoryHit[];
    this.relationTel.armHits += rows.length;
    return rows;
  }

  // ADR-0035 D3: relation list CLI backing query — live edges, optional single-entity filter.
  public async listRelations(opts?: { entity?: string; limit?: number }): Promise<RelationRow[]> {
    const limit = opts?.limit ?? 50;
    const base =
      "SELECT e.id, e.source_entity_id, e.target_entity_id, e.relation, e.confidence, e.episode_memory_id, e.rules_version, e.created_at," +
      " s.name AS source_name, t.name AS target_name FROM edges e" +
      " JOIN entities s ON s.id = e.source_entity_id JOIN entities t ON t.id = e.target_entity_id" +
      " WHERE e.valid_until IS NULL";
    const rows = (opts?.entity
      ? this.db.prepare(base + " AND (s.name_norm = ? OR t.name_norm = ?) ORDER BY e.created_at DESC LIMIT ?").all(normalizeEntityName(opts.entity), normalizeEntityName(opts.entity), limit)
      : this.db.prepare(base + " ORDER BY e.created_at DESC LIMIT ?").all(limit)) as Array<{
      id: number; source_entity_id: number; target_entity_id: number; relation: string; confidence: number;
      episode_memory_id: number | null; rules_version: number; created_at: string; source_name: string; target_name: string;
    }>;
    return rows.map((r) => ({
      id: r.id, sourceEntityId: r.source_entity_id, sourceName: r.source_name, relation: r.relation,
      targetEntityId: r.target_entity_id, targetName: r.target_name, confidence: r.confidence,
      episodeMemoryId: r.episode_memory_id, rulesVersion: r.rules_version, createdAt: r.created_at,
    }));
  }

  // ADR-0035 D7: idempotent keyset-paginated backfill (rules only — the LLM seam stays on the live
  // write path). Covered rows skip unless --reprocess targets older rules_version rows (supersede).
  // r87 audit F1: dry-run executes the IDENTICAL pipeline inside a rolled-back transaction, so
  // written / dedupSkipped / schemaRejected are exact predictions (never upper bounds) and the
  // edges table + telemetry counters are left untouched. fullRefresh is the dbt full-refresh
  // safety net (r87 audit F3): rebuild the edges table from scratch, atomic with the scan loop.
  public async backfillRelations(opts: { apply: boolean; batch?: number; fromId?: number; limit?: number; reprocess?: boolean; fullRefresh?: boolean }): Promise<BackfillRelationsResult> {
    // r88 audit: a partial window (--from-id/--limit) contradicts a full rebuild — reject the combination.
    if (opts.fullRefresh && (opts.fromId !== undefined || opts.limit !== undefined)) {
      throw new Error("backfillRelations: fullRefresh cannot be combined with fromId/limit (ADR-0035 D7 r88 guard)");
    }
    const batch = opts.batch ?? 200;
    const maxRows = opts.limit ?? 100000;
    const fromId0 = opts.fromId ?? 0;
    const res: BackfillRelationsResult = { apply: opts.apply, scanned: 0, written: 0, dedupSkipped: 0, schemaRejected: 0, lastId: fromId0 };
    const tel0 = { ...this.relationTel };
    const dryRollback = Symbol("dry-run-rollback");
    // Factored scan/process helpers shared by the dry-run and chunked-apply paths (ADR-0036 D6).
    type ScanRow = { id: number; title: string | null; snippet: string | null; rules: number | null };
    const scanBatch = (fromId: number): ScanRow[] =>
      this.db
        .prepare(
          "SELECT r.id, r.title, r.snippet, MIN(e.rules_version) as rules FROM retrieval_results r" +
          " LEFT JOIN edges e ON e.episode_memory_id = r.id AND e.valid_until IS NULL" +
          " WHERE r.id > ? AND r.archived = 0 GROUP BY r.id ORDER BY r.id LIMIT ?"
        )
        .all(fromId, Math.min(batch, maxRows - res.scanned)) as ScanRow[];
    const processRow = (row: ScanRow): void => {
      res.lastId = row.id;
      res.scanned += 1;
      const stale = row.rules !== null && row.rules < RELATION_RULES_VERSION;
      if (row.rules !== null && !(opts.reprocess && stale)) return; // already extracted at current version
      const linked = (this.db
        .prepare("SELECT e.id, e.name, e.name_norm as nameNorm, e.entity_type as entityType FROM memory_entity me JOIN entities e ON e.id = me.entity_id WHERE me.memory_id = ? AND e.valid_until IS NULL")
        .all(row.id) as LinkedEntityRef[]).map((e) => ({ ...e, preKnown: true }));
      if (linked.length === 0) return;
      const text = (row.title ?? "") + " " + (row.snippet ?? "");
      const triples = extractRelations(text, linked);
      this.relationTel.ruleHits += triples.length;
      for (const t of triples) this.insertEdge(row.id, t, linked);
    };
    if (!opts.apply) {
      // Dry-run keeps the ADR-0035 r87 single rolled-back transaction: counts are exact predictions.
      const run = () => {
        let fromId = fromId0;
        if (opts.fullRefresh) this.db.exec("DELETE FROM edges");
        for (;;) {
          if (res.scanned >= maxRows) break;
          const rows = scanBatch(fromId);
          if (rows.length === 0) break;
          for (const row of rows) processRow(row);
          fromId = res.lastId;
        }
        throw dryRollback;
      };
      try {
        this.db.transaction(run)();
      } catch (e) {
        if (e !== dryRollback) throw e;
      }
    } else {
      // ADR-0036 D6: apply mode commits one IMMEDIATE transaction per batch, so concurrent live
      // MCP writes wait within busy_timeout instead of blocking for the whole run. SQLITE_BUSY is
      // retried with exponential backoff (50ms base, 5s cap, <=8 tries); SQLITE_BUSY_SNAPSHOT (the
      // deferred-upgrade class) fails fast because retrying a stale snapshot is meaningless. A
      // passive WAL checkpoint runs after each committed batch to bound WAL growth. Failed batch
      // attempts restore res/telemetry counters before retry so a rolled-back batch never
      // double-counts.
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const isBusyRetryable = (e: unknown): boolean => {
        const code = (e as { code?: string })?.code ?? "";
        return code.startsWith("SQLITE_BUSY") && code !== "SQLITE_BUSY_SNAPSHOT";
      };
      let fromId = fromId0;
      let needsFullRefresh = !!opts.fullRefresh;
      for (;;) {
        if (res.scanned >= maxRows) break;
        const snap = {
          scanned: res.scanned, lastId: res.lastId, ruleHits: this.relationTel.ruleHits,
          triplesWritten: this.relationTel.triplesWritten, dedupSkipped: this.relationTel.dedupSkipped,
          schemaRejected: this.relationTel.schemaRejected, relatedToWriteOnce: this.relationTel.relatedToWriteOnce,
        };
        let more = false;
        for (let attempt = 0; ; attempt++) {
          try {
            more = this.db
              .transaction((fullRf: boolean) => {
                if (fullRf) this.db.exec("DELETE FROM edges");
                const rows = scanBatch(fromId);
                if (rows.length === 0) return false;
                for (const row of rows) processRow(row);
                return true;
              })
              .immediate(needsFullRefresh);
            break;
          } catch (e) {
            if (isBusyRetryable(e) && attempt < 8) {
              Object.assign(res, { scanned: snap.scanned, lastId: snap.lastId });
              Object.assign(this.relationTel, { ruleHits: snap.ruleHits, triplesWritten: snap.triplesWritten, dedupSkipped: snap.dedupSkipped, schemaRejected: snap.schemaRejected, relatedToWriteOnce: snap.relatedToWriteOnce });
              await sleep(Math.min(50 * 2 ** attempt, 5000));
              continue;
            }
            throw e;
          }
        }
        needsFullRefresh = false;
        if (!more) break;
        fromId = res.lastId;
        this.db.pragma("wal_checkpoint(PASSIVE)");
      }
    }
    res.dedupSkipped = this.relationTel.dedupSkipped - tel0.dedupSkipped;
    res.schemaRejected = this.relationTel.schemaRejected - tel0.schemaRejected;
    res.written = this.relationTel.triplesWritten - tel0.triplesWritten;
    if (!opts.apply) Object.assign(this.relationTel, tel0); // dry-run leaves telemetry untouched
    return res;
  }

  // ADR-0035 D8: report-only. pendingEdges gauge = linked memories with no live edge episode row.
  // ADR-0037 D6: semantic-arm telemetry (queries/hits/served; regressions gated in eval).
  public semanticTelemetry(): { queries: number; hits: number; served: number } {
    return { ...this.semTel };
  }

  public relationTelemetry(): RelationTelemetry {
    const pending = (this.db
      .prepare("SELECT COUNT(*) as n FROM memory_entity me WHERE NOT EXISTS (SELECT 1 FROM edges e WHERE e.episode_memory_id = me.memory_id AND e.valid_until IS NULL)")
      .get() as { n: number }).n;
    return { ...this.relationTel, pendingEdges: pending };
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
          " LEFT JOIN retrieval_results c ON c.session_id = q.session_id AND c.entity = q.entity AND c.id != q.id AND c.valid_until IS NULL AND c.quarantine IS NULL AND c.archived = 0" +
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
