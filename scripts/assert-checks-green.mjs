#!/usr/bin/env node
// post-tag/publish pre-assertion — the tagged (or any fixed) SHA must carry
// green ci + ship-gate check-runs before publish proceeds.
//
// What counts as green lives in scripts/check-runs-verdict.mjs: this file
// fetches the check-runs, prints one line per poll, and exits with the verdict.
//
// - check-runs fetched on the FIXED sha — never heads/main (racing window)
// - strict two-phase deadlines ( / F-S4):
// Phase 1 discovery — every one of the five check families (check-build,
// install-smoke, test:online, ship-gate, memory-eval) must register >=1
// check-run that RAN within --discovery-sec (default 120). Strictness rests on
// the repo's stub-registration invariant: every required family is guaranteed a
// check-run by workflow design (conditional-step stubs — never native `paths:`
// filtering, which creates no check-run at all, and never a job-level `if:`,
// whose check-run registers as skipped). On expiry with families or legs still
// missing -> fail-closed exit 2, error line tagged phase=discovery naming what
// never registered.
// Phase 2 completion — once all five families and all three blocking legs are
// present and ran, poll the rest to terminal. --timeout-min remains an ABSOLUTE
// deadline anchored at process start (never re-anchored at the phase
// transition); on expiry -> fail-closed exit 2, error line tagged
// phase=completion naming what is still running.
// - a check-run that registered as skipped is red at once (phase=discovery):
// it is terminal, so no wait will turn it into evidence (#406).
// - GREEN requires every matched check completed with success or neutral; a
// completed check carrying an unmodelled conclusion (e.g. "stale") is neither
// bad nor passing, and must NOT be counted as green — it converges to the
// fail-closed completion-timeout leg instead.
// - every blocking ship-gate matrix LEG is required BY NAME in addition to the
// family presence check (PR #174 audit S2): family-level discovery passes once
// ANY ship-gate* check-run registers, so a queued/never-registered leg could be
// absent while the registered legs alone produce GREEN. REQUIRED_LEGS mirrors
// ship-gate.yml's blocking matrix — keep the two in step by hand.
//
// Design: exit 1 means "a check reported a failing conclusion" and exit 2 means
// "no usable signal" — both block the release, and the split tells an operator
// whether to look at a red test or at the registration plumbing.
//
// Usage: node scripts/assert-checks-green.mjs --sha <sha> [--once]
// [--timeout-min 10] [--discovery-sec 120] [--interval-sec 20]
// Exit: 0 green | 1 red | 2 no-signal/timeout (fail-closed either way) |
// 10 --once, still waiting: the snapshot of a dry-run probe.
import { execFileSync } from "node:child_process";
import { gateAction, judgeCheckRuns } from "./check-runs-verdict.mjs";

function arg(name, dflt) {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 ? process.argv[i + 1] : dflt;
}
const sha = arg("sha", process.env.GITHUB_SHA || "");
const once = process.argv.includes("--once");
const timeoutMin = Number(arg("timeout-min", "10"));
const discoverySec = Number(arg("discovery-sec", "120"));
const intervalSec = Number(arg("interval-sec", "20"));
const repo = arg("repo", process.env.GITHUB_REPOSITORY || "");

if (!sha || !repo) {
  console.error("assert-checks-green: --sha and --repo (or GITHUB_SHA/GITHUB_REPOSITORY) are required");
  process.exit(2);
}

function checkRuns() {
  const out = execFileSync("gh", [
    "api", "repos/" + repo + "/commits/" + sha + "/check-runs?per_page=100",
    "--paginate",
    "--jq", ".check_runs[] | {name, status, conclusion, started_at}",
  ], { encoding: "utf8" });
  return out.trim() ? out.trim().split("\n").map((l) => JSON.parse(l)) : [];
}

// --timeout-min is anchored ONCE at process start and covers the whole run
// (discovery + completion); it is never re-anchored at the phase transition.
const deadline = Date.now() + timeoutMin * 60_000;
const discoveryDeadline = Date.now() + discoverySec * 1000;
let poll = 0;

for (; ;) {
  poll++;
  // --once is a probe: no deadline can turn a snapshot into a red, so it keeps
  // reporting (exit 10) while the gate would still be waiting. A converged red
  // still prints its reason and exits with it, below.
  const verdict = judgeCheckRuns(checkRuns(), {
    discoveryExpired: !once && Date.now() >= discoveryDeadline,
    completionExpired: !once && Date.now() >= deadline,
  });
  const counts = verdict.counts;

  console.log(
    "[assert-checks poll " + poll + "] " + sha.slice(0, 8) + " phase=" + verdict.phase +
    " matched=" + counts.matched + " ran=" + counts.ran + " running=" + counts.running +
    " failed=" + counts.failed + " skipped=" + counts.skipped +
    (verdict.missingFamilies.length ? " missing-families=" + verdict.missingFamilies.join(",") : "") +
    (verdict.missingLegs.length ? " missing-legs=" + verdict.missingLegs.join(",") : ""),
  );

  const action = gateAction(verdict, { once });
  if (action.kind === "green") {
    console.log("[assert-checks] GREEN: " + verdict.reason);
  } else if (action.kind === "failed") {
    console.error("[assert-checks] RED: " + verdict.reason);
  } else if (action.kind === "no-signal") {
    console.error("[assert-checks] FAIL-CLOSED (phase=" + verdict.phase + "): " + verdict.reason);
  } else if (action.kind === "probe") {
    console.log("[assert-checks] --once snapshot: " + verdict.checks.map((check) => check.name + ":" + check.status + "/" + (check.conclusion ?? "-")).join(" | "));
  }
  if (action.action === "exit") process.exit(action.exitCode);

  await new Promise((r) => setTimeout(r, intervalSec * 1000));
}
