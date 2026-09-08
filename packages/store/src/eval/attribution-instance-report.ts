// ADR-0051 D5: per-instance observability for the single attribution-gold line.
// Audit-only: nothing here gates fitting, thresholds, or promotion. A known
// web/memory mixture is reported as "mixed-calibration-acknowledged"; forking
// is the D6 human-gated decision, never automatic.
//
// Industry models: group fairness / subgroup calibration reporting (PSI + KS
// distribution shift, per-group ECE/Brier with bootstrap CIs). Deterministic
// seeded PRNG keeps the bootstrap reproducible in CI.

export type InstanceKind = "web" | "memory";

export interface InstanceReportItem {
  claimId: string;
  instance: InstanceKind;
  score: number; // raw fused score
  p: number;     // calibrated probability under the active fit params
  label: 0 | 1;
}

export interface BootstrapDelta {
  value: number;
  ciLower: number;
  ciUpper: number;
}

export interface PerInstanceGroup {
  instance: InstanceKind;
  n: number;
  prevalence: number;
  coverage: number; // share of the binary-fit population
  status: "ok" | "insufficient";
  psi: number | null;   // score distribution vs the rest of the line
  ks: number | null;    // two-sample KS statistic vs the rest
  ece: number | null;
  eceDelta: BootstrapDelta | null;   // group ECE minus rest ECE
  brier: number | null;
  brierDelta: BootstrapDelta | null; // group Brier minus rest Brier
}

export interface InstanceReport {
  n: number;
  minGroupN: number;
  groups: PerInstanceGroup[];
  mixture: "mixed-calibration-acknowledged" | null;
}

const BINS = 10;
const EPS = 1e-6;

// Population Stability Index over fixed equal-width bins on [0,1].
export function psiStat(group: number[], rest: number[], bins = BINS): number {
  if (group.length === 0 || rest.length === 0) return 0;
  const g = new Array<number>(bins).fill(0);
  const r = new Array<number>(bins).fill(0);
  for (const v of group) g[Math.min(bins - 1, Math.floor(v * bins))]++;
  for (const v of rest) r[Math.min(bins - 1, Math.floor(v * bins))]++;
  let psi = 0;
  for (let i = 0; i < bins; i++) {
    const gp = Math.max(g[i]! / group.length, EPS);
    const rp = Math.max(r[i]! / rest.length, EPS);
    psi += (gp - rp) * Math.log(gp / rp);
  }
  return psi;
}

// Two-sample Kolmogorov-Smirnov statistic between raw score sets.
export function ksStat(group: number[], rest: number[]): number {
  if (group.length === 0 || rest.length === 0) return 0;
  const a = [...group].sort((x, y) => x - y);
  const b = [...rest].sort((x, y) => x - y);
  let i = 0, j = 0, d = 0;
  while (i < a.length && j < b.length) {
    if (a[i]! <= b[j]) i++; else j++;
    d = Math.max(d, Math.abs(i / a.length - j / b.length));
  }
  return d;
}

// Expected calibration error over equal-width probability bins.
export function ece(items: Array<{ p: number; label: 0 | 1 }>, bins = BINS): number {
  if (items.length === 0) return 0;
  const sumP = new Array<number>(bins).fill(0);
  const sumY = new Array<number>(bins).fill(0);
  const cnt = new Array<number>(bins).fill(0);
  for (const it of items) {
    const k = Math.min(bins - 1, Math.floor(it.p * bins));
    sumP[k]! += it.p; sumY[k]! += it.label; cnt[k]!++;
  }
  let e = 0;
  for (let i = 0; i < bins; i++) {
    if (!cnt[i]) continue;
    e += (cnt[i]! / items.length) * Math.abs(sumP[i]! / cnt[i]! - sumY[i]! / cnt[i]!);
  }
  return e;
}

export function brier(items: Array<{ p: number; label: 0 | 1 }>): number {
  if (items.length === 0) return 0;
  return items.reduce((s, it) => s + (it.p - it.label) ** 2, 0) / items.length;
}

// Deterministic PRNG (mulberry32) so the bootstrap is reproducible in CI.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function resample<T>(items: T[], rand: () => number): T[] {
  const out: T[] = [];
  for (let i = 0; i < items.length; i++) out.push(items[Math.floor(rand() * items.length)]!);
  return out;
}

// Bootstrap CI for (group metric - rest metric), percentile method.
function bootstrapDelta(
  group: Array<{ p: number; label: 0 | 1 }>,
  rest: Array<{ p: number; label: 0 | 1 }>,
  metric: (items: Array<{ p: number; label: 0 | 1 }>) => number,
  reps = 500,
  seed = 0xa51,
): BootstrapDelta | null {
  if (group.length < 2 || rest.length < 2) return null;
  const value = metric(group) - metric(rest);
  const rand = mulberry32(seed);
  const deltas: number[] = [];
  for (let k = 0; k < reps; k++) {
    deltas.push(metric(resample(group, rand)) - metric(resample(rest, rand)));
  }
  deltas.sort((x, y) => x - y);
  return {
    value,
    ciLower: deltas[Math.floor(0.025 * reps)]!,
    ciUpper: deltas[Math.floor(0.975 * reps) - 1]!,
  };
}

// Per-instance report. Small groups are "insufficient" and never forced
// through a metric gate; they still report n/prevalence so growth is visible.
export function perInstanceReport(
  items: InstanceReportItem[],
  opts: { minGroupN?: number; bootstrapReps?: number } = {},
): InstanceReport {
  const minGroupN = opts.minGroupN ?? 20;
  const n = items.length;
  const byKey = new Map<InstanceKind, InstanceReportItem[]>();
  for (const it of items) {
    const list = byKey.get(it.instance) ?? [];
    list.push(it);
    byKey.set(it.instance, list);
  }
  const groups: PerInstanceGroup[] = [];
  for (const [instance, list] of [...byKey.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const rest = items.filter((it) => it.instance !== instance);
    const prevalence = list.reduce((s, it) => s + it.label, 0) / list.length;
    const insufficient = list.length < minGroupN;
    const groupScores = list.map((it) => it.score);
    const restScores = rest.map((it) => it.score);
    groups.push({
      instance,
      n: list.length,
      prevalence,
      coverage: n > 0 ? list.length / n : 0,
      status: insufficient ? "insufficient" : "ok",
      psi: insufficient || restScores.length === 0 ? null : psiStat(groupScores, restScores),
      ks: insufficient || restScores.length === 0 ? null : ksStat(groupScores, restScores),
      ece: insufficient ? null : ece(list),
      eceDelta: insufficient ? null : bootstrapDelta(list, rest, ece, opts.bootstrapReps),
      brier: insufficient ? null : brier(list),
      brierDelta: insufficient ? null : bootstrapDelta(list, rest, brier, opts.bootstrapReps),
    });
  }
  return {
    n,
    minGroupN,
    groups,
    mixture: byKey.size > 1 ? "mixed-calibration-acknowledged" : null,
  };
}
