// Work out which workspace packages a change touches, and which packages have
// to run because they use one of them.
//
// Design: the gate runs the changed packages plus every package that depends
// on them, and no upstream tests: turbo's test task builds a package's
// dependencies first but does not run their tests (#490). A test that reads
// another package's files can sit upstream of the change that breaks it:
// kernel's tests read apps/mcp/domains, which only an unfiltered full run
// covers — the push gate's --full, CI's check-build lane, and the merge gate.
// A change outside apps/ and packages/ runs the whole suite, because no rule
// here names which packages read it. Root files change what every package runs
// (the lockfile, turbo.json) and belong to no package, so they run the whole
// suite too; docs follow the same rule.
//
// CI removes docs before selecting lanes; the push gate does not.
//
// A file belongs to the package whose directory contains it. A workspace that
// cannot be read (no pnpm-workspace.yaml, a broken manifest) hands the caller
// an empty list or null, and the caller runs the full suite. A directory whose
// manifest has no name is not a package, so a change under it belongs to no
// package and runs the full suite too.

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

  const { packages, nameless } = readWorkspaceReport(root);
  if (packages === null) return { mode: "full", reason: "workspace unreadable", files, packages: [] };
  if (packages.length === 0) {
    // The workspace looks empty because its manifests have no name; naming the
    // directories says more than "no workspace packages found" on its own.
    const reason =
      nameless.length > 0
        ? `no workspace packages found; package.json without a name in: ${nameless.join(", ")}`
        : "no workspace packages found";
    return { mode: "full", reason, files, packages: [] };
  }

  const owners = new Map(files.map((file) => [file, packageForFile(file, packages)]));
  const outside = files.filter((file) => !owners.get(file));
  if (outside.length > 0) {
    // A path under apps/ that lost its package still has to say so: "outside
    // the workspace packages" reads as "not in apps/", which is not the case.
    const underNameless = outside.every((file) =>
      nameless.some((dir) => file === dir || file.startsWith(`${dir}/`)),
    );
    const reason = underNameless
      ? "files under a directory whose package.json has no name"
      : "files outside the workspace packages";
    return { mode: "full", reason, files, outside, packages: [] };
  }

  const touched = [...new Set(files.map((file) => owners.get(file).name))].sort();
  return { mode: "incremental", files, touched, packages: withDependents(touched, packages) };
}

/**
 * Read the workspace packages and their workspace-internal dependencies.
 * Missing or unreadable pnpm-workspace.yaml reads as an empty list. A manifest
 * that cannot be read or parsed makes this return null, so the caller runs the
 * full suite instead of silently dropping a package and everything that depends
 * on it. A directory without a package.json, or a manifest without a name, is
 * not a package: it is skipped, and a change under it runs the full suite.
 *
 * @param {string} root
 * @returns {{ name: string, dir: string, deps: string[] }[] | null}
 */
export function readWorkspace(root) {
  return readWorkspaceReport(root).packages;
}

// readWorkspace plus the directories a nameless manifest left out, so the plan
// can say why a change under one of them ran the full suite. Private: the plan
// is its only reader, and readWorkspace's doc owns the null contract.
function readWorkspaceReport(root) {
  const packages = [];
  const nameless = [];
  for (const dir of workspaceDirectories(root, workspacePatterns(root))) {
    const manifest = readManifest(path.join(root, dir, "package.json"));
    if (manifest === UNREADABLE) return { packages: null, nameless: [] };
    if (manifest === null) continue; // no package.json: not a package
    if (manifest === NAMELESS) {
      nameless.push(dir);
      continue;
    }
    packages.push({ name: manifest.name, dir, deps: workspaceDeps(manifest) });
  }
  return {
    packages: packages.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
    nameless: nameless.sort(),
  };
}

const UNREADABLE = Symbol("unreadable manifest");
const NAMELESS = Symbol("manifest without a name");

function readManifest(file) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (error) {
    return error.code === "ENOENT" ? null : UNREADABLE;
  }
  let manifest;
  try {
    manifest = JSON.parse(text);
  } catch {
    return UNREADABLE;
  }
  return typeof manifest?.name === "string" && manifest.name !== "" ? manifest : NAMELESS;
}

/**
 * The touched packages plus every package that depends on one of them.
 * Exported so the CI lane selector reuses the same closure as the push gate.
 */
export function withDependents(touched, packages) {
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

/** The deepest package directory containing the file, or null for an unowned path. */
export function packageForFile(file, packages) {
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
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }

  const patterns = [];
  let inPackages = false;
  for (const line of text.split(/\r?\n/)) {
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
    let entries;
    try {
      entries = fs.readdirSync(base, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
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

/** Repo-relative path with forward slashes, no `./` prefix, no trailing `/`. */
export function normalizePath(file) {
  return String(file).replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
}

function isDirectory(dir) {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}
