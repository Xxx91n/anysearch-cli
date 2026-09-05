// ADR-0029 D1/D2/D3/D4: judge calibration gate — Cohen's kappa (percentile bootstrap CI,
// 5000 resamples) + Gwet AC1 + raw agreement against the human-labeled calibration holdout
// (anysearch/calibration-set@1 in packages/store/src/eval/calibration-cases.ts).
// Sixtuple snapshot (D4): rubricHash/judgeVersion/fingerprint/annotator/annotatedAt/kappa-decision
// written to .ship-gate/calibration-report.json. Exit 0/1 is a human-review signal
// (this script is NOT wired into ship-gate); exit 2 = setup failure (too few labels / judge data).
//
// Usage (real-time judge mode): JUDGE_API_KEY=... node scripts/eval-calibrate.mjs
//                          [--out .ship-gate/calibration-report.json] [--boot 5000] [--min-labeled 30]
// Deterministic mode: --human 1,0,... --judge 0,1,... skips set loading and endpoint calls.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { judgeOne, RUBRIC, JUDGE_RUBRIC_HASH, judgeVersion } from "./eval-judge.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ponytail: seeded LCG — deterministic CI, no external rng dep; upgrade to crypto rng if it matters.
function lcg(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }

export function agreement(pairs) {
  if (!pairs.length) return 0;
  const ok = pairs.reduce((a, [h, j]) => a + (h === j ? 1 : 0), 0);
  return ok / pairs.length;
}
export function cohenKappa(pairs) {
  const n = pairs.length;
  if (!n) return NaN;
  const po = agreement(pairs);
  let h1 = 0, j1 = 0;
  for (const [h, j] of pairs) { h1 += h; j1 += j; }
  const pe = (h1 / n) * (j1 / n) + (1 - h1 / n) * (1 - j1 / n);
  return pe === 1 ? NaN : (po - pe) / (1 - pe);
}
export function gwetAC1(pairs) {
  const n = pairs.length;
  if (!n) return NaN;
  const po = agreement(pairs);
  let h1 = 0, j1 = 0;
  for (const [h, j] of pairs) { h1 += h; j1 += j; }
  const piBar = (h1 / n + j1 / n) / 2;
  const pe = 2 * piBar * (1 - piBar);
  return pe === 1 ? NaN : (po - pe) / (1 - pe);
}
export function kappaBootstrapCI(pairs, iters = 5000, seed = 20260827) {
  if (!pairs.length) return [NaN, NaN];
  const rand = lcg(seed);
  const ks = [];
  for (let i = 0; i < iters; i++) {
    let h1 = 0, j1 = 0, ok = 0;
    for (let k = 0; k < pairs.length; k++) {
      const [h, j] = pairs[(rand() * pairs.length) | 0];
      h1 += h; j1 += j; ok += h === j ? 1 : 0;
    }
    const po = ok / pairs.length;
    const pe = (h1 / pairs.length) * (j1 / pairs.length) + (1 - h1 / pairs.length) * (1 - j1 / pairs.length);
    if (pe !== 1) ks.push((po - pe) / (1 - pe));
  }
  ks.sort((a, b) => a - b);
  return [ks[Math.floor(0.025 * ks.length)], ks[Math.floor(0.975 * ks.length)]];
}

async function main() {
  const args = process.argv.slice(2);
  const argVal = (flag, dflt) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : dflt; };
  const outPath = argVal("--out", ".ship-gate/calibration-report.json");
  const boot = Number(argVal("--boot", "5000"));
  const minLabeled = Number(argVal("--min-labeled", "30"));

  let set; // { fingerprint, rubric, annotators, annotatedAt, cases:[{id,group,query,resultTitle,resultSnippet,humanRelevant}] }
  if (args.includes("--human")) {
    // test/self-check path: pairs supplied directly, no TS set load, no endpoint.
    const parse = (s) => s.split(",").map((x) => Number(x.trim()));
    const human = parse(argVal("--human", ""));
    const judge = parse(argVal("--judge", ""));
    if (human.length !== judge.length || !human.length) { process.stderr.write("eval-calibrate: --human/--judge length mismatch\n"); process.exit(2); }
    set = { fingerprint: "synthetic", rubric: "synthetic", annotators: ["selfcheck"], annotatedAt: new Date().toISOString().slice(0, 10), syntheticPairs: human.map((h, i) => [h, judge[i]]), cases: [] };
  } else {
    const setPath = path.resolve(argVal("--set", "packages/store/src/eval/calibration-cases.ts"));
    const mod = await import(pathToFileURL(setPath).href); // tsx loader wraps .ts when present; plain node only in synthetic mode
    const labelsPath = path.resolve(process.env.ANS_CALIBRATION_LABELS_PATH || "packages/store/calibration-labels.jsonl");
    const manifestPath = path.resolve(process.env.ANS_CALIBRATION_MANIFEST_PATH || "packages/store/calibration-manifest.json");
    const labelsMod = await import(pathToFileURL(path.join(repoRoot, "packages", "store", "src", "eval", "calibration-labels.ts")).href);
    const labelsState = fs.existsSync(labelsPath) ? labelsMod.parseLabelLines(fs.readFileSync(labelsPath, "utf8")) : { records: [], errors: [] };
    if (labelsState.errors.length) {
      process.stderr.write("eval-calibrate: calibration labels invalid: " + labelsState.errors.join("; ") + "\n");
      process.exit(2);
    }
    if (!fs.existsSync(manifestPath)) {
      process.stderr.write("eval-calibrate: calibration manifest missing: " + manifestPath + "\n");
      process.exit(2);
    }
    const parsedManifest = labelsMod.parseManifest(fs.readFileSync(manifestPath, "utf8"));
    if (parsedManifest.error || !parsedManifest.manifest) {
      process.stderr.write("eval-calibrate: calibration manifest invalid: " + (parsedManifest.error ?? "missing") + "\n");
      process.exit(2);
    }
    const validation = labelsMod.validateCalibrationState(labelsState.records, parsedManifest.manifest, mod.CALIBRATION_CASES);
    if (!validation.ok) {
      process.stderr.write("eval-calibrate: calibration state invalid: " + validation.detail + "\n");
      process.exit(validation.code);
    }
    const labeledCases = labelsMod.labeledCalibrationCases(mod.CALIBRATION_CASES, labelsState.records);
    set = { fingerprint: mod.CALIBRATION_SET.fingerprint, rubric: mod.CALIBRATION_SET.rubric, annotators: parsedManifest.manifest.annotators, annotatedAt: parsedManifest.manifest.annotatedAt, cases: labeledCases, calibrationHash: mod.calibrationHash };
  }

  let pairs;
  if (set.syntheticPairs) pairs = set.syntheticPairs;
  else {
    const labeled = set.cases.filter((c) => c.humanRelevant === 0 || c.humanRelevant === 1);
    if (labeled.length < minLabeled) {
      process.stderr.write(`eval-calibrate: only ${labeled.length} labeled (need >= ${minLabeled}) — annotations pending (ADR-0029 explicit deferral)\n`);
      process.exit(2);
    }
    const baseUrl = (process.env.JUDGE_BASE_URL || "http://127.0.0.1:20128/v1").replace(/\/+$/, "");
    const model = process.env.JUDGE_MODEL || "deepseekpro";
    const apiKey = process.env.JUDGE_API_KEY || "";
    if (!apiKey) { process.stderr.write("eval-calibrate: JUDGE_API_KEY not set\n"); process.exit(3); }
    pairs = [];
    for (const c of labeled) {
      const r = await judgeOne(`Query: ${c.query}
Returned title: ${c.resultTitle}
Returned snippet: ${c.resultSnippet}
Is the returned snippet a plausible, relevant hit?`, { baseUrl, model, apiKey });
      if (r.error) { process.stderr.write(`eval-calibrate: judge error on ${c.id}: ${r.error}\n`); process.exit(2); }
      pairs.push([c.humanRelevant, r.score]);
    }
  }

  const po = agreement(pairs);
  const kappa = cohenKappa(pairs);
  const ac1 = gwetAC1(pairs);
  const [lo, hi] = kappaBootstrapCI(pairs, boot);
  const fmt = (x) => (Number.isFinite(x) ? x.toFixed(3) : "NaN");
  // ADR-0029 D2 (audit r67): kappa CI lower bound >= 0.6 is the ONLY pass channel.
  // A degenerate all-same-label cohort (kappa=NaN, po=1) is a setup failure, not perfect calibration.
  const degenerate = po === 1 && !Number.isFinite(kappa);
  if (degenerate) process.stderr.write("eval-calibrate: degenerate cohort (all labels identical, kappa undefined) -- treat as FAIL\n");
  const pass = !degenerate && Number.isFinite(lo) && lo >= 0.6;
  const report = {
    schema: "anysearch/calibration-report@1",
    generatedAt: new Date().toISOString(),
    rubricHash: JUDGE_RUBRIC_HASH,
    judgeVersion: judgeVersion(process.env.JUDGE_MODEL || "deepseekpro", (process.env.JUDGE_BASE_URL || "http://127.0.0.1:20128/v1")),
    fingerprint: set.fingerprint, fingerprintLive: set.syntheticPairs ? "synthetic" : (typeof set.calibrationHash === "function" ? set.calibrationHash(pairs.length === 0 ? [] : set.cases.filter((c) => c.humanRelevant === 0 || c.humanRelevant === 1)) : null),
    annotator: (set.annotators ?? []).join("+") || "unlabeled",
    annotatedAt: set.annotatedAt ?? null,
    n: pairs.length, rawAgreement: po, kappa, kappaCI95: [lo, hi], gwetAC1: ac1,
    decision: pass ? "pass" : "fail",
    note: "ADR-0029 D2: human-review signal only — never wired into ship-gate gate. Failing => judge untrusted this cycle.",
  };
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n", "utf8");
  console.log(`eval-calibrate: n=${pairs.length} po=${fmt(po)} kappa=${fmt(kappa)} CI95=[${fmt(lo)}, ${fmt(hi)}] AC1=${fmt(ac1)} decision=${report.decision} -> ${outPath}`);
  process.exit(pass ? 0 : 1);
}

const invoked = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invoked && import.meta.url === pathToFileURL(invoked).href) {
  if (process.env.ANS_EVAL_CALIBRATE_TSX !== "1") {
    const loader = pathToFileURL(path.join(repoRoot, "packages", "store", "node_modules", "tsx", "dist", "loader.mjs")).href;
    const entry = path.relative(process.cwd(), fileURLToPath(import.meta.url)).split(path.sep).join("/");
    const child = spawnSync(process.execPath, ["--import", loader, entry, ...process.argv.slice(2)], {
      env: { ...process.env, ANS_EVAL_CALIBRATE_TSX: "1" },
      stdio: "inherit",
    });
    process.exit(child.status ?? 2);
  }
  main().catch((e) => { console.error("eval-calibrate: internal error: " + String(e && e.stack || e)); process.exit(2); });
}
