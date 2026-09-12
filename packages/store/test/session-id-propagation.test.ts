// ADR-0056 D-005: OPA #6905-style closure test.
//
// Three closures:
//
// 1) Schema parity: fresh-create and v1-upgrade paths converge on identical
//    column + index sets. PRAGMA user_version parity.
// 2) Attribution round-trip: recordOperation(traceId, sessionId, clientId)
//    -> SELECT trace_id, session_id, client_id returns the same values.
//    (OPA #6905: defined fields must actually persist.)
// 3) Golden case: hook outbound -> server extract -> store write ->
//    SELECT returns identical traceId + sessionId (full wire round-trip).

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
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

// ADR-0056 D-005: this test focuses on the store-side evidence:
// (a) schema parity fresh vs migrated (T7),
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
  // N-2 (audit rework): descA is hoisted so the migrated-vs-fresh parity
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
  check("OBSERVATION_USER_VERSION = 2", OBSERVATION_USER_VERSION === 2);

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
  //           is verified in apps/plugin/test/propagation.test.ts. Here we
  //           confirm the store-side contract: any caller that supplies a
  //           traceId/sessionId (whether from extracted headers or a default)
  //           has those values persisted under the matching column names.
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

  // --- 4) ADR-0056 D-007 / ADR-0055 D6 supplement: materialized_at + cache fallback ---
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

  console.log("\nsession-id-propagation tests: " + passed + " passed, " + failed + " failed");
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("session-id-propagation test threw:", e);
  process.exit(1);
});