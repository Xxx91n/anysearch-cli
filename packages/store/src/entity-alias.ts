// #277 — cross-script entity correspondence.
//
// Design: cross-script sameness is decided by evidence, never by a score —
// the trigram tiers stay untouched because lowering the threshold to relate
// `Acme` and `甲公司` would merge unrelated objects at the same time. Rejected:
// requiring the Latin name inside the row (drops records that only ever wrote
// the Chinese name), and re-ordering results (the two rows may both lack the
// right object, so order cannot decide anything).
//
// The entity layer already merges spelling variants by character trigram
// similarity. That score is structurally blind between Chinese and Latin
// letters: `acme` vs `甲公司` is 0.000, and no threshold can turn that into a
// decision without also merging unrelated names. So sameness across scripts is
// decided by EVIDENCE, in this order:
//
//   1. an operator wrote the mapping down (TOML config, or `ans entity alias`);
//   2. a material stated it in parentheses — `Acme（甲公司）`;
//   3. a model proposed it. That is only a proposal: it sits in the review queue
//      until a human confirms, because a wrong merge is expensive to undo and
//      cross-language model judgement has a measured error floor.
//
// Two rules this module keeps on purpose:
// - Nothing here merges on a score. The trigram tiers stay exactly as they were.
// - Every alias records why it exists (`detail.evidence`), and every alias can
//   be taken back (`undoAliasRow`), so "why does 甲公司 count as Acme?" always
//   has an answer.
//
// Design: `entities.aliases` stays the only place a resolved alias lives, and
// `entity_merge_log` the only place a decision lives — rejected a parallel
// alias table, because every existing read path already consults those two, and
// a second table would be a second thing to keep in step.
//
// Design: an undetermined record reuses `retrieval_results.quarantine` instead
// of a new column — rejected a new flag, because every recall path already
// filters on that column, so "excluded by default" needs no new filter anywhere
// and cannot be forgotten at a call site.
//
// The row shape is the existing `entity_merge_log`; the kinds are documented in
// schema.sql. `entities.aliases` stays the one place a resolved alias lives, so
// the existing read paths (entity arm, write-path dedup) pick it up unchanged.

import type Database from "better-sqlite3";
import { normalizeEntityName, scriptOf, isCrossScriptPair, extractCrossScriptPairs } from "./entity.js";

/** Why two surface forms are treated as the same object. */
export type AliasEvidence = "declared-config" | "declared-parentheses" | "model" | "manual";

/** How a cross-script pair is stored: applied at once, or waiting for review. */
export const ALIAS_KIND_DECLARED = "declared";
export const ALIAS_KIND_CROSS_SCRIPT = "cross_script";

export interface AliasPairRequest {
  left: string;
  right: string;
  /** Surrounding text, so the judge sees how the two names were used. */
  context?: string;
}

/** One model answer. `null` means "cannot tell" — a refusal, never a pass. */
export interface AliasJudgeVerdict {
  same: boolean | null;
  reason?: string;
}

/**
 * The model seam. `null` verdicts are first-class: the caller must not read a
 * missing answer as "different" and must not read it as "same" either. It marks
 * the record as "object undetermined" instead (see markMemoryUnresolved).
 */
export type AliasJudgeFn = (pairs: AliasPairRequest[]) => Promise<AliasJudgeVerdict[]>;

export interface LiveEntityRow {
  id: number;
  name: string;
  nameNorm: string;
  type: string;
  aliases: string[];
}

export interface AliasRow {
  id: number;
  kind: string;
  sourceName: string;
  targetEntityId: number;
  targetName: string | null;
  evidence: string;
  resolved: string | null;
  undone: number;
  createdAt: string;
}

export interface QueryObjectMatch {
  entityId: number;
  name: string;
  forms: string[];
}

/**
 * What a query's object name resolved to.
 *
 * `none`      the query names no known object: retrieval runs unconstrained.
 * `resolved`  exactly one object. Its surface forms must appear in a knowledge
 *             row for that row to answer this query — this is what stops a
 *             query from returning another company's support email.
 * `ambiguous` two known objects of DIFFERENT scripts both appear, and nothing
 *             says whether they are the same object. That is the case this
 *             ticket refuses to guess: the caller gets "object undetermined"
 *             instead of whichever row happened to rank first.
 */
export type QueryObjectResolution =
  | { kind: "none" }
  | { kind: "resolved"; entityId: number; name: string; forms: string[] }
  | { kind: "ambiguous"; matches: QueryObjectMatch[] };

export function loadLiveEntities(db: Database.Database): LiveEntityRow[] {
  const rows = db
    .prepare("SELECT id, name, name_norm as nameNorm, entity_type as type, aliases FROM entities WHERE valid_until IS NULL")
    .all() as Array<{ id: number; name: string; nameNorm: string; type: string; aliases: string }>;
  return rows.map((r) => {
    let aliases: string[] = [];
    try {
      const parsed = JSON.parse(r.aliases || "[]") as unknown;
      if (Array.isArray(parsed)) aliases = parsed.filter((x): x is string => typeof x === "string");
    } catch {
      // A corrupt aliases blob must not break every read path. Treating it as
      // empty is strictly safer than throwing: the entity still exists, it just
      // matches by its own name.
      aliases = [];
    }
    return { ...r, aliases };
  });
}

/** Every string that names this entity: its own normalized name plus aliases. */
export function entityForms(e: LiveEntityRow): string[] {
  return Array.from(new Set([e.nameNorm, ...e.aliases])).filter(Boolean);
}

export function findEntityForForm(live: readonly LiveEntityRow[], norm: string): LiveEntityRow | undefined {
  return live.find((e) => e.nameNorm === norm || e.aliases.includes(norm));
}

/**
 * Append one normalized alias. Returns false when it was already there.
 *
 * One statement, not read-then-write: two writers declaring different aliases on
 * the same entity at once would each read the same array and the second UPDATE
 * would drop the first one's alias. `json_each` guards the duplicate check and
 * `json_insert` does the append inside the same statement, so the row is never
 * read and written in two steps. A row whose aliases blob is not valid JSON
 * (hand-edited, or written by an older build) starts over from an empty array
 * instead of taking the whole entity down with it.
 */
export function appendAlias(db: Database.Database, entityId: number, norm: string): boolean {
  const info = db
    .prepare(
      "UPDATE entities SET aliases = json_insert(" +
      "  CASE WHEN json_valid(aliases) THEN aliases ELSE '[]' END, '$[#]', ?" +
      ") WHERE id = ? AND NOT EXISTS (" +
      "  SELECT 1 FROM json_each(CASE WHEN json_valid(entities.aliases) THEN entities.aliases ELSE '[]' END) WHERE value = ?" +
      ")",
    )
    .run(norm, entityId, norm);
  return Number(info.changes) > 0;
}

/**
 * Remove one normalized alias. Returns false when it was not there.
 *
 * Built in JS from a single read and written back in one UPDATE: SQLite has no
 * JSON array-remove, and the only writer that needs atomicity here is the undo
 * path, which runs in the caller's transaction (`but resolve`, the review
 * confirmation). The read is immediately followed by the write in that same
 * transaction, so no other writer can interleave.
 */
export function removeAlias(db: Database.Database, entityId: number, norm: string): boolean {
  const row = db.prepare("SELECT aliases FROM entities WHERE id = ?").get(entityId) as { aliases: string } | undefined;
  if (!row) return false;
  let aliases: string[] = [];
  try { aliases = JSON.parse(row.aliases || "[]") as string[]; } catch { aliases = []; }
  if (!aliases.includes(norm)) return false;
  db.prepare("UPDATE entities SET aliases = ? WHERE id = ?").run(JSON.stringify(aliases.filter((a) => a !== norm)), entityId);
  return true;
}

/**
 * Record a mapping that is already in force (operator-declared, or stated by a
 * material). `resolved` is written immediately so it never shows up in the
 * pending review queue: there is nothing left for a human to decide.
 */
export function logDeclaredAlias(
  db: Database.Database,
  sourceName: string,
  targetEntityId: number,
  evidence: AliasEvidence,
  extra: Record<string, unknown> = {},
): number {
  const existing = db
    .prepare("SELECT id FROM entity_merge_log WHERE kind = ? AND source_name = ? AND target_entity_id = ? AND undone = 0 LIMIT 1")
    .get(ALIAS_KIND_DECLARED, normalizeEntityName(sourceName), targetEntityId) as { id: number } | undefined;
  if (existing) return existing.id;
  const info = db
    .prepare("INSERT INTO entity_merge_log (kind, source_name, target_entity_id, detail, resolved) VALUES (?, ?, ?, ?, 'confirmed')")
    .run(ALIAS_KIND_DECLARED, normalizeEntityName(sourceName), targetEntityId, JSON.stringify({ evidence, ...extra }));
  return Number(info.lastInsertRowid);
}

/**
 * Queue a model proposal. Deduped on (source, target) so a re-hit raises
 * `hit_count` instead of flooding the queue with the same pair — the same
 * escalation shape the existing candidate band uses.
 */
export function logPendingAlias(
  db: Database.Database,
  sourceName: string,
  targetEntityId: number,
  detail: Record<string, unknown>,
): number {
  const norm = normalizeEntityName(sourceName);
  const existing = db
    .prepare("SELECT id FROM entity_merge_log WHERE kind = ? AND source_name = ? AND target_entity_id = ? AND resolved IS NULL AND undone = 0 LIMIT 1")
    .get(ALIAS_KIND_CROSS_SCRIPT, norm, targetEntityId) as { id: number } | undefined;
  if (existing) {
    db.prepare("UPDATE entity_merge_log SET hit_count = hit_count + 1 WHERE id = ?").run(existing.id);
    return existing.id;
  }
  const info = db
    .prepare("INSERT INTO entity_merge_log (kind, source_name, target_entity_id, detail) VALUES (?, ?, ?, ?)")
    .run(ALIAS_KIND_CROSS_SCRIPT, norm, targetEntityId, JSON.stringify({ evidence: "model", ...detail }));
  return Number(info.lastInsertRowid);
}

/**
 * Alias log rows, newest first. `pendingOnly` is the review queue (a model
 * proposal nobody has answered); without it every alias is listed, which is the
 * audit view — "where did this alias come from?".
 */
export function listAliasRows(db: Database.Database, opts: { pendingOnly?: boolean } = {}): AliasRow[] {
  const where = ["l.kind IN (?, ?)", "l.undone = 0"];
  const params: Array<string | number> = [ALIAS_KIND_DECLARED, ALIAS_KIND_CROSS_SCRIPT];
  if (opts.pendingOnly) where.push("l.resolved IS NULL");
  const rows = db
    .prepare(
      "SELECT l.id, l.kind, l.source_name, l.target_entity_id, l.detail, l.resolved, l.undone, l.created_at, e.name AS target_name" +
      " FROM entity_merge_log l LEFT JOIN entities e ON e.id = l.target_entity_id" +
      " WHERE " + where.join(" AND ") + " ORDER BY l.id DESC",
    )
    .all(...params) as Array<{
      id: number; kind: string; source_name: string; target_entity_id: number; detail: string | null;
      resolved: string | null; undone: number; created_at: string; target_name: string | null;
    }>;
  return rows.map((r) => {
    let evidence = "unknown";
    try {
      const d = JSON.parse(r.detail ?? "{}") as { evidence?: unknown };
      if (typeof d.evidence === "string") evidence = d.evidence;
    } catch { /* keep "unknown": an unreadable detail must not invent a reason */ }
    return {
      id: r.id, kind: r.kind, sourceName: r.source_name, targetEntityId: r.target_entity_id,
      targetName: r.target_name, evidence, resolved: r.resolved, undone: r.undone, createdAt: r.created_at,
    };
  });
}

/**
 * Take an alias back: remove it from the entity and stamp the log row undone.
 *
 * This is the undo the ticket asks for. It works for both kinds: an operator who
 * declared the mapping can retract it, and so can the reviewer who confirmed a
 * model proposal. Reads fall back to the previous state on the next lookup
 * because `entities.aliases` is the only thing they consult.
 *
 * Only a record that actually put the alias there may take it out again. A
 * pending proposal never touched `entities.aliases` — undoing it must not remove
 * an alias that some later declaration wrote for the same pair, which would
 * silently break a mapping whose own log still reads `confirmed`.
 */
export function undoAliasRow(db: Database.Database, logId: number): boolean {
  const row = db
    .prepare("SELECT id, kind, source_name, target_entity_id, undone, resolved FROM entity_merge_log WHERE id = ?")
    .get(logId) as {
      id: number; kind: string; source_name: string; target_entity_id: number; undone: number; resolved: string | null;
    } | undefined;
  if (!row || row.undone !== 0) return false;
  if (row.kind !== ALIAS_KIND_DECLARED && row.kind !== ALIAS_KIND_CROSS_SCRIPT && row.kind !== "alias") return false;
  // A cross_script row is a PROPOSAL until it is confirmed. While `resolved` is
  // NULL it never applied anything, so undoing it only drops the proposal.
  const applied = row.kind !== ALIAS_KIND_CROSS_SCRIPT || row.resolved === "confirmed";
  if (applied) removeAlias(db, row.target_entity_id, normalizeEntityName(row.source_name));
  db.prepare("UPDATE entity_merge_log SET undone = 1 WHERE id = ?").run(logId);
  return true;
}

/**
 * Which known object does this query name?
 *
 * A Latin form matches on a word boundary ("acme" must not match "acmes"),
 * a Han form matches as a substring (Chinese has no spaces, so boundary
 * matching would never fire). Anything shorter than 2 characters is skipped:
 * it would attribute text to an object on almost no evidence.
 */
export function formAppearsInText(text: string, form: string): boolean {
  const f = form.trim().toLowerCase();
  if (f.length < 2) return false;
  const hay = text.toLowerCase();
  if (!hay.includes(f)) return false;
  if (scriptOf(f) === "latin") {
    const esc = f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp("(^|[^a-z0-9])" + esc + "([^a-z0-9]|$)").test(hay);
  }
  return true;
}

export function resolveQueryObject(live: readonly LiveEntityRow[], query: string): QueryObjectResolution {
  const matches: QueryObjectMatch[] = [];
  for (const e of live) {
    if (e.type === "url") continue; // a page URL is not a domain object
    const forms = entityForms(e);
    const hit = forms.filter((f) => formAppearsInText(query, f));
    if (hit.length > 0) matches.push({ entityId: e.id, name: e.name, forms });
  }
  if (matches.length === 0) return { kind: "none" };
  if (matches.length === 1) {
    const m = matches[0]!;
    return { kind: "resolved", entityId: m.entityId, name: m.name, forms: m.forms };
  }
  // Several known objects are named. Same-script names are a legitimate
  // multi-object query ("Acme and Globex support emails") and keep the previous
  // unconstrained behaviour. A Han name next to a Latin name is the case this
  // ticket refuses to guess: they may be one object written twice, and nothing
  // in the table says which row of each is the right one.
  const scripts = new Set(matches.map((m) => scriptOf(m.name)));
  if (scripts.has("han") && scripts.has("latin")) return { kind: "ambiguous", matches };
  return { kind: "none" };
}

// Whether a known name could plausibly be an OBJECT name, as opposed to an
// internal key.
//
// The entity table holds two different things. Some rows are objects a reader
// would recognize (`Acme`, `甲公司`); others are technical keys the write path
// created from a caller's `entity` field (`a-support-hours`, `buildzone-rd`).
// Asking "is `a-support-hours` the same object as 甲公司?" is not a question
// anyone asked, and treating it as one marks perfectly good material
// undetermined — the exact regression this guard prevents.
//
// The test is deliberately crude, matching how the keys are produced: a hyphen,
// underscore, dot, scheme or slash means "key, not object name".
export function isLikelyObjectName(form: string): boolean {
  const f = form.trim();
  if (f.length < 2) return false;
  if (/[_\-\/]/.test(f)) return false;
  if (f.includes("://") || f.includes(".")) return false;
  // A long all-lowercase run with no spaces is a slug, not a display name.
  if (!/\s/.test(f) && /^[a-z0-9]+$/.test(f) && f.length > 24) return false;
  return true;
}

// Words that show up inside ordinary Chinese prose and are never an object name
// on their own. A run taken from a sentence ("今日宣布客服邮箱") is description,
// not a name; pairing it with a known Latin object would ask the model a
// question nobody asked and, worse, mark the material undetermined on the
// strength of it.
const HAN_PROSE_WORDS = [
  "公告", "通知", "消息", "页面", "官网", "内容", "相关", "今日", "昨天", "本周", "上月",
  "客服", "邮箱", "电话", "地址", "时间", "服务", "支持", "问题", "说明", "介绍", "更新",
  "宣布", "发布", "转发", "报道", "新闻", "文章", "资料", "信息", "我们", "他们", "它们",
  "公司", "团队", "部门", "产品", "版本", "计划", "项目", "工作", "功能", "系统",
];

/**
 * Whether a Han run could be an object name rather than a piece of a sentence.
 *
 * Chinese has no word boundaries, so the run extractor hands back whatever
 * characters sit between punctuation — often a whole clause. A run is taken as a
 * candidate only when it is short and does not read as prose: up to 6 characters,
 * and not a stock sentence word. This is a filter on what may be ASKED, not on
 * what may be merged — a rejected run simply never becomes a question.
 */
export function isLikelyHanObjectName(run: string): boolean {
  const f = run.trim();
  if (f.length < 2 || f.length > 6) return false;
  if (HAN_PROSE_WORDS.some((w) => f === w)) return false;
  // A run that merely contains a stock word is still prose ("客服邮箱", "官方公告").
  if (HAN_PROSE_WORDS.some((w) => f.includes(w) && f.length > w.length)) return false;
  return true;
}

/**
 * Surface forms that a knowledge row mentions, used by the object constraint.
 * Returns [] when the row names none of them — the row is about something else.
 */
export function objectFormsInText(text: string, forms: readonly string[]): string[] {
  return forms.filter((f) => formAppearsInText(text, f));
}

/** One unresolved record and the object it could not be tied to. */
export interface UnresolvedEntityMemory {
  id: number;
  sessionId: string;
  url: string;
  title: string | null;
  snippet: string | null;
  reason: string;
  createdAt: string;
}

export const UNRESOLVED_ENTITY_MARK = "entity_unresolved";

/**
 * Mark a record whose object could not be determined.
 *
 * It reuses `retrieval_results.quarantine`, which every recall path already
 * filters — so "default excluded" needs no new filter anywhere, and the record
 * is still stored (a streamed material cannot be replayed; dropping it would
 * lose it for good). The review exit below is what keeps the mark from rotting
 * into silent backlog.
 */
export function markMemoryUnresolved(db: Database.Database, memoryId: number, reason: string): void {
  db.prepare("UPDATE retrieval_results SET quarantine = ? WHERE id = ?").run(UNRESOLVED_ENTITY_MARK, memoryId);
  db.prepare("INSERT INTO resume_anchors (session_id, anchor_type, payload) SELECT session_id, 'entity_unresolved', ? FROM retrieval_results WHERE id = ?")
    .run(JSON.stringify({ memoryId, reason }), memoryId);
}

export function listUnresolvedEntityMemories(db: Database.Database): UnresolvedEntityMemory[] {
  const rows = db
    .prepare(
      "SELECT id, session_id, url, title, snippet, created_at FROM retrieval_results" +
      " WHERE quarantine = ? AND archived = 0 ORDER BY created_at DESC",
    )
    .all(UNRESOLVED_ENTITY_MARK) as Array<{ id: number; session_id: string; url: string; title: string | null; snippet: string | null; created_at: string }>;
  return rows.map((r) => ({
    id: r.id, sessionId: r.session_id, url: r.url, title: r.title, snippet: r.snippet,
    // The reason lives in the anchor written by markMemoryUnresolved. Reading it
    // back is what makes the queue actionable; a missing anchor still lists the
    // record rather than hiding it.
    reason: (db
      .prepare("SELECT payload FROM resume_anchors WHERE anchor_type = 'entity_unresolved' AND session_id = ? AND payload LIKE ? ORDER BY id DESC LIMIT 1")
      .get(r.session_id, "%\"memoryId\":" + r.id + "%") as { payload: string } | undefined)?.payload ?? "",
    createdAt: r.created_at,
  }));
}

/**
 * Cross-script pairs a text states or implies.
 *
 * `stated` are pairs the text writes in parentheses (`Acme（甲公司）`) — the
 * material itself claims the two names are one object, so no model is needed.
 * `candidates` are pairs where one side is already a known object and the other
 * is a name in a different script that the table cannot relate to it yet; those
 * need a judgement.
 *
 * A pair the text states is NOT also a candidate. The caller applies it first
 * and would then spend a model call asking about something it has just settled;
 * on a long archive that is one wasted call per stated pair, charged to the
 * session's budget.
 */
export function crossScriptPairsInText(
  text: string,
  live: readonly LiveEntityRow[],
): { stated: Array<{ latin: string; han: string }>; candidates: AliasPairRequest[] } {
  const stated = extractStatedPairs(text);
  const candidates: AliasPairRequest[] = [];
  const seen = new Set<string>();
  // A stated pair is already answered by the material itself.
  for (const pair of stated) {
    seen.add(normalizeEntityName(pair.latin) + "\u0000" + normalizeEntityName(pair.han));
  }
  // Names the entity table already knows, paired against the other script's
  // names found in the same text. Both sides must ACTUALLY appear in the text:
  // pairing a known name with an unrelated Han run because both exist somewhere
  // would invent a question nobody asked, queue it for review, and (worse) mark
  // the material undetermined on the strength of a pair that was never stated.
  const hanRuns = Array.from(text.matchAll(/[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]{2,8}/g)).map((m) => m[0]!);
  const latinRuns = Array.from(text.matchAll(/[A-Za-z][A-Za-z0-9._-]{1,39}/g)).map((m) => m[0]!);
  if (hanRuns.length === 0 || latinRuns.length === 0) return { stated, candidates };
  // A Han run from a sentence is description, not a name. Filtering here keeps
  // ordinary prose ("今日宣布客服邮箱") from becoming a question — and, through
  // that, from marking a perfectly good material undetermined.
  const hanNames = hanRuns.filter(isLikelyHanObjectName);
  const latinNames = latinRuns.filter(isLikelyObjectName);
  if (hanNames.length === 0 || latinNames.length === 0) return { stated, candidates };
  for (const e of live) {
    for (const form of entityForms(e)) {
      if (!isLikelyObjectName(form)) continue;
      if (!formAppearsInText(text, form)) continue; // this object is not mentioned here
      if (scriptOf(form) === "latin") {
        for (const han of hanNames) {
          if (!isCrossScriptPair(form, han)) continue;
          const linked = findEntityForForm(live, normalizeEntityName(han));
          if (linked && linked.id === e.id) continue; // already the same object
          const key = normalizeEntityName(form) + "\u0000" + normalizeEntityName(han);
          if (seen.has(key)) continue;
          seen.add(key);
          candidates.push({ left: form, right: han, context: text.slice(0, 400) });
        }
      } else if (scriptOf(form) === "han") {
        for (const latin of latinNames) {
          if (!isCrossScriptPair(form, latin)) continue;
          const linked = findEntityForForm(live, normalizeEntityName(latin));
          if (linked && linked.id === e.id) continue;
          const key = normalizeEntityName(latin) + "\u0000" + normalizeEntityName(form);
          if (seen.has(key)) continue;
          seen.add(key);
          candidates.push({ left: latin, right: form, context: text.slice(0, 400) });
        }
      }
    }
  }
  return { stated, candidates: candidates.slice(0, 8) }; // bounded: one material cannot queue dozens
}

// Re-exported so callers do not import two modules for one concept.

/**
 * Apply a mapping the text itself states (`Acme（甲公司）`).
 *
 * Both callers (the write-path pass and the consolidation pass) go through this,
 * so the rule for "which entity survives" exists once. They used to compute it
 * separately and had already drifted.
 *
 * `preferred` names the entity the caller would rather keep — the write path
 * passes the entity the material is already linked to, so a row's object does
 * not hop. Otherwise the Latin side wins: it is the form the identity is usually
 * first asserted with, and keeping it avoids re-pointing rows that already
 * exist.
 *
 * When the two names already belong to DIFFERENT live entities, nothing is
 * written and `needsMerge` reports the pair. Appending an alias there would
 * leave both entities live: a later query naming 甲公司 then matches two rows and
 * comes back ambiguous, while the materials already linked stay split across two
 * objects — the exact state this ticket is meant to remove. Merging them here is
 * a destructive redirect that needs a snapshot, so it stays an explicit
 * `ans entity merge` the operator can see and undo.
 *
 * Returns true when an alias was appended.
 */
export function applyStatedPairAsAlias(
  db: Database.Database,
  live: readonly LiveEntityRow[],
  pair: { latin: string; han: string },
  evidence: AliasEvidence,
  detail: Record<string, unknown>,
  preferred?: number,
): { applied: boolean; needsMerge?: { keepId: number; dropId: number } } {
  const latinNorm = normalizeEntityName(pair.latin);
  const hanNorm = normalizeEntityName(pair.han);
  const latinEntity = findEntityForForm(live, latinNorm);
  const hanEntity = findEntityForForm(live, hanNorm);
  if (latinEntity && hanEntity && latinEntity.id === hanEntity.id) return { applied: false }; // already one object
  if (latinEntity && hanEntity) {
    // Two live objects, one claim. Pick which one survives the same way the
    // alias path would, and report it instead of guessing.
    const keep = preferred === hanEntity.id ? hanEntity : (latinEntity ?? hanEntity);
    const drop = keep.id === latinEntity.id ? hanEntity : latinEntity;
    return { applied: false, needsMerge: { keepId: keep.id, dropId: drop.id } };
  }
  let target: LiveEntityRow | undefined;
  if (preferred !== undefined) target = [latinEntity, hanEntity].find((e) => e?.id === preferred);
  target ??= latinEntity ?? hanEntity;
  if (!target) return { applied: false };
  const aliasNorm = target.id === latinEntity?.id ? hanNorm : latinNorm;
  if (!appendAlias(db, target.id, aliasNorm)) return { applied: false };
  logDeclaredAlias(db, aliasNorm, target.id, evidence, { pair, ...detail });
  return { applied: true };
}

/**
 * Queue a model-proposed mapping. Never touches `entities.aliases` — a human
 * confirms it first.
 *
 * Returns false when there is nothing to queue: the pair is already one object,
 * or neither side is a known entity (a proposal needs a target row to land on).
 */
export function queueProposedAlias(
  db: Database.Database,
  live: readonly LiveEntityRow[],
  pair: AliasPairRequest,
  verdict: AliasJudgeVerdict,
  detail: Record<string, unknown> = {},
): boolean {
  const leftEntity = findEntityForForm(live, normalizeEntityName(pair.left));
  const rightEntity = findEntityForForm(live, normalizeEntityName(pair.right));
  if (leftEntity && rightEntity && leftEntity.id === rightEntity.id) return false;
  const target = leftEntity ?? rightEntity;
  if (!target) return false;
  const aliasNorm = leftEntity ? normalizeEntityName(pair.right) : normalizeEntityName(pair.left);
  logPendingAlias(db, aliasNorm, target.id, {
    pair,
    ...(verdict.reason ? { reason: verdict.reason } : {}),
    ...(pair.context ? { context: pair.context.slice(0, 300) } : {}),
    ...detail,
  });
  return true;
}

function extractStatedPairs(text: string): Array<{ latin: string; han: string }> {
  // The parser lives in entity.ts next to the other extraction channels, so
  // there is exactly one place that decides what counts as a stated pair.
  return extractCrossScriptPairs(text);
}
