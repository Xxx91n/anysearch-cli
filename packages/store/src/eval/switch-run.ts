// ADR-0043 D3/D5/D7 (r42 impl): switch orchestrator — IO shell around the pure decision core
// (switch-machine.ts). Owns: registration loading, consumed-track readings from the durable
// DB, chain event writes (sentinel FK solution), ledger atomic updates, chain reconstruction
// fallback, and the --verify cross-check for `ans switch-state`.
//
// Q5 gaps fixed this round: rollback events satisfy the access_events FK via a sentinel
// sessions/retrieval_results row (archived + quarantined, invisible to read paths); the
// consecutive-count first values land in fixtures/switch-registration.json
// (promote=3 > rollback=2 hysteresis; k_max=10).
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { CHAIN_SCHEMA_VERSION, eventHash, bootstrapAccessChain, type ChainEventRow } from "../access-chain";
import { AGE_BUCKETS, bucketHistogram } from "./day-buckets";
import { psi } from "./bgnbd";
import { loadObsFixture } from "./obs-fixtures";
import { decideSwitch, evaluateReadiness, SWITCH_EDGE_EVENTS, SWITCH_EDGE_TRANSITIONS, type ReconcileVerdict, type SwitchCounters, type SwitchDecision, type SwitchEdgeEventType, type SwitchPhase, type SwitchReadings, type SwitchRegistration } from "./switch-machine";
import { appendSwitchAction, quarantineSkipLedger, readSkipLedger, tailStreak, withSkipLedgerLock, writeSkipLedgerAtomic, type SkipLedger } from "./skip-ledger";

// lazy: import.meta.url is undefined inside the CJS CLI bundle (same as bgnbd/obs-fixtures).
function regPath(): string {
  // r116 fix: tests must be able to point the loader at a mutated copy without writing
  // through the bundle's relative path. The env override is the only place outside the
  // shipped fixtures that is allowed to influence the loader's read target.
  const override = process.env.ANS_SWITCH_REG_PATH;
  if (typeof override === "string" && override.length > 0) return override;
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..", "fixtures", "switch-registration.json");
}

// ---------- registration (D3 impl-plan 6: thresholds as data with version + hash) ----------

// ADR-0044 D2: this expectation is the independent pin. The loader's self-computed digest is
// only allowed to be compared against it; a mismatch is an integrity failure, not a re-record.
export const SWITCH_REGISTRATION_HASH_EXPECTATION = "5f06ea1766b5999c3c2213b33cb324c988efc91336553056cb8dcb9faf63d2cb";

export class SwitchRegistrationIntegrityError extends Error {}

export function loadSwitchRegistration(): { reg: SwitchRegistration; registrationHash: string } {
  const raw = readFileSync(regPath(), "utf8");
  const j = JSON.parse(raw) as SwitchRegistration & { schema: string };
  if (j.schema !== "anysearch/switch-registration@1") throw new Error("switch-registration: unknown schema " + String((j as { schema?: string }).schema));
  if (typeof j.version !== "number" || !j.c || !j.reconcile || !j.rollback || !j.freeze) throw new Error("switch-registration: malformed shape");
  const payload = JSON.stringify({ schema: j.schema, version: j.version, c: j.c, reconcile: j.reconcile, rollback: j.rollback, freeze: j.freeze });
  const registrationHash = createHash("sha256").update(payload).digest("hex");
  if (registrationHash !== SWITCH_REGISTRATION_HASH_EXPECTATION) {
    throw new SwitchRegistrationIntegrityError("integrity-fail-registration: payload digest " + registrationHash + " != pinned expectation " + SWITCH_REGISTRATION_HASH_EXPECTATION);
  }
  return { reg: j, registrationHash };
}

// ---------- consumed-track readings (durable DB only; eval temp DBs never reach here) ----------

export interface ConsumedReadings { readings: SwitchReadings; degraded: boolean }

export function readConsumedReadings(dbPath: string, reg: SwitchRegistration): ConsumedReadings | null {
  if (!existsSync(dbPath)) return null;
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const tables = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((t) => t.name));
    if (!tables.has("access_events")) return null;
    const rows = db.prepare("SELECT memory_id, accessed_at FROM access_events WHERE event_type IS NULL OR event_type = 'access'").all() as { memory_id: number; accessed_at: string }[];
    if (rows.length === 0) return { readings: { activeRows: 0, fittableUnits: 0, windowDays: 0, evaluationCount: 0, psi: null }, degraded: false };
    const perUnit = new Map<number, number>();
    const ages: number[] = [];
    const now = Date.now();
    let first = Number.POSITIVE_INFINITY, last = 0;
    for (const r of rows) {
      perUnit.set(r.memory_id, (perUnit.get(r.memory_id) ?? 0) + 1);
      const t = Date.parse(r.accessed_at.endsWith("Z") ? r.accessed_at : r.accessed_at + "Z");
      if (Number.isFinite(t)) { if (t < first) first = t; if (t > last) last = t; ages.push((now - t) / 86400000); }
    }
    let fittable = 0;
    for (const n of perUnit.values()) if (n >= 2) fittable++;
    const windowDays = Number.isFinite(first) && last > first ? Math.round(((last - first) / 86400000) * 100) / 100 : 0;
    // C3: PSI of the consumed age histogram vs the pre-registered synthetic baseline fixture.
    let psiVal: number | null = null;
    try {
      const fx = loadObsFixture(reg.c.c3BaselineFixture);
      const hist = bucketHistogram(ages);
      const p = psi(AGE_BUCKETS.map((b) => fx.baselineHistogram[b.id] ?? 0), AGE_BUCKETS.map((b) => hist[b.id] ?? 0));
      psiVal = Number.isNaN(p) ? null : p;
    } catch { psiVal = null; }
    // C1 mirrors the runner's T1 shape: activeRows = total event rows.
    const readings: SwitchReadings = { activeRows: rows.length, fittableUnits: fittable, windowDays, evaluationCount: rows.length, psi: psiVal };
    const degraded = fittable > 0 && psiVal !== null && psiVal >= reg.c.c3PsiMax;
    return { readings, degraded };
  } finally { db.close(); }
}

// ---------- chain writer (D7: chain first, ledger second; never silent) ----------

export type SwitchChainEventType = SwitchEdgeEventType;
export const SWITCH_CHAIN_EVENT_TYPES: readonly string[] = SWITCH_EDGE_EVENTS;

function isScratchPath(p: string): boolean {
  const abs = resolve(p);
  const root = resolve(tmpdir());
  return abs === root || abs.startsWith(root + sep);
}

function assertScratchMode(mode: "real" | "drill", dbPath: string, outDir: string): void {
  if (mode !== "drill") return;
  if (!isScratchPath(dbPath) || !isScratchPath(outDir)) {
    throw new Error("integrity-fail-drill-plane: drill mode requires scratch dbPath/outDir; dbPath=" + dbPath + " outDir=" + outDir);
  }
}

// Appends a switch edge to the access_events hash chain in one IMMEDIATE transaction. The
// switch_events side table carries edge provenance without changing the six hashed fields.
export function writeSwitchChainEvent(dbPath: string, eventType: SwitchChainEventType, provenance: "real" | "drill" = "real"): { id: number; hash: string } {
  const db = new Database(dbPath);
  try {
    if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='access_events'").get()) throw new Error("access_events table missing — create the store first");
    const cols = new Set((db.prepare("PRAGMA table_info(access_events)").all() as { name: string }[]).map((c) => c.name));
    if (!cols.has("prev_hash")) throw new Error("access_events has no prev_hash column — run `ans access-chain bootstrap --apply` first");
    const go = db.transaction((): { id: number; hash: string } => {
      let anchor = db.prepare("SELECT genesis_hash FROM access_chain_anchor WHERE id = 1").get() as { genesis_hash: string } | undefined;
      if (!anchor) { bootstrapAccessChain(db); anchor = db.prepare("SELECT genesis_hash FROM access_chain_anchor WHERE id = 1").get() as { genesis_hash: string } | undefined; }
      if (!anchor) throw new Error("access-chain anchor unavailable");
      const last = db.prepare("SELECT id, memory_id, accessed_at, prev_hash, schema_version, event_type FROM access_events WHERE prev_hash IS NOT NULL ORDER BY id DESC LIMIT 1").get() as ChainEventRow | undefined;
      const prevHash = last ? eventHash(last) : anchor.genesis_hash;
      const info = db.prepare("INSERT INTO access_events (memory_id, prev_hash, schema_version, event_type) VALUES (NULL, ?, ?, ?)").run(prevHash, CHAIN_SCHEMA_VERSION, eventType);
      const id = Number(info.lastInsertRowid);
      const row = db.prepare("SELECT id, memory_id, accessed_at, prev_hash, schema_version, event_type FROM access_events WHERE id = ?").get(id) as ChainEventRow;
      db.prepare("INSERT INTO switch_events (access_event_id, event_type, provenance) VALUES (?, ?, ?)").run(id, eventType, provenance);
      return { id, hash: eventHash(row) };
    });
    return go.immediate();
  } finally { db.close(); }
}

export interface ReplayedSwitchChain {
  phase: SwitchPhase;
  transitionId: string | null;
  evidenceHash: string | null;
  since: string | null;
}

// ADR-0044 D1: total replay over the closed edge set. Every edge maps to exactly one phase;
// an inapplicable edge or unknown event_type is a hard error, never a guessed rebuild.
export function replaySwitchChain(dbPath: string): ReplayedSwitchChain | null {
  if (!existsSync(dbPath)) return null;
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    // ADR-0044 D1 + r115 audit C6: legacy r42 event_type values are not in the per-edge
    // closed set and must fail loud (migrations belong to the operator, not the replay
    // function). Detected up front so the loop below only sees canonical edges.
    const legacy = db.prepare("SELECT id, event_type FROM access_events WHERE event_type IN ('stage-transition','rollback','freeze') AND prev_hash IS NOT NULL LIMIT 1").all() as { id: number; event_type: string }[];
    if (legacy.length > 0) {
      throw new Error("integrity-fail-replay: legacy switch event_type " + legacy[0]!.event_type + " (id=" + legacy[0]!.id + ") — migration required before this DB can be replayed");
    }
    const rows = db.prepare("SELECT id, memory_id, accessed_at, prev_hash, schema_version, event_type FROM access_events WHERE event_type IN (" + SWITCH_CHAIN_EVENT_TYPES.map(() => "?").join(",") + ") AND prev_hash IS NOT NULL ORDER BY id").all(...[...SWITCH_CHAIN_EVENT_TYPES]) as ChainEventRow[];
    let phase: SwitchPhase = "S0";
    let since: string | null = null;
    let lastRow: ChainEventRow | null = null;
    for (const r of rows) {
      const edge = SWITCH_EDGE_TRANSITIONS[r.event_type as SwitchEdgeEventType];
      if (!edge) throw new Error("integrity-fail-replay: unknown switch event_type " + r.event_type);
      if (phase !== edge.from) throw new Error("integrity-fail-replay: inapplicable edge " + r.event_type + " at " + phase + " (expected from " + edge.from + ")");
      phase = edge.to;
      since = r.accessed_at;
      lastRow = r;
    }
    if (!lastRow) return { phase: "S0", since: null, transitionId: null, evidenceHash: null };
    return { phase, since, transitionId: String(lastRow.id), evidenceHash: eventHash(lastRow) };
  } finally { db.close(); }
}

export function rebuildStateFromChain(dbPath: string): SkipLedger["state"] | null {
  if (!existsSync(dbPath)) return null;
  const replayed = replaySwitchChain(dbPath);
  if (!replayed) return null;
  return { phase: replayed.phase, since: replayed.since, transitionId: replayed.transitionId, evidenceHash: replayed.evidenceHash };
}

// ---------- orchestrator ----------

export interface AdvanceResult {
  decision: SwitchDecision;
  state: SkipLedger["state"];
  registrationHash: string;
  integrityError?: string;
}

export function switchEventTypeFor(from: SwitchPhase, to: SwitchPhase): SwitchEdgeEventType {
  for (const eventType of SWITCH_EDGE_EVENTS) {
    const edge = SWITCH_EDGE_TRANSITIONS[eventType];
    if (edge.from === from && edge.to === to) return eventType;
  }
  throw new Error("integrity-fail-transition: no registered edge from " + from + " to " + to);
}

function evaluationCountFromLedger(ledger: SkipLedger): number {
  return ledger.actions.filter((a) => a.kind === "readiness").length;
}

export function advanceSwitch(opts: {
  outDir: string;
  dbPath: string;
  at?: string;
  mode?: "real" | "drill";
  reconcile?: ReconcileVerdict;
  readingsOverride?: SwitchReadings;
  degradedOverride?: boolean;
  integrityFailed?: string | null;
  untrustworthyEvidence?: boolean;
}): AdvanceResult {
  const at = opts.at ?? new Date().toISOString();
  const mode = opts.mode ?? "real";
  assertScratchMode(mode, opts.dbPath, opts.outDir);

  let reg: SwitchRegistration;
  let registrationHash: string;
  try {
    ({ reg, registrationHash } = loadSwitchRegistration());
  } catch (e) {
    return withSkipLedgerLock(opts.outDir, (ledger) => {
      const reason = String((e as Error).message ?? e);
      const decision: SwitchDecision = { from: ledger.state.phase, to: ledger.state.phase, kind: "check", record: true, reason, integrityBlock: true, counters: { readinessRounds: 0, readinessMetStreak: 0, heavyConfirmStreak: 0 } };
      appendSwitchAction(ledger, { at, kind: decision.kind, from: decision.from, to: decision.to, reason: decision.reason, provenance: mode });
      writeSkipLedgerAtomic(opts.outDir, ledger);
      return { decision, state: ledger.state, registrationHash: "integrity-fail-registration", integrityError: reason };
    });
  }

  return withSkipLedgerLock(opts.outDir, (ledger) => {
    let replayed: ReplayedSwitchChain | null;
    try {
      replayed = replaySwitchChain(opts.dbPath);
    } catch (e) {
      const reason = String((e as Error).message ?? e);
      quarantineSkipLedger(opts.outDir, at);
      const fresh = readSkipLedger(opts.outDir);
      const decision: SwitchDecision = { from: fresh.state.phase, to: fresh.state.phase, kind: "check", record: true, reason, integrityBlock: true, counters: { readinessRounds: 0, readinessMetStreak: 0, heavyConfirmStreak: 0 } };
      appendSwitchAction(fresh, { at, kind: decision.kind, from: decision.from, to: decision.to, reason: decision.reason, provenance: mode });
      writeSkipLedgerAtomic(opts.outDir, fresh);
      return { decision, state: fresh.state, registrationHash, integrityError: reason };
    }

    // ADR-0043 D7 / ADR-0044 D1 chain-wins: rebuild the ledger state from the chain
    // whenever chain and ledger disagree, regardless of which side carries a transition.
    // The previous logic only rebuilt when the chain had a transition, leaving the
    // ledger-has-but-chain-has-not direction stuck in an infinite quarantine loop.
    const chainPhase = replayed ? replayed.phase : "S0";
    const chainTransitionId = replayed ? replayed.transitionId : null;
    const chainEvidenceHash = replayed ? replayed.evidenceHash : null;
    const chainSince = replayed ? replayed.since : null;
    const ledgerHasTransition = ledger.state.transitionId !== null;
    const chainHasTransition = chainTransitionId !== null;
    const mismatch =
      ledger.state.phase !== chainPhase ||
      ledger.state.transitionId !== chainTransitionId ||
      ledger.state.evidenceHash !== chainEvidenceHash;
    if ((ledgerHasTransition || chainHasTransition) && mismatch) {
      const reason = "integrity-fail-replay: ledger state disagrees with chain replay (chain=" + chainPhase + ":" + chainTransitionId + ", ledger=" + ledger.state.phase + ":" + ledger.state.transitionId + ") — chain wins, rebuilding state";
      ledger.state = { phase: chainPhase, since: chainSince, transitionId: chainTransitionId, evidenceHash: chainEvidenceHash };
      appendSwitchAction(ledger, { at, kind: "check", from: ledger.state.phase, to: ledger.state.phase, reason, provenance: mode });
      writeSkipLedgerAtomic(opts.outDir, ledger);
      // fall through; the orchestrator below will read the recovered state
    }

    const consumed = readConsumedReadings(opts.dbPath, reg);
    const baseReadings = opts.readingsOverride ?? consumed?.readings ?? { activeRows: 0, fittableUnits: 0, windowDays: 0, evaluationCount: 0, psi: null };
    const readiness = evaluateReadiness(opts.readingsOverride ? baseReadings : { ...baseReadings, evaluationCount: evaluationCountFromLedger(ledger) }, reg);
    const counters: SwitchCounters = {
      readinessRounds: tailStreak(ledger.actions, (a) => a.kind === "readiness" && !a.reason.startsWith("data-absent")),
      readinessMetStreak: tailStreak(ledger.actions, (a) => a.kind === "readiness" && a.reason.startsWith("C4 streak")),
      heavyConfirmStreak: tailStreak(ledger.actions, (a) => a.kind === "check" && a.to === "S2" && a.from === "S2"),
    };
    const decision = decideSwitch(ledger.state.phase, {
      readiness,
      reconcile: opts.reconcile,
      degraded: opts.degradedOverride ?? consumed?.degraded ?? false,
      integrityFailed: opts.integrityFailed ?? null,
      untrustworthyEvidence: opts.untrustworthyEvidence ?? false,
      kMaxWarned: ledger.actions.some((a) => a.reason.includes("k_max reached")),
    }, counters, reg);

    if (decision.integrityBlock) {
      if (decision.to !== decision.from) {
        const chainType = switchEventTypeFor(decision.from, decision.to);
        const ev = writeSwitchChainEvent(opts.dbPath, chainType, mode);
        ledger.state = { phase: decision.to, since: at, transitionId: String(ev.id), evidenceHash: ev.hash };
        appendSwitchAction(ledger, { at, kind: decision.kind, from: decision.from, to: decision.to, reason: decision.reason + " [registrationHash=" + registrationHash + " transitionId=" + ev.id + "]", provenance: mode });
        writeSkipLedgerAtomic(opts.outDir, ledger);
        return { decision, state: ledger.state, registrationHash, integrityError: decision.reason };
      }
      appendSwitchAction(ledger, { at, kind: decision.kind, from: decision.from, to: decision.to, reason: decision.reason, provenance: mode });
      writeSkipLedgerAtomic(opts.outDir, ledger);
      return { decision, state: ledger.state, registrationHash, integrityError: decision.reason };
    }
    if (!decision.record) return { decision, state: ledger.state, registrationHash };

    if (decision.to !== decision.from) {
      const chainType = switchEventTypeFor(decision.from, decision.to);
      const ev = writeSwitchChainEvent(opts.dbPath, chainType, mode);
      ledger.state = { phase: decision.to, since: at, transitionId: String(ev.id), evidenceHash: ev.hash };
      appendSwitchAction(ledger, { at, kind: decision.kind, from: decision.from, to: decision.to, reason: decision.reason + " [registrationHash=" + registrationHash + " transitionId=" + ev.id + "]", provenance: mode });
      writeSkipLedgerAtomic(opts.outDir, ledger);
      return { decision, state: ledger.state, registrationHash };
    }
    appendSwitchAction(ledger, { at, kind: decision.kind, from: decision.from, to: decision.to, reason: decision.reason + " [registrationHash=" + registrationHash + "]", provenance: mode });
    writeSkipLedgerAtomic(opts.outDir, ledger);
    return { decision, state: ledger.state, registrationHash };
  });
}

export function probeSwitchIntegrity(outDir: string, dbPath: string): { ok: boolean; detail: string } {
  try {
    return verifySwitchState(outDir, dbPath);
  } catch (e) {
    return { ok: false, detail: String((e as Error).message ?? e) };
  }
}

export function verifySwitchState(outDir: string, dbPath: string): { ok: boolean; detail: string } {
  const ledger = readSkipLedger(outDir);
  if (ledger.state.transitionId === null && ledger.state.evidenceHash === null) {
    if (!existsSync(dbPath)) return { ok: true, detail: "boot state, no transition to verify (pass)" };
    const replayed = replaySwitchChain(dbPath);
    if (!replayed || replayed.transitionId === null) return { ok: true, detail: "boot state, no transition to verify (pass)" };
    return { ok: false, detail: "chain has transition " + replayed.transitionId + " but ledger is boot state" };
  }
  const st = ledger.state;
  if (!existsSync(dbPath)) return { ok: false, detail: "durable DB absent at " + dbPath + " — cannot verify" };
  const replayed = replaySwitchChain(dbPath);
  if (!replayed || replayed.transitionId === null) return { ok: false, detail: "ledger has transition " + st.transitionId + " but chain has no replayable transition" };
  if (replayed.phase !== st.phase) return { ok: false, detail: "phase MISMATCH: ledger " + st.phase + " != chain replay " + replayed.phase };
  if (replayed.transitionId !== st.transitionId) return { ok: false, detail: "transitionId MISMATCH: ledger " + st.transitionId + " != chain replay " + replayed.transitionId };
  if (replayed.evidenceHash !== st.evidenceHash) return { ok: false, detail: "evidenceHash MISMATCH: ledger " + st.evidenceHash + " != chain " + replayed.evidenceHash + " — rebuild from chain (D7)" };
  return { ok: true, detail: "replay matches ledger phase " + replayed.phase + " at transitionId " + replayed.transitionId };
}
