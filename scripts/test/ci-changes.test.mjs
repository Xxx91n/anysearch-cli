import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { LANES, docsOnly, isDocumentation, lanesForChange, planLanes } from "../ci-changes.mjs";
import { resolveYaml } from "../check-workflows.mjs";
import { readWorkspace } from "../preflight-plan.mjs";

const CLI = fileURLToPath(new URL("../ci-changes.mjs", import.meta.url));
const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const WORKSPACE = readWorkspace(ROOT);
const ALL_LANES = Object.keys(LANES);
// Every lane that cares about an app or store: everything except the
// retriever-only live probe.
const ALL_APP_LANES = ALL_LANES.filter((lane) => lane !== "test-online-anysearch");
const DSH_LANES = ["check-build", "coverage", "ship-gate"];
const APP_LANES = ["check-build", "install-smoke", "coverage", "ship-gate", "macos-spillover-probe"];
const PLUGIN_LANES = ["check-build", "spaced-path", "install-smoke", "coverage", "ship-gate", "macos-spillover-probe"];

test("the workspace is readable", () => {
  assert.ok(Array.isArray(WORKSPACE) && WORKSPACE.length > 0, "workspace unreadable; lane tests cannot run");
});

function lanes(files) {
  return lanesForChange(files, WORKSPACE);
}

function assertLanes(actual, expected, label = "") {
  assert.deepEqual([...actual].sort(), [...expected].sort(), label);
}

function githubOutput(files, args = [], { separator = "\0", cwd = ROOT } = {}) {
  const result = spawnSync(process.execPath, [CLI, "--github", ...args], {
    input: files.join(separator),
    encoding: "utf8",
    cwd,
  });
  assert.equal(result.status, 0, result.stderr);
  const lines = result.stdout.trim().split("\n");
  const pairs = lines.map((line) => {
    const at = line.indexOf("=");
    return at < 0 ? [line, ""] : [line.slice(0, at), line.slice(at + 1)];
  });
  return Object.fromEntries(pairs);
}

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

test("lane declarations are manifest names, one list per lane, not paths", () => {
  const names = new Set(WORKSPACE.map((pkg) => pkg.name));
  for (const [lane, packages] of Object.entries(LANES)) {
    assert.ok(packages.length > 0, lane);
    for (const pkg of packages) {
      assert.equal(/^(apps|packages)\//.test(pkg), false, `${lane}: ${pkg} is a path, not a name`);
      assert.equal(names.has(pkg), true, `${lane}: unknown package ${pkg}`);
    }
  }
});

test("every workspace package is declared by at least one lane", () => {
  const declared = new Set(Object.values(LANES).flat());
  for (const pkg of WORKSPACE) assert.equal(declared.has(pkg.name), true, pkg.name);
});

test("the full-suite lanes name every workspace package", () => {
  // A new package must run its own tests even if only a narrow lane names it.
  for (const lane of ["check-build", "coverage", "ship-gate"]) {
    const declared = new Set(LANES[lane]);
    for (const pkg of WORKSPACE) assert.equal(declared.has(pkg.name), true, `${lane}: ${pkg.name}`);
  }
});

test("changing one app runs only the lanes that exercise it", () => {
  // cli depends on mcp (it packages it), so mcp and cli land in the same lanes.
  for (const file of ["apps/mcp/src/index.ts", "apps/cli/src/index.ts"]) {
    assertLanes(lanes([file]), APP_LANES, file);
  }
  // dsh-plugin has no dependents; only the full-suite lanes pick it up.
  assertLanes(lanes(["apps/dsh-plugin/src/index.ts"]), DSH_LANES);
});

test("plugin and kernel changes pin the spaced-path lane", () => {
  for (const file of ["apps/plugin/src/index.ts", "packages/kernel/src/index.ts"]) {
    assertLanes(lanes([file]), PLUGIN_LANES, file);
  }
});

test("embedding is exercised by install-smoke, which packs the peer package", () => {
  // store and the apps name embedding as a workspace peerDependency, so it also
  // lands in the native/eval lanes; install-smoke packs it for the peer leg.
  assertLanes(lanes(["packages/embedding/src/index.ts"]), ALL_APP_LANES);
});

test("changing retriever runs every lane", () => {
  // retriever reaches seven of the eight packages, so every lane matches;
  // there is nothing to save here.
  assertLanes(lanes(["packages/retriever/src/rrf.ts"]), ALL_LANES);
});

test("a package change selects its dependents, not its own dependencies", () => {
  // store depends on retriever; a store change must not pull in retriever's
  // live probe, but it must pull in every app that consumes store.
  assertLanes(lanes(["packages/store/src/db.ts"]), ALL_APP_LANES);
});

test("root files run every lane; an unknown unowned path does too", () => {
  for (const file of [
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "package.json",
    "turbo.json",
    "eval-looks.json",
    "domains/docs.toml",
    "scripts/check-workflows.mjs",
    "docs/eval/ip-corpus-probe-2026-11-07.md",
    ".github/workflows/ci.yml",
  ]) {
    assertLanes(lanes([file]), ALL_LANES, file);
  }
  assertLanes(lanes(["LICENSE"]), ALL_LANES);
});

test("docs-only changes run no lane; an empty or unreadable change runs every lane", () => {
  assertLanes(lanes(["README.md", "docs/limitations.md"]), []);
  assertLanes(lanesForChange([], WORKSPACE), ALL_LANES);
  assertLanes(lanesForChange(["apps/mcp/src/index.ts"], null), ALL_LANES);
  assertLanes(lanesForChange(["apps/mcp/src/index.ts"], []), ALL_LANES);
  assert.equal(planLanes(["apps/mcp/src/index.ts"], null).reason, "workspace unreadable");
});

test("a fallback reason stays on one printable line and says how many were cut", () => {
  const plan = planLanes(["apps/dsh-plugin/src/index.ts", "bad\nname.ts"], WORKSPACE);
  assert.equal(plan.reason, "unowned path: bad?name.ts");
  assert.equal(plan.reason.includes("\n"), false);

  const many = planLanes(["apps/dsh-plugin/src/index.ts", "a1", "a2", "a3", "a4", "a5"], WORKSPACE);
  assert.equal(many.reason, "unowned path: a1, a2, a3 (+2 more)");

  const injected = planLanes(["apps/dsh-plugin/src/index.ts", "![x](https://e/x)"], WORKSPACE).reason;
  assert.equal(/[\[\]()!<>`]/.test(injected), false);
});

test("a code+docs change selects on the code; docs/eval is still unowned", () => {
  assertLanes(lanes(["apps/dsh-plugin/src/index.ts", "README.md", "docs/limitations.md"]), DSH_LANES);
  assertLanes(lanes(["apps/dsh-plugin/src/index.ts", "pnpm-lock.yaml"]), ALL_LANES);
  assertLanes(lanes(["apps/dsh-plugin/src/index.ts", "docs/eval/x.md"]), ALL_LANES);
});

test("a package or app no lane names runs every lane, never none", () => {
  // A new package is exactly when the full-suite lanes matter most; skipping
  // them hides the breakage.
  const extended = [
    ...WORKSPACE,
    { name: "@anysearch-cli/newpkg", dir: "packages/newpkg", deps: [] },
    { name: "@anysearch-cli/newapp", dir: "apps/newapp", deps: [] },
  ];
  for (const file of ["packages/newpkg/src/index.ts", "apps/newapp/src/index.ts"]) {
    assertLanes(lanesForChange([file], extended), ALL_LANES, file);
  }
  // A known app in the same change set must not hide the new package.
  assert.deepEqual(
    lanesForChange(["apps/dsh-plugin/src/index.ts", "packages/newpkg/src/index.ts"], extended),
    ALL_LANES,
  );
  assert.equal(
    planLanes(["packages/newpkg/src/index.ts"], extended).reason,
    "no lane names: @anysearch-cli/newpkg",
  );
});

test("the action outputs and workflow references stay in sync with LANES", () => {
  // The guard must fail, not skip: a missing parser would silently turn it off.
  const YAML = resolveYaml(ROOT);
  assert.ok(YAML, "yaml parser missing; the lane sync guard cannot run");

  const action = YAML.parse(
    readFileSync(new URL("../../.github/actions/setup/action.yml", import.meta.url), "utf8"),
  );
  const declared = Object.keys(action.outputs ?? {})
    .filter((key) => key.startsWith("run-"))
    .map((key) => key.slice("run-".length));
  assert.deepEqual([...declared].sort(), Object.keys(LANES).sort());
  for (const lane of ALL_LANES) {
    const output = action.outputs[`run-${lane}`];
    assert.equal(
      String(output.value).replace(/\s+/g, ""),
      "${{steps.changes.outputs.run-" + lane + "}}",
      lane,
    );
  }
  assert.equal(
    String(action.outputs["docs-only"].value).replace(/\s+/g, ""),
    "${{steps.changes.outputs.docs-only}}",
  );

  const workflowDir = new URL("../../.github/workflows/", import.meta.url);
  const referenced = new Set();
  for (const file of readdirSync(workflowDir).filter((name) => /\.ya?ml$/i.test(name))) {
    const text = readFileSync(new URL(file, workflowDir), "utf8");
    const code = text.split(/\r?\n/).filter((line) => !/^\s*#/.test(line)).join("\n");
    const rawRefs = [...code.matchAll(/steps\.setup\.outputs\.run-[a-z-]+/g)].map((m) => m[0]);
    const matches = [
      ...code.matchAll(/steps\.setup\.outputs\.(run-[a-z-]+)\s*(!=|==)\s*'([^']+)'/g),
    ];
    // Conditions must compare `!= 'false'`; `== 'true'` skips the lane when the
    // flag is missing, which is the bug to prevent.
    const checked = new Set(matches.map((m) => m[1]));
    assert.equal(
      rawRefs.length,
      matches.length,
      `${file}: unparsed lane reference: ${rawRefs.find((ref) => !checked.has(ref)) ?? ""}`,
    );
    for (const match of matches) {
      const lane = match[1].slice("run-".length);
      assert.equal(match[2], "!=", `${file}: ${lane} must use !=`);
      assert.equal(match[3], "false", `${file}: ${lane} must compare to false`);
      referenced.add(lane);
    }
  }
  for (const lane of referenced) assert.equal(LANES[lane] !== undefined, true, lane);
  // The other direction: a declared lane that no workflow reads never runs.
  for (const lane of ALL_LANES) assert.equal(referenced.has(lane), true, lane);
});

test("the --github entry accepts NUL and newline paths from any cwd", () => {
  const two = ["apps/mcp/src/index.ts", "packages/retriever/src/rrf.ts"];
  assert.deepEqual(githubOutput(two), githubOutput(two, [], { separator: "\n" }));
  assert.equal(githubOutput(["README.md"], [], { cwd: os.tmpdir() })["docs-only"], "true");
});

test("the --github entry emits one run flag per lane and fails open", () => {
  const picked = githubOutput(["apps/mcp/src/index.ts"]);
  const expected = new Set(lanes(["apps/mcp/src/index.ts"]));
  assert.equal(picked["docs-only"], "false");
  assert.equal(picked.reason, undefined);
  for (const lane of ALL_LANES) {
    assert.equal(picked[`run-${lane}`], expected.has(lane) ? "true" : "false", lane);
  }

  const docs = githubOutput(["README.md"]);
  assert.equal(docs["docs-only"], "true");
  assert.equal(docs.reason, undefined);
  for (const lane of ALL_LANES) assert.equal(docs[`run-${lane}`], "false", lane);

  const forced = githubOutput([], ["--all"]);
  assert.equal(forced["docs-only"], "false");
  assert.equal(forced.reason, undefined);
  for (const lane of ALL_LANES) assert.equal(forced[`run-${lane}`], "true", lane);

  assert.equal(githubOutput(["pnpm-workspace.yaml"]).reason, "unowned path: pnpm-workspace.yaml");
  assert.equal(githubOutput(["bad=name.ts"]).reason, "unowned path: bad?name.ts");
  assert.equal(githubOutput([]).reason, "empty change set");
});
