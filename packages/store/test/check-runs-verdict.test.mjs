// The release gate's verdict, fed a list of check-runs. No YAML, no source
// text, no gh: the point of the #406 split is that the contract is a function,
// so these tests call it.
//
// The case that matters most is "a blocking leg that only registered as
// skipped". It used to read as GREEN. #389 D4 spells out the accident: the job
// that works out which lanes run fails, its name misses the family regex, the
// lanes it gates register as skipped, and the release goes out with no evidence
// behind it.
import assert from "node:assert/strict";
import test from "node:test";
import { FAMILIES, REQUIRED_LEGS, judgeCheckRuns } from "../../../scripts/check-runs-verdict.mjs";

const AT = "2026-11-22T00:00:00Z";
const run = (name, conclusion, status = "completed", startedAt = AT) => ({ name, status, conclusion, started_at: startedAt });

// One passing run per family and per blocking leg: what a healthy release sees.
// Every case below starts here and breaks exactly one thing.
const healthy = () => [
  run("check-build (ubuntu-latest)", "success"),
  run("check-build (windows-latest)", "success"),
  run("install-smoke (B2: pack -> clean install -> doctor -> domain -> search)", "success"),
  run("test:online (online-gated: store vector-arm + embedding, network required)", "success"),
  run("memory-eval (golden, path-filtered)", "success"),
  run("ship-gate (ubuntu-latest)", "success"),
  run("ship-gate (macos-latest)", "success"),
  run("ship-gate (windows-latest)", "success"),
];

test("every check ran and passed: green", () => {
  const verdict = judgeCheckRuns(healthy());
  assert.equal(verdict.verdict, "green");
  assert.equal(verdict.exitCode, 0);
  assert.equal(verdict.counts.matched, healthy().length);
  assert.equal(verdict.counts.ran, healthy().length);
  assert.equal(verdict.counts.skipped, 0);
});

test("neutral counts as ran, next to success", () => {
  const runs = healthy().map((r) => (r.name.startsWith("memory-eval") ? run(r.name, "neutral") : r));
  assert.equal(judgeCheckRuns(runs).verdict, "green");
});

test("one failing check: red, and the reason names it", () => {
  const runs = healthy().map((r) => (r.name === "ship-gate (windows-latest)" ? run(r.name, "failure") : r));
  const verdict = judgeCheckRuns(runs);
  assert.equal(verdict.verdict, "red");
  assert.equal(verdict.exitCode, 1);
  assert.match(verdict.reason, /ship-gate \(windows-latest\)=failure/);
});

test("a blocking leg that only registered as skipped: red in the discovery phase", () => {
  const runs = healthy().map((r) => (r.name === "ship-gate (macos-latest)" ? run(r.name, "skipped") : r));
  const verdict = judgeCheckRuns(runs);
  assert.equal(verdict.verdict, "red");
  assert.equal(verdict.exitCode, 2);
  assert.equal(verdict.phase, "discovery");
  assert.equal(verdict.counts.skipped, 1);
  assert.match(verdict.reason, /never ran \(skipped\): ship-gate \(macos-latest\)/);
});

test("a blocking leg that never registered: waits, then red once the discovery window closes", () => {
  const runs = healthy().filter((r) => r.name !== "ship-gate (macos-latest)");

  const waiting = judgeCheckRuns(runs);
  assert.equal(waiting.verdict, "wait");
  assert.equal(waiting.phase, "discovery");
  assert.deepEqual(waiting.missingLegs, ["ship-gate (macos-latest)"]);

  const closed = judgeCheckRuns(runs, { discoveryExpired: true });
  assert.equal(closed.verdict, "red");
  assert.equal(closed.exitCode, 2);
  assert.equal(closed.phase, "discovery");
  assert.match(closed.reason, /discovery window closed/);
  assert.match(closed.reason, /ship-gate \(macos-latest\)/);
});

test("a family whose every check-run was skipped: red, never green", () => {
  const runs = healthy().map((r) => (r.name.startsWith("memory-eval") ? run(r.name, "skipped") : r));
  const verdict = judgeCheckRuns(runs);
  assert.equal(verdict.verdict, "red");
  assert.equal(verdict.phase, "discovery");
  assert.equal(verdict.counts.skipped, 1);
  assert.match(verdict.reason, /never ran \(skipped\): memory-eval/);
});

test("all five families are required", () => {
  assert.deepEqual(FAMILIES, ["check-build", "install-smoke", "test:online", "ship-gate", "memory-eval"]);
  for (const family of FAMILIES) {
    const runs = healthy().filter((r) => !r.name.startsWith(family));
    const verdict = judgeCheckRuns(runs);
    assert.equal(verdict.verdict, "wait", family + " must be required");
    assert.deepEqual(verdict.missingFamilies, [family], family + " must be named as missing");
  }
});

test("all three blocking legs are required by name", () => {
  // The old lockstep test read ship-gate.yml's matrix with a regex. This is the
  // fact that replaces it: two green legs out of three is not green.
  assert.deepEqual(REQUIRED_LEGS, ["ship-gate (ubuntu-latest)", "ship-gate (macos-latest)", "ship-gate (windows-latest)"]);
  const runs = healthy().filter((r) => !/^ship-gate \((macos|windows)-latest\)$/.test(r.name));
  const verdict = judgeCheckRuns(runs);
  assert.equal(verdict.verdict, "wait");
  assert.deepEqual(verdict.missingLegs, ["ship-gate (macos-latest)", "ship-gate (windows-latest)"]);
});

test("pending checks wait, and the absolute deadline turns them red", () => {
  const runs = healthy().map((r) => (r.name === "check-build (windows-latest)" ? run(r.name, null, "in_progress") : r));

  const waiting = judgeCheckRuns(runs);
  assert.equal(waiting.verdict, "wait");
  assert.equal(waiting.phase, "completion");
  assert.match(waiting.reason, /check-build \(windows-latest\) \(running\)/);

  const late = judgeCheckRuns(runs, { completionExpired: true });
  assert.equal(late.verdict, "red");
  assert.equal(late.exitCode, 2);
  assert.match(late.reason, /deadline passed/);
});

test("a completed check with a conclusion the gate does not model is never green", () => {
  const runs = healthy().map((r) => (r.name.startsWith("install-smoke") ? run(r.name, "stale") : r));
  const waiting = judgeCheckRuns(runs);
  assert.equal(waiting.verdict, "wait");
  assert.equal(waiting.counts.unknown, 1);

  const late = judgeCheckRuns(runs, { completionExpired: true });
  assert.equal(late.verdict, "red");
  assert.match(late.reason, /install-smoke .*=stale/);
});

test("the newest run per name wins, so a re-run replaces its first attempt", () => {
  const rerun = [
    ...healthy(),
    run("ship-gate (windows-latest)", "failure", "completed", "2026-11-21T00:00:00Z"),
    run("ship-gate (windows-latest)", "success", "completed", "2026-11-22T06:00:00Z"),
  ];
  assert.equal(judgeCheckRuns(rerun).verdict, "green");

  // A re-run that came back skipped is not covered by the older pass.
  const skippedRerun = healthy().map((r) =>
    r.name === "ship-gate (windows-latest)" ? run(r.name, "skipped", "completed", "2026-11-22T06:00:00Z") : r,
  );
  assert.equal(judgeCheckRuns(skippedRerun).verdict, "red");
});

test("checks outside the five families never move the verdict", () => {
  // spaced-path is advisory (AGENTS.md) and the macos spillover probe reports
  // crash signatures: neither gates a release.
  const runs = [
    ...healthy(),
    run("spaced-path", "failure"),
    run("macos-spillover-probe (EXPERIMENT, non-blocking — R62 D-007)", "failure"),
  ];
  const verdict = judgeCheckRuns(runs);
  assert.equal(verdict.verdict, "green");
  assert.equal(verdict.counts.matched, healthy().length);
});

test("no check-runs at all: waits in discovery, red once the window closes", () => {
  assert.equal(judgeCheckRuns([]).verdict, "wait");
  const closed = judgeCheckRuns([], { discoveryExpired: true });
  assert.equal(closed.verdict, "red");
  assert.equal(closed.exitCode, 2);
});
