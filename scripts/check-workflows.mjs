#!/usr/bin/env node
// - workflow YAML gate, promoted from .scratch/check-workflows.mjs (backlog B-2).
//
// Round-57: a workflow file that does not parse makes GitHub Actions report a run with zero
// jobs ("likely failed because of a workflow file issue"), invisible in a normal green/red read.
// The old checker lived in .scratch/ (never shipped) and FAILED OPEN when no YAML parser was
// present. This version is fail-closed by construction:
// - auto-discovers .github/workflows/*.yml|*.yaml, .github/actions/**/action.yml|*.yaml,
// and any local directory action referenced by workflows or actions;
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

function isRegularFile(p) {
  return Boolean(fs.statSync(p, { throwIfNoEntry: false })?.isFile());
}

function canonicalKey(p) {
  try { return fs.realpathSync.native(p); } catch { return path.resolve(p); }
}

export function discoverWorkflows(dir = WF_DIR) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => /\.(ya?ml)$/i.test(f)).sort();
}

// Design: validate local composite actions alongside workflows.
export function discoverCompositeActions(dir = ACTIONS_DIR) {
  if (!fs.existsSync(dir)) return [];
  const found = [];
  const walk = (cur) => {
    for (const entry of fs.readdirSync(cur, { withFileTypes: true })) {
      const full = path.join(cur, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === "action.yml" || entry.name === "action.yaml") {
        found.push(path.relative(dir, full).replace(/\\/g, "/"));
      }
    }
  };
  walk(dir);
  return found.sort();
}

function forEachYamlLine(text, onLine) {
  let blockIndent = -1;
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1;
    const indent = raw.length - raw.trimStart().length;
    if (blockIndent >= 0) {
      if (!raw.trim() || indent > blockIndent) {
        onLine({ line, raw, indent, inBlock: true, active: "" });
        return;
      }
      blockIndent = -1;
    }
    const active = raw.replace(/(^|\s)#.*$/, "").trim();
    if (!active) {
      onLine({ line, raw, indent, inBlock: false, active: "" });
      return;
    }
    const blockMatch = active.match(/^(-\s+)?[A-Za-z_][\w-]*:\s*[|>][+-]?\d*[+-]?\s*$/);
    if (blockMatch) {
      // Key column for `- run: |` is after `- `, so sibling fields at key indent are not swallowed.
      blockIndent = indent + (blockMatch[1] ? blockMatch[1].length : 0);
      onLine({ line, raw, indent, inBlock: false, active });
      return;
    }
    onLine({ line, raw, indent, inBlock: false, active });
  });
}

// Design: every local `uses: ./...` must resolve inside the repo to a workflow
// under .github/workflows/ or an action directory with action.yml|action.yaml.
export function findLocalActionRefs(text) {
  const refs = [];
  forEachYamlLine(text, ({ line, active }) => {
    if (!active) return;
    const m = active.match(/^(?:-\s+)?uses:\s*(?:'(\.\/[^']+)'|"(\.\/[^"]+)"|(\.\/[^\s]+))\s*$/);
    const ref = m && (m[1] || m[2] || m[3]);
    if (ref) refs.push({ line, ref });
  });
  return refs;
}

function extractUsesRefsFromAst(doc) {
  const refs = [];
  const pushUses = (val) => {
    if (typeof val === "string" && val.trim().startsWith("./")) {
      refs.push({ line: 0, ref: val.trim() });
    }
  };
  if (doc?.jobs && typeof doc.jobs === "object") {
    for (const job of Object.values(doc.jobs)) {
      pushUses(job?.uses);
      for (const step of Array.isArray(job?.steps) ? job.steps : []) pushUses(step?.uses);
    }
  }
  for (const step of Array.isArray(doc?.runs?.steps) ? doc.runs.steps : []) pushUses(step?.uses);
  return refs;
}

export function classifyLocalUsesRef(ref, rootDir = ROOT) {
  if (typeof ref !== "string" || !ref.startsWith("./")) {
    return { ok: false, error: "local uses ref `" + ref + "` must start with `./`" };
  }
  if (ref.includes("\\")) {
    return { ok: false, error: "local uses ref `" + ref + "` must use forward slashes (`/`)" };
  }
  const repoRoot = path.resolve(rootDir);
  const wfRoot = path.resolve(repoRoot, ".github", "workflows");
  const target = path.resolve(repoRoot, ref);
  const rel = path.relative(repoRoot, target);
  if (rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel)) {
    return { ok: false, error: "local uses ref `" + ref + "` escapes repo root" };
  }
  const wfRel = path.relative(wfRoot, target);
  const directUnderWorkflows = Boolean(wfRel) && wfRel !== ".." && !wfRel.startsWith(".." + path.sep)
    && !path.isAbsolute(wfRel) && !wfRel.includes(path.sep);
  if (/\.ya?ml$/i.test(target)) {
    if (!directUnderWorkflows) {
      return { ok: false, error: "local action ref `" + ref + "` must point to an action directory or a direct file under .github/workflows/" };
    }
    if (!isRegularFile(target)) {
      return { ok: false, error: "local workflow `" + ref + "` does not exist" };
    }
    return { ok: true, kind: "workflow", full: target, label: rel.replace(/\\/g, "/") };
  }
  for (const name of ["action.yml", "action.yaml"]) {
    const actionFile = path.join(target, name);
    if (isRegularFile(actionFile)) {
      const actionRel = path.relative(repoRoot, actionFile).replace(/\\/g, "/");
      const label = actionRel.startsWith(".github/") ? actionRel.slice(".github/".length) : actionRel;
      return { ok: true, kind: "action", full: actionFile, label };
    }
  }
  return { ok: false, error: "local action `" + ref + "` missing action.yml or action.yaml" };
}

export function checkLocalActionRefs(text, rootDir = ROOT, doc = null) {
  const problems = [];
  const seen = new Set();
  const refs = [...findLocalActionRefs(text), ...(doc ? extractUsesRefsFromAst(doc) : [])];
  for (const { line, ref } of refs) {
    const key = line + ":" + ref;
    if (line === 0 && seen.has("any:" + ref)) continue;
    seen.add(key);
    seen.add("any:" + ref);
    const res = classifyLocalUsesRef(ref, rootDir);
    if (!res.ok) problems.push((line > 0 ? "line " + line + ": " : "") + res.error);
  }
  return problems;
}

// Design: collect both .github/actions/**/action.ya?ml and any local directory
// action referenced by workflows or actions so check-workflows and E6 scan the same set.
export function discoverAllLocalActions(rootDir = ROOT, YAML = null) {
  const repoRoot = path.resolve(rootDir);
  const wfDir = path.join(repoRoot, ".github", "workflows");
  const actionsDir = path.join(repoRoot, ".github", "actions");
  const byKey = new Map();
  const queue = [];

  for (const rel of discoverCompositeActions(actionsDir)) {
    const full = path.join(actionsDir, rel);
    const key = canonicalKey(full);
    if (!byKey.has(key)) byKey.set(key, { label: "actions/" + rel, full });
    queue.push(full);
  }
  for (const f of discoverWorkflows(wfDir)) {
    queue.push(path.join(wfDir, f));
  }
  const visited = new Set();
  while (queue.length > 0) {
    const file = queue.shift();
    const fileKey = canonicalKey(file);
    if (visited.has(fileKey) || !isRegularFile(file)) continue;
    visited.add(fileKey);
    const text = fs.readFileSync(file, "utf8");
    let refs = findLocalActionRefs(text);
    if (YAML) {
      try {
        const doc = YAML.parse(text);
        refs = [...refs, ...extractUsesRefsFromAst(doc)];
      } catch { /* broken YAML is reported by callers */ }
    }
    for (const { ref } of refs) {
      const res = classifyLocalUsesRef(ref, repoRoot);
      if (res.ok && res.kind === "action") {
        const key = canonicalKey(res.full);
        if (!byKey.has(key)) {
          byKey.set(key, { label: res.label, full: res.full });
          queue.push(res.full);
        }
      }
    }
  }
  return [...byKey.values()].sort((a, b) => a.label.localeCompare(b.label));
}

// Dependency-free structural validation of the YAML subset GitHub Actions uses. Block scalars
// (| and >) are skipped: their content is a shell program, not YAML.
export function structuralCheck(text) {
  const problems = [];
  const topKeys = [];
  forEachYamlLine(text, ({ line, raw, indent, inBlock, active }) => {
    if (raw.includes("\t")) problems.push("line " + line + ": tab character in YAML (indentation must use spaces)");
    if (inBlock || !active) return;
    for (const q of ["'", '"']) {
      if ((active.match(new RegExp(q, "g")) || []).length % 2 === 1) problems.push("line " + line + ": unbalanced " + q + " quote");
    }
    for (const [open, close] of [["[", "]"], ["{", "}"]]) {
      const o = (active.match(new RegExp("\\" + open, "g")) || []).length;
      const c = (active.match(new RegExp("\\" + close, "g")) || []).length;
      if (o !== c) problems.push("line " + line + ": unbalanced " + open + close);
    }
    if (indent === 0) {
      const m = active.match(/^([A-Za-z_][\w-]*):/);
      if (!m) problems.push("line " + line + ": top-level entry is not `key:`");
      else {
        if (topKeys.includes(m[1])) problems.push("line " + line + ": duplicate top-level key `" + m[1] + "`");
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
  const actions = discoverAllLocalActions(ROOT, YAML);
  const targets = [
    ...files.map((f) => ({ label: f, full: path.join(WF_DIR, f), requiredKeys: ["name", "on", "jobs"] })),
    ...actions.map(({ label, full }) => ({ label, full, requiredKeys: ["name", "description", "runs"] })),
  ];
  let bad = 0;
  for (const { label, full, requiredKeys } of targets) {
    const text = fs.readFileSync(full, "utf8");
    const { problems, topKeys } = structuralCheck(text);
    const msgs = [...problems];
    let parsedDoc = null;
    if (YAML) {
      try {
        parsedDoc = YAML.parse(text);
      } catch (e) {
        msgs.push("full YAML parse: " + String(e.message).split("\n")[0]);
      }
    }
    msgs.push(...checkLocalActionRefs(text, ROOT, parsedDoc));
    for (const k of requiredKeys) if (!topKeys.includes(k)) msgs.push("missing top-level key `" + k + "`");
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
