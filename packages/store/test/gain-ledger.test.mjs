// gain-ledger streak semantics + human resolution.
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
// @3 skip-ledger survives human resolution: streak cleared, one resolution added,
// history / state block / actions log preserved — nothing is wiped (#592).
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gain-ledger-@3-"));
  const f = path.join(dir, "skip-ledger.json");
  const at3 = {
    schema: "anysearch/gain-ledger@3",
    consecutiveWarn: 3,
    history: [{ at: "2026-01-01T00:00:00Z", tier: "warn", look: "k1; k2", track: "consumed", reasonCode: "gate-not-met" }],
    resolutions: [{ at: "2026-01-01T00:00:00Z", decision: "stay-warn", note: "first" }],
    lastSkipKeys: ["k1", "k2"],
    state: { phase: "S2", since: "2026-01-01T00:00:00Z", transitionId: "tx-1", evidenceHash: "eh-1" },
    actions: [{ at: "2026-01-01T00:00:00Z", kind: "stage-transition", from: "S1", to: "S2", reason: "rollout" }],
    revision: 9,
  };
  writeGainLedger(f, at3);
  assert.equal(readGainLedger(f).schema, "anysearch/gain-ledger@3", "@3 schema survives round-trip");
  assert.equal(readGainLedger(f).revision, 9, "@3 round-trip keeps revision");
  const resolved = readGainLedger(f);
  applyResolution(resolved, "stay-warn", "2026-01-02T00:00:00Z", "observational-skip confirmed");
  writeGainLedger(f, resolved);
  const again = readGainLedger(f);
  assert.equal(again.consecutiveWarn, 0, "@3 resolve zeroes the streak");
  assert.equal(again.resolutions.length, 2, "@3 resolve appends one resolution");
  assert.equal(again.resolutions[1].note, "observational-skip confirmed");
  assert.equal(again.history.length, 1, "@3 history untouched");
  assert.deepStrictEqual(again.state, { phase: "S2", since: "2026-01-01T00:00:00Z", transitionId: "tx-1", evidenceHash: "eh-1" }, "@3 state block preserved");
  assert.equal(again.actions.length, 1, "@3 actions preserved");
  assert.equal(again.revision, 9, "@3 revision preserved");
  assert.deepStrictEqual(again.lastSkipKeys, ["k1", "k2"], "@3 lastSkipKeys preserved");
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log("gain-ledger.test.mjs: all checks passed");

