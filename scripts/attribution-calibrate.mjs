// ADR-0050 D5: fit beta calibration and derive held-out dual thresholds.
// Internal CLI. Fit and threshold selection are split chronologically.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = fileURLToPath(import.meta.url);
const preregistrationPath = path.join(root, ".ship-gate", "attribution-gold-preregistration.json");

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
  const preregistration = JSON.parse(fs.readFileSync(preregistrationPath, "utf8"));

  const samples = readJsonl(path.resolve(argValue("--samples") || "packages/store/attribution-gold-samples.jsonl"));
  const labels = readJsonl(path.resolve(argValue("--labels") || "packages/store/attribution-gold-labels.jsonl"));
  const targetPrecision = Number(argValue("--precision") ?? preregistration.thresholdSelection.targetPrecision);
  const minPerSide = Number(argValue("--min-per-side") ?? preregistration.thresholdSelection.minSamplesPerSide);
  const splitAt = Number(argValue("--split-at") ?? Math.floor(samples.length * 0.7));

  const { fit, uncertain, coverage } = store.binaryFitSamples(samples, labels);
  const ordered = [...fit].sort((a, b) => a.score - b.score);
  const fitSlice = ordered.slice(0, splitAt);
  const selectSlice = ordered.slice(splitAt);
  const fitResult = kernel.fitBetaCalibration(fitSlice);
  const selectSamples = selectSlice.map((sample) => ({ score: sample.score, label: sample.label }));
  const thresholds = kernel.deriveThresholds(selectSamples, targetPrecision, { minSamplesPerSide: minPerSide });
  const gate = kernel.evaluateThresholdGate(selectSamples, thresholds, targetPrecision);

  const report = {
    schema: "anysearch/attribution-calibration-report@1",
    generatedAt: new Date().toISOString(),
    line: "attribution-gold",
    nSamples: samples.length,
    nLabeled: labels.length,
    nFit: fitSlice.length,
    nSelect: selectSlice.length,
    uncertain,
    coverage,
    fit: fitResult,
    thresholds,
    gate,
  };
  const outPath = path.resolve(argValue("--out") || ".ship-gate/attribution-calibration-report.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n", "utf8");
  process.stdout.write(
    "fit n=" + fitSlice.length +
      " select n=" + selectSlice.length +
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
