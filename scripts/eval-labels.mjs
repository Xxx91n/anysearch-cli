// ADR-0048 D3: thin CLI over the pure label core. The acceptance command is
// plain `node scripts/eval-labels.mjs`; this wrapper re-enters itself under
// the workspace-local tsx loader so the TypeScript core resolves extensionless
// imports without adding a root runtime dependency.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = fileURLToPath(import.meta.url);
const labelsPath = process.env.ANS_CALIBRATION_LABELS_PATH
  ? path.resolve(process.env.ANS_CALIBRATION_LABELS_PATH)
  : path.join(root, "packages", "store", "calibration-labels.jsonl");
const manifestPath = process.env.ANS_CALIBRATION_MANIFEST_PATH
  ? path.resolve(process.env.ANS_CALIBRATION_MANIFEST_PATH)
  : path.join(root, "packages", "store", "calibration-manifest.json");

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function fail(code, detail) {
  process.stderr.write("eval-labels: " + detail + "\n");
  process.exit(code);
}

async function run() {
  const core = await import("../packages/store/src/eval/calibration-labels.ts");
  const seed = await import("../packages/store/src/eval/calibration-cases.ts");

  function readLabels() {
    if (!fs.existsSync(labelsPath)) return { records: [], errors: [] };
    return core.parseLabelLines(fs.readFileSync(labelsPath, "utf8"));
  }

  function readManifest() {
    if (!fs.existsSync(manifestPath)) return { manifest: null, error: "manifest not found: " + manifestPath };
    return core.parseManifest(fs.readFileSync(manifestPath, "utf8"));
  }

  function writeLabels(records) {
    fs.mkdirSync(path.dirname(labelsPath), { recursive: true });
    fs.writeFileSync(
      labelsPath,
      records.length ? records.map((record) => JSON.stringify(record)).join("\n") + "\n" : "",
      "utf8",
    );
  }

  function writeManifest(manifest) {
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  }

  function requireState() {
    const labels = readLabels();
    if (labels.errors.length) fail(2, labels.errors.join("; "));
    const loadedManifest = readManifest();
    if (loadedManifest.error || !loadedManifest.manifest) fail(2, loadedManifest.error ?? "manifest missing");
    const validated = core.validateCalibrationState(labels.records, loadedManifest.manifest, seed.CALIBRATION_CASES);
    if (!validated.ok) fail(validated.code, validated.detail);
    return { records: labels.records, manifest: loadedManifest.manifest };
  }

  function mutationInput() {
    const caseId = argValue("--case");
    const annotator = argValue("--annotator");
    if (!caseId) fail(2, "--case is required");
    if (!annotator) fail(2, "--annotator is required");
    const labelText = argValue("--label");
    if (!labelText || !/^[01]$/.test(labelText)) fail(2, "--label must be 0 or 1");
    const annotatedAt = argValue("--at") ?? new Date().toISOString();
    const note = argValue("--note");
    return {
      schema: "anysearch/calibration-label@1",
      caseId,
      label: Number(labelText),
      annotator,
      annotatedAt,
      ...(note ? { note } : {}),
    };
  }

  function printLabelRecords(records) {
    if (!records.length) {
      process.stdout.write("no calibration labels\n");
      return;
    }
    for (const record of records) {
      process.stdout.write(record.caseId + "\t" + record.label + "\t" + record.annotator + "\t" + record.annotatedAt + "\n");
    }
  }

  const verb = process.argv[2];
  if (!verb) fail(2, "verb is required: add|set|remove|list|status|validate|promote");

  if (verb === "add" || verb === "set") {
    const state = requireState();
    if (state.manifest.promotedVersion !== null) fail(2, "promoted label set is frozen");
    const next = mutationInput();
    const result = verb === "add"
      ? core.addLabel(state.records, next, seed.CALIBRATION_CASES)
      : core.setLabel(state.records, next, seed.CALIBRATION_CASES);
    if (!result.ok || !result.records) fail(result.code, result.detail);
    writeLabels(result.records);
    writeManifest(core.buildManifest(result.records, seed.CALIBRATION_CASES, argValue("--note")));
    process.stdout.write(result.detail + "\n");
  } else if (verb === "remove") {
    const state = requireState();
    if (state.manifest.promotedVersion !== null) fail(2, "promoted label set is frozen");
    const caseId = argValue("--case");
    if (!caseId) fail(2, "--case is required");
    const result = core.removeLabel(state.records, caseId, seed.CALIBRATION_CASES);
    if (!result.ok || !result.records) fail(result.code, result.detail);
    writeLabels(result.records);
    writeManifest(core.buildManifest(result.records, seed.CALIBRATION_CASES, argValue("--note")));
    process.stdout.write(result.detail + "\n");
  } else if (verb === "list") {
    const labels = readLabels();
    if (labels.errors.length) fail(2, labels.errors.join("; "));
    printLabelRecords(labels.records);
  } else if (verb === "status") {
    const labels = readLabels();
    if (labels.errors.length) fail(2, labels.errors.join("; "));
    const loadedManifest = readManifest();
    if (loadedManifest.error || !loadedManifest.manifest) fail(2, loadedManifest.error ?? "manifest missing");
    const validated = core.validateCalibrationState(labels.records, loadedManifest.manifest, seed.CALIBRATION_CASES);
    process.stdout.write(
      [
        "labeled=" + labels.records.length + "/" + seed.CALIBRATION_CASES.length,
        "caseFingerprint=" + loadedManifest.manifest.caseFingerprint,
        "labelsFingerprint=" + loadedManifest.manifest.labelsFingerprint,
        "promotedVersion=" + String(loadedManifest.manifest.promotedVersion ?? "none"),
        "valid=" + (validated.ok ? "pass" : "code " + validated.code),
      ].join("\n") + "\n",
    );
  } else if (verb === "validate") {
    const labels = readLabels();
    if (labels.errors.length) fail(2, labels.errors.join("; "));
    const loadedManifest = readManifest();
    if (loadedManifest.error || !loadedManifest.manifest) fail(2, loadedManifest.error ?? "manifest missing");
    const validated = core.validateCalibrationState(labels.records, loadedManifest.manifest, seed.CALIBRATION_CASES);
    process.stdout.write(validated.detail + "\n");
    process.exit(validated.code);
  } else if (verb === "promote") {
    const state = requireState();
    const result = core.promoteLabels(state.records, state.manifest, new Date().toISOString(), seed.CALIBRATION_CASES);
    if (!result.ok || !result.manifest) fail(result.code, result.detail);
    writeManifest(result.manifest);
    process.stdout.write(result.detail + "\n");
  } else {
    fail(2, "unknown verb: " + verb);
  }
}

if (process.env.ANS_EVAL_LABELS_TSX !== "1") {
  const loader = pathToFileURL(path.join(root, "packages", "store", "node_modules", "tsx", "dist", "loader.mjs")).href;
  const entry = path.relative(process.cwd(), scriptPath).split(path.sep).join("/");
  const child = spawnSync(process.execPath, ["--import", loader, entry, ...process.argv.slice(2)], {
    env: { ...process.env, ANS_EVAL_LABELS_TSX: "1" },
    stdio: "inherit",
  });
  process.exit(child.status ?? 2);
}

run().catch((error) => {
  console.error("eval-labels: internal error: " + String(error && error.stack || error));
  process.exit(2);
});
