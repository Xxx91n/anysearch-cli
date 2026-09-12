#!/usr/bin/env node
// ADR-0059 D5 (T-4) - workflow YAML gate, promoted from .scratch/check-workflows.mjs (backlog B-2).
//
// Round-57 F-10: a workflow file that does not parse makes GitHub Actions report a run with zero
// jobs ("likely failed because of a workflow file issue"), invisible in a normal green/red read.
// The old checker lived in .scratch/ (never shipped) and FAILED OPEN when no YAML parser was
// present. This version is fail-closed by construction:
//   - auto-discovers .github/workflows/*.yml and *.yaml;
//   - ALWAYS runs dependency-free structural checks (tabs, top-level key syntax, duplicates,
//     required keys, quote/bracket balance outside block scalars);
//   - ADDITIONALLY runs a full YAML parse when a parser is resolvable, so the strict check is
//     available without adding a runtime dependency to the product.
// Node stdlib only (ADR-0020 D5).
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WF_DIR = path.join(ROOT, ".github", "workflows");

export function discoverWorkflows(dir = WF_DIR) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => /\.(ya?ml)$/i.test(f)).sort();
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
  const YAML = resolveYaml();
  let bad = 0;
  for (const f of files) {
    const text = fs.readFileSync(path.join(WF_DIR, f), "utf8");
    const { problems, topKeys } = structuralCheck(text);
    const msgs = [...problems];
    for (const k of ["name", "on", "jobs"]) if (!topKeys.includes(k)) msgs.push("missing top-level key `" + k + "`");
    if (YAML) {
      try {
        YAML.parse(text);
      } catch (e) {
        msgs.push("full YAML parse: " + String(e.message).split("\n")[0]);
      }
    }
    if (msgs.length) {
      bad++;
      process.stdout.write("  FAIL " + f + "\n" + msgs.map((m) => "       - " + m).join("\n") + "\n");
    } else {
      process.stdout.write("  ok   " + f + (YAML ? " (structural + full parse)" : " (structural; no YAML parser present)") + "\n");
    }
  }
  process.stdout.write(bad === 0 ? "check-workflows: OK (" + files.length + " files)\n" : "check-workflows: BROKEN (" + bad + "/" + files.length + ")\n");
  process.exit(bad === 0 ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
