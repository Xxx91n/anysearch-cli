// Work out which workspace packages a change touches, and which packages have
// to run because they use one of them.
//
// Design: the gate runs the changed packages plus every package that depends
// on them, and falls back to the whole suite outside apps/ and packages/ —
// turbo's --filter pulls only upstream tests, so filtering to one package never
// ran apps/cli after a kernel change (the hole the always-full gate was
// reacting to). Root files and docs fall back too, because tests in
// apps/plugin and packages/kernel read README, GLOSSARY.md and docs/.
//
// A file belongs to the package whose directory contains it.

import fs from "node:fs";
import path from "node:path";

const DEP_SECTIONS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];

/**
 * Decide what a preflight run should do.
 *
 * @param {string} root repository root
 * @param {string[]} changedFiles repo-relative paths, either separator
 * @param {{ forceFull?: boolean }} [options]
 * @returns {{ mode: "none" | "full" | "incremental", reason?: string, files: string[],
 *            packages: string[], touched?: string[], outside?: string[] }}
 */
export function planPreflight(root, changedFiles, { forceFull = false } = {}) {
  const files = [...new Set((changedFiles ?? []).map(normalizePath).filter(Boolean))].sort();
  if (forceFull) return { mode: "full", reason: "forced", files, packages: [] };
  if (files.length === 0) return { mode: "none", reason: "no changes", files: [], packages: [] };

  const packages = readWorkspace(root);
  if (packages.length === 0) return { mode: "full", reason: "no workspace packages found", files, packages: [] };

  const owners = new Map(files.map((file) => [file, packageForFile(file, packages)]));
  const outside = files.filter((file) => !owners.get(file));
  if (outside.length > 0) {
    return { mode: "full", reason: "files outside the workspace packages", files, outside, packages: [] };
  }

  const touched = [...new Set(files.map((file) => owners.get(file).name))].sort();
  return { mode: "incremental", files, touched, packages: withDependents(touched, packages) };
}

/**
 * Read the workspace packages and their workspace-internal dependencies.
 * Missing or unreadable pnpm-workspace.yaml just means an empty list; the
 * caller then falls back to the full suite.
 *
 * @param {string} root
 * @returns {{ name: string, dir: string, deps: string[] }[]}
 */
export function readWorkspace(root) {
  const packages = [];
  for (const dir of workspaceDirectories(root, workspacePatterns(root))) {
    const manifestPath = path.join(root, dir, "package.json");
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    } catch {
      continue;
    }
    if (!manifest?.name) continue;
    packages.push({ name: manifest.name, dir, deps: workspaceDeps(manifest) });
  }
  return packages.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

function withDependents(touched, packages) {
  const known = new Set(packages.map((pkg) => pkg.name));
  const dependents = new Map(packages.map((pkg) => [pkg.name, []]));
  for (const pkg of packages) {
    for (const dep of pkg.deps) {
      if (known.has(dep)) dependents.get(dep).push(pkg.name);
    }
  }

  const selected = new Set(touched);
  const queue = [...touched];
  while (queue.length > 0) {
    for (const name of dependents.get(queue.shift()) ?? []) {
      if (selected.has(name)) continue;
      selected.add(name);
      queue.push(name);
    }
  }
  return [...selected].sort();
}

function packageForFile(file, packages) {
  let owner = null;
  for (const pkg of packages) {
    if (file === pkg.dir || file.startsWith(`${pkg.dir}/`)) {
      if (!owner || pkg.dir.length > owner.dir.length) owner = pkg;
    }
  }
  return owner;
}

// The root has no direct YAML dependency and only the `packages:` list matters,
// so read that block here. A pattern this cannot expand leaves packages
// undiscovered, which falls back to the full suite.
function workspacePatterns(root) {
  const file = path.join(root, "pnpm-workspace.yaml");
  if (!fs.existsSync(file)) return [];

  const patterns = [];
  let inPackages = false;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    if (!/^\s/.test(line)) {
      inPackages = line.trim() === "packages:";
      continue;
    }
    if (!inPackages) continue;
    const match = /^\s*-\s*["']?([^"'#\s]+)["']?/.exec(line);
    if (match) patterns.push(match[1]);
  }
  return patterns;
}

function workspaceDirectories(root, patterns) {
  const dirs = new Set();
  for (const pattern of patterns) {
    const clean = pattern.replace(/^\.\//, "").replace(/\/+$/, "");
    if (!clean.includes("*")) {
      if (isDirectory(path.join(root, clean))) dirs.add(clean);
      continue;
    }
    const glob = /^(.*?)\/\*+$/.exec(clean);
    if (!glob) continue;
    const head = glob[1];
    const base = path.join(root, head);
    if (!isDirectory(base)) continue;
    for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = head === "" ? entry.name : `${head}/${entry.name}`;
      if (fs.existsSync(path.join(root, dir, "package.json"))) dirs.add(dir);
    }
  }
  return [...dirs].sort();
}

function workspaceDeps(manifest) {
  const deps = new Set();
  for (const section of DEP_SECTIONS) {
    for (const [key, spec] of Object.entries(manifest[section] ?? {})) {
      if (typeof spec !== "string" || !spec.startsWith("workspace:")) continue;
      // "workspace:foo@*" links foo under the key, so the target wins when it
      // names a package; plain ranges ("workspace:*", "workspace:^1.2.3") link
      // the package the key already names.
      const target = spec.slice("workspace:".length);
      const at = target.lastIndexOf("@");
      deps.add(at > 0 ? target.slice(0, at) : key);
    }
  }
  return [...deps].sort();
}

function normalizePath(file) {
  return String(file).replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
}

function isDirectory(dir) {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}
