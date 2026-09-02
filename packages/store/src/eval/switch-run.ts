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
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { CHAIN_SCHEMA_VERSION, eventHash, bootstrapAccessChain, type ChainEventRow } from "../access-chain";
import { AGE_BUCKETS, bucketHistogram } from "./day-buckets";
import { psi } from "./bgnbd";
import { loadObsFixture } from "./obs-fixtures";
import { decideSwitch, evaluateReadiness, type ReconcileVerdict, type SwitchCounters, type SwitchDecision, type SwitchPhase, type SwitchReadings, type SwitchRegistration } from "./switch-machine";
import { appendSwitchAction, emptySkipLedger, parseSkipLedger, tailStreak, type SkipLedger } from "./skip-ledger";

// lazy: import.meta.url is undefined inside the CJS CLI bundle (same as bgnbd/obs-fixtures).
function regPath(): string { return join(dirname(fileURLToPath(import.meta.url)), "..", "..", "fixtures", "switch-registration.json"); }

// ---------- registration (D3 impl-plan 6: thresholds as data with version + hash) ----------

export function loadSwitchRegistration(): { reg: SwitchRegistration; registrationHash: string } {
  const raw = readFileSync(regPath(), "utf8");
  const j = JSON.parse(raw) as SwitchRegistration & { schema: string };
  if (j.schema !== "anysearch/switch-registration@1") throw new Error("switch-registration: unknown schema " + String((j as { schema?: string }).schema));
  if (typeof j.version !== "number" || !j.c || !j.reconcile || !j.rollback || !j.freeze) throw new Error("switch-registration: malformed shape");
  const payload = JSON.stringify({ schema: j.schema, version: j.version, c: j.c, reconcile: j.reconcile, rollback: j.rollback, freeze: j.freeze });
  return { reg: j, registrationHash: createHash("sha256").update(payload).digest("hex").slice(0, 16) };
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
    if (rows.length === 0) return { readings: { activeRows: 0, fittableUnits: 0, windowDays: 0, psi: null }, degraded: false };
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
    const readings: SwitchReadings = { activeRows: rows.length, fittableUnits: fittable, windowDays, psi: psiVal };
    const degraded = fittable > 0 && psiVal !== null && psiVal >= reg.c.c3PsiMax;
    return { readings, degraded };
  } finally { db.close(); }
}

// ---------- chain writer (D7: chain first, ledger second; never silent) ----------

export const SWITCH_SENTINEL_SESSION = "switch-events-sentinel";
export type SwitchChainEventType = "stage-transition" | "rollback" | "freeze";

// Appends a switch event to the access_events hash chain in one IMMEDIATE transaction — the
// same head-read + insert discipline as recordAccessEventChained (session-store.ts). The
// sentinel session/row satisfies the FK (Q5 gap); it is archived + quarantined so no read
// path can surface it.
export function writeSwitchChainEvent(dbPath: string, eventType: SwitchChainEventType): { id: number; hash: string } {
  const db = new Database(dbPath);
  try {
    if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='access_events'").get()) throw new Error("access_events table missing — create the store first");
    const cols = new Set((db.prepare("PRAGMA table_info(access_events)").all() as { name: string }[]).map((c) => c.name));
    if (!cols.has("prev_hash")) throw new Error("access_events has no prev_hash column — run `ans access-chain bootstrap --apply` first");
    const go = db.transaction((): { id: number; hash: string } => {
      db.prepare("INSERT OR IGNORE INTO sessions (id, domain) VALUES (?, 'switch')").run(SWITCH_SENTINEL_SESSION);
      let rr = db.prepare("SELECT id FROM retrieval_results WHERE session_id = ?").get(SWITCH_SENTINEL_SESSION) as { id: number } | undefined;
      if (!rr) {
        const info = db.prepare("INSERT INTO retrieval_results (session_id, url, title, snippet, source, archived, quarantine) VALUES (?, 'ans://switch-events-sentinel', 'switch-events sentinel', 'ADR-0043 D5 sentinel row for chain events (rollback/freeze have no real memory_id)', 'ans', 1, 'switch-events-sentinel')").run(SWITCH_SENTINEL_SESSION);
        rr = { id: Number(info.lastInsertRowid) };
      }
      let anchor = db.prepare("SELECT genesis_hash FROM access_chain_anchor WHERE id = 1").get() as { genesis_hash: string } | undefined;
      if (!anchor) { bootstrapAccessChain(db); anchor = db.prepare("SELECT genesis_hash FROM access_chain_anchor WHERE id = 1").get() as { genesis_hash: string } | undefined; }
      if (!anchor) throw new Error("access-chain anchor unavailable");
      const last = db.prepare("SELECT id, memory_id, accessed_at, prev_hash, schema_version, event_type FROM access_events WHERE prev_hash IS NOT NULL ORDER BY id DESC LIMIT 1").get() as ChainEventRow | undefined;
      const prevHash = last ? eventHash(last) : anchor.genesis_hash;
      const info = db.prepare("INSERT INTO access_events (memory_id, prev_hash, schema_version, event_type) VALUES (?, ?, ?, ?)").run(rr.id, prevHash, CHAIN_SCHEMA_VERSION, eventType);
      const id = Number(info.lastInsertRowid);
      const row = db.prepare("SELECT id, memory_id, accessed_at, prev_hash, schema_version, event_type FROM access_events WHERE id = ?").get(id) as ChainEventRow;
      return { id, hash: eventHash(row) };
    });
    return go.immediate();
  } finally { db.close(); }
}

// ---------- ledger helpers ----------

function ledgerPathFor(outDir: string): string { return join(outDir, "skip-ledger.json"); }

function writeLedgerAtomic(path: string, ledger: SkipLedger): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(ledger, null, 2) + "\n", "utf8");
  renameSync(tmp, path);
}

const NEXT_PHASE: Record<SwitchPhase, SwitchPhase | null> = { S0: "S1", S1: "S2", S2: "S3", S3: "S3", S4: null };

// D7: the ledger state block is a materialized cache of the chain. On conflict the chain
// wins: replay stage-transition/rollback/freeze rows in order to recover the phase.
export function rebuildStateFromChain(dbPath: string): SkipLedger["state"] | null {
  if (!existsSync(dbPath)) return null;
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const rows = db.prepare("SELECT id, memory_id, accessed_at, prev_hash, schema_version, event_type FROM access_events WHERE event_type IN ('stage-transition','rollback','freeze') AND prev_hash IS NOT NULL ORDER BY id").all() as ChainEventRow[];
    let phase: SwitchPhase = "S0";
    let since: string | null = null;
    let lastRow: ChainEventRow | null = null;
    for (const r of rows) {
      if (r.event_type === "rollback") phase = "S1";
      else if (r.event_type === "freeze") phase = "S4";
      else phase = NEXT_PHASE[phase] ?? phase;
      since = r.accessed_at;
      lastRow = r;
    }
    if (!lastRow) return { phase: "S0", since: null, transitionId: null, evidenceHash: null };
    return { phase, since, transitionId: String(lastRow.id), evidenceHash: eventHash(lastRow) };
  } finally { db.close(); }
}

// ---------- orchestrator ----------

export interface AdvanceResult {
  decision: SwitchDecision;
  state: SkipLedger["state"];
  registrationHash: string;
  integrityError?: string;
}

export function advanceSwitch(opts: {
  outDir: string;
  dbPath: string;
  at?: string;
  reconcile?: ReconcileVerdict;
  readingsOverride?: SwitchReadings;
  degradedOverride?: boolean;
  integrityFailed?: string | null;
}): AdvanceResult {
  const at = opts.at ?? new Date().toISOString();
  const { reg, registrationHash } = loadSwitchRegistration();
  const ledgerPath = ledgerPathFor(opts.outDir);
  let ledger: SkipLedger;
  try {
    ledger = existsSync(ledgerPath) ? parseSkipLedger(readFileSync(ledgerPath, "utf8")) : emptySkipLedger();
  } catch (e) {
    // r110 SA-F-03/08: quarantine the unreadable/unknown-schema ledger aside; restart empty,
    // loud stderr. Never silently drop history.
    const q = ledgerPath.replace(/\.json$/, ".quarantined-" + at.replace(/[:.]/g, "-") + ".json");
    try { renameSync(ledgerPath, q); } catch { /* restart empty regardless */ }
    ledger = emptySkipLedger();
    console.error("[switch] ledger failed the @3 contract — quarantined to " + q + " (" + String((e as Error).message ?? e) + ")");
  }

  // D5 integrity lineage: with a chain present, a tampered/missing state block is a
  // fail-closed block, never a silent rebuild. When no chain events exist yet there is
  // nothing to be inconsistent with — boot state is fine (pointer field, not data loss).
  const chained = rebuildStateFromChain(opts.dbPath);
  if (chained && chained.transitionId !== null && ledger.state.transitionId !== chained.transitionId) {
    // Ledger disagrees with the chain -> rebuild from the chain and ledger the recovery.
    ledger.state = chained;
    appendSwitchAction(ledger, { at, kind: "check", from: chained.phase, to: chained.phase, reason: "state rebuilt from chain (chain wins, D7): transitionId=" + chained.transitionId });
    writeLedgerAtomic(ledgerPath, ledger);
  }

  const consumed = readConsumedReadings(opts.dbPath, reg);
  const readiness = evaluateReadiness(opts.readingsOverride ?? consumed?.readings ?? { activeRows: 0, fittableUnits: 0, windowDays: 0, psi: null }, reg);
  const counters: SwitchCounters = {
    readinessRounds: tailStreak(ledger.actions, (a) => a.kind === "readiness"),
    readinessMetStreak: tailStreak(ledger.actions, (a) => a.kind === "readiness" && a.reason.startsWith("C4 streak")),
    heavyConfirmStreak: tailStreak(ledger.actions, (a) => a.kind === "check" && a.to === "S2" && a.from === "S2"),
  };
  const decision = decideSwitch(ledger.state.phase, {
    readiness,
    reconcile: opts.reconcile,
    degraded: opts.degradedOverride ?? consumed?.degraded ?? false,
    integrityFailed: opts.integrityFailed ?? null,
    kMaxWarned: ledger.actions.some((a) => a.reason.includes("k_max reached")),
  }, counters, reg);

  if (decision.integrityBlock) {
    // Fail-closed: record the block; the caller treats integrityError as a hard stop.
    appendSwitchAction(ledger, { at, kind: "check", from: decision.from, to: decision.to, reason: decision.reason });
    writeLedgerAtomic(ledgerPath, ledger);
    return { decision, state: ledger.state, registrationHash, integrityError: decision.reason };
  }
  if (!decision.record) return { decision, state: ledger.state, registrationHash };

  if (decision.to !== decision.from) {
    // D7: chain event first (stage-transition covers check-driven moves like check-s3-s2;
    // rollback/freeze carry their own type), then the ledger state update.
    const chainType: SwitchChainEventType = decision.kind === "rollback" || decision.kind === "freeze" ? decision.kind : "stage-transition";
    const ev = writeSwitchChainEvent(opts.dbPath, chainType);
    ledger.state = { phase: decision.to, since: at, transitionId: String(ev.id), evidenceHash: ev.hash };
    appendSwitchAction(ledger, { at, kind: decision.kind, from: decision.from, to: decision.to, reason: decision.reason + " [registrationHash=" + registrationHash + " transitionId=" + ev.id + "]" });
    writeLedgerAtomic(ledgerPath, ledger);
    return { decision, state: ledger.state, registrationHash };
  }
  appendSwitchAction(ledger, { at, kind: decision.kind, from: decision.from, to: decision.to, reason: decision.reason + " [registrationHash=" + registrationHash + "]" });
  writeLedgerAtomic(ledgerPath, ledger);
  return { decision, state: ledger.state, registrationHash };
}

// ---------- `ans switch-state --verify` cross-check (D7) ----------

export function verifySwitchState(outDir: string, dbPath: string): { ok: boolean; detail: string } {
  const ledgerPath = ledgerPathFor(outDir);
  if (!existsSync(ledgerPath)) return { ok: false, detail: "skip-ledger.json absent at " + ledgerPath };
  const ledger = parseSkipLedger(readFileSync(ledgerPath, "utf8"));
  const st = ledger.state;
  if (st.transitionId === null) {
    return { ok: st.evidenceHash === null, detail: st.evidenceHash === null ? "boot state, no transition to verify (pass)" : "state has evidenceHash without a transitionId (corrupt)" };
  }
  if (!existsSync(dbPath)) return { ok: false, detail: "durable DB absent at " + dbPath + " — cannot verify" };
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const row = db.prepare("SELECT id, memory_id, accessed_at, prev_hash, schema_version, event_type FROM access_events WHERE id = ?").get(Number(st.transitionId)) as ChainEventRow | undefined;
    if (!row) return { ok: false, detail: "transition row id=" + st.transitionId + " not found in access_events" };
    const h = eventHash(row);
    return h === st.evidenceHash
      ? { ok: true, detail: "evidenceHash matches chain row " + st.transitionId }
      : { ok: false, detail: "evidenceHash MISMATCH: ledger " + st.evidenceHash + " != chain " + h + " — rebuild from chain (D7)" };
  } finally { db.close(); }
}
