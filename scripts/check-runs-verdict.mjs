// The release gate's one verdict: hand it the check-runs on a fixed sha, get
// green / red / keep waiting back.
//
// Design: only a check that actually ran is evidence that its lane passed
// (#406). A skipped check-run used to sit in the same allowed set as a passing
// one, so a lane that never ran still produced GREEN. The accident that bought,
// spelled out in the parent spec (#389 D4): the job that works out which lanes
// run fails, its name misses the family regex below, the lanes it gates
// register as skipped, and the release goes out with no evidence behind it.
// Skipped is counted on its own now and fails the discovery phase.
//
// Design: one function, three answers; scripts/assert-checks-green.mjs only
// fetches the runs and prints what comes back. The contract used to live inline
// in that script's polling loop, and its only test read the script's source with
// a regex. A list in, an answer out, is tested by feeding a list.
//
// Phases: discovery asks whether every required family and every blocking leg
// has a check-run that ran. A lane that registered as skipped is a discovery
// failure no wait can fix, so it is answered at once. A lane that has not
// registered yet may still show up, so the caller keeps waiting until its
// discovery window closes. Completion asks whether the lanes that ran are
// terminal and passing, bounded by the caller's absolute deadline.
//
// Native-smoke and the non-blocking macos-spillover probe stay outside the gate
// by name: neither matches a family below, and a red probe is a crash-signature
// report on the CLI path, not a gate. macOS is a blocking leg again since #183
// (promotion evidence in docs/limitations.md), so REQUIRED_LEGS names all three
// ship-gate legs. Keep that list in step with ship-gate.yml's matrix by hand:
// the test that compared the two files with regexes is gone (#406).

const FAMILY = /^(check-build|install-smoke|test:online|ship-gate|memory-eval)\b/;

export const FAMILIES = ["check-build", "install-smoke", "test:online", "ship-gate", "memory-eval"];
export const REQUIRED_LEGS = ["ship-gate (ubuntu-latest)", "ship-gate (macos-latest)", "ship-gate (windows-latest)"];

const FAILED_CONCLUSIONS = new Set(["failure", "cancelled", "timed_out", "startup_failure", "action_required"]);
// neutral is allowed next to success because release.yml's wait step (layer 1)
// allows it too: the two layers must not disagree about a conclusion that did
// run. The one conclusion that moved is skipped (#406).
const PASSING_CONCLUSIONS = new Set(["success", "neutral"]);

function familyOf(name) {
  return String(name ?? "").match(FAMILY)?.[1] ?? null;
}

// Same-name check-runs are one lane: the newest started_at wins, so a re-run
// replaces its first attempt instead of being counted twice.
function newestPerName(runs) {
  const newest = new Map();
  for (const run of runs ?? []) {
    if (familyOf(run?.name) === null) continue;
    const seen = newest.get(run.name);
    if (!seen || String(run.started_at ?? "") > String(seen.started_at ?? "")) newest.set(run.name, run);
  }
  return newest;
}

// "ran" is the only state that counts as evidence. "skipped" is a lane that
// never started. "unknown" is a completed check carrying a conclusion this gate
// does not model (e.g. "stale"): not a pass, not a failure, so it can only
// settle at the deadline.
function laneState(run) {
  if (!run) return "missing";
  if (run.status !== "completed") return "running";
  const conclusion = run.conclusion ?? "";
  if (PASSING_CONCLUSIONS.has(conclusion)) return "ran";
  if (FAILED_CONCLUSIONS.has(conclusion)) return "failed";
  if (conclusion === "skipped") return "skipped";
  return "unknown";
}

/**
 * Decide what the release gate should do with the check-runs it just fetched.
 *
 * @param {Array<{ name: string, status: string, conclusion?: string | null, started_at?: string }>} runs
 * @param {{ discoveryExpired?: boolean, completionExpired?: boolean }} [deadlines]
 *   discoveryExpired: the discovery window has closed, so a lane that never
 *   registered is red rather than worth another wait. completionExpired: the
 *   caller's absolute deadline has passed.
 * @returns {{
 *   verdict: "green" | "red" | "wait",
 *   exitCode: 0 | 1 | 2 | null,
 *   phase: "discovery" | "completion",
 *   reason: string,
 *   counts: { matched: number, ran: number, running: number, failed: number, skipped: number, unknown: number },
 *   lanes: Array<{ name: string, state: string, status: string, conclusion: string | null }>,
 *   missingFamilies: string[], missingLegs: string[],
 * }}
 *   exitCode is what the gate exits with once the verdict is final: 0 green,
 *   1 a check reported a failing conclusion, 2 no usable signal (skipped,
 *   missing, unmodelled, or a deadline). "wait" carries null — no decision yet.
 */
export function judgeCheckRuns(runs, { discoveryExpired = false, completionExpired = false } = {}) {
  const newest = newestPerName(runs);
  const lanes = [...newest.keys()].sort().map((name) => {
    const run = newest.get(name);
    return { name, state: laneState(run), status: run.status, conclusion: run.conclusion ?? null };
  });
  const ofState = (state) => lanes.filter((lane) => lane.state === state);

  // A family has run as soon as one of its check-runs ran: a failure is
  // reported per check, not per family. A family with no check-run at all is
  // "missing" — the discovery gap.
  const familyState = (family) => {
    const members = lanes.filter((lane) => familyOf(lane.name) === family);
    if (members.length === 0) return "missing";
    const states = new Set(members.map((lane) => lane.state));
    return ["ran", "failed", "running", "unknown", "skipped"].find((state) => states.has(state));
  };

  const failed = ofState("failed");
  const running = ofState("running");
  const unknown = ofState("unknown");
  const skipped = ofState("skipped");
  const ran = ofState("ran");
  const missingFamilies = FAMILIES.filter((family) => familyState(family) === "missing");
  const missingLegs = REQUIRED_LEGS.filter((leg) => laneState(newest.get(leg)) === "missing");

  const counts = {
    matched: lanes.length,
    ran: ran.length,
    running: running.length,
    failed: failed.length,
    skipped: skipped.length,
    unknown: unknown.length,
  };
  const phase = missingFamilies.length || missingLegs.length || skipped.length ? "discovery" : "completion";
  const answer = (verdict, exitCode, reason) => ({
    verdict,
    exitCode,
    phase,
    reason,
    counts,
    lanes,
    missingFamilies,
    missingLegs,
  });

  // A check that reported a failing conclusion is the clearest answer there is,
  // and it holds in either phase.
  if (failed.length > 0) {
    return answer("red", 1, "failed: " + failed.map((lane) => lane.name + "=" + lane.conclusion).join("; "));
  }

  // Design: a skipped check-run is terminal, so there is nothing to wait for.
  // It fails the discovery phase — the phase that asks "did every required lane
  // run at all?" — instead of converging on a deadline.
  if (skipped.length > 0) {
    return answer(
      "red",
      2,
      "never ran (skipped): " + skipped.map((lane) => lane.name).join(", ") + " — a skipped check is not evidence a lane passed",
    );
  }

  const missing = [...missingFamilies.map((family) => family + " family"), ...missingLegs];
  const waiting = [
    ...running.map((lane) => lane.name + " (running)"),
    ...unknown.map((lane) => lane.name + "=" + lane.conclusion),
  ];

  if (missing.length > 0) {
    if (discoveryExpired || completionExpired) {
      return answer("red", 2, "discovery window closed with no check-run for: " + missing.join(", "));
    }
    return answer("wait", null, "not registered yet: " + missing.join(", "));
  }
  if (waiting.length > 0) {
    if (completionExpired) return answer("red", 2, "deadline passed with: " + waiting.join("; "));
    return answer("wait", null, "still to finish: " + waiting.join("; "));
  }
  return answer("green", 0, "all " + lanes.length + " checks ran and passed");
}
