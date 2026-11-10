// Turn episode records into semantic memories (D2/D4) + reversible active forgetting (D5).
// Deterministic core; LLM only behind injected seams (summarize / classify). Fail-open:
// summarize null or absent -> cluster skipped (llmUnavailable); classify absent -> semantic row
// written at LOW_CONFIDENCE (0.2), never blocks the write.
// atomcode research (r93): dry-run = BEGIN IMMEDIATE + ROLLBACK exact prediction (r87
// pattern); no RETURNING inside a transaction touching FTS5 content tables (better-sqlite3 #654)
// -> inserts use lastInsertRowid.

import type Database from "better-sqlite3";
import { embedText, cosineSimilarity } from "./embedding-arm.js";
import { classifyTier, TAU_TIER } from "./time-decay.js";

export const THETA_DUP = 0.90;           // D4/D7: NOOP boundary; golden boundary case pins <, =, >
// NOOP boundary for the jaccard-only degraded path (embedding absent).
// Calibrated on the golden dataset 2026-09-15: distinct stub summaries jac=0.000, identical
// rerun=1.000, contradiction-pair ceiling=0.714 (update path must stay reachable). 0.80 sits
// inside the conservative band 0.7-0.85 with margin over the 0.714 ceiling.
// NOT the 0.4 update gate: update = bestJac>0.4 AND contradiction; noop-jac = bestJac>0.80
// alone (near-verbatim dup). Lossy by construction — catches lexical dups, misses paraphrase;
// the embedding path remains the dedup authority when present.
export const THETA_JAC = 0.80;
export const LOW_CONFIDENCE = 0.2;       // fidelity-gate absent or uncertain claims
export const CLUSTER_MIN = 3;            // D2: minimum episodes per entity cluster
export const ARCHIVE_AGE_FACTOR = 3;     // D5: age > 3 * tier tau AND access_count = 0 AND stale last_accessed

// Local mirror of kernel attribution.ts CONTRADICTION_RE. Store must not import kernel
// (kernel -> store one-way dependency); keep in sync manually.
const CONTRADICTION_RE = /\b(?:not|never|no longer)\b|(?:\u5E76\u975E|\u6BEB\u65E0|\u5168\u65E0|\u4E0D\u662F|\u4E0D\u542B|\u6CA1[\u6709\u5728]?|\u672A|\u65E0|\u975E(?!\u5E38))/i;

interface EpisodeRow {
  id: number;
  entity: string | null;
  title: string | null;
  snippet: string | null;
  url: string;
  created_at: string;
  last_accessed: string | null;
  access_count: number | null;
}

interface SemanticRow {
  id: number;
  content: string;
  source_episode_ids: string;
  embedding: Buffer | null;
}

export interface ConsolidateEvidence { title: string; snippet: string; url: string; }
export type ConsolidateSummarizeFn = (episodes: ConsolidateEvidence[]) => Promise<string | null>;
export interface ConsolidateClaimVerdict { label: "supported" | "uncertain" | "unsupported"; confidence: number; }
export type ConsolidateClassifyFn = (claim: string, evidence: ConsolidateEvidence[]) => ConsolidateClaimVerdict;

export interface ConsolidateReport {
  dryRun: boolean;
  clustersScanned: number;
  clustersTriggered: number;
  llmUnavailable: number;
  gateRejected: number;
  add: number;
  noop: number;
  update: number;
  // dedup decisions made on the jaccard-only degraded path (no cosine
  // computable — arm absent or no live row carries an embedding). Never silent.
  embeddingAbsent: number;
  // single-evidence episodes that were rejected because they did not
  // contradict anything (a lone episode may correct, never create).
  singleEvidenceSkipped: number;
  // Result categories the host reports: skipped = noop + singleEvidenceSkipped,
  // conflict = fidelity gate rejected the claim, failure = no summary available.
  skip: number;
  conflict: number;
  // Update relations (old live row -> replacement) for traceability.
  updates: Array<{ oldId: number; newId: number; retiredEpisodeIds: number[] }>;
  retiredEpisodeIds: number[];
  // Sessions whose rolling summary was paused because it still carried a
  // corrected fact.
  summariesNeedingRefresh: string[];
  semanticIds: number[];
}

export interface ArchiveCandidate {
  id: number;
  entity: string | null;
  title: string | null;
  url: string;
  createdAt: string;
  lastAccessed: string | null;
  accessCount: number;
  ageDays: number;
  reason: string;
}

export interface ArchiveApplyReport {
  dryRun: boolean;
  requested: number;
  archived: number;
  skipped: number;
  logIds: number[];
  undoableTotal: number;
}

const DAY_MS = 86400000;

// SQLite datetime('now') is UTC "YYYY-MM-DD HH:MM:SS"; Date.parse of the raw string is
// local-time dependent, so normalize to ISO Z before parsing (matches julianday in time-decay).
export function parseSqliteUtc(ts: string): number {
  return Date.parse(ts.replace(" ", "T") + "Z");
}

function tokenize(text: string): Set<string> {
  const m = text.toLowerCase().match(/[a-z0-9]+|[\u4E00-\u9FFF]/g);
  return new Set(m ?? []);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

// Claim splitter: sentence boundaries for latin + CJK punctuation; trivial fragments dropped.
export function splitClaims(summary: string): string[] {
  return summary
    .split(/(?<=[.!?\u3002\uFF01\uFF1F])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 6);
}

export type ConsolidateOp = "add" | "noop" | "update";

// D4/D7 ops-quadruple decision as a pure function so the 0.90 boundary is unit-testable without
// float32 cosine noise (integration covers the real cosine end-to-end).
// bestCos === null marks the degraded path — no cosine was computable (embedding
// arm absent, or no live row carries an embedding). Jaccard becomes the sole dedup signal and
// bestJac > thetaJac decides noop. Ordering mirrors the cosine path: noop before update, so a
// near-verbatim contradiction is still a noop (the 0.714 ceiling is why thetaJac > 0.72).
export function decideOp(bestCos: number | null, bestJac: number, contradiction: boolean, theta = THETA_DUP, thetaJac = THETA_JAC): ConsolidateOp {
  if (bestCos === null ? bestJac > thetaJac : bestCos > theta) return "noop";
  if (bestJac > 0.4 && contradiction) return "update";
  return "add";
}

function blobToFloat32(b: Buffer): Float32Array {
  return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
}

// PROTOTYPE (pi-1.5.1 window): scoped consolidation options.
// - sessionIds / memoryIds restrict WHICH episodes may be summarized.
// - allowSingleEvidence lets one sufficiently reliable contradicting episode
//   correct an existing live semantic memory, bypassing CLUSTER_MIN. Single
//   evidence may only UPDATE, never ADD.
export interface ConsolidateOptions {
  dryRun?: boolean;
  thetaDup?: number;
  limit?: number;
  sessionIds?: string[];
  memoryIds?: number[];
  allowSingleEvidence?: boolean;
}

// D2/D4 main pipeline: signal-gated cluster scan -> summarize seam -> fidelity gate ->
// deterministic ops quadruple. dryRun runs the identical write path inside a rolled-back
// BEGIN IMMEDIATE transaction, so its counters are an exact prediction of apply.
export async function consolidateMemoryRun(
  db: Database.Database,
  deps: { summarize?: ConsolidateSummarizeFn; classify?: ConsolidateClassifyFn } = {},
  opts: ConsolidateOptions = {},
): Promise<ConsolidateReport> {
  const dryRun = opts.dryRun === true;
  const theta = opts.thetaDup ?? THETA_DUP;
  const report: ConsolidateReport = {
    dryRun, clustersScanned: 0, clustersTriggered: 0, llmUnavailable: 0,
    gateRejected: 0, add: 0, noop: 0, update: 0, embeddingAbsent: 0, singleEvidenceSkipped: 0,
    skip: 0, conflict: 0, updates: [], retiredEpisodeIds: [], summariesNeedingRefresh: [], semanticIds: [],
  };

  // plan phase (scan + LLM summarize + classify + dedup) runs WITHOUT the
  // write lock; only the collected ops run inside BEGIN IMMEDIATE. Same op order and counters,
  // so the dry-run exact-prediction contract is unchanged (Bacon P2).
  const writes: Array<() => void> = [];
  const plan = async (): Promise<void> => {
    // Cluster scan INCLUDES superseded rows (valid_until NOT NULL): same-entity writes soft-close
    // the prior version immediately, so episodic history *is* the closed-row set.
    const scope: string[] = [];
    const scopeParams: Array<string | number> = [];
    if (opts.memoryIds && opts.memoryIds.length > 0) {
      scope.push("id IN (" + opts.memoryIds.map(() => "?").join(", ") + ")");
      scopeParams.push(...opts.memoryIds);
    } else if (opts.sessionIds && opts.sessionIds.length > 0) {
      scope.push("session_id IN (" + opts.sessionIds.map(() => "?").join(", ") + ")");
      scopeParams.push(...opts.sessionIds);
    }
    const rows = db
      .prepare(
        "SELECT id, entity, title, snippet, url, created_at, last_accessed, access_count " +
          "FROM retrieval_results WHERE entity IS NOT NULL " +
          "AND quarantine IS NULL AND archived = 0 " +
          (scope.length > 0 ? "AND " + scope[0] + " " : "") +
          "ORDER BY entity, id",
      )
      .all(...scopeParams) as EpisodeRow[];

    const byEntity = new Map<string, EpisodeRow[]>();
    for (const r of rows) {
      const key = r.entity ?? "";
      if (!key) continue;
      const arr = byEntity.get(key) ?? [];
      arr.push(r);
      byEntity.set(key, arr);
    }

    const nowMs = Date.now();
    let processed = 0;
    for (const [, eps] of byEntity) {
      if (opts.limit && processed >= opts.limit) break;
      report.clustersScanned++;
      // Single-evidence correction is an opt-in exception to the batch threshold.
      const singleEvidence = eps.length === 1 && opts.allowSingleEvidence === true;
      if (eps.length < CLUSTER_MIN && !singleEvidence) continue;
      // D2 deterministic trigger: oldest episode past its tier half-life OR low access signal.
      // No LLM scoring at trigger time.
      const oldest = eps[0];
      const tau = TAU_TIER[classifyTier(oldest.title ?? "", oldest.url ?? "")];
      const ageDays = (nowMs - parseSqliteUtc(oldest.created_at)) / DAY_MS;
      const avgAccess = eps.reduce((a, e) => a + (e.access_count ?? 0), 0) / eps.length;
      if (!(ageDays > tau || avgAccess <= 1)) continue;
      report.clustersTriggered++;
      processed++;

      // Summarize seam (fail-open): absent seam or null result -> skip cluster entirely.
      if (!deps.summarize) { report.llmUnavailable++; continue; }
      const evidence: ConsolidateEvidence[] = eps.map((e) => ({
        title: e.title ?? "", snippet: e.snippet ?? "", url: e.url ?? "",
      }));
      const summary = await deps.summarize(evidence);
      if (!summary || summary.trim().length === 0) { report.llmUnavailable++; continue; }

      // D4 fidelity gate (kernel classifyClaim shape, injected). Row verdict = worst claim:
      // any unsupported -> reject the whole consolidation; any uncertain -> LOW_CONFIDENCE row.
      let confidence = LOW_CONFIDENCE;
      if (deps.classify) {
        let rejected = false;
        let uncertain = false;
        let minConf = 1;
        for (const claim of splitClaims(summary)) {
          const v = deps.classify(claim, evidence);
          if (v.label === "unsupported") { rejected = true; break; }
          if (v.label === "uncertain") uncertain = true;
          minConf = Math.min(minConf, v.confidence);
        }
        if (rejected) { report.gateRejected++; continue; }
        confidence = uncertain ? LOW_CONFIDENCE : minConf;
      }

      // Embedding seam (fail-open): NULL embedding still inserts; dedup falls back to jaccard
      // (: that fallback now decides noop via THETA_JAC — see decideOp).
      const emb = await embedText(summary, "passage");
      const embBuf = emb ? Buffer.from(emb.buffer, emb.byteOffset, emb.byteLength) : null;

      const lives = db
        .prepare("SELECT id, content, source_episode_ids, embedding FROM semantic_memories WHERE valid_until IS NULL")
        .all() as SemanticRow[];
      let best: SemanticRow | null = null;
      let bestCos = 0;
      let bestJac = 0;
      let sawCos = false; // at least one cosine actually computed this scan
      const sumTokens = tokenize(summary);
      for (const l of lives) {
        const jac = jaccard(sumTokens, tokenize(l.content));
        let cos = 0;
        if (emb && l.embedding) { cos = cosineSimilarity(emb, blobToFloat32(l.embedding)); sawCos = true; }
        if (cos > bestCos || (cos === bestCos && jac > bestJac)) {
          best = l; bestCos = cos; bestJac = jac;
        }
      }
      // Degraded-path accounting: a dedup decision ran without any cosine signal.
      if (!sawCos && lives.length > 0) report.embeddingAbsent++;

      const salience = Math.min(1, 0.4 + 0.1 * eps.length);
      const epsIds = eps.map((e) => e.id);
      const insert = (extraSources: number[] = []): number => {
        const src = Array.from(new Set([...epsIds, ...extraSources])).sort((a, b) => a - b);
        const info = db
          .prepare("INSERT INTO semantic_memories (content, source_episode_ids, salience, confidence, embedding) VALUES (?, ?, ?, ?, ?)")
          .run(summary, JSON.stringify(src), salience, confidence, embBuf);
        const id = Number(info.lastInsertRowid);
        report.semanticIds.push(id);
        return id;
      };

      const contradiction = best
        ? CONTRADICTION_RE.test(summary) || CONTRADICTION_RE.test(best.content)
        : false;
      let op = best ? decideOp(sawCos ? bestCos : null, bestJac, contradiction, theta) : "add";
      if (singleEvidence) {
        // One episode may correct an existing memory; it may not create new
        // knowledge and does not count as a duplicate touch.
        if (!best || !contradiction) { report.singleEvidenceSkipped++; continue; }
        op = "update";
      }
      if (best && op === "noop") {
        // D4 NOOP: touch only; the row is a stable anchor for idempotent reruns.
        const row = best;
        writes.push(() => {
          db.prepare("UPDATE semantic_memories SET access_count = access_count + 1, last_accessed = datetime('now') WHERE id = ?").run(row.id);
          report.noop++;
        });
      } else if (best && op === "update") {
        // D4 UPDATE: high-overlap contradiction -> soft-close old row, write new, union sources.
        // Correction propagation: the old row names its successor, and the
        // episodes that supported the old fact are marked superseded so current
        // recall stops presenting them. They stay in the archive (traceable).
        const row = best;
        writes.push(() => {
          let prev: number[] = [];
          try { prev = JSON.parse(row.source_episode_ids) as number[]; } catch { prev = []; }
          const newId = insert(prev);
          db.prepare("UPDATE semantic_memories SET valid_until = datetime('now'), superseded_by = ? WHERE id = ?").run(newId, row.id);
          if (prev.length > 0) {
            db.prepare(
              "UPDATE retrieval_results SET superseded_by = ? WHERE id IN (" + prev.map(() => "?").join(", ") + ") AND superseded_by IS NULL",
            ).run(newId, ...prev);
          }
          report.updates.push({ oldId: row.id, newId, retiredEpisodeIds: prev });
          report.retiredEpisodeIds.push(...prev);
          report.update++;
        });
      } else {
        writes.push(() => {
          insert();
          report.add++;
        });
      }
    }
  };

  if (db.inTransaction) throw new Error("consolidateMemoryRun must not run inside an open transaction");
  await plan();
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const w of writes) w();
    // Runs inside the write txn so a crash cannot commit a correction while
    // leaving its summaries live. dry-run still measures (and rolls back).
    if (report.updates.length > 0) report.summariesNeedingRefresh = markSummariesNeedingRefresh(db, report.updates);
    db.exec(dryRun ? "ROLLBACK" : "COMMIT");
  } catch (err) {
    try { db.exec("ROLLBACK"); } catch { /* already rolled back */ }
    throw err;
  }
  report.skip = report.noop + report.singleEvidenceSkipped;
  report.conflict = report.gateRejected;
  return report;
}

// Share of the superseded fact's own tokens that still appear in a summary.
// Containment, not jaccard: the summary is much longer than one fact, so a
// jaccard threshold would never reach a rolled-up session summary. A summary
// that still carries half the old claim is treated as affected.
export const REFRESH_OVERLAP = 0.5;

// Correction propagation, summary side: pause every rolling summary (and the
// recall digest built from the same materials) that still carries the
// superseded fact. The pause is an append-only anchor_status row (latest per
// session and target wins), so nothing is rewritten or deleted and the full
// history stays queryable.
const REFRESH_TARGETS = ["rolling_summary", "l2_recall"] as const;

export function markSummariesNeedingRefresh(
  db: Database.Database,
  updates: Array<{ oldId: number; newId: number; retiredEpisodeIds: number[] }>,
  opts: { minOverlap?: number } = {},
): string[] {
  if (updates.length === 0) return [];
  const minOverlap = opts.minOverlap ?? REFRESH_OVERLAP;
  const latest: Array<{ session_id: string; anchor_type: string; text: string }> = [];
  for (const target of REFRESH_TARGETS) {
    const rows = db
      .prepare(
        "SELECT session_id, payload FROM resume_anchors WHERE anchor_type = ? AND id IN (" +
          "SELECT MAX(id) FROM resume_anchors WHERE anchor_type = ? GROUP BY session_id)",
      )
      .all(target, target) as Array<{ session_id: string; payload: string }>;
    for (const row of rows) {
      try {
        const payload = JSON.parse(row.payload) as { summary?: unknown; hits?: unknown };
        const text = typeof payload?.summary === "string" ? payload.summary : typeof payload?.hits === "string" ? payload.hits : "";
        if (text) latest.push({ session_id: row.session_id, anchor_type: target, text });
      } catch { /* skip a malformed anchor */ }
    }
  }
  if (latest.length === 0) return [];
  const getContent = db.prepare("SELECT content FROM semantic_memories WHERE id = ?");
  const insertStatus = db.prepare("INSERT INTO resume_anchors (session_id, anchor_type, payload) VALUES (?, 'anchor_status', ?)");
  const marked = new Map<string, { overlap: number; oldId: number; newId: number }>();
  for (const u of updates) {
    const row = getContent.get(u.oldId) as { content: string } | undefined;
    if (!row?.content) continue;
    const oldTokens = tokenize(row.content);
    if (oldTokens.size === 0) continue;
    for (const anchor of latest) {
      const sumTokens = tokenize(anchor.text);
      let shared = 0;
      for (const t of oldTokens) if (sumTokens.has(t)) shared++;
      const overlap = shared / oldTokens.size;
      if (overlap < minOverlap) continue;
      const key = anchor.session_id + "\u0000" + anchor.anchor_type;
      const prev = marked.get(key) as { overlap: number; oldId: number; newId: number } | undefined;
      if (prev && prev.overlap >= overlap) continue;
      marked.set(key, { overlap, oldId: u.oldId, newId: u.newId });
    }
  }
  const sessions = new Set<string>();
  for (const [key, info] of marked) {
    const [sessionId, target] = key.split("\u0000");
    insertStatus.run(
      sessionId,
      JSON.stringify({
        target,
        needsRefresh: true,
        invalidatedBy: info.newId,
        oldSemanticId: info.oldId,
        overlap: Number(info.overlap.toFixed(3)),
        markedAt: new Date().toISOString(),
      }),
    );
    sessions.add(sessionId);
  }
  return [...sessions];
}

// D5 deterministic candidate scan: live, non-pinned, non-quarantined rows whose age exceeds
// factor * tier tau, with zero accesses and last_accessed stale (or never accessed).
export function scanArchiveCandidates(
  db: Database.Database,
  opts: { ageFactor?: number; now?: number; limit?: number } = {},
): ArchiveCandidate[] {
  const factor = opts.ageFactor ?? ARCHIVE_AGE_FACTOR;
  const nowMs = opts.now ?? Date.now();
  const rows = db
    .prepare(
      "SELECT id, entity, title, snippet, url, created_at, last_accessed, access_count " +
        "FROM retrieval_results WHERE archived = 0 AND valid_until IS NULL AND quarantine IS NULL " +
        "AND COALESCE(pinned, 0) = 0 ORDER BY id",
    )
    .all() as EpisodeRow[];
  const out: ArchiveCandidate[] = [];
  for (const r of rows) {
    const tier = classifyTier(r.title ?? "", r.url ?? "");
    const tau = TAU_TIER[tier];
    const ageDays = (nowMs - parseSqliteUtc(r.created_at)) / DAY_MS;
    const access = r.access_count ?? 0;
    if (!(ageDays > factor * tau)) continue;
    if (access > 0) continue;
    const laMs = r.last_accessed ? parseSqliteUtc(r.last_accessed) : null;
    if (laMs !== null && (nowMs - laMs) / DAY_MS <= tau) continue;
    out.push({
      id: r.id, entity: r.entity, title: r.title, url: r.url,
      createdAt: r.created_at, lastAccessed: r.last_accessed, accessCount: access,
      ageDays: Math.round(ageDays * 10) / 10,
      reason: "tier=" + tier + " tau=" + String(tau) + " age=" + (Math.round(ageDays * 10) / 10) + "d access=0 lastAccessed=" + (r.last_accessed ?? "never"),
    });
    if (opts.limit && out.length >= opts.limit) break;
  }
  return out;
}

// D5 apply: snapshot + archived=1 per row. dryRun runs identical writes in a rolled-back
// transaction (same exact-prediction contract as consolidate); report.logIds are then advisory.
export function applyArchive(
  db: Database.Database,
  ids?: number[],
  opts: { dryRun?: boolean } = {},
): ArchiveApplyReport {
  const dryRun = opts.dryRun === true;
  const targets = ids ?? scanArchiveCandidates(db).map((c) => c.id);
  const report: ArchiveApplyReport = { dryRun, requested: targets.length, archived: 0, skipped: 0, logIds: [], undoableTotal: 0 };
  const sel = db.prepare("SELECT * FROM retrieval_results WHERE id = ?");
  const upd = db.prepare("UPDATE retrieval_results SET archived = 1 WHERE id = ? AND archived = 0");
  const ins = db.prepare("INSERT INTO archive_log (memory_id, snapshot, reason) VALUES (?, ?, ?)");
  if (db.inTransaction) throw new Error("applyArchive must not run inside an open transaction");
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const id of targets) {
      const row = sel.get(id) as Record<string, unknown> | undefined;
      if (!row || row.archived === 1) { report.skipped++; continue; }
      // explicit ids bypass scanArchiveCandidates — enforce pinned / closed / quarantined
      // exclusions at the force point too (Bacon P2). Scan path never reaches this (already excluded).
      if (row.pinned === 1 || row.valid_until !== null || row.quarantine !== null) { report.skipped++; continue; }
      upd.run(id);
      const info = ins.run(id, JSON.stringify(row), "auto-scan");
      report.logIds.push(Number(info.lastInsertRowid));
      report.archived++;
    }
    const c = db.prepare("SELECT COUNT(*) AS n FROM archive_log WHERE undone_at IS NULL").get() as { n: number };
    report.undoableTotal = c.n;
    db.exec(dryRun ? "ROLLBACK" : "COMMIT");
  } catch (err) {
    try { db.exec("ROLLBACK"); } catch { /* already rolled back */ }
    throw err;
  }
  return report;
}

// D5 undo: restore archived=0 from an active archive_log row and stamp undone_at. Idempotent by
// construction - an already-undone (or missing) log row returns ok:false without touching state.
export function undoArchive(db: Database.Database, logId: number): { ok: boolean; memoryId?: number } {
  const row = db
    .prepare("SELECT id, memory_id FROM archive_log WHERE id = ? AND undone_at IS NULL")
    .get(logId) as { id: number; memory_id: number } | undefined;
  if (!row) return { ok: false };
  const tx = db.transaction(() => {
    db.prepare("UPDATE retrieval_results SET archived = 0 WHERE id = ?").run(row.memory_id);
    db.prepare("UPDATE archive_log SET undone_at = datetime('now') WHERE id = ?").run(row.id);
  });
  tx();
  return { ok: true, memoryId: row.memory_id };
}
