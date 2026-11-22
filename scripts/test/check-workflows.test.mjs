import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  checkLocalActionRefs,
  classifyLocalUsesRef,
  discoverAllLocalActions,
  findLocalActionRefs,
  structuralCheck,
} from "../check-workflows.mjs";

function withTempRepo(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ans-check-workflows-"));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function writeFile(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf8");
}

test("structuralCheck skips quotes after blank lines inside `- run: |` and catches broken sibling keys", () => {
  const valid = [
    "name: t",
    "on: push",
    "jobs:",
    "  a:",
    "    steps:",
    "      - run: |",
    "          echo start",
    "",
    "          echo \"it's fine\"",
  ].join("\n");
  assert.deepEqual(structuralCheck(valid).problems, []);

  const brokenSibling = [
    "name: t",
    "on: push",
    "jobs:",
    "  a:",
    "    steps:",
    "      - run: |",
    "          echo ok",
    "        if: \"unclosed",
  ].join("\n");
  assert.ok(
    structuralCheck(brokenSibling).problems.some((p) => p.includes('unbalanced " quote')),
    "broken quote on sibling field after `- run: |` must be caught",
  );
});

test("structuralCheck records top-level block scalar keys such as `description: |`", () => {
  const action = [
    "name: my-action",
    "description: |",
    "  first line",
    "",
    "  second line",
    "runs:",
    "  using: composite",
    "  steps: []",
  ].join("\n");
  const { problems, topKeys } = structuralCheck(action);
  assert.deepEqual(problems, []);
  assert.deepEqual(topKeys, ["name", "description", "runs"]);
});

test("findLocalActionRefs finds sibling uses after `- name: |`, handles quoted spaces, and ignores block scalars", () => {
  const yml = [
    "jobs:",
    "  a:",
    "    steps:",
    "      - name: |",
    "          Setup step",
    "        uses: ./custom-action",
    "      - uses: \"./my actions/setup\" # inline note",
    "      # - uses: ./commented-out",
    "      - run: |",
    "          uses: ./inside-shell",
  ].join("\n");
  assert.deepEqual(
    findLocalActionRefs(yml).map((r) => r.ref),
    ["./custom-action", "./my actions/setup"],
  );
});

test("classifyLocalUsesRef enforces repo bounds, direct workflow files, action directories, and forward slashes", () => {
  withTempRepo((root) => {
    writeFile(root, ".github/workflows/ci.yml", "name: ci\non: push\njobs: {}\n");
    writeFile(root, ".github/workflows/sub/nested.yml", "name: n\non: push\njobs: {}\n");
    writeFile(root, ".github/actions/setup/action.yml", "name: s\ndescription: s\nruns:\n  using: composite\n  steps: []\n");

    const okAction = classifyLocalUsesRef("./.github/actions/setup", root);
    assert.equal(okAction.ok, true);
    assert.equal(okAction.kind, "action");
    assert.equal(okAction.label, "actions/setup/action.yml");

    const okWf = classifyLocalUsesRef("./.github/workflows/ci.yml", root);
    assert.equal(okWf.ok, true);
    assert.equal(okWf.kind, "workflow");

    assert.equal(classifyLocalUsesRef("./../../escape", root).ok, false);
    assert.equal(classifyLocalUsesRef("./.github\\actions\\setup", root).ok, false);
    assert.equal(classifyLocalUsesRef("./.github/workflows/sub/nested.yml", root).ok, false);
    assert.equal(classifyLocalUsesRef("./.github/actions/setup/action.yml", root).ok, false);

    const rootRef = classifyLocalUsesRef("./", root);
    assert.equal(rootRef.ok, false);
    assert.match(rootRef.error, /missing action\.yml/);
  });
});

test("discoverAllLocalActions and checkLocalActionRefs cover nested cycles and AST flow mappings", () => {
  withTempRepo((root) => {
    writeFile(
      root,
      ".github/workflows/w.yml",
      "name: w\non: push\njobs:\n  j:\n    steps:\n      - uses: ./ci/custom\n      - { uses: ./tools/flow }\n",
    );
    writeFile(root, ".github/actions/std/action.yml", "name: s\ndescription: s\nruns:\n  using: composite\n  steps: []\n");
    writeFile(
      root,
      "ci/custom/action.yml",
      "name: c\ndescription: c\nruns:\n  using: composite\n  steps:\n    - uses: ./ci/nested\n",
    );
    writeFile(
      root,
      "ci/nested/action.yaml",
      "name: n\ndescription: n\nruns:\n  using: composite\n  steps:\n    - uses: ./ci/custom\n",
    );
    writeFile(root, "tools/flow/action.yml", "name: f\ndescription: f\nruns:\n  using: composite\n  steps: []\n");

    const mockYaml = {
      parse(text) {
        if (text.includes("./tools/flow")) {
          return { jobs: { j: { steps: [{ uses: "./ci/custom" }, { uses: "./tools/flow" }] } } };
        }
        return { runs: { steps: [] } };
      },
    };
    const found = discoverAllLocalActions(root, mockYaml).map((x) => x.label);
    assert.deepEqual(found, [
      "actions/std/action.yml",
      "ci/custom/action.yml",
      "ci/nested/action.yaml",
      "tools/flow/action.yml",
    ]);

    const astProblems = checkLocalActionRefs(
      "jobs:\n  j:\n    steps:\n      - { uses: ./missing-flow }\n",
      root,
      { jobs: { j: { steps: [{ uses: "./missing-flow" }] } } },
    );
    assert.equal(astProblems.length, 1);
    assert.match(astProblems[0], /\.\/missing-flow/);
  });
});
