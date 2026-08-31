#!/usr/bin/env node
// scripts/verify-access-events.mjs
// ADR-0040 D2/D5: independent verifier for the access_events tamper-evidence chain.
// Deliberately re-implements the canonicalization from scratch (ADR-0040 _Avoid_ 3: no shared
// serialization code with the writer). Node stdlib + better-sqlite3 only (resolved through the
// store package because pnpm does not hoist it to the root).
//
// Spec (verbatim from ADR-0040 D4/D3):
//   chain fields   = ["accessed_at","event_type","id","memory_id","prev_hash","schema_version"]
//   legacy fields  = ["accessed_at","id","memory_id"]
//   canonical JSON = JSON.stringify of an object literal whose keys are inserted in the fixed
//                    order above (ASCII lexicographic = RFC 8785 key order for this closed schema)
//   event hash     = sha256 hex of the canonical JSON
//   legacy digest  = sha256 hex over concat of (legacyRowCanonicalJson + "\n") in id order
//   genesis_hash   = sha256 hex of "access-chain-genesis:" + digest
//   first chained row carries prev_hash = genesis_hash; every later row chains on the prior hash
//
// Exit codes (D5): 0 = whole chain verifies; 1 = proven negative / broken / malformed / unknown
// schema_version; 2 = no database (caller maps to explicit skip + ledger). Never sampled (full
// O(n)); never WARN.

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "packages", "store", "package.json"));

const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const CHAIN_FIELDS = ["accessed_at", "event_type", "id", "memory_id", "prev_hash", "schema_version"];
const LEGACY_FIELDS = ["accessed_at", "id", "memory_id"];
const GENESIS_PREFIX = "access-chain-genesis:";
// Whitelist (D4): TEXT (string), INTEGER (integer number), NULL only in the three nullable columns.
function assertScalar(k, v) {
  if (v === null) {
    if (k === "prev_hash" || k === "schema_version" || k === "event_type") return;
    throw new Error("NULL not allowed for " + k);
  }
  if (typeof v === "string") return;
  if (typeof v === "number" && Number.isInteger(v) && (k === "id" || k === "memory_id" || k === "schema_version")) return;
  throw new Error("non-whitelisted value for " + k + " (type " + typeof v + ")");
}
const canonical = (row, fields) => {
  const o = {};
  for (const k of fields) { const v = row[k]; assertScalar(k, v); o[k] = v; }
  return JSON.stringify(o);
};

function fail(msg) {
  process.stdout.write(JSON.stringify({ verdict: "FAILED", error: msg }) + "\n");
  process.exit(1);
}

function main() {
  // ADR-0041 D1: resolution order --db <path> -> positional argv -> ANS_DB_PATH -> default path.
  const flagIdx = process.argv.indexOf("--db");
  const dbPath = (flagIdx !== -1 ? process.argv[flagIdx + 1] : undefined) ?? process.argv[2] ?? process.env.ANS_DB_PATH ?? path.join(process.env.USERPROFILE || process.env.HOME || ".", ".anysearch", "anysearch.db");
  const t0 = performance.now();
  if (!fs.existsSync(dbPath)) {
    process.stdout.write(JSON.stringify({ verdict: "NO_DATABASE", dbPath }) + "\n");
    process.exit(2);
  }
  const Database = require("better-sqlite3");
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('access_events','access_chain_anchor','retrieval_results')").all().map((r) => r.name);
    if (!tables.includes("access_events")) fail("access_events table missing (schema absent) — refusing false-pass");
    const cols = new Set(db.prepare("PRAGMA table_info(access_events)").all().map((c) => c.name));
    for (const c of [...CHAIN_FIELDS]) if (!cols.has(c)) fail("access_events." + c + " missing — chain column absent (verify cannot run on pre-upgrade schema)");

    const rows = db.prepare("SELECT id, memory_id, accessed_at, prev_hash, schema_version, event_type FROM access_events ORDER BY id").all();
    const legacy = [], chained = [];
    for (const r of rows) (r.prev_hash === null ? legacy : chained).push(r);

    const anchor = tables.includes("access_chain_anchor")
      ? db.prepare("SELECT digest, genesis_hash, created_at FROM access_chain_anchor WHERE id = 1").get() ?? null
      : null;
    if (!anchor && chained.length === 0 && legacy.length === 0) fail("no events and no anchor — no evidence to verify (FALSE-PASS refused)");
    if (!anchor) fail(chained.length > 0 ? "chained rows exist but access_chain_anchor is missing" : "chain anchor missing (bootstrap never completed) — refusing false-pass");

    // Segment 1: legacy snapshot — recompute aggregate digest, byte-for-byte comparison.
    let legacyDigest;
    try {
      const h = createHash("sha256");
      for (const r of legacy) {
        if (r.schema_version !== null) fail("event #" + r.id + ": legacy row (prev_hash NULL) carries schema_version " + r.schema_version + " — malformed segment boundary");
        h.update(canonical(r, LEGACY_FIELDS) + "\n", "utf8");
      }
      legacyDigest = h.digest("hex");
    } catch (e) { fail("legacy row canonicalization failed at first error: " + e.message); }
    if (legacyDigest !== anchor.digest) fail("legacy digest mismatch: recomputed " + legacyDigest + " != anchor " + anchor.digest + " (legacy history tampered or added post-cutover)");

    // Segment 2: genesis + chained walk (ORDER BY id only — never by timestamp).
    const genesis = sha(GENESIS_PREFIX + anchor.digest);
    if (genesis !== anchor.genesis_hash) fail("genesis_hash mismatch: recomputed " + genesis + " != anchor " + anchor.genesis_hash);
    // Fork detection first (sibling rows sharing a prev_hash) — a fork would otherwise
    // surface only as a generic chain break on the later sibling.
    const seenPrev = new Map();
    for (const r of chained) {
      const ids = seenPrev.get(r.prev_hash) ?? [];
      ids.push(r.id);
      seenPrev.set(r.prev_hash, ids);
      if (ids.length > 1) fail("fork detected: " + ids.length + " rows share prev_hash " + r.prev_hash + " (ids " + ids.join(",") + ")");
    }
    let expected = genesis;
    let chainedOk = 0;
    for (const r of chained) {
      try { canonical(r, CHAIN_FIELDS); } catch (e) { fail("event #" + r.id + ": canonicalization failed: " + e.message); }
      if (r.schema_version !== 1) fail("event #" + r.id + ": unknown schema_version " + r.schema_version + " (explicit error per D7; newer verifier required)");
      if (r.prev_hash !== expected) fail("chain break at event #" + r.id + ": prev_hash " + r.prev_hash + " != expected " + expected);
      expected = sha(canonical(r, CHAIN_FIELDS));
      chainedOk++;
    }
    const ms = Math.round((performance.now() - t0) * 1000) / 1000;
    process.stdout.write(JSON.stringify({
      verdict: "PASSED", dbPath,
      legacyRows: legacy.length, chainedRows: chainedOk,
      digest: anchor.digest, genesis_hash: anchor.genesis_hash,
      durationMs: ms, rowsPerSec: ms > 0 ? Math.round((legacy.length + chainedOk) / (ms / 1000)) : null,
    }) + "\n");
    process.exit(0);
  } finally { db.close(); }
}

main();
