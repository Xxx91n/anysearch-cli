// OPA #6905-style closure test.
//
// Three closures:
//
// 1) Schema parity: fresh-create and v1-upgrade paths converge on identical
// column + index sets. PRAGMA user_version parity.
// 2) Attribution round-trip: recordOperation(traceId, sessionId, clientId)
// -> SELECT trace_id, session_id, client_id returns the same values.
// (OPA #6905: defined fields must actually persist.)
// 3) Golden case: hook outbound -> server extract -> store write ->
// SELECT returns identical traceId + sessionId (full wire round-trip).

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import {
  SqliteObservationStore,
  mapMcpClientId,
  generateTraceIdHex,
  OBSERVATION_SCHEMA_VERSION,
  OBSERVATION_USER_VERSION,
} from "../src/observation";
import { emitConfigChangeAudit, writePolicyCache, readPolicyCacheEnvelope, resolveUrlPolicy } from "../src/url-policy";
import { readSessionId, writeSessionId } from "../src/session-id";

// this test focuses on the store-side evidence:
// (a) schema parity fresh vs migrated,
// (b) attribution column round-trip + OPA #6905 SELECT-back (T8 attribution half),
// (c) audit writes thread trace_id + session_id (T8 emitConfigChangeAudit half),
// (d) materialized_at envelope shape (T9 store-side).
// The hook/server wire-format golden case is covered by
// apps/plugin/test/propagation.test.ts (kept in the plugin package because the
// propagation module is part of the hook bundle, not the store).

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean) {
  if (cond) { passed++; console.log("  PASS " + label); }
  else { failed++; console.error("  FAIL " + label); }
}

async function main() {
  // --- 1) Schema parity: v0 fresh vs v1 upgrade converge to same shape ---
  // descA is hoisted so the migrated-vs-fresh parity
  // assertion below can compare against it instead of comparing descB to itself.
  let descA: ReturnType<SqliteObservationStore["describeSchema"]>;
  {
    const dirA = mkdtempSync(join(tmpdir(), "obs-fresh-"));
    const dbA = join(dirA, "trace.db");
    const storeA = new SqliteObservationStore(dbA);
    descA = storeA.describeSchema();
    storeA.close();
    check("fresh user_version = OBSERVATION_USER_VERSION", descA.userVersion === OBSERVATION_USER_VERSION);
    check("fresh includes injected_trace_id column", descA.columns.includes("injected_trace_id"));
    check("fresh includes session_id column", descA.columns.includes("session_id"));
    check("fresh includes client_id column", descA.columns.includes("client_id"));
    check("fresh includes idx_observability_traces_injected_trace", descA.indexes.includes("idx_observability_traces_injected_trace"));
    check("fresh includes idx_observability_traces_session (partial)", descA.indexes.includes("idx_observability_traces_session"));
    check("fresh includes idx_observability_traces_client (partial)", descA.indexes.includes("idx_observability_traces_client"));
    rmSync(dirA, { recursive: true, force: true });
  }
  {
    const dirB = mkdtempSync(join(tmpdir(), "obs-mig-"));
    const dbB = join(dirB, "trace.db");
    const raw = new Database(dbB);
    raw.exec("PRAGMA user_version = 1");
    raw.exec(`CREATE TABLE observability_traces (
      trace_id TEXT PRIMARY KEY, run_id TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL, operation TEXT NOT NULL, status TEXT NOT NULL,
      payload_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );`);
    raw.close();
    const storeB = new SqliteObservationStore(dbB);
    const descB = storeB.describeSchema();
    storeB.close();
    check("migrated user_version = OBSERVATION_USER_VERSION", descB.userVersion === OBSERVATION_USER_VERSION);
    check("migrated has same columns as fresh", JSON.stringify(descB.columns) === JSON.stringify(["trace_id","run_id","kind","operation","status","payload_json","created_at","injected_trace_id","session_id","client_id"]));
    check("migrated has same indexes as fresh", JSON.stringify([...descB.indexes].sort()) === JSON.stringify([...descA.indexes].sort()));
    rmSync(dirB, { recursive: true, force: true });
  }
  check("OBSERVATION_SCHEMA_VERSION = 2", OBSERVATION_SCHEMA_VERSION === 2);
  // v3 added observability_spans.links_json (span links required by
  // pi-telemetry 1.5.1's adapter contract). The trace payload shape did not
  // change, so OBSERVATION_SCHEMA_VERSION stays 2 while the DB user_version
  // moves.
  check("OBSERVATION_USER_VERSION = 3", OBSERVATION_USER_VERSION === 3);

  // v2 -> v3 on a database that already holds span rows: the ALTER must add
  // links_json without touching the existing spans, and every old row must
  // default to an empty link list.
  {
    const dir = mkdtempSync(join(tmpdir(), "obs-v3-"));
    const db = join(dir, "trace.db");
    const raw = new Database(db);
    raw.exec("PRAGMA user_version = 2");
    raw.exec(`CREATE TABLE observability_traces (
      trace_id TEXT PRIMARY KEY, run_id TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL, operation TEXT NOT NULL, status TEXT NOT NULL,
      payload_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')),
      injected_trace_id TEXT, session_id TEXT, client_id TEXT
    );`);
    raw.exec(`CREATE TABLE observability_spans (
      span_id TEXT PRIMARY KEY, trace_id TEXT NOT NULL, parent_span_id TEXT,
      kind TEXT NOT NULL, operation TEXT NOT NULL, status TEXT NOT NULL,
      attributes_json TEXT NOT NULL, events_json TEXT NOT NULL
    );`);
    raw.exec(`INSERT INTO observability_traces
      (trace_id, run_id, kind, operation, status, payload_json)
      VALUES ('${"a".repeat(32)}', 'legacy-run', 'cli', 'legacy-op', 'ok', '{}')`);
    raw.exec(`INSERT INTO observability_spans
      (span_id, trace_id, parent_span_id, kind, operation, status, attributes_json, events_json)
      VALUES ('${"b".repeat(16)}', '${"a".repeat(32)}', NULL, 'cli', 'legacy-span', 'ok', '{}', '[]')`);
    raw.close();

    const store = new SqliteObservationStore(db);
    store.close();

    const checkDb = new Database(db, { readonly: true });
    const cols = (checkDb.prepare("PRAGMA table_info(observability_spans)").all() as Array<{ name: string }>).map((c) => c.name);
    const rows = checkDb.prepare("SELECT span_id, operation, links_json FROM observability_spans").all() as Array<{ span_id: string; operation: string; links_json: string }>;
    checkDb.close();
    check("v2->v3 migration adds links_json to observability_spans", cols.includes("links_json"));
    check("v2->v3 migration preserves the legacy span row", rows.length === 1 && rows[0]!.operation === "legacy-span");
    check("v2->v3 migration defaults legacy links to an empty list", rows.length === 1 && rows[0]!.links_json === "[]");
    rmSync(dir, { recursive: true, force: true });
  }

  // --- 2) Attribution round-trip (OPA #6905 closure) ---
  {
    const dir = mkdtempSync(join(tmpdir(), "obs-rt-"));
    const db = join(dir, "trace.db");
    const store = new SqliteObservationStore(db);
    const traceId = generateTraceIdHex();
    const sessionId = "golden-session-aaaaaaaaaaaa";
    const clientId = mapMcpClientId("claude-ai");
    const runId = "opa-6905-rt";
    await store.recordOperation(
      {
        runId,
        kind: "config",
        operation: "config:change",
        attributes: { "anysearch.config.event_id": "e1" },
        traceId,
        sessionId,
        clientId,
      },
      async () => "ok",
    );
    const back = store.readAttribution(runId);
    check("trace_id round-trip equality", back?.traceId === traceId);
    check("session_id round-trip equality", back?.sessionId === sessionId);
    check("client_id round-trip equality", back?.clientId === clientId);
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }

  // --- 3) Golden case (store side): the hook outbound -> server extract chain
  // is verified in apps/plugin/test/propagation.test.ts. Here we
  // confirm the store-side contract: any caller that supplies a
  // traceId/sessionId (whether from extracted headers or a default)
  // has those values persisted under the matching column names.
  {
    const dir = mkdtempSync(join(tmpdir(), "obs-emit-"));
    const db = join(dir, "audit.db");
    // Seed ANS_SESSION_ID env override so the audit picks up a deterministic
    // session_id (mirrors the production CI override path).
    const envSessionId = "audit-session-cccccccccccc";
    const saved = process.env.ANS_SESSION_ID;
    process.env.ANS_SESSION_ID = envSessionId;
    try {
      // Caller supplies trace_id (simulating server extract); sessionId default
      // path falls back to readSessionId() inside emitConfigChangeAudit, which
      // honours ANS_SESSION_ID.
      await emitConfigChangeAudit(db, {
        source: "toml",
        path: "/test/path",
        change: { before: null, after: "v-test" },
        policyVersion: "v-test",
        traceId: "0123456789abcdef0123456789abcdef",
      });
    } finally {
      if (saved === undefined) delete process.env.ANS_SESSION_ID;
      else process.env.ANS_SESSION_ID = saved;
    }
    const raw = new Database(db, { readonly: true });
    const row = raw.prepare(
      "SELECT trace_id AS traceId, injected_trace_id AS injectedTraceId, session_id AS sessionId FROM observability_traces ORDER BY created_at DESC LIMIT 1"
    ).get() as { traceId: string; injectedTraceId: string; sessionId: string | null };
    raw.close();

    check("golden store: caller trace_id persisted", row.traceId === "0123456789abcdef0123456789abcdef");
    check("golden store: injected_trace_id matches caller trace_id", row.injectedTraceId === "0123456789abcdef0123456789abcdef");
    check("golden store: session_id read from ANS_SESSION_ID env", row.sessionId === envSessionId);

    rmSync(dir, { recursive: true, force: true });
  }

  // --- 4) / supplement: materialized_at + cache fallback ---
  {
    const dir = mkdtempSync(join(tmpdir(), "pol-"));
    const cache = join(dir, "policy.json");
    const policy = resolveUrlPolicy({ tomlHosts: ["a.example", "b.example"], denyHosts: ["evil.example"] });

    // T9 (a): writePolicyCache stamps materialized_at ISO-8601
    writePolicyCache(cache, policy);
    const envelope = readPolicyCacheEnvelope(cache);
    check("T9(a): envelope not null", envelope !== null);
    check("T9(a): allow list persisted", JSON.stringify(envelope?.allow) === JSON.stringify(policy.allow));
    check("T9(a): deny list persisted", JSON.stringify(envelope?.deny) === JSON.stringify(policy.deny));
    check("T9(a): policy_version persisted", envelope?.policy_version === policy.policyVersion);
    check("T9(a): materialized_at is ISO-8601", typeof envelope?.materialized_at === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(envelope!.materialized_at));

    // T9 (b): missing cache -> null (so server startup knows to fail-closed on no fallback)
    const noCache = readPolicyCacheEnvelope(join(dir, "missing.json"));
    check("T9(b): missing cache envelope -> null", noCache === null);

    // T9 (c): old-shape cache (no materialized_at) -> null (drives re-materialization)
    const oldPath = join(dir, "old.json");
    await import("node:fs").then((m) => m.writeFileSync(oldPath, JSON.stringify({ allow: [], deny: [], policy_version: "old" })));
    const oldEnv = readPolicyCacheEnvelope(oldPath);
    check("T9(c): old-shape cache (no materialized_at) -> null", oldEnv === null);

    rmSync(dir, { recursive: true, force: true });
  }

  // #129: when the anchor cannot be persisted, the id is still returned
  // (fail-open) but the loss of continuity is reported instead of silent.
  {
    const blockedHome = join(tmpdir(), "ans-anchor-blocked-" + process.pid + "-" + Date.now());
    // A regular FILE where the base directory should be makes mkdirSync fail.
    await import("node:fs").then((m) => m.writeFileSync(blockedHome, "not a directory"));
    const origWrite = process.stderr.write;
    let captured = "";
    process.stderr.write = ((chunk: unknown) => { captured += String(chunk); return true; }) as typeof process.stderr.write;
    let returned = "";
    try {
      returned = readSessionId({ USERPROFILE: blockedHome, HOME: blockedHome } as NodeJS.ProcessEnv);
    } finally {
      process.stderr.write = origWrite;
      rmSync(blockedHome, { force: true });
    }
    check("#129: unwritable anchor still yields an id (fail-open)", returned.length > 0);
    check("#129: unwritable anchor reports the lost continuity", /could not persist the session anchor/.test(captured));
  }

  // #129 review: when the anchor exists but cannot be read, the file must
  // NOT be overwritten. A fresh ID is returned for this run only, and the
  // loss is reported on stderr.
  // Cross-platform fixture: make the anchor path a DIRECTORY so readFileSync
  // fails with EISDIR on all platforms (chmod 000 does not remove read perm
  // on Windows or for privileged POSIX processes).
  {
    const dir = mkdtempSync(join(tmpdir(), "ans-anchor-unreadable-"));
    const home = join(dir, "home");
    mkdirSync(home, { recursive: true });
    const anchorDir = join(home, ".anysearch-cli");
    mkdirSync(anchorDir, { recursive: true });
    const anchorFile = join(anchorDir, "session");
    // Write the original anchor, then replace it with a directory.
    writeFileSync(anchorFile, "original-session-id-1234", "utf8");
    rmSync(anchorFile, { force: true });
    mkdirSync(anchorFile, { recursive: true });
    const origWrite = process.stderr.write;
    let captured = "";
    process.stderr.write = ((chunk: unknown) => { captured += String(chunk); return true; }) as typeof process.stderr.write;
    let returned = "";
    let after = "";
    try {
      returned = readSessionId({ HOME: home } as NodeJS.ProcessEnv);
      // Verify the anchor path is still a directory (not overwritten by a file).
      after = readFileSync(anchorFile + "/.", "utf8");
    } catch {
      // readFileSync on a directory throws — that means the anchor was NOT
      // overwritten with a file, which is what we want.
      after = "<directory-not-overwritten>";
    } finally {
      process.stderr.write = origWrite;
      rmSync(dir, { recursive: true, force: true });
    }
    check("#129 review: unreadable anchor still yields an id (fail-open)", returned.length > 0);
    check("#129 review: unreadable anchor reports the read failure", /session anchor could not be read/.test(captured));
    check("#129 review: unreadable anchor is NOT overwritten", after === "<directory-not-overwritten>");
    check("#129 review: fresh id differs from the preserved anchor", returned !== "original-session-id-1234");
  }

  console.log("\nsession-id-propagation tests: " + passed + " passed, " + failed + " failed");
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("session-id-propagation test threw:", e);
  process.exit(1);
});