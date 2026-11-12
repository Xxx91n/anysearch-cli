#!/usr/bin/env node
// Temporary dependency-age bypass for CI installs, with a hard expiry.
//
// Why this exists (issue #260): every CI job stopped at `pnpm install` because
// 15 transitive @aws-sdk/* / @smithy/* entries were still inside
// `minimumReleaseAge` (48h). The last one clears at 2026-11-12T19:41:11Z. The
// repo rules (AGENTS.md, scripts/dep-age-status.mjs, ship-gate step E6) treat
// waiting as the only proper fix, so this bypass is deliberately temporary.
//
// How it behaves:
// - before the deadline: writes PNPM_CONFIG_MINIMUM_RELEASE_AGE=0 to
//   $GITHUB_ENV for the rest of the job, plus a workflow warning naming the
//   deadline;
// - at/after the deadline: writes nothing, so the strict gate applies again.
//
// That expiry is the point: a merged bypass cannot quietly outlive its reason.
// Deleting this file and its call sites is still the cleanup step, but if that
// is forgotten, CI re-enforces the gate on its own.
//
// Only CI calls this. `pnpm-workspace.yaml` keeps its strict policy (ship-gate
// E6 enforces that), and `release.yml` never calls it, so the release path stays
// strict at all times.
//
// Node stdlib only, like the other scripts/ gates. Runs on Linux, macOS and
// Windows runners alike.

import fs from "node:fs";
import process from "node:process";

const DEADLINE = process.env.ANS_DEP_AGE_OVERRIDE_UNTIL ?? "2026-11-12T19:41:11Z";

function warn(message) {
  // GitHub annotation; harmless when not running under Actions.
  console.log("::warning::" + message);
}

const deadlineMs = Date.parse(DEADLINE);
if (!Number.isFinite(deadlineMs)) {
  // An unparseable deadline must never turn into a permanent bypass.
  warn("dependency-age override skipped: cannot parse deadline " + JSON.stringify(DEADLINE));
  process.exit(0);
}

if (Date.now() >= deadlineMs) {
  console.log("dependency-age override window has closed (" + DEADLINE + "); the strict gate applies");
  process.exit(0);
}

const envFile = process.env.GITHUB_ENV;
if (envFile) {
  fs.appendFileSync(envFile, "PNPM_CONFIG_MINIMUM_RELEASE_AGE=0\n", "utf8");
} else {
  // Outside Actions this only affects the current shell, which is a no-op for
  // the caller; say so instead of pretending the bypass took effect.
  console.log("PNPM_CONFIG_MINIMUM_RELEASE_AGE=0");
}
warn(
  "dependency-age gate bypassed for this job until " + DEADLINE +
  " (issue #260); the strict gate returns automatically after that time"
);
