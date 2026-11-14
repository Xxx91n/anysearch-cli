// SessionStore: SQLite+FTS5 implementation via better-sqlite3 sync API.
// Split 4 from the atomcode kernel-split research.
// decision 1: better-sqlite3 synchronous binding.
// atomcode research: WAL persistent, single shared connection, module-level prepared statements,
// db.transaction(fn) auto-rollback, avoid RETURNING+FTS trigger path (issue #654).

import Database from "better-sqlite3";
import { openDatabase } from "./db";
import {
  beginInit,
  endInit,
  execDdlAtomically,
  isBusyRetryExhausted,
  isDuplicateColumnError,
  withForeignKeysOff,
  withInitBusyRetry,
} from "./sqlite-init.js";
import { containsSecret } from "./secret.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { SCHEMA_SQL } from "./schema-content";
import {
  isSourceCurrent,
  isSummaryAnchorType,
  parseSummarySourceRefs,
  recordSummarySources,
  resolveSummarySourcesFromUrls,
  resolveSummarySourcesFromReads,
  suspendedSummaryAnchorIds,
  suspendSummaries,
  type SummaryAnchorType,
  type SummaryRead,
  type SummarySourceRef,
} from "./summary-sources.js";
import { registerFreshnessFactorFunction, invalidateOldRecords } from "./time-decay.js";
import { fts5EscapeQuery, fts5RelaxedQuery, relaxedTerms, coversMajority, appendRelaxed, searchMemoryMultiQuery } from "./fts5.js";
import { extractEntityCandidates, normalizeEntityName, trigramSimilarity, ENTITY_ALIAS_THRESHOLD, ENTITY_REVIEW_THRESHOLD, MAX_ENTITY_CANDIDATES as MAX_CANDIDATES } from "./entity.js";
import { extractRelations, parseLlmTriples, dedupeTriples, patternAllows, EDGE_PATTERN_ROWS, RELATION_RULES_VERSION } from "./relation.js";
import type { ExtractedTriple, LinkedEntityRef } from "./relation.js";
import type { EntityType, EntityCandidate } from "./entity.js";
import { rrfRank, FUSION_REGISTRY, SCORE_KIND, registryWeight } from "@anysearch-cli/retriever";
import { consolidateMemoryRun, scanArchiveCandidates, applyArchive, undoArchive } from "./consolidate.js";
import type {
  ConsolidateSummarizeFn,
  ConsolidateClassifyFn,
  ConsolidateVerifyFn,
  ConsolidateFinalCheckFn,
  ConsolidateReport,
  ConsolidateRunOptions,
  ArchiveCandidate,
  ArchiveApplyReport,
} from "./consolidate.js";
import { bootstrapAccessChain, eventHash, CHAIN_SCHEMA_VERSION, CHAIN_EVENT_TYPE, type ChainEventRow } from "./access-chain.js";
import { BudgetLedger, UNLIMITED_BUDGET_CAP, type BudgetCaps } from "./budget-ledger.js";
// embedding is optional — routed through the guarded arm
// module (absent package => embedText null / telemetry absent), never imported statically.
import { embedText, embeddingModelId, armTelemetry, cosineSimilarity } from "./embedding-arm.js";
import type { NormalizedResult } from "@anysearch-cli/retriever";

// MemTX-simplified writer adjudication.
// keyMemories carry the three-check inputs for write-path adjudication (D4, Q3=A).
export type AdjudicationAction = "accept" | "supersede" | "quarantine" | "reject";

export interface KeyMemoryInput {
  url: string;
  title: string;
  snippet: string;
  source: string; // provider id — direct user interaction uses source='user'
  evidence: number; // writer confidence score 0.0-1.0
  entity?: string; // override URL as entity key (same as NormalizedResult.entity)
  sourceLabel?: "system" | "user" | "retrieved" | "tool" | "memory";
  traceId?: string;
}

export interface AdjudicationResultItem {
  action: AdjudicationAction;
  reason?: "evidence" | "temporal" | "equal_conflict" | "secret";
  supersededId?: number; // temporal: new write supersedes this id
  counterpartId?: number; // equal_conflict: the live memory in conflict with this write
  insertedId?: number; // rowid if accepted (evidence pass) or supersceded (new row landed)
}

// equal-conflict review channel row (flag, don't silently pick).
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
// T0 durable preference types.
export interface T0PreferenceInput {
  key: string;
  value: string;
  scope?: string; // "global" or project root path; default "global"
  source: "explicit" | "correction"; // T0 promote channels
  provenance?: { event: string; at: string; why: string };
  sourceLabel?: "system" | "user" | "retrieved" | "tool" | "memory";
  traceId?: string;
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

// semantic arm mode. Phase-1 was shadow; landed Phase-2 serve below.
// Phase-2 = "serve" (conditioned activation, weight 0.5 via fts5.ts extra arms).
// Phase-2: arm live at weight 0.5, conditional activation; regression gate fail-closed (runner sem counterfactual).
const SEMANTIC_ARM_MODE: "shadow" | "serve" = "serve";

export interface MemoryHit {
  rowid: number;
  sessionId: string;
  role: string;
  content: string;
  rank: number;
  // arm provenance ("fts" | "entity" | "vector"); absent on legacy paths. A vector-only hit is weak evidence (answer-layer abstain signal).
  arms?: string[];
}

// eval-only snapshot of one searchMemory call's RRF inputs, so the runner can
// recompute the relation-arm-off counterfactual without a second retrieval (single-run cost ~1x).
export interface ArmProvenance {
  // common fusion provenance shape fields.
  instance: "memory";
  labels: string[];      // parallel to lists/weights; five-arm order: fts, entity, vector, relation
  lists: string[][];     // rowid strings per arm, rank order
  weights: number[];
  fusedIds: string[];    // full fused id order (pre-limit, pre-secret-filter)
  scoreKind: "rank_fusion"; // fused score is a rank_fusion signal only
  texts: Map<number, string>; // rowid -> role + " " + content for title matching
}

export interface ResumeAnchor {
  id: number;
  sessionId: string;
  anchorType: string;
  payload: unknown;
  createdAt: string;
}

// Port interface: kernel imports this, CLI wiring injects implementation.
export interface SessionStore {
  createSession(domain: string): Promise<Session>;
  // Ensure a caller-supplied session id has a row in `sessions`. Every child
  // table (messages / resume_anchors / retrieval_results / budget_ledger)
  // references sessions(id) and the store runs `foreign_keys = ON`, so an id
  // minted outside createSession() (e.g. the durable ~/.anysearch-cli/session
  // anchor) must be registered before any dependent write. Idempotent: an
  // existing row is left untouched.
  ensureSession(sessionId: string, domain: string): Promise<void>;
  // #187: register the domain's [budget] caps for this session at the same
  // composition-root point as ensureSession/createSession. Omitted when the
  // Active Domain declares no [budget] — a fresh session then has no row, and
  // an existing session is deactivated so `getBalance()` returns null
  // (unmetered). Idempotent: caps/configured refresh in place and the
  // reserved/spent counters survive a re-registration.
  // Optional on the port so hand-built/embedded store implementations stay
  // source-compatible; the startup paths guard the call.
  initBudget?(sessionId: string, caps: BudgetCaps): void;
  // #187: when the Active Domain later drops [budget] (or the durable anchor
  // switches to a domain without it), deactivate an existing row
  // (configured=0) so getBalance()/reserve treat the session as unmetered,
  // without deleting its spend history. No row is a no-op.
  clearBudgetCaps?(sessionId: string): void;
  append(sessionId: string, message: Message): Promise<void>;
  searchFts5(sessionId: string | null, query: string, limit?: number): Promise<MemoryHit[]>;
  saveResults(sessionId: string, results: NormalizedResult[]): Promise<void>;
  // #263: same write, plus the archive row each result landed in (null when the
  // result was skipped). Optional on the port so hand-built stores stay
  // source-compatible; the search path stamps the ids onto the tool result only
  // when the seam exists, and the URL bridge covers the rest.
  saveResultsWithIds?(sessionId: string, results: NormalizedResult[]): Promise<Array<number | null>>;
  // #263: a summary anchor may carry `sources` (the rows it was built from);
  // the anchor insert and its dependency rows commit together.
  saveAnchor(sessionId: string, anchorType: string, payload: unknown): Promise<void>;
  getAnchors(sessionId: string): Promise<ResumeAnchor[]>;
  // #263: anchor ids of summary anchors that must not be injected because a
  // correction replaced a fact they were built from. Their text stays readable.
  suspendedSummaryAnchorIds?(sessionId: string): Set<number>;
  // #263: URL -> current material/knowledge refs, the exact bridge from the
  // tool-result JSON a summary read to storable dependency ids.
  resolveSummarySources?(urls: string[]): SummarySourceRef[];
  // #263: same resolution when a read carries the archive row it came from.
  // Preferred over the URL form: two rows can share a URL (an older version a
  // correction retired, a newer one a later fetch wrote), and only the id says
  // which one the summary actually read.
  resolveSummarySourcesFromReads?(reads: SummaryRead[]): SummarySourceRef[];
  // #263: the dependencies already recorded for one anchor, so the next
  // summary can inherit them (it was generated FROM the previous one).
  summarySourcesForAnchor?(anchorId: number): SummarySourceRef[];
  // search the research archive for the recall_memory MCP tool.
  searchMemory(query: string, limit?: number): Promise<MemoryHit[]>;
  // (Q2=B): multi-query + RRF k=60 fusion. queries[0] must be the raw user query.
  searchMemoryMulti(queries: string[], limit?: number): Promise<MemoryHit[]>;
  // (Q3=A): write-path adjudication with keyMemories carrying evidence score.
  // Caller supplies quarantine check readiness (peer-conflict scan split into its own stmt).
  adjudicateMemory(sessionId: string, keyMemories: KeyMemoryInput[]): Promise<AdjudicationResultItem[]>;
  // T0 durable preference layer.
  // promotePreference: deterministic write gated by caller (T0 promote channels: /remember explicit, correction-count>=2).
  // demotePreference: conflict(d-i)/user(d-iii)/eviction(d-ii); sets invalid_at only (never drop, recoverable).
  // touchPreference: updates last_accessed (eviction order base).
  // listPreferences: live entries for MEMORY.md projection (global+project scopes, project wins same-key).
  promotePreference(input: T0PreferenceInput): Promise<{ action: "promoted" | "rejected"; reason?: string }>;
  demotePreference(key: string, scope: string, reason: string): Promise<void>;
  touchPreference(key: string, scope: string): Promise<void>;
  listPreferences(projectScope?: string): Promise<T0PreferenceRow[]>;
  // adjudication hook — correction-count increment + conditional promote.
  recordCorrectionOnPreference(key: string, scope: string): Promise<{ correctionCount: number }>;
  // equal-conflict review channel over retrieval_results.quarantine.
  listQuarantinedMemories(): Promise<QuarantinedMemory[]>;
  // keep: new value wins (clear quarantine, supersede live counterpart). drop: keep quarantined, mark resolved_drop.
  resolveQuarantinedMemory(id: number, action: "keep" | "drop"): Promise<{ ok: boolean }>;
  // destructive entity merge with full snapshot (single transaction).
  combineEntities(fromId: number, toId: number): Promise<{ ok: boolean; logId?: number; error?: string }>;
  // bounded unmerge driven by the D1 snapshot; writes override records against re-merge.
  unmergeEntity(logId: number): Promise<{ ok: boolean; error?: string }>;
  // alias-append undo (exposed for the CLI unmerge entry point).
  undoEntityMerge(logId: number): boolean;
  // candidate review list (list + keep/drop resolution, quarantine pattern).
  listEntityReview(): Promise<EntityReviewRow[]>;
  resolveEntityReview(id: number, action: "keep" | "drop"): Promise<{ ok: boolean; error?: string }>;
  // entity-relation edge layer (fifth retrieval arm).
  relationArmRows(query: string, limit?: number): MemoryHit[];
  listRelations(opts?: { entity?: string; limit?: number }): Promise<RelationRow[]>;
  backfillRelations(opts: { apply: boolean; batch?: number; fromId?: number; limit?: number; reprocess?: boolean; fullRefresh?: boolean }): Promise<BackfillRelationsResult>;
  relationTelemetry(): RelationTelemetry;
  // alert-on-silence telemetry — event write failures are counted, never silent.
  accessEventTelemetry(): AccessEventTelemetry;
  // D5/Q18: explicit consolidation over a caller-selected scope. Omitted
  // `scope` is the internal full-archive mode (eval runner and the existing
  // regression tests); product entry points always pass one, and resolve it
  // through resolveConsolidateScope first. Optional on the port so hand-built
  // store mocks stay source-compatible; the MCP tool refuses to guess.
  // `deps` carries one run's own seams: the MCP server builds its LLM session
  // after the engine exists, and a per-call dependency keeps two concurrent
  // requests from reading each other's usage.
  consolidateMemory?(opts?: ConsolidateRunOptions, deps?: {
    summarize?: ConsolidateSummarizeFn;
    classify?: ConsolidateClassifyFn;
    verify?: ConsolidateVerifyFn;
    verifyFinal?: ConsolidateFinalCheckFn;
  }): Promise<ConsolidateReport>;
}

// +: secret guard lives in ./secret.ts (shared containsSecret) —
// covers case-insensitive / JSON-escape / whitespace-collapse / NFKC / bounded-base64 variants
// at all 4 write entries and both search exits. Known blind spots: truncated secrets, novel encodings.

// one unresolved candidate row in the entity review list.
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

// six report-only merge metrics — five counters derived from entity_merge_log
// plus one run-scoped truncation counter; review_pending is a gauge (queue depth).
export interface EntityMergeTelemetry {
  auto_merged: number;
  unmerged: number;
  review_pending: number;
  confirmed: number;
  rejected: number;
  candidates_truncated: number;
}

// one live edge joined to both endpoint entity display names (relation list).
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

// dry-run/apply report through the same shape. Dry-run executes the identical
// apply pipeline inside a rolled-back transaction, so every counter is an exact prediction
// never an upper bound. Exit code is a CLI concern (0/1/2).
export interface BackfillRelationsResult {
  apply: boolean;
  scanned: number;
  written: number;
  dedupSkipped: number;
  schemaRejected: number;
  lastId: number;
}

// report-only relation telemetry. pendingEdges is a derived gauge (linked memories
// lacking an edge episode row) — the backfill coverage signal, recomputed at read time.
export interface RelationTelemetry {
  ruleHits: number;
  llmActivations: number;
  llmFailures: number;
  triplesWritten: number;
  dedupSkipped: number;
  // repeat-episode attempts against a live write-once related_to edge — NOT dedup
  relatedToWriteOnce: number;
  // Edges closed because the material supporting them was superseded, so the
  // current material could re-establish the relation (#273 review). Counted
  // apart from dedup: this is a replacement, not a duplicate.
  supersededSupportClosed: number;
  schemaRejected: number;
  pendingEdges: number;
  armQueries: number;
  armHits: number;
}

// access-event chain telemetry (observational zone; report-only, never gated).
export interface AccessEventTelemetry {
  writeFailures: number;   // chained event insert failures (alert-on-silence counter)
  bootstrapFailed: boolean; // constructor anchor bootstrap degraded (stderr WARN emitted)
}

// better-sqlite3 sync API wrapped in async interface to match SessionStore port.
// ponytail: thinnest wrapper - no extra abstraction, sync calls wrapped in Promise.resolve.
// legacy access_events had memory_id NOT NULL, forcing a fake retrieval_results
// sentinel for switch edges. Rebuild that table once so switch edges can use NULL memory_id
// while real access events still satisfy the FK through the same CHECK.
//
// The shape check runs INSIDE the IMMEDIATE transaction: with the startup retry
// (#257) this function can be entered again after another process already
// finished the rebuild, and a check taken before the lock would then be stale.
// `foreign_keys` is a per-connection switch and a no-op inside a transaction,
// so it is turned off outside and restored in a finally block: the busy path
// must not leave a live connection with foreign keys disabled (cascades would
// silently stop working).
function migrateSwitchEventSchema(db: Database.Database): void {
  const needsRebuild = (): boolean => {
    const cols = db.prepare("PRAGMA table_info(access_events)").all() as Array<{ name: string; notnull: number }>;
    const memory = cols.find((c) => c.name === "memory_id");
    return memory !== undefined && memory.notnull === 1 && cols.some((c) => c.name === "prev_hash");
  };
  return withForeignKeysOff(db, () => {
    db.transaction((): void => {
      if (!needsRebuild()) return;
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
    }).immediate();
  });
}

export class SqliteSessionStore implements SessionStore {
  private db: Database.Database;
  // #187: one ledger over the store's single connection. Registration refreshes
  // caps in place (unique constraint/index on budget_ledger.session_id for new
  // and clean existing databases), so re-registering the durable `ans chat`
  // anchor never duplicates the row.
  // T2 #177: the same instance is exposed to the wiring so the engine
  // and registration share one connection and one set of prepared statements.
  private budgetLedgerInstance?: BudgetLedger;
  // LLM entity backfill (optional, fail-open) — invoked only when rule extraction finds nothing.
  private readonly entityLlmFallback?: (text: string) => Promise<EntityCandidate[] | null>;
  // LLM relation seam (optional, fail-open) — returns RAW model text; relation.ts
  // parseLlmTriples does the Graphiti-style json_schema to json_object degrade.
  private readonly relationLlmFallback?: (text: string) => Promise<string | null>;
  // consolidation seams (summarize = bounded LLM per cluster; classify = kernel
  // classifyClaim-shaped fidelity gate). Both optional and fail-open. These are
  // the constructor-time defaults (the eval runner and tests); a per-call
  // `deps` argument overrides them without mutating this instance.
  private readonly consolidateSummarize?: ConsolidateSummarizeFn;
  private readonly consolidateClassify?: ConsolidateClassifyFn;
  private readonly consolidateVerify?: ConsolidateVerifyFn;
  private readonly consolidateVerifyFinal?: ConsolidateFinalCheckFn;
  // semantic arm telemetry (serve mode; Phase-1 shadow contract retired).
  private readonly semTel = { queries: 0, hits: 0, served: 0 };
  // step7: entity arm telemetry counters (report-only in eval).
  private readonly entityTel = { queries: 0, candidates: 0, activations: 0, hits: 0, truncated: 0 };
  // vector arm telemetry (fail-open writes; pendingVectors = rows lacking an embedding).
  private readonly embedTel = { writes: 0, pendingVectors: 0, armQueries: 0, armHits: 0 };
  // relation extraction + arm telemetry (report-only, never gated).
  // alert-on-silence — event write failures and bootstrap degradation are counted.
  private readonly accessEventTel: AccessEventTelemetry = { writeFailures: 0, bootstrapFailed: false };
  private readonly relationTel = { ruleHits: 0, llmActivations: 0, llmFailures: 0, triplesWritten: 0, dedupSkipped: 0, relatedToWriteOnce: 0, supersededSupportClosed: 0, schemaRejected: 0, armQueries: 0, armHits: 0 };
  private stmts: {
    createSession: Database.Statement;
    ensureSession: Database.Statement;
    append: Database.Statement;
    searchMessages: Database.Statement;
    searchAllMessages: Database.Statement;
    saveResult: Database.Statement;
    searchResults: Database.Statement;
    saveAnchor: Database.Statement;
    getAnchors: Database.Statement;
    searchAllResults: Database.Statement;
    touchAccessed: Database.Statement;
    // append-only access event twin of touchAccessed (transaction-time log; never gated).
    insertAccessEvent: Database.Statement;
    // chain head lookup (latest event with non-NULL prev_hash).
    lastChainedEvent: Database.Statement;
    // UPSERT for state-type anchors (consolidation_state).
    saveAnchorUpsert: Database.Statement;
  };

  constructor(dbPath: string, opts?: {
    entityLlmFallback?: (text: string) => Promise<EntityCandidate[] | null>;
    relationLlmFallback?: (text: string) => Promise<string | null>;
    // consolidation seams (same injection discipline as relationLlmFallback).
    consolidateSummarize?: ConsolidateSummarizeFn;
    consolidateClassify?: ConsolidateClassifyFn;
    // #261: the two checks a replacement must pass. Both optional at the type
    // level because old callers exist, but a run that OMITS them refuses every
    // replacement rather than writing on faith — missing seams are a refusal,
    // not a lenient pass.
    consolidateVerify?: ConsolidateVerifyFn;
    consolidateVerifyFinal?: ConsolidateFinalCheckFn;
  }) {
    this.entityLlmFallback = opts?.entityLlmFallback;
    this.relationLlmFallback = opts?.relationLlmFallback;
    this.consolidateSummarize = opts?.consolidateSummarize;
    this.consolidateClassify = opts?.consolidateClassify;
    this.consolidateVerify = opts?.consolidateVerify;
    this.consolidateVerifyFinal = opts?.consolidateVerifyFinal;
    // tracked opener: the teardown registry closes it on any store-side exit
    // path that drains it (eval runner, test processes) — F-16 fix, #183.
    this.db = openDatabase(dbPath, { timeout: 5000 });
    // #257 cold start: initialization gets its own bounded retry policy
    // (attempt count, backoff and wall-clock window live in sqlite-init.ts). The
    // connection-level timeout is lowered for that phase so each attempt returns
    // promptly and the backoff — not SQLite's own long wait — decides the pace.
    // endInit restores the ordinary 5s contract on the success path; if init
    // throws, the constructor throws with it, so this handle is never used again
    // and the teardown registry simply closes it.
    const initDeadline = beginInit(this.db);
    // atomcode research: WAL persistent, set once, single shared connection.
    withInitBusyRetry("journal_mode", () => this.db.pragma("journal_mode = WAL"), initDeadline);
    this.db.pragma("synchronous = NORMAL");
    this.db.pragma("foreign_keys = ON");
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
    withInitBusyRetry("schema", () => execDdlAtomically(this.db, schema), initDeadline);
    // #187: existing databases predate the `configured` column. New databases
    // already have it from the CREATE TABLE above; this ALTER is the migration
    // and duplicates are absorbed like the other column migrations.
    this.applyColumnMigration("budget_ledger.configured", "ALTER TABLE budget_ledger ADD COLUMN configured INTEGER NOT NULL DEFAULT 1", initDeadline);
    // #187/CodeRabbit: a legacy DB can carry duplicate budget rows (the old
    // table had no uniqueness and no production writer, but corrupt/raced
    // databases exist). Merge them BEFORE the unique index: one row per
    // session, spend/reserved counters summed, caps taken from the most
    // restrictive active row so merging cannot silently loosen enforcement.
    try {
      withInitBusyRetry("budget dedup", () => this.mergeDuplicateBudgetRows(), initDeadline);
    } catch (e) {
      this.warnOrRefuseWhenContended(e, "[warn] budget_ledger duplicate-row merge failed: ");
    }
    // #187: one budget row per session. New databases got the table-level
    // UNIQUE(session_id); this protected migration covers old databases. It is
    // deliberately outside db.exec(schema): a legacy duplicate row must not
    // prevent the rest of the schema from opening, and that data failure
    // degrades to a warning (the startup paths then fail open to unmetered).
    // A busy exhaustion is not a data failure and still fails the start.
    try {
      withInitBusyRetry("budget unique index", () => this.db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_budget_session_unique ON budget_ledger(session_id)"), initDeadline);
    } catch (e) {
      this.warnOrRefuseWhenContended(e, "[warn] budget_ledger unique-session index not created: ");
    }
    withInitBusyRetry("access_events switch rebuild", () => migrateSwitchEventSchema(this.db), initDeadline);
    // edge-pattern constraint seed (idempotent; mirrors EDGE_PATTERN_ROWS in relation.ts;
    // existing rows are preserved via INSERT OR IGNORE).
    const seedPattern = this.db.prepare("INSERT OR IGNORE INTO edge_patterns (head_type, relation, tail_type) VALUES (?, ?, ?)");
    withInitBusyRetry("edge seed", () => { for (const [h, r, t] of EDGE_PATTERN_ROWS) seedPattern.run(h, r, t); }, initDeadline);
    // freshness_factor UDF (fused decay+recency+frequency band, supersedes time_decay).
    registerFreshnessFactorFunction(this.db);
    // G019: Migration for existing databases (ALTER TABLE ADD COLUMN is not IF NOT EXISTS safe).
    this.applyColumnMigration("retrieval_results.valid_until", "ALTER TABLE retrieval_results ADD COLUMN valid_until TEXT", initDeadline);
    this.applyColumnMigration("retrieval_results.pinned", "ALTER TABLE retrieval_results ADD COLUMN pinned BOOLEAN DEFAULT 0", initDeadline);
    this.applyColumnMigration("retrieval_results.entity", "ALTER TABLE retrieval_results ADD COLUMN entity TEXT", initDeadline);
    // L2: access-time signal (align Mem0 1.5×/0.3× — recall hit refreshes last_accessed).
    this.applyColumnMigration("retrieval_results.last_accessed", "ALTER TABLE retrieval_results ADD COLUMN last_accessed TEXT", initDeadline);
    // frequency signal — access_count incremented exactly once per returned hit.
    this.applyColumnMigration("retrieval_results.access_count", "ALTER TABLE retrieval_results ADD COLUMN access_count INTEGER DEFAULT 0", initDeadline);
    // (Q3=A): equal-weight conflict quarantine — candidates held for user review at next interaction.
    this.applyColumnMigration("retrieval_results.quarantine", "ALTER TABLE retrieval_results ADD COLUMN quarantine TEXT", initDeadline);
    // evidence persisted on quarantined rows for the review list (atomcode: confidence for queue ordering, never for auto-adjudication).
    this.applyColumnMigration("retrieval_results.evidence", "ALTER TABLE retrieval_results ADD COLUMN evidence REAL", initDeadline);
    // candidate review list columns on entity_merge_log.
    this.applyColumnMigration("entity_merge_log.hit_count", "ALTER TABLE entity_merge_log ADD COLUMN hit_count INTEGER NOT NULL DEFAULT 1", initDeadline);
    this.applyColumnMigration("entity_merge_log.resolved", "ALTER TABLE entity_merge_log ADD COLUMN resolved TEXT", initDeadline);
    // soft archive (reversible forgetting).
    this.applyColumnMigration("retrieval_results.archived", "ALTER TABLE retrieval_results ADD COLUMN archived INTEGER NOT NULL DEFAULT 0", initDeadline);
    // #261: correction propagation. An episode whose fact a later consolidation
    // replaced keeps its row (provenance) but leaves current-fact recall; the
    // column names the knowledge row that replaced it. New databases already
    // carry the column from the CREATE TABLE above.
    this.applyColumnMigration("retrieval_results.superseded_by", "ALTER TABLE retrieval_results ADD COLUMN superseded_by INTEGER", initDeadline);
    this.applyColumnMigration("semantic_memories.superseded_by", "ALTER TABLE semantic_memories ADD COLUMN superseded_by INTEGER", initDeadline);
    // #261: an existing database gains the new knowledge FTS table from the
    // schema script, but it starts EMPTY — the CREATE VIRTUAL TABLE only
    // registers the index, it does not copy rows that were already there. A
    // rebuild is idempotent and cheap (one pass over the knowledge table), so
    // doing it at every start costs nothing and keeps the keyword lane correct
    // for old archives. Failing here must not block the start (the vector lane
    // still works), so it degrades to a warning unless the database is busy.
    try {
      withInitBusyRetry(
        "semantic fts rebuild",
        () => this.db.exec("INSERT INTO semantic_memories_fts(semantic_memories_fts) VALUES('rebuild')"),
        initDeadline,
      );
    } catch (e) {
      this.warnOrRefuseWhenContended(e, "[warn] semantic_memories_fts rebuild failed: ");
    }
    // T0 durable preferences — t0_preferences is the single source of truth; MEMORY.md is a
    // regenerated materialized projection (temp+fsync+rename). scope: "global" | project root path.
    // correction_count drives the T0 promote rule (>=2 cross-session corrections = implicit promote).
    // invalid_at non-null = demoted (d-i conflict / d-iii /forget / d-ii eviction); row is quarantined, never dropped.
    withInitBusyRetry("prefs table", () => this.db.exec(`CREATE TABLE IF NOT EXISTS t0_preferences (
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'global',
  modified TEXT NOT NULL DEFAULT (datetime('now')),
  last_accessed TEXT NOT NULL DEFAULT (datetime('now')),
  source TEXT NOT NULL, -- "explicit" (/remember) | "correction" (T0 promote count>=2)
  invalid_at TEXT,
  demote_reason TEXT,
  correction_count INTEGER NOT NULL DEFAULT 0,
  provenance TEXT, -- JSON: {event, at, why}
  PRIMARY KEY (key, scope)
)`), initDeadline);

    // source trust columns for existing databases.
    this.applyColumnMigration("retrieval_results.source_label", "ALTER TABLE retrieval_results ADD COLUMN source_label TEXT", initDeadline);
    this.applyColumnMigration("retrieval_results.trace_id", "ALTER TABLE retrieval_results ADD COLUMN trace_id TEXT", initDeadline);
    this.applyColumnMigration("t0_preferences.source_label", "ALTER TABLE t0_preferences ADD COLUMN source_label TEXT", initDeadline);
    this.applyColumnMigration("t0_preferences.trace_id", "ALTER TABLE t0_preferences ADD COLUMN trace_id TEXT", initDeadline);
    this.applyColumnMigration("access_events.source_label", "ALTER TABLE access_events ADD COLUMN source_label TEXT", initDeadline);
    // step 1/3: chain columns (idempotent ALTER per existing convention) + one-off
    // anchor bootstrap in an IMMEDIATE transaction (D6). A persistent IO/schema
    // failure degrades to stderr WARN + telemetry bit (fail-open); the write path
    // re-probes the anchor. Busy exhaustion is not that class and fails the start.
    this.applyColumnMigration("access_events.prev_hash", "ALTER TABLE access_events ADD COLUMN prev_hash TEXT", initDeadline);
    this.applyColumnMigration("access_events.schema_version", "ALTER TABLE access_events ADD COLUMN schema_version INTEGER", initDeadline);
    this.applyColumnMigration("access_events.event_type", "ALTER TABLE access_events ADD COLUMN event_type TEXT", initDeadline);
    try {
      withInitBusyRetry("access-chain bootstrap", () => bootstrapAccessChain(this.db), initDeadline);
    } catch (e) {
      // The telemetry bit is D6's own signal; it is set before the warning so it
      // records this degradation even when nothing listens on stderr.
      if (!isBusyRetryExhausted(e)) this.accessEventTel.bootstrapFailed = true;
      this.warnOrRefuseWhenContended(e, "anysearch: access-chain bootstrap degraded (fail-open): ");
    }
    // Startup contract restored: ordinary reads and writes wait on row locks for
    // the pre-#257 5s instead of the short initialization timeout.
    endInit(this.db);

    // Module-level prepared statements (atomcode research pattern).
    this.stmts = {
      createSession: this.db.prepare("INSERT INTO sessions (id, domain) VALUES (?, ?) RETURNING id, domain, created_at as createdAt"),
      // Idempotent registration of an externally minted session id (FK target).
      ensureSession: this.db.prepare("INSERT OR IGNORE INTO sessions (id, domain) VALUES (?, ?)"),
      append: this.db.prepare("INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)"),
      searchMessages: this.db.prepare("SELECT m.id as rowid, m.session_id as sessionId, m.role, m.content, bm25(messages_fts) as rank FROM messages_fts JOIN messages m ON m.id = messages_fts.rowid WHERE messages_fts MATCH ? AND m.session_id = ? ORDER BY rank LIMIT ?"),
      searchAllMessages: this.db.prepare("SELECT m.id as rowid, m.session_id as sessionId, m.role, m.content, bm25(messages_fts) as rank FROM messages_fts JOIN messages m ON m.id = messages_fts.rowid WHERE messages_fts MATCH ? ORDER BY rank LIMIT ?"),
      saveResult: this.db.prepare("INSERT INTO retrieval_results (session_id, url, title, snippet, source, rrf_score, entity, source_label, trace_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"),
      searchResults: this.db.prepare("SELECT r.id as rowid, r.session_id as sessionId, r.title, r.snippet, bm25(retrieval_results_fts) as rank FROM retrieval_results_fts JOIN retrieval_results r ON r.id = retrieval_results_fts.rowid WHERE retrieval_results_fts MATCH ? AND r.session_id = ? AND r.archived = 0 ORDER BY rank LIMIT ?"),
      saveAnchor: this.db.prepare("INSERT INTO resume_anchors (session_id, anchor_type, payload) VALUES (?, ?, ?)"),
      getAnchors: this.db.prepare("SELECT id, session_id as sessionId, anchor_type as anchorType, payload, created_at as createdAt FROM resume_anchors WHERE session_id = ? ORDER BY id"),
      // recall_memory searches the research archive (retrieval_results_fts), not messages.
      // ->: freshness_factor in ORDER BY + bi-temporal filter (valid_until IS NULL).
     // MemoryHit.role <-- r.title, MemoryHit.content <-- r.snippet (recall_memory maps these fields).
     searchAllResults: this.db.prepare("SELECT r.id as rowid, r.session_id as sessionId, r.title as role, r.snippet as content, freshness_factor(bm25(retrieval_results_fts), r.created_at, r.last_accessed, r.access_count, r.title, r.url, ?, r.pinned) as rank FROM retrieval_results_fts JOIN retrieval_results r ON r.id = retrieval_results_fts.rowid WHERE retrieval_results_fts MATCH ? AND (r.valid_until IS NULL) AND (r.quarantine IS NULL) AND (r.archived = 0) AND (r.superseded_by IS NULL) ORDER BY rank LIMIT ?"),
      // L2: update last_accessed on recall hit (access-time signal, Mem0 1.5×/0.3×).
      touchAccessed: this.db.prepare("UPDATE retrieval_results SET last_accessed = datetime('now'), access_count = COALESCE(access_count, 0) + 1 WHERE id = ?"),
      // same exactly-once site — each returned hit logs one access event.
      // chained insert — prev_hash + schema_version(v1) + event_type per event.
      insertAccessEvent: this.db.prepare("INSERT INTO access_events (memory_id, prev_hash, schema_version, event_type, source_label) VALUES (?, ?, ?, ?, ?)"),
      lastChainedEvent: this.db.prepare("SELECT id, memory_id, accessed_at, prev_hash, schema_version, event_type, source_label FROM access_events WHERE prev_hash IS NOT NULL ORDER BY id DESC LIMIT 1"),
      // UPSERT for state-type anchors.
  
      saveAnchorUpsert: this.db.prepare("INSERT INTO resume_anchors (session_id, anchor_type, payload) VALUES (?, ?, ?) ON CONFLICT(session_id, anchor_type) WHERE anchor_type = 'consolidation_state' DO UPDATE SET payload = excluded.payload, created_at = datetime('now')"),
    };
  }

  // chain an access event onto the hash chain. Head-read + insert run in one
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
      this.stmts.insertAccessEvent.run(memoryId, prevHash, CHAIN_SCHEMA_VERSION, CHAIN_EVENT_TYPE, "system");
    });
    write.immediate();
  }

  /**
   * T2 #177: the budget ledger over this store's single connection.
   *
   * Registration (#187 `initBudget` / `clearBudgetCaps`) and the engine
   * wiring share this cached instance, so caps, reserve and settle all
   * see one row and one set of prepared statements. Returns the same object on
   * every call.
   */
  createBudgetLedger(): BudgetLedger {
    return (this.budgetLedgerInstance ??= new BudgetLedger(this.db));
  }

  // alert-on-silence telemetry — observational zone only, never gated (Goodhart).
  accessEventTelemetry(): AccessEventTelemetry {
    return { ...this.accessEventTel };
  }

  // T0 durable preference methods.
  // All writes are deterministic; gate logic lives in caller (A+C+B, not here).

  async promotePreference(input: T0PreferenceInput): Promise<{ action: "promoted" | "rejected"; reason?: string }> {
    const sourceLabel = input.sourceLabel ?? "user";
    // A: retrieved-derived and memory-derived content never promote T0.
    if (sourceLabel === "retrieved" || sourceLabel === "memory") {
      return { action: "rejected", reason: "source-gate" };
    }
    const scope = input.scope ?? "global";
    const now = new Date().toISOString();
    const prov = input.provenance ? JSON.stringify(input.provenance) : null;
    // d-i conflict: same key+scope already live → in-place supersede (Zep temporal).
    // modified + provenance updated; old value dereferenced (recoverable via WAL). correction_count preserved.
    this.db
      .prepare(
        `INSERT INTO t0_preferences (key, value, scope, modified, last_accessed, source, invalid_at, demote_reason, correction_count, provenance, source_label, trace_id)
         VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, 0, ?, ?, ?)
         ON CONFLICT (key, scope) DO UPDATE SET
           value = excluded.value,
           modified = excluded.modified,
           last_accessed = excluded.last_accessed,
           source = excluded.source,
           invalid_at = NULL,
           demote_reason = NULL,
           provenance = excluded.provenance,
           source_label = excluded.source_label,
           trace_id = excluded.trace_id`
      )
      .run(input.key, input.value, scope, now, now, input.source, prov, sourceLabel, input.traceId ?? null);
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

  // T0 promote correction-count channel.
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

  async ensureSession(sessionId: string, domain: string): Promise<void> {
    // Design: INSERT OR IGNORE rather than read-then-insert — a repeated durable
    // id (or two CLI processes racing on the same anchor) must be a no-op, and a
    // PK conflict must not surface as a memory failure.
    this.stmts.ensureSession.run(sessionId, domain);
  }

  // #187/CodeRabbit: merge legacy duplicate budget rows before the unique index.
  // A single row is required for reserve/settle consistency. Spend and reserved
  // counters are summed (history preserved); caps come from the most restrictive
  // active row (MIN), and configured stays active iff any duplicate was active.
  private mergeDuplicateBudgetRows(): void {
    const dupes = this.db
      .prepare("SELECT session_id, COUNT(*) AS c FROM budget_ledger GROUP BY session_id HAVING c > 1")
      .all() as Array<{ session_id: string; c: number }>;
    if (dupes.length === 0) return;
    const rowsStmt = this.db.prepare("SELECT * FROM budget_ledger WHERE session_id = ? ORDER BY id");
    const update = this.db.prepare("UPDATE budget_ledger SET token_cap = ?, usd_cap = ?, time_limit_ms = ?, call_cap = ?, configured = ?, reserved_tokens = ?, spent_tokens = ?, reserved_usd = ?, spent_usd = ?, reserved_calls = ?, billable_calls = ?, started_at = ?, created_at = ? WHERE id = ?");
    const del = this.db.prepare("DELETE FROM budget_ledger WHERE session_id = ? AND id <> ?");
    const merge = this.db.transaction(() => {
      for (const d of dupes) {
        const rows = rowsStmt.all(d.session_id) as Array<Record<string, any>>;
        const active = rows.filter((r) => r.configured === 1);
        const capRows = active.length > 0 ? active : rows;
        const minCap = (key: string): number => Math.min(...capRows.map((r) => Number(r[key])));
        const sum = (key: string): number => rows.reduce((acc, r) => acc + Number(r[key]), 0);
        const earliest = (key: string): string => String(rows.map((r) => r[key]).sort()[0]);
        const target = rows[0];
        update.run(
          active.length > 0 ? minCap("token_cap") : UNLIMITED_BUDGET_CAP,
          active.length > 0 ? minCap("usd_cap") : UNLIMITED_BUDGET_CAP,
          active.length > 0 ? minCap("time_limit_ms") : UNLIMITED_BUDGET_CAP,
          active.length > 0 ? minCap("call_cap") : UNLIMITED_BUDGET_CAP,
          active.length > 0 ? 1 : 0,
          sum("reserved_tokens"),
          sum("spent_tokens"),
          sum("reserved_usd"),
          sum("spent_usd"),
          sum("reserved_calls"),
          sum("billable_calls"),
          earliest("started_at"),
          earliest("created_at"),
          target.id,
        );
        del.run(d.session_id, target.id);
      }
    });
    merge();
  }

  // #257: the fail-open catch shape used by the startup steps below. A step whose
  // failure only costs a feature (budget metering, chain anchoring) keeps the
  // pre-existing degrade-and-continue behaviour for data/schema problems. It must
  // NOT keep it for busy/locked exhaustion: that means the database is contended
  // and the retry window ran out, and printing "database is locked" followed by a
  // successful start is exactly what the ticket forbids. So exhaustion rethrows.
  private warnOrRefuseWhenContended(e: unknown, prefix: string): void {
    if (isBusyRetryExhausted(e)) throw e;
    try {
      process.stderr.write(prefix + (e instanceof Error ? e.message : String(e)) + "\n");
    } catch { /* stderr unavailable */ }
  }

  // #257: one ADD COLUMN migration. Only "duplicate column name" is absorbed —
  // that is the idempotent-replay case (fresh DDL already created the column).
  // A busy/locked failure is retried by the shared startup policy, and any other
  // error propagates: swallowing it would leave a half-migrated database that
  // reports a successful start.
  private applyColumnMigration(label: string, ddl: string, deadlineAt: number): void {
    try {
      withInitBusyRetry(label, () => this.db.exec(ddl), deadlineAt);
    } catch (e) {
      if (isDuplicateColumnError(e)) return;
      throw e;
    }
  }

  // #187: budget row at the session-registration point. The caller (CLI/MCP
  // wiring) decides whether the Active Domain declared [budget]; no
  // declaration means no call and therefore no row (pass). Known limitation:
  // the Active Domain is sampled only at registration, so a mid-session domain
  // switch does not re-initialize the budget row.
  initBudget(sessionId: string, caps: BudgetCaps): void {
    (this.budgetLedgerInstance ??= new BudgetLedger(this.db)).initBudget(sessionId, caps);
  }

  // #187: drop [budget] from the Active Domain -> release caps but keep the
  // spend history. Registration is the only caller; mid-session domain switches
  // are not re-sampled (known limitation, same as initBudget).
  clearBudgetCaps(sessionId: string): void {
    (this.budgetLedgerInstance ??= new BudgetLedger(this.db)).clearBudgetCaps(sessionId);
  }

  async append(sessionId: string, message: Message): Promise<void> {
    // write entry: never persist a message that trips the secret guard.
    if (containsSecret(message.role + " " + message.content)) return;
    // atomcode research: avoid RETURNING inside transaction with FTS triggers (#654).
    // Simple INSERT, no RETURNING - trigger syncs FTS automatically.
    this.stmts.append.run(sessionId, message.role, message.content);
  }

  // SECURITY: escape FTS5 special chars, then tokenize the FTS5 query (CWE-20).
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

  // eval-only capture of the latest searchMemory arm inputs. Written on every
  // searchMemory call; the eval runner (golden search ops) is the only reader. Never part of
  // the external contract — do not consume from apps/ or kernel.
  public lastArmProvenance: ArmProvenance | null = null;

  // Design: research archive reads are store-scoped, not session- or domain-scoped —
  // session_id is per-call (MCP search_web mints a fresh session each call) and no
  // row records a domain origin; the store is the isolation unit.
  // See docs/rag-adapters.md §作用域 for the evidence and rejected alternatives.
  async searchMemory(query: string, limit = 20): Promise<MemoryHit[]> {
    const safeQuery = this.fts5Escape(query);
    // Spare rows per arm (#273 review). The liveness filter below can drop a
    // candidate (a correction closed it between the SQL reads), and every arm
    // used to cap its fetch at `limit` — so the dropped row's slot had nothing
    // left to refill it with and the answer came back short. Reading a small
    // margin past `limit` gives the filter something to promote.
    const fetchLimit = limit + Math.max(4, Math.ceil(limit / 4));
   // Params: (query_for_decay, fts_match_query, limit) — same string passed twice for both ? slots.
   let rawHits = this.stmts.searchAllResults.all(safeQuery, safeQuery, fetchLimit) as MemoryHit[];
   // strict rung under-fills → append the relaxed rung (decay keyed on the strict string).
   if (rawHits.length < fetchLimit) {
     const relaxed = fts5RelaxedQuery(query);
     if (relaxed) {
       const terms = relaxedTerms(query);
       const wide = (this.stmts.searchAllResults.all(safeQuery, relaxed, fetchLimit * 4) as MemoryHit[])
         .filter((h) => coversMajority(terms, `${h.role ?? ""} ${h.content ?? ""}`));
       rawHits = appendRelaxed(rawHits, wide, fetchLimit);
     }
   }
   // entity arm — conditional activation (absent when query has no entity match), weight 0.5 vs FTS 1.0.
   const armHits = this.entityArmRows(query, fetchLimit);
   const vecHits = await this.vectorArmRows(query, fetchLimit);
   // relation arm (fifth, weight 0.5) — 1-hop neighbor memories via active edges.
   const relHits = this.relationArmRows(query, fetchLimit);
   // Phase-2: semantic arm (sixth, weight 0.5, conditional activation).
   // Kept at `limit`: the arm allocates slots between its own keyword and vector
   // lanes, so widening it would change that allocation and let the vector lane
   // take the slot a keyword hit needed.
   const semHits = await this.semanticArmRows(query, limit);
   const byId = new Map<number, MemoryHit>();
    for (const h of rawHits) byId.set(h.rowid, h);
    for (const h of armHits) byId.set(h.rowid, h);
    for (const h of vecHits) byId.set(h.rowid, h);
    for (const h of relHits) byId.set(h.rowid, h);
    for (const h of semHits) byId.set(h.rowid, h); // semantic ids must resolve on the single-query path (was silent drop, atomcode Spec-1)
   // RRF arms = FTS (1.0) + entity (0.5) + vector (0.5); an absent arm adds no list (conditional activation).
   // MemoryFusion consumes the registry — k_fusion.memory + weights.memory
   // (FTS anchor 1.0; side arms 0.5). Values identical to the pre-registry literals.
   const lists = [rawHits.map((h) => String(h.rowid))];
   const weights: number[] = [registryWeight("memory", "fts")];
   if (armHits.length > 0) { lists.push(armHits.map((h) => String(h.rowid))); weights.push(registryWeight("memory", "entity")); }
   if (vecHits.length > 0) { lists.push(vecHits.map((h) => String(h.rowid))); weights.push(registryWeight("memory", "vector")); }
   if (relHits.length > 0) { lists.push(relHits.map((h) => String(h.rowid))); weights.push(registryWeight("memory", "relation")); }
    if (SEMANTIC_ARM_MODE === "serve" && semHits.length > 0) { lists.push(semHits.map((h) => String(h.rowid))); weights.push(registryWeight("memory", "semantic")); }
   const fusedIds = lists.length === 1 ? lists[0]! : rrfRank(lists, FUSION_REGISTRY.k_fusion.memory, weights);
    // Material candidates from the episode arms were read BEFORE the awaits that
    // fetch vectors and knowledge. A correction committed in that window leaves
    // them holding rows that are now closed, while the knowledge lane already
    // sees the successor — one answer would then carry both versions (#273
    // review). The semantic lane rechecks its own rows; this covers the rest.
    //
    // Read over every candidate id (not just the first `limit`) because the
    // filter now runs DURING the collection below: a stale row must not take a
    // slot and then be dropped, which would return fewer than `limit` hits
    // while a live successor sat further down the fusion order (#273 review).
    const materialIds = Array.from(byId.values()).filter((h) => h.rowid > 0).map((h) => h.rowid);
    let liveMaterials: Set<number> | null = null;
    if (materialIds.length > 0) {
      const ph = materialIds.map(() => "?").join(", ");
      liveMaterials = new Set(
        (this.db.prepare(
          "SELECT id FROM retrieval_results WHERE id IN (" + ph + ") " +
          "AND valid_until IS NULL AND quarantine IS NULL AND archived = 0 AND superseded_by IS NULL",
        ).all(...materialIds) as Array<{ id: number }>).map((r) => r.id),
      );
    }
   const fusedHits: MemoryHit[] = [];
   // read-side exit: rows written before the write guard (or via seed/test seams)
   // must never surface back to the caller either. Applied while collecting so
   // each dropped row frees its slot instead of shortening the answer.
   for (const id of fusedIds) {
     const h = byId.get(Number(id));
     if (!h) continue;
     if (h.rowid > 0 && liveMaterials !== null && !liveMaterials.has(h.rowid)) continue;
     if (containsSecret(h.role + " " + h.content)) continue;
     fusedHits.push(h);
     if (fusedHits.length >= limit) break;
   }
   // arm provenance — a hit recalled ONLY by the vector arm is weak evidence.
   const ftsIds = new Set(rawHits.map((h) => h.rowid));
   const entIds = new Set(armHits.map((h) => h.rowid));
   const vecIds = new Set(vecHits.map((h) => h.rowid));
   const relIds = new Set(relHits.map((h) => h.rowid));
   const semIds = new Set(semHits.map((h) => h.rowid));
   // provenance snapshot taken BEFORE the read-side secret filter (the filter can
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
    // L2: refresh last_accessed for each hit (access-time signal).
    for (const hit of fusedHits) {
      try { this.stmts.touchAccessed.run(hit.rowid); this.recordAccessEventChained(hit.rowid); } catch { this.accessEventTel.writeFailures += 1; }
    }
    return fusedHits;
  }

  // (Q2=B): multi-query + RRF k=60 fusion. queries[0] must be the raw user query.
  async searchMemoryMulti(queries: string[], limit = 20): Promise<MemoryHit[]> {
    // entity arm on the raw user query (queries[0]); ids passed as extra RRF list (weight 0.5 in fts5.ts).
    const armHits = this.entityArmRows(queries[0] ?? "", limit);
    const vecHits = await this.vectorArmRows(queries[0] ?? "", limit);
    // entity + vector arms, each weight 0.5 against FTS 1.0.
    // labeled arms so searchMemoryMultiQuery can annotate hit.arms provenance.
    const arms: { label: string; ids: string[] }[] = [];
    if (armHits.length > 0) arms.push({ label: "entity", ids: armHits.map((h) => String(h.rowid)) });
    if (vecHits.length > 0) arms.push({ label: "vector", ids: vecHits.map((h) => String(h.rowid)) });
    // relation arm on the raw query (weight 0.5 in fts5.ts like the other side arms).
    // the relation arm attaches to queries[0] only — the multi-query lane keeps the
    // conditional-activation contract on the primary query (documented to avoid
    // misreading as all-queries activation).
    const relHitsM = this.relationArmRows(queries[0] ?? "", limit);
    if (relHitsM.length > 0) arms.push({ label: "relation", ids: relHitsM.map((h) => String(h.rowid)) });
    // Phase-2: semantic arm fused into RRF in serve mode (negative ids resolved
    // from semantic_memories in fts5.ts); telemetry still runs in both modes.
    const semHits = await this.semanticArmRows(queries[0] ?? "", limit);
    if (SEMANTIC_ARM_MODE === "serve" && semHits.length > 0) arms.push({ label: "semantic", ids: semHits.map((h) => String(h.rowid)) });
    const hits = await searchMemoryMultiQuery<MemoryHit>(this, queries, limit, rrfRank, arms);
    // read-side exit: same guard as searchMemory.
    const kept = hits.filter((h) => !containsSecret(h.role + " " + h.content));
    // same exactly-once touch as searchMemory (both recall paths feed the signals).
    for (const hit of kept) {
      try { this.stmts.touchAccessed.run(hit.rowid); this.recordAccessEventChained(hit.rowid); } catch { this.accessEventTel.writeFailures += 1; }
    }
    return kept;
  }

  // structural-typing seam: exposes db.prepare(...).all(...) as a function so
  // private field doesn't escape through structural typing of the SearchableStoreLike contract.
  // Public by design: duck-typed contract with SearchableStoreLike requires assignability.
  dbQuery<Row = unknown>(sql: string, ...params: unknown[]): Row[] {
    return this.db.prepare(sql).all(...params) as Row[];
  }

  async saveResults(sessionId: string, results: NormalizedResult[]): Promise<void> {
    await this.saveResultsWithIds(sessionId, results);
  }

  /**
   * Archive a batch and report which row each result landed in.
   *
   * #263: the row id is what makes a summary's dependency exact. Two rows can
   * share one URL (an older version a correction retired, a newer one a later
   * fetch wrote), and only the id says which one the model actually read.
   * Returning the ids lined up with `results` lets the search path stamp them
   * onto the tool result the model sees, so the summary write can later resolve
   * the citation to the exact row instead of guessing by URL.
   *
   * `null` at index i means "no row was written for result i" — a result
   * carrying a secret is skipped by design (see containsSecret), so the caller
   * must not assume the arrays line up by position alone.
   */
  async saveResultsWithIds(sessionId: string, results: NormalizedResult[]): Promise<Array<number | null>> {
    const ids: Array<number | null> = [];
    // atomcode research: db.transaction(fn) auto-rollback on throw.
    const insertMany = this.db.transaction((rs: NormalizedResult[]) => {
      for (const r of rs) {
       // write entry: skip secret-bearing results entirely (no row, no FTS).
       if (containsSecret(r.url + " " + (r.title ?? "") + " " + (r.snippet ?? ""))) { ids.push(null); continue; }
       const sourceLabel = typeof (r.extra?.trustLabel as any)?.source === "string" ? (r.extra?.trustLabel as any).source : "retrieved";
       const traceId = typeof (r.extra?.trustLabel as any)?.traceId === "string" ? (r.extra?.trustLabel as any).traceId : null;
       const info = this.stmts.saveResult.run(sessionId, r.url, r.title, r.snippet, r.source, null, r.entity ?? r.url, sourceLabel, traceId);
       // bi-temporal invalidation — close old records for same entity (URL) at write time.
       // Not relying on decay to suppress staleness; valid_until set immediately on new write.
       try { invalidateOldRecords(this.db, r.url, Number(info.lastInsertRowid)); } catch {}
       ids.push(Number(info.lastInsertRowid));
      }
    });
    insertMany(results);
    return ids;
  }

  // (Q3=A): write-path adjudication (MemTX-simplified three checks).
  // Each KeyMemoryInput is classified by (1) evidence >=0.6, (2) temporal supersede, (3) equal-weight conflict.
  // Quarantined writes get quarantine IS NOT NULL and are excluded from searchMemory until confirmed.
  async adjudicateMemory(sessionId: string, keyMemories: KeyMemoryInput[]): Promise<AdjudicationResultItem[]> {
    const out: AdjudicationResultItem[] = [];
    for (const km of keyMemories) {
      // secret check runs BEFORE the evidence gate — a high-evidence leak is still a leak.
      if (containsSecret(km.url + " " + (km.title ?? "") + " " + (km.snippet ?? ""))) {
        out.push({ action: "reject", reason: "secret" });
        continue;
      }
      const evidence = typeof km.evidence === "number" && km.evidence >= 0.6;
      // Evidence check: direct user input / high-trust sources bypass (MemTX authority >= 0.9 channel).
      if (evidence || km.source === "user") {
        const entityKey = km.entity ?? km.url;
        // Temporal supersede: new write for same entity wins; close old record with valid_until = now (pattern).
        const existing = this.db
          .prepare("SELECT id FROM retrieval_results WHERE entity = ? AND session_id = ? AND valid_until IS NULL AND quarantine IS NULL AND archived = 0 LIMIT 1")
          .get(entityKey, sessionId) as { id: number } | undefined;
        const sourceLabel = km.sourceLabel ?? (km.source === "user" ? "user" : "retrieved");
        const info = this.stmts.saveResult.run(sessionId, km.url, km.title, km.snippet, km.source, null, entityKey, sourceLabel, km.traceId ?? null);
        const insertedId = Number(info.lastInsertRowid);
        await this.embedWrite(insertedId, km.title ?? null, km.snippet ?? null);
        try { await this.linkEntities(insertedId, km); } catch {} // entity linking fail-open, covers accept+supersede
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
        const sourceLabel = km.sourceLabel ?? (km.source === "user" ? "user" : "retrieved");
        const info = this.stmts.saveResult.run(sessionId, km.url, km.title, km.snippet, km.source, null, km.entity ?? km.url, sourceLabel, km.traceId ?? null);
        const insertedId = Number(info.lastInsertRowid);
        await this.embedWrite(insertedId, km.title ?? null, km.snippet ?? null);
        try { await this.linkEntities(insertedId, km); } catch {} // fail-open
        try {
          this.db.prepare("UPDATE retrieval_results SET quarantine = ?, evidence = ? WHERE id = ?").run("equal_conflict", typeof km.evidence === "number" ? km.evidence : null, insertedId);
        } catch {}
        out.push({ action: "quarantine", reason: "equal_conflict", insertedId });
      }
    }
    return out;
  }

  // saveAnchor with UPSERT semantics for state-type anchors.
  // State-type anchors (consolidation_state) use an atomic INSERT ... ON
  // CONFLICT DO UPDATE against the partial UNIQUE index (see schema.sql),
  // keeping one row per (session_id, anchor_type) without a DELETE or a schema
  // migration. All historical anchor types (query, fetch, sufficiency,
  // rolling_summary, l2_recall) remain append-only INSERT — sufficiency joined
  // them in #106.
  //
  // #263 (D9): a derived summary records the rows it was BUILT FROM, so a later
  // correction can name exactly which summaries went stale instead of guessing
  // by session or wording. The payload may carry `sources: SummarySourceRef[]`;
  // the anchor insert and the dependency rows run in ONE transaction, so a
  // summary never exists without its dependency list — and a concurrent reader
  // never sees "summary live, dependencies missing".
  //
  // The version check happens HERE, inside that transaction: a summary whose
  // source was already superseded (a correction landed between generation and
  // this write) is written SUSPENDED, never marked valid. That is the ticket's
  // "a summary built on an old version must not be re-marked as valid".
  /**
   * #263: summary anchors also carry their dependency list (see below).
   * Returns nothing, like every other anchor write — the anchor id is only
   * needed inside this store, where the insert already reports it.
   */
  async saveAnchor(sessionId: string, anchorType: string, payload: unknown): Promise<void> {
    const json = JSON.stringify(payload);
    // write entry: anchors are searchable surfaces too — refuse secret payloads.
    if (containsSecret(anchorType + " " + json)) return;
    // ponytail: state-type anchors take the atomic UPSERT statement above;
    // non-state anchors (including sufficiency, #106) stay append-only INSERT.
    if (anchorType === "consolidation_state") {
      this.stmts.saveAnchorUpsert.run(sessionId, anchorType, json);
      return;
    }
    if (isSummaryAnchorType(anchorType)) {
      this.saveSummaryAnchor(sessionId, anchorType, json, payload as { sources?: unknown });
      return;
    }
    this.stmts.saveAnchor.run(sessionId, anchorType, json);
  }

  /**
   * Write one summary anchor plus its dependency rows, atomically.
   *
   * A source that is no longer current when this write commits means the
   * summary describes a version another writer already replaced. The text is
   * still stored (it is an honest record of what was generated), but the
   * summary is inserted SUSPENDED so it can never be injected as the current
   * conclusion. Nothing is invented to "fix" it — the rebuild ticket owns
   * producing a fresh version.
   */
  private saveSummaryAnchor(
    sessionId: string,
    anchorType: SummaryAnchorType,
    json: string,
    payload: { sources?: unknown },
  ): number {    const refs = parseSummarySourceRefs(payload?.sources);
    const write = this.db.transaction((): number => {
      const info = this.stmts.saveAnchor.run(sessionId, anchorType, json);
      const anchorId = Number(info.lastInsertRowid);
      if (refs.length > 0) {
        // Checked against the CURRENT state at commit time, not at generation
        // time: that is the whole point of doing it here.
        const stale = refs.filter((ref) => !isSourceCurrent(this.db, ref));
        recordSummarySources(this.db, { sessionId, anchorId, anchorType, sources: refs });
        if (stale.length > 0) {
          suspendSummaries(
            this.db,
            [{ sessionId, anchorId }],
            {
              kind: stale[0]!.kind,
              id: stale[0]!.id,
              reason: "the summary was built from " + stale.map((r) => r.kind + " " + r.id).join(", ") +
                ", which had already been replaced when the summary was written",
            },
          );
        }
      }
      return anchorId;
    });
    return write.immediate();
  }

  /**
   * Summary anchors that must not be injected as the current conclusion.
   *
   * #263: a correction that replaced a fact those summaries were built from
   * suspended them. Their text stays readable (`getAnchors`) for anyone
   * investigating what the session once believed; this set only says which of
   * them may no longer be injected.
   */
  suspendedSummaryAnchorIds(sessionId: string): Set<number> {
    return suspendedSummaryAnchorIds(this.db, sessionId);
  }

  /**
   * Turn what a summary READ into the rows that back those reads.
   *
   * The exact form: a read may carry the archive row id the search path
   * recorded, which distinguishes two versions of one URL. Without an id the
   * URL bridge applies (current rows first, else every row). No text matching
   * and no session guessing either way. See resolveSummarySourcesFromReads.
   */
  resolveSummarySourcesFromReads(reads: SummaryRead[]): SummarySourceRef[] {
    return resolveSummarySourcesFromReads(this.db, reads);
  }

  /**
   * Turn the URLs a summary read into the rows that currently hold them.
   *
   * The summary gap is distilled from the tool-result JSON the model saw, which
   * carries `url` and not row ids, so this is the exact bridge — no text
   * matching and no session guessing. See resolveSummarySourcesFromUrls.
   */
  resolveSummarySources(urls: string[]): SummarySourceRef[] {
    return resolveSummarySourcesFromUrls(this.db, urls);
  }

  /**
   * The dependencies already recorded for one anchor.
   *
   * Needed because a summary is generated from the previous summary PLUS the
   * new gap: its dependencies are the previous version's plus the new
   * material. Without inheriting them, a correction to an old fact would
   * suspend the earlier summary but leave the newest one — which still states
   * the replaced fact — happily injected.
   */
  summarySourcesForAnchor(anchorId: number): SummarySourceRef[] {
    const rows = this.db
      .prepare("SELECT source_kind AS kind, source_id AS id FROM summary_sources WHERE anchor_id = ? ORDER BY id")
      .all(anchorId) as SummarySourceRef[];
    return rows;
  }

  async getAnchors(sessionId: string): Promise<ResumeAnchor[]> {
    const rows = this.stmts.getAnchors.all(sessionId) as Array<Omit<ResumeAnchor, "payload"> & { payload: string }>;
    return rows.map((r) => ({ ...r, payload: JSON.parse(r.payload) }));
  }

  // ---- entity link layer (write link + query arm) ----

  public entityTelemetry(): { queries: number; candidates: number; activations: number; hits: number; truncated: number } {
    return { ...this.entityTel };
  }
  // vector arm telemetry + breaker state (report-only).
  // async — arm presence requires the optional-import probe.
  public async vectorTelemetry(): Promise<{ writes: number; pendingVectors: number; armQueries: number; armHits: number; embeds: number; failures: number; circuitOpen: boolean; absent: boolean; fromDb: number }> {
    const pkg = await armTelemetry();
    return { ...this.embedTel, embeds: pkg.embeds, failures: pkg.failures, circuitOpen: pkg.circuitOpen, absent: pkg.absent,
      fromDb: (this.db.prepare("SELECT COUNT(*) as n FROM memory_embeddings").get() as { n: number }).n };
  }

  // synchronous embed at write; failure records pendingVector (recoverable via backfill-vectors).
  private async embedWrite(memoryId: number, title: string | null, snippet: string | null): Promise<void> {
    const text = ((title ?? "") + " " + (snippet ?? "")).trim();
    if (!text) return;
    const v = await embedText(text, "passage");
    if (!v) { this.embedTel.pendingVectors++; return; }
    this.embedTel.writes++;
    this.db.prepare("INSERT OR REPLACE INTO memory_embeddings (memory_id, embedding, model) VALUES (?, ?, ?)")
      .run(memoryId, Buffer.from(v.buffer, v.byteOffset, v.byteLength), await embeddingModelId());
  }

  // vector arm — full-scan JS cosine over live, non-quarantined rows. Absent on CB-open.
  private async vectorArmRows(query: string, limit: number): Promise<MemoryHit[]> {
    this.embedTel.armQueries++;
    const qv = await embedText(query, "query");
    if (!qv) return [];
    const rows = this.db.prepare(
      "SELECT r.id as rowid, r.session_id as sessionId, r.title as role, r.snippet as content, me.embedding as emb " +
      "FROM memory_embeddings me JOIN retrieval_results r ON r.id = me.memory_id " +
      "WHERE r.valid_until IS NULL AND r.quarantine IS NULL AND r.archived = 0 AND r.superseded_by IS NULL"
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

  // idempotent backfill for rows missing an embedding (write failures, pre-rename upgrade, model re-embed).
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
          .run(r.id, Buffer.from(v.buffer, v.byteOffset, v.byteLength), await embeddingModelId());
        embedded++;
      }
    }
    return { scanned: rows.length, embedded, failed };
  }
  // ---- turn older episodes into semantic memories (D2/D4) + reversible forgetting (D5) ----

  /**
   * One consolidation run over an explicit scope (D5/Q18).
   *
   * `opts.scope` is the caller's validated selection. Omitting it keeps the
   * internal full-archive mode that the eval runner and the existing
   * regression tests use; the two product entry points (`ans consolidate`,
   * `ans_chat operation=consolidate`) always pass one.
   *
   * `deps` carries this run's own seams. The MCP server builds its LLM session
   * per request (after the engine exists), so they cannot ride the constructor;
   * passing them per call keeps the store instance immutable and keeps two
   * concurrent requests from reading each other's usage counter.
   */
  async consolidateMemory(
    opts: ConsolidateRunOptions = {},
    deps?: {
      summarize?: ConsolidateSummarizeFn;
      classify?: ConsolidateClassifyFn;
      verify?: ConsolidateVerifyFn;
      verifyFinal?: ConsolidateFinalCheckFn;
    },
  ): Promise<ConsolidateReport> {
    return consolidateMemoryRun(this.db, {
      summarize: deps?.summarize ?? this.consolidateSummarize,
      classify: deps?.classify ?? this.consolidateClassify,
      verify: deps?.verify ?? this.consolidateVerify,
      verifyFinal: deps?.verifyFinal ?? this.consolidateVerifyFinal,
    }, opts);
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

  // semantic arm scoring (served in Phase-2). Full-table JS cosine over live semantic
  // rows, same pattern as vectorArmRows. Synthetic negative rowids (-semantic_memories.id) keep
  // the RRF id-space collision-free vs retrieval_results.
  private async semanticArmRows(query: string, limit: number): Promise<MemoryHit[]> {
    this.semTel.queries++;
    // #261 D8: a knowledge row is the only carrier of the facts a correction
    // did not replace, so it must be reachable without an embedding on either
    // side. The keyword lane below supplies that; the vector lane refines the
    // order when embeddings exist. Both feed the same `semantic` arm, so the
    // fusion registry keeps its closed label set.
    // Both lanes must be read against ONE view of the knowledge table. The
    // keyword lane used to read before `await embedText(...)` and the vector
    // lane after it, so a correction committed in between left the keyword
    // list holding the closed row and the vector list holding its successor —
    // both then appeared in the merged result (#273 review). Reading both after
    // the await removes the window; the validity re-check below covers anything
    // closed between the two statements.
    const qv = await embedText(query, "query");
    const keyword = this.semanticKeywordRows(query, limit);
    let vector: MemoryHit[] = [];
    if (qv) {
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
      vector = scored.slice(0, limit).map((x) => x.h);
    }
    // Merge, don't concatenate. Taking the vector list first and filling the
    // rest from keywords would let `limit` embedded rows shut out the ONE row
    // the keyword lane exists to rescue (a corrected row with no embedding) —
    // the very case this lane is here for. So each lane keeps at least half the
    // slots when it has candidates, and any spare goes to the vector lane
    // (the more precise signal):
    //   reserve = ceil(limit / 2)
    //   vectorCount = min(vector.length, limit - min(keyword.length, reserve))
    //   then fill the remainder from keyword, then from leftover vector.
    // Validity recheck: the two SELECTs above are separate statements, so a
    // concurrent correction can still close a row between them. Drop ids that
    // are no longer live before merging, so one answer never carries both a
    // replaced row and its successor.
    if (keyword.length > 0 || vector.length > 0) {
      const ids = [...keyword, ...vector].map((h) => Math.abs(h.rowid));
      const ph = ids.map(() => "?").join(", ");
      const liveRows = new Set(
        (this.db.prepare("SELECT id FROM semantic_memories WHERE id IN (" + ph + ") AND valid_until IS NULL")
          .all(...ids) as Array<{ id: number }>).map((r) => r.id),
      );
      const live = (h: MemoryHit): boolean => liveRows.has(Math.abs(h.rowid));
      keyword.splice(0, keyword.length, ...keyword.filter(live));
      vector.splice(0, vector.length, ...vector.filter(live));
    }
    const reserve = Math.ceil(limit / 2);
    const keywordQuota = Math.min(keyword.length, reserve);
    const vectorQuota = Math.min(vector.length, Math.max(0, limit - keywordQuota));
    const out: MemoryHit[] = [];
    const seen = new Set<number>();
    const add = (h: MemoryHit): void => {
      if (seen.has(h.rowid)) return;
      seen.add(h.rowid);
      out.push(h);
    };
    for (const h of vector.slice(0, vectorQuota)) add(h);
    for (const h of keyword.slice(0, keywordQuota)) add(h);
    // Spare slots: leftover vector first (precise), then leftover keyword.
    for (const h of vector.slice(vectorQuota)) { if (out.length >= limit) break; add(h); }
    for (const h of keyword.slice(keywordQuota)) { if (out.length >= limit) break; add(h); }
    this.semTel.hits += out.length;
    if (SEMANTIC_ARM_MODE === "serve") this.semTel.served += out.length;
    return out.slice(0, limit);
  }

  // Keyword recall over live knowledge rows (semantic_memories_fts). Independent
  // of the embedding arm on purpose: a correction's kept facts must stay
  // retrievable even when no embedding can be computed for the query or the row.
  //
  // Two fallbacks behind the strict FTS rung, both mirroring the episode lane:
  // - a relaxed OR rung, so a question with extra words ("what is the Acme
  //   support email") still reaches a row that states the plain fact;
  // - a LIKE rung for CJK, because `fts5EscapeQuery` strips non-ASCII (a pure
  //   Chinese query becomes `""`), and the default unicode61 tokenizer glues a
  //   whole Chinese run into one token, so `"客服邮箱"` could never MATCH it.
  //   The LIKE rung is the only path that finds a Chinese fact without vectors.
  private semanticKeywordRows(query: string, limit: number): MemoryHit[] {
    const latin: Array<{ id: number; content: string; rank: number }> = [];
    const cjk: Array<{ id: number; content: string; rank: number }> = [];
    const otherScript: Array<{ id: number; content: string; rank: number }> = [];
    // Independent indexed lane for rows matching both query scripts.
    // Do not share 'seen' with the weaker one-script lanes.
    const crossScript: Array<{ id: number; content: string; rank: number }> = [];
    const seen = new Set<number>();
    const mark = (list: Array<{ id: number; content: string; rank: number }>) =>
      (r: { id: number; content: string; rank: number }): void => {
        if (seen.has(r.id)) return;
        seen.add(r.id);
        list.push(r);
      };
    const pushLatin = mark(latin);
    const pushCjk = mark(cjk);
    const pushOtherScript = mark(otherScript);

    // 1) Strict FTS rung (latin words). Its rows are already known to match the
    //    whole query, so no extra relevance filter applies.
    const strict = this.fts5Escape(query);
    if (strict !== '""') {
      const stmt = this.db.prepare(
        "SELECT s.id as id, s.content as content, bm25(semantic_memories_fts) as rank " +
        "FROM semantic_memories_fts JOIN semantic_memories s ON s.id = semantic_memories_fts.rowid " +
        "WHERE semantic_memories_fts MATCH ? AND s.valid_until IS NULL ORDER BY rank LIMIT ?",
      );
      for (const r of stmt.all(strict, limit) as Array<{ id: number; content: string; rank: number }>) pushLatin(r);
      // 2) Relaxed rung (OR over content words) only when the strict rung
      //    under-fills, and only for rows covering a strict majority of those
      //    words — same rule as the episode lane. Without it an OR query for
      //    "acme support email" would drag in anything containing "support".
      if (latin.length < limit) {
        const relaxed = fts5RelaxedQuery(query);
        if (relaxed) {
          const terms = relaxedTerms(query);
          // Fetch relaxed candidates in pages and filter each page as it
          // arrives, stopping once `limit` survivors are in hand. A fixed
          // `limit * 2` fetch followed by filtering loses everything when the
          // head of the list are one-word matches — the row covering the
          // whole query can sit past the cut (#273 review).
          // One ordered pass, filtered as it goes. The relaxed rung used to
          // fetch a fixed `limit * 2` rows and filter afterwards; growing the
          // LIMIT and slicing off the seen prefix re-reads and re-ranks the whole
          // prefix every round, which on 10k one-word rows and limit 20 means
          // ~1.25M rows transferred instead of 10k (#273 review).
          //
          // Iterating one cursor over the ranked rows keeps the scan linear and
          // preserves "keep reading while the filtered count is short". The
          // iterator is bounded so a pathological table cannot spin forever.
          const BOUND = Math.max(limit * 20, 200);
          let scanned = 0;
          for (const r of stmt.iterate(relaxed, BOUND) as Iterable<{ id: number; content: string; rank: number }>) {
            if (latin.length >= limit) break;
            if (++scanned > BOUND) break;
            if (coversMajority(terms, r.content)) pushLatin(r);
          }
        }
      }
    }

    // 3) CJK rung. Runs whenever the query carries Han characters, even if the
    //    ASCII part already filled `limit`: a mixed query like "Acme 客服邮箱"
    //    is only half-served by FTS, and the half it misses is the one that
    //    holds the kept Chinese fact.
    //
    //    Chinese has no spaces, so a question arrives as one long run
    //    ("请问客服邮箱是什么") that never appears verbatim in a row stating
    //    "客服邮箱为 help@example.com". Each run is therefore split into
    //    overlapping slices, and the relevance floor is applied IN SQL before
    //    LIMIT: filtering after the cut would let `limit` weak matches take the
    //    slots and leave the strong one out.
    if (/[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/.test(query)) {
      const runs = query
        .split(/[\s\p{P}\p{S}]+/u)
        .filter((t) => /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/.test(t));
      const strong = new Set<string>();
      for (const run of runs) {
        const hanOnly = run.replace(/[^\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/g, "");
        if (hanOnly.length < 2) continue;
        // Slices of 4..6 characters. Three is excluded on purpose: a 3-character
        // piece ("客服") sits in almost every support-related row, so matching
        // it is not evidence for one particular question — with LIMIT applied,
        // those weak rows would take the slot and the strong row would never be
        // seen (#273 round 5).
        //
        // A SHORT run is taken whole instead: "邮箱" or "负责人" is a complete
        // word, and a 4-character floor would leave such a query with no slice
        // at all, making it unreachable without embeddings (#273 review).
        if (hanOnly.length < 4) {
          strong.add(hanOnly);
          continue;
        }
        const maxLen = Math.min(6, hanOnly.length);
        for (let len = maxLen; len >= 4; len--) {
          for (let i = 0; i + len <= hanOnly.length; i++) strong.add(hanOnly.slice(i, i + len));
        }
      }
      // Slice budget. A long question ("请帮我确认一下甲公司客服邮箱", 14 chars)
      // yields ~19 six/five-char slices before the four-char ones, so a plain
      // "keep the first 24" drops the SHORT slice at the tail ("客服邮箱") —
      // exactly the fact word a caller asks about. Keep a few of every length,
      // and spread the picks across the whole run so both the head ("甲公司")
      // and the tail ("邮箱") stay represented (#273 review).
      const SPAN = 24;
      const byLen = new Map<number, string[]>();
      for (const t of strong) {
        const arr = byLen.get(t.length) ?? [];
        arr.push(t);
        byLen.set(t.length, arr);
      }
      const lengths = [...byLen.keys()].sort((a, b) => b - a); // longest first
      const grams: string[] = [];
      // Round-robin over lengths, taking the outermost positions of each length
      // first: index 0, last, 1, last-1, … — that keeps head and tail words.
      const picks = new Map<number, string[]>();
      for (const len of lengths) {
        const all = byLen.get(len)!;
        const ordered: string[] = [];
        for (let i = 0, j = all.length - 1; i <= j; i++, j--) {
          ordered.push(all[i]!);
          if (i !== j) ordered.push(all[j]!);
        }
        picks.set(len, ordered);
      }
      for (let round = 0; grams.length < SPAN; round++) {
        let took = false;
        for (const len of lengths) {
          const arr = picks.get(len)!;
          if (round < arr.length) {
            grams.push(arr[round]!);
            took = true;
            if (grams.length >= SPAN) break;
          }
        }
        if (!took) break;
      }
      // Two rounds, strong facts first. A query like "甲公司 客服邮箱是什么"
      // yields both the object name (甲公司, 3 chars) and the fact word
      // (客服邮箱, 4 chars). OR-ing them together lets any row mentioning the
      // OBJECT fill the LIMIT before the row holding the FACT is reached —
      // "甲公司每周一发布新版。" would win over "客服邮箱为 help@jia.example"
      // (#273 review). So the 4+ character slices run alone first; the short
      // object names only widen the search when that rung under-fills, which is
      // what keeps a bare "邮箱" / "负责人" query working.
      if (grams.length > 0) {
        const runGran = (list: string[]): void => {
          if (list.length === 0 || cjk.length >= limit) return;
          const where = list.map(() => "s.content LIKE ?").join(" OR ");
          const remaining = limit - cjk.length;
          const rows = this.db
            .prepare("SELECT s.id as id, s.content as content FROM semantic_memories s WHERE s.valid_until IS NULL AND (" + where + ") LIMIT ?")
            .all(...list.map((t) => "%" + t + "%"), remaining) as Array<{ id: number; content: string }>;
          for (const r of rows) pushCjk({ id: r.id, content: r.content, rank: 0 });
        };
        const factGrams = grams.filter((t) => t.length >= 4);
        const objectGrams = grams.filter((t) => t.length < 4);
        runGran(factGrams);
        runGran(objectGrams);
      }
    }
    // Keyword fallback for scripts excluded by the ASCII query sanitizer.
    // FTS5's unicode61 tokenizer handles case folding (e.g. почта / Почта)
    // without scanning the whole table. LIKE is a bounded substring fallback
    // for scripts or fragments that unicode61 does not tokenize usefully.
    const otherWords = [...new Set(
      (query.match(/[\p{L}\p{N}]+/gu) ?? [])
        .filter((w) => /[^\x00-\x7F]/u.test(w) &&
          !/[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/u.test(w)),
    )].slice(0, 8);
    if (otherWords.length > 0) {
      const asciiTerms = relaxedTerms(query);
      if (asciiTerms.length > 0) {
        // The intersection itself admits rows that match just ONE ASCII word.
        // Scan bounded indexed candidates BEFORE trimming to 'limit', then use
        // the same strict-majority filter as the relaxed Latin rung. Favor
        // higher ASCII coverage before BM25, so a short two-word distractor
        // cannot displace a row matching the entire mixed-script question.
        const asciiMatch = asciiTerms.map((w) => '"' + w + '"*').join(" OR ");
        const unicodeMatch = otherWords.map((w) => '"' + w + '"*').join(" OR ");
        const scanBound = Math.max(limit * 20, 200);
        const paired = this.db.prepare(
          "SELECT s.id as id, s.content as content, bm25(semantic_memories_fts) as rank " +
          "FROM semantic_memories_fts JOIN semantic_memories s ON s.id = semantic_memories_fts.rowid " +
          "WHERE semantic_memories_fts MATCH ? AND s.valid_until IS NULL ORDER BY rank LIMIT ?",
        );
        const qualified: Array<{ row: { id: number; content: string; rank: number }; coverage: number }> = [];
        const candidates = paired.iterate(
          "(" + asciiMatch + ") AND (" + unicodeMatch + ")", scanBound,
        ) as Iterable<{ id: number; content: string; rank: number }>;
        for (const row of candidates) {
          if (!coversMajority(asciiTerms, row.content)) continue;
          const tokens = row.content.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
          const coverage = asciiTerms.filter((term) => tokens.some((token) => token.startsWith(term))).length;
          qualified.push({ row, coverage });
        }
        qualified.sort((a, b) => b.coverage - a.coverage || a.row.rank - b.row.rank);
        crossScript.push(...qualified.slice(0, limit).map((candidate) => candidate.row));
      }
      const queryFts = otherWords.map((w) => '"' + w + '"*').join(" OR ");
      const indexed = this.db.prepare(
        "SELECT s.id as id, s.content as content, bm25(semantic_memories_fts) as rank " +
        "FROM semantic_memories_fts JOIN semantic_memories s ON s.id = semantic_memories_fts.rowid " +
        "WHERE semantic_memories_fts MATCH ? AND s.valid_until IS NULL ORDER BY rank LIMIT ?",
      ).all(queryFts, limit) as Array<{ id: number; content: string; rank: number }>;
      for (const r of indexed) pushOtherScript(r);
      // Keep a substring rung for languages where an indexed word differs
      // from a useful query fragment; avoid the scan if FTS already filled.
      if (otherScript.length < limit) {
        const where = otherWords.map(() => "s.content LIKE ?").join(" OR ");
        const rows = this.db.prepare(
          "SELECT s.id as id, s.content as content FROM semantic_memories s WHERE s.valid_until IS NULL AND (" + where + ") LIMIT ?",
        ).all(...otherWords.map((w) => "%" + w + "%"), limit) as Array<{ id: number; content: string }>;
        for (const r of rows) pushOtherScript({ id: r.id, content: r.content, rank: 0 });
      }
    }
    // A query carrying Chinese is answered by the Chinese rows first: the
    // ASCII rung only saw half the question, so letting its rows keep every
    // slot would starve the half the caller actually typed (#273 round 5).
    // Prefer evidence covering both ASCII and non-Han Unicode terms over
    // partial matches. The existing Han-first rule is unchanged (#277).
    const ordered = [...cjk, ...crossScript, ...otherScript, ...latin];
    const resultSeen = new Set<number>();
    return ordered.filter((r) => {
      if (resultSeen.has(r.id)) return false;
      resultSeen.add(r.id);
      return true;
    }).slice(0, limit).map((r) =>
      ({ rowid: -r.id, sessionId: "", role: "(semantic)", content: r.content, rank: r.rank }) as MemoryHit);
  }


  private liveEntities(): Array<{ id: number; name: string; nameNorm: string; type: string; aliases: string[] }> {
    const rows = this.db.prepare("SELECT id, name, name_norm as nameNorm, entity_type as type, aliases FROM entities WHERE valid_until IS NULL").all() as Array<{ id: number; name: string; nameNorm: string; type: string; aliases: string }>;
    return rows.map((r) => ({ ...r, aliases: JSON.parse(r.aliases || "[]") as string[] }));
  }

  // Write-path linking: declared entity key (non-URL) + rule extraction; LLM backfill only on empty rules (fail-open).
  private async linkEntities(memoryId: number, km: KeyMemoryInput): Promise<void> {
    const text = (km.title ?? "") + " " + (km.snippet ?? "");
    // known set includes aliases — alias pass-through on the write path (Neo4j Keep Aliases).
    const known = new Set(this.liveEntities().flatMap((e) => [e.nameNorm, ...e.aliases]));
    const candidates: EntityCandidate[] = [];
    if (km.entity && !km.entity.includes("://")) candidates.push({ name: km.entity, type: "declared" });
    for (const c of extractEntityCandidates(text, known, MAX_CANDIDATES * 2)) candidates.push(c); // 2x cap — overflow tail feeds the review list
    if (candidates.length === 0 && this.entityLlmFallback) {
      // LLM backfill (fail-open) — offline/no-key keeps rule output (here: empty).
      try { const extra = await this.entityLlmFallback(text); if (extra) candidates.push(...extra); } catch {}
    }
    // relation extraction piggybacks this pass; preKnown marks entities that
    // existed before this write (co-occurrence related_to edges only fire between two preKnown refs).
    const linkedRefs: LinkedEntityRef[] = [];
    for (const c of candidates.slice(0, MAX_CANDIDATES + 1)) { // 1 declared + MAX_CANDIDATES rule/LLM
      const entityId = this.resolveEntity(c.name, c.type);
      this.db.prepare("INSERT OR IGNORE INTO memory_entity (memory_id, entity_id) VALUES (?, ?)").run(memoryId, entityId);
      const refNorm = normalizeEntityName(c.name);
      linkedRefs.push({ id: entityId, name: c.name, nameNorm: refNorm, entityType: c.type, preKnown: known.has(refNorm) });
    }
    try { await this.linkRelations(memoryId, km, linkedRefs); } catch {} // fail-open, same discipline as linkEntities
    // extraction overflow (capped out) enters the candidate review list — never silent loss.
    const overflow = candidates.slice(MAX_CANDIDATES + 1);
    this.entityTel.truncated += overflow.length;
    for (const c of overflow) this.logOverflowCandidate(c);
  }

  // dedup'd candidate write — a re-hit of the same unresolved (source, target) pair
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

  // Overflow candidates only enter the review list when they pass the Fellegi-Sunter review band
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

  // three-tier match (exact -> trigram) + Fellegi-Sunter two thresholds + type gate.
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
      // unmerge wrote kind="override" records for the split pair — auto alias-merge
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

  // reversible merge undo — only alias-appends are undoable (candidate band never mutated anything).
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

  // entity arm — read-only resolution (exact/containment, no mutation), arm-level valid_until+quarantine guard.
  // ---- destructive merge execution (combine / unmerge / review list / telemetry) ----

  // destructive redirect merge. Single better-sqlite3 transaction (deferred);
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
        return { ok: false, error: "type gate: cross-type merge rejected " };
      const fromAliases = JSON.parse(a.aliases || "[]") as string[];
      const toAliasesBefore = JSON.parse(b.aliases || "[]") as string[];
      const redirected = (this.db.prepare("SELECT memory_id FROM memory_entity WHERE entity_id = ?").all(from) as Array<{ memory_id: number }>)
        .map((r) => r.memory_id);
      // Redirect, tolerating (memory_id, toId) pairs that already exist (UNIQUE(memory_id, entity_id)).
      // memories linked to BOTH entities pre-merge are recorded in bothLinked —
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
      // edges move with the merge. Self-loops and live-triple conflicts are
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

  // bounded unmerge — snapshot-driven redirect-back + revive + alias restore + override.
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
          // pre-merge this memory was linked to BOTH entities. Merge deleted the
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
      // bounded edge restore — redirected edges return to the snapshot endpoints;
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

  // candidate review list — unresolved candidates, hit_count desc (Senzing escalation).
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

  // keep = execute the merge (writes resolved='confirmed'); drop = keep separate
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

  // six report-only merge metrics. Five counters are derived from the persistent merge
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
    const known = new Set(this.liveEntities().flatMap((e) => [e.nameNorm, ...e.aliases])); // aliases recognized read-side too
    const candidates = extractEntityCandidates(query, known);
    if (candidates.length === 0) return [];
    this.entityTel.candidates += 1;
    const norms = candidates.map((c) => normalizeEntityName(c.name));
    const matched = this.liveEntities().filter((e) => norms.some((nm) => e.nameNorm === nm || e.nameNorm.startsWith(nm + "-") || nm.startsWith(e.nameNorm + "-") || e.aliases.includes(nm)));
    if (matched.length === 0) return [];
    this.entityTel.activations += 1;
    const ids = matched.map((e) => e.id);
    const sql = "SELECT DISTINCT r.id as rowid, r.session_id as sessionId, r.title as role, r.snippet as content, 0.0 as rank FROM retrieval_results r " + // rank required by MemoryHit
      "JOIN memory_entity me ON me.memory_id = r.id WHERE me.entity_id IN (" + ids.map(() => "?").join(", ") + ") " +
      "AND (r.valid_until IS NULL) AND (r.quarantine IS NULL) AND (r.archived = 0) AND (r.superseded_by IS NULL) ORDER BY r.created_at DESC LIMIT ?";
    const rows = this.db.prepare(sql).all(...ids, limit) as MemoryHit[];
    this.entityTel.hits += rows.length;
    return rows;
  }

  // ---- entity-relation edge layer ----

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
    // contract: live-path inserts are single-statement autocommit ops (no explicit
    // tx here) — safe under WAL single-writer + busy_timeout. Backfill paths wrap their own tx.
    for (const t of triples) this.insertEdge(memoryId, t, linked);
  }

  // Triple to edge row. Pattern check against edge_patterns; same-episode re-write is a dedup
  // skip; a live row for the same triple from another episode is superseded (close old, insert new).
  // a rule-side spans a clause ("CraneLib for batch scheduling"), not an entity name.
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
      .prepare("SELECT id, episode_memory_id FROM edges WHERE source_entity_id = ? AND relation = ? AND target_entity_id = ? AND valid_until IS NULL")
      .get(s.id, t.relation, o.id) as { id: number; episode_memory_id: number | null } | undefined;
    // #273 review: an edge whose supporting material was superseded is already
    // hidden from the relation arm (it describes the past). Counting it as a
    // live `related_to` duplicate here would block the CURRENT material from
    // re-establishing the same relation, so the relation would stay unusable
    // forever. Close the dead edge first, then let this write proceed — the
    // unique index is on live rows, so the old row has to go before the insert.
    if (live) {
      const supportDead = live.episode_memory_id !== null && this.db
        .prepare("SELECT 1 AS dead FROM retrieval_results WHERE id = ? AND superseded_by IS NOT NULL")
        .get(live.episode_memory_id) as { dead: number } | undefined;
      if (supportDead) {
        this.db.prepare("UPDATE edges SET valid_until = datetime('now') WHERE id = ?").run(live.id);
        this.relationTel.supersededSupportClosed += 1;
      } else {
        if (t.relation === "related_to") { this.relationTel.relatedToWriteOnce += 1; return; } // write-once = first co-occurrence materializes the edge; repeat-episode attempts skip (noise control), counted separately from dedup
        this.db.prepare("UPDATE edges SET valid_until = datetime('now') WHERE id = ?").run(live.id);
      }
    }
    this.db
      .prepare("INSERT INTO edges (source_entity_id, target_entity_id, relation, description, confidence, episode_memory_id, rules_version) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(s.id, o.id, t.relation, null, t.confidence, memoryId, RELATION_RULES_VERSION);
    this.relationTel.triplesWritten += 1;
  }

  // fifth arm — query-matched entities plus their 1-hop edge neighbors feed a
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
        // An edge whose supporting material was superseded describes the past;
        // following it would pull the neighbour's CURRENT materials in and
        // present them as related to a fact that no longer holds (#273 review).
        " FROM edges e WHERE e.valid_until IS NULL AND (e.source_entity_id IN (" + ph + ") OR e.target_entity_id IN (" + ph + "))" +
        " AND NOT EXISTS (SELECT 1 FROM retrieval_results r WHERE r.id = e.episode_memory_id AND r.superseded_by IS NOT NULL)"
      )
      .all(...ids, ...ids, ...ids) as Array<{ nid: number }>;
    const allIds = Array.from(new Set([...ids, ...neighbors.map((n) => n.nid)]));
    const ph2 = allIds.map(() => "?").join(", ");
    const rows = this.db
      .prepare(
        "SELECT DISTINCT r.id as rowid, r.session_id as sessionId, r.title as role, r.snippet as content, 0.0 as rank" +
        " FROM retrieval_results r JOIN memory_entity me ON me.memory_id = r.id" +
        " WHERE me.entity_id IN (" + ph2 + ") AND r.valid_until IS NULL AND (r.quarantine IS NULL) AND r.archived = 0 AND r.superseded_by IS NULL" +
        " ORDER BY r.created_at DESC LIMIT ?"
      )
      .all(...allIds, Math.min(limit, 100)) as MemoryHit[];
    this.relationTel.armHits += rows.length;
    return rows;
  }

  // relation list CLI backing query — live edges, optional single-entity filter.
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

  // idempotent keyset-paginated backfill (rules only — the LLM seam stays on the live
  // write path). Covered rows skip unless --reprocess targets older rules_version rows (supersede).
  // dry-run executes the IDENTICAL pipeline inside a rolled-back transaction, so
  // written / dedupSkipped / schemaRejected are exact predictions (never upper bounds) and the
  // edges table + telemetry counters are left untouched. fullRefresh is the dbt full-refresh
  // safety net: rebuild the edges table from scratch, atomic with the scan loop.
  public async backfillRelations(opts: { apply: boolean; batch?: number; fromId?: number; limit?: number; reprocess?: boolean; fullRefresh?: boolean }): Promise<BackfillRelationsResult> {
    // a partial window (--from-id/--limit) contradicts a full rebuild — reject the combination.
    if (opts.fullRefresh && (opts.fromId !== undefined || opts.limit !== undefined)) {
      throw new Error("backfillRelations: fullRefresh cannot be combined with fromId/limit (r88 guard)");
    }
    const batch = opts.batch ?? 200;
    const maxRows = opts.limit ?? 100000;
    const fromId0 = opts.fromId ?? 0;
    const res: BackfillRelationsResult = { apply: opts.apply, scanned: 0, written: 0, dedupSkipped: 0, schemaRejected: 0, lastId: fromId0 };
    const tel0 = { ...this.relationTel };
    const dryRollback = Symbol("dry-run-rollback");
    // Factored scan/process helpers shared by the dry-run and chunked-apply paths.
    type ScanRow = { id: number; title: string | null; snippet: string | null; rules: number | null };
    const scanBatch = (fromId: number): ScanRow[] =>
      this.db
        .prepare(
          "SELECT r.id, r.title, r.snippet, MIN(e.rules_version) as rules FROM retrieval_results r" +
          " LEFT JOIN edges e ON e.episode_memory_id = r.id AND e.valid_until IS NULL" +
          " WHERE r.id > ? AND r.archived = 0 AND r.superseded_by IS NULL GROUP BY r.id ORDER BY r.id LIMIT ?"
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
      // Dry-run keeps the r87 single rolled-back transaction: counts are exact predictions.
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
      // apply mode commits one IMMEDIATE transaction per batch, so concurrent live
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
          supersededSupportClosed: this.relationTel.supersededSupportClosed,
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
              Object.assign(this.relationTel, { ruleHits: snap.ruleHits, triplesWritten: snap.triplesWritten, dedupSkipped: snap.dedupSkipped, schemaRejected: snap.schemaRejected, relatedToWriteOnce: snap.relatedToWriteOnce, supersededSupportClosed: snap.supersededSupportClosed });
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

  // report-only. pendingEdges gauge = linked memories with no live edge episode row.
  // semantic-arm telemetry (queries/hits/served; regressions gated in eval).
  public semanticTelemetry(): { queries: number; hits: number; served: number } {
    return { ...this.semTel };
  }

  public relationTelemetry(): RelationTelemetry {
    const pending = (this.db
      .prepare("SELECT COUNT(*) as n FROM memory_entity me WHERE NOT EXISTS (SELECT 1 FROM edges e WHERE e.episode_memory_id = me.memory_id AND e.valid_until IS NULL)")
      .get() as { n: number }).n;
    return { ...this.relationTel, pendingEdges: pending };
  }

  // equal-conflict review channel. Zero new tables — the quarantine column
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
      // Kept value wins: close the live counterpart for the same entity (bi-temporal pattern).
      this.db
        .prepare("UPDATE retrieval_results SET valid_until = datetime('now') WHERE session_id = ? AND entity = ? AND id != ? AND valid_until IS NULL AND quarantine IS NULL")
        .run(row.session_id, row.entity, id);
    } else {
      this.db.prepare("UPDATE retrieval_results SET quarantine = 'resolved_drop' WHERE id = ?").run(id);
      // dropped memories leave no entity-graph residue.
      this.db.prepare("DELETE FROM memory_entity WHERE memory_id = ?").run(id);
    }
    return { ok: true };
  }

  close(): void {
    this.db.close();
  }
}
