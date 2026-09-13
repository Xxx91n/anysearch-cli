#!/usr/bin/env node
// scripts/release-gate.mjs
// ADR-0059 D2 (T-1 / F-15): the release-grade eval gate.
//
// Regular CI runs the merge gate (scripts/ship-gate.mjs) in observational mode and never spends a
// preregistered OF look. This script is the ONLY place a look is spent, and it is invoked by
// .github/workflows/release.yml:
//
//   --pre-tag   run the decision-grade eval (spends exactly one OF look and appends one row to the
//               git-committed eval-looks.json ledger) and fail unless the verdict is green.
//   --post-tag  assert the most recent pre-tag verdict for the current fingerprint pair is
//               unexpired; never runs the eval, never spends a look (no OF double-spend).
//
// Node stdlib only (ADR-0020 D5).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LEDGER = path.join(ROOT, "eval-looks.json");
const BASELINE = path.join(ROOT, "packages", "store", "eval-baseline.json");
// A pre-tag verdict is a snapshot of the frozen golden set; it stays valid for this many days.
const VERDICT_TTL_DAYS = 30;

function fail(msg) { process.stderr.write("release-gate: FAIL: " + msg + "\n"); process.exit(1); }
function ok(msg) { process.stdout.write("release-gate: " + msg + "\n"); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }

function fingerprintPair() {
  const b = readJson(BASELINE);
  return b.fingerprint + ":" + b.holdoutFingerprint;
}

function latestRow(key) {
  if (!fs.existsSync(LEDGER)) return undefined;
  const j = readJson(LEDGER);
  const rows = Array.isArray(j.looks) ? j.looks : [];
  for (let i = rows.length - 1; i >= 0; i--) if (rows[i].key === key) return rows[i];
  return undefined;
}

function preTag() {
  ok("pre-tag decision-grade peek (the only place an OF look is spent)");
  // round-59 audit D-2 (resolved as an explicit, rationale-backed waiver - NOT a code change):
  // this release peek INTENTIONALLY runs the FULL golden set (no --offline). The offline boundary
  // (ADR-0060 D7 / ADR-0057 r59 errata) governs the merge/default suites; narrowing the release
  // decision to the offline slice would be exactly the coverage downgrade the errata's
  // anti-downgrade clause forbids. release.yml runs on a network-enabled runner, so the vector arm
  // resolves here; its offline-scoped coverage is exercised by the ci.yml `test-online` job.
  const res = spawnSync(
    process.execPath,
    ["--import", "tsx", path.join("src", "eval", "cli.ts"), "--out", path.join(ROOT, ".ship-gate"), "--decision"],
    {
      cwd: path.join(ROOT, "packages", "store"),
      stdio: ["ignore", "inherit", "inherit"],
      // ADR-0059 D2: this is the release peek, so it is the ONE run allowed to append a look row.
      env: { ...process.env, ANS_EVAL_NO_LOOK: "0", ANS_EVAL_LOOKS_WRITE: "1" },
    }
  );
  const code = res.status ?? -1;
  const key = fingerprintPair();
  const row = latestRow(key);
  if (code !== 0) fail("decision-grade eval exited " + code + " — publish-red, tagging is not allowed" + (row ? " (ledger row verdict=" + row.verdict + " exit=" + row.exitCode + ")" : ""));
  if (!row) fail("decision-grade eval exited 0 but no ledger row was appended for " + key);
  // ADR-0038 D2: exit 0 covers pass AND warn (unproven-positive is never red and ships with a
  // recorded observation); only publish-red (exit 1) / unverifiable (2) / mismatch (12) block a tag.
  if (row.exitCode !== 0) fail("pre-tag verdict is publish-red: verdict=" + row.verdict + " exit=" + row.exitCode);
  if (row.integrity !== "pass") fail("pre-tag integrity verdict is not pass: " + row.integrity);
  ok("pre-tag verdict " + String(row.verdict).toUpperCase() + " (exit 0, integrity pass, look " + row.look + " at " + row.at + "); commit eval-looks.json, then push the tag");
}

function postTag() {
  const key = fingerprintPair();
  const row = latestRow(key);
  if (!row) fail("no pre-tag verdict for " + key + " — run the release workflow with runPurpose=pre-tag first (ADR-0059 D2)");
  if (row.exitCode !== 0 || row.integrity !== "pass") fail("pre-tag verdict is not shippable: " + JSON.stringify(row));
  const ageDays = (Date.now() - Date.parse(row.at)) / 86400000;
  if (!Number.isFinite(ageDays) || ageDays > VERDICT_TTL_DAYS) fail("pre-tag verdict expired: " + row.at + " (" + ageDays.toFixed(1) + "d > TTL " + VERDICT_TTL_DAYS + "d) — re-run pre-tag");
  ok("post-tag verdict unexpired: look " + row.look + " at " + row.at + " (" + ageDays.toFixed(1) + "d <= TTL " + VERDICT_TTL_DAYS + "d), no look spent");
}

const args = process.argv.slice(2);
if (args.includes("--pre-tag")) preTag();
else if (args.includes("--post-tag")) postTag();
else { process.stderr.write("release-gate: usage: node scripts/release-gate.mjs --pre-tag | --post-tag\n"); process.exit(2); }
