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

// PROTOTYPE (real-model correction check): a single contradicting material may
// only replace existing knowledge when a checker confirms it is about the SAME
// fact and is itself reliable enough. The seam is supplied by the caller; without
// it the deterministic negation-only behavior stays in place.
export interface ConsolidateVerifyInput {
  oldContent: string;
  summary: string;
  evidence: ConsolidateEvidence[];
}
export interface ConsolidateVerifyVerdict {
  // The material already agrees with what the live knowledge says: no write.
  alreadyCurrent?: boolean;
  sameFact: boolean;
  reliable: boolean;
  relation?: "same" | "correction" | "different" | "unclear";
  reason?: string;
}
export type ConsolidateVerifyFn = (input: ConsolidateVerifyInput) => Promise<ConsolidateVerifyVerdict>;

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
  // Result categories the host reports: skipped = noop + singleEvidenceSkipped
  // + verifyRejected, conflict = fidelity gate rejected the claim or a planned
  // update lost the race to another writer, failure = no summary available.
  skip: number;
  conflict: number;
  // PROTOTYPE (concurrency): an update planned against a live row that another
  // process closed before this writer committed. The write is skipped and
  // reported; two contradictory live conclusions are never left behind.
  staleUpdates: number;
  staleDetails: Array<{ entity?: string; oldId: number; expected: string; current: string | null; candidate?: string }>;
  // PROTOTYPE (Q21): conflicts that were re-judged once against the winner's
  // version, and conflicts that stayed unresolved after that one re-read.
  retriedAfterStale: number;
  concurrentConflicts: number;
  // Both sides are handed back: the candidate material + its evidence, and the
  // live row + the episodes that support it. Never "first writer wins" silently.
  conflictDetails: Array<{
    entity: string;
    oldId: number;
    expected: string;
    current: string;
    candidate: string;
    candidateEvidence: ConsolidateEvidence[];
    currentEvidence: ConsolidateEvidence[];
    reason?: string;
    followUp?: string;
  }>;
  // PROTOTYPE (real-model check): single-evidence corrections refused because
  // the check said "different fact", "unclear", or "not reliable enough".
  verifyRejected: number;
  // Accepted corrections keep the checker's verdict, so a caller can see that
  // the write was "same fact / reliable / explicit correction", not a keyword hit.
  verifiedCorrections: Array<{
    oldId: number;
    oldContent: string;
    candidate: string;
    evidence: ConsolidateEvidence[];
    sameFact: boolean;
    reliable: boolean;
    relation?: "same" | "correction" | "different" | "unclear";
    reason?: string;
  }>;
  verifyDetails: Array<{
    oldId: number;
    oldContent: string;
    candidate: string;
    evidence: ConsolidateEvidence[];
    sameFact: boolean;
    reliable: boolean;
    relation?: "same" | "correction" | "different" | "unclear";
    reason?: string;
    followUp?: string;
  }>;
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
  // PROTOTYPE (probe seam): called after the scan/LLM plan and before the write
  // transaction. Lets two real processes prove they both planned against the
  // same old version before either commits.
  planBarrier?: () => Promise<void>;
  // PROTOTYPE: default ON. Set false to reproduce the pre-fix lost-update
  // behavior (two live contradictory rows) in the probe.
  concurrencyGuard?: boolean;
  // PROTOTYPE: default ON. When an UPDATE lands, regenerate the summary with
  // the old knowledge included so uncorrected facts are not dropped.
  preserveOnUpdate?: boolean;
}

// D2/D4 main pipeline: signal-gated cluster scan -> summarize seam -> fidelity gate ->
// deterministic ops quadruple. dryRun runs the identical write path inside a rolled-back
// BEGIN IMMEDIATE transaction, so its counters are an exact prediction of apply.
export async function consolidateMemoryRun(
  db: Database.Database,
  deps: { summarize?: ConsolidateSummarizeFn; classify?: ConsolidateClassifyFn; verify?: ConsolidateVerifyFn } = {},
  opts: ConsolidateOptions = {},
): Promise<ConsolidateReport> {
  const dryRun = opts.dryRun === true;
  const theta = opts.thetaDup ?? THETA_DUP;
  const concurrencyGuard = opts.concurrencyGuard ?? process.env.ANS_PROTOTYPE_CONSOLIDATE_GUARD !== "0";
  const preserveOnUpdate = opts.preserveOnUpdate ?? process.env.ANS_PROTOTYPE_PRESERVE_ON_UPDATE !== "0";
  const report: ConsolidateReport = {
    dryRun, clustersScanned: 0, clustersTriggered: 0, llmUnavailable: 0,
    gateRejected: 0, add: 0, noop: 0, update: 0, embeddingAbsent: 0, singleEvidenceSkipped: 0,
    skip: 0, conflict: 0, staleUpdates: 0, staleDetails: [], retriedAfterStale: 0,
    concurrentConflicts: 0, conflictDetails: [], verifyRejected: 0, verifyDetails: [], verifiedCorrections: [],
    updates: [], retiredEpisodeIds: [], summariesNeedingRefresh: [], semanticIds: [],
  };

  // One planned cluster. Kept as data (not a closure) so a lost write race can
  // be re-read and re-judged once from the winner's version without
  // re-summarizing (and re-paying for) the whole run.
  interface PlannedCluster {
    entityKey: string;
    evidence: ConsolidateEvidence[];
    epsIds: number[];
    salience: number;
    confidence: number;
    candidate: string;
    finalSummary: string;
    finalEmbBuf: Buffer | null;
    op: ConsolidateOp;
    target: SemanticRow | null;
    singleEvidence: boolean;
  }
  const plans: PlannedCluster[] = [];

  const scopedRows = (entities?: string[]): EpisodeRow[] => {
    const scope: string[] = [];
    const params: Array<string | number> = [];
    if (opts.memoryIds && opts.memoryIds.length > 0) {
      scope.push("id IN (" + opts.memoryIds.map(() => "?").join(", ") + ")");
      params.push(...opts.memoryIds);
    } else if (opts.sessionIds && opts.sessionIds.length > 0) {
      scope.push("session_id IN (" + opts.sessionIds.map(() => "?").join(", ") + ")");
      params.push(...opts.sessionIds);
    }
    if (entities && entities.length > 0) {
      scope.push("entity IN (" + entities.map(() => "?").join(", ") + ")");
      params.push(...entities);
    }
    return db
      .prepare(
        "SELECT id, entity, title, snippet, url, created_at, last_accessed, access_count " +
          "FROM retrieval_results WHERE entity IS NOT NULL " +
          "AND quarantine IS NULL AND archived = 0 " +
          (scope.length > 0 ? "AND " + scope.join(" AND ") + " " : "") +
          "ORDER BY entity, id",
      )
      .all(...params) as EpisodeRow[];
  };

  const parseSources = (raw: string): number[] => {
    try {
      const ids = JSON.parse(raw) as unknown;
      return Array.isArray(ids) ? ids.filter((id): id is number => Number.isInteger(id)) : [];
    } catch {
      return [];
    }
  };

  const liveRows = (): SemanticRow[] =>
    db.prepare("SELECT id, content, source_episode_ids, embedding FROM semantic_memories WHERE valid_until IS NULL").all() as SemanticRow[];

  // The nearest live claim for a candidate; cosine when both embeddings exist,
  // jaccard otherwise. Mirrors the initial plan so a retry judges the same way.
  const bestLiveFor = (candidate: string, embBuf: Buffer | null): { row: SemanticRow | null; cos: number | null; jac: number } => {
    const emb = embBuf ? new Float32Array(embBuf.buffer, embBuf.byteOffset, embBuf.byteLength / 4) : null;
    const tokens = tokenize(candidate);
    let best: SemanticRow | null = null;
    let bestCos = 0;
    let bestJac = 0;
    let sawCos = false;
    for (const live of liveRows()) {
      const jac = jaccard(tokens, tokenize(live.content));
      let cos = 0;
      if (emb && live.embedding) {
        cos = cosineSimilarity(emb, blobToFloat32(live.embedding));
        sawCos = true;
      }
      if (cos > bestCos || (cos === bestCos && jac > bestJac)) {
        best = live; bestCos = cos; bestJac = jac;
      }
    }
    return { row: best, cos: sawCos ? bestCos : null, jac: bestJac };
  };

  const insertCluster = (c: PlannedCluster, extraSources: number[] = [], content = c.finalSummary, buffer = c.finalEmbBuf): number => {
    const src = Array.from(new Set([...c.epsIds, ...extraSources])).sort((a, b) => a - b);
    const info = db
      .prepare("INSERT INTO semantic_memories (content, source_episode_ids, salience, confidence, embedding) VALUES (?, ?, ?, ?, ?)")
      .run(content, JSON.stringify(src), c.salience, c.confidence, buffer);
    const id = Number(info.lastInsertRowid);
    report.semanticIds.push(id);
    return id;
  };

  const currentEvidenceFor = (sourceEpisodeIds: string): ConsolidateEvidence[] => {
    const ids = parseSources(sourceEpisodeIds);
    if (ids.length === 0) return [];
    const rows = db
      .prepare("SELECT title, snippet, url FROM retrieval_results WHERE id IN (" + ids.map(() => "?").join(", ") + ") ORDER BY id")
      .all(...ids) as Array<{ title: string | null; snippet: string | null; url: string }>;
    return rows.map((r) => ({ title: r.title ?? "", snippet: r.snippet ?? "", url: r.url }));
  };

  const pushConflict = (c: PlannedCluster, current: string, reason?: string, currentEvidence: ConsolidateEvidence[] = []): void => {
    report.concurrentConflicts++;
    report.conflictDetails.push({
      entity: c.entityKey,
      oldId: c.target?.id ?? 0,
      expected: c.target?.content ?? "",
      current,
      candidate: c.candidate,
      candidateEvidence: c.evidence,
      currentEvidence,
      ...(reason ? { reason } : {}),
      followUp: "两边材料互相冲突且无法判定哪边更新；未覆盖任何一边，请调用方人工核实后再决定。",
    });
  };

  const plan = async (): Promise<void> => {
    // Cluster scan INCLUDES superseded rows (valid_until NOT NULL): same-entity writes soft-close
    // the prior version immediately, so episodic history *is* the closed-row set.
    const rows = scopedRows();
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
    for (const [entityKey, eps] of byEntity) {
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
      //
      // PROTOTYPE: for a verifier-backed single-evidence correction the gate is
      // circular: the summary states the correction, and the same evidence also
      // carries the negation, which the claim-level contradiction rule can read
      // as counter-evidence depending on how the model splits sentences. The
      // real-model checker (same fact + reliable) is the gate for that path.
      let confidence = LOW_CONFIDENCE;
      const verifierBackedSingle = singleEvidence && deps.verify !== undefined;
      if (verifierBackedSingle) confidence = 0.85;
      if (deps.classify && !verifierBackedSingle) {
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

      const lives = liveRows();
      const bestCandidate = bestLiveFor(summary, embBuf);
      const best = bestCandidate.row;
      const bestCos = bestCandidate.cos;
      const bestJac = bestCandidate.jac;
      let sawCos = bestCos !== null;
      // Degraded-path accounting: a dedup decision ran without any cosine signal.
      if (!sawCos && lives.length > 0) report.embeddingAbsent++;

      // Polarity matters: a correction that restates the same negation as the
      // existing claim is not a contradiction. Only disagreement updates.
      const contradiction = best
        ? CONTRADICTION_RE.test(summary) !== CONTRADICTION_RE.test(best.content)
        : false;
      let op: ConsolidateOp = best ? decideOp(bestCos, bestJac, contradiction, theta) : "add";
      if (singleEvidence) {
        // One episode may correct an existing memory; it may not create new
        // knowledge and does not count as a duplicate touch.
        if (!best) { report.singleEvidenceSkipped++; continue; }
        // PROTOTYPE: negation alone cannot tell "same fact, now corrected" from
        // "different subject/period mentioning a negation", cannot recognise a
        // positive restatement of a changed fact, and cannot tell a confident
        // official update from hearsay. When the caller supplies the checker,
        // it makes that call; without it the old negation-only rule stays.
        const reject = (verdict?: ConsolidateVerifyVerdict): void => {
          report.verifyRejected++;
          const followUp = verdict?.relation === "different"
            ? "与旧结论可能是不同对象/时段/范围，不能当成纠正；旧结论保留，请调用方核实对应关系。"
            : verdict?.relation === "unclear"
              ? "新资料与旧结论是否同一事实无法确定；旧结论保留，请调用方人工核实。"
              : "新资料未被判定为同一事实且可靠；旧结论保留，请调用方人工核实。";
          report.verifyDetails.push({
            oldId: best!.id, oldContent: best!.content, candidate: summary, evidence,
            sameFact: verdict?.sameFact ?? false, reliable: verdict?.reliable ?? false,
            ...(verdict?.relation ? { relation: verdict.relation } : {}),
            ...(verdict?.reason ? { reason: verdict.reason } : {}),
            followUp,
          });
        };
        if (deps.verify) {
          const verdict = await deps.verify({ oldContent: best.content, summary, evidence });
          const alreadyCurrent = verdict.alreadyCurrent === true
            || verdict.relation === "same"
            || summary.trim() === best.content.trim();
          if (alreadyCurrent) {
            op = "noop";
          } else if (!verdict.sameFact || !verdict.reliable || verdict.relation === "different" || verdict.relation === "unclear") {
            reject(verdict);
            continue;
          } else {
            op = "update";
            report.verifiedCorrections.push({
              oldId: best.id, oldContent: best.content, candidate: summary, evidence,
              sameFact: verdict.sameFact, reliable: verdict.reliable,
              ...(verdict.relation ? { relation: verdict.relation } : {}),
              ...(verdict.reason ? { reason: verdict.reason } : {}),
            });
          }
        } else if (!contradiction) {
          report.singleEvidenceSkipped++;
          continue;
        } else {
          op = "update";
        }
      }

      // PROTOTYPE: an UPDATE replaces the old distilled claim. Regenerate it
      // with the old knowledge in the evidence so facts the new material did
      // not correct are carried over instead of silently dropped.
      let finalSummary = summary;
      let finalEmbBuf = embBuf;
      if (best && op === "update" && preserveOnUpdate && deps.summarize) {
        const currentKnowledge: ConsolidateEvidence = {
          title: "CURRENT KNOWLEDGE",
          snippet: best.content,
          url: "knowledge://semantic/" + best.id,
        };
        const mergeEvidence = [...evidence, currentKnowledge];
        try {
          const merged = await deps.summarize(mergeEvidence);
          if (merged && merged.trim()) {
            // The merged text now carries old facts too, so re-run the fidelity
            // gate against both the new materials and the current knowledge.
            let mergedRejected = false;
            if (deps.classify && !(singleEvidence && deps.verify)) {
              for (const claim of splitClaims(merged)) {
                if (deps.classify(claim, mergeEvidence).label === "unsupported") { mergedRejected = true; break; }
              }
            }
            if (mergedRejected) { report.gateRejected++; continue; }
            const mergedEmb = await embedText(merged, "passage");
            finalSummary = merged.trim();
            finalEmbBuf = mergedEmb ? Buffer.from(mergedEmb.buffer, mergedEmb.byteOffset, mergedEmb.byteLength) : null;
          }
        } catch { /* keep the initial summary: a merge fault must not block the correction */ }
      }

      plans.push({
        entityKey, evidence, epsIds: eps.map((e) => e.id),
        salience: Math.min(1, 0.4 + 0.1 * eps.length),
        confidence, candidate: summary, finalSummary, finalEmbBuf,
        op, target: best, singleEvidence,
      });
    }
  };

  // Apply one plan inside the caller's write transaction. Returns "stale" when
  // the row it was planned against is no longer the live version: the caller
  // re-reads and re-judges that cluster exactly once.
  const applyPlan = (c: PlannedCluster): "written" | "stale" => {
    if (c.op === "noop") {
      if (!c.target) return "stale";
      if (concurrencyGuard) {
        const live = db.prepare("SELECT content FROM semantic_memories WHERE id = ? AND valid_until IS NULL").get(c.target.id) as { content: string } | undefined;
        if (!live || live.content !== c.target.content) return "stale";
      }
      // D4 NOOP: touch only; the row is a stable anchor for idempotent reruns.
      db.prepare("UPDATE semantic_memories SET access_count = access_count + 1, last_accessed = datetime('now') WHERE id = ?").run(c.target.id);
      report.noop++;
      return "written";
    }
    if (c.op === "update") {
      if (!c.target) return "stale";
      // PROTOTYPE (concurrency): the plan was computed outside the write
      // transaction. Re-check that the row this update targets is still the
      // live version. If another writer closed it first, refuse the write
      // and report the conflict instead of forking a second live truth.
      if (concurrencyGuard) {
        const live = db
          .prepare("SELECT content, source_episode_ids FROM semantic_memories WHERE id = ? AND valid_until IS NULL")
          .get(c.target.id) as { content: string; source_episode_ids: string } | undefined;
        if (!live || live.content !== c.target.content) return "stale";
      }
      const prev = parseSources(c.target.source_episode_ids);
      const newId = insertCluster(c, prev, c.finalSummary, c.finalEmbBuf);
      db.prepare("UPDATE semantic_memories SET valid_until = datetime('now'), superseded_by = ? WHERE id = ?").run(newId, c.target.id);
      if (prev.length > 0) {
        db.prepare(
          "UPDATE retrieval_results SET superseded_by = ? WHERE id IN (" + prev.map(() => "?").join(", ") + ") AND superseded_by IS NULL",
        ).run(newId, ...prev);
      }
      report.updates.push({ oldId: c.target.id, newId, retiredEpisodeIds: prev });
      report.retiredEpisodeIds.push(...prev);
      report.update++;
      return "written";
    }
    insertCluster(c);
    report.add++;
    return "written";
  };

  const recordStale = (c: PlannedCluster, current: string | null): void => {
    report.staleUpdates++;
    report.staleDetails.push({
      entity: c.entityKey, oldId: c.target?.id ?? 0, expected: c.target?.content ?? "",
      current, candidate: c.candidate,
    });
  };

  /**
   * Q21: after losing the write race, read the current live version and judge
   * once more. The candidate may only replace the winner when the checker
   * explicitly calls it a correction of the same fact; "same", "different",
   * "unclear", or a candidate that already matches the winner become a no-op
   * or an unresolved conflict. No third attempt, no silent first-writer-wins.
   */
  const retryConflicts = async (conflicts: PlannedCluster[]): Promise<void> => {
    const retryOps: Array<{ kind: "noop" | "update"; c: PlannedCluster; target: SemanticRow }> = [];
    const seen = new Set<string>();
    for (const c of conflicts) {
      // One re-judge per entity: several planned clusters cannot target the
      // same live row, but a repeated entity must not pay twice.
      const key = c.entityKey + "\u0000" + (c.target?.id ?? 0);
      if (seen.has(key)) continue;
      seen.add(key);
      report.retriedAfterStale++;
      const near = bestLiveFor(c.candidate, c.finalEmbBuf);
      const target = near.row;
      if (!target) {
        pushConflict(c, "");
        continue;
      }
      const sameText = c.candidate.trim() === target.content.trim()
        || c.finalSummary.trim() === target.content.trim()
        || near.jac >= 0.95;
      if (sameText) {
        report.noop++;
        retryOps.push({ kind: "noop", c, target });
        continue;
      }
      if (!deps.verify) {
        // No checker: the deterministic rule may still update on a contradiction,
        // but the candidate never gets to overwrite an unflagged competing claim.
        const contradiction = CONTRADICTION_RE.test(c.candidate) !== CONTRADICTION_RE.test(target.content);
        if (contradiction && near.jac > 0.4) {
          retryOps.push({ kind: "update", c, target });
        } else {
          pushConflict(c, target.content, "无校验器：保留了原结论", currentEvidenceFor(target.source_episode_ids));
        }
        continue;
      }
      const verdict = await deps.verify({ oldContent: target.content, summary: c.candidate, evidence: c.evidence });
      if (verdict.alreadyCurrent === true || verdict.relation === "same") {
        report.noop++;
        retryOps.push({ kind: "noop", c, target });
        continue;
      }
      if (verdict.sameFact && verdict.reliable && verdict.relation === "correction") {
        report.verifiedCorrections.push({
          oldId: target.id, oldContent: target.content, candidate: c.candidate, evidence: c.evidence,
          sameFact: verdict.sameFact, reliable: verdict.reliable,
          ...(verdict.relation ? { relation: verdict.relation } : {}),
          ...(verdict.reason ? { reason: verdict.reason } : {}),
        });
        retryOps.push({ kind: "update", c, target });
        continue;
      }
      pushConflict(
        c,
        target.content,
        verdict.reason ?? "再判一次仍无法确定哪边正确",
        currentEvidenceFor(target.source_episode_ids),
      );
    }

    if (retryOps.length === 0) return;
    const updatesBefore = report.updates.length;
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const op of retryOps) {
        if (op.kind === "noop") {
          db.prepare("UPDATE semantic_memories SET access_count = access_count + 1, last_accessed = datetime('now') WHERE id = ? AND valid_until IS NULL").run(op.target.id);
          continue;
        }
        const live = db
          .prepare("SELECT content, source_episode_ids FROM semantic_memories WHERE id = ? AND valid_until IS NULL")
          .get(op.target.id) as { content: string; source_episode_ids: string } | undefined;
        if (!live || live.content !== op.target.content) {
          // Lost again between the re-judge and this write: no third attempt.
          pushConflict(op.c, live?.content ?? "", "重判后写入时又发生变化", currentEvidenceFor(live?.source_episode_ids ?? ""));
          continue;
        }
        const prev = parseSources(live.source_episode_ids);
        const newId = insertCluster(op.c, prev, op.c.finalSummary, op.c.finalEmbBuf);
        db.prepare("UPDATE semantic_memories SET valid_until = datetime('now'), superseded_by = ? WHERE id = ?").run(newId, op.target.id);
        if (prev.length > 0) {
          db.prepare(
            "UPDATE retrieval_results SET superseded_by = ? WHERE id IN (" + prev.map(() => "?").join(", ") + ") AND superseded_by IS NULL",
          ).run(newId, ...prev);
        }
        report.updates.push({ oldId: op.target.id, newId, retiredEpisodeIds: prev });
        report.retiredEpisodeIds.push(...prev);
        report.update++;
      }
      if (report.updates.length > updatesBefore) {
        const retryUpdates = report.updates.slice(updatesBefore);
        report.summariesNeedingRefresh = Array.from(new Set([
          ...report.summariesNeedingRefresh,
          ...markSummariesNeedingRefresh(db, retryUpdates),
        ]));
      }
      db.exec("COMMIT");
    } catch (err) {
      try { db.exec("ROLLBACK"); } catch { /* already rolled back */ }
      throw err;
    }
  };

  if (db.inTransaction) throw new Error("consolidateMemoryRun must not run inside an open transaction");
  await plan();
  // PROTOTYPE (probe seam): both processes have planned against the version
  // they read; only now do they race for the write transaction.
  if (opts.planBarrier) await opts.planBarrier();
  const conflicts: PlannedCluster[] = [];
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const c of plans) {
      if (applyPlan(c) === "stale") {
        recordStale(c, null);
        conflicts.push(c);
      }
    }
    // Runs inside the write txn so a crash cannot commit a correction while
    // leaving its summaries live. dry-run still measures (and rolls back).
    if (report.updates.length > 0) report.summariesNeedingRefresh = markSummariesNeedingRefresh(db, report.updates);
    db.exec(dryRun ? "ROLLBACK" : "COMMIT");
  } catch (err) {
    try { db.exec("ROLLBACK"); } catch { /* already rolled back */ }
    throw err;
  }
  // The one re-read + re-judge happens only after the winner's commit is visible.
  if (!dryRun && conflicts.length > 0) await retryConflicts(conflicts);
  report.skip = report.noop + report.singleEvidenceSkipped + report.verifyRejected;
  report.conflict = report.gateRejected + report.concurrentConflicts;
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
