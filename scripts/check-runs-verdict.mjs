// The release gate's one verdict: hand it the check-runs on a fixed sha, get
// green / red / keep waiting back.
//
// Design: only a check that actually ran counts as evidence — a skipped
// check-run used to count as passing, so a lane that never started could still
// produce GREEN. The accident that closed: the job that decides which checks run
// fails, its name misses the family regex, the lanes it gates register as
// skipped, and the release ships on no evidence.
//
// Phases: discovery asks whether every required family and blocking leg has a
// check-run registered at all; completion asks whether the registered checks
// finish, bounded by the caller's absolute deadline.
//
// Family membership is by name, so the non-blocking anysearch probe counts as
// test:online too: a skipped conclusion there refuses the gate, and a failed one
// lands in the failed branch — whether GitHub reports a tolerated failure as
// "failure" is not verified here. A successful check-run means "this job handled
// the change" (a job that decides there is nothing to run still reports
// success), so the gate cannot tell a real pass from a by-design skip.
//
// Native-smoke and the macos spillover probe match no family, so they stay
// outside the gate. REQUIRED_LEGS mirrors ship-gate.yml's matrix by hand, and
// macOS is a blocking leg again (docs/limitations.md).

export const FAMILIES = ["check-build", "install-smoke", "test:online", "ship-gate", "memory-eval"];
export const REQUIRED_LEGS = ["ship-gate (ubuntu-latest)", "ship-gate (macos-latest)", "ship-gate (windows-latest)"];

const FAMILY = new RegExp("^(" + FAMILIES.join("|") + ")\\b");
const FAILED_CONCLUSIONS = new Set(["failure", "cancelled", "timed_out", "startup_failure", "action_required"]);
// neutral is allowed next to success because release.yml's wait step (layer 1)
// allows it too: the two layers must not disagree about a conclusion that did
// run. The one conclusion that moved is skipped.
const PASSING_CONCLUSIONS = new Set(["success", "neutral"]);

function familyOf(name) {
  return String(name ?? "").match(FAMILY)?.[1] ?? null;
}

// Same-name check-runs are one check: the newest started_at wins, so a re-run
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

// "ran" is the only state that counts as evidence. "skipped" is a check that
// never started. "unknown" is a completed check carrying a conclusion this gate
// does not model (e.g. "stale"): not a pass, not a failure, so it can only
// settle at the deadline.
function checkState(run) {
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
 *   discoveryExpired: the discovery window has closed, so a check that never
 *   registered is red rather than worth another wait. completionExpired: the
 *   caller's absolute deadline has passed.
 * @returns {{
 *   verdict: "green" | "red" | "wait",
 *   exitCode: 0 | 1 | 2 | null,
 *   phase: "discovery" | "completion",
 *   reason: string,
 *   counts: { matched: number, ran: number, running: number, failed: number, skipped: number, unknown: number },
 *   checks: Array<{ name: string, state: string, status: string, conclusion: string | null }>,
 *   missingFamilies: string[], missingLegs: string[],
 * }}
 *   exitCode is what the gate exits with once the verdict is final: 0 green,
 *   1 a check reported a failing conclusion, 2 no usable signal (skipped,
 *   missing, unmodelled, or a deadline). "wait" carries null — no decision yet.
 */
export function judgeCheckRuns(runs, { discoveryExpired = false, completionExpired = false } = {}) {
  const newest = newestPerName(runs);
  const checks = [...newest.keys()].sort().map((name) => {
    const run = newest.get(name);
    return { name, state: checkState(run), status: run.status, conclusion: run.conclusion ?? null };
  });
  const ofState = (state) => checks.filter((check) => check.state === state);

  // A family is present as soon as one of its checks registered: a failure is
  // reported per check, not per family.
  const familyPresent = (family) => checks.some((check) => familyOf(check.name) === family);
  const failed = ofState("failed");
  const running = ofState("running");
  const unknown = ofState("unknown");
  const skipped = ofState("skipped");
  const ran = ofState("ran");
  const missingFamilies = FAMILIES.filter((family) => !familyPresent(family));
  const missingLegs = REQUIRED_LEGS.filter((leg) => checkState(newest.get(leg)) === "missing");

  const counts = {
    matched: checks.length,
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
    checks,
    missingFamilies,
    missingLegs,
  });

  // A check that reported a failing conclusion is the clearest answer there is,
  // and it holds in either phase.
  if (failed.length > 0) {
    return answer("red", 1, "failed: " + failed.map((check) => check.name + "=" + check.conclusion).join("; "));
  }

  // Design: a skipped check-run is answered at once, not at a deadline — it is
  // terminal, so no wait changes it, and the discovery phase is the one that asks
  // whether every required check ran.
  if (skipped.length > 0) {
    return answer(
      "red",
      2,
      "never ran (skipped): " + skipped.map((check) => check.name).join(", ") + " — a skipped check is not evidence that anything passed",
    );
  }

  const missing = [...missingFamilies.map((family) => family + " family"), ...missingLegs];
  const waiting = [
    ...running.map((check) => check.name + " (running)"),
    ...unknown.map((check) => check.name + "=" + check.conclusion),
  ];

  if (missing.length > 0) {
    let closed = null;
    if (discoveryExpired) closed = "discovery window closed";
    else if (completionExpired) closed = "absolute deadline reached";
    if (closed !== null) {
      const present = FAMILIES.filter(familyPresent).join(",") || "none";
      return answer("red", 2, closed + " with no check-run for: " + missing.join(", ") + " (present families: " + present + ")");
    }
    return answer("wait", null, "not registered yet: " + missing.join(", "));
  }
  if (waiting.length > 0) {
    if (completionExpired) return answer("red", 2, "absolute deadline reached, still not done: " + waiting.join("; "));
    return answer("wait", null, "still to finish: " + waiting.join("; "));
  }
  return answer("green", 0, "all " + checks.length + " checks ran and passed");
}

// Design: a decided verdict exits with its own code even in probe mode — a probe
// that hid a red would print a snapshot that looks like a healthy gate; the 10 is
// only for "no verdict yet", which is what a probe is for.
/**
 * What the gate does with a verdict right now.
 *
 * @param {{ verdict: "green" | "red" | "wait", exitCode: 0 | 1 | 2 | null }} verdict
 * @param {{ once?: boolean }} [mode] once: report a snapshot instead of waiting.
 * @returns {{ action: "exit" | "poll", kind?: "green" | "failed" | "no-signal" | "probe", exitCode?: 0 | 1 | 2 | 10 }}
 */
export function gateAction(verdict, { once = false } = {}) {
  if (verdict.verdict === "green") return { action: "exit", kind: "green", exitCode: 0 };
  if (verdict.verdict === "red") {
    // A red without a code still fails closed: process.exit(null) counts as 0,
    // which would turn the one answer that must never pass into a green gate.
    const exitCode = verdict.exitCode ?? 2;
    return { action: "exit", kind: exitCode === 1 ? "failed" : "no-signal", exitCode };
  }
  if (once) return { action: "exit", kind: "probe", exitCode: 10 };
  return { action: "poll" };
}
