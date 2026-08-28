// ADR-0032 test closure: combine (destructive redirect + snapshot), unmerge (bounded + override),
// candidate review belt (hit_count, keep/drop), merge telemetry.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { SqliteSessionStore } from "../src/session-store";

const dir = mkdtempSync(join(tmpdir(), "ans-entity-merge-"));
const dbPath = join(dir, "t.db");
const store = new SqliteSessionStore(dbPath);
const raw = new Database(dbPath);
const sess = await store.createSession("default");

let n = 0;
async function put(title: string): Promise<number> {
  n += 1;
  const out = await store.adjudicateMemory(sess.id, [{ url: "https://t.example/" + n, title, snippet: "", source: "user", evidence: 1 }]);
  const id = out[0]?.insertedId;
  assert.ok(typeof id === "number", "memory inserted");
  return id;
}
function entityIdByNorm(norm: string): number | undefined {
  const r = raw.prepare("SELECT id FROM entities WHERE name_norm = ? AND valid_until IS NULL").get(norm) as { id: number } | undefined;
  return r?.id;
}

// --- step 1: combine = redirect + tombstone + full snapshot ---
await put("We run GraphQL here daily");
await put("Team ApolloClient sync today");
const eGraph = entityIdByNorm("graphql") as number;
const eApollo = entityIdByNorm("apolloclient") as number;
assert.ok(eGraph && eApollo && eGraph !== eApollo, "two entities exist");
const m1 = Number((raw.prepare("SELECT memory_id FROM memory_entity WHERE entity_id = ?").get(eGraph) as { memory_id: number }).memory_id);
const c1 = await store.combineEntities(eGraph, eApollo);
assert.equal(c1.ok, true, "combine ok");
assert.ok(typeof c1.logId === "number", "merge log id returned");
{
  const tomb = raw.prepare("SELECT valid_until FROM entities WHERE id = ?").get(eGraph) as { valid_until: string | null };
  assert.ok(tomb.valid_until !== null, "from-entity tombstoned (valid_until set)");
  const links = raw.prepare("SELECT entity_id FROM memory_entity WHERE memory_id = ?").all(m1) as Array<{ entity_id: number }>;
  assert.deepEqual(links.map((x) => x.entity_id), [eApollo], "memory redirected to target");
  const log = raw.prepare("SELECT kind, detail FROM entity_merge_log WHERE id = ?").get(c1.logId) as { kind: string; detail: string };
  assert.equal(log.kind, "merge");
  const snap = JSON.parse(log.detail) as Record<string, unknown>;
  for (const k of ["fromEntityId", "fromName", "fromNorm", "fromAliases", "toAliasesBefore", "redirectedMemoryIds", "mergedAt"])
    assert.ok(k in snap, "snapshot field " + k);
  assert.deepEqual(snap.redirectedMemoryIds, [m1], "snapshot lists redirected memory");
  const target = raw.prepare("SELECT aliases FROM entities WHERE id = ?").get(eApollo) as { aliases: string };
  assert.ok((JSON.parse(target.aliases) as string[]).includes("graphql"), "Keep Aliases: merged norm on target");
  const tel = store.entityMergeTelemetry();
  assert.equal(tel.auto_merged, 1, "telemetry auto_merged=1");
  console.log("step1 combine redirect+snapshot: OK");
}

// --- step 2: post-merge write stays on target; unmerge = bounded restore + override ---
const postMergeId = await put("GraphQL federation notes here");
assert.equal((raw.prepare("SELECT entity_id FROM memory_entity WHERE memory_id = ?").get(postMergeId) as { entity_id: number }).entity_id, eApollo, "post-merge write on target");
const u = await store.unmergeEntity(c1.logId as number);
assert.equal(u.ok, true, "unmerge ok");
{
  const revived = raw.prepare("SELECT valid_until, aliases FROM entities WHERE id = ?").get(eGraph) as { valid_until: string | null; aliases: string };
  assert.equal(revived.valid_until, null, "from-entity revived");
  assert.deepEqual(JSON.parse(revived.aliases), [], "from-entity aliases restored");
  const target = raw.prepare("SELECT aliases FROM entities WHERE id = ?").get(eApollo) as { aliases: string };
  assert.deepEqual(JSON.parse(target.aliases), [], "target aliases restored (whole-value overwrite)");
  const back = raw.prepare("SELECT entity_id FROM memory_entity WHERE memory_id = ?").get(m1) as { entity_id: number };
  assert.equal(back.entity_id, eGraph, "snapshot memory redirected back");
  const post = raw.prepare("SELECT entity_id FROM memory_entity WHERE memory_id = ?").get(postMergeId) as { entity_id: number };
  assert.equal(post.entity_id, eApollo, "post-merge write stays on target (compensation semantics)");
  const undone = (raw.prepare("SELECT undone FROM entity_merge_log WHERE id = ?").get(c1.logId) as { undone: number }).undone;
  assert.equal(undone, 1, "merge log marked undone");
  const ovr = raw.prepare("SELECT source_name, target_entity_id FROM entity_merge_log WHERE kind = "+String.fromCharCode(39)+"override"+String.fromCharCode(39)).all() as Array<{ source_name: string; target_entity_id: number }>;
  assert.ok(ovr.some((r) => r.source_name === "graphql" && r.target_entity_id === eApollo), "override from->to");
  assert.ok(ovr.some((r) => r.source_name === "apolloclient" && r.target_entity_id === eGraph), "override to->from");
  const u2 = await store.unmergeEntity(c1.logId as number);
  assert.equal(u2.ok, false, "double unmerge refused");
  const tel = store.entityMergeTelemetry();
  assert.equal(tel.unmerged, 1, "telemetry unmerged=1");
  console.log("step2 unmerge bounded+override: OK");
}

// --- step 3: type gate ---
await put("Mirror at https://abc.example/x");
const eUrl = entityIdByNorm("https://abc.example/x") as number;
const eIdent = entityIdByNorm("graphql") as number;
{
  const bad = await store.combineEntities(eUrl, eIdent);
  assert.equal(bad.ok, false, "cross-type merge rejected");
  assert.match(bad.error ?? "", /type gate/, "type gate error message");
  console.log("step3 type gate: OK");
}

// --- step 4: candidate review belt — keep merges, drop keeps separate ---
await put("PineconeDB index stats");
await put("PineconeDBX managed tier"); // trigram sim 0.889 -> Fellegi-Sunter review band
{
  const rows = await store.listEntityReview();
  const cand = rows.find((r) => r.sourceName === "PineconeDBX");
  assert.ok(cand, "review-band candidate logged");
  assert.equal(cand.hitCount, 1);
  const eCand = entityIdByNorm("pineconedbx") as number;
  assert.ok(eCand, "candidate entity created separately");
  const keep = await store.resolveEntityReview(cand.id, "keep");
  assert.equal(keep.ok, true, "review keep ok");
  const closed = raw.prepare("SELECT valid_until FROM entities WHERE id = ?").get(eCand) as { valid_until: string | null };
  assert.ok(closed.valid_until !== null, "keep merged candidate entity away");
  const resolved = (raw.prepare("SELECT resolved FROM entity_merge_log WHERE id = ?").get(cand.id) as { resolved: string | null }).resolved;
  assert.equal(resolved, "confirmed", "review outcome written back");
  const dupResolve = await store.resolveEntityReview(cand.id, "keep");
  assert.equal(dupResolve.ok, false, "re-resolve refused");
  console.log("step4a review keep: OK");
}
await put("KeyrocketAA batch job");
await put("KeyrocketAB nightly run"); // sim 0.800 -> review band
{
  const rows = await store.listEntityReview();
  const cand = rows.find((r) => r.sourceName === "KeyrocketAB");
  assert.ok(cand, "second candidate present");
  const eCand = entityIdByNorm("keyrocketab") as number;
  const drop = await store.resolveEntityReview(cand.id, "drop");
  assert.equal(drop.ok, true, "review drop ok");
  const stillLive = raw.prepare("SELECT valid_until FROM entities WHERE id = ?").get(eCand) as { valid_until: string | null };
  assert.equal(stillLive.valid_until, null, "drop keeps entity separate and live");
  const tel = store.entityMergeTelemetry();
  assert.equal(tel.confirmed, 1);
  assert.equal(tel.rejected, 1);
  console.log("step4b review drop: OK");
}

// --- step 5: hit_count escalation via dedup + truncated overflow tier ---
await put("Ops run HazelCast cluster");
const eHz = entityIdByNorm("hazelcast") as number;
assert.ok(eHz, "hazelcast entity");
// 7 identifiers in one title: cap keeps first 6, "Hazelcast" overflows into the review belt.
const overflowTitle = "AlphaX BetaX GammaX DeltaX EpsilonX ZetaX HazelCast notes";
await put(overflowTitle);
await put(overflowTitle + " again");
{
  const rows = await store.listEntityReview();
  const cand = rows.find((r) => r.sourceName === "HazelCast" && r.targetEntityId === eHz);
  assert.ok(cand, "overflow candidate in review belt");
  assert.equal(cand.hitCount, 2, "re-hit increments hit_count");
  assert.equal(cand.suggested, true, "hit_count>=2 flagged suggested");
  const dupRows = raw.prepare("SELECT COUNT(*) as n FROM entity_merge_log WHERE kind = "+String.fromCharCode(39)+"candidate"+String.fromCharCode(39)+" AND source_name = "+String.fromCharCode(39)+"HazelCast"+String.fromCharCode(39)).get() as { n: number };
  assert.equal(dupRows.n, 1, "dedup: single candidate row for the pair");
  const tel = store.entityMergeTelemetry();
  assert.equal(tel.candidates_truncated, 2, "truncated counter counts both writes");
  console.log("step5 hit_count escalation: OK");
}


// --- step 6 (r77 audit G4 / P1 fix): pre-merge doubly-linked memory roundtrip ---
// One memory mentions BOTH entities; merge deletes the from-link while keeping the target-link;
// unmerge must restore the from-link WITHOUT dropping the target link.
{
  await put("Team uses RedisCluster and KeyVaultStore daily");
  const eRedis = entityIdByNorm("rediscluster") as number;
  const eVault = entityIdByNorm("keyvaultstore") as number;
  assert.ok(eRedis && eVault && eRedis !== eVault, "two entities created");
  const rowsBefore = raw.prepare("SELECT m.memory_id FROM memory_entity m JOIN retrieval_results r ON r.id = m.memory_id WHERE m.entity_id = ?").all(eRedis) as Array<{ memory_id: number }>;
  const mid = rowsBefore.find((r) => {
    const both = raw.prepare("SELECT 1 as x FROM memory_entity WHERE memory_id = ? AND entity_id = ?").get(r.memory_id, eVault);
    return !!both;
  })?.memory_id;
  assert.ok(typeof mid === "number", "a memory linked to BOTH entities exists");
  const c6 = await store.combineEntities(eRedis, eVault);
  assert.equal(c6.ok, true, "combine ok");
  const during = raw.prepare("SELECT entity_id FROM memory_entity WHERE memory_id = ?").all(mid) as Array<{ entity_id: number }>;
  assert.deepEqual(during.map((r) => r.entity_id), [eVault], "merge: from-link removed, target-link kept");
  const snap6 = JSON.parse((raw.prepare("SELECT detail FROM entity_merge_log WHERE id = ?").get(c6.logId) as { detail: string }).detail) as { bothLinkedIds?: number[] };
  assert.ok(snap6.bothLinkedIds && snap6.bothLinkedIds.includes(mid), "snapshot records bothLinked");
  const u6 = await store.unmergeEntity(c6.logId as number);
  assert.equal(u6.ok, true, "unmerge ok");
  const after = raw.prepare("SELECT entity_id FROM memory_entity WHERE memory_id = ? ORDER BY entity_id").all(mid) as Array<{ entity_id: number }>;
  assert.deepEqual(after.map((r) => r.entity_id).sort(), [eRedis, eVault].sort(), "P1 fixed: BOTH links restored after roundtrip");
  console.log("step6 G4 double-link roundtrip: OK");

  // step 8 (G1) shares this pair: after unmerge, the pair must NOT auto-merge again.
  await put("RedisCluster still used here");
  const reRedis = entityIdByNorm("rediscluster") as number;
  assert.equal(reRedis, eRedis, "name resolves back to revived entity");
  const aliasLeak = raw.prepare("SELECT COUNT(*) as n FROM entity_merge_log WHERE kind = " + String.fromCharCode(39) + "alias" + String.fromCharCode(39) + " AND source_name = " + String.fromCharCode(39) + "rediscluster" + String.fromCharCode(39) + " AND target_entity_id = ?").get(eVault) as { n: number };
  assert.equal(aliasLeak.n, 0, "G1: override keeps the pair separate (no auto alias re-merge)");
  console.log("step8 G1 override no-auto-remerge: OK");
}

// --- step 7 (r77 audit G2/G3): guard branches ---
{
  const eVault = entityIdByNorm("keyvaultstore") as number;
  const same = await store.combineEntities(eVault, eVault);
  assert.equal(same.ok, false, "G2: same id rejected");
  const missing = await store.combineEntities(999999, eVault);
  assert.equal(missing.ok, false, "G2: nonexistent id rejected");
  const m2 = await store.combineEntities(entityIdByNorm("rediscluster") as number, eVault);
  assert.equal(m2.ok, true, "re-merge ok");
  const again = await store.combineEntities(Number((raw.prepare("SELECT id FROM entities WHERE name_norm = " + String.fromCharCode(39) + "rediscluster" + String.fromCharCode(39)).get() as { id: number }).id), eVault);
  assert.equal(again.ok, false, "G2: tombstoned entity rejected");
  await store.unmergeEntity(m2.logId as number);
  // G3: incomplete snapshot refused
  const badSnap = raw.prepare("INSERT INTO entity_merge_log (kind, source_name, target_entity_id, detail) VALUES (?, ?, ?, ?)").run("merge", "ghostx", eVault, JSON.stringify({ fromEntityId: 123 }));
  const rBad = await store.unmergeEntity(Number(badSnap.lastInsertRowid));
  assert.equal(rBad.ok, false, "G3: incomplete snapshot refused");
  const candRow = raw.prepare("SELECT id FROM entity_merge_log WHERE kind = " + String.fromCharCode(39) + "candidate" + String.fromCharCode(39) + " LIMIT 1").get() as { id: number } | undefined;
  if (candRow) { const rCand = await store.unmergeEntity(candRow.id); assert.equal(rCand.ok, false, "G3: non-merge kind refused by unmerge"); }
  console.log("step7 G2/G3 guard branches: OK");
}
store.close();
raw.close();
rmSync(dir, { recursive: true, force: true });
console.log("entity-merge.test.ts: all steps OK");
