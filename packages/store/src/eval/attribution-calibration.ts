// ADR-0050 D6: immutable attribution calibration bundles. Content-addressed
// JSON per bundle; the active calibration is a head pointer, so rollback is a
// pointer move and never a rewrite. Lives beside the attribution-gold revision
// root but is managed by scripts/attribution-calibrate.mjs, not rev verbs.

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

export const ATTRIBUTION_CALIBRATION_BUNDLE_SCHEMA = "anysearch/attribution-calibration-bundle@1";
export const ATTRIBUTION_CALIBRATION_DIR = "calibrations";
export const ATTRIBUTION_CALIBRATION_HEAD = "calibration-head.json";

export const AttributionCalibrationBundleSchema = Type.Object(
  {
    schema: Type.Literal(ATTRIBUTION_CALIBRATION_BUNDLE_SCHEMA),
    createdAt: Type.String({ minLength: 20 }),
    labelsDigest: Type.String({ minLength: 16 }),
    params: Type.Object({ a: Type.Number(), b: Type.Number(), c: Type.Number() }, { additionalProperties: false }),
    thresholds: Type.Object(
      { supported: Type.Number(), unsupported: Type.Number(), degraded: Type.Boolean() },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export type AttributionCalibrationBundle = Static<typeof AttributionCalibrationBundleSchema>;

function jcs(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(jcs).join(",") + "]";
  const record = value as Record<string, unknown>;
  return "{" + Object.keys(record).sort().map((key) => JSON.stringify(key) + ":" + jcs(record[key])).join(",") + "}";
}

export function calibrationBundleDigest(bundle: AttributionCalibrationBundle): string {
  return createHash("sha256").update(jcs(bundle)).digest("hex");
}

function atomicWriteJson(file: string, value: unknown): void {
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, file);
}

// Writes the bundle under calibrations/<digest>.json and, when activate is
// set, moves the head pointer. Bundles are never rewritten.
export function writeCalibrationBundle(
  revisionRoot: string,
  bundle: AttributionCalibrationBundle,
  options: { activate?: boolean } = {},
): { digest: string; bundlePath: string } {
  if (!Value.Check(AttributionCalibrationBundleSchema, bundle)) {
    throw new Error("calibration bundle schema mismatch");
  }
  const digest = calibrationBundleDigest(bundle);
  const directory = path.join(revisionRoot, ATTRIBUTION_CALIBRATION_DIR);
  fs.mkdirSync(directory, { recursive: true });
  const bundlePath = path.join(directory, digest + ".json");
  if (!fs.existsSync(bundlePath)) {
    atomicWriteJson(bundlePath, bundle);
  }
  if (options.activate) {
    atomicWriteJson(path.join(revisionRoot, ATTRIBUTION_CALIBRATION_HEAD), {
      schema: "anysearch/attribution-calibration-head@1",
      digest,
      updatedAt: bundle.createdAt,
    });
  }
  return { digest, bundlePath };
}

// Point the head at an already-written bundle; rollback is only this.
export function setCalibrationHead(revisionRoot: string, digest: string, updatedAt: string): void {
  const bundlePath = path.join(revisionRoot, ATTRIBUTION_CALIBRATION_DIR, digest + ".json");
  if (!fs.existsSync(bundlePath)) {
    throw new Error("no calibration bundle for digest " + digest);
  }
  atomicWriteJson(path.join(revisionRoot, ATTRIBUTION_CALIBRATION_HEAD), {
    schema: "anysearch/attribution-calibration-head@1",
    digest,
    updatedAt,
  });
}

// Reads the bundle the head points at. A missing head, missing bundle, or
// digest mismatch yields null (fail-open) rather than throwing.
export function readActiveCalibrationBundle(revisionRoot: string): { digest: string; bundle: AttributionCalibrationBundle } | null {
  const headPath = path.join(revisionRoot, ATTRIBUTION_CALIBRATION_HEAD);
  if (!fs.existsSync(headPath)) return null;
  let head: { digest?: string };
  try {
    head = JSON.parse(fs.readFileSync(headPath, "utf8"));
  } catch {
    return null;
  }
  if (typeof head.digest !== "string") return null;
  const bundlePath = path.join(revisionRoot, ATTRIBUTION_CALIBRATION_DIR, head.digest + ".json");
  if (!fs.existsSync(bundlePath)) return null;
  let bundle: AttributionCalibrationBundle;
  try {
    bundle = JSON.parse(fs.readFileSync(bundlePath, "utf8"));
  } catch {
    return null;
  }
  if (!Value.Check(AttributionCalibrationBundleSchema, bundle)) return null;
  if (calibrationBundleDigest(bundle) !== head.digest) return null;
  return { digest: head.digest, bundle };
}
