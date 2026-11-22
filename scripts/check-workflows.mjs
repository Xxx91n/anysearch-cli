#!/usr/bin/env node
// - workflow YAML gate, promoted from .scratch/check-workflows.mjs (backlog B-2).
//
// Round-57: a workflow file that does not parse makes GitHub Actions report a run with zero
// jobs ("likely failed because of a workflow file issue"), invisible in a normal green/red read.
// The old checker lived in .scratch/ (never shipped) and FAILED OPEN when no YAML parser was
// present. This version is fail-closed by construction:
// - auto-discovers .github/workflows/*.yml|*.yaml and .github/actions/**/action.yml|*.yaml;
// - ALWAYS runs dependency-free structural checks (tabs, top-level key syntax, duplicates,
// required keys, quote/bracket balance outside block scalars) plus local action path checks;
// - ADDITIONALLY runs a full YAML parse when a parser is resolvable, so the strict check is
// available without adding a runtime dependency to the product.
// Node stdlib only.
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WF_DIR = path.join(ROOT, ".github", "workflows");
const ACTIONS_DIR = path.join(ROOT, ".github", "actions");

export function discoverWorkflows(dir = WF_DIR) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => /\.(ya?ml)$/i.test(f)).sort();
}

// Design: validate local composite actions alongside workflows so a broken
// .github/actions/*/action.yml cannot slip past the YAML gate.
export function discoverCompositeActions(dir = ACTIONS_DIR) {
  if (!fs.existsSync(dir)) return [];
  const found = [];
  const walk = (cur) => {
    for (const entry of fs.readdirSync(cur, { withFileTypes: true })) {
      const full = path.join(cur, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/^action\.ya?ml$/i.test(entry.name)) {
        found.push(path.relative(dir, full).replace(/\\/g, "/"));
      }
    }
  };
  walk(dir);
  return found.sort();
}

// Design: check every local `uses: ./...` reference points to an existing
// action.yml|action.yaml (or workflow file for reusable workflows) — catches
// typos like `set-up` or `.github/action/` before GitHub Actions fails at start.
export function findLocalActionRefs(text) {
  const refs = [];
  let blockIndent = -1;
  text.split(/\r?\n/).forEach((raw, i) => {
    const n = i + 1;
    const indent = raw.length - raw.trimStart().length;
    if (blockIndent >= 0) {
      if (!raw.trim() || indent > blockIndent) return;
      blockIndent = -1;
    }
    const active = raw.replace(/(^|\s)#.*$/, "").trim();
    if (!active) return;
    if (/^(?:-\s+)?[A-Za-z_][\w-]*:\s*[|>][+-]?\s*$/.test(active)) { blockIndent = indent; return; }
    const m = active.match(/^(?:-\s+)?uses:\s*(['"]?)(\.\/[^'"\s]+)\1\s*$/);
    if (m) refs.push({ line: n, ref: m[2] });
  });
  return refs;
}

export function checkLocalActionRefs(text, rootDir = ROOT) {
  const repoRoot = path.resolve(rootDir);
  const problems = [];
  for (const { line, ref } of findLocalActionRefs(text)) {
    const target = path.resolve(repoRoot, ref);
    const rel = path.relative(repoRoot, target);
    if (!rel || rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel)) {
      problems.push("line " + line + ": local uses ref `" + ref + "` escapes repo root");
      continue;
    }
    if (/\.ya?ml$/i.test(target)) {
      if (!fs.existsSync(target)) {
        problems.push("line " + line + ": local workflow `" + ref + "` does not exist");
      }
      continue;
    }
    const hasYml = fs.existsSync(path.join(target, "action.yml"));
    const hasYaml = fs.existsSync(path.join(target, "action.yaml"));
    if (!hasYml && !hasYaml) {
      problems.push("line " + line + ": local action `" + ref + "` missing action.yml or action.yaml");
    }
  }
  return problems;
}

// Dependency-free structural validation of the YAML subset GitHub Actions uses. Block scalars
// (| and >) are skipped: their content is a shell program, not YAML.
export function structuralCheck(text) {
  const problems = [];
  const topKeys = [];
  let blockIndent = -1;
  text.split(/\r?\n/).forEach((raw, i) => {
    const n = i + 1;
    if (raw.includes("\t")) problems.push("line " + n + ": tab character in YAML (indentation must use spaces)");
    const indent = raw.length - raw.trimStart().length;
    if (blockIndent >= 0) {
      if (indent > blockIndent) return; // inside a block scalar
      blockIndent = -1;
    }
    const line = raw.replace(/\s+#.*$/, "");
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    if (/^[A-Za-z_][\w-]*:\s*[|>][+-]?\s*$/.test(trimmed)) { blockIndent = indent; return; }
    for (const q of ["'", '"']) {
      if ((trimmed.match(new RegExp(q, "g")) || []).length % 2 === 1) problems.push("line " + n + ": unbalanced " + q + " quote");
    }
    for (const [open, close] of [["[", "]"], ["{", "}"]]) {
      const o = (trimmed.match(new RegExp("\\" + open, "g")) || []).length;
      const c = (trimmed.match(new RegExp("\\" + close, "g")) || []).length;
      if (o !== c) problems.push("line " + n + ": unbalanced " + open + close);
    }
    if (indent === 0) {
      const m = trimmed.match(/^([A-Za-z_][\w-]*):/);
      if (!m) problems.push("line " + n + ": top-level entry is not `key:`");
      else {
        if (topKeys.includes(m[1])) problems.push("line " + n + ": duplicate top-level key `" + m[1] + "`");
        topKeys.push(m[1]);
      }
    }
  });
  return { problems, topKeys };
}

function resolveYaml() {
  try {
    return createRequire(path.join(ROOT, "package.json"))("yaml");
  } catch { /* not a direct dep */ }
  const store = path.join(ROOT, "node_modules", ".pnpm");
  if (fs.existsSync(store)) {
    for (const d of fs.readdirSync(store).filter((x) => /^yaml@/.test(x))) {
      try {
        return createRequire(path.join(store, d, "package.json"))("yaml");
      } catch { /* keep looking */ }
    }
  }
  return null;
}

function main() {
  const files = discoverWorkflows();
  if (files.length === 0) {
    process.stderr.write("check-workflows: no .github/workflows/*.yml|*.yaml found - refusing to pass vacuously\n");
    process.exit(1);
  }
  const actions = discoverCompositeActions();
  const targets = [
    ...files.map((f) => ({ label: f, full: path.join(WF_DIR, f), requiredKeys: ["name", "on", "jobs"] })),
    ...actions.map((a) => ({ label: "actions/" + a, full: path.join(ACTIONS_DIR, a), requiredKeys: ["name", "description", "runs"] })),
  ];
  const YAML = resolveYaml();
  let bad = 0;
  for (const { label, full, requiredKeys } of targets) {
    const text = fs.readFileSync(full, "utf8");
    const { problems, topKeys } = structuralCheck(text);
    const msgs = [...problems, ...checkLocalActionRefs(text)];
    for (const k of requiredKeys) if (!topKeys.includes(k)) msgs.push("missing top-level key `" + k + "`");
    if (YAML) {
      try {
        YAML.parse(text);
      } catch (e) {
        msgs.push("full YAML parse: " + String(e.message).split("\n")[0]);
      }
    }
    if (msgs.length) {
      bad++;
      process.stdout.write("FAIL " + label + "\n" + msgs.map((m) => "       - " + m).join("\n") + "\n");
    } else {
      process.stdout.write("ok   " + label + (YAML ? " (structural + full parse)" : " (structural; no YAML parser present)") + "\n");
    }
  }
  process.stdout.write(bad === 0 ? "check-workflows: OK (" + targets.length + " files)\n" : "check-workflows: BROKEN (" + bad + "/" + targets.length + ")\n");
  process.exit(bad === 0 ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
