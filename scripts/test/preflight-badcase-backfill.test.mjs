// Backfill fixture checks. Named preflight-* so the push gate and CI run them.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SCRIPT = join(REPO, "scripts", "badcase-backfill.mjs");
const QUESTION = "How do I install the widget?";

function badcase() {
  return {
    id: "docs-bc0001",
    status: "open",
    question: QUESTION,
    domain: "docs",
    observed: { results: 3 },
    evidence: { command: "ans search --domain docs 'install widget'", runAt: "2026-11-27" },
    expected: {
      verdict: "answer",
      mustHitHosts: ["docs.example.com"],
      mustHitPaths: [{ path: "/install", tolerate: ["locale"] }],
      mustNotHitPaths: ["/blog"],
    },
    intent: "howto",
    questionLang: "en",
    dimensions: ["intent:howto", "lang:en"],
    stability_class: "controlled",
    provenance: { type: "internal-dogfood" },
  };
}

function golden(question = "How do I configure the widget?") {
  return {
    schema: "anysearch/docs-golden@1",
    scopes: { "docs-g0001": "live" },
    entries: [{
      id: "docs-g0001",
      domain: "docs",
      question,
      questionLang: "en",
      intent: "howto",
      expected: {
        verdict: "answer",
        mustHitHosts: ["docs.example.com"],
        mustHitPaths: [{ path: "/install", tolerate: ["locale"] }],
        mustNotHitPaths: ["/blog"],
      },
      dimensions: ["intent:howto", "lang:en"],
      provenance: { type: "internal-dogfood", ref: "eval-badcases.json", harvestedAt: "2026-01-01" },
    }],
  };
}

function coverage() {
  return {
    schema: "anysearch/eval-looks-coverage@1",
    recordedAt: "2026-11-27",
    dimensions: [
      { dimension: "intent", status: "covered", count: 1 },
      { dimension: "lang", status: "covered", count: 1 },
    ],
  };
}

function writeJson(file, value) {
  writeFileSync(file, JSON.stringify(value, null, 2) + "\n", "utf8");
}
function editJson(file, fn) {
  const value = JSON.parse(readFileSync(file, "utf8"));
  fn(value);
  writeJson(file, value);
}

function tree(t, options = {}) {
  const dir = mkdtempSync(join(tmpdir(), "ans-backfill-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "domains"));
  writeFileSync(join(dir, "domains", "docs.toml"), "[sources]\nurlAllowlist = [\"docs.example.com\"]\n", "utf8");
  writeJson(join(dir, "eval-badcases.json"), { badcases: [badcase()] });
  writeJson(join(dir, "eval-golden.json"), golden(options.goldenQuestion));
  writeJson(join(dir, "eval-looks.coverage.json"), coverage());
  return dir;
}

function run(dir, args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: REPO,
    env: { ...process.env, ANS_BACKFILL_ROOT: dir },
    encoding: "utf8",
  });
}

function expectFail(t, mutate, pattern, args = ["--id", "docs-bc0001", "--new"]) {
  const dir = tree(t);
  mutate(dir);
  const r = run(dir, args);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /badcase-backfill: /);
  assert.match(r.stderr, pattern);
}

test("--new writes the next docs row and promotes the badcase", (t) => {
  const dir = tree(t);
  const r = run(dir, ["--id", "docs-bc0001", "--new"]);
  assert.equal(r.status, 0, r.stderr);
  const g = JSON.parse(readFileSync(join(dir, "eval-golden.json"), "utf8"));
  const entry = g.entries.at(-1);
  assert.equal(entry.id, "docs-g0002");
  assert.equal(g.scopes["docs-g0002"], "live");
  assert.equal(entry.provenance.ref, "eval-badcases.json");
  const b = JSON.parse(readFileSync(join(dir, "eval-badcases.json"), "utf8"));
  assert.equal(b.badcases[0].status, "promoted");
  assert.equal(b.badcases[0].promotedTo, "docs-g0002");
});

test("--into attaches to the same-question row", (t) => {
  const dir = tree(t, { goldenQuestion: QUESTION });
  const r = run(dir, ["--id", "docs-bc0001", "--into", "docs-g0001"]);
  assert.equal(r.status, 0, r.stderr);
  const g = JSON.parse(readFileSync(join(dir, "eval-golden.json"), "utf8"));
  assert.match(g.entries[0].notes, /badcase docs-bc0001/);
  const b = JSON.parse(readFileSync(join(dir, "eval-badcases.json"), "utf8"));
  assert.equal(b.badcases[0].promotedTo, "docs-g0001");
});

test("--new skips a tombstoned row with the same question", (t) => {
  const dir = tree(t, { goldenQuestion: QUESTION });
  editJson(join(dir, "eval-golden.json"), (g) => {
    g.entries[0].tombstone = { reason_code: "provider-drift", demoted_at: "2026-01-01", round: 1 };
  });
  const r = run(dir, ["--id", "docs-bc0001", "--new"]);
  assert.equal(r.status, 0, r.stderr);
});

test("--new rejects a deferred dimension", (t) => {
  expectFail(t, (dir) => {
    editJson(join(dir, "eval-looks.coverage.json"), (c) => {
      c.dimensions.push({ dimension: "adversarial", status: "deferred" });
    });
    editJson(join(dir, "eval-badcases.json"), (b) => {
      b.badcases[0].dimensions.push("adversarial:injection");
    });
  }, /deferred/);
});

test("--new rejects a host outside the allowlist", (t) => {
  expectFail(t, (dir) => {
    editJson(join(dir, "eval-badcases.json"), (b) => {
      b.badcases[0].expected.mustHitHosts = ["evil.example"];
    });
  }, /outside domains\/docs\.toml urlAllowlist/);
});

test("--new rejects mustHitPaths without negative pins", (t) => {
  expectFail(t, (dir) => {
    editJson(join(dir, "eval-badcases.json"), (b) => {
      delete b.badcases[0].expected.mustNotHitPaths;
    });
  }, /requires mustNotHitPaths/);
});

test("--into rejects a tombstone target", (t) => {
  expectFail(t, (dir) => {
    editJson(join(dir, "eval-golden.json"), (g) => {
      g.entries[0].tombstone = { reason_code: "provider-drift", demoted_at: "2026-01-01", round: 1 };
    });
  }, /tombstone/, ["--id", "docs-bc0001", "--into", "docs-g0001"]);
});

test("--new rejects a non-http mustHitUrl", (t) => {
  expectFail(t, (dir) => {
    editJson(join(dir, "eval-badcases.json"), (b) => {
      b.badcases[0].expected.mustHitUrls = ["ftp://docs.example.com/install"];
    });
  }, /must be http\(s\)/);
});

test("a broken docs.toml reports invalid TOML", (t) => {
  expectFail(t, (dir) => {
    writeFileSync(join(dir, "domains", "docs.toml"), "[sources\n", "utf8");
  }, /invalid TOML in domains\/docs\.toml/);
});

test("a broken eval-golden.json reports invalid JSON", (t) => {
  expectFail(t, (dir) => {
    writeFileSync(join(dir, "eval-golden.json"), "{", "utf8");
  }, /invalid JSON in eval-golden\.json/);
});

test("a missing coverage file reports cannot read", (t) => {
  expectFail(t, (dir) => {
    rmSync(join(dir, "eval-looks.coverage.json"));
  }, /cannot read eval-looks\.coverage\.json/);
});
