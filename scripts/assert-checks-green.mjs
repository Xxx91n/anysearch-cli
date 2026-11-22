#!/usr/bin/env node
// post-tag/publish pre-assertion — the tagged (or any fixed) SHA must carry
// green ci + ship-gate check-runs before publish proceeds.
//
// What counts as green lives in scripts/check-runs-verdict.mjs; this file
// fetches the check-runs on the fixed sha, prints one line per poll, and exits
// with the answer.
//
//   node scripts/assert-checks-green.mjs --sha <sha> [--once]
//   [--timeout-min 10] [--discovery-sec 120] [--interval-sec 20]
//
// Exit: 0 green | 1 red | 2 no-signal/timeout (fail-closed either way) |
// 10 --once, still waiting: the snapshot of a dry-run probe.
//
// Two deadlines, both anchored at process start and never re-anchored:
// --discovery-sec bounds the wait for a check to register at all, --timeout-min
// is the absolute bound on the whole run. Discovery rests on the repo's
// stub-registration invariant: every required family gets a check-run by
// workflow design (conditional-step stubs, never native `paths:` filtering and
// never a job-level `if:`), so a family with no check-run is a real problem and
// not a filter doing its job.
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

const deadline = Date.now() + timeoutMin * 60_000;
const discoveryDeadline = Date.now() + discoverySec * 1000;
let poll = 0;
let lastWait = "";

for (; ;) {
  poll++;
  // --once is a probe: no deadline can turn a snapshot into a red, so it keeps
  // reporting (exit 10) while the gate would still be waiting. A converged red
  // still prints its reason and exits with it.
  const verdict = judgeCheckRuns(checkRuns(), {
    discoveryExpired: !once && Date.now() >= discoveryDeadline,
    completionExpired: !once && Date.now() >= deadline,
  });
  const counts = verdict.counts;

  console.log(
    "[assert-checks poll " + poll + "] " + sha.slice(0, 8) + " phase=" + verdict.phase +
    " matched=" + counts.matched + " ran=" + counts.ran + " running=" + counts.running +
    " failed=" + counts.failed + " skipped=" + counts.skipped + " unknown=" + counts.unknown +
    (verdict.missingFamilies.length ? " missing-families=" + verdict.missingFamilies.join(",") : "") +
    (verdict.missingLegs.length ? " missing-legs=" + verdict.missingLegs.join(",") : ""),
  );
  // A long wait should say what it is waiting for, without repeating itself
  // every poll.
  if (verdict.verdict === "wait" && verdict.reason !== lastWait) {
    lastWait = verdict.reason;
    console.log("[assert-checks] waiting: " + verdict.reason);
  }

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
