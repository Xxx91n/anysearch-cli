// ADR-0044 r43 fixer tests: edge-typed replay equivalence, committed registration payload,
// PDP/PEP boundary, synthetic drill isolation, statistical guards, sentinel retirement, and
// lost-update regression.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { SqliteSessionStore } from "../src/session-store";
import { emptySkipLedger, parseSkipLedger, recordSkips, appendSwitchAction, readSkipLedger, writeSkipLedgerAtomic, withSkipLedgerLock, SKIP_LEDGER_SCHEMA } from "../src/eval/skip-ledger";
import { decideSwitch, evaluateReadiness, evaluateReconcile, mcnemar, SWITCH_EDGE_EVENTS, SWITCH_EDGE_TRANSITIONS, type SwitchCounters, type SwitchPhase, type SwitchReadings } from "../src/eval/switch-machine";
import { advanceSwitch, verifySwitchState, writeSwitchChainEvent, loadSwitchRegistration, rebuildStateFromChain, replaySwitchChain, switchEventTypeFor, probeSwitchIntegrity, SWITCH_REGISTRATION_HASH_EXPECTATION } from "../src/eval/switch-run";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return; }
  passed++;
}

const shipGateContractPath = join(process.cwd(), "..", "..", "scripts", "eval-integrity-contract.mjs");
assert(existsSync(shipGateContractPath) && readFileSync(shipGateContractPath, "utf8").includes("memory-eval integrity verdict failed (ADR-0044 D3 fail-closed)"), "ship-gate negative integrity contract is fail-closed");

const { reg, registrationHash } = loadSwitchRegistration();
assert(reg.c.c1MinActiveRows === 300 && reg.c.c4ConsecutivePromote === 3, "registration values land (300 rows / promote streak 3)");
assert(/^[0-9a-f]{64}$/.test(registrationHash), "registrationHash is full-length 64-hex");
assert(registrationHash === SWITCH_REGISTRATION_HASH_EXPECTATION, "registration digest matches independent pin");
assert(reg.c.c2SlaFrequencyPerDay === 0.25 && reg.reconcile.minDiscordantPairs === 10, "ADR-0044 D5 guards are registered");
assert(reg.c.c4ConsecutivePromote > reg.rollback.heavyConsecutiveConfirmations, "hysteresis: promote(3) > rollback(2)");
assert(reg.rollback.heavyConsecutiveConfirmations === 2, "rollback heavy N=2 pre-registered");

const mExact = mcnemar(7, 1);
assert(mExact.method === "exact" && Math.abs(mExact.p - 2 * 9 / 256) < 1e-12, "McNemar exact b=7,c=1 -> p=0.0703125");
const mChi = mcnemar(30, 10);
assert(mChi.method === "chi2" && mChi.p > 0 && mChi.p < 1, "McNemar chi2 for n_d>=25");
assert(Math.abs(mcnemar(0, 0).p - 1) < 1e-12, "no discordance -> p=1");

const c0 = (): SwitchCounters => ({ readinessRounds: 0, readinessMetStreak: 0, heavyConfirmStreak: 0 });
const met: SwitchReadings = { activeRows: 400, fittableUnits: 150, windowDays: 120, evaluationCount: 60, psi: 0.1 };
const unmet: SwitchReadings = { activeRows: 10, fittableUnits: 5, windowDays: 10, evaluationCount: 1, psi: 0.5 };

let d = decideSwitch("S0", { readiness: evaluateReadiness(unmet, reg), kMaxWarned: false }, c0(), reg);
assert(d.to === "S0" && d.kind === "readiness" && d.reason.includes("round 1"), "S0 unmet -> hold, round counter=1");
const dd1 = decideSwitch("S0", { readiness: evaluateReadiness(met, reg), kMaxWarned: false }, c0(), reg);
assert(dd1.to === "S0" && dd1.counters.readinessMetStreak === 1, "S0 met first time -> streak 1");
const dd3 = decideSwitch("S0", { readiness: evaluateReadiness(met, reg), kMaxWarned: false }, { readinessRounds: 4, readinessMetStreak: 2, heavyConfirmStreak: 0 }, reg);
assert(dd3.to === "S1" && dd3.kind === "stage-transition" && dd3.record, "S0 -> S1 on 3rd consecutive met (C4)");
const dadv = decideSwitch("S0", { readiness: evaluateReadiness({ activeRows: 0, fittableUnits: 0, windowDays: 0, evaluationCount: 0, psi: null }, reg), kMaxWarned: false }, c0(), reg);
assert(dadv.to === "S0" && dadv.record && dadv.counters.readinessRounds === 0, "S0 data-absent -> hold, counters untouched");
const dk = decideSwitch("S0", { readiness: evaluateReadiness(unmet, reg), kMaxWarned: false }, { readinessRounds: 9, readinessMetStreak: 0, heavyConfirmStreak: 0 }, reg);
assert(dk.record && dk.reason.includes("k_max reached"), "k_max -> WARN + human review");

const recon = evaluateReconcile({ concordant: 20, total: 20, psiDiff: 0.1, rankDisplacements: [0, 0, 1, 0, 1], discordantB: 6, discordantC: 5 }, reg);
assert(recon.equivalent && !recon.underpowered, "clean reconcile passes SESOI bands with n_d>=10");
assert(!recon.mcnemarWarn, "symmetric discordants -> no directional WARN");
const d12 = decideSwitch("S1", { reconcile: recon, kMaxWarned: false }, c0(), reg);
assert(d12.to === "S2" && d12.kind === "stage-transition", "S1 -> S2 when reconcile window opens");
const d23 = decideSwitch("S2", { reconcile: recon, kMaxWarned: false }, c0(), reg);
assert(d23.to === "S3" && d23.kind === "stage-transition", "S2 -> S3 on TOST-equivalent reconcile");

const lowN = evaluateReconcile({ concordant: 1, total: 1, psiDiff: 0.1, rankDisplacements: [0], discordantB: 2, discordantC: 1 }, reg);
assert(!lowN.equivalent && lowN.underpowered, "n_d < registered floor -> WARN, never a silent pass");
const dLow = decideSwitch("S1", { reconcile: lowN, kMaxWarned: false }, c0(), reg);
assert(dLow.to === "S1" && dLow.record && dLow.reason.includes("underpowered"), "underpowered S1 reconcile is ledgered WARN");

const bad = evaluateReconcile({ concordant: 10, total: 20, psiDiff: 0.9, rankDisplacements: [4, 4, 4], discordantB: 15, discordantC: 2 }, reg);
assert(!bad.equivalent && bad.mcnemarWarn, "broken reconcile: not equivalent + directional WARN (consumed worse)");
const dup = decideSwitch("S2", { reconcile: bad, kMaxWarned: false }, c0(), reg);
assert(dup.to === "S2" && dup.kind === "check" && dup.counters.heavyConfirmStreak === 1, "first heavy = Inconclusive hold (streak 1, not rollback)");
const dup2 = decideSwitch("S2", { reconcile: bad, kMaxWarned: false }, dup.counters, reg);
assert(dup2.to === "S1" && dup2.kind === "rollback", "second consecutive heavy -> rollback S2->S1");

const d32 = decideSwitch("S3", { degraded: true, kMaxWarned: false }, c0(), reg);
assert(d32.to === "S2" && d32.kind === "check" && d32.reason.includes("check-s3-s2"), "S3 single out-of-band -> Inconclusive hold S2");
const d34 = decideSwitch("S3", { freezeEvidence: { s3Days: 30, cleanReconciles: 3 }, kMaxWarned: false }, c0(), reg);
assert(d34.to === "S4" && d34.kind === "freeze", "S3 evidence-driven freeze -> S4");
const d42 = decideSwitch("S4", { degraded: true, kMaxWarned: false }, c0(), reg);
assert(d42.to === "S2" && d42.kind === "check", "S4 unfreeze -> S2");
const di = decideSwitch("S3", { integrityFailed: "hash-chain verify failed", kMaxWarned: false }, c0(), reg);
assert(di.integrityBlock && di.to === "S3" && di.kind === "check", "integrity fail-closed: phase unchanged, no rollback");
const d10 = decideSwitch("S1", { untrustworthyEvidence: true, kMaxWarned: false }, c0(), reg);
assert(d10.to === "S0" && d10.integrityBlock && d10.record, "S1 -> S0 reject edge for wholly untrustworthy evidence");

for (const eventType of SWITCH_EDGE_EVENTS) {
  const edge = SWITCH_EDGE_TRANSITIONS[eventType];
  assert(edge.from !== undefined && edge.to !== undefined, "edge " + eventType + " is closed and mapped");
}
assert(switchEventTypeFor("S0", "S1") === "promote-s0-s1", "S0->S1 edge type");
assert(switchEventTypeFor("S3", "S2") === "hold-s3-s2", "S3->S2 edge type");
assert(switchEventTypeFor("S4", "S2") === "unfreeze-s4-s2", "S4->S2 edge type");
assert(switchEventTypeFor("S2", "S1") === "rollback-s2-s1", "S2->S1 edge type");
assert(switchEventTypeFor("S3", "S4") === "freeze-s3-s4", "S3->S4 edge type");
assert(switchEventTypeFor("S1", "S0") === "reject-s1-s0", "S1->S0 edge type");

const v1 = { schema: "anysearch/gain-ledger@1", consecutiveWarn: 2, history: [{ at: "2026-01-01T00:00:00Z", tier: "warn", look: "a" }], resolutions: [], lastSkipKeys: ["a"] };
const u1 = parseSkipLedger(JSON.stringify(v1));
assert(u1.schema === SKIP_LEDGER_SCHEMA && u1.state.phase === "S0" && u1.state.since === "2026-01-01T00:00:00Z", "@1 -> @3 lossless upcast, S0 boot, earliest-history since");
const u2 = parseSkipLedger(JSON.stringify({ schema: "anysearch/gain-ledger@2", consecutiveWarn: 0, history: [{ at: "2026-01-02T00:00:00Z", tier: "warn", look: "x", track: "consumed", reasonCode: "gate-not-met" }], resolutions: [], lastSkipKeys: [] }));
assert(u2.schema === SKIP_LEDGER_SCHEMA && u2.state.phase === "S0" && u2.state.since === "2026-01-02T00:00:00Z", "@2 -> @3 upcast preserves earliest history since");
assert(u2.history[0]?.reasonCode === "gate-not-met", "@2 -> @3 upcast preserves reasonCode byte-for-byte");
assert(parseSkipLedger(JSON.stringify(u2)).state.phase === "S0", "@3 re-parse idempotent (round trip)");
try { parseSkipLedger('{"schema":"anysearch/gain-ledger@9"}'); assert(false, "@9 must throw"); } catch { passed++; }
try { parseSkipLedger(JSON.stringify({ schema: SKIP_LEDGER_SCHEMA, consecutiveWarn: 0, history: [], resolutions: [], state: { phase: "S9", since: null, transitionId: null, evidenceHash: null }, actions: [], revision: 0 })); assert(false, "bad phase must throw"); } catch { passed++; }

const l = emptySkipLedger();
assert(recordSkips(l, ["k|gate-not-met|x"], "t1") === 1, "skip streak 1");
appendSwitchAction(l, { at: "t2", kind: "rollback", from: "S2", to: "S1", reason: "rollback-s2-s1", provenance: "real" });
assert(l.consecutiveWarn === 1, "rollback action leaves skip streak untouched");
assert(l.history.length === 1 && l.actions.length === 1 && l.actions[0]?.provenance === "real", "rollback lives in actions with provenance");

const trackLedger = emptySkipLedger();
recordSkips(trackLedger, ["consumed-key"], "t1", { track: "consumed", reasonCode: "gate-not-met" });
const syntheticStreak = recordSkips(trackLedger, ["synthetic-key"], "t2", { track: "synthetic", reasonCode: "gate-not-met" });
assert(syntheticStreak === 0 && trackLedger.consecutiveWarn === 1, "synthetic gate-not-met never increments consumed three-streak");

const dir = mkdtempSync(join(tmpdir(), "ans-switch-"));
try {
  const dbPath = join(dir, "switch.db");
  const outDir = join(dir, "ship-gate");
  const store = new SqliteSessionStore(dbPath);
  store.close();

  const p1 = advanceSwitch({ outDir, dbPath, readingsOverride: met, degradedOverride: false });
  const p2 = advanceSwitch({ outDir, dbPath, readingsOverride: met, degradedOverride: false });
  const p3 = advanceSwitch({ outDir, dbPath, readingsOverride: met, degradedOverride: false });
  assert(p1.state.phase === "S0" && p1.state.transitionId === null, "S0 streak build does not transition");
  assert(p3.state.phase === "S1" && p3.state.transitionId !== null && p3.state.evidenceHash !== null, "S0 -> S1 promotion: chained + ledger state updated");
  void p2;

  const rebuilt = rebuildStateFromChain(dbPath);
  assert(rebuilt !== null && rebuilt.phase === p3.state.phase && rebuilt.evidenceHash === p3.state.evidenceHash, "rebuildStateFromChain replays to the ledger state (chain wins)");
  const replayed = replaySwitchChain(dbPath);
  assert(replayed?.phase === "S1" && replayed.evidenceHash === p3.state.evidenceHash, "replaySwitchChain total fold matches ledger");
  const v = verifySwitchState(outDir, dbPath);
  assert(v.ok, "--verify happy path");
  assert(probeSwitchIntegrity(outDir, dbPath).ok, "probeSwitchIntegrity wraps replay verification");
  const lp = join(outDir, "skip-ledger.json");
  const tampered = JSON.parse(readFileSync(lp, "utf8"));
  tampered.state.evidenceHash = "deadbeef" + "0".repeat(56);
  writeFileSync(lp, JSON.stringify(tampered, null, 2) + "\n");
  const v2 = verifySwitchState(outDir, dbPath);
  assert(!v2.ok && v2.detail.includes("MISMATCH"), "tampered ledger fails --verify (integrity fail-closed)");

  const edgeDir = mkdtempSync(join(tmpdir(), "ans-switch-edge-"));
  const edgeDbPath = join(edgeDir, "edge.db");
  const edgeStore = new SqliteSessionStore(edgeDbPath);
  edgeStore.close();
  const ev = writeSwitchChainEvent(edgeDbPath, "promote-s0-s1", "real");
  assert(ev.id > 0 && /^[0-9a-f]{64}$/.test(ev.hash), "chain event written + 64-hex hash");
  const ro = new Database(edgeDbPath, { readonly: true });
  const sentinel = ro.prepare("SELECT id FROM retrieval_results WHERE session_id = 'switch-events-sentinel'").get();
  assert(sentinel === undefined, "retired sentinel fake row is absent");
  const side = ro.prepare("SELECT event_type, provenance FROM switch_events WHERE access_event_id = ?").get(ev.id) as { event_type: string; provenance: string } | undefined;
  assert(side?.event_type === "promote-s0-s1" && side.provenance === "real", "switch_events carries edge + provenance");
  const ae = ro.prepare("SELECT memory_id, event_type FROM access_events WHERE id = ?").get(ev.id) as { memory_id: number | null; event_type: string };
  assert(ae.memory_id === null && ae.event_type === "promote-s0-s1", "switch access_events row uses NULL memory_id");
  ro.close();
  rmSync(edgeDir, { recursive: true, force: true });

  const drillDir = mkdtempSync(join(tmpdir(), "ans-switch-drill-"));
  const drillDbPath = join(drillDir, "drill.db");
  const drillStore = new SqliteSessionStore(drillDbPath);
  drillStore.close();
  const before = readSkipLedger(outDir);
  const drillOut = join(drillDir, "out");
  const drillResult = advanceSwitch({ mode: "drill", outDir: drillOut, dbPath: drillDbPath, readingsOverride: met });
  const drillLedger = readSkipLedger(drillOut);
  assert(drillResult.state.phase === "S0" && drillLedger.actions.at(-1)?.provenance === "drill", "drill action carries drill provenance");
  assert(readSkipLedger(outDir).revision === before.revision, "drill plane does not mutate real ledger");
  try {
    advanceSwitch({ mode: "drill", outDir: drillOut, dbPath: join(process.cwd(), "anysearch.db") });
    assert(false, "drill mode must reject non-scratch dbPath");
  } catch { passed++; }
  rmSync(drillDir, { recursive: true, force: true });

  const luDir = mkdtempSync(join(tmpdir(), "ans-switch-lock-"));
  withSkipLedgerLock(luDir, (ledger) => {
    recordSkips(ledger, ["lost-update-key"], "t1");
    writeSkipLedgerAtomic(luDir, ledger);
    return 0;
  });
  withSkipLedgerLock(luDir, (ledger) => {
    recordSkips(ledger, ["lost-update-key"], "t2");
    writeSkipLedgerAtomic(luDir, ledger);
    return 0;
  });
  const locked = readSkipLedger(luDir);
  assert(locked.history.length === 2 && locked.revision >= 2, "locked RMW preserves both writes and increments revision");
  rmSync(luDir, { recursive: true, force: true });
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log("eval-switch-state.test: " + passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
