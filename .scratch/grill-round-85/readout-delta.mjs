#!/usr/bin/env node
// R85 T1/T3 — deterministic adjudicator for anysearch/vertical-delta@1.
// Sole executor of .scratch/grill-round-85/prereg-matrix.md. Human re-judgement
// of its output voids the matrix (single-terminal-read protocol).
//
//   node readout-delta.mjs assert-corpus        T2 pre-run: recompute corpus
//                                               fingerprint, assert == PIN
//   node readout-delta.mjs selftest             offline fixture gates check —
//                                               synthetic rows only, no real data
//   node readout-delta.mjs readout [delta.json] single terminal read (ONCE)
//
// Deterministic: no RNG, no Date, fixed-grid quadrature. Same input -> same output.
//
// Post-round audit revision (additive — gates G0..G4 unchanged): report-level
// side columns armHostHit/armInFanoutSurvival per prereg §2; artifact path
// emitted repo-relative. The locked r85 read stays readout-output.json (wws).

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const EXPECTED_FP = "7ac0a48e55cd7954"; // input fingerprint — drift voids the matrix
const SCHEMA = "anysearch/vertical-delta@1";
const DOMAINS = ["academic", "code", "finance", "health"]; // closed list (D-002-3)
const COVERAGE_MIN_PAIRED = 0.7;   // nPaired/n >= 70%
const COVERAGE_MAX_UNKNOWN = 0.3;  // unknown/n  <= 30%
const CONTROL_MAX_UNMEASURED = 8;  // > 8/16 -> instrument flag
const CONTROL_MAX_NONTIED = 4;     // >= 4/16 -> instrument flag
const GO_P = 0.8, NOGO_P = 0.5;    // flat-prior posterior thresholds
const REVERSAL_MARGIN = 3, REVERSAL_LIMIT = 2; // 2-of-4 hard gate
const GRID = 8192;                 // fixed quadrature nodes (deterministic)

// ---------- corpus (mirrors runner's live-vertical slice + fingerprint) ----------
function loadCorpus(root = ROOT) {
  const ledger = JSON.parse(readFileSync(join(root, "eval-looks.json"), "utf8"));
  const scopes = ledger.golden?.scopes ?? {};
  const entries = (ledger.golden?.entries ?? []).filter(
    (e) => (scopes[e.id] === "live" || scopes[e.id] === "both") && e.expected?.vertical !== undefined,
  );
  const fpSrc = entries
    .map((e) => ({ id: e.id, v: e.vertical ?? null, x: e.expected.vertical, s: scopes[e.id] }))
    .sort((a, b) => String(a.id).localeCompare(b.id));
  const fingerprint = createHash("sha256").update(JSON.stringify(fpSrc)).digest("hex").slice(0, 16);
  const dim = (e, p) => (e.dimensions ?? []).find((t) => String(t).startsWith(p + ":"))?.split(":")[1] ?? "unknown";
  const meta = entries.map((e) => ({
    id: e.id,
    role: e.expected.vertical.role === "control" ? "control" : "subject",
    vdomain: dim(e, "vdomain"),
    stratum: dim(e, "stratum"),
    spec: e.vertical !== undefined && e.vertical !== null,
  }));
  return { fingerprint, subjects: meta.filter((m) => m.role === "subject"), controls: meta.filter((m) => m.role === "control") };
}

// ---------- exact beta posterior (NR betacf + Lanczos lgamma; no RNG) ----------
const LG = (() => { // Lanczos coefficients
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  return (z) => {
    if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - LG(1 - z);
    z -= 1; let x = c[0];
    for (let i = 1; i < c.length; i++) x += c[i] / (z + i);
    const t = z + 7.5;
    return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
  };
})();
function betacf(a, b, x) {
  const MAXIT = 200, EPS = 3e-14, FPMIN = 1e-300;
  const qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1, d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN; d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; const del = d * c; h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}
function ibeta(x, a, b) { // regularized incomplete beta I_x(a,b)
  if (x <= 0) return 0; if (x >= 1) return 1;
  const bt = Math.exp(LG(a + b) - LG(a) - LG(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (bt * betacf(a, b, x)) / a : 1 - (bt * betacf(b, a, 1 - x)) / b;
}
const betaPdf = (x, a, b) => { // params always >= 1 (1+count); endpoints are finite: pdf(0)=b when a=1 else 0
  if (x <= 0) return a === 1 ? b : 0;
  if (x >= 1) return b === 1 ? a : 0;
  return Math.exp(LG(a + b) - LG(a) - LG(b) + (a - 1) * Math.log(x) + (b - 1) * Math.log(1 - x));
};
// trapezoid quadrature over (0,1) — deterministic fixed grid
function quad(fn) {
  const h = 1 / GRID;
  let s = 0.5 * (fn(0) + fn(1));
  for (let i = 1; i < GRID; i++) s += fn(i * h);
  return s * h;
}
function posterior(b, w) { // B~Beta(1+b), W~Beta(1+w)
  const aB = 1 + b, bB = 1 + w, aW = 1 + w, bW = 1 + b;
  const P = quad((x) => betaPdf(x, aB, bB) * ibeta(x, aW, bW));            // P(B>W)
  const eB = aB / (aB + bB);
  const EL = quad((x) => betaPdf(x, aW, bW) * (x * ibeta(x, aB, bB) - eB * ibeta(x, aB + 1, bB))); // E[max(W-B,0)]
  return { P, EL };
}
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// ---------- matrix pipeline (G0..G4, fixed order; first failure truncates) ----------
export function adjudicate(artifact, corpus) {
  const trace = [];
  const gate = (name, ok, detail) => { trace.push({ gate: name, pass: ok, ...detail }); return ok; };

  // G0 input integrity
  const g0 = gate("G0-input-integrity",
    artifact?.schema === SCHEMA && artifact?.datasetFingerprint === EXPECTED_FP,
    { schema: artifact?.schema, fingerprint: artifact?.datasetFingerprint, expected: EXPECTED_FP });
  if (!g0) return finish("INCONCLUSIVE", "input-integrity", trace, artifact, corpus, null);

  const rowsById = new Map((artifact.rows ?? []).map((r) => [r.id, r]));

  // cells over the corpus expectation set — artifact-missing = structural missing
  const subjectCell = (m) => {
    const r = rowsById.get(m.id);
    if (!r) return { id: m.id, m, verdict: "unknown", paired: false, missing: true, rankDiff: null, hOn: null, hOff: null, fanOn: null, fanOff: null };
    const paired = r.armOn !== null && r.armOff !== null;
    return {
      id: m.id, m, verdict: r.delta?.verdict ?? "unknown", paired, missing: false,
      rankDiff: r.delta?.rankDiff ?? null,
      hOn: paired ? r.armOn?.hostHit ?? null : null, hOff: paired ? r.armOff?.hostHit ?? null : null,
      fanOn: r.armInFanoutOn ?? null, fanOff: r.armInFanoutOff ?? null
    };
  };
  const controlCell = (m) => {
    const r = rowsById.get(m.id);
    if (!r) return { id: m.id, m, measured: false, missing: true, nonTied: false };
    const spec = r.hadVerticalSpec ?? m.spec;
    const measured = spec ? (r.armOn !== null && r.armOff !== null) : r.armOff !== null;
    const v = r.delta?.verdict ?? "unknown";
    return { id: m.id, m, measured, missing: false, nonTied: v === "better" || v === "worse", verdict: v };
  };
  const S = corpus.subjects.map(subjectCell);
  const C = corpus.controls.map(controlCell);

  // Direction statistics are report-only fields — always computed when subject
  // cells exist, regardless of which gate terminates the pipeline (a hard-gate
  // veto still leaves the four-field evidence row for the decision record).
  const pairedRows = S.filter((c) => c.paired);
  const bAll = S.filter((c) => c.verdict === "better").length;
  const wAll = S.filter((c) => c.verdict === "worse").length;
  const { P, EL } = posterior(bAll, wAll);
  const rate = (pick) => {
    const v = pairedRows.map(pick).filter((x) => x !== null);
    return v.length ? v.filter(Boolean).length / v.length : null;
  };
  const pooledOn = rate((c) => c.hOn), pooledOff = rate((c) => c.hOff);
  const pooledDelta = pooledOn === null || pooledOff === null ? null : pooledOn - pooledOff;
  const dirStats = { b: bAll, w: wAll, P, EL, pooledOn, pooledOff, pooledDelta };

  // G1 instrument flag (control stratum, independent necessary conjunct)
  const cUnmeasured = C.filter((c) => !c.measured).length;
  const cNonTied = C.filter((c) => c.nonTied).length;
  // runner early-stop flag is flag evidence even if the recount disagrees
  const flag = artifact.instrumentFlag === true || cUnmeasured > CONTROL_MAX_UNMEASURED || cNonTied >= CONTROL_MAX_NONTIED;
  gate("G1-instrument-flag", !flag, {
    artifactFlag: artifact.instrumentFlag === true,
    unmeasured: cUnmeasured, nonTied: cNonTied, n: C.length,
    // diagnosis order per prereg: unknown missingness pattern -> direction consistency -> symmetric noise
    unmeasuredIds: C.filter((c) => !c.measured).map((c) => c.id),
    nonTiedIds: C.filter((c) => c.nonTied).map((c) => c.id),
  });
  if (flag) return finish("INCONCLUSIVE", "instrument-flag", trace, artifact, corpus, S, C, dirStats);

  // G2 coverage (processing layer)
  const n = S.length, nPaired = S.filter((c) => c.paired).length;
  const nUnknown = S.filter((c) => c.verdict === "unknown").length;
  const cov = nPaired / n >= COVERAGE_MIN_PAIRED && nUnknown / n <= COVERAGE_MAX_UNKNOWN;
  gate("G2-coverage", cov, { n, nPaired, unknown: nUnknown, needPaired: Math.ceil(n * COVERAGE_MIN_PAIRED), maxUnknown: Math.floor(n * COVERAGE_MAX_UNKNOWN) });
  if (!cov) return finish("INCONCLUSIVE", "coverage", trace, artifact, corpus, S, C, dirStats);

  // G3 negative hard gate — closed domain list, per-domain reversal margin
  const perDomain = {};
  for (const d of DOMAINS) perDomain[d] = S.filter((c) => c.m.vdomain === d);
  const reversals = DOMAINS.filter((d) => {
    const b = perDomain[d].filter((c) => c.verdict === "better").length;
    const w = perDomain[d].filter((c) => c.verdict === "worse").length;
    return w - b >= REVERSAL_MARGIN;
  });
  const neg = reversals.length >= REVERSAL_LIMIT;
  gate("G3-negative-2of4", !neg, {
    reversals, detail: Object.fromEntries(DOMAINS.map((d) => [d, {
      better: perDomain[d].filter((c) => c.verdict === "better").length,
      worse: perDomain[d].filter((c) => c.verdict === "worse").length,
      tied: perDomain[d].filter((c) => c.verdict === "tied").length,
      unknown: perDomain[d].filter((c) => c.verdict === "unknown").length,
    }])),
  });
  if (neg) return finish("NO-GO", "negative-hard-gate", trace, artifact, corpus, S, C, dirStats);

  // G4 direction axis — pooled Beta(1+b,1+w) posterior over processing layer
  let verdict;
  if (dirStats.P >= GO_P && dirStats.pooledDelta !== null && dirStats.pooledDelta > 0) verdict = "GO";
  else if (dirStats.P <= NOGO_P || (dirStats.pooledDelta !== null && dirStats.pooledDelta <= 0)) verdict = "NO-GO";
  else verdict = "INCONCLUSIVE";
  gate("G4-direction", true, { better: bAll, worse: wAll, P: dirStats.P, pooledOn, pooledOff, pooledDelta });
  const reason = verdict === "GO" ? "direction-positive" : verdict === "NO-GO" ? "direction-negative" : "direction-indeterminate";
  return finish(verdict, reason, trace, artifact, corpus, S, C, dirStats);
}

function finish(verdict, exit, trace, artifact, corpus, S, C, dir = null) {
  const out = {
    matrix: "grill-round-85/prereg-matrix@1",
    schema: artifact?.schema ?? null, fingerprint: artifact?.datasetFingerprint ?? null,
    verdict, exit, gates: trace,
    fields: null, control: null, coverage: null, perDomain: null, perStratum: null, truncation: null,
  };
  if (C) out.control = {
    n: C.length, measured: C.filter((c) => c.measured).length,
    unmeasured: C.filter((c) => !c.measured).length, nonTied: C.filter((c) => c.nonTied).length,
  };
  if (S) {
    const nPaired = S.filter((c) => c.paired).length;
    const b = S.filter((c) => c.verdict === "better").length, w = S.filter((c) => c.verdict === "worse").length;
    const diffs = S.map((c) => c.rankDiff).filter((d) => d !== null);
    out.coverage = { n: S.length, nPaired, unknown: S.filter((c) => c.verdict === "unknown").length };
    out.fields = {
      netWinRate: nPaired ? (b - w) / nPaired : null,
      P_better_gt_worse: dir ? dir.P : null,
      expectedLoss: dir ? dir.EL : null,
      rankDiffMedian: median(diffs),
    };
    const side = (keyfn) => {
      const o = {};
      for (const c of S) {
        const k = keyfn(c.m);
        const b = (o[k] ??= { better: 0, worse: 0, tied: 0, unknown: 0, nPaired: 0, expected: 0, hOnN: 0, hOnT: 0, hOffN: 0, hOffT: 0 });
        b[c.verdict]++; b.expected++;
        if (c.paired) {
          b.nPaired++;
          if (c.hOn !== null) { b.hOnN++; if (c.hOn) b.hOnT++; }
          if (c.hOff !== null) { b.hOffN++; if (c.hOff) b.hOffT++; }
        }
      }
      for (const b of Object.values(o)) {
        b.armHostHit = { on: b.hOnN ? b.hOnT / b.hOnN : null, off: b.hOffN ? b.hOffT / b.hOffN : null };
        delete b.hOnN; delete b.hOnT; delete b.hOffN; delete b.hOffT;
      }
      return o;
    };
    out.perDomain = side((m) => m.vdomain);
    out.perStratum = side((m) => m.stratum);
    out.truncation = Object.fromEntries(DOMAINS.map((d) => {
      const cells = S.filter((c) => c.m.vdomain === d);
      return [d, { paired: cells.filter((c) => c.paired).length, expected: cells.length, missing: cells.filter((c) => c.missing).length }];
    }));
    // MNAR marker: domain whose cells are systematically absent (missing clusters)
    // — unregistered operationalization (>=50% missing); the matrix registers the
    // marking duty, not this threshold. Tune at next matrix revision.
    out.mnarSuspect = DOMAINS.filter((d) => out.truncation[d].missing >= 0.5 * out.truncation[d].expected && out.truncation[d].expected > 0);
    // armInFanout survival (prereg §2 side column): share of scheduled cells
    // where the arm produced a list inside fanout. null fan legs (e.g. no-spec
    // control armOn) are structural absence, excluded from the denominator.
    const fan = (pick) => { const v = S.map(pick).filter((x) => x !== null); return v.length ? v.filter(Boolean).length / v.length : null; };
    out.armInFanoutSurvival = { on: fan((c) => c.fanOn), off: fan((c) => c.fanOff) };
  }
  return out;
}

// ---------- corpus fingerprint assertion (T2 pre-run gate) ----------
function assertCorpus() {
  const c = loadCorpus();
  const ok = c.fingerprint === EXPECTED_FP;
  console.log(`corpus fingerprint=${c.fingerprint} expected=${EXPECTED_FP} subjects=${c.subjects.length} controls=${c.controls.length}`);
  if (!ok) { console.error("FAIL: fingerprint drift — instrument flag, do not run"); process.exit(2); }
  console.log("PASS: corpus frozen, fingerprint matches preregistration");
}

// ---------- offline selftest (synthetic rows only — no real delta read) ----------
function synthArtifact(corpus, spec) {
  const rows = [];
  for (const m of corpus.controls) {
    const c = spec.control?.(m) ?? { measured: true };
    if (c.absent) continue;
    rows.push({
      id: m.id, role: "control", vdomain: m.vdomain, stratum: "control", hadVerticalSpec: m.spec,
      armOn: m.spec && c.measured ? { n: 5, hostHit: null } : null,
      armOff: c.measured ? { n: 5, hostHit: null } : null,
      delta: { verdict: "unknown", rankDiff: null },
    });
  }
  for (const m of corpus.subjects) {
    const s = spec.subject?.(m) ?? { verdict: "tied", hOn: true, hOff: true };
    if (s.absent) continue;
    const paired = s.verdict !== "unknown";
    rows.push({
      id: m.id, role: "subject", vdomain: m.vdomain, stratum: m.stratum, hadVerticalSpec: true,
      armOn: paired ? { n: 5, hostHit: s.hOn ?? true } : null,
      armOff: paired ? { n: 5, hostHit: s.hOff ?? false } : null,
      delta: { verdict: s.verdict, rankDiff: s.rankDiff ?? null },
    });
  }
  return { schema: SCHEMA, datasetFingerprint: spec.fp ?? EXPECTED_FP, n: rows.length, rows };
}
function selftest() {
  const corpus = loadCorpus();
  const cases = [
    ["healthy-positive -> GO/direction-positive", "GO/direction-positive", { subject: (m) => ({ verdict: m.vdomain === "health" ? "tied" : "better", hOn: true, hOff: false, rankDiff: 2 }) }],
    ["instrument-dead (10 unmeasured) -> INCONCLUSIVE/instrument-flag", "INCONCLUSIVE/instrument-flag",
      { control: (m, i) => ({ measured: i < 10 ? false : true }) }],
    ["indeterminate direction -> INCONCLUSIVE/direction-indeterminate", "INCONCLUSIVE/direction-indeterminate",
      { subject: (m, i) => ({ verdict: i % 7 === 0 ? "better" : i % 8 === 0 ? "worse" : "tied", hOn: true, hOff: false }) }],
    ["two domain reversals -> NO-GO/negative-hard-gate", "NO-GO/negative-hard-gate",
      { subject: (m) => ((m.vdomain === "finance" || m.vdomain === "code") ? { verdict: "worse", hOn: false, hOff: true } : { verdict: "better", hOn: true, hOff: false }) }],
    ["coverage fail (20 unknown) -> INCONCLUSIVE/coverage", "INCONCLUSIVE/coverage",
      { subject: (m, i) => (i < 20 ? { verdict: "unknown" } : { verdict: "better", hOn: true, hOff: false }) }],
    ["fingerprint drift -> INCONCLUSIVE/input-integrity", "INCONCLUSIVE/input-integrity", { fp: "deadbeefdeadbeef" }],
  ];
  let fail = 0;
  cases.forEach(([name, expect, spec], ci) => {
    // index-aware control/subject selectors
    let ci2 = -1, si = -1;
    const art = synthArtifact(corpus, {
      fp: spec.fp,
      control: spec.control ? (m) => spec.control(m, ++ci2) : undefined,
      subject: spec.subject ? (m) => spec.subject(m, ++si) : undefined,
    });
    const out = adjudicate(art, corpus);
    const got = out.verdict + "/" + out.exit;
    const ok = got === expect;
    if (!ok) fail++;
    console.log(`${ok ? "PASS" : "FAIL"} ${name}  => ${got} (P=${out.fields?.P_better_gt_worse?.toFixed?.(3) ?? "null"})`);
  });
  if (fail) { console.error(`selftest: ${fail} case(s) failed`); process.exit(1); }
  console.log("selftest: all cases pass — adjudicator deterministic over synthetic fixtures");
}

// ---------- single terminal read (T3, ONCE on canonical artifact) ----------
function readout(path) {
  const deltaPath = path ?? join(ROOT, ".scratch", "vertical-eval", "delta.json");
  const artifact = JSON.parse(readFileSync(deltaPath, "utf8"));
  const corpus = loadCorpus();
  const out = adjudicate(artifact, corpus);
  out.artifact = relative(ROOT, deltaPath);
  out.nRowsArtifact = artifact.rows?.length ?? 0;
  out.controlDegraded = artifact.controlDegraded ?? null;
  out.earlyStopped = artifact.instrumentFlag === true;
  console.log(JSON.stringify(out, null, 2));
  if (out.verdict === "INCONCLUSIVE" && out.exit === "input-integrity") process.exit(2);
}

const mode = process.argv[2];
if (mode === "assert-corpus") assertCorpus();
else if (mode === "selftest") selftest();
else if (mode === "readout") readout(process.argv[3]);
else {
  console.error("usage: readout-delta.mjs assert-corpus | selftest | readout [delta.json]");
  process.exit(64);
}
