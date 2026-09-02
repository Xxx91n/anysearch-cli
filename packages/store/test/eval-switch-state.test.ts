// ADR-0043 r42 impl tests: transition matrix, @2->@3 upcast round-trip, rollback no-streak,
// hysteresis anti-flap, integrity fail-closed, chain evidence + --verify, fixture drills.
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { SqliteSessionStore } from "../src/session-store";
import { emptySkipLedger, parseSkipLedger, recordSkips, appendSwitchAction, SKIP_LEDGER_SCHEMA } from "../src/eval/skip-ledger";
import { decideSwitch, evaluateReadiness, evaluateReconcile, mcnemar, type SwitchCounters, type SwitchReadings } from "../src/eval/switch-machine";
import { advanceSwitch, verifySwitchState, writeSwitchChainEvent, loadSwitchRegistration, rebuildStateFromChain } from "../src/eval/switch-run";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) { if (!cond) { failed++; console.error("FAIL: " + msg); return; } passed++; }

// ---- pre-registered thresholds are DATA (plan-6) ----
const { reg, registrationHash } = loadSwitchRegistration();
assert(reg.c.c1MinActiveRows === 300 && reg.c.c4ConsecutivePromote === 3, "registration values land (300 rows / promote streak 3)");
assert(/^[0-9a-f]{16}$/.test(registrationHash), "registrationHash is 16-hex");
assert(reg.c.c4ConsecutivePromote > reg.rollback.heavyConsecutiveConfirmations, "hysteresis: promote(3) > rollback(2)");
assert(reg.rollback.heavyConsecutiveConfirmations === 2, "rollback heavy N=2 pre-registered");

// ---- McNemar scipy semantics ----
const mExact = mcnemar(7, 1);
assert(mExact.method === "exact" && Math.abs(mExact.p - 2 * 9 / 256) < 1e-12, "McNemar exact b=7,c=1 -> p=0.0703125");
const mChi = mcnemar(30, 10);
assert(mChi.method === "chi2" && mChi.p > 0 && mChi.p < 1, "McNemar chi2 for n_d>=25");
assert(Math.abs(mcnemar(0, 0).p - 1) < 1e-12, "no discordance -> p=1");

// ---- transition matrix (pure, no IO) ----
const c0 = (): SwitchCounters => ({ readinessRounds: 0, readinessMetStreak: 0, heavyConfirmStreak: 0 });
const met: SwitchReadings = { activeRows: 400, fittableUnits: 150, windowDays: 120, psi: 0.1 };
const unmet: SwitchReadings = { activeRows: 10, fittableUnits: 5, windowDays: 10, psi: 0.5 };

let d = decideSwitch("S0", { readiness: evaluateReadiness(unmet, reg), kMaxWarned: false }, c0(), reg);
assert(d.to === "S0" && d.kind === "readiness" && d.reason.includes("round 1"), "S0 unmet -> hold, round counter=1");
const dd1 = decideSwitch("S0", { readiness: evaluateReadiness(met, reg), kMaxWarned: false }, c0(), reg);
assert(dd1.to === "S0" && dd1.counters.readinessMetStreak === 1, "S0 met first time -> streak 1");
const dd3 = decideSwitch("S0", { readiness: evaluateReadiness(met, reg), kMaxWarned: false }, { readinessRounds: 4, readinessMetStreak: 2, heavyConfirmStreak: 0 }, reg);
assert(dd3.to === "S1" && dd3.kind === "stage-transition" && dd3.record, "S0 -> S1 on 3rd consecutive met (C4)");
const dadv = decideSwitch("S0", { readiness: evaluateReadiness({ activeRows: 0, fittableUnits: 0, windowDays: 0, psi: null }, reg), kMaxWarned: false }, c0(), reg);
assert(dadv.to === "S0" && dadv.record && dadv.counters.readinessRounds === 0, "S0 data-absent -> hold, counters untouched");
const dk = decideSwitch("S0", { readiness: evaluateReadiness(unmet, reg), kMaxWarned: false }, { readinessRounds: 9, readinessMetStreak: 0, heavyConfirmStreak: 0 }, reg);
assert(dk.record && dk.reason.includes("k_max reached"), "k_max -> WARN + human review");

const recon = evaluateReconcile({ concordant: 20, total: 20, psiDiff: 0.1, rankDisplacements: [0, 0, 1, 0, 1], discordantB: 1, discordantC: 1 }, reg);
assert(recon.equivalent, "clean reconcile passes SESOI bands");
assert(!recon.mcnemarWarn, "symmetric discordants -> no directional WARN");
const d12 = decideSwitch("S1", { reconcile: recon, kMaxWarned: false }, c0(), reg);
assert(d12.to === "S2" && d12.kind === "stage-transition", "S1 -> S2 when reconcile window opens");
const d23 = decideSwitch("S2", { reconcile: recon, kMaxWarned: false }, c0(), reg);
assert(d23.to === "S3" && d23.kind === "stage-transition", "S2 -> S3 on TOST-equivalent reconcile");

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

// ---- ledger @3: upcast + unknown-version fail-loud + round trip ----
const v1 = { schema: "anysearch/gain-ledger@1", consecutiveWarn: 2, history: [{ at: "2026-01-01T00:00:00Z", tier: "warn", look: "a" }], resolutions: [], lastSkipKeys: ["a"] };
const u1 = parseSkipLedger(JSON.stringify(v1));
assert(u1.schema === SKIP_LEDGER_SCHEMA && u1.state.phase === "S0" && u1.state.since === "2026-01-01T00:00:00Z", "@1 -> @3 lossless upcast, S0 boot, earliest-history since");
const u2 = parseSkipLedger(JSON.stringify({ schema: "anysearch/gain-ledger@2", consecutiveWarn: 0, history: [], resolutions: [], lastSkipKeys: [] }));
assert(u2.schema === SKIP_LEDGER_SCHEMA && u2.state.phase === "S0" && u2.state.since === null, "@2 -> @3 upcast, null since on empty history");
assert(parseSkipLedger(JSON.stringify(u2)).state.phase === "S0", "@3 re-parse idempotent (round trip)");
try { parseSkipLedger('{"schema":"anysearch/gain-ledger@9"}'); assert(false, "@9 must throw"); } catch { passed++; }
try { parseSkipLedger(JSON.stringify({ schema: SKIP_LEDGER_SCHEMA, consecutiveWarn: 0, history: [], resolutions: [], state: { phase: "S9", since: null, transitionId: null, evidenceHash: null }, actions: [] })); assert(false, "bad phase must throw"); } catch { passed++; }

// ---- rollback is an action, never a skip (leaf-through) ----
const l = emptySkipLedger();
assert(recordSkips(l, ["k|gate-not-met|x"], "t1") === 1, "skip streak 1");
appendSwitchAction(l, { at: "t2", kind: "rollback", from: "S2", to: "S1", reason: "rollback-s2-to-s1" });
assert(l.consecutiveWarn === 1, "rollback action leaves skip streak untouched");
assert(l.history.length === 1 && l.actions.length === 1, "rollback lives in actions, not history");

// ---- IO: chain sentinel + ledger + rebuild + verify on a scratch DB ----
const dir = mkdtempSync(join(tmpdir(), "ans-switch-"));
try {
  const dbPath = join(dir, "switch.db");
  const outDir = join(dir, "ship-gate");
  const store = new SqliteSessionStore(dbPath); // constructor runs schema + chain bootstrap
  store.close();

  // fixture drill: rehearsal drives the machinery via readings overrides; a true verdict can
  // never come from the synthetic track (ADR-0043 D3) — the drill only lifts S0 counters.
  const p1 = advanceSwitch({ outDir, dbPath, readingsOverride: met, degradedOverride: false });
  const p2 = advanceSwitch({ outDir, dbPath, readingsOverride: met, degradedOverride: false });
  const p3 = advanceSwitch({ outDir, dbPath, readingsOverride: met, degradedOverride: false });
  assert(p1.state.phase === "S0" && p1.state.transitionId === null, "S0 streak build does not transition");
  assert(p3.state.phase === "S1" && p3.state.transitionId !== null && p3.state.evidenceHash !== null, "S0 -> S1 promotion: chained + ledger state updated");
  void p2;

  const rebuilt = rebuildStateFromChain(dbPath);
  assert(rebuilt !== null && rebuilt.phase === p3.state.phase && rebuilt.evidenceHash === p3.state.evidenceHash, "rebuildStateFromChain replays to the ledger state (chain wins)");

  const v = verifySwitchState(outDir, dbPath);
  assert(v.ok, "--verify happy path");
  const lp = join(outDir, "skip-ledger.json");
  const tampered = JSON.parse(readFileSync(lp, "utf8"));
  tampered.state.evidenceHash = "deadbeef" + "0".repeat(56);
  writeFileSync(lp, JSON.stringify(tampered, null, 2) + "\n");
  const v2 = verifySwitchState(outDir, dbPath);
  assert(!v2.ok && v2.detail.includes("MISMATCH"), "tampered ledger fails --verify (integrity fail-closed)");

  const ev = writeSwitchChainEvent(dbPath, "stage-transition");
  assert(ev.id > 0 && /^[0-9a-f]{64}$/.test(ev.hash), "chain event written + 64-hex hash");
  const ro = new Database(dbPath, { readonly: true });
  const srow = ro.prepare("SELECT archived, quarantine FROM retrieval_results WHERE session_id = 'switch-events-sentinel'").get() as { archived: number; quarantine: string } | undefined;
  assert(srow !== undefined && srow.archived === 1 && srow.quarantine === "switch-events-sentinel", "sentinel archived + quarantined (invisible to read paths)");
  ro.close();

} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log("eval-switch-state.test: " + passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
