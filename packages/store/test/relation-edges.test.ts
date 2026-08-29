// ADR-0035 D2/D3/D4/D6/D7: relation edge unit coverage (rule extraction, idempotent
// supersede, pattern guard, merge/unmerge edge symmetry, backfill dry-run/apply parity).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { SqliteSessionStore } from "../src/session-store";
import { extractRelations, parseLlmTriples, normalizePredicate, PREDICATES } from "../src/relation";

function assert(cond: boolean, msg: string) {
  if (!cond) { console.error("FAIL: " + msg); process.exit(1); }
}

const dir = mkdtempSync(join(tmpdir(), "ans-rel-"));
const dbPath = join(dir, "rel.db");
const store = new SqliteSessionStore(dbPath);

const edgesNow = (liveOnly: boolean) => {
  const d = new Database(dbPath, { readonly: true });
  const rows = d
    .prepare(
      "SELECT e.id, s.name_norm as s, e.relation, t.name_norm as o, e.episode_memory_id as ep, e.confidence" +
      " FROM edges e JOIN entities s ON s.id = e.source_entity_id JOIN entities t ON t.id = e.target_entity_id" +
      (liveOnly ? " WHERE e.valid_until IS NULL" : ""),
    )
    .all() as Array<{ id: number; s: string; o: string; relation: string; ep: number | null; confidence: number }>;
  d.close();
  return rows;
};

const session = await store.createSession("eval");

// --- extraction unit checks ---
const cn = extractRelations('"\u738B\u6587\u535A" \u8D1F\u8D23 "\u7075\u96C0\u7F51\u5173" \u7684\u5F00\u53D1\u6392\u671F\u3002', []);
assert(cn.some((t) => t.relation === "works_on"), "CN works_on rule fires: " + JSON.stringify(cn));
assert(extractRelations("MambaKit uses CraneLib for batch scheduling.", []).some((t) => t.relation === "uses"), "EN uses rule fires");
assert(extractRelations("alpha depends on beta.", []).length === 1, "depends_on fires");
assert(normalizePredicate("\u8D1F\u8D23") === "works_on", "alias maps CN verb");
assert(normalizePredicate("nope-nothing") === null, "unknown predicate rejected");
const llmOk = parseLlmTriples('noise [{"subject":"A","relation":"uses","object":"B","confidence":0.9}] tail');
assert(llmOk !== null && llmOk.length === 1 && llmOk[0].relation === "uses", "llm triple parse + degrade");
assert(parseLlmTriples("not json at all") === null, "llm garbage returns null");
assert(PREDICATES.length === 8, "closed predicate set = 8");

// --- write-path edges ---
const w1 = await store.adjudicateMemory(session.id, [
  { url: "https://ex.com/r1", title: "MambaKit uses CraneLib for batch scheduling", snippet: "MambaKit uses CraneLib for batch scheduling at 02:00", source: "exa", evidence: 0.9 },
]);
assert(w1[0]?.action === "accept", "first relation write accepted");
let uses = edgesNow(true).filter((e) => e.relation === "uses");
assert(uses.length === 1, "one live uses edge (got " + uses.length + ")");
assert(uses[0].s === "mambakit" && uses[0].o === "cranelib", "endpoints resolved: " + uses[0].s + "->" + uses[0].o);
assert(uses[0].ep === w1[0].insertedId, "episode provenance = write id");

// same assertion in a NEW memory supersedes (one live row, episode moves)
const w2 = await store.adjudicateMemory(session.id, [
  { url: "https://ex.com/r2", title: "MambaKit uses CraneLib config", snippet: "MambaKit uses CraneLib config registry", source: "exa", evidence: 0.9 },
]);
assert(w2[0]?.action === "accept", "second relation write accepted");
uses = edgesNow(true).filter((e) => e.relation === "uses");
assert(uses.length === 1, "still exactly one live uses edge (supersede)");
assert(uses[0].ep === w2[0].insertedId, "episode moved to latest write (supersede)");

// --- pattern guard: LLM seam proposing phrase authored_by phrase is schema-rejected ---
const store2 = new SqliteSessionStore(dbPath, {
  relationLlmFallback: async () => JSON.stringify([{ subject: "Vaultor", relation: "authored_by", object: "MambaKit" }]),
});
// text names exactly one fresh entity and no predicate keyword, so rule hit-set is empty and the seam must fire once
const w3 = await store2.adjudicateMemory(session.id, [
  { url: "https://ex.com/r3", title: 'MambaKit paired with "Vaultor"', snippet: 'MambaKit paired with "Vaultor" in the calibration bench log', source: "exa", evidence: 0.9 },
]);
assert(w3[0]?.action === "accept", "llm-seam write accepted");
const tel = store2.relationTelemetry();
assert(tel.llmActivations === 1, "llm seam activated exactly once (got " + tel.llmActivations + ")");
assert(tel.llmFailures === 0, "llm parse succeeded");
assert(tel.schemaRejected === 1, "pattern guard rejected edge (got " + tel.schemaRejected + ")");
store2.close();

// --- merge redirects edges; conflicting triple closes; unmerge restores ---
const ents = (() => {
  const d = new Database(dbPath, { readonly: true });
  const rows = d.prepare("SELECT id, name_norm FROM entities WHERE valid_until IS NULL").all() as Array<{ id: number; name_norm: string }>;
  d.close();
  return rows;
})();
const mkId = ents.find((e) => e.name_norm === "mambakit")!.id;
await store.adjudicateMemory(session.id, [
  { url: "https://ex.com/r4", title: "MambaKitBeta uses CraneLib too", snippet: "MambaKitBeta uses CraneLib for staging jobs", source: "exa", evidence: 0.9 },
]);
const betaId = ((() => {
  const d = new Database(dbPath, { readonly: true });
  const r = d.prepare("SELECT id FROM entities WHERE name_norm = 'mambakitbeta' AND valid_until IS NULL").get() as { id: number };
  d.close();
  return r.id;
})());
const comb = await store.combineEntities(betaId, mkId);
assert(comb.ok === true, "merge accepted: " + JSON.stringify(comb));
let liveUses = edgesNow(true).filter((e) => e.relation === "uses").length;
assert(liveUses === 1, "conflicting uses edge closed at merge; one live remains");
const un = await store.unmergeEntity(comb.logId!);
assert(un.ok === true, "unmerge ok: " + JSON.stringify(un));
liveUses = edgesNow(true).filter((e) => e.relation === "uses").length;
assert(liveUses === 2, "closed duplicate edge revived by unmerge (ADR-0032 D2: undo merge side-effects only): got "+liveUses);

// --- backfill dry-run / apply parity + second-apply no-op ---
const dry = await store.backfillRelations({ apply: false });
assert(dry.apply === false && dry.scanned > 0, "dry-run scanned rows: " + dry.scanned);
const beforeApply = edgesNow(true).length;
const app = await store.backfillRelations({ apply: true });
assert(app.scanned === dry.scanned, "apply scanned == dry-run scanned");
const afterApply = edgesNow(true).length;
assert(afterApply >= beforeApply, "apply never shrinks the live edge set");
const again = await store.backfillRelations({ apply: true });
assert(again.written === 0, "second apply is a no-op (idempotent): " + again.written);

// --- r87 audit F1: dry-run is an EXACT prediction (rolled-back tx), never an upper bound ---
const dir2 = mkdtempSync(join(tmpdir(), "ans-rel2-"));
const dbPath2 = join(dir2, "rel2.db");
const edgeCounts = (p: string) => {
  const d = new Database(p, { readonly: true });
  const t = d.prepare("SELECT COUNT(*) as n FROM edges").get() as { n: number };
  const l = d.prepare("SELECT COUNT(*) as n FROM edges WHERE valid_until IS NULL").get() as { n: number };
  d.close();
  return { total: t.n, live: l.n };
};
{
  const b = new SqliteSessionStore(dbPath2);
  const s2 = await b.createSession("eval");
  await b.adjudicateMemory(s2.id, [
    { url: "https://ex.com/p1", title: "PhotonKit uses CraneLib for render jobs", snippet: "PhotonKit uses CraneLib at 09:00", source: "exa", evidence: 0.9 },
    { url: "https://ex.com/p2", title: "PhotonKit depends on CraneLib", snippet: "PhotonKit depends on CraneLib for queueing", source: "exa", evidence: 0.9 },
  ]);
  { const w = new Database(dbPath2); w.exec("DELETE FROM edges"); w.close(); } // simulate pre-backfill state
  const tel0 = b.relationTelemetry();
  const dry2 = await b.backfillRelations({ apply: false });
  assert(dry2.scanned === 2 && dry2.written > 0, "dry-run predicts writes: " + JSON.stringify(dry2));
  assert(edgeCounts(dbPath2).total === 0, "dry-run leaves the edges table untouched");
  const tel1 = b.relationTelemetry();
  assert(tel1.ruleHits === tel0.ruleHits && tel1.triplesWritten === tel0.triplesWritten && tel1.dedupSkipped === tel0.dedupSkipped && tel1.schemaRejected === tel0.schemaRejected && tel1.relatedToWriteOnce === tel0.relatedToWriteOnce, "dry-run leaves telemetry untouched");
  const app2 = await b.backfillRelations({ apply: true });
  assert(app2.written === dry2.written && app2.dedupSkipped === dry2.dedupSkipped && app2.schemaRejected === dry2.schemaRejected, "dry-run counters exactly predict apply: " + JSON.stringify(dry2) + " vs " + JSON.stringify(app2));
  const app3 = await b.backfillRelations({ apply: true });
  assert(app3.written === 0, "second apply remains a no-op");
  // r87 audit F3: dbt full-refresh safety net — rebuild from scratch, closed rows never survive
  const dryFull = await b.backfillRelations({ apply: false, fullRefresh: true });
  assert(dryFull.written === app2.written, "full-refresh dry-run predicts the same live set: " + dryFull.written);
  assert(edgeCounts(dbPath2).total > 0, "dry full-refresh deleted nothing");
  const full = await b.backfillRelations({ apply: true, fullRefresh: true });
  const c2 = edgeCounts(dbPath2);
  assert(full.written === app2.written, "full-refresh rewrites the identical live edge set: " + full.written);
  assert(c2.total === c2.live, "full-refresh leaves zero closed rows behind: " + JSON.stringify(c2));
  b.close();
}

// --- r87 audit F2: related_to write-once skip is telemetry-pure (never counted as dedup) ---
{
  const p3 = join(dir2, "rel3.db");
  const c = new SqliteSessionStore(p3);
  const s3 = await c.createSession("eval");
  const mem = (n: number) => ({ url: "https://ex.com/q" + n, title: "ZetaKit is linked to WidgetKit", snippet: "ZetaKit is linked to WidgetKit in the bench notes", source: "exa", evidence: 0.9 });
  await c.adjudicateMemory(s3.id, [mem(1)]); // first write establishes the edge
  await c.adjudicateMemory(s3.id, [mem(2)]); // second episode hits the write-once skip path
  const tel3 = c.relationTelemetry();
  assert(tel3.relatedToWriteOnce >= 1, "write-once skips counted separately: " + tel3.relatedToWriteOnce);
  // dedupSkipped must contain ONLY same-episode duplicates (the m1 title+snippet double-match = 1), never write-once skips
  assert(tel3.dedupSkipped === 1, "dedupSkipped counts same-episode dups only: " + tel3.dedupSkipped);
  const d3 = new Database(p3, { readonly: true });
  const liveRt = d3.prepare("SELECT COUNT(*) as n FROM edges WHERE relation = 'related_to' AND valid_until IS NULL").get() as { n: number };
  d3.close();
  assert(liveRt.n === 1, "exactly one live related_to edge despite repeated episodes: " + liveRt.n);
  c.close();
}
// --- r88 audit: fullRefresh + partial window (--from-id/--limit) is rejected at the store layer ---
{
  const p4 = join(dir2, "rel4.db");
  const d = new SqliteSessionStore(p4);
  let threw = false;
  try { await d.backfillRelations({ apply: true, fullRefresh: true, fromId: 1 }); } catch { threw = true; }
  assert(threw, "store rejects fullRefresh + fromId");
  threw = false;
  try { await d.backfillRelations({ apply: true, fullRefresh: true, limit: 5 }); } catch { threw = true; }
  assert(threw, "store rejects fullRefresh + limit");
  d.close();
}
rmSync(dir2, { recursive: true, force: true });

// --- ADR-0036 D6: chunked apply commits per batch; live-writer SQLITE_BUSY is absorbed ---
{
  const dir3 = mkdtempSync(join(tmpdir(), "ans-rel-busy-"));
  const dbPath3 = join(dir3, "rel3.db");
  const st = new SqliteSessionStore(dbPath3);
  const s3 = await st.createSession("eval");
  for (let i = 0; i < 4; i++) {
    await st.adjudicateMemory(s3.id, [{ url: "https://ex.com/busy/" + i, title: "Pane" + i + "Kit uses Glide" + i + "Lib daily", snippet: "Pane" + i + "Kit uses Glide" + i + "Lib for batch renders", source: "exa", evidence: 0.9 }]);
  }
  { const w = new Database(dbPath3); w.exec("DELETE FROM edges"); w.close(); }
  const dry3 = await st.backfillRelations({ apply: false });
  const chunked = await st.backfillRelations({ apply: true, batch: 1 });
  assert(chunked.written === dry3.written && chunked.scanned === 4, "chunked apply matches dry-run exact prediction across batches: " + chunked.written + " vs " + dry3.written);
  { const w = new Database(dbPath3); w.exec("DELETE FROM edges"); w.close(); }
  // BUSY injection: hold the foreign write lock slightly past the store's busy_timeout (5000ms),
  // so the first batch attempt throws SQLITE_BUSY and the exponential-backoff retry path actually
  // executes (a 150ms hold is absorbed by busy_timeout and never reaches it — r90 audit F2).
  const foreign = new Database(dbPath3);
  foreign.exec("BEGIN IMMEDIATE");
  const releaser = setTimeout(() => foreign.exec("COMMIT"), 5200);
  const retryRes = await st.backfillRelations({ apply: true, batch: 2 });
  clearTimeout(releaser);
  foreign.close();
  assert(retryRes.written === chunked.written, "live-writer contention absorbed, backfill completed: " + retryRes.written);
  assert(edgeCounts(dbPath3).live === retryRes.written, "every written triple is a live edge after contention (uses + related_to per pair): " + edgeCounts(dbPath3).live);
  st.close();
  rmSync(dir3, { recursive: true, force: true });
}

// --- relation telemetry shape ---
const finalTel = store.relationTelemetry();
assert(typeof finalTel.pendingEdges === "number" && finalTel.pendingEdges >= 0, "pendingEdges gauge present");
assert(finalTel.triplesWritten >= 2, "triplesWritten recorded");

store.close();
rmSync(dir, { recursive: true, force: true });
console.log("relation-edges.test.ts: all assertions passed");