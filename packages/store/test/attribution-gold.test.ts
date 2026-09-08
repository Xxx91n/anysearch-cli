// ADR-0050 D3/D4: attribution-gold schema, fingerprint, mutation, and
// AIS-to-binary fitting invariants.
import assert from "node:assert";
import {
  ATTRIBUTION_GOLD_LABEL_SCHEMA,
  ATTRIBUTION_GOLD_SAMPLE_SCHEMA,
  ATTRIBUTION_GOLD_LINE,
  addLabel,
  binaryFitSamples,
  buildManifest,
  labelsFingerprint,
  parseLabelLines,
  parseManifest,
  parseSampleLines,
  attributionGoldDigest,
  sampleFingerprint,
  sampleInstance,
  setLabel,
  validateState,
  type AttributionGoldLabel,
  type AttributionGoldSample,
} from "../src/eval/attribution-gold";

const rubricHash = "a057d6e4f1ba1d04";
const samples: AttributionGoldSample[] = [
  { schema: ATTRIBUTION_GOLD_SAMPLE_SCHEMA, claimId: "c1", claimText: "alpha", fusedScore: 0.9, instance: "web" },
  { schema: ATTRIBUTION_GOLD_SAMPLE_SCHEMA, claimId: "c2", claimText: "beta", fusedScore: 0.2 },
];
const labels: AttributionGoldLabel[] = [
  { schema: ATTRIBUTION_GOLD_LABEL_SCHEMA, claimId: "c1", aisLabel: "supported", annotator: "human", annotatedAt: "2026-09-07T00:00:00.000Z", batchId: "b1" },
  { schema: ATTRIBUTION_GOLD_LABEL_SCHEMA, claimId: "c2", aisLabel: "unsupported", annotator: "human", annotatedAt: "2026-09-07T00:00:00.000Z", batchId: "b1" },
];

assert.equal(sampleFingerprint(samples), sampleFingerprint([...samples].reverse()), "sample fingerprint is deterministic");
assert.equal(labelsFingerprint(labels), labelsFingerprint([...labels].reverse()), "label fingerprint is deterministic");
assert.ok(attributionGoldDigest(labels).startsWith("sha256:"), "revision digest uses sha256");

const manifest = buildManifest(samples, labels, rubricHash);
assert.equal(manifest.line, ATTRIBUTION_GOLD_LINE, "manifest line is attribution-gold");
assert.equal(validateState(samples, labels, manifest, rubricHash).ok, true, "valid state passes");

const mutated = setLabel(labels, { ...labels[0]!, aisLabel: "uncertain" }, samples);
assert.ok(mutated.ok && mutated.labels, "setLabel succeeds");
assert.equal(binaryFitSamples(samples, mutated.labels).uncertain, 1, "uncertain is excluded from fit");
assert.equal(binaryFitSamples(samples, mutated.labels).fit.length, 1, "only binary labels enter fit");

const parsedSamples = parseSampleLines(samples.map((sample) => JSON.stringify(sample)).join("\n"));
const parsedLabels = parseLabelLines(labels.map((label) => JSON.stringify(label)).join("\n"));
assert.equal(parsedSamples.errors.length, 0, "sample parser accepts valid lines");
assert.equal(parsedLabels.errors.length, 0, "label parser accepts valid lines");
assert.equal(parseManifest(JSON.stringify(manifest)).error, null, "manifest parser accepts valid manifest");

const added = addLabel(labels, {
  schema: ATTRIBUTION_GOLD_LABEL_SCHEMA,
  claimId: "c3",
  aisLabel: "supported",
  annotator: "human",
  annotatedAt: "2026-09-07T00:00:01.000Z",
  batchId: "b1",
}, samples);
assert.equal(added.ok, false, "unknown sample is rejected");

console.log("attribution-gold.test: ok");

// ADR-0051 D4: schema @2 segment audit field.
assert.equal(ATTRIBUTION_GOLD_SAMPLE_SCHEMA, "anysearch/attribution-gold-sample@2", "sample schema is @2");
assert.equal(sampleInstance(samples[0]!), "web");
const { instance: _stripped, ...unlabeled } = samples[0]!;
assert.equal(sampleInstance(unlabeled as AttributionGoldSample), "web", "absent instance defaults to web");
const memoryVersion = samples.map((s) => ({ ...s, instance: "memory" as const }));
assert.notEqual(sampleFingerprint(memoryVersion), sampleFingerprint(samples), "instance enters the canonical fingerprint");
assert.notEqual(sampleFingerprint([unlabeled as AttributionGoldSample, samples[1]!]), sampleFingerprint(samples), "explicit instance enters the fingerprint; absent keeps the legacy @1 canonical form");
// Audit-only: instance must not touch beta fitting inputs.
assert.deepEqual(binaryFitSamples(memoryVersion, labels).fit, binaryFitSamples(samples, labels).fit, "fit is instance-blind");
// @1 records upcast losslessly to @2 (ADR-0043 precedent + ADR-0051 audit).
const legacy = parseSampleLines(JSON.stringify({ schema: "anysearch/attribution-gold-sample@1", claimId: "c9", claimText: "x", fusedScore: 0.5 }));
assert.equal(legacy.errors.length, 0, "@1 records parse after the lossless upcast");
assert.equal(legacy.samples.length, 1, "upcast preserves the record");
assert.equal(legacy.samples[0]!.instance, undefined, "upcast leaves instance absent so the fingerprint matches pre-@2 bundles");
assert.equal(sampleInstance(legacy.samples[0]!), "web", "effective instance still defaults to web");
console.log("attribution-gold.test ADR-0051 D4 assertions: ok");
