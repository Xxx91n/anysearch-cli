// ADR-0040 D4/D7 item 1: golden vectors pin the writer-side canonical serializer byte-for-byte.
// 3 core + 2 boundary vectors (NIST KAT structure). Byte-equivalence to RFC 8785 is pinned by
// asserting the canonical JSON strings literally (ASCII keys in lexicographic order, §3.2.3).
import { canonicalEventJson, canonicalLegacyJson, eventHash, legacyDigest, genesisHash, CHAIN_FIELDS, LEGACY_FIELDS, type ChainEventRow } from "../src/access-chain.js";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return; }
  passed++;
}

const v1: ChainEventRow = { id: 1, memory_id: 42, accessed_at: "2026-01-01 00:00:00", prev_hash: "a".repeat(64), schema_version: 2, event_type: "access", source_label: "system" };
const v2: ChainEventRow = { id: 2, memory_id: 7, accessed_at: "2026-08-30 12:34:56", prev_hash: "5495a5e82619282e0da68eab2b3db25c99b78a514ffc7ff2cad8ca121af7bbeb", schema_version: 2, event_type: "access", source_label: "system" };
const v3: ChainEventRow = { id: 3, memory_id: 8, accessed_at: "2026-08-30 12:34:57", prev_hash: "997dfaae0d71099b88f63bbc047009f056eac6fc557c9244177382e8227c0b09", schema_version: 2, event_type: "access", source_label: "system" };

function main() {
  // Core 1–3: canonical bytes + chain hashes.
  assert(canonicalEventJson(v1) === '{"accessed_at":"2026-01-01 00:00:00","event_type":"access","id":1,"memory_id":42,"prev_hash":"' + "a".repeat(64) + '","schema_version":2,"source_label":"system"}', "v1 canonical bytes");
  assert(eventHash(v1) === "5495a5e82619282e0da68eab2b3db25c99b78a514ffc7ff2cad8ca121af7bbeb", "v1 hash");
  assert(eventHash(v2) === "997dfaae0d71099b88f63bbc047009f056eac6fc557c9244177382e8227c0b09", "v2 chains on v1 hash");
  assert(eventHash(v3) === "b3947e39bbd6cd93cba54bb113f813e588b0631c7123145ff6373295bb2164b5", "v3 chains on v2 hash");

  // Boundary 1: empty TEXT accessed_at stays in the hash input (no truthiness shortcut).
  const b1: ChainEventRow = { id: 9, memory_id: 1, accessed_at: "", prev_hash: "f".repeat(64), schema_version: 2, event_type: "access", source_label: "system" };
  assert(canonicalEventJson(b1) === '{"accessed_at":"","event_type":"access","id":9,"memory_id":1,"prev_hash":"' + "f".repeat(64) + '","schema_version":2,"source_label":"system"}', "boundary: empty TEXT serialized byte-exact");
  assert(eventHash(b1) === "68e6e89be6c4c9bab57ddf556eb76611183ff959a7b06bb6a633d92574ee0933", "boundary hash");

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
  assert(canonicalEventJson({ ...v1, source_label: null }) === '{"accessed_at":"2026-01-01 00:00:00","event_type":"access","id":1,"memory_id":42,"prev_hash":"' + "a".repeat(64) + '","schema_version":2,"source_label":null}', "NULL source_label serializes as JSON null");
  assert(reject({ ...v1, id: 1.5 }), "REAL id rejected");
  assert(reject({ ...v1, memory_id: NaN }), "NaN memory_id rejected");
  assert(reject({ ...v1, accessed_at: null as unknown as string }), "NULL accessed_at (non-nullable column) rejected");
  assert(canonicalEventJson({ ...v1, prev_hash: null }) === '{"accessed_at":"2026-01-01 00:00:00","event_type":"access","id":1,"memory_id":42,"prev_hash":null,"schema_version":2,"source_label":"system"}', "NULL prev_hash serializes as JSON null");

  console.log("access-chain-golden: " + passed + " passed, " + failed + " failed");
  process.exit(failed ? 1 : 0);
}
main();
