import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { after, before } from "node:test";
import { failedTask, planPreflight, readWorkspace } from "../preflight-plan.mjs";

// The same shape as the real workspace: four apps on top, three shared
// packages below, embedding standing alone.
const MANIFESTS = {
  "packages/embedding": { name: "@anysearch-cli/embedding" },
  "packages/retriever": { name: "@anysearch-cli/retriever" },
  "packages/store": {
    name: "@anysearch-cli/store",
    dependencies: { "@anysearch-cli/retriever": "workspace:*" },
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
  },
  "apps/cli": {
    name: "@anysearch-cli/cli",
    devDependencies: {
      "@anysearch-cli/kernel": "workspace:*",
      "@anysearch-cli/plugin": "workspace:*",
      "@anysearch-cli/retriever": "workspace:*",
      "@anysearch-cli/store": "workspace:*",
    },
  },
  "apps/mcp": {
    name: "@anysearch-cli/mcp",
    devDependencies: {
      "@anysearch-cli/kernel": "workspace:*",
      "@anysearch-cli/plugin": "workspace:*",
      "@anysearch-cli/retriever": "workspace:*",
      "@anysearch-cli/store": "workspace:*",
    },
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

test("one app runs that app alone, not the apps that do not use it", () => {
  const plan = planPreflight(root, ["apps/mcp/src/index.ts"]);
  assert.equal(plan.mode, "incremental");
  assert.deepEqual(plan.packages, ["@anysearch-cli/mcp"]);
  assert.ok(!plan.packages.includes("@anysearch-cli/cli"));
  assert.ok(!plan.packages.includes("@anysearch-cli/dsh-plugin"));
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

test("the workspace reader picks up both directions of the dependency graph", () => {
  const packages = readWorkspace(root);
  assert.equal(packages.length, 8);
  assert.deepEqual(
    packages.find((pkg) => pkg.name === "@anysearch-cli/cli").deps,
    ["@anysearch-cli/kernel", "@anysearch-cli/plugin", "@anysearch-cli/retriever", "@anysearch-cli/store"],
  );
  assert.deepEqual(packages.find((pkg) => pkg.name === "@anysearch-cli/embedding").deps, []);
});

test("the red task is read from turbo's summary", () => {
  assert.equal(failedTask(" Tasks:    1 successful, 2 total\nFailed:    @anysearch-cli/kernel#test\n"), "@anysearch-cli/kernel#test");
  assert.equal(failedTask("\u001b[31mFailed:\u001b[0m @anysearch-cli/cli#test"), "@anysearch-cli/cli#test");
  assert.equal(failedTask("ERROR run failed: command exited (1)"), null);
});

function write(dir, file, content) {
  const target = join(dir, file);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}
