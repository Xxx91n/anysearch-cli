// gain-ledger streak semantics + human resolution.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { readGainLedger, writeGainLedger, applyTier, applyResolution, mustFail, emptyLedger, WARN_STREAK_LIMIT, withSkipLedgerLock } from "../../../scripts/gain-ledger.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const RESOLVE_SCRIPT = path.resolve(SCRIPT_DIR, "../../../scripts/gain-warn-resolve.mjs");

// run gain-warn-resolve against a ledger file; return { code, stderr }.
function runResolve(f, decision = "stay-warn") {
  let code = 0;
  let stderr = "";
  try {
    execFileSync(process.execPath, [RESOLVE_SCRIPT, "--decision", decision, "--note", "x", "--ledger", f], {
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    code = e.status ?? null;
    stderr = e.stderr ? e.stderr.toString() : "";
  }
  return { code, stderr };
}

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
// @3 skip-ledger survives human resolution via direct API: streak cleared, one
// resolution added, history / state block / actions log preserved.
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
// e2e: running gain-warn-resolve on an @3 ledger must keep all evidence and
// leave no .tmp / .skip-ledger.lock residue (resolves tmW).
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gain-ledger-e2e-"));
  const f = path.join(dir, "skip-ledger.json");
  const at3 = {
    schema: "anysearch/gain-ledger@3",
    consecutiveWarn: 3,
    history: [{ at: "2026-01-01T00:00:00Z", tier: "warn", look: "k1", track: "consumed", reasonCode: "gate-not-met" }],
    resolutions: [],
    lastSkipKeys: ["k1"],
    state: { phase: "S2", since: "2026-01-01T00:00:00Z", transitionId: "tx-1", evidenceHash: "eh-1" },
    actions: [{ at: "2026-01-01T00:00:00Z", kind: "stage-transition", from: "S1", to: "S2", reason: "rollout" }],
    revision: 9,
  };
  writeGainLedger(f, at3);
  const before = fs.readFileSync(f, "utf8");
  const { code, stderr } = runResolve(f, "stay-warn");
  assert.equal(code, 0, "e2e @3 resolve must exit 0, got " + code + (stderr ? ": " + stderr : ""));
  const after = JSON.parse(fs.readFileSync(f, "utf8"));
  assert.equal(after.schema, "anysearch/gain-ledger@3", "e2e schema must stay @3");
  assert.equal(after.consecutiveWarn, 0, "e2e streak must be zeroed");
  assert.equal(after.resolutions.length, 1, "e2e one resolution recorded");
  assert.equal(after.resolutions[0].note, "x", "e2e note preserved");
  assert.equal(after.history.length, 1, "e2e history untouched");
  assert.deepStrictEqual(after.state, { phase: "S2", since: "2026-01-01T00:00:00Z", transitionId: "tx-1", evidenceHash: "eh-1" }, "e2e state block preserved");
  assert.equal(after.actions.length, 1, "e2e actions preserved");
  assert.equal(after.revision, 9, "e2e revision preserved");
  assert.deepStrictEqual(after.lastSkipKeys, ["k1"], "e2e lastSkipKeys preserved");
  assert.equal(fs.existsSync(f + ".tmp"), false, "e2e no .tmp residue");
  assert.equal(fs.existsSync(path.join(dir, ".skip-ledger.lock")), false, "e2e no lock residue");
  fs.rmSync(dir, { recursive: true, force: true });
}
// unrecognized schema (@9) must fail loud, never overwrite evidence
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gain-ledger-unknown-"));
  const f = path.join(dir, "skip-ledger.json");
  const unknown = { schema: "anysearch/gain-ledger@9", consecutiveWarn: 3, history: [], resolutions: [] };
  writeGainLedger(f, unknown);
  const before = fs.readFileSync(f, "utf8");
  const { code } = runResolve(f, "stay-warn");
  assert.equal(code, 1, "unrecognized schema must exit exactly 1");
  assert.equal(fs.readFileSync(f, "utf8"), before, "unrecognized schema must not overwrite");
  fs.rmSync(dir, { recursive: true, force: true });
}
// bad-shaped @2 (consecutiveWarn not a number) must fail loud, never be
// "repaired" into empty @1 and clobbered (resolves tmq part 1)
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gain-ledger-badshape-"));
  const f = path.join(dir, "skip-ledger.json");
  const bad = { schema: "anysearch/gain-ledger@2", consecutiveWarn: "3", history: [], resolutions: [] };
  writeGainLedger(f, bad);
  const before = fs.readFileSync(f, "utf8");
  const { code } = runResolve(f, "stay-warn");
  assert.equal(code, 1, "bad-shaped @2 ledger must exit exactly 1");
  assert.equal(fs.readFileSync(f, "utf8"), before, "bad-shaped @2 ledger must not overwrite");
  fs.rmSync(dir, { recursive: true, force: true });
}
// well-formed @2 round-trip: applyResolution adds disposition/verdict, but
// writeGainLedger must strip them for @2 so they never leak into
// skip-ledger.json (resolves tmq part 2 — test + implementation together)
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gain-ledger-@2-"));
  const f = path.join(dir, "skip-ledger.json");
  const v2 = {
    schema: "anysearch/gain-ledger@2",
    consecutiveWarn: 0,
    history: [],
    resolutions: [],
  };
  writeGainLedger(f, v2);
  const ledger = readGainLedger(f);
  applyResolution(ledger, "stay-warn", "2026-01-02T00:00:00Z", "x");
  writeGainLedger(f, ledger);
  const text = fs.readFileSync(f, "utf8");
  assert.ok(!text.includes("disposition"), "@2 file must not contain disposition");
  assert.ok(!text.includes("verdict"), "@2 file must not contain verdict");
  assert.equal(JSON.parse(text).schema, "anysearch/gain-ledger@2", "@2 schema preserved");
  fs.rmSync(dir, { recursive: true, force: true });
}
// withSkipLedgerLock 保证同一把锁上的顺序读-改-写不互相覆盖：两次获取锁，
// 每次读出当前值、加一、写回，最终计数器应为 2（两次都基于最新值写入）。
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gain-ledger-lock-"));
  const counter = path.join(dir, "counter.txt");
  fs.writeFileSync(counter, "0", "utf8");
  withSkipLedgerLock(counter, () => {
    const v = Number(fs.readFileSync(counter, "utf8") || "0");
    fs.writeFileSync(counter, String(v + 1), "utf8");
  });
  withSkipLedgerLock(counter, () => {
    const v = Number(fs.readFileSync(counter, "utf8") || "0");
    fs.writeFileSync(counter, String(v + 1), "utf8");
  });
  assert.equal(fs.readFileSync(counter, "utf8"), "2", "顺序两次读改写不互相覆盖");
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log("gain-ledger.test.mjs: all checks passed");
