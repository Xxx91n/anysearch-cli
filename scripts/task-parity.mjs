#!/usr/bin/env node
// scripts/task-parity.mjs
// ADR-0028 D5 — Task Parity Gate. Zero-dep Node stdlib only.
// turbo silently skips tasks a package doesn't implement (PR #1226: "will not
// be changing the default behavior"), so the contract lives in the pipeline:
// every workspace package must implement every "universal" task; exemption set
// is explicitly empty. Mirrors Rush's default-strict + ignoreMissingScript.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Universal = every package must implement. Deliberately only check/test;
// build (plugin double-build), dev (cli), lint differ in shape on purpose.
const UNIVERSAL = ["check", "test"];
// Exemption set is intentionally empty — adding an entry here IS the escape
// valve (Rush ignoreMissingScript equivalent), never leave entries ungated.
const EXEMPTIONS = []; // e.g. ["packages/foo:check"]

const pkgDirs = [];
for (const top of ["packages", "apps"]) {
  const topDir = path.join(ROOT, top);
  if (!fs.existsSync(topDir)) continue;
  for (const name of fs.readdirSync(topDir)) {
    if (fs.existsSync(path.join(topDir, name, "package.json"))) pkgDirs.push(path.join(top, name));
  }
}

const missing = [];
for (const rel of pkgDirs) {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, rel, "package.json"), "utf8"));
  const scripts = pkg.scripts ?? {};
  for (const task of UNIVERSAL) {
    if (EXEMPTIONS.includes(rel + ":" + task)) continue;
    if (!scripts[task]) missing.push(rel + " missing scripts." + task);
  }
}

if (missing.length) {
  console.error("[task-parity] FAIL:");
  for (const m of missing) console.error("  - " + m);
  process.exit(1);
}
console.log("[task-parity] ok: " + pkgDirs.length + " packages implement " + UNIVERSAL.join("/") + " (exemptions: none)");
