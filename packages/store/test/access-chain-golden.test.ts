// ADR-0040 D4/D7 item 1: golden vectors pin the writer-side canonical serializer byte-for-byte.
// 3 core + 2 boundary vectors (NIST KAT structure). Byte-equivalence to RFC 8785 is pinned by
// asserting the canonical JSON strings literally (ASCII keys in lexicographic order, §3.2.3).
import { canonicalEventJson, canonicalLegacyJson, eventHash, legacyDigest, genesisHash, CHAIN_FIELDS, LEGACY_FIELDS, type ChainEventRow } from "../src/access-chain.js";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return; }
  passed++;
}

const v1: ChainEventRow = { id: 1, memory_id: 42, accessed_at: "2026-01-01 00:00:00", prev_hash: "a".repeat(64), schema_version: 1, event_type: "access" };
const v2: ChainEventRow = { id: 2, memory_id: 7, accessed_at: "2026-08-30 12:34:56", prev_hash: "c11f4e3e7a0a91dbfcc0d9155675aa09b57c6b6b91654289d8276e11b141f023", schema_version: 1, event_type: "access" };
const v3: ChainEventRow = { id: 3, memory_id: 8, accessed_at: "2026-08-30 12:34:57", prev_hash: "098bb7da8c94e3a2e43603c2394bb4a014d99e88a7235c7eedfcb510daaf17de", schema_version: 1, event_type: "access" };

function main() {
  // Core 1–3: canonical bytes + chain hashes.
  assert(canonicalEventJson(v1) === '{"accessed_at":"2026-01-01 00:00:00","event_type":"access","id":1,"memory_id":42,"prev_hash":"' + "a".repeat(64) + '","schema_version":1}', "v1 canonical bytes");
  assert(eventHash(v1) === "c11f4e3e7a0a91dbfcc0d9155675aa09b57c6b6b91654289d8276e11b141f023", "v1 hash");
  assert(eventHash(v2) === "098bb7da8c94e3a2e43603c2394bb4a014d99e88a7235c7eedfcb510daaf17de", "v2 chains on v1 hash");
  assert(eventHash(v3) === "cd786235fa8ceaaad6af16a5a4b09bf71e8a0bc48343337549e77326c28ed587", "v3 chains on v2 hash");

  // Boundary 1: empty TEXT accessed_at stays in the hash input (no truthiness shortcut).
  const b1: ChainEventRow = { id: 9, memory_id: 1, accessed_at: "", prev_hash: "f".repeat(64), schema_version: 1, event_type: "access" };
  assert(canonicalEventJson(b1) === '{"accessed_at":"","event_type":"access","id":9,"memory_id":1,"prev_hash":"' + "f".repeat(64) + '","schema_version":1}', "boundary: empty TEXT serialized byte-exact");
  assert(eventHash(b1) === "faa8eb8213ae8622ab3161be2acd1bebc2d3f2b39a33fed263350103c7b42dab", "boundary hash");

  // Boundary 2: legacy 3-field canonical + aggregate digest + genesis.
  const l1 = { id: 5, memory_id: 11, accessed_at: "2025-05-05 05:05:05" };
  assert(canonicalLegacyJson(l1) === '{"accessed_at":"2025-05-05 05:05:05","id":5,"memory_id":11}', "legacy canonical bytes");
  const dg = legacyDigest([l1]);
  assert(dg === "eb9e76be7f8275a9649e79117e642c29dc9ab7e1ea6e09e2d5ae91ec9db7975f", "legacy digest pinned");
  assert(genesisHash(dg) === "a37b5a7c348992fbe51cb33475ff8dcb7feee8b2669893b7f8db3922a1619b2c", "genesis hash pinned");
  // Empty legacy set digest is deterministic (sha256 of empty input).
  assert(legacyDigest([]) === "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", "empty legacy digest = sha256('')");

  // RFC 8785 §3.2.3 cross-check: both field orders are ASCII lexicographic.
  assert(JSON.stringify([...CHAIN_FIELDS]) === JSON.stringify([...CHAIN_FIELDS].sort()), "CHAIN_FIELDS lexicographic (= RFC 8785 key order)");
  assert(JSON.stringify([...LEGACY_FIELDS]) === JSON.stringify([...LEGACY_FIELDS].sort()), "LEGACY_FIELDS lexicographic");

  // Whitelist boundary negatives (D7 gap item): REAL entering chain input is rejected, not hashed.
  const reject = (r: ChainEventRow) => { try { canonicalEventJson(r); return false; } catch { return true; } };
  assert(reject({ ...v1, schema_version: 1.5 }), "REAL schema_version rejected");
  assert(reject({ ...v1, id: 1.5 }), "REAL id rejected");
  assert(reject({ ...v1, memory_id: NaN }), "NaN memory_id rejected");
  assert(reject({ ...v1, accessed_at: null as unknown as string }), "NULL accessed_at (non-nullable column) rejected");
  assert(canonicalEventJson({ ...v1, prev_hash: null }) === '{"accessed_at":"2026-01-01 00:00:00","event_type":"access","id":1,"memory_id":42,"prev_hash":null,"schema_version":1}', "NULL prev_hash serializes as JSON null");

  console.log("access-chain-golden: " + passed + " passed, " + failed + " failed");
  process.exit(failed ? 1 : 0);
}
main();
