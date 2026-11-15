// #265 (D10): inspect one legacy summary only when the caller needs it.
import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { unwrapRetrieved } from "@anysearch-cli/retriever";
import { collectTaskRecords, planSummaryRebuild, readStoredMessageText } from "./summary-rebuild.js";
import { parseSummarySourceRefs, type SummarySourceRef } from "./summary-sources.js";

export interface LegacySummaryState {
  anchorId: number;
  evidenceKey: string;
  status: "ready" | "incomplete" | "attempted" | "failed" | "rebuilt";
  sources: SummarySourceRef[];
  reasons: string[];
  newAnchorId: number | null;
  retryAfter: number | null;
}

// Design: only another user-triggered run can retry a failed call, after five
// minutes — this gives a repaired provider a way forward without billing every
// chat turn. It also outlasts the kernel's 90-second background call timeout.
export const LEGACY_SUMMARY_RETRY_DELAY_MS = 5 * 60 * 1000;

/** Read the durable result without starting work or changing the original text. */
export function legacySummaryState(db: Database.Database, sessionId: string, anchorId: number): LegacySummaryState | null {
  const row = db.prepare(
    "SELECT evidence_key, status, sources, reasons, new_anchor_id, retry_after FROM legacy_summary_states WHERE session_id = ? AND anchor_id = ?",
  ).get(sessionId, anchorId) as {
    evidence_key: string; status: LegacySummaryState["status"]; sources: string; reasons: string; new_anchor_id: number | null; retry_after: number | null;
  } | undefined;
  return row ? {
    anchorId, evidenceKey: row.evidence_key, status: row.status,
    sources: parseSummarySourceRefs(JSON.parse(row.sources)), reasons: JSON.parse(row.reasons) as string[],
    newAnchorId: row.new_anchor_id, retryAfter: row.retry_after,
  } : null;
}

/**
 * Design: recovery reads the original tool records, never nearby archive rows —
 * a shared URL or session cannot establish which version the conversation read.
 * These refs belong to the NEW rebuild, not a backfilled claim about the old text.
 * Records in the anchor's own timestamp second are ambiguous (SQLite stored only
 * seconds); those stay incomplete instead of guessing which came first.
 */
function transcriptSources(db: Database.Database, sessionId: string, createdAt: string): {
  sources: SummarySourceRef[]; records: unknown[]; reasons: string[];
} {
  const records = db.prepare(
    "SELECT id, role, content, created_at FROM messages WHERE session_id = ? AND created_at <= ? ORDER BY id",
  ).all(sessionId, createdAt) as Array<{ id: number; role: string; content: string; created_at: string }>;
  const sources: SummarySourceRef[] = [];
  const reasons: string[] = [];
  for (const record of records) {
    if (record.role !== "tool" && record.role !== "toolResult") continue;
    if (record.created_at === createdAt) {
      reasons.push("tool record " + record.id + " and the summary have the same timestamp; their order cannot be verified");
      continue;
    }
    let payload: any;
    try {
      payload = JSON.parse(readStoredMessageText(record.content));
      payload = unwrapRetrieved(payload) ?? payload;
    } catch {
      reasons.push("tool record " + record.id + " has no readable source records");
      continue;
    }
    if (Array.isArray(payload?.results)) {
      for (const item of payload.results) {
        const id: unknown = item?.archiveRowId;
        if (typeof id === "number" && Number.isInteger(id) && id > 0) sources.push({ kind: "material", id });
        else reasons.push("tool record " + record.id + " does not name the exact material version it read");
      }
    } else if (Array.isArray(payload?.internal)) {
      for (const hit of payload.internal) {
        const id: unknown = hit?.rowid;
        if (typeof id === "number" && Number.isInteger(id) && id !== 0) {
          sources.push({ kind: id > 0 ? "material" : "knowledge", id: Math.abs(id) });
        } else reasons.push("tool record " + record.id + " has a recall hit without an exact source id");
      }
    } else {
      reasons.push("tool record " + record.id + " has no supported source record");
    }
  }
  return { sources: parseSummarySourceRefs(sources), records, reasons };
}

/**
 * Prepare ONLY the requested derived summary. Opening a database does no scan,
 * no model work and no rewrite. Existing sourced summaries return null.
 */
export function prepareLegacySummary(db: Database.Database, sessionId: string, anchorId: number): LegacySummaryState | null {
  const inspect = db.transaction((): LegacySummaryState | null => {
    const anchor = db.prepare(
      "SELECT anchor_type, payload, created_at FROM resume_anchors WHERE session_id = ? AND id = ?",
    ).get(sessionId, anchorId) as { anchor_type: string; payload: string; created_at: string } | undefined;
    if (!anchor || (anchor.anchor_type !== "rolling_summary" && anchor.anchor_type !== "l2_recall")) return null;
    let payload: { sources?: unknown } = {};
    try { payload = JSON.parse(anchor.payload) as typeof payload; } catch { /* malformed legacy text stays a lead */ }
    const embedded = parseSummarySourceRefs(payload?.sources);
    const malformed = !!payload && Object.hasOwn(payload, "sources") &&
      (!Array.isArray(payload.sources) || payload.sources.some((ref) => parseSummarySourceRefs([ref]).length !== 1));
    const stored = db.prepare("SELECT source_kind AS kind, source_id AS id FROM summary_sources WHERE anchor_id = ?")
      .all(anchorId) as SummarySourceRef[];
    // Existing writers kept the raw payload but filtered malformed refs before
    // inserting provenance. A nonempty table can therefore still be incomplete.
    const missingDeclared = embedded.some((ref) => !stored.some((row) => row.kind === ref.kind && row.id === ref.id));
    if (stored.length > 0 && !malformed && !missingDeclared) return null;
    // New writers explicitly say sources: [] when they read no addressable
    // material. Absence, not a deliberately empty new-format list, is legacy.
    if (Array.isArray(payload?.sources) && payload.sources.length === 0) return null;
    const transcript = transcriptSources(db, sessionId, anchor.created_at);
    const sources = embedded.length > 0 ? embedded : transcript.sources;
    const reasons = embedded.length > 0 ? [] : [...transcript.reasons];
    if (malformed) {
      reasons.push("the old source list contains unreadable references; the valid subset cannot stand in for the complete list");
    }
    if (anchor.anchor_type !== "rolling_summary") reasons.push("an old recall snippet cannot be rebuilt without its original query and source records");
    // A new question must not stand in for a missing original requirement. Only
    // user records that unambiguously predate this summary qualify as evidence.
    const tasks = collectTaskRecords(db, sessionId);
    if (!tasks.some((r) => r.createdAt < anchor.created_at)) reasons.push("the original user requirement cannot be recovered from records before this summary");
    if (sources.length === 0) reasons.push("the original records do not identify the material versions this summary can be rebuilt from");
    const plan = planSummaryRebuild(db, { sessionId, anchorId }, { sources, reasons });
    const evidenceKey = createHash("sha256").update(JSON.stringify({
      payload: anchor.payload, records: transcript.records, sources,
      facts: plan.facts, replaced: plan.replaced, reasons: plan.reasons,
    })).digest("hex");
    const existing = legacySummaryState(db, sessionId, anchorId);
    // A restart or another turn does not justify another model call. A changed
    // original record/current source version does; the evidence key records why.
    if (existing?.evidenceKey === evidenceKey) {
      if ((existing.status !== "failed" && existing.status !== "attempted") ||
        existing.retryAfter === null || existing.retryAfter > Date.now()) return existing;
      // A killed process left an attempted row behind. Its spend is still
      // unknown, and the audit row stays available when a later run retries.
      db.prepare(`UPDATE legacy_summary_attempts SET outcome = 'interrupted', finished_at = datetime('now')
        WHERE anchor_id = ? AND outcome = 'attempted'`).run(anchorId);
      db.prepare("UPDATE legacy_summary_states SET status = 'ready', reasons = '[]', retry_after = NULL WHERE anchor_id = ?").run(anchorId);
      return { ...existing, status: "ready", reasons: [], retryAfter: null };
    }
    const state: LegacySummaryState = {
      anchorId, evidenceKey, status: plan.complete ? "ready" : "incomplete",
      sources, reasons: plan.reasons, newAnchorId: null, retryAfter: null,
    };
    db.prepare(`INSERT INTO legacy_summary_states (session_id, anchor_id, evidence_key, status, sources, reasons)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(anchor_id) DO UPDATE SET
      evidence_key = excluded.evidence_key, status = excluded.status, sources = excluded.sources,
      reasons = excluded.reasons, new_anchor_id = NULL, retry_after = NULL, updated_at = datetime('now')`).run(
      sessionId, anchorId, evidenceKey, state.status, JSON.stringify(sources), JSON.stringify(state.reasons),
    );
    return state;
  });
  return inspect.immediate();
}

/** Claim one evidence revision before a model call; an interrupted call stays visible. */
export function claimLegacySummary(db: Database.Database, sessionId: string, anchorId: number, evidenceKey: string): boolean {
  return db.transaction(() => {
    const reasons = JSON.stringify(["the previous recovery attempt has not completed; its model cost may be unknown"]);
    const claimed = db.prepare(`UPDATE legacy_summary_states SET status = 'attempted',
      reasons = ?, retry_after = ?, updated_at = datetime('now')
      WHERE session_id = ? AND anchor_id = ? AND evidence_key = ? AND status = 'ready'`).run(
      reasons, Date.now() + LEGACY_SUMMARY_RETRY_DELAY_MS, sessionId, anchorId, evidenceKey,
    ).changes === 1;
    if (claimed) db.prepare(`INSERT INTO legacy_summary_attempts (anchor_id, evidence_key, outcome, reasons)
      VALUES (?, ?, 'attempted', ?)`).run(anchorId, evidenceKey, reasons);
    return claimed;
  }).immediate();
}

/** Keep the failure reason across restarts, without discarding evidence or the old text. */
export function finishLegacySummary(
  db: Database.Database, sessionId: string, anchorId: number, evidenceKey: string,
  result: { outcome: string; reasons: string[]; newAnchorId: number | null; usage?: unknown },
): void {
  const retryable = result.outcome === "generation-failed" || result.outcome === "write-failed";
  const retryAfter = retryable ? Date.now() + LEGACY_SUMMARY_RETRY_DELAY_MS : null;
  const reasons = [...result.reasons];
  if (retryAfter) reasons.push("a new request can retry recovery after " + new Date(retryAfter).toISOString());
  db.transaction(() => {
    db.prepare(`UPDATE legacy_summary_states SET status = ?, reasons = ?, new_anchor_id = ?, retry_after = ?, updated_at = datetime('now')
      WHERE session_id = ? AND anchor_id = ? AND evidence_key = ? AND status = 'attempted'`).run(
      result.outcome === "no-model" ? "ready" : "failed", JSON.stringify(reasons), result.newAnchorId, retryAfter,
      sessionId, anchorId, evidenceKey,
    );
    db.prepare(`UPDATE legacy_summary_attempts SET outcome = ?, reasons = ?, new_anchor_id = ?, usage = ?, finished_at = datetime('now')
      WHERE id = (SELECT id FROM legacy_summary_attempts WHERE anchor_id = ? AND evidence_key = ?
        AND outcome IN ('attempted', 'rebuilt') ORDER BY id DESC LIMIT 1)`).run(
      result.outcome, JSON.stringify(reasons), result.newAnchorId,
      result.usage === undefined ? null : JSON.stringify(result.usage), anchorId, evidenceKey,
    );
  }).immediate();
}
