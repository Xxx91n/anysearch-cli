// Which changed files count as documentation, and which CI lanes must run for
// the rest.
//
// Design: lanes are selected by package. Each lane names the workspace packages
// it can exercise; the change reduces to the preflight closure (changed package
// + every package depending on it), and a lane runs when the lists intersect.
//
// Design: docs-only skips every lane. Everything else uncertain (empty set,
// unreadable workspace, unowned path, a package no lane names) runs every lane.

import fs from "node:fs";
import process from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizePath, packageForFile, readWorkspace, withDependents } from "./preflight-plan.mjs";

const ROOT_DOCS = new Set(["README.md", "README.zh-CN.md", "GLOSSARY.md", "CHANGELOG.md"]);

// Design: one line per lane — the packages it cares about, by manifest name.
// Keep the names here, not paths: the closure already knows where each package
// lives. The three full-suite lanes share one list; copy it to narrow a lane.
const FULL_SUITE = [
  "@anysearch-cli/cli",
  "@anysearch-cli/mcp",
  "@anysearch-cli/plugin",
  "@anysearch-cli/dsh-plugin",
  "@anysearch-cli/kernel",
  "@anysearch-cli/store",
  "@anysearch-cli/retriever",
  "@anysearch-cli/embedding",
];
export const LANES = {
  "check-build": FULL_SUITE,
  "spaced-path": ["@anysearch-cli/plugin"],
  "install-smoke": ["@anysearch-cli/cli", "@anysearch-cli/mcp", "@anysearch-cli/plugin", "@anysearch-cli/embedding"],
  "test-online": ["@anysearch-cli/store", "@anysearch-cli/embedding"],
  "test-online-anysearch": ["@anysearch-cli/retriever"],
  "coverage": FULL_SUITE,
  // native-smoke checks store's better-sqlite3 prebuild. An app-only dependency
  // range edit without a lockfile refresh can miss the linux-arm64 leg;
  // install-smoke covers x64 product loads, not arm64.
  "native-smoke": ["@anysearch-cli/store"],
  "ship-gate": FULL_SUITE,
  "memory-eval": ["@anysearch-cli/store"],
  "macos-spillover-probe": ["@anysearch-cli/cli", "@anysearch-cli/store"],
};

export function isDocumentation(file) {
  const normalized = normalizePath(file);
  if (normalized.startsWith("docs/eval/")) return false;
  return normalized.startsWith("docs/") || ROOT_DOCS.has(normalized);
}

export function docsOnly(files) {
  const list = (files ?? []).map(normalizePath).filter(Boolean);
  return list.length > 0 && list.every(isDocumentation);
}

/**
 * Decide which lanes must run, plus why an uncertain change ran everything.
 *
 * @param {string[]} files repo-relative paths, either separator
 * @param {{ name: string, dir: string, deps: string[] }[] | null} packages
 *        the workspace from readWorkspace; null means it could not be read
 * @returns {{ lanes: string[], reason: string }} [] lanes only for docs-only;
 *          reason is empty unless a fallback ran every lane
 */
export function planLanes(files, packages) {
  const list = normalizeList(files);
  const all = Object.keys(LANES);
  if (list.length === 0) return { lanes: all, reason: "empty change set" };
  if (docsOnly(list)) return { lanes: [], reason: "" };
  if (!Array.isArray(packages) || packages.length === 0) {
    return { lanes: all, reason: "workspace unreadable" };
  }

  // Docs belong to no package, but they are not root files: a code+docs PR
  // selects on the code only. docs/eval/ is not documentation, so it still
  // reaches the unowned fallback.
  const code = list.filter((file) => !isDocumentation(file));
  const owners = new Map(code.map((file) => [file, packageForFile(file, packages)]));
  const unowned = code.filter((file) => !owners.get(file));
  if (unowned.length > 0) {
    return { lanes: all, reason: `unowned path: ${safeList(unowned)}` };
  }

  const touched = [...new Set([...owners.values()].map((owner) => owner.name))].sort();
  const closure = new Set(withDependents(touched, packages));
  // A package in the closure that no lane names is new (or the declarations are
  // stale). Run everything: otherwise a PR that also touches a known app runs
  // only that app's lanes and loses the full-suite lanes for the new package.
  const unclaimed = [...closure].filter((pkg) => all.every((lane) => !LANES[lane].includes(pkg)));
  if (unclaimed.length > 0) {
    return { lanes: all, reason: `no lane names: ${safeList(unclaimed)}` };
  }
  return { lanes: all.filter((lane) => LANES[lane].some((pkg) => closure.has(pkg))), reason: "" };
}

/** The lane list only; see planLanes for the fallback reason. */
export function lanesForChange(files, packages) {
  return planLanes(files, packages).lanes;
}

function normalizeList(files) {
  return [...new Set((files ?? []).map(normalizePath).filter(Boolean))].sort();
}

// The reason goes into a one-line GitHub output; a raw newline in a path would
// break that file and fail the whole job.
function safeList(items) {
  const shown = items
    .slice(0, 3)
    .map((item) => String(item).replace(/[^\w.@/+-]/g, "?"))
    .join(", ");
  const rest = items.length - 3;
  return rest > 0 ? `${shown} (+${rest} more)` : shown;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (!args.includes("--github")) {
    console.error("usage: node scripts/ci-changes.mjs --github [--all]");
    process.exit(2);
  }
  const runAll = args.includes("--all");
  let files = [];
  if (!runAll) {
    const input = fs.readFileSync(0, "utf8");
    files = input.split(input.includes("\0") ? "\0" : /\r?\n/).filter(Boolean);
  }
  const plan = runAll
    ? { lanes: Object.keys(LANES), reason: "" }
    : planLanes(files, readWorkspace(process.cwd()));
  process.stdout.write(`docs-only=${plan.lanes.length === 0}\n`);
  if (plan.reason) process.stdout.write(`reason=${plan.reason}\n`);
  for (const lane of Object.keys(LANES)) process.stdout.write(`run-${lane}=${plan.lanes.includes(lane)}\n`);
}
