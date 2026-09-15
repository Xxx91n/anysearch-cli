// ADR-0051 D1: composition root resolves the active calibration head through
// the store reader; missing/corrupt head fails open (legacy 0.6 floor).
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeCalibrationBundle, setCalibrationHead } from "@anysearch-cli/store";
import { resolveActiveAttributionCalibration, resolveAttributionRevisionRoot } from "../src/composition";

function makeBundle(params: { a: number; b: number; c: number }, createdAt: string) {
  return {
    schema: "anysearch/attribution-calibration-bundle@1" as const,
    createdAt,
    labelsDigest: "sha256:0000000000000000",
    params,
    thresholds: { supported: 0.7, unsupported: 0.4, degraded: false },
  };
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "ans-composition-cal-"));
try {
  // Missing root/head -> undefined.
  assert.equal(resolveActiveAttributionCalibration({ ANS_ATTRIBUTION_GOLD_REVISION_ROOT: root } as NodeJS.ProcessEnv), undefined, "missing head fails open");

  // Active head loads and is immutable.
  const v1 = writeCalibrationBundle(root, makeBundle({ a: 1, b: 1, c: 0 }, "2026-09-01T00:00:00.000Z"), { activate: true });
  const cal = resolveActiveAttributionCalibration({ ANS_ATTRIBUTION_GOLD_REVISION_ROOT: root } as NodeJS.ProcessEnv);
  assert.ok(cal, "active head resolves");
  assert.equal(cal.thresholds.supported, 0.7);
  assert.ok(Object.isFrozen(cal) && Object.isFrozen(cal.params), "injected calibration is immutable");

  // Rollback is a pointer move; the composition root follows it.
  writeCalibrationBundle(root, makeBundle({ a: 2, b: 2, c: 2 }, "2026-09-02T00:00:00.000Z"), { activate: true });
  setCalibrationHead(root, v1.digest, "2026-09-03T00:00:00.000Z");
  assert.deepEqual(resolveActiveAttributionCalibration({ ANS_ATTRIBUTION_GOLD_REVISION_ROOT: root } as NodeJS.ProcessEnv)?.params, { a: 1, b: 1, c: 0 }, "composition follows rollback pointer");

  // Corrupt head fails open.
  fs.writeFileSync(path.join(root, "calibration-head.json"), "{ truncated", "utf8");
  assert.equal(resolveActiveAttributionCalibration({ ANS_ATTRIBUTION_GOLD_REVISION_ROOT: root } as NodeJS.ProcessEnv), undefined, "corrupt head fails open");

  // Env path resolution honors the override.
  assert.equal(resolveAttributionRevisionRoot({ ANS_ATTRIBUTION_GOLD_REVISION_ROOT: root } as NodeJS.ProcessEnv), path.resolve(root));
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
console.log("composition-calibration.test: ok");
