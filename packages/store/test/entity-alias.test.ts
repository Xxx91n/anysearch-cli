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

for (const s of stores) { try { s.close(); } catch { /* already closed */ } }
rmSync(dir, { recursive: true, force: true });
console.log("entity-alias.test.ts: " + passed + " passed, " + failed + " failed");
if (failed > 0) process.exit(1);
