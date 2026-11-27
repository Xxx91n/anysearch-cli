// Backfill fixture checks. CI runs these every time; the push gate only when it runs the full suite.
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

function expected() {
  return {
    verdict: "answer",
    mustHitHosts: ["docs.example.com"],
    mustHitPaths: [{ path: "/install", tolerate: ["locale"] }],
    mustNotHitPaths: ["/blog"],
  };
}

function tombstone() {
  return {
    reason_code: "upstream-validator-vs-doc-mismatch",
    demoted_at: "2026-01-01",
    round: 1,
    decided_by: "ADR-0001",
    prior_scope: "live",
  };
}

function badcase() {
  return {
    id: "docs-bc0001",
    status: "open",
    question: QUESTION,
    domain: "docs",
    observed: { results: 3 },
    evidence: { command: "ans search --domain docs 'install widget'", runAt: "2026-11-27" },
    expected: expected(),
    intent: "howto",
    questionLang: "en",
    dimensions: ["intent:howto", "lang:en"],
    stability_class: "controlled",
    provenance: { type: "internal-dogfood" },
  };
}

function liveRow(id, question) {
  return {
    id,
    domain: "docs",
    question,
    questionLang: "en",
    intent: "howto",
    expected: expected(),
    dimensions: ["intent:howto", "lang:en"],
    provenance: { type: "internal-dogfood", ref: "eval-badcases.json", harvestedAt: "2026-01-01" },
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
      expected: expected(),
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
    timeout: 30_000,
  });
}

function expectFail(t, mutate, pattern, args = ["--id", "docs-bc0001", "--new"], options = {}) {
  const dir = tree(t, options);
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
  const cov = JSON.parse(readFileSync(join(dir, "eval-looks.coverage.json"), "utf8"));
  const count = (dim) => cov.dimensions.find((d) => d.dimension === dim)?.count;
  assert.equal(count("intent"), 2);
  assert.equal(count("lang"), 2);
});

test("--new rejects a question already in the golden corpus", (t) => {
  const dir = tree(t, { goldenQuestion: QUESTION });
  const r = run(dir, ["--id", "docs-bc0001", "--new"]);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /use --into/);
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
    g.entries[0].tombstone = tombstone();
    g.entries[0].expected = { verdict: "answer" };
    g.entries.push(liveRow("docs-g0002", "How do I uninstall the widget?"));
    g.scopes["docs-g0002"] = "live";
    delete g.scopes["docs-g0001"];
  });
  const r = run(dir, ["--id", "docs-bc0001", "--new"]);
  assert.equal(r.status, 0, r.stderr);
  const g = JSON.parse(readFileSync(join(dir, "eval-golden.json"), "utf8"));
  assert.equal(g.entries.length, 3);
  assert.equal(g.entries.at(-1).id, "docs-g0003");
  assert.equal(g.scopes["docs-g0003"], "live");
  const b = JSON.parse(readFileSync(join(dir, "eval-badcases.json"), "utf8"));
  assert.equal(b.badcases[0].status, "promoted");
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
  // A tombstoned row carries no scope, the way the real corpus looks (89 scope
  // keys — 81 live, 7 stub, 1 both — and one demoted row outside the map). The
  // second row stays live only so the scopes map is not empty — the file-level
  // check would fire first.
  expectFail(t, (dir) => {
    editJson(join(dir, "eval-golden.json"), (g) => {
      g.entries[0].expected = { verdict: "answer" };
      g.entries[0].tombstone = tombstone();
      delete g.scopes["docs-g0001"];
      g.entries.push(liveRow("docs-g0002", "How do I uninstall the widget?"));
      g.scopes["docs-g0002"] = "live";
    });
  }, /docs-g0001 is a tombstone/, ["--id", "docs-bc0001", "--into", "docs-g0001"]);
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

test("--new rejects a question shorter than 8 characters", (t) => {
  expectFail(t, (dir) => {
    editJson(join(dir, "eval-badcases.json"), (b) => { b.badcases[0].question = "short"; });
  }, /at least 8 characters/);
});

test("--new rejects a dimension tag outside the vocabulary", (t) => {
  expectFail(t, (dir) => {
    editJson(join(dir, "eval-badcases.json"), (b) => { b.badcases[0].dimensions.push("intents:factoid"); });
  }, /outside the eight-dimension vocabulary/);
});

test("--new rejects missing intent and lang tags", (t) => {
  expectFail(t, (dir) => {
    editJson(join(dir, "eval-badcases.json"), (b) => { b.badcases[0].dimensions = ["intent:howto"]; });
  }, /dimensions lack 'lang:en'/);
});

test("--new rejects expected.vertical", (t) => {
  expectFail(t, (dir) => {
    editJson(join(dir, "eval-badcases.json"), (b) => { b.badcases[0].expected.vertical = {}; });
  }, /carries expected\.vertical/);
});

test("--new rejects empty mustNotHitPaths", (t) => {
  expectFail(t, (dir) => {
    editJson(join(dir, "eval-badcases.json"), (b) => { b.badcases[0].expected.mustNotHitPaths = []; });
  }, /mustNotHitPaths must be a non-empty string\[\]/);
});

test("--new rejects a mustHitUrl host outside the allowlist", (t) => {
  expectFail(t, (dir) => {
    editJson(join(dir, "eval-badcases.json"), (b) => {
      b.badcases[0].expected.mustHitUrls = ["https://evil.example/install"];
    });
  }, /mustHitUrl host evil\.example outside/);
});

test("--new rejects a bad evidence.runAt", (t) => {
  expectFail(t, (dir) => {
    editJson(join(dir, "eval-badcases.json"), (b) => { b.badcases[0].evidence.runAt = "2026/11/27"; });
  }, /evidence\.runAt must be the real ISO date/);
});

test("--new rejects entry values that are not objects", (t) => {
  expectFail(t, (dir) => {
    editJson(join(dir, "eval-golden.json"), (g) => { g.entries.push(null); });
  }, /entries must contain objects/);
});

test("--into rejects a domain mismatch", (t) => {
  expectFail(t, (dir) => {
    editJson(join(dir, "eval-golden.json"), (g) => { g.entries[0].domain = "vert"; });
  }, /domain mismatch/, ["--id", "docs-bc0001", "--into", "docs-g0001"]);
});

test("--into rejects a question mismatch", (t) => {
  expectFail(t, (dir) => {
    editJson(join(dir, "eval-golden.json"), (g) => { g.entries[0].question = "A different question?"; });
  }, /question mismatch/, ["--id", "docs-bc0001", "--into", "docs-g0001"]);
});

test("--into rejects a target with no question", (t) => {
  expectFail(t, (dir) => {
    editJson(join(dir, "eval-golden.json"), (g) => { delete g.entries[0].question; });
  }, /has no string question/, ["--id", "docs-bc0001", "--into", "docs-g0001"]);
});

test("--into rejects a verdict mismatch", (t) => {
  // Same verbatim question, so the question check passes and the verdict check
  // is what fires: the badcase observed an abstain, the target row answers.
  expectFail(t, (dir) => {
    editJson(join(dir, "eval-badcases.json"), (b) => { b.badcases[0].expected.verdict = "abstain"; });
  }, /verdict mismatch/, ["--id", "docs-bc0001", "--into", "docs-g0001"], { goldenQuestion: QUESTION });
});

test("--new rejects a provenance type other than internal-dogfood", (t) => {
  expectFail(t, (dir) => {
    editJson(join(dir, "eval-badcases.json"), (b) => { b.badcases[0].provenance.type = "external"; });
  }, /only writes internal-dogfood provenance/);
});

test("--new rejects a stability_class outside the vocabulary", (t) => {
  expectFail(t, (dir) => {
    editJson(join(dir, "eval-badcases.json"), (b) => { b.badcases[0].stability_class = "whatever"; });
  }, /stability_class must be controlled\|frozen-spec\|external/);
});

test("--new rejects mustHitUrls without a stability_class", (t) => {
  expectFail(t, (dir) => {
    editJson(join(dir, "eval-badcases.json"), (b) => {
      b.badcases[0].expected.mustHitUrls = ["https://docs.example.com/install"];
      delete b.badcases[0].stability_class;
    });
  }, /no stability_class/);
});

test("--new rejects a missing evidence.runAt", (t) => {
  expectFail(t, (dir) => {
    editJson(join(dir, "eval-badcases.json"), (b) => { delete b.badcases[0].evidence.runAt; });
  }, /evidence\.runAt must be the real ISO date/);
});

test("--new rejects a badcase that is not open", (t) => {
  expectFail(t, (dir) => {
    editJson(join(dir, "eval-badcases.json"), (b) => { b.badcases[0].status = "promoted"; });
  }, /is not open \(status=promoted\)/);
});

test("--new rejects a badcase with no observed block", (t) => {
  expectFail(t, (dir) => {
    editJson(join(dir, "eval-badcases.json"), (b) => { delete b.badcases[0].observed; });
  }, /has no observed block/);
});

test("--new rejects a badcase with no evidence.command", (t) => {
  expectFail(t, (dir) => {
    editJson(join(dir, "eval-badcases.json"), (b) => { delete b.badcases[0].evidence.command; });
  }, /has no evidence\.command/);
});

test("--new rejects a non-docs domain", (t) => {
  expectFail(t, (dir) => {
    editJson(join(dir, "eval-badcases.json"), (b) => { b.badcases[0].domain = "vert"; });
  }, /only creates docs-domain rows/);
});

test("an out-of-range golden scope is rejected", (t) => {
  expectFail(t, (dir) => {
    editJson(join(dir, "eval-golden.json"), (g) => { g.scopes["docs-g0001"] = "sometimes"; });
  }, /scope for docs-g0001 must be stub\|live\|both/);
});

test("--new rejects a row the auto-scope cannot build (not answer+mustHit*)", (t) => {
  expectFail(t, (dir) => {
    editJson(join(dir, "eval-badcases.json"), (b) => { delete b.badcases[0].expected.mustHitHosts; });
  }, /can only auto-scope an answer\+mustHit\*/);
});

test("a golden schema other than anysearch/docs-golden@1 is rejected", (t) => {
  expectFail(t, (dir) => {
    editJson(join(dir, "eval-golden.json"), (g) => { g.schema = "anysearch/docs-golden@9"; });
  }, /schema must be anysearch\/docs-golden@1/);
});

test("an empty golden entries list is rejected", (t) => {
  expectFail(t, (dir) => {
    editJson(join(dir, "eval-golden.json"), (g) => { g.entries = []; });
  }, /has no entries/);
});

test("an empty golden scopes map is rejected", (t) => {
  expectFail(t, (dir) => {
    editJson(join(dir, "eval-golden.json"), (g) => { g.scopes = {}; });
  }, /scopes must not be empty/);
});

test("coverage dimensions that are not an array are rejected", (t) => {
  expectFail(t, (dir) => {
    editJson(join(dir, "eval-looks.coverage.json"), (c) => { c.dimensions = {}; });
  }, /dimensions must be an array/);
});

test("--new rejects a badcase with no domain", (t) => {
  expectFail(t, (dir) => {
    editJson(join(dir, "eval-badcases.json"), (b) => { delete b.badcases[0].domain; });
  }, /has no domain/);
});

test("--new rejects a badcase with no expected block", (t) => {
  expectFail(t, (dir) => {
    editJson(join(dir, "eval-badcases.json"), (b) => { delete b.badcases[0].expected; });
  }, /has no expected block/);
});

test("--new rejects a badcase missing its classification fields", (t) => {
  for (const field of ["intent", "questionLang", "dimensions"]) {
    expectFail(t, (dir) => {
      editJson(join(dir, "eval-badcases.json"), (b) => { delete b.badcases[0][field]; });
    }, new RegExp("lacks '" + field + "'"));
  }
});

test("--new rejects a mustHitPaths pattern that is not absolute", (t) => {
  expectFail(t, (dir) => {
    editJson(join(dir, "eval-badcases.json"), (b) => {
      b.badcases[0].expected.mustHitPaths = [{ path: "install", tolerate: [] }];
    });
  }, /must start with \//);
});

test("--new rejects a tolerate class outside locale|version|dated", (t) => {
  expectFail(t, (dir) => {
    editJson(join(dir, "eval-badcases.json"), (b) => {
      b.badcases[0].expected.mustHitPaths = [{ path: "/install", tolerate: ["locale", "draft"] }];
    });
  }, /tolerate outside locale\|version\|dated/);
});

test("--new rejects an unparseable mustHitUrl", (t) => {
  expectFail(t, (dir) => {
    editJson(join(dir, "eval-badcases.json"), (b) => { b.badcases[0].expected.mustHitUrls = ["https://"]; });
  }, /mustHitUrl unparseable/);
});

test("--new rejects a mustHitUrl on an external-controllability row", (t) => {
  expectFail(t, (dir) => {
    editJson(join(dir, "eval-badcases.json"), (b) => {
      b.badcases[0].expected.mustHitUrls = ["https://docs.example.com/install"];
      b.badcases[0].stability_class = "external";
    });
  }, /only accepts controlled\|frozen-spec/);
});

test("an unreadable domains/docs.toml is reported, not thrown", (t) => {
  expectFail(t, (dir) => {
    rmSync(join(dir, "domains", "docs.toml"));
  }, /cannot read domains\/docs\.toml/);
});

test("a null eval-badcases.json root is reported, not a TypeError", (t) => {
  expectFail(t, (dir) => {
    writeJson(join(dir, "eval-badcases.json"), null);
  }, /eval-badcases\.json root must be an object/);
});
