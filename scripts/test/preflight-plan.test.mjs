import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test, { after, before } from "node:test";
import { planPreflight, readWorkspace } from "../preflight-plan.mjs";

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

test("a root file falls back to the full suite", () => {
  for (const file of ["turbo.json", "pnpm-workspace.yaml", "scripts/preflight-test.mjs", ".github/workflows/ci.yml"]) {
    assert.equal(planPreflight(root, [file]).mode, "full", file);
  }
});

test("a package change next to a root change still runs everything", () => {
  const plan = planPreflight(root, ["apps/mcp/src/index.ts", "scripts/hooks/pre-push-user"]);
  assert.equal(plan.mode, "full");
  assert.deepEqual(plan.outside, ["scripts/hooks/pre-push-user"]);
});

test("a file outside the packages falls back to the full suite", () => {
  assert.equal(planPreflight(root, ["docs/limitations.md"]).mode, "full");
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
