// ADR-0048 D6: table-driven unit coverage for the pure label lifecycle core.
import assert from "node:assert";
import {
  addLabel,
  buildManifest,
  caseFingerprint,
  labeledCalibrationCases,
  labelsFingerprint,
  parseLabelLines,
  promoteLabels,
  removeLabel,
  setLabel,
  validateCalibrationState,
  type CalibrationLabelRecord,
} from "../src/eval/calibration-labels";
import { CALIBRATION_CASES } from "../src/eval/calibration-cases";
import { CalibrationJsonSchemas } from "../src/eval/calibration-labels-schema";

function labeledAll(): CalibrationLabelRecord[] {
  return CALIBRATION_CASES.map((item) => ({
    schema: "anysearch/calibration-label@1",
    caseId: item.id,
    label: 1,
    annotator: "human",
    annotatedAt: "2026-09-05T00:00:00.000Z",
  }));
}

assert.equal(labelsFingerprint([]), "da39a3ee5e6b4b0d", "empty labels fingerprint is deterministic");
assert.equal(caseFingerprint(), "df7a0a4b63954803", "seed case fingerprint is frozen for ADR-0048 initial state");

const invalidLine = parseLabelLines('{"schema":"anysearch/calibration-label@1","caseId":"x","label":2}\n');
assert.equal(invalidLine.errors.length, 1, "invalid label value is rejected");

const validLine = parseLabelLines('{"schema":"anysearch/calibration-label@1","caseId":"cal_supersession_1","label":1,"annotator":"human","annotatedAt":"2026-09-05T00:00:00.000Z"}\n');
assert.equal(validLine.records.length, 1, "valid label line parses");

const all = labeledAll();
const manifest = buildManifest(all);
assert.equal(validateCalibrationState(all, manifest).code, 0, "complete valid label set passes");

const partial = all.slice(0, 1);
const partialManifest = buildManifest(partial);
assert.equal(validateCalibrationState(partial, partialManifest).code, 0, "partial valid label set is still consistent");
assert.equal(promoteLabels(partial, partialManifest, "2026-09-05T00:00:00.000Z").code, 2, "promote refuses incomplete label coverage");

const promoted = promoteLabels(all, manifest, "2026-09-05T00:00:00.000Z");
assert.equal(promoted.code, 0, "promote accepts complete label coverage");
assert.equal(promoted.manifest?.promotedVersion, 1, "promote increments version");
assert.equal(promoted.manifest?.promotedFingerprint, labelsFingerprint(all), "promote records label fingerprint");

const drift = {
  ...manifest,
  labelsFingerprint: "ffffffffffffffff",
};
assert.equal(validateCalibrationState(all, drift).code, 12, "labels fingerprint drift exits 12");

const next: CalibrationLabelRecord = {
  schema: "anysearch/calibration-label@1",
  caseId: "cal_temporal_1",
  label: 0,
  annotator: "human-2",
  annotatedAt: "2026-09-05T00:00:00.000Z",
};
const addResult = addLabel(partial, next);
assert.equal(addResult.code, 0, "add inserts a new case label");
assert.equal(addResult.records?.some((record) => record.caseId === next.caseId), true, "add returns the updated records");
assert.equal(addLabel(addResult.records!, next).code, 2, "add rejects an existing case label");
const setResult = setLabel(addResult.records!, { ...next, label: 1 });
assert.equal(setResult.code, 0, "set upserts an existing case label");
assert.equal(setResult.records?.find((record) => record.caseId === next.caseId)?.label, 1, "set replaces the label value");
const removeResult = removeLabel(setResult.records!, next.caseId);
assert.equal(removeResult.code, 0, "remove deletes an existing case label");
assert.equal(removeResult.records?.some((record) => record.caseId === next.caseId), false, "remove returns the updated records");
assert.equal(removeLabel(removeResult.records!, next.caseId).code, 2, "remove rejects a missing case label");

assert.equal(addLabel([], { ...next, caseId: "unknown" }).code, 2, "add rejects an unknown seed case");
assert.equal(setLabel([], { ...next, caseId: "unknown" }).code, 2, "set rejects an unknown seed case");
assert.equal(removeLabel([], "unknown").code, 2, "remove rejects an unknown seed case");

const labeledCases = labeledCalibrationCases(CALIBRATION_CASES, all);
assert.equal(labeledCases.filter((item) => item.humanRelevant === 0 || item.humanRelevant === 1).length, CALIBRATION_CASES.length, "labels map onto every seed case");

assert.equal(CalibrationJsonSchemas.label.type, "object", "derived label JSON Schema is an object");
assert.equal(CalibrationJsonSchemas.manifest.type, "object", "derived manifest JSON Schema is an object");

console.log("calibration-labels.test: ok");
