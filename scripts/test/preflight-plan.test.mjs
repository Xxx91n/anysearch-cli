import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test, { after, before } from "node:test";
import {
  codeOwnership,
  docsOnly,
  isDocumentation,
  planPreflight,
  readWorkspace,
  ROOT_READERS,
} from "../preflight-plan.mjs";
import { EXPECTED_ROOT_READERS } from "./preflight-root-readers.mjs";

// The same shape as the real workspace: four apps on top, four shared
// packages below, embedding as a peer of store and the apps.
const MANIFESTS = {
  "packages/embedding": { name: "@anysearch-cli/embedding" },
  "packages/retriever": { name: "@anysearch-cli/retriever" },
  "packages/store": {
    name: "@anysearch-cli/store",
    dependencies: { "@anysearch-cli/retriever": "workspace:*" },
    peerDependencies: { "@anysearch-cli/embedding": "workspace:*" },
  },
  "packages/kernel": {
    name: "@anysearch-cli/kernel",
    dependencies: { "@anysearch-cli/retriever": "workspace:*", "@anysearch-cli/store": "workspace:*" },
  },
  "apps/plugin": {
    name: "@anysearch-cli/plugin",
    devDependencies: {
      "@anysearch-cli/kernel": "workspace:*",
      "@anysearch-cli/retriever": "workspace:*",
      "@anysearch-cli/store": "workspace:*",
    },
    peerDependencies: { "@anysearch-cli/embedding": "workspace:*" },
  },
  "apps/cli": {
    name: "@anysearch-cli/cli",
    devDependencies: {
      "@anysearch-cli/kernel": "workspace:*",
      "@anysearch-cli/mcp": "workspace:*",
      "@anysearch-cli/plugin": "workspace:*",
      "@anysearch-cli/retriever": "workspace:*",
      "@anysearch-cli/store": "workspace:*",
    },
    peerDependencies: { "@anysearch-cli/embedding": "workspace:*" },
  },
  "apps/mcp": {
    name: "@anysearch-cli/mcp",
    devDependencies: {
      "@anysearch-cli/kernel": "workspace:*",
      "@anysearch-cli/plugin": "workspace:*",
      "@anysearch-cli/retriever": "workspace:*",
      "@anysearch-cli/store": "workspace:*",
    },
    peerDependencies: { "@anysearch-cli/embedding": "workspace:*" },
  },
  "apps/dsh-plugin": {
    name: "@anysearch-cli/dsh-plugin",
    devDependencies: { "@anysearch-cli/kernel": "workspace:*", "@anysearch-cli/plugin": "workspace:*" },
  },
};

let root;
before(() => {
  root = mkdtempSync(join(tmpdir(), "ans-preflight-plan-"));
  write(root, "pnpm-workspace.yaml", 'packages:\n  - "apps/*"\n  - "packages/*"\n');
  for (const [dir, manifest] of Object.entries(MANIFESTS)) {
    write(root, `${dir}/package.json`, JSON.stringify({ private: true, ...manifest }, null, 2));
  }
});
after(() => rmSync(root, { recursive: true, force: true }));

test("a lower package runs itself and every app that depends on it", () => {
  const plan = planPreflight(root, ["packages/retriever/src/search.ts"]);
  assert.equal(plan.mode, "incremental");
  assert.deepEqual(plan.packages, [
    "@anysearch-cli/cli",
    "@anysearch-cli/dsh-plugin",
    "@anysearch-cli/kernel",
    "@anysearch-cli/mcp",
    "@anysearch-cli/plugin",
    "@anysearch-cli/retriever",
    "@anysearch-cli/store",
  ]);
});

test("a change in embedding reaches store, kernel, plugin and the apps", () => {
  const plan = planPreflight(root, ["packages/embedding/src/model.ts"]);
  assert.equal(plan.mode, "incremental");
  assert.deepEqual(plan.packages, [
    "@anysearch-cli/cli",
    "@anysearch-cli/dsh-plugin",
    "@anysearch-cli/embedding",
    "@anysearch-cli/kernel",
    "@anysearch-cli/mcp",
    "@anysearch-cli/plugin",
    "@anysearch-cli/store",
  ]);
});

test("one app runs that app alone, not the apps that do not use it", () => {
  const plan = planPreflight(root, ["apps/dsh-plugin/src/index.ts"]);
  assert.equal(plan.mode, "incremental");
  assert.deepEqual(plan.packages, ["@anysearch-cli/dsh-plugin"]);
  assert.ok(!plan.packages.includes("@anysearch-cli/cli"));
  assert.ok(!plan.packages.includes("@anysearch-cli/mcp"));
});

test("an mcp change also runs cli, whose product build bundles mcp source", () => {
  const plan = planPreflight(root, ["apps/mcp/src/index.ts"]);
  assert.equal(plan.mode, "incremental");
  assert.deepEqual(plan.packages, ["@anysearch-cli/cli", "@anysearch-cli/mcp"]);
});

test("windows separators name the same package", () => {
  const plan = planPreflight(root, ["packages\\retriever\\src\\search.ts"]);
  assert.equal(plan.mode, "incremental");
  assert.equal(plan.packages.length, 7);
});

// The reader table names a root file's readers instead of the whole suite.
test("a root file runs the packages whose tests read it, and stops there", () => {
  // kernel depends on store, and this file is read by store's tests alone: a
  // dependent cannot see it through the reader's tests, so it does not run.
  const coverage = planPreflight(root, ["eval-looks.coverage.json"]);
  assert.equal(coverage.mode, "readers");
  assert.deepEqual(coverage.packages, ["@anysearch-cli/store"]);

  for (const [files, rows] of [
    [["domains/docs.toml"], ["domains"]],
    [["domains/research.toml", "domains/default.toml"], ["domains"]],
    [["eval-looks.json"], ["eval-looks.json"]],
    [["eval-badcases.json"], ["eval-badcases.json"]],
    [["eval-looks.json", "eval-looks.coverage.json"], ["eval-looks.json", "eval-looks.coverage.json"]],
    // Store's docs-golden test asserts this one resolves on disk; nothing reads
    // the prose, so store is the whole run.
    [["AGENTS.md"], ["AGENTS.md"]],
  ]) {
    const plan = planPreflight(root, files);
    const readers = [...new Set(rows.flatMap((row) => EXPECTED_ROOT_READERS[row]))].sort();
    assert.equal(plan.mode, "readers", files.join(","));
    assert.deepEqual(plan.packages, readers, files.join(","));
  }
});

// Everything the table does not name keeps the unowned fallback: the lockfile,
// the build config, CI's own files, scripts/, .gitignore (it changes what git
// sees for every package) and a domains file that is not a TOML the loader reads.
test("a root file outside the reader table still runs the full suite", () => {
  for (const file of [
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "package.json",
    "turbo.json",
    "codecov.yml",
    ".npmrc",
    ".gitignore",
    "LICENSE",
    "scripts/preflight-test.mjs",
    ".github/workflows/ci.yml",
    // hypothetical: domains/ holds only TOML today, so a non-TOML file dropped
    // there is outside the row's ext and keeps the fallback.
    "domains/schema.json",
  ]) {
    const plan = planPreflight(root, [file]);
    assert.equal(plan.mode, "full", file);
    assert.deepEqual(plan.outside, [file], file);
  }
});

test("a root file change next to a package change runs both", () => {
  const plan = planPreflight(root, ["domains/docs.toml", "apps/dsh-plugin/src/index.ts"]);
  assert.equal(plan.mode, "incremental");
  assert.deepEqual(plan.readers, EXPECTED_ROOT_READERS.domains);
  assert.deepEqual(plan.touched, ["@anysearch-cli/dsh-plugin"]);
  assert.deepEqual(
    plan.packages,
    [...EXPECTED_ROOT_READERS.domains, "@anysearch-cli/dsh-plugin"].sort(),
  );
});

test("docs next to a root file run the readers, not the suite", () => {
  const plan = planPreflight(root, ["eval-looks.json", "README.md"]);
  assert.equal(plan.mode, "readers");
  assert.deepEqual(plan.packages, ["@anysearch-cli/kernel", "@anysearch-cli/store"]);
});

test("a root file whose reader is gone runs the full suite, never nothing", () => {
  const dir = mkdtempSync(join(tmpdir(), "ans-preflight-missing-reader-"));
  try {
    write(dir, "pnpm-workspace.yaml", 'packages:\n  - "packages/*"\n');
    write(dir, "packages/store/package.json", JSON.stringify({ name: "@anysearch-cli/store" }));
    // A renamed package would filter turbo down to no task and still exit 0,
    // which reads as green: say which name is missing and run everything.
    const plan = planPreflight(dir, ["eval-looks.json"]);
    assert.equal(plan.mode, "full");
    assert.equal(plan.reason, "no workspace package named: @anysearch-cli/kernel");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a package change next to a root change still runs everything", () => {
  const plan = planPreflight(root, ["apps/mcp/src/index.ts", "scripts/hooks/pre-push-user"]);
  assert.equal(plan.mode, "full");
  assert.deepEqual(plan.outside, ["scripts/hooks/pre-push-user"]);
});

test("a file outside the packages falls back to the full suite", () => {
  assert.equal(planPreflight(root, ["providers/exa/probe.mjs"]).mode, "full");
});

test("the doc boundary is docs/ except docs/eval/, plus the four root markdown files", () => {
  for (const file of [
    "docs/limitations.md",
    "docs/assets/readme/hero.png",
    "README.md",
    "README.zh-CN.md",
    "GLOSSARY.md",
    "CHANGELOG.md",
  ]) {
    assert.equal(isDocumentation(file), true, file);
  }

  for (const file of [
    "apps/plugin/AGENTS.md",
    "apps/plugin/README.md",
    "domains/docs.toml",
    ".github/workflows/ci.yml",
    "docs/eval/ip-corpus-probe-2026-11-07.md",
    "docs/eval/quarantine-audit-2026-09-12.md",
    "docs-tools/check.mjs",
    "docs",
    "README.md.bak",
  ]) {
    assert.equal(isDocumentation(file), false, file);
  }
});

test("docsOnly needs at least one file and every file inside the boundary", () => {
  assert.equal(docsOnly(["README.md"]), true);
  assert.equal(docsOnly(["docs/a.md", "CHANGELOG.md"]), true);
  assert.equal(docsOnly(["docs/a.md", "apps/plugin/AGENTS.md"]), false);
  assert.equal(docsOnly([]), false);
});

test("separators and ./- prefixes do not escape the boundary", () => {
  assert.equal(docsOnly([".\\docs\\a.md"]), true);
  assert.equal(docsOnly(["./apps/plugin/AGENTS.md"]), false);
});

test("codeOwnership keeps docs out of the unowned list", () => {
  // If a docs file counted as unowned, a doc next to a package change would
  // run the whole suite.
  const { touched, unowned } = codeOwnership(
    ["apps/dsh-plugin/src/index.ts", "docs/limitations.md", "turbo.json"],
    readWorkspace(root),
  );
  assert.deepEqual(touched, ["@anysearch-cli/dsh-plugin"]);
  assert.deepEqual(unowned, ["turbo.json"]);
});

test("a change that is all documentation runs nothing", () => {
  for (const files of [
    ["docs/limitations.md"],
    ["README.md", "CHANGELOG.md", "docs/assets/readme/hero.png"],
    ["docs/agents/issue-tracker.md", "GLOSSARY.md"],
    ["docs\\limitations.md"],
  ]) {
    const plan = planPreflight(root, files);
    assert.equal(plan.mode, "docs", files.join(","));
    assert.deepEqual(plan.packages, []);
    assert.equal(plan.reason, "documentation only");
  }
});

test("docs next to a package change run that package, not the whole suite", () => {
  const plan = planPreflight(root, ["apps/dsh-plugin/src/index.ts", "docs/limitations.md", "README.md"]);
  assert.equal(plan.mode, "incremental");
  assert.deepEqual(plan.packages, ["@anysearch-cli/dsh-plugin"]);
  assert.deepEqual(plan.touched, ["@anysearch-cli/dsh-plugin"]);
});

test("docs next to a root file outside the table still run the whole suite, and the docs are not the reason", () => {
  const plan = planPreflight(root, ["README.md", "turbo.json"]);
  assert.equal(plan.mode, "full");
  assert.deepEqual(plan.outside, ["turbo.json"]);
});

// The boundary is CI's, so the exclusions matter here too: a product asset and
// docs/eval are read by tests and must not buy a skipped run.
test("a product asset runs its readers, and docs/eval/ still runs the suite", () => {
  // The readers run, not just the owner: plugin's own tests plus every app
  // that depends on it.
  const asset = planPreflight(root, ["apps/plugin/AGENTS.md"]);
  assert.equal(asset.mode, "incremental");
  assert.deepEqual(asset.packages, [
    "@anysearch-cli/cli",
    "@anysearch-cli/dsh-plugin",
    "@anysearch-cli/mcp",
    "@anysearch-cli/plugin",
  ]);
  // domains/ is not documentation either: it is the reader table's file (#489).
  assert.equal(planPreflight(root, ["domains/docs.toml"]).mode, "readers");
  assert.equal(planPreflight(root, ["docs/eval/ip-corpus-probe.md"]).mode, "full");
});

test("--full still runs everything on a docs-only change", () => {
  assert.equal(planPreflight(root, ["docs/limitations.md"], { forceFull: true }).mode, "full");
});

test("no change runs nothing", () => {
  const plan = planPreflight(root, []);
  assert.equal(plan.mode, "none");
  assert.deepEqual(plan.packages, []);
});

test("--full wins even when only one package changed", () => {
  assert.equal(planPreflight(root, ["apps/mcp/src/index.ts"], { forceFull: true }).mode, "full");
});

test("the real workspace: a retriever change selects all four apps", () => {
  const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const plan = planPreflight(repo, ["packages/retriever/package.json"]);
  assert.equal(plan.mode, "incremental");
  // Direction only: a new package in the real graph must not turn this red.
  for (const app of ["@anysearch-cli/cli", "@anysearch-cli/dsh-plugin", "@anysearch-cli/mcp", "@anysearch-cli/plugin"]) {
    assert.ok(plan.packages.includes(app), app);
  }
});

test("the real workspace: an mcp change runs cli, which bundles mcp source", () => {
  const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const plan = planPreflight(repo, ["apps/mcp/src/index.ts"]);
  assert.equal(plan.mode, "incremental");
  assert.ok(plan.packages.includes("@anysearch-cli/cli"));
});

// The table is hand-written, so this is what keeps it honest: every reader it
// names is a package the workspace still has, every path is a file that still
// exists, every row's list is exact, and the one non-obvious claim (store reads
// AGENTS.md) still has its anchor in the data it reads. The exact lists pin
// today's answers, so widening the table means touching this test on purpose.
test("the real workspace: every reader in the table exists, and domains runs only them", () => {
  const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const names = new Set(readWorkspace(repo).map((pkg) => pkg.name));
  for (const entry of ROOT_READERS) {
    assert.ok(existsSync(join(repo, entry.path)), `the table names a root file that is gone: ${entry.path}`);
    for (const reader of entry.readers) {
      assert.ok(names.has(reader), `${entry.path} names ${reader}, which is not a workspace package`);
    }
  }
  const sortedRows = (rows) =>
    Object.fromEntries(Object.entries(rows).map(([path, list]) => [path, [...list].sort()]));
  assert.deepEqual(
    sortedRows(Object.fromEntries(ROOT_READERS.map((entry) => [entry.path, entry.readers]))),
    sortedRows(EXPECTED_ROOT_READERS),
    "ROOT_READERS and scripts/test/preflight-root-readers.mjs disagree",
  );
  const plan = planPreflight(repo, ["domains/docs.toml"]);
  assert.equal(plan.mode, "readers");
  // cli's doctor test resolves the default domain through the repo-root
  // fallback and asserts the [skills] active list it finds there.
  assert.deepEqual(plan.packages, EXPECTED_ROOT_READERS.domains);
  assert.deepEqual(planPreflight(repo, ["AGENTS.md"]).packages, EXPECTED_ROOT_READERS["AGENTS.md"]);
  // That row rests on a golden entry anchoring on the file: without the anchor,
  // store would have no reason to run and the row should go with it.
  const looks = JSON.parse(readFileSync(join(repo, "eval-looks.json"), "utf8"));
  assert.ok(
    looks.golden.entries.some((entry) => entry.provenance?.ref === "AGENTS.md"),
    "no golden entry anchors on AGENTS.md any more; drop that row from ROOT_READERS",
  );
});

test("the workspace reader picks up both directions of the dependency graph", () => {
  const packages = readWorkspace(root);
  assert.equal(packages.length, 8);
  assert.deepEqual(
    packages.find((pkg) => pkg.name === "@anysearch-cli/cli").deps,
    [
      "@anysearch-cli/embedding",
      "@anysearch-cli/kernel",
      "@anysearch-cli/mcp",
      "@anysearch-cli/plugin",
      "@anysearch-cli/retriever",
      "@anysearch-cli/store",
    ],
  );
  assert.deepEqual(packages.find((pkg) => pkg.name === "@anysearch-cli/embedding").deps, []);
});

test("a workspace with no pnpm-workspace.yaml falls back to the full suite", () => {
  const dir = mkdtempSync(join(tmpdir(), "ans-preflight-empty-"));
  try {
    assert.deepEqual(readWorkspace(dir), []);
    const plan = planPreflight(dir, ["apps/mcp/src/index.ts"]);
    assert.equal(plan.mode, "full");
    assert.equal(plan.reason, "no workspace packages found");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an unreadable pnpm-workspace.yaml reads as no workspace, not a crash", () => {
  const dir = mkdtempSync(join(tmpdir(), "ans-preflight-unreadable-"));
  try {
    // A directory where the file belongs: reading it throws, which must not escape.
    mkdirSync(join(dir, "pnpm-workspace.yaml"));
    assert.deepEqual(readWorkspace(dir), []);
    assert.equal(planPreflight(dir, ["apps/mcp/src/index.ts"]).mode, "full");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a workspace: alias dependency names the package it points at", () => {
  const dir = mkdtempSync(join(tmpdir(), "ans-preflight-alias-"));
  try {
    write(dir, "pnpm-workspace.yaml", 'packages:\n  - "packages/*"\n');
    write(dir, "packages/real/package.json", JSON.stringify({ name: "@anysearch-cli/real" }));
    write(
      dir,
      "packages/alias/package.json",
      JSON.stringify({
        name: "@anysearch-cli/alias",
        dependencies: { "local-alias": "workspace:@anysearch-cli/real@*" },
      }),
    );
    const packages = readWorkspace(dir);
    assert.deepEqual(packages.find((pkg) => pkg.name === "@anysearch-cli/alias").deps, ["@anysearch-cli/real"]);
    // The alias points at the real package, so changing real runs alias too.
    assert.deepEqual(planPreflight(dir, ["packages/real/src/index.ts"]).touched, ["@anysearch-cli/real"]);
    const plan = planPreflight(dir, ["packages/real/src/index.ts"]);
    assert.deepEqual(plan.packages, ["@anysearch-cli/alias", "@anysearch-cli/real"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a broken package manifest sends the gate to the full suite", () => {
  const dir = mkdtempSync(join(tmpdir(), "ans-preflight-broken-"));
  try {
    write(dir, "pnpm-workspace.yaml", 'packages:\n  - "apps/*"\n');
    write(dir, "apps/dsh-plugin/package.json", "{ not json");
    assert.equal(readWorkspace(dir), null);
    const plan = planPreflight(dir, ["apps/dsh-plugin/src/index.ts"]);
    assert.equal(plan.mode, "full");
    assert.equal(plan.reason, "workspace unreadable");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a package.json that is a directory sends the gate to the full suite", () => {
  const dir = mkdtempSync(join(tmpdir(), "ans-preflight-eisdir-"));
  try {
    write(dir, "pnpm-workspace.yaml", 'packages:\n  - "apps/*"\n');
    mkdirSync(join(dir, "apps", "dsh-plugin", "package.json"), { recursive: true });
    assert.equal(readWorkspace(dir), null);
    assert.equal(planPreflight(dir, ["apps/dsh-plugin/src/index.ts"]).reason, "workspace unreadable");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a directory with no package.json is not a package", () => {
  const dir = mkdtempSync(join(tmpdir(), "ans-preflight-nopkg-"));
  try {
    write(dir, "pnpm-workspace.yaml", 'packages:\n  - "apps/*"\n  - "tools/cli"\n');
    write(dir, "apps/real/package.json", JSON.stringify({ name: "@anysearch-cli/real" }));
    mkdirSync(join(dir, "tools", "cli"), { recursive: true });
    assert.deepEqual(
      readWorkspace(dir).map((pkg) => pkg.name),
      ["@anysearch-cli/real"],
    );
    // The workspace is readable and has a package, so this lands on the
    // "file belongs to no package" branch rather than "no packages found".
    const plan = planPreflight(dir, ["tools/cli/src/index.ts"]);
    assert.equal(plan.mode, "full");
    assert.equal(plan.reason, "files outside the workspace packages");
    assert.deepEqual(plan.outside, ["tools/cli/src/index.ts"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a manifest without a name is not a package, and a change under it runs everything", () => {
  const dir = mkdtempSync(join(tmpdir(), "ans-preflight-nameless-"));
  try {
    write(dir, "pnpm-workspace.yaml", 'packages:\n  - "apps/*"\n');
    write(dir, "apps/real/package.json", JSON.stringify({ name: "@anysearch-cli/real" }));
    write(dir, "apps/nameless/package.json", JSON.stringify({ private: true }));
    assert.deepEqual(
      readWorkspace(dir).map((pkg) => pkg.name),
      ["@anysearch-cli/real"],
    );
    const plan = planPreflight(dir, ["apps/nameless/src/index.ts"]);
    assert.equal(plan.mode, "full");
    // The path is inside apps/, so the reason has to name the nameless manifest
    // rather than say the file is outside the workspace.
    assert.equal(plan.reason, "files under a directory whose package.json has no name");
    // The named package next to it still runs incrementally.
    const named = planPreflight(dir, ["apps/real/src/index.ts"]);
    assert.equal(named.mode, "incremental");
    assert.deepEqual(named.packages, ["@anysearch-cli/real"]);
    // A root file mixed in is not explained by the nameless directory, so the
    // reason stays the general one.
    const mixed = planPreflight(dir, ["apps/nameless/src/index.ts", "turbo.json"]);
    assert.equal(mixed.reason, "files outside the workspace packages");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a workspace whose every manifest has no name says so", () => {
  const dir = mkdtempSync(join(tmpdir(), "ans-preflight-all-nameless-"));
  try {
    write(dir, "pnpm-workspace.yaml", 'packages:\n  - "apps/*"\n');
    write(dir, "apps/one/package.json", JSON.stringify({ private: true }));
    write(dir, "apps/two/package.json", JSON.stringify({ private: true }));
    assert.deepEqual(readWorkspace(dir), []);
    const plan = planPreflight(dir, ["apps/one/src/index.ts"]);
    assert.equal(plan.mode, "full");
    // "no workspace packages found" alone would hide the nameless manifests;
    // the reason names the directories so nobody has to grep for them.
    assert.equal(plan.reason, "no workspace packages found; package.json without a name in: apps/one, apps/two");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function write(dir, file, content) {
  const target = join(dir, file);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}
