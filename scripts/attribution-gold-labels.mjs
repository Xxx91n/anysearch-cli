// ADR-0050 D3/D4: thin CLI over the attribution-gold pure core.
// Samples are the shared claim stream; labels are blinded AIS annotations.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = fileURLToPath(import.meta.url);
const samplesPath = process.env.ANS_ATTRIBUTION_GOLD_SAMPLES_PATH
  ? path.resolve(process.env.ANS_ATTRIBUTION_GOLD_SAMPLES_PATH)
  : path.join(root, "packages", "store", "attribution-gold-samples.jsonl");
const labelsPath = process.env.ANS_ATTRIBUTION_GOLD_LABELS_PATH
  ? path.resolve(process.env.ANS_ATTRIBUTION_GOLD_LABELS_PATH)
  : path.join(root, "packages", "store", "attribution-gold-labels.jsonl");
const manifestPath = process.env.ANS_ATTRIBUTION_GOLD_MANIFEST_PATH
  ? path.resolve(process.env.ANS_ATTRIBUTION_GOLD_MANIFEST_PATH)
  : path.join(root, "packages", "store", "attribution-gold-manifest.json");
const preregistrationPath = process.env.ANS_ATTRIBUTION_GOLD_PREREGISTRATION_PATH
  ? path.resolve(process.env.ANS_ATTRIBUTION_GOLD_PREREGISTRATION_PATH)
  : path.join(root, ".ship-gate", "attribution-gold-preregistration.json");

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function fail(code, detail) {
  process.stderr.write("attribution-gold-labels: " + detail + "\n");
  process.exit(code);
}

async function run() {
  const core = await import("../packages/store/src/eval/attribution-gold.ts");
  if (!fs.existsSync(preregistrationPath)) fail(2, "preregistration missing: " + preregistrationPath);
  const preregistration = JSON.parse(fs.readFileSync(preregistrationPath, "utf8"));
  const rubricHash = preregistration.rubricHash;

  function readSamples() {
    if (!fs.existsSync(samplesPath)) return { samples: [], errors: [] };
    return core.parseSampleLines(fs.readFileSync(samplesPath, "utf8"));
  }

  function readLabels() {
    if (!fs.existsSync(labelsPath)) return { labels: [], errors: [] };
    return core.parseLabelLines(fs.readFileSync(labelsPath, "utf8"));
  }

  function readManifest() {
    if (!fs.existsSync(manifestPath)) return { manifest: null, error: "manifest not found: " + manifestPath };
    return core.parseManifest(fs.readFileSync(manifestPath, "utf8"));
  }

  function writeJsonl(file, rows) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, rows.length ? rows.map((row) => JSON.stringify(row)).join("\n") + "\n" : "", "utf8");
  }

  function writeJson(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", "utf8");
  }

  function requireState() {
    const loadedSamples = readSamples();
    if (loadedSamples.errors.length) fail(2, loadedSamples.errors.join("; "));
    const loadedLabels = readLabels();
    if (loadedLabels.errors.length) fail(2, loadedLabels.errors.join("; "));
    const loadedManifest = readManifest();
    if (loadedManifest.error || !loadedManifest.manifest) fail(2, loadedManifest.error ?? "manifest missing");
    const validation = core.validateState(loadedSamples.samples, loadedLabels.labels, loadedManifest.manifest, rubricHash);
    if (!validation.ok) fail(validation.code, validation.detail);
    return { samples: loadedSamples.samples, labels: loadedLabels.labels, manifest: loadedManifest.manifest };
  }

  function sampleInput() {
    const claimId = argValue("--claim");
    const claimText = argValue("--text");
    const scoreText = argValue("--score");
    if (!claimId) fail(2, "--claim is required");
    if (!claimText) fail(2, "--text is required");
    if (scoreText === undefined || !Number.isFinite(Number(scoreText))) fail(2, "--score must be a finite number");
    const fusedScore = Number(scoreText);
    if (fusedScore < 0 || fusedScore > 1) fail(2, "--score must be in [0,1]");
    return { schema: core.ATTRIBUTION_GOLD_SAMPLE_SCHEMA, claimId, claimText, fusedScore };
  }

  function labelInput() {
    const claimId = argValue("--claim");
    const aisLabel = argValue("--ais");
    const annotator = argValue("--annotator");
    const batchId = argValue("--batch");
    if (!claimId) fail(2, "--claim is required");
    if (!["supported", "uncertain", "unsupported"].includes(aisLabel)) fail(2, "--ais must be supported|uncertain|unsupported");
    if (!annotator) fail(2, "--annotator is required");
    if (!batchId) fail(2, "--batch is required");
    return {
      schema: core.ATTRIBUTION_GOLD_LABEL_SCHEMA,
      claimId,
      aisLabel,
      annotator,
      annotatedAt: argValue("--at") ?? new Date().toISOString(),
      batchId,
      ...(argValue("--note") ? { note: argValue("--note") } : {}),
    };
  }

  const verb = process.argv[2];
  if (!verb) fail(2, "verb is required: sample|label");

  if (verb === "sample") {
    const sub = process.argv[3];
    if (sub === "add") {
      const samples = readSamples().samples;
      const next = sampleInput();
      if (samples.some((sample) => sample.claimId === next.claimId)) fail(2, "sample already exists: " + next.claimId);
      writeJsonl(samplesPath, [...samples, next]);
      process.stdout.write("added sample " + next.claimId + "\n");
    } else if (sub === "list") {
      const { samples, errors } = readSamples();
      if (errors.length) fail(2, errors.join("; "));
      process.stdout.write(samples.map((sample) => [sample.claimId, sample.fusedScore, sample.claimText].join("\t")).join("\n") + (samples.length ? "\n" : ""));
    } else {
      fail(2, "unknown sample subcommand");
    }
    return;
  }

  if (verb === "manifest" && process.argv[3] === "init") {
    const { samples, errors } = readSamples();
    if (errors.length) fail(2, errors.join("; "));
    if (fs.existsSync(manifestPath)) fail(2, "manifest already exists: " + manifestPath);
    writeJson(manifestPath, core.buildManifest(samples, [], rubricHash, argValue("--note")));
    process.stdout.write("initialized attribution-gold manifest (" + samples.length + " samples)\n");
    return;
  }

  if (verb === "label") {
    const sub = process.argv[3];
    if (sub === "add" || sub === "set") {
      const state = requireState();
      if (state.manifest.promotedVersion !== null) fail(2, "promoted label set is frozen");
      const next = labelInput();
      const result = sub === "add"
        ? core.addLabel(state.labels, next, state.samples)
        : core.setLabel(state.labels, next, state.samples);
      if (!result.ok || !result.labels) fail(result.code, result.detail);
      writeJsonl(labelsPath, result.labels);
      writeJson(manifestPath, core.buildManifest(state.samples, result.labels, rubricHash, argValue("--note")));
      process.stdout.write(result.detail + "\n");
    } else if (sub === "remove") {
      const state = requireState();
      if (state.manifest.promotedVersion !== null) fail(2, "promoted label set is frozen");
      const claimId = argValue("--claim");
      if (!claimId) fail(2, "--claim is required");
      const result = core.removeLabel(state.labels, claimId, state.samples);
      if (!result.ok || !result.labels) fail(result.code, result.detail);
      writeJsonl(labelsPath, result.labels);
      writeJson(manifestPath, core.buildManifest(state.samples, result.labels, rubricHash, argValue("--note")));
      process.stdout.write(result.detail + "\n");
    } else if (sub === "list") {
      const { labels, errors } = readLabels();
      if (errors.length) fail(2, errors.join("; "));
      process.stdout.write(labels.map((label) => [label.claimId, label.aisLabel, label.annotator, label.batchId, label.annotatedAt].join("\t")).join("\n") + (labels.length ? "\n" : ""));
    } else if (sub === "status") {
      const state = requireState();
      const fit = core.binaryFitSamples(state.samples, state.labels);
      process.stdout.write([
        "samples=" + state.samples.length,
        "labeled=" + state.labels.length,
        "fit=" + fit.fit.length,
        "uncertain=" + fit.uncertain,
        "coverage=" + fit.coverage.toFixed(3),
        "promotedVersion=" + String(state.manifest.promotedVersion ?? "none"),
      ].join("\n") + "\n");
    } else if (sub === "validate") {
      const state = requireState();
      process.stdout.write("attribution-gold labels and manifest are consistent\n");
      process.exit(0);
    } else if (sub === "promote") {
      const state = requireState();
      const promotedAt = new Date().toISOString();
      const next = {
        ...state.manifest,
        promotedVersion: (state.manifest.promotedVersion ?? 0) + 1,
        promotedAt,
        promotedFingerprint: core.labelsFingerprint(state.labels),
      };
      writeJson(manifestPath, next);
      process.stdout.write("promoted attribution-gold label set to version " + next.promotedVersion + "\n");
    } else {
      fail(2, "unknown label subcommand");
    }
    return;
  }

  fail(2, "first verb must be sample or label");
}

if (process.env.ANS_ATTRIBUTION_GOLD_LABELS_TSX !== "1") {
  const loader = pathToFileURL(path.join(root, "packages", "store", "node_modules", "tsx", "dist", "loader.mjs")).href;
  const entry = path.relative(process.cwd(), scriptPath).split(path.sep).join("/");
  const child = spawnSync(process.execPath, ["--import", loader, entry, ...process.argv.slice(2)], {
    env: { ...process.env, ANS_ATTRIBUTION_GOLD_LABELS_TSX: "1" },
    stdio: "inherit",
  });
  process.exit(child.status ?? 2);
}

run().catch((error) => {
  console.error("attribution-gold-labels: internal error: " + String(error && error.stack || error));
  process.exit(2);
});
