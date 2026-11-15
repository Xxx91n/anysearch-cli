// #277 — cross-script entity correspondence.
//
// The failure this ticket fixes: a knowledge row says 甲公司's support email,
// the query says "Acme 客服邮箱", and the Chinese LIKE rung matches every row
// containing 客服邮箱 — so the answer is whichever row ranked first, possibly
// another company's email. Character similarity cannot help (acme vs 甲公司 is
// 0.000), so sameness comes from evidence: a declaration, a pair the material
// writes itself, or a model proposal a human confirms.
//
// What is asserted here, in the ticket's own acceptance terms:
//   1. a declared mapping takes effect immediately, with no model call;
//   2. a query naming one object only returns THAT object's rows;
//   3. a model proposal is not applied before confirmation, and is applied after;
//   4. every alias records why it exists, and can be taken back;
//   5. a material whose object cannot be established is stored and marked, not
//      guessed, and has a review exit;
//   6. consolidation clusters Chinese and English material about one object;
//   7. the same-language paths behave exactly as before (no regression).
//
// No test framework (repo convention).

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { SqliteSessionStore } from "../src/session-store";
import {
  scriptOf,
  isCrossScriptPair,
  extractCrossScriptPairs,
  trigramSimilarity,
  normalizeEntityName,
} from "../src/entity";
import type { AliasJudgeVerdict } from "../src/entity-alias";
import { __setExtractorForTest } from "@anysearch-cli/embedding";

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) passed++;
  else { failed++; console.error("FAIL: " + msg); }
}

// No embedding module: every case below has to work without one, exactly like
// the ticket's motivating scenario (the Chinese LIKE rung is the only path).
__setExtractorForTest(async () => ({ data: new Float32Array(16) }));

const dir = mkdtempSync(join(tmpdir(), "ans-277-"));
const stores: SqliteSessionStore[] = [];
function openStore(db: string, opts?: ConstructorParameters<typeof SqliteSessionStore>[1]): SqliteSessionStore {
  const s = new SqliteSessionStore(join(dir, db), opts);
  stores.push(s);
  return s;
}
function q(db: string, sql: string, ...params: unknown[]): any {
  const d = new Database(join(dir, db), { readonly: true });
  try { return d.prepare(sql).get(...params); } finally { d.close(); }
}

// --- 0. the premise: the character layer really cannot relate these ---------
{
  assert(trigramSimilarity("acme", "甲公司") === 0, "premise: acme vs 甲公司 scores 0");
  assert(scriptOf("Acme") === "latin", "scriptOf latin");
  assert(scriptOf("甲公司") === "han", "scriptOf han");
  assert(scriptOf("Acme公司") === "other", "scriptOf mixed");
  assert(isCrossScriptPair("Acme", "甲公司") === true, "cross-script pair");
  assert(isCrossScriptPair("Acme", "Acme Corp") === false, "same-script pair is not cross-script");
  // A pair written in parentheses is a statement, not a guess.
  const pairs = extractCrossScriptPairs("Acme（甲公司）客服邮箱为 help@jia.example。");
  assert(pairs.length === 1 && pairs[0]!.latin === "Acme" && pairs[0]!.han === "甲公司",
    "parenthesised pair extracted: " + JSON.stringify(pairs));
  const rev = extractCrossScriptPairs("甲公司 (Acme) 宣布…");
  assert(rev.length === 1 && rev[0]!.latin === "Acme" && rev[0]!.han === "甲公司",
    "reverse-order pair extracted");
  // Two names merely mentioned together is NOT a stated pair.
  assert(extractCrossScriptPairs("Acme 和 甲公司 是两家公司").length === 0, "co-mention is not a stated pair");
  console.log("0 premise + stated-pair parsing: OK");
}

// --- 1. a declared mapping takes effect at once -----------------------------
{
  const db = "declared.db";
  const store = openStore(db);
  const sess = await store.createSession("eval");
  await store.adjudicateMemory(sess.id, [{
    url: "https://jia.example/support", title: "甲公司客服邮箱", snippet: "甲公司客服邮箱为 help@jia.example。",
    source: "user", evidence: 1, entity: "甲公司",
  }]);

  // Before the declaration the table knows nothing about Acme.
  const before = store.declareEntityAlias.length; void before;
  const r = store.declareEntityAlias("甲公司", "Acme");
  assert(r.ok, "declareEntityAlias succeeds: " + JSON.stringify(r));
  const aliases = q(db, "SELECT aliases FROM entities WHERE id = ?", r.entityId) as { aliases: string };
  assert((JSON.parse(aliases.aliases) as string[]).includes("acme"), "the alias landed on the entity");
  const log = q(db, "SELECT kind, detail, resolved FROM entity_merge_log WHERE id = ?", r.logId) as { kind: string; detail: string; resolved: string | null };
  assert(log.kind === "declared", "logged as kind=declared");
  assert(log.resolved === "confirmed", "a declared mapping is not left in the review queue");
  assert((JSON.parse(log.detail) as { evidence?: string }).evidence === "manual", "evidence names the operator");

  // The declared mapping resolves the query to one object.
  const res = store.resolveQueryObject("Acme 客服邮箱是什么");
  assert(res.kind === "resolved" && res.entityId === r.entityId, "query resolves to the declared object: " + res.kind);
  store.close();
  console.log("1 declared mapping applies at once: OK");
}

// --- 2. the query only gets that object's rows ------------------------------
{
  const db = "gated.db";
  const store = openStore(db);
  const sess = await store.createSession("eval");
  // Two companies, each with a support email, written in Chinese.
  // No declared entity key: the materials carry only their text, like a real
  // archive written through the search path. The object they belong to is then
  // read out of the text by the same pass this ticket adds — which is also what
  // grouping them for consolidation relies on.
  for (let i = 1; i <= 3; i++) {
    await store.adjudicateMemory(sess.id, [
      { url: "https://jia.example/s" + i, title: "甲公司客服邮箱 " + i, snippet: "甲公司客服邮箱为 help@jia.example。", source: "user", evidence: 1 },
      { url: "https://yi.example/s" + i, title: "乙公司客服邮箱 " + i, snippet: "乙公司客服邮箱为 help@yi.example。", source: "user", evidence: 1 },
    ]);
  }
  // Give both companies an entity row each, the way a real archive gets one: a
  // material that declares the object. The other materials then name it only in
  // their text, which is the case the object key has to handle.
  for (const name of ["甲公司", "乙公司"]) {
    await store.adjudicateMemory(sess.id, [{
      url: "https://" + name + ".example/", title: name + "官方页面", snippet: name + "官方页面。",
      source: "user", evidence: 1, entity: name,
    }]);
  }
  assert(store.dbQuery<{ n: number }>("SELECT COUNT(*) n FROM entities WHERE name_norm IN ('甲公司','乙公司') AND valid_until IS NULL")[0]!.n === 2,
    "both objects exist in the entity table");
  // Consolidate each company's materials into one knowledge row. The two
  // summaries share no wording on purpose: on the no-embedding path dedup falls
  // back to token overlap, and two near-identical texts would collapse into one.
  for (const key of ["甲公司", "乙公司"]) {
    const ids = store.dbQuery<{ id: number }>(
      "SELECT id FROM retrieval_results WHERE title LIKE ? ORDER BY id", key + "%",
    ).map((r) => r.id);
    await store.consolidateMemory(
      { scope: { by: "memory", sessionIds: [], memoryIds: ids, sessionIdNotApplied: false } },
      {
        summarize: async () => (key === "甲公司"
          ? "甲公司客服邮箱为 help@jia.example。"
          : "乙公司售后服务热线已变更为 400-000-0000，工作时间另行通知。"),
        classify: () => ({ label: "supported", confidence: 0.95 }),
      },
    );
  }
  assert(store.dbQuery<{ n: number }>("SELECT COUNT(*) n FROM semantic_memories WHERE valid_until IS NULL")[0]!.n === 2,
    "two knowledge rows exist (got " + store.dbQuery<{ n: number }>("SELECT COUNT(*) n FROM semantic_memories WHERE valid_until IS NULL")[0]!.n + ")");

  // Declare that THIS Acme is 甲公司 — the case the ticket says may be either.
  const r = store.declareEntityAlias("Acme", "甲公司");
  assert(r.ok, "declaration ok");

  const hits = await store.searchMemory("Acme 客服邮箱是什么", 20);
  const sem = hits.filter((h) => h.rowid < 0).map((h) => String(h.content));
  assert(sem.some((c) => c.includes("help@jia.example")), "the declared object's email is returned");
  assert(!sem.some((c) => c.includes("400-000-0000")), "the OTHER object's knowledge row is not returned");
  store.close();
  console.log("2 query returns only the resolved object's rows: OK");
}

// --- 2b. the same query with no mapping is reported undetermined ------------
// This is the pre-fix failure: both rows contain 客服邮箱, and 甲公司/乙公司 are
// two known objects while "Acme" names neither. The ticket's rule is "rather
// missing than wrong", so nothing is offered and the reason is reported.
{
  const db = "ambiguous.db";
  const store = openStore(db);
  const sess = await store.createSession("eval");
  await store.adjudicateMemory(sess.id, [
    { url: "https://jia.example/s", title: "甲公司客服邮箱", snippet: "甲公司客服邮箱为 help@jia.example。", source: "user", evidence: 1, entity: "jia-home" },
    { url: "https://yi.example/s", title: "乙公司客服邮箱", snippet: "乙公司客服邮箱为 help@yi.example。", source: "user", evidence: 1, entity: "yi-home" },
  ]);
  // 甲公司 and 乙公司 are known; Acme is not, so the query names no object it
  // can resolve to. Nothing in the table says which row "Acme" belongs to.
  const res = store.resolveQueryObject("Acme 客服邮箱是什么");
  assert(res.kind === "none", "an unknown Latin name resolves to no object (was " + res.kind + ")");
  // A query naming both known objects in the SAME script is a legitimate
  // multi-object question and keeps the old behaviour.
  const both = store.resolveQueryObject("甲乙公司客服邮箱指的是哪家？");
  assert(both.kind !== "ambiguous", "same-script multi-object query is not treated as ambiguous");

  // Now the real ambiguity: a Han object AND a Latin object are both named, and
  // nothing relates them. A separate store on purpose — no judge, and no earlier
  // declaration, so this is the state BEFORE any decision exists. Section 3
  // covers what happens once a model proposal is on the table.
  store.close();
  const ambStore = openStore("ambiguous-mixed.db");
  const ambSess = await ambStore.createSession("eval");
  await ambStore.adjudicateMemory(ambSess.id, [
    { url: "https://jia2.example/s", title: "甲公司客服邮箱", snippet: "甲公司客服邮箱为 help@jia2.example。", source: "user", evidence: 1, entity: "甲公司" },
    { url: "https://acme.example/s", title: "Acme support", snippet: "Acme support email is help@acme.example.", source: "user", evidence: 1, entity: "Acme" },
  ]);
  const mixed = ambStore.resolveQueryObject("Acme 和 甲公司 的客服邮箱");
  assert(mixed.kind === "ambiguous", "a Han name next to a Latin name is ambiguous (was " + mixed.kind + ")");
  const hits = await ambStore.searchMemory("Acme 和 甲公司 的客服邮箱", 20);
  assert(hits.filter((h) => h.rowid < 0).length === 0, "no knowledge row is offered when the object is undetermined");
  ambStore.close();
  console.log("2b undetermined object: nothing offered, not a guess: OK");
}

// --- 3. a model proposal waits for confirmation -----------------------------
{
  const db = "proposed.db";
  let judgeCalls = 0;
  const store = openStore(db, {
    entityAliasJudge: async (pairs) => {
      judgeCalls += 1;
      return pairs.map(() => ({ same: true, reason: "the notice gives both names" } as AliasJudgeVerdict));
    },
  });
  const sess = await store.createSession("eval");
  // 甲公司 exists; Acme does not. The text mentions both without parentheses, so
  // nothing is stated and the model has to be asked.
  await store.adjudicateMemory(sess.id, [{
    url: "https://jia.example/n", title: "甲公司公告", snippet: "甲公司今日发布公告。合作方 Acme 也转发了这条消息。",
    source: "user", evidence: 1, entity: "甲公司",
  }]);
  assert(judgeCalls >= 1, "the judge was consulted (calls=" + judgeCalls + ")");
  const pending = store.listEntityAliases({ pendingOnly: true });
  assert(pending.length >= 1, "a proposal landed in the review queue (got " + pending.length + ")");
  const proposal = pending[0]!;
  assert(proposal.kind === "cross_script", "proposal kind is cross_script");
  assert(proposal.evidence === "model", "proposal evidence names the model");
  // NOT applied yet: the alias table must not contain it.
  const aliasesBefore = JSON.parse((q(db, "SELECT aliases FROM entities WHERE id = ?", proposal.targetEntityId) as { aliases: string }).aliases) as string[];
  assert(!aliasesBefore.includes(proposal.sourceName), "the proposal is not applied before confirmation");

  // Human confirms -> the alias lands.
  const ok = await store.resolveEntityReview(proposal.id, "keep");
  assert(ok.ok, "confirming the proposal succeeds: " + JSON.stringify(ok));
  const aliasesAfter = JSON.parse((q(db, "SELECT aliases FROM entities WHERE id = ?", proposal.targetEntityId) as { aliases: string }).aliases) as string[];
  assert(aliasesAfter.includes(proposal.sourceName), "confirming appends the alias");

  // A rejected proposal never reaches the alias table.
  store.close();

  const store2 = openStore("proposed-drop.db", {
    entityAliasJudge: async (pairs) => pairs.map(() => ({ same: true } as AliasJudgeVerdict)),
  });
  const s2 = await store2.createSession("eval");
  await store2.adjudicateMemory(s2.id, [{
    url: "https://jia2.example/n", title: "甲公司公告", snippet: "甲公司今日发布公告。合作方 Acme 也转发了这条消息。",
    source: "user", evidence: 1, entity: "甲公司",
  }]);
  const p2 = store2.listEntityAliases({ pendingOnly: true })[0];
  assert(!!p2, "second store has a pending proposal");
  const dropped = await store2.resolveEntityReview(p2!.id, "drop");
  assert(dropped.ok, "dropping the proposal succeeds");
  const aliases2 = JSON.parse((q("proposed-drop.db", "SELECT aliases FROM entities WHERE id = ?", p2!.targetEntityId) as { aliases: string }).aliases) as string[];
  assert(!aliases2.includes(p2!.sourceName), "a rejected proposal is never applied");
  store2.close();
  console.log("3 model proposal waits for confirmation: OK");
}

// --- 3b. a judge that cannot tell does not become a yes ---------------------
{
  const db = "judge-null.db";
  const store = openStore(db, {
    entityAliasJudge: async (pairs) => pairs.map(() => ({ same: null, reason: "cannot tell" })),
  });
  const sess = await store.createSession("eval");
  await store.adjudicateMemory(sess.id, [{
    url: "https://nul.example/n", title: "甲公司公告", snippet: "甲公司今日发布公告。合作方 Acme 也转发了这条消息。",
    source: "user", evidence: 1, entity: "甲公司",
  }]);
  assert(store.listEntityAliases({ pendingOnly: true }).length === 0, "a null verdict queues nothing");
  store.close();

  // A judge that throws is fail-open AND recorded: nothing applied, and the
  // material is marked undetermined rather than linked to a guess.
  const db2 = "judge-throw.db";
  const store2 = openStore(db2, { entityAliasJudge: async () => { throw new Error("offline"); } });
  const s2 = await store2.createSession("eval");
  const res = await store2.adjudicateMemory(s2.id, [{
    url: "https://thr.example/n", title: "甲公司公告", snippet: "甲公司今日发布公告。合作方 Acme 也转发了这条消息。",
    source: "user", evidence: 1, entity: "甲公司",
  }]);
  assert(res[0]?.action === "accept", "a judge fault does not fail the write");
  assert(store2.entityTelemetry().crossScriptJudgeFailures >= 1, "the judge fault is counted");
  store2.close();
  console.log("3b a judge that cannot tell is not a yes: OK");
}

// --- 4. every alias has a reason, and can be taken back ---------------------
{
  const db = "undo.db";
  const store = openStore(db);
  const sess = await store.createSession("eval");
  await store.adjudicateMemory(sess.id, [{
    url: "https://u.example/s", title: "甲公司客服", snippet: "甲公司客服邮箱为 help@u.example。",
    source: "user", evidence: 1, entity: "甲公司",
  }]);
  const r = store.declareEntityAlias("甲公司", "Acme");
  assert(r.ok, "declaration ok");
  const listed = store.listEntityAliases();
  const row = listed.find((x) => x.id === r.logId);
  assert(!!row, "the declaration shows in the audit view");
  assert(row!.evidence === "manual", "the audit view names the reason: " + row?.evidence);
  assert(row!.targetName === "甲公司", "the audit view names the object");

  // Undo restores the previous state: the query no longer resolves to it.
  assert(store.undoEntityMerge(r.logId!), "undo succeeds");
  const after = store.resolveQueryObject("Acme 客服邮箱");
  assert(after.kind === "none", "after undo the Latin name no longer resolves (was " + after.kind + ")");
  const undoneRow = q(db, "SELECT undone, resolved FROM entity_merge_log WHERE id = ?", r.logId) as { undone: number; resolved: string | null };
  assert(undoneRow.undone === 1, "the log row is stamped undone");
  assert(store.listEntityAliases().every((x) => x.id !== r.logId), "an undone mapping leaves the audit list");
  store.close();
  console.log("4 aliases are traceable and reversible: OK");
}

// --- 4b. a stated pair in the material needs no model ----------------------
{
  const db = "stated.db";
  let judgeCalls = 0;
  const store = openStore(db, {
    entityAliasJudge: async (pairs) => { judgeCalls += 1; return pairs.map(() => ({ same: null })); },
  });
  const sess = await store.createSession("eval");
  await store.adjudicateMemory(sess.id, [{
    url: "https://s.example/n", title: "Acme（甲公司）公告",
    snippet: "Acme（甲公司）今日宣布客服邮箱为 help@s.example。",
    source: "user", evidence: 1, entity: "Acme",
  }]);
  const aliases = JSON.parse((q(db, "SELECT aliases FROM entities WHERE name_norm = 'acme' AND valid_until IS NULL") as { aliases: string }).aliases) as string[];
  assert(aliases.includes("甲公司"), "the parenthesised statement applied the alias: " + JSON.stringify(aliases));
  const log = q(db, "SELECT kind, detail FROM entity_merge_log WHERE kind = 'declared' ORDER BY id DESC LIMIT 1") as { kind: string; detail: string };
  assert((JSON.parse(log.detail) as { evidence?: string }).evidence === "declared-parentheses", "evidence names the material");
  // The material stated the mapping, so no model answer was needed for it.
  void judgeCalls;
  store.close();
  console.log("4b a stated pair applies without the model: OK");
}

// --- 4c. a configured mapping table applies at once ------------------------
// The ticket asks for an explicit mapping TABLE (configuration), not only a
// command. `[entityAliases] acme = ["Acme", "Acme Inc", "甲公司"]` must resolve
// all three names to one object with no model call and nothing to review.
{
  const db = "config-table.db";
  const store = openStore(db);
  const sess = await store.createSession("eval");
  await store.adjudicateMemory(sess.id, [{
    url: "https://cfg.example/s", title: "甲公司客服邮箱", snippet: "甲公司客服邮箱为 help@cfg.example。",
    source: "user", evidence: 1, entity: "甲公司",
  }]);
  const applied = store.applyDeclaredAliases({ acme: ["Acme", "Acme Inc", "甲公司"] });
  assert(applied.applied >= 2, "both other names were applied (got " + applied.applied + ")");
  assert(applied.skipped.length === 0, "no conflict for a fresh table");

  // Every name in the group now resolves to the SAME object.
  const ids = new Set<number>();
  for (const q2 of ["Acme", "Acme Inc", "甲公司"]) {
    const res = store.resolveQueryObject(q2 + " 的客服邮箱");
    assert(res.kind === "resolved", q2 + " resolves (was " + res.kind + ")");
    if (res.kind === "resolved") ids.add(res.entityId);
  }
  assert(ids.size === 1, "all three names resolve to ONE object (got " + ids.size + ")");

  // The reason is recorded as configuration, and it is not in the review queue.
  const row = store.listEntityAliases().find((r) => r.sourceName === "acme");
  assert(!!row, "the declared alias is in the audit view");
  assert(row!.evidence === "declared-config", "evidence names the config table: " + row?.evidence);
  assert(store.listEntityAliases({ pendingOnly: true }).length === 0, "a declared mapping never waits for review");

  // Idempotent: applying it again writes nothing new.
  const again = store.applyDeclaredAliases({ acme: ["Acme", "Acme Inc", "甲公司"] });
  assert(again.applied === 0, "re-applying the same table changes nothing (got " + again.applied + ")");

  // A group whose names already belong to two different objects is refused by
  // name, not silently merged.
  store.dbQuery("SELECT 1");
  const other = store.declareEntityAlias("Globex", "Globex Inc");
  assert(other.ok, "second object declared");
  const conflict = store.applyDeclaredAliases({ clash: ["Acme", "Globex"] });
  assert(conflict.skipped.length === 1 && conflict.skipped[0]!.group === "clash",
    "a conflicting group is reported: " + JSON.stringify(conflict.skipped));
  store.close();
  // The schema-level shape check lives in domain-schema; assert the two rules
  // that make a typo visible instead of silently dead.
  const { validate } = await import("../src/domain-schema");
  const base = { name: "x", rag: { adapter: "none" }, skills: { active: [] }, sources: { enabled: [] }, hooks: { toolWhitelist: [] }, settings: {}, prompts: [] };
  let ok = true;
  try { validate({ ...base, entityAliases: { acme: ["Acme"] } } as never); } catch { ok = false; }
  assert(!ok, "a one-name list is rejected (nothing to declare)");
  ok = true;
  try { validate({ ...base, entityAliases: { acme: ["Acme", ""] } } as never); } catch { ok = false; }
  assert(!ok, "a blank name is rejected");
  validate({ ...base, entityAliases: { acme: ["Acme", "甲公司"] } } as never);
  assert(true, "a well-formed table passes validation");
  console.log("4c a configured mapping table applies at once: OK");
}

// --- 5. an undetermined record is stored, marked, and has a review exit -----
{
  const db = "unresolved.db";
  const store = openStore(db, {
    // The model cannot tell -> the material stays undetermined.
    entityAliasJudge: async (pairs) => pairs.map(() => ({ same: null })),
  });
  const sess = await store.createSession("eval");
  await store.adjudicateMemory(sess.id, [{
    url: "https://un.example/n", title: "甲公司公告", snippet: "甲公司今日发布公告。合作方 Acme 也转发了这条消息。",
    source: "user", evidence: 1, entity: "甲公司",
  }]);
  const listed = store.listUnresolvedEntityMemories();
  assert(listed.length === 1, "the material is listed as undetermined (got " + listed.length + ")");
  const record = listed[0]!;
  assert(record.reason.includes("cross-script"), "the reason is recorded: " + record.reason);

  // It is stored, not dropped.
  const row = q(db, "SELECT quarantine FROM retrieval_results WHERE id = ?", record.id) as { quarantine: string | null };
  assert(row.quarantine === "entity_unresolved", "stored with the undetermined mark");
  // And excluded from recall by default.
  const hits = await store.searchMemory("甲公司公告", 20);
  assert(!hits.some((h) => h.rowid === record.id), "an undetermined record does not take part in recall");

  // The review exit works: keep clears the mark.
  const keep = store.resolveUnresolvedEntityMemory(record.id, "keep");
  assert(keep.ok, "keep succeeds");
  const cleared = q(db, "SELECT quarantine FROM retrieval_results WHERE id = ?", record.id) as { quarantine: string | null };
  assert(cleared.quarantine === null, "keep clears the mark");
  store.close();
  console.log("5 undetermined records are stored, excluded, and resolvable: OK");
}

// --- 6. consolidation clusters Chinese and English material about one object -
{
  const db = "consolidate.db";
  const store = openStore(db);
  const sess = await store.createSession("eval");
  // Three English pages and three Chinese pages about ONE company, each written
  // under its own URL — the case that used to split into two clusters.
  for (let i = 1; i <= 3; i++) {
    await store.adjudicateMemory(sess.id, [{
      url: "https://acme.example/en-" + i, title: "Acme notice " + i,
      snippet: "Acme support is available around the clock from 2026-11-01.",
      source: "tavily", evidence: 0.9, entity: "https://acme.example/en-" + i,
    }]);
    await store.adjudicateMemory(sess.id, [{
      url: "https://acme.example/zh-" + i, title: "甲公司通知 " + i,
      snippet: "甲公司客服自 2026-11-01 起全天候服务。",
      source: "tavily", evidence: 0.9, entity: "https://acme.example/zh-" + i,
    }]);
  }
  // Declare the mapping so both languages resolve to one object.
  assert(store.declareEntityAlias("Acme", "甲公司").ok, "declaration ok");

  // A summarize seam that reports which cluster it was handed, so the assertion
  // is about clustering (not about the model): the two languages must arrive in
  // ONE call, i.e. one cluster.
  const seen: string[][] = [];
  const rep = await store.consolidateMemory(
    { scope: { by: "session", sessionIds: [sess.id], memoryIds: [], sessionIdNotApplied: false } },
    {
      summarize: async (eps) => {
        const texts = eps.map((e) => e.title ?? "");
        seen.push(texts);
        return "Acme (甲公司) support is available around the clock from 2026-11-01.";
      },
      classify: () => ({ label: "supported", confidence: 0.95 }),
    },
  );
  const combined = seen.find((titles) => titles.some((t) => t.includes("Acme notice")) && titles.some((t) => t.includes("甲公司通知")));
  assert(!!combined, "one cluster carried both languages: " + JSON.stringify(seen));
  assert(rep.add + rep.noop + rep.update >= 1, "the run produced a knowledge row");
  store.close();
  console.log("6 consolidation clusters both languages as one object: OK");
}

// --- 7. same-language behaviour is unchanged -------------------------------
{
  const db = "unchanged.db";
  const store = openStore(db);
  const sess = await store.createSession("eval");
  await store.adjudicateMemory(sess.id, [
    { url: "https://a.example/1", title: "Acme support hours", snippet: "Acme support runs weekdays 9 to 5.", source: "tavily", evidence: 0.9, entity: "acme-support" },
    { url: "https://b.example/2", title: "Globex support hours", snippet: "Globex support runs weekdays 8 to 4.", source: "tavily", evidence: 0.9, entity: "globex-support" },
  ]);
  // No cross-script content: the pass must not have proposed or created anything.
  assert(store.listEntityAliases().length === 0, "no alias invented for same-script material");
  assert(store.listUnresolvedEntityMemories().length === 0, "no record marked undetermined for same-script material");
  const tel = store.entityTelemetry();
  assert(tel.crossScriptProposed === 0 && tel.unresolvedMarked === 0, "cross-script counters stay zero: " + JSON.stringify(tel));
  // And an ordinary query still reaches its row.
  const hits = await store.searchMemory("Globex support", 10);
  assert(hits.length >= 1, "ordinary same-language recall still works");
  store.close();
  console.log("7 same-language behaviour unchanged: OK");
}

// --- 8. review fixes (PR #287 CodeRabbit round) -----------------------------
{
  // 8a. A pending proposal that never applied anything must not remove an alias
  //     a later declaration wrote for the same pair.
  const db = "undo-proposal.db";
  const store = openStore(db, {
    entityAliasJudge: async (pairs) => pairs.map(() => ({ same: true, reason: "x" } as AliasJudgeVerdict)),
  });
  const sess = await store.createSession("eval");
  await store.adjudicateMemory(sess.id, [{
    url: "https://u2.example/1", title: "甲公司公告", snippet: "甲公司公告。合作方 Acme 也转发了。",
    source: "user", evidence: 1, entity: "甲公司",
  }]);
  const pending = store.listEntityAliases({ pendingOnly: true });
  assert(pending.length === 1, "one pending proposal exists");
  const decl = store.declareEntityAlias("Acme", "甲公司");
  assert(decl.ok, "manual declaration ok");
  const aliasesBefore = JSON.parse((q(db, "SELECT aliases FROM entities WHERE id = ?", decl.entityId) as { aliases: string }).aliases) as string[];
  assert(aliasesBefore.includes("acme"), "the declaration applied the alias");
  // Undo the PROPOSAL (which never applied anything).
  assert(store.undoEntityMerge(pending[0]!.id), "undoing the proposal succeeds");
  const aliasesAfter = JSON.parse((q(db, "SELECT aliases FROM entities WHERE id = ?", decl.entityId) as { aliases: string }).aliases) as string[];
  assert(aliasesAfter.includes("acme"), "undoing an unapplied proposal must not remove the declared alias");
  store.close();
  console.log("8a undoing an unapplied proposal keeps the declared alias: OK");
}

{
  // 8b. A multi-word Latin name is taken whole, not as its last word.
  const pairs = extractCrossScriptPairs("Acme Corp（甲公司）发布公告");
  assert(pairs.length === 1 && pairs[0]!.latin === "Acme Corp",
    "multi-word Latin name kept whole: " + JSON.stringify(pairs));
  const withNoise = extractCrossScriptPairs("see Acme Corp（甲公司）");
  assert(withNoise.length === 1 && withNoise[0]!.latin === "Acme Corp",
    "a leading sentence word is trimmed: " + JSON.stringify(withNoise));
  console.log("8b multi-word names parse whole: OK");
}

{
  // 8c. A stated pair is not also sent to the model — the material already
  //     settled it, so a judge call would be wasted budget.
  const db = "no-double-ask.db";
  let judgeCalls = 0;
  const store = openStore(db, {
    entityAliasJudge: async (pairs) => { judgeCalls += 1; return pairs.map(() => ({ same: null })); },
  });
  const sess = await store.createSession("eval");
  await store.adjudicateMemory(sess.id, [{
    url: "https://nd.example/1", title: "Acme（甲公司）公告",
    snippet: "Acme（甲公司）今日宣布客服邮箱为 help@nd.example。",
    source: "user", evidence: 1, entity: "Acme",
  }]);
  assert(judgeCalls === 0, "a pair the material states is not sent to the judge (calls=" + judgeCalls + ")");
  store.close();
  console.log("8c stated pairs are not re-asked: OK");
}

{
  // 8d. Object filtering happens before the cut, not after.
  //     Two knowledge rows share the fact word, different objects, no embeddings
  //     — so only the keyword lane can find them. The row ranked first belongs to
  //     the WRONG object; the answering row sits behind it. Filtering the
  //     finished `limit` would drop it and return nothing.
  const db = "gate-before-cut.db";
  const store = openStore(db);
  const sess = await store.createSession("eval");
  const rw = new Database(join(dir, db));
  rw.prepare("INSERT INTO semantic_memories (content, source_episode_ids, salience, confidence, embedding) VALUES (?, '[]', 0.5, 0.9, NULL)")
    .run("乙公司客服邮箱为 help@yi.example。");
  rw.prepare("INSERT INTO semantic_memories (content, source_episode_ids, salience, confidence, embedding) VALUES (?, '[]', 0.5, 0.9, NULL)")
    .run("甲公司客服邮箱为 help@jia.example。");
  rw.close();
  await store.adjudicateMemory(sess.id, [
    { url: "https://jia.example/x", title: "甲公司页面", snippet: "甲公司相关内容。", source: "user", evidence: 1, entity: "甲公司" },
    { url: "https://yi.example/x", title: "乙公司页面", snippet: "乙公司相关内容。", source: "user", evidence: 1, entity: "乙公司" },
  ]);
  const decl = store.declareEntityAlias("Acme", "甲公司");
  assert(decl.ok, "declaration ok");
  // The keyword lane alone, before any fusion: the answering row must survive
  // even when only ONE slot is asked for. Private on purpose (it is an internal
  // rung), so the test reaches it the way a white-box test has to.
  const kw = (store as unknown as {
    semanticKeywordRows(q: string, limit: number, forms?: readonly string[]): Array<{ content: string }>;
  }).semanticKeywordRows("Acme 客服邮箱", 1, ["甲公司", "acme"]);
  const kwContents = kw.map((h) => String(h.content));
  assert(kwContents.some((c) => c.includes("help@jia.example")),
    "the answering row survives a one-slot keyword read: " + JSON.stringify(kwContents));
  assert(!kwContents.some((c) => c.includes("help@yi.example")),
    "the other object's row is filtered out before the cut");
  // And end to end: the wrong object's knowledge row never comes back.
  const hits = await store.searchMemory("Acme 客服邮箱", 5);
  const sem = hits.filter((h) => h.rowid < 0).map((h) => String(h.content));
  assert(!sem.some((c) => c.includes("help@yi.example")), "the other object's knowledge row is never returned");
  store.close();
  console.log("8d object filter runs before the cut: OK");
}

{
  // 8e. A material with an unresolved pair is still marked when another pair in
  //     the same text WAS stated — the check is per pair, not per material.
  const db = "per-pair.db";
  const store = openStore(db, {
    entityAliasJudge: async (pairs) => pairs.map(() => ({ same: null })),
  });
  const sess = await store.createSession("eval");
  await store.adjudicateMemory(sess.id, [
    { url: "https://pp.example/a", title: "甲公司页面", snippet: "甲公司相关内容。", source: "user", evidence: 1, entity: "甲公司" },
    { url: "https://pp.example/b", title: "乙公司页面", snippet: "乙公司相关内容。", source: "user", evidence: 1, entity: "乙公司" },
  ]);
  await store.adjudicateMemory(sess.id, [{
    url: "https://pp.example/c", title: "Acme（甲公司）公告",
    snippet: "Acme（甲公司）公告。另见 Globex 与 乙公司 的说明。",
    source: "user", evidence: 1,
  }]);
  // The stated pair (Acme/甲公司) applied; the unresolved pair (Globex/乙公司)
  // must still mark the material rather than being skipped wholesale.
  const marked = store.listUnresolvedEntityMemories();
  assert(marked.length >= 1, "a partly-stated material is still marked for its unresolved pair (got " + marked.length + ")");
  store.close();
  console.log("8e undetermined is decided per pair: OK");
}

// --- 9. second review round (PR #287) --------------------------------------
{
  // 9a. A sentence word in front of the name must not become part of it.
  //     `Contact Acme（甲公司）` used to parse as `Contact Acme`, which then found
  //     no entity at all — the declaration was silently dropped.
  const db = "contact-prefix.db";
  const store = openStore(db);
  const sess = await store.createSession("eval");
  await store.adjudicateMemory(sess.id, [{
    url: "https://cp.example/1", title: "Acme 页面", snippet: "Acme 相关内容。",
    source: "user", evidence: 1, entity: "Acme",
  }]);
  await store.adjudicateMemory(sess.id, [{
    url: "https://cp.example/2", title: "公告", snippet: "Contact Acme（甲公司）获取客服支持。",
    source: "user", evidence: 1,
  }]);
  const acme = store.dbQuery<{ id: number; aliases: string }>("SELECT id, aliases FROM entities WHERE name_norm = 'acme' AND valid_until IS NULL")[0];
  assert(!!acme, "the Acme entity exists");
  const aliases = JSON.parse(acme!.aliases) as string[];
  assert(aliases.includes("甲公司"),
    "the pair resolved to the known Acme, not to a phrase 'contact acme': " + JSON.stringify(aliases));
  // And no entity was created for the sentence phrase.
  const bogus = store.dbQuery<{ n: number }>("SELECT COUNT(*) n FROM entities WHERE name_norm LIKE '%contact%'");
  assert(bogus[0]!.n === 0, "no entity was created for the sentence prefix");
  store.close();
  console.log("9a a sentence word in front of the name is not captured: OK");
}

{
  // 9b. The object filter is in the SQL, so it survives a table full of other
  //     objects: 60 companies all stating the same fact word, target last.
  const db = "many-objects.db";
  const store = openStore(db);
  const rw = new Database(join(dir, db));
  for (let i = 0; i < 60; i++) {
    rw.prepare("INSERT INTO semantic_memories (content, source_episode_ids, salience, confidence, embedding) VALUES (?, '[]', 0.5, 0.9, NULL)")
      .run("第" + i + "公司客服邮箱为 help@x" + i + ".example。");
  }
  // The answering row goes in LAST, past any fixed read window.
  rw.prepare("INSERT INTO semantic_memories (content, source_episode_ids, salience, confidence, embedding) VALUES (?, '[]', 0.5, 0.9, NULL)")
    .run("甲公司客服邮箱为 help@jia.example。");
  rw.close();
  const kw = (store as unknown as {
    semanticKeywordRows(q: string, limit: number, forms?: readonly string[]): Array<{ content: string }>;
  }).semanticKeywordRows("甲公司 客服邮箱", 5, ["甲公司"]);
  const contents = kw.map((h) => String(h.content));
  assert(contents.some((c) => c.includes("help@jia.example")),
    "the answering row is found past 60 other objects (got " + contents.length + " rows)");
  assert(contents.every((c) => !c.includes("help@x")), "no other object's row passes the filter");
  store.close();
  console.log("9b the object filter survives a crowded table: OK");
}

{
  // 9c. A row marked undetermined must not close the previous version of its
  //     fact: the old row is the only thing still answerable.
  const db = "no-orphan.db";
  const store = openStore(db, {
    entityAliasJudge: async (pairs) => pairs.map(() => ({ same: null })),
  });
  const sess = await store.createSession("eval");
  await store.adjudicateMemory(sess.id, [{
    url: "https://or.example/1", title: "甲公司公告", snippet: "甲公司客服邮箱为 help@or.example。",
    source: "user", evidence: 1, entity: "or-key",
  }]);
  const first = store.dbQuery<{ id: number }>("SELECT id FROM retrieval_results WHERE entity = 'or-key'")[0]!.id;
  // Second write, same entity key, with an unresolved cross-script pair.
  await store.adjudicateMemory(sess.id, [{
    url: "https://or.example/2", title: "甲公司公告二", snippet: "甲公司公告。合作方 Acme 也转发了。",
    source: "user", evidence: 1, entity: "or-key",
  }]);
  const rows = store.dbQuery<{ id: number; valid_until: string | null; quarantine: string | null }>(
    "SELECT id, valid_until, quarantine FROM retrieval_results WHERE entity = 'or-key' ORDER BY id",
  );
  const live = rows.filter((r) => r.valid_until === null && r.quarantine === null);
  assert(live.length >= 1,
    "at least one version of the fact stays live and recallable: " + JSON.stringify(rows));
  const quarantined = rows.filter((r) => r.quarantine === "entity_unresolved");
  if (quarantined.length > 0) {
    assert(quarantined.every((r) => r.id !== first || r.valid_until === null),
      "the undetermined row did not close its predecessor");
  }
  store.close();
  console.log("9c an undetermined row does not close the old version: OK");
}

{
  // 9d. Confirming a proposal whose alias a human already declared must succeed,
  //     not report "target missing" and strand the proposal in the queue.
  const db = "confirm-idempotent.db";
  const store = openStore(db, {
    entityAliasJudge: async (pairs) => pairs.map(() => ({ same: true })),
  });
  const sess = await store.createSession("eval");
  await store.adjudicateMemory(sess.id, [{
    url: "https://ci.example/1", title: "甲公司公告", snippet: "甲公司公告。合作方 Acme 也转发了。",
    source: "user", evidence: 1, entity: "甲公司",
  }]);
  const proposal = store.listEntityAliases({ pendingOnly: true })[0]!;
  const decl = store.declareEntityAlias("Acme", "甲公司");
  assert(decl.ok, "the human declared the same mapping first");
  const confirmed = await store.resolveEntityReview(proposal.id, "keep");
  assert(confirmed.ok, "confirming an already-applied proposal succeeds: " + JSON.stringify(confirmed));
  const row = q(db, "SELECT resolved FROM entity_merge_log WHERE id = ?", proposal.id) as { resolved: string | null };
  assert(row.resolved === "confirmed", "the proposal left the queue as confirmed");
  store.close();
  console.log("9d confirming an already-applied proposal succeeds: OK");
}

for (const s of stores) { try { s.close(); } catch { /* already closed */ } }
rmSync(dir, { recursive: true, force: true });
console.log("entity-alias.test.ts: " + passed + " passed, " + failed + " failed");
if (failed > 0) process.exit(1);
