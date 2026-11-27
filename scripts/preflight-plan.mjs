// Work out which files a change carries, which of them are documentation,
// which workspace packages the rest touches, and which packages have to run
// because they use one of them.
//
// Design: seven modes, each printed differently by the caller — "incremental"
// and "readers" run the packages the change can break; "full" runs everything
// and only a forced run asks for it; "none" and "docs" have nothing to run and
// say why. The final two have nothing to run either, but they are not "nothing
// to do": "unowned" is a change carrying a file no package can claim — the
// gate says it skipped, because no rule here names what that file can break;
// "broken" is a repository the gate cannot read at all (a damaged manifest, no
// workspace declaration, a reader that is gone) — the caller stops the push
// with exit 2 instead of guessing. Skipping and stopping are two different
// answers, and only the second one is a fault. Neither is a pass.
//
// Design: the gate runs the changed packages plus every package that depends
// on them, and no upstream tests: turbo's test task builds a package's
// dependencies first but does not run their tests (#490). A test that reads
// another package's files can sit upstream of the change that breaks it; only
// an unfiltered full run covers that — the push gate's --full, CI's
// check-build lane, and the merge gate. A root file the reader table below
// names runs those packages and nothing else (#489). Everything else at the
// root belongs to no package: the lockfile, package.json, turbo.json,
// pnpm-workspace.yaml, .github/, .gitignore (it changes what git sees for every
// package), and scripts/. A local skip there is safe because the coverage moved
// to CI, whose check-build lane runs the full suite when no package owns a file.
//
// Design: documentation gets its own mode, not the unowned one — a docs-only
// change runs nothing, and docs next to code are dropped before the package
// lookup, so they belong to no package but are not the unowned answer either.
// The boundary is isDocumentation (#488).
//
// A file belongs to the package whose directory contains it. A workspace the
// gate cannot read (a broken manifest, no pnpm-workspace.yaml) answers
// "broken", never "nothing to run".
//
// Design: a directory whose manifest has no name is not a package, and a change
// under it answers "broken" too — the manifest is damaged, and skipping the
// change would hide that. The old answer ran the whole suite, which this plan no
// longer does on its own.

import fs from "node:fs";
import path from "node:path";

const DEP_SECTIONS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];

/**
 * Decide what a preflight run should do.
 *
 * `readers` is set only when an incremental run carried a root file with known
 * readers. It is absent on a `readers` run (whose `packages` are the readers)
 * and on any run that carried none of those files.
 *
 * `outside` names the files no package owns, on an `unowned` run. A `broken`
 * run carries `reason` (what the gate could not read) and `fix` (what to
 * repair); the caller prints both and stops the push.
 *
 * @param {string} root repository root
 * @param {string[]} changedFiles repo-relative paths, either separator
 * @param {{ forceFull?: boolean }} [options]
 * @returns {{ mode: "none" | "docs" | "readers" | "full" | "incremental" | "unowned" | "broken",
 *            reason?: string, fix?: string, files: string[], packages: string[],
 *            readers?: string[], touched?: string[], outside?: string[] }}
 */
export function planPreflight(root, changedFiles, { forceFull = false } = {}) {
  const files = [...new Set((changedFiles ?? []).map(normalizePath).filter(Boolean))].sort();
  if (forceFull) return { mode: "full", reason: "forced", files, packages: [] };
  if (files.length === 0) return { mode: "none", reason: "no changes", files: [], packages: [] };
  // Design: the docs check runs before the workspace read — a docs-only change
  // needs no package, and a broken tree must not turn "ran nothing" into a
  // stopped push.
  if (docsOnly(files)) return { mode: "docs", reason: "documentation only", files, packages: [] };

  const { packages, nameless, unreadableFile } = readWorkspaceReport(root);
  if (unreadableFile) {
    return broken(`cannot read ${unreadableFile}`, "repair it, then push again", files);
  }
  if (packages.length === 0) {
    // The workspace looks empty because its manifests have no name; naming the
    // directories says more than "no workspace packages found" on its own.
    if (nameless.length > 0) {
      return broken(
        `no workspace packages found; package.json without a name in: ${nameless.join(", ")}`,
        NAMELESS_FIX,
        files,
      );
    }
    return broken(
      "no workspace packages found",
      "pnpm-workspace.yaml names the workspace packages: fix it, or the manifests it points at, then push again",
      files,
    );
  }

  // Design: a root file the reader table names runs those packages alone, and
  // every other file goes through the package lookup — a reader the workspace no
  // longer has would filter turbo down to no task while the gate printed green,
  // so a miss is a broken gate, never a quiet pass.
  const readers = new Set();
  const withoutReaders = [];
  for (const file of files) {
    const readBy = rootReaders(file);
    if (readBy) for (const name of readBy) readers.add(name);
    else withoutReaders.push(file);
  }
  const known = new Set(packages.map((pkg) => pkg.name));
  const missing = [...readers].filter((name) => !known.has(name));
  if (missing.length > 0) {
    return broken(
      `no workspace package named: ${missing.sort().join(", ")}`,
      "ROOT_READERS names a package the workspace no longer has: restore the package or fix the table, then push again",
      files,
    );
  }

  const { touched, unowned: outside } = codeOwnership(withoutReaders, packages);
  if (outside.length > 0) {
    // A file under a manifest that lost its name is a damaged repository, not a
    // file nobody claims: a nameless directory reads as "outside the packages"
    // while the real fault is one package.json.
    const namelessHits = nameless.filter((dir) => outside.some((file) => isWithin(file, dir)));
    if (namelessHits.length > 0) {
      return broken(
        `files under a directory whose package.json has no name: ${namelessHits.join(", ")}`,
        NAMELESS_FIX,
        files,
      );
    }
    return { mode: "unowned", reason: "files outside the workspace packages", files, outside, packages: [] };
  }

  const readerPackages = [...readers].sort();
  if (touched.length === 0) return { mode: "readers", files, packages: readerPackages };
  return {
    mode: "incremental",
    files,
    touched,
    ...(readerPackages.length > 0 ? { readers: readerPackages } : {}),
    packages: [...new Set([...readerPackages, ...withDependents(touched, packages)])].sort(),
  };
}

// Design: one repair line for both places a nameless manifest can show up — no
// package at all, or a change under one — because the damage is the same.
const NAMELESS_FIX = "give those manifests a name, then push again";

// Design: a repository the gate cannot read has nothing to run and no right to
// guess — the reason names what it could not read, the fix names the repair, and
// the caller prints both and stops the push with exit 2. Exported so the runner,
// which also reports an unreadable change set, builds the same shape.
export function broken(reason, fix, files) {
  return { mode: "broken", reason, fix, files, packages: [] };
}

const ROOT_DOCS = new Set(["README.md", "README.zh-CN.md", "GLOSSARY.md", "CHANGELOG.md"]);

/**
 * Whether a path counts as documentation. The push gate skips the suite on a
 * docs-only change and CI skips every lane, so both ask this one function.
 *
 * docs/eval/ is evaluation evidence and `apps/plugin`'s markdown (its AGENTS.md
 * and SKILL.md) is a product asset: tests read both, so neither counts. A bare
 * "docs" names no file a push could have changed, so it does not count either.
 *
 * @param {string} file repo-relative path, either separator
 */
export function isDocumentation(file) {
  const normalized = normalizePath(file);
  if (normalized.startsWith("docs/eval/")) return false;
  return normalized.startsWith("docs/") || ROOT_DOCS.has(normalized);
}

/** True when the change set is not empty and every file in it is documentation. */
export function docsOnly(files) {
  const list = (files ?? []).map(normalizePath).filter(Boolean);
  return list.length > 0 && list.every(isDocumentation);
}

/**
 * How the code half of a change is owned: the packages its files belong to, and
 * the files no package owns. Docs are skipped here, so they never count as
 * unowned.
 *
 * Root files with a known reader (#489) do not reach this from the push gate —
 * the plan resolves them first. CI still calls this with them, and still counts
 * them as unowned: a lane covers many packages, so "these read the file" buys no
 * lane back, and `check-build` runs the full suite for a root file either way.
 *
 * @param {string[]} files normalized paths, docs not removed yet
 * @param {{ name: string, dir: string, deps: string[] }[]} packages
 * @returns {{ touched: string[], unowned: string[] }}
 */
export function codeOwnership(files, packages) {
  const touched = [];
  const unowned = [];
  for (const file of files) {
    if (isDocumentation(file)) continue;
    const owner = packageForFile(file, packages);
    if (owner) touched.push(owner.name);
    else unowned.push(file);
  }
  return { unowned, touched: [...new Set(touched)].sort() };
}

/**
 * Root files with known readers: for each, the workspace packages a change to
 * the file can break, because a test of theirs reads it.
 *
 * Design: the table is hand-written and deliberately short (#489) — a root file
 * that is not here belongs to no package, so the push gate skips it and CI's
 * check-build lane runs everything for it, which beats guessing a reader from a
 * directory name. `ext` narrows a row to the files a loader reads
 * (`domains/*.toml`), so a file dropped beside them is unowned too. Readers do
 * not bring their dependents: an app that depends on store never opens the file
 * through store's tests, so a dependent that does read it is named in its own
 * right, as cli is on the domains row.
 *
 * mcp's build copies the root domains into its generated `apps/mcp/domains`.
 * Its domain tests point ANS_DOMAINS_DIR at their own temp dir, and clean tests
 * declare none, so no mcp test reads that copy or the repo-root TOMLs. The
 * domains row stays without mcp unless a test starts reading one. (The no-arg
 * boots would follow a developer shell's ANS_DOMAIN; CI sets none.)
 *
 * `scripts/test/preflight-root-readers.mjs` holds the answers both test files
 * assert, and the plan test pins every row against the real workspace — each
 * path on disk, each reader a package that still exists, each list exact — so
 * the table carries no evidence prose of its own.
 */
export const ROOT_READERS = [
  {
    path: "domains",
    ext: ".toml",
    readers: ["@anysearch-cli/cli", "@anysearch-cli/kernel", "@anysearch-cli/store"],
  },
  { path: "AGENTS.md", readers: ["@anysearch-cli/store"] },
  { path: "eval-badcases.json", readers: ["@anysearch-cli/kernel", "@anysearch-cli/store"] },
  { path: "eval-looks.coverage.json", readers: ["@anysearch-cli/store"] },
  { path: "eval-looks.json", readers: ["@anysearch-cli/kernel", "@anysearch-cli/store"] },
];

/** The readers the table names for a root file, or null when it names none. */
function rootReaders(file) {
  const normalized = normalizePath(file);
  for (const entry of ROOT_READERS) {
    if (!isWithin(normalized, entry.path)) continue;
    if (entry.ext && !normalized.endsWith(entry.ext)) continue;
    return entry.readers;
  }
  return null;
}

/**
 * Read the workspace packages and their workspace-internal dependencies.
 * A missing pnpm-workspace.yaml, or one that names no package, reads as an empty
 * list. A declaration or manifest that cannot be read or parsed makes this return
 * null, so no caller silently drops a package and everything that depends on it:
 * the push gate answers broken, and CI runs every lane. A directory without a
 * package.json is not a package, so a change under it belongs to no package. A
 * manifest without a name is not a package either, and the plan reports a change
 * under it as broken: the manifest is damaged, not merely absent.
 *
 * @param {string} root
 * @returns {{ name: string, dir: string, deps: string[] }[] | null}
 */
export function readWorkspace(root) {
  return readWorkspaceReport(root).packages;
}

// readWorkspace plus what the plan needs to name a fault: the directories a
// nameless manifest left out, and the file it could not read. Private: the plan
// is its only reader, and readWorkspace's doc owns the null contract.
function readWorkspaceReport(root) {
  const packages = [];
  const nameless = [];
  const patterns = workspacePatterns(root);
  if (patterns === null) {
    return { packages: null, nameless: [], unreadableFile: "pnpm-workspace.yaml" };
  }
  for (const dir of workspaceDirectories(root, patterns)) {
    const manifest = readManifest(path.join(root, dir, "package.json"));
    // The first unreadable manifest, in directory order, is the one worth
    // naming: fixing it is what lets the next run answer.
    if (manifest === UNREADABLE) {
      return { packages: null, nameless: [], unreadableFile: `${dir}/package.json` };
    }
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
    unreadableFile: null,
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
    if (isWithin(file, pkg.dir)) {
      if (!owner || pkg.dir.length > owner.dir.length) owner = pkg;
    }
  }
  return owner;
}

// The root has no direct YAML dependency and only the `packages:` list matters,
// so read that block here. A pattern this cannot expand leaves its packages
// undiscovered: when that leaves none, the plan answers broken, never a silent
// pass. A missing file reads as no patterns; one that is there and cannot be read
// is null, so the plan can name it instead of blaming an empty workspace.
function workspacePatterns(root) {
  const file = path.join(root, "pnpm-workspace.yaml");
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (error) {
    return error.code === "ENOENT" ? [] : null;
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

/** True when the file is the directory itself or sits inside it. */
function isWithin(file, dir) {
  return file === dir || file.startsWith(`${dir}/`);
}

function isDirectory(dir) {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}
