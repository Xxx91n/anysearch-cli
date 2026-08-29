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

// --- relation telemetry shape ---
const finalTel = store.relationTelemetry();
assert(typeof finalTel.pendingEdges === "number" && finalTel.pendingEdges >= 0, "pendingEdges gauge present");
assert(finalTel.triplesWritten >= 2, "triplesWritten recorded");

store.close();
rmSync(dir, { recursive: true, force: true });
console.log("relation-edges.test.ts: all assertions passed");