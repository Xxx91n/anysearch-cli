// ADR-0050 D5/D6: fit beta calibration and derive held-out dual thresholds.
// Internal CLI. Fit/select/eval are chronological segments of the JSONL
// arrival order (append-only stream = arrival order). Thresholds are derived
// on select, the gate and sens/spec cross-check run on held-out eval.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = fileURLToPath(import.meta.url);
const preregistrationPath = path.resolve(
  argValue("--prereg") || path.join(root, ".ship-gate", "attribution-gold-preregistration.json"),
);

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function fail(code, detail) {
  process.stderr.write("attribution-calibrate: " + detail + "\n");
  process.exit(code);
}

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

async function run() {
  const kernel = await import("../packages/kernel/src/calibrate.ts");
  const store = await import("../packages/store/src/eval/attribution-gold.ts");
  const bundles = await import("../packages/store/src/eval/attribution-calibration.ts");
  const preregistration = JSON.parse(fs.readFileSync(preregistrationPath, "utf8"));

  const samples = readJsonl(path.resolve(argValue("--samples") || "packages/store/attribution-gold-samples.jsonl"));
  const labels = readJsonl(path.resolve(argValue("--labels") || "packages/store/attribution-gold-labels.jsonl"));
  const targetPrecision = Number(argValue("--precision") ?? preregistration.thresholdSelection.targetPrecision);
  const minPerSide = Number(argValue("--min-per-side") ?? preregistration.thresholdSelection.minSamplesPerSide);
  const nMin = Number(argValue("--n-min") ?? preregistration.sampleTarget.nMin ?? 0);
  const now = new Date().toISOString();

  const { fit, uncertain, coverage } = store.binaryFitSamples(samples, labels);
  // Chronological three-way split (D7 / preregistration splits): the JSONL
  // stream is append-only, so file order is arrival order. No re-sorting.
  const fitRatio = Number(argValue("--fit-ratio") ?? 0.6);
  const selectRatio = Number(argValue("--select-ratio") ?? 0.2);
  const fitEnd = Math.floor(fit.length * fitRatio);
  const selectEnd = Math.floor(fit.length * (fitRatio + selectRatio));
  const fitSlice = fit.slice(0, fitEnd);
  const selectSlice = fit.slice(fitEnd, selectEnd);
  const evalSlice = fit.slice(selectEnd);
  const fitResult = kernel.fitBetaCalibration(fitSlice);
  const selectSamples = selectSlice.map((sample) => ({ score: sample.score, label: sample.label }));
  // D4 cold-start gate: nMin is judged on the whole labeled binary set, not
  // on the select segment. Below it the line stays on the legacy floor.
  const fallback = preregistration.thresholdSelection.fallback;
  const thresholds =
    nMin > 0 && fit.length < nMin
      ? { supported: fallback.supported, unsupported: fallback.unsupported, degraded: true }
      : kernel.deriveThresholds(selectSamples, targetPrecision, { minSamplesPerSide: minPerSide });
  const evalSamples = evalSlice.map((sample) => ({ score: sample.score, label: sample.label }));
  const gate = kernel.evaluateThresholdGate(evalSamples, thresholds, targetPrecision);
  const confusion = kernel.confusionStats(evalSamples, thresholds);
  const labelsDigest = store.attributionGoldDigest(labels);

  // D6: the beta params and derived thresholds live in an immutable,
  // content-addressed bundle; activation only moves the head pointer.
  const revisionRoot = process.env.ANS_ATTRIBUTION_GOLD_REVISION_ROOT
    ? path.resolve(process.env.ANS_ATTRIBUTION_GOLD_REVISION_ROOT)
    : path.join(root, "packages", "store", "attribution-gold-revisions");
  const storable = selectSamples.length ? fitResult.params : { a: 1, b: 1, c: 0 };
  const { digest: bundleDigest } = bundles.writeCalibrationBundle(
    revisionRoot,
    {
      schema: "anysearch/attribution-calibration-bundle@1",
      createdAt: now,
      labelsDigest,
      params: storable,
      thresholds: { supported: thresholds.supported, unsupported: thresholds.unsupported, degraded: thresholds.degraded },
    },
    { activate: !thresholds.degraded },
  );

  // D6: derived thresholds land back in the preregistration document once a
  // non-degraded bundle becomes the head.
  if (!thresholds.degraded) {
    preregistration.derivedThresholds = {
      supported: thresholds.supported,
      unsupported: thresholds.unsupported,
      bundleDigest,
      labelsDigest,
      updatedAt: now,
    };
    const tmp = preregistrationPath + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(preregistration, null, 2) + "\n", "utf8");
    fs.renameSync(tmp, preregistrationPath);
  }

  const report = {
    schema: "anysearch/attribution-calibration-report@1",
    generatedAt: now,
    line: "attribution-gold",
    nSamples: samples.length,
    nLabeled: labels.length,
    nFit: fitSlice.length,
    nSelect: selectSlice.length,
    nEval: evalSlice.length,
    uncertain,
    coverage,
    labelsDigest,
    bundleDigest,
    fit: fitResult,
    thresholds,
    gate,
    evaluation: {
      sensitivity: confusion.sensitivity,
      specificity: confusion.specificity,
      prevalence: confusion.prevalence,
      positives: confusion.positives,
      negatives: confusion.negatives,
    },
  };
  const outPath = path.resolve(argValue("--out") || ".ship-gate/attribution-calibration-report.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n", "utf8");
  process.stdout.write(
    "fit n=" + fitSlice.length +
      " select n=" + selectSlice.length +
      " eval n=" + evalSlice.length +
      " thresholds supported=" + thresholds.supported.toFixed(3) +
      " unsupported=" + thresholds.unsupported.toFixed(3) +
      " degraded=" + thresholds.degraded +
      " gate=" + gate.decision +
      " -> " + outPath + "\n",
  );
  process.exit(thresholds.degraded ? 0 : gate.decision === "fail" ? 1 : 0);
}

if (process.env.ANS_ATTRIBUTION_CALIBRATE_TSX !== "1") {
  const loader = pathToFileURL(path.join(root, "packages", "store", "node_modules", "tsx", "dist", "loader.mjs")).href;
  const entry = path.relative(process.cwd(), scriptPath).split(path.sep).join("/");
  const child = spawnSync(process.execPath, ["--import", loader, entry, ...process.argv.slice(2)], {
    env: { ...process.env, ANS_ATTRIBUTION_CALIBRATE_TSX: "1" },
    stdio: "inherit",
  });
  process.exit(child.status ?? 2);
}

run().catch((error) => {
  console.error("attribution-calibrate: internal error: " + String(error && error.stack || error));
  process.exit(2);
});
