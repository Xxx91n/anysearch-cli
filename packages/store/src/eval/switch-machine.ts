// ADR-0043 D2-D6 (r42 impl): consumed/synthetic switch state machine - pure decision core.
// No fs / no db here: IO lives in switch-run.ts; this module is the audit surface
// (CertiK FSM discipline: the transition table is enumerable and unit-testable).
// Stats precedent (atomcode r42 research): evaluation gates hand-roll these two small
// functions over scipy semantics (wasmagent-js / mcNemar-nlp); there is no maintained
// JS TOST/McNemar package worth trusting as a gate dependency.

export type SwitchPhase = "S0" | "S1" | "S2" | "S3" | "S4";
export const SWITCH_PHASES: readonly SwitchPhase[] = ["S0", "S1", "S2", "S3", "S4"];

// ---------- stats primitives ----------

// Error function, Abramowitz & Stegun 7.1.26 (|err| <= 1.5e-7 — fine for a WARN diagnostic).
export function erf(x: number): number {
  const s = Math.sign(x);
  const t = 1 / (1 + 0.327591 * Math.abs(x));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}

// Upper-tail p-value of a chi-square statistic with 1 df = erfc(sqrt(x/2)).
export function chi2P1(x: number): number {
  return 1 - erf(Math.sqrt(x / 2));
}

// McNemar discordant-pair test, statsmodels semantics:
// n_d < 25 -> exact binomial p = min(1, 2 * P(X <= min(b,c))), X ~ Bin(n_d, 0.5)
// n_d >= 25 -> chi-square with Yates continuity correction, 1 df.
export function mcnemar(b: number, c: number): { p: number; method: "exact" | "chi2" } {
  const n = b + c;
  if (n === 0) return { p: 1, method: "exact" };
  if (n < 25) {
    const m = Math.min(b, c);
    let sum = 0;
    for (let k = 0; k <= m; k++) { let comb = 1; for (let j = 0; j < k; j++) comb = (comb * (n - j)) / (j + 1); sum += comb; }
    return { p: Math.min(1, 2 * sum / Math.pow(2, n)), method: "exact" };
  }
  const x = Math.pow(Math.abs(b - c) - 1, 2) / n;
  return { p: chi2P1(x), method: "chi2" };
}

// ---------- pre-registered table (D3: data, not code constants) ----------

export interface SwitchRegistration {
  schema: "anysearch/switch-registration@1";
  version: number;
  c: { c1MinActiveRows: number; c1MinFittableUnits: number; c2MinWindowDays: number; c3PsiMax: number; c3BaselineFixture: string; c4ConsecutivePromote: number; c4kMaxRounds: number };
  reconcile: { tierConcordanceMin: number; psiDiffMax: number; rankDisplacementMedianMax: number; rankDisplacementP95Max: number; mcnemarExactBelowN: number; mcnemarWarnAlpha: number };
  rollback: { heavyConsecutiveConfirmations: number };
  freeze: { s3MinWindowDays: number; consecutiveCleanReconciles: number };
}

// ---------- D3: S0 -> S1 readiness (C1 before C3: PSI grows with sample size) ----------

export interface SwitchReadings { activeRows: number; fittableUnits: number; windowDays: number; psi: number | null }
export interface ReadinessVerdict { c1: boolean; c2: boolean; c3: boolean; allMet: boolean; dataAbsent: boolean; detail: string }

export function evaluateReadiness(r: SwitchReadings, reg: SwitchRegistration): ReadinessVerdict {
  // D1/D3 data-absent contract: no events, or events but zero fit-eligible units.
  const dataAbsent = r.activeRows === 0 || r.fittableUnits === 0;
  const c1 = r.activeRows >= reg.c.c1MinActiveRows && r.fittableUnits >= reg.c.c1MinFittableUnits;
  const c2 = r.windowDays >= reg.c.c2MinWindowDays;
  const c3 = r.psi !== null && Number.isFinite(r.psi) && r.psi < reg.c.c3PsiMax;
  const detail = "C1 " + r.activeRows + " rows/" + r.fittableUnits + " units (>=" + reg.c.c1MinActiveRows + "/" + reg.c.c1MinFittableUnits + ") " + (c1 ? "OK" : "FAIL") + "; C2 window " + r.windowDays + "d>=" + reg.c.c2MinWindowDays + "d " + (c2 ? "OK" : "FAIL") + "; C3 PSI " + (r.psi === null ? "n/a" : r.psi.toFixed(4)) + "<" + reg.c.c3PsiMax + " " + (c3 ? "OK" : "FAIL");
  return { c1, c2, c3, allMet: c1 && c2 && c3 && !dataAbsent, dataAbsent, detail };
}

// ---------- D4: S2 reconcile = banded equivalence; McNemar diagnostic only ----------

export interface ReconcileInput {
  concordant: number;
  total: number;
  psiDiff: number;
  rankDisplacements: number[];
  discordantB: number; // synthetic right, consumed wrong
  discordantC: number; // consumed right, synthetic wrong
}
export interface ReconcileVerdict { equivalent: boolean; failures: string[]; mcnemarP: number; mcnemarMethod: string; mcnemarWarn: boolean; detail: string }

export function median(a: number[]): number {
  if (a.length === 0) return 0;
  const s = [...a].sort((x, y) => x - y);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}
export function percentile95(a: number[]): number {
  if (a.length === 0) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)]!;
}

export function evaluateReconcile(i: ReconcileInput, reg: SwitchRegistration): ReconcileVerdict {
  const failures: string[] = [];
  const rate = i.total === 0 ? 0 : i.concordant / i.total;
  if (rate < reg.reconcile.tierConcordanceMin) failures.push("tier concordance " + rate.toFixed(4) + " < " + reg.reconcile.tierConcordanceMin);
  if (!(i.psiDiff <= reg.reconcile.psiDiffMax)) failures.push("PSI diff " + i.psiDiff + " > " + reg.reconcile.psiDiffMax);
  const med = median(i.rankDisplacements);
  const p95 = percentile95(i.rankDisplacements);
  if (med > reg.reconcile.rankDisplacementMedianMax) failures.push("rank displacement median " + med + " > " + reg.reconcile.rankDisplacementMedianMax);
  if (p95 > reg.reconcile.rankDisplacementP95Max) failures.push("rank displacement p95 " + p95 + " > " + reg.reconcile.rankDisplacementP95Max);
  const mc = mcnemar(i.discordantB, i.discordantC);
  // D4: directional asymmetry (consumed systematically worse) is a WARN diagnostic, never a promotion criterion.
  const mcnemarWarn = mc.p < reg.reconcile.mcnemarWarnAlpha && i.discordantB > i.discordantC;
  const detail = "concordance " + rate.toFixed(4) + " (n=" + i.total + "), psiDiff " + i.psiDiff + ", rankDisp median/p95 " + med + "/" + p95 + ", McNemar(" + mc.method + ") p=" + mc.p.toFixed(4) + (mcnemarWarn ? " WARN(consumed-worse)" : "");
  return { equivalent: failures.length === 0, failures, mcnemarP: mc.p, mcnemarMethod: mc.method, mcnemarWarn, detail };
}

// ---------- D2/D5/D6: transition decision ----------

export type SwitchEventKind = "stage-transition" | "rollback" | "freeze" | "check" | "readiness";
export interface SwitchCounters {
  readinessRounds: number;   // S0 evaluation rounds since phase start (k_max discipline)
  readinessMetStreak: number; // consecutive C1-C4-met rounds in S0 (C4)
  heavyConfirmStreak: number; // consecutive heavy confirmations in S2 (D5; first value = 1, terminates at 2)
}
export interface SwitchInputs {
  readiness?: ReadinessVerdict;
  reconcile?: ReconcileVerdict;
  degraded?: boolean;
  integrityFailed?: string | null;
  freezeEvidence?: { s3Days: number; cleanReconciles: number };
  kMaxWarned: boolean;
}
export interface SwitchDecision {
  from: SwitchPhase;
  to: SwitchPhase;
  kind: SwitchEventKind;
  // true iff this decision must be written to the chain + ledger (real state change or ledgered hold)
  record: boolean;
  reason: string;
  integrityBlock: boolean;
  counters: SwitchCounters;
}

const base = (c: SwitchCounters): SwitchCounters => ({ ...c });

export function decideSwitch(from: SwitchPhase, i: SwitchInputs, c: SwitchCounters, reg: SwitchRegistration): SwitchDecision {
  const zero = base(c);
  // Integrity lineage (D5): fail-closed block, NEVER a rollback. Recorded, counted as nothing.
  if (i.integrityFailed) {
    return { from, to: from, kind: "check", record: true, reason: "integrity-fail: " + i.integrityFailed, integrityBlock: true, counters: { readinessRounds: zero.readinessRounds, readinessMetStreak: 0, heavyConfirmStreak: 0 } };
  }

  // S4 -> S2: reversible freeze (major consumed-track change).
  if (from === "S4") {
    if (i.degraded) return { from, to: "S2", kind: "check", record: true, reason: "unfreeze: consumed-track change re-opens reconcile window", integrityBlock: false, counters: { readinessRounds: 0, readinessMetStreak: 0, heavyConfirmStreak: 0 } };
    return { from, to: from, kind: "check", record: false, reason: "frozen", integrityBlock: false, counters: zero };
  }

  // S3 -> S4: evidence-driven freeze.
  if (from === "S3" && i.freezeEvidence && i.freezeEvidence.s3Days >= reg.freeze.s3MinWindowDays && i.freezeEvidence.cleanReconciles >= reg.freeze.consecutiveCleanReconciles) {
    return { from, to: "S4", kind: "freeze", record: true, reason: "freeze: S3 stable " + i.freezeEvidence.s3Days + "d, " + i.freezeEvidence.cleanReconciles + " consecutive clean reconciles", integrityBlock: false, counters: { readinessRounds: 0, readinessMetStreak: 0, heavyConfirmStreak: 0 } };
  }

  // D5 light degradation: S3 -> S2 Inconclusive hold on a single C-family out-of-band reading.
  if (from === "S3" && i.degraded) {
    return { from, to: "S2", kind: "check", record: true, reason: "check-s3-s2: Inconclusive hold (single C-family out-of-band)", integrityBlock: false, counters: { readinessRounds: 0, readinessMetStreak: 0, heavyConfirmStreak: 1 } };
  }

  if (from === "S0") {
    const rd = i.readiness;
    if (!rd) return { from, to: from, kind: "readiness", record: false, reason: "no readings", integrityBlock: false, counters: zero };
    if (rd.dataAbsent) return { from, to: from, kind: "readiness", record: true, reason: "data-absent (structural): " + rd.detail, integrityBlock: false, counters: { readinessRounds: 0, readinessMetStreak: 0, heavyConfirmStreak: 0 } };
    if (!rd.allMet) {
      // C1-C3 met but C4 unmet is gate-not-met (counted by the caller's streak logic); k_max caps rounds.
      const rounds = zero.readinessRounds + 1;
      const reason = "gate-not-met (round " + rounds + "/" + reg.c.c4kMaxRounds + "): " + rd.detail;
      if (rounds >= reg.c.c4kMaxRounds && !i.kMaxWarned) {
        return { from, to: from, kind: "readiness", record: true, reason: "k_max reached — WARN to ledger, human review required (no eternal retry). " + reason, integrityBlock: false, counters: { readinessRounds: 0, readinessMetStreak: 0, heavyConfirmStreak: 0 } };
      }
      return { from, to: from, kind: "readiness", record: rounds >= reg.c.c4kMaxRounds, reason, integrityBlock: false, counters: { ...zero, readinessRounds: rounds } };
    }
    const streak = zero.readinessMetStreak + 1;
    if (streak >= reg.c.c4ConsecutivePromote) {
      return { from, to: "S1", kind: "stage-transition", record: true, reason: "promote S0->S1: C1-C4 met " + streak + " consecutive rounds (reg id c.c4ConsecutivePromote=" + reg.c.c4ConsecutivePromote + "). " + rd.detail, integrityBlock: false, counters: { readinessRounds: 0, readinessMetStreak: 0, heavyConfirmStreak: 0 } };
    }
    return { from, to: from, kind: "readiness", record: true, reason: "C4 streak " + streak + "/" + reg.c.c4ConsecutivePromote + ": " + rd.detail, integrityBlock: false, counters: { ...zero, readinessRounds: 0, readinessMetStreak: streak } };
  }

  if (from === "S1") {
    if (!i.reconcile) return { from, to: from, kind: "readiness", record: false, reason: "S1 hold: consumed observed, no reconcile window yet", integrityBlock: false, counters: zero };
    return { from, to: "S2", kind: "stage-transition", record: true, reason: "promote S1->S2: dual-track reconcile window opened. " + i.reconcile.detail, integrityBlock: false, counters: { readinessRounds: 0, readinessMetStreak: 0, heavyConfirmStreak: 0 } };
  }

  if (from === "S2" || from === "S3") {
    const heavySignal = (i.degraded === true) || (i.reconcile?.mcnemarWarn === true);
    const heavyStreak = heavySignal ? zero.heavyConfirmStreak + 1 : 0;
    if (from === "S2" && heavyStreak >= reg.rollback.heavyConsecutiveConfirmations) {
      return { from, to: "S1", kind: "rollback", record: true, reason: "rollback-s2-to-s1: heavy degradation confirmed " + heavyStreak + " consecutive rounds (reg rollback.heavyConsecutiveConfirmations=" + reg.rollback.heavyConsecutiveConfirmations + ")", integrityBlock: false, counters: { readinessRounds: 0, readinessMetStreak: 0, heavyConfirmStreak: 0 } };
    }
    if (from === "S3") {
      // In S3 a heavy signal already demotes via the light rule above; reaching here means clean.
      return { from, to: from, kind: "check", record: false, reason: "S3 steady (consumed primary)", integrityBlock: false, counters: { readinessRounds: 0, readinessMetStreak: 0, heavyConfirmStreak: 0 } };
    }
    if (i.reconcile?.equivalent && !heavySignal) {
      return { from, to: "S3", kind: "stage-transition", record: true, reason: "promote S2->S3: TOST reconcile equivalent. " + i.reconcile.detail, integrityBlock: false, counters: { readinessRounds: 0, readinessMetStreak: 0, heavyConfirmStreak: 0 } };
    }
    return { from, to: from, kind: "check", record: heavySignal, reason: i.reconcile ? (i.reconcile.equivalent ? "S2 hold" : "S2 hold: " + i.reconcile.failures.join("; ")) : "S2 hold (no reconcile input)", integrityBlock: false, counters: { ...zero, heavyConfirmStreak: heavyStreak } };
  }
  return { from, to: from, kind: "check", record: false, reason: "unreachable", integrityBlock: false, counters: zero };
}
