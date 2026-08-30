// ADR-0038 D2: gain-ledger streak semantics + human resolution.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readGainLedger, writeGainLedger, applyTier, applyResolution, mustFail, emptyLedger, WARN_STREAK_LIMIT } from "../../../scripts/gain-ledger.mjs";

// streak: three consecutive WARNs trip the forced-review latch
{
  const l = emptyLedger();
  for (let i = 0; i < WARN_STREAK_LIMIT - 1; i++) { applyTier(l, "warn", "t" + i, i + 1); assert.equal(mustFail(l), false, "before the limit no forced review"); }
  applyTier(l, "warn", "t-last", WARN_STREAK_LIMIT);
  assert.equal(mustFail(l), true, "WARN x" + WARN_STREAK_LIMIT + " forces human review");
}
// green resets the streak
{
  const l = emptyLedger();
  applyTier(l, "warn", "t1", 1); applyTier(l, "warn", "t2", 2);
  applyTier(l, "green", "t3", 3);
  assert.equal(l.consecutiveWarn, 0, "GREEN clears the streak");
  assert.equal(mustFail(l), false);
}
// resolution clears the streak and is recorded
{
  const l = emptyLedger();
  applyTier(l, "warn", "t1", 1); applyTier(l, "warn", "t2", 2); applyTier(l, "warn", "t3", 3);
  applyResolution(l, "stay-warn", "t4", "investigating arm calibration");
  assert.equal(l.consecutiveWarn, 0);
  assert.equal(l.resolutions.length, 1);
  assert.throws(() => applyResolution(l, "bogus", "t5"), /unknown resolution/);
}
// file round-trip
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gain-ledger-"));
  const f = path.join(dir, "gain-ledger.json");
  writeGainLedger(f, applyTier(emptyLedger(), "warn", "t", 1));
  const back = readGainLedger(f);
  assert.equal(back.consecutiveWarn, 1);
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log("gain-ledger.test.mjs: all checks passed");

