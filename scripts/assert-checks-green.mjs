#!/usr/bin/env node
// ADR-0069 (R68 T1): post-tag/publish pre-assertion — the tagged (or any fixed)
// SHA must carry green ci + ship-gate check-runs before publish proceeds.
//
// Semantics (mirrors the lewagon/wait-on-check-action contract used for the
// pre-tag self-wait, hand-rolled here so the same file doubles as the dry-run
// harness):
//   - check-runs fetched on the FIXED sha — never heads/main (racing window)
//   - same-name checks dedupe to the latest started_at run
//   - all five check families must be represented (check-build, install-smoke,
//     test:online, ship-gate, memory-eval); macos-spillover-probe (EXPERIMENT,
//     non-blocking) and native-smoke are deliberately outside the gate
//   - terminal non-allowed conclusions (failure/cancelled/timed_out/...) ->
//     fail-fast exit 1; in-progress -> short poll bounded by --timeout-min;
//     no matching checks after the discovery window -> fail-closed exit 2.
//   - GREEN requires EVERY matched check completed with an allowed conclusion
//     (okCount === latest.size): a completed check carrying an unmodelled
//     conclusion (e.g. "stale") is neither bad nor pending, and must NOT be
//     counted as green — it converges to the fail-closed timeout leg instead
//     (R68 audit F-S1).
//   - The discovery window only applies while ZERO checks match; a partial
//     match (some families present, others still absent) is bounded by
//     --timeout-min alone (R68 audit F-S4, documented behaviour).
//
// Usage: node scripts/assert-checks-green.mjs --sha <sha> [--once]
//        [--timeout-min 10] [--discovery-sec 120] [--interval-sec 20]
// Exit: 0 green | 1 red | 2 no-signal/timeout (fail-closed either way) |
//       10 --once snapshot without a converged verdict (dry-run probe only).
import { execFileSync } from "node:child_process";

const FAMILY = /^(check-build|install-smoke|test:online|ship-gate|memory-eval)\b/;
const FAMILIES = ["check-build", "install-smoke", "test:online", "ship-gate", "memory-eval"];
const TERMINAL_BAD = new Set(["failure", "cancelled", "timed_out", "startup_failure", "action_required"]);
const TERMINAL_OK = new Set(["success", "skipped", "neutral"]);

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

function latestPerName(runs) {
  const m = new Map();
  for (const r of runs) {
    if (!FAMILY.test(r.name)) continue;
    const prev = m.get(r.name);
    if (!prev || String(r.started_at) > String(prev.started_at)) m.set(r.name, r);
  }
  return m;
}

const deadline = Date.now() + timeoutMin * 60_000;
const discoveryDeadline = Date.now() + discoverySec * 1000;
let poll = 0;

for (; ;) {
  poll++;
  const latest = latestPerName(checkRuns());
  const names = [...latest.keys()].sort();
  const presentFamilies = new Set(names.map((n) => FAMILIES.find((f) => n.startsWith(f))));
  const missingFamilies = FAMILIES.filter((f) => !presentFamilies.has(f));
  const bad = [...latest.values()].filter((r) => r.status === "completed" && TERMINAL_BAD.has(r.conclusion ?? ""));
  const pending = [...latest.values()].filter((r) => r.status !== "completed");
  const okCount = [...latest.values()].filter((r) => r.status === "completed" && TERMINAL_OK.has(r.conclusion ?? "")).length;

  console.log(
    "[assert-checks poll " + poll + "] " + sha.slice(0, 8) + " matched=" + names.length +
    " ok=" + okCount + " pending=" + pending.length + " bad=" + bad.length +
    (missingFamilies.length ? " missing-families=" + missingFamilies.join(",") : ""),
  );

  if (bad.length) {
    console.error("[assert-checks] RED: " + bad.map((r) => r.name + "=" + r.conclusion).join("; "));
    process.exit(1);
  }
  // F-S1: GREEN iff every matched check is completed AND carries an allowed
  // conclusion. A completed check outside TERMINAL_OK/TERMINAL_BAD (e.g.
  // "stale") leaves okCount < latest.size and falls through to fail-closed.
  if (missingFamilies.length === 0 && pending.length === 0 && names.length > 0 && okCount === latest.size) {
    console.log("[assert-checks] GREEN: all " + names.length + " ci/ship-gate checks terminal+allowed on " + sha);
    process.exit(0);
  }
  if (once) {
    // dry-run probe mode: report the snapshot without taking a verdict
    console.log("[assert-checks] --once snapshot: " + names.map((n) => n + ":" + (latest.get(n).status) + "/" + (latest.get(n).conclusion ?? "-")).join(" | "));
    process.exit(10);
  }
  if (names.length === 0) {
    if (Date.now() < discoveryDeadline) {
      console.log("[assert-checks] discovery window — no ci/ship-gate checks yet on " + sha.slice(0, 8));
    } else {
      console.error("[assert-checks] FAIL-CLOSED: no ci/ship-gate check-runs on " + sha + " after " + discoverySec + "s discovery");
      process.exit(2);
    }
  } else if (Date.now() >= deadline) {
    console.error("[assert-checks] FAIL-CLOSED: timeout " + timeoutMin + "min — pending=" + pending.map((r) => r.name).join(";") + " missing=" + missingFamilies.join(","));
    process.exit(2);
  }
  await new Promise((r) => setTimeout(r, intervalSec * 1000));
}
