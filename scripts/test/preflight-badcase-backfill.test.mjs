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
    entries: [liveRow("docs-g0001", question)],
  };
}

function coverage() {
  return {
    schema: "anysearch/eval-looks-coverage@1",
    domain: "docs",
    recordedAt: "2026-11-27",
    // Shaped like the real manifest: all eight slices present, the two the one
    // live row tags are covered, the rest deferred with an owner.
    dimensions: [
      { dimension: "intent", status: "covered", count: 1, classes: { howto: 1 } },
      { dimension: "lang", status: "covered", count: 1, classes: { en: 1 } },
      { dimension: "source-tier", status: "deferred", entryTrigger: "first spec-tier row", owner: "B1" },
      { dimension: "freshness", status: "deferred", entryTrigger: "first active-page row", owner: "B1" },
      { dimension: "attribution", status: "deferred", entryTrigger: "first claim-level row", owner: "B2" },
      { dimension: "hops", status: "deferred", entryTrigger: "first multi-hop row", owner: "B2" },
      { dimension: "negative", status: "deferred", entryTrigger: "first abstain row", owner: "B3" },
      { dimension: "adversarial", status: "deferred", entryTrigger: "first injection attempt", owner: "B4" },
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

function readJson(dir, file) {
  return JSON.parse(readFileSync(join(dir, file), "utf8"));
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
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: REPO,
    env: { ...process.env, ANS_BACKFILL_ROOT: dir },
    encoding: "utf8",
    timeout: 30_000,
  });
  // A timeout or a missing node leaves status null; name that instead of
  // letting "expected null to equal 2" point at the script logic.
  assert.equal(r.error, undefined, String(r.error));
  return r;
}

const LEDGERS = ["eval-golden.json", "eval-badcases.json", "eval-looks.coverage.json"];

function ledgerText(dir, file) {
  try {
    return readFileSync(join(dir, file), "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

function expectFail(t, mutate, pattern, args = ["--id", "docs-bc0001", "--new"], options = {}) {
  const dir = tree(t, options);
  mutate(dir);
  const before = LEDGERS.map((file) => ledgerText(dir, file));
  const r = run(dir, args);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /badcase-backfill: /);
  assert.match(r.stderr, pattern);
  // A refused run must leave every ledger byte-identical: the script writes only
  // after the last check, and even then through tmp+rename.
  LEDGERS.forEach((file, i) => {
    assert.equal(ledgerText(dir, file), before[i], file + " changed despite exit 2");
  });
}

// Cases that take non-default argv, rewrite several files, or delete a file
// stay as their own tests below.
const REJECTS = [
  {
    name: "--new rejects a host outside the allowlist",
    file: "eval-badcases.json",
    edit: (b) => { b.badcases[0].expected.mustHitHosts = ["evil.example"]; },
    pattern: /outside domains\/docs\.toml urlAllowlist/,
  },
  {
    name: "--new rejects mustHitPaths without negative pins",
    file: "eval-badcases.json",
    edit: (b) => { delete b.badcases[0].expected.mustNotHitPaths; },
    pattern: /requires mustNotHitPaths/,
  },
  {
    name: "--new rejects a non-http mustHitUrl",
    file: "eval-badcases.json",
    edit: (b) => { b.badcases[0].expected.mustHitUrls = ["ftp://docs.example.com/install"]; },
    pattern: /must be http\(s\)/,
  },
  {
    name: "--new rejects a question shorter than 8 characters",
    file: "eval-badcases.json",
    edit: (b) => { b.badcases[0].question = "short"; },
    pattern: /at least 8 characters/,
  },
  {
    name: "--new rejects a dimension tag outside the vocabulary",
    file: "eval-badcases.json",
    edit: (b) => { b.badcases[0].dimensions.push("intents:factoid"); },
    pattern: /outside the eight-dimension vocabulary/,
  },
  {
    name: "--new rejects missing intent and lang tags",
    file: "eval-badcases.json",
    edit: (b) => { b.badcases[0].dimensions = ["intent:howto"]; },
    pattern: /dimensions lack 'lang:en'/,
  },
  {
    name: "--new rejects expected.vertical",
    file: "eval-badcases.json",
    edit: (b) => { b.badcases[0].expected.vertical = {}; },
    pattern: /carries expected\.vertical/,
  },
  {
    name: "--new rejects empty mustNotHitPaths",
    file: "eval-badcases.json",
    edit: (b) => { b.badcases[0].expected.mustNotHitPaths = []; },
    pattern: /mustNotHitPaths must be a non-empty string\[\]/,
  },
  {
    name: "--new rejects a mustHitUrl host outside the allowlist",
    file: "eval-badcases.json",
    edit: (b) => { b.badcases[0].expected.mustHitUrls = ["https://evil.example/install"]; },
    pattern: /mustHitUrl host evil\.example outside/,
  },
  {
    name: "--new rejects a bad evidence.runAt",
    file: "eval-badcases.json",
    edit: (b) => { b.badcases[0].evidence.runAt = "2026/11/27"; },
    pattern: /evidence\.runAt must be the real ISO date/,
  },
  {
    name: "--new rejects entry values that are not objects",
    file: "eval-golden.json",
    edit: (g) => { g.entries.push(null); },
    pattern: /entries must contain objects/,
  },
  {
    name: "--new rejects a provenance type other than internal-dogfood",
    file: "eval-badcases.json",
    edit: (b) => { b.badcases[0].provenance.type = "external"; },
    pattern: /only writes internal-dogfood provenance/,
  },
  {
    name: "--new rejects a stability_class outside the vocabulary",
    file: "eval-badcases.json",
    edit: (b) => { b.badcases[0].stability_class = "whatever"; },
    pattern: /stability_class must be controlled\|frozen-spec\|external/,
  },
  {
    name: "--new rejects mustHitUrls without a stability_class",
    file: "eval-badcases.json",
    edit: (b) => { b.badcases[0].expected.mustHitUrls = ["https://docs.example.com/install"]; delete b.badcases[0].stability_class; },
    pattern: /no stability_class/,
  },
  {
    name: "--new rejects a missing evidence.runAt",
    file: "eval-badcases.json",
    edit: (b) => { delete b.badcases[0].evidence.runAt; },
    pattern: /evidence\.runAt must be the real ISO date/,
  },
  {
    name: "--new rejects a badcase that is not open",
    file: "eval-badcases.json",
    edit: (b) => { b.badcases[0].status = "promoted"; },
    pattern: /is not open \(status=promoted\)/,
  },
  {
    name: "--new rejects a badcase with no observed block",
    file: "eval-badcases.json",
    edit: (b) => { delete b.badcases[0].observed; },
    pattern: /has no observed block/,
  },
  {
    name: "--new rejects a badcase with no evidence.command",
    file: "eval-badcases.json",
    edit: (b) => { delete b.badcases[0].evidence.command; },
    pattern: /has no evidence\.command/,
  },
  {
    name: "--new rejects a non-docs domain",
    file: "eval-badcases.json",
    edit: (b) => { b.badcases[0].domain = "vert"; },
    pattern: /only creates docs-domain rows/,
  },
  {
    name: "an out-of-range golden scope is rejected",
    file: "eval-golden.json",
    edit: (g) => { g.scopes["docs-g0001"] = "sometimes"; },
    pattern: /scope for docs-g0001 must be stub\|live\|both/,
  },
  {
    name: "--new rejects a row the auto-scope cannot build (not answer+mustHit*)",
    file: "eval-badcases.json",
    edit: (b) => {
      delete b.badcases[0].expected.mustHitHosts;
      delete b.badcases[0].expected.mustHitPaths;
    },
    pattern: /can only auto-scope an answer\+mustHit\*/,
  },
  {
    name: "a golden schema other than anysearch/docs-golden@1 is rejected",
    file: "eval-golden.json",
    edit: (g) => { g.schema = "anysearch/docs-golden@9"; },
    pattern: /schema must be anysearch\/docs-golden@1/,
  },
  {
    name: "an empty golden entries list is rejected",
    file: "eval-golden.json",
    edit: (g) => { g.entries = []; },
    pattern: /has no entries/,
  },
  {
    name: "an empty golden scopes map is rejected",
    file: "eval-golden.json",
    edit: (g) => { g.scopes = {}; },
    pattern: /scopes must not be empty/,
  },
  {
    name: "a golden scopes value that is not an object is rejected",
    file: "eval-golden.json",
    edit: (g) => { g.scopes = []; },
    pattern: /scopes must be an object/,
  },
  {
    name: "a golden entries value that is not an array is rejected",
    file: "eval-golden.json",
    edit: (g) => { g.entries = {}; },
    pattern: /has no entries/,
  },
  {
    name: "coverage dimensions that are not an array are rejected",
    file: "eval-looks.coverage.json",
    edit: (c) => { c.dimensions = {}; },
    pattern: /dimensions must be an array/,
  },
  {
    name: "--new rejects a badcase with no domain",
    file: "eval-badcases.json",
    edit: (b) => { delete b.badcases[0].domain; },
    pattern: /has no domain/,
  },
  {
    name: "--new rejects a badcase with no expected block",
    file: "eval-badcases.json",
    edit: (b) => { delete b.badcases[0].expected; },
    pattern: /has no expected block/,
  },
  {
    name: "--new rejects a mustHitPaths pattern that is not absolute",
    file: "eval-badcases.json",
    edit: (b) => { b.badcases[0].expected.mustHitPaths = [{ path: "install", tolerate: [] }]; },
    pattern: /must start with \//,
  },
  {
    name: "--new rejects a tolerate class outside locale|version|dated",
    file: "eval-badcases.json",
    edit: (b) => { b.badcases[0].expected.mustHitPaths = [{ path: "/install", tolerate: ["locale", "draft"] }]; },
    pattern: /tolerate outside locale\|version\|dated/,
  },
  {
    name: "--new rejects an unparseable mustHitUrl",
    file: "eval-badcases.json",
    edit: (b) => { b.badcases[0].expected.mustHitUrls = ["https://"]; },
    pattern: /mustHitUrl unparseable/,
  },
  {
    name: "--new rejects a mustHitUrl on an external-controllability row",
    file: "eval-badcases.json",
    edit: (b) => { b.badcases[0].expected.mustHitUrls = ["https://docs.example.com/install"]; b.badcases[0].stability_class = "external"; },
    pattern: /only accepts controlled\|frozen-spec/,
  },
  {
    name: "a non-array badcases field is reported, not a TypeError",
    file: "eval-badcases.json",
    edit: (b) => { b.badcases = {}; },
    pattern: /badcases must be an array/,
  },
  {
    name: "--new rejects dimensions that are not an array",
    file: "eval-badcases.json",
    edit: (b) => { b.badcases[0].dimensions = {}; },
    pattern: /dimensions must be a string\[\]/,
  },
  {
    name: "--new rejects mustHitPaths that are not an array",
    file: "eval-badcases.json",
    edit: (b) => { b.badcases[0].expected.mustHitPaths = "/install"; },
    pattern: /mustHitPaths must be \{path,tolerate\}\[\]/,
  },
  {
    name: "--new rejects an expected block that is an array",
    file: "eval-badcases.json",
    edit: (b) => { b.badcases[0].expected = []; },
    pattern: /has no expected block/,
  },
  {
    name: "a badcases array holding a non-object is reported, not a TypeError",
    file: "eval-badcases.json",
    edit: (b) => { b.badcases.push(null); },
    pattern: /badcases must contain objects/,
  },
  {
    name: "--new rejects mustHitHosts that are not an array",
    file: "eval-badcases.json",
    edit: (b) => { b.badcases[0].expected.mustHitHosts = "docs.example.com"; },
    pattern: /mustHitUrls\/mustHitHosts must be arrays/,
  },
  {
    name: "--new rejects mustNotHitPaths holding a non-string",
    file: "eval-badcases.json",
    edit: (b) => { b.badcases[0].expected.mustNotHitPaths = ["/blog", 42]; },
    pattern: /mustNotHitPaths must be a non-empty string\[\]/,
  },
  {
    name: "--new rejects an empty mustNotHitPaths entry",
    file: "eval-badcases.json",
    edit: (b) => { b.badcases[0].expected.mustNotHitPaths = [""]; },
    pattern: /mustNotHitPaths must be a non-empty string\[\]/,
  },
];

for (const { name, file, edit, pattern } of REJECTS) {
  test(name, (t) => {
    expectFail(t, (dir) => { editJson(join(dir, file), edit); }, pattern);
  });
}

test("--new writes the next docs row and promotes the badcase", (t) => {
  const dir = tree(t);
  const r = run(dir, ["--id", "docs-bc0001", "--new"]);
  assert.equal(r.status, 0, r.stderr);
  const g = readJson(dir, "eval-golden.json");
  const entry = g.entries.at(-1);
  assert.equal(entry.id, "docs-g0002");
  assert.equal(g.scopes["docs-g0002"], "live");
  assert.equal(entry.provenance.ref, "eval-badcases.json");
  const b = readJson(dir, "eval-badcases.json");
  assert.equal(b.badcases[0].status, "promoted");
  assert.equal(b.badcases[0].promotedTo, "docs-g0002");
  const cov = readJson(dir, "eval-looks.coverage.json");
  const count = (dim) => cov.dimensions.find((d) => d.dimension === dim)?.count;
  assert.equal(count("intent"), 2);
  assert.equal(count("lang"), 2);
  const classes = (dim) => cov.dimensions.find((d) => d.dimension === dim)?.classes;
  assert.deepEqual(classes("intent"), { howto: 2 });
  assert.deepEqual(classes("lang"), { en: 2 });
});

test("--new persists a URL anchor with its stability_class", (t) => {
  const dir = tree(t);
  editJson(join(dir, "eval-badcases.json"), (b) => {
    b.badcases[0].expected.mustHitUrls = ["https://docs.example.com/install"];
    // frozen-spec rather than the fixture's default controlled, so the entry
    // proves it took the badcase's value.
    b.badcases[0].stability_class = "frozen-spec";
  });
  const r = run(dir, ["--id", "docs-bc0001", "--new"]);
  assert.equal(r.status, 0, r.stderr);
  const g = readJson(dir, "eval-golden.json");
  const entry = g.entries.at(-1);
  assert.deepEqual(entry.expected.mustHitUrls, ["https://docs.example.com/install"]);
  assert.equal(entry.stability_class, "frozen-spec");
  const cov = readJson(dir, "eval-looks.coverage.json");
  assert.equal(cov.dimensions.find((d) => d.dimension === "intent")?.classes?.howto, 2);
});

test("a mustHitPaths-only answer row still auto-scopes live", (t) => {
  const dir = tree(t);
  editJson(join(dir, "eval-badcases.json"), (b) => {
    delete b.badcases[0].expected.mustHitHosts;
  });
  const r = run(dir, ["--id", "docs-bc0001", "--new"]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readJson(dir, "eval-golden.json").scopes["docs-g0002"], "live");
});

test("a valid --new writes an entry the store validator accepts", async (t) => {
  const dir = tree(t);
  const r = run(dir, ["--id", "docs-bc0001", "--new"]);
  assert.equal(r.status, 0, r.stderr);
  const { crossCheckDocsGolden, validateCoverageManifest, validateDocsGoldenEntry } = await import(
    "../../packages/store/src/eval/docs-golden.ts"
  );
  const written = readJson(dir, "eval-golden.json");
  const manifest = readJson(dir, "eval-looks.coverage.json");
  assert.deepEqual(validateDocsGoldenEntry(written.entries.at(-1)), [], "the written row passes the real entry validator");
  assert.deepEqual(validateCoverageManifest(manifest), [], "the recount leaves a valid manifest");
  assert.deepEqual(
    crossCheckDocsGolden(written, manifest, ["docs.example.com"]),
    [],
    "the recounted manifest still agrees with the entries it counts",
  );
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
  const g = readJson(dir, "eval-golden.json");
  assert.match(g.entries[0].notes, /badcase docs-bc0001/);
  const b = readJson(dir, "eval-badcases.json");
  assert.equal(b.badcases[0].status, "promoted");
  assert.equal(b.badcases[0].promotedTo, "docs-g0001");
});

test("--new numbers docs rows from docs-g ids only", (t) => {
  const dir = tree(t);
  editJson(join(dir, "eval-golden.json"), (g) => {
    g.entries.push(liveRow("vert-f1105", "A vertical fixture question?"));
    g.scopes["vert-f1105"] = "live";
  });
  const r = run(dir, ["--id", "docs-bc0001", "--new"]);
  assert.equal(r.status, 0, r.stderr);
  const g = readJson(dir, "eval-golden.json");
  assert.equal(g.entries.at(-1).id, "docs-g0002", "vert-* ids carry four digits and must not advance the docs sequence");
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
  const g = readJson(dir, "eval-golden.json");
  assert.equal(g.entries.length, 3);
  assert.equal(g.entries.at(-1).id, "docs-g0003");
  assert.equal(g.scopes["docs-g0003"], "live");
  const b = readJson(dir, "eval-badcases.json");
  assert.equal(b.badcases[0].status, "promoted");
});

test("--new rejects a deferred dimension", (t) => {
  // The fixture manifest defers adversarial exactly like the real one.
  expectFail(t, (dir) => {
    editJson(join(dir, "eval-badcases.json"), (b) => {
      b.badcases[0].dimensions.push("adversarial:injection");
    });
  }, /deferred/);
});

test("--into rejects a tombstone target", (t) => {
  // A tombstoned row carries no scope. The second row stays live only so the
  // scopes map is not empty — the file-level check would fire first.
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

test("a broken docs.toml reports invalid TOML", (t) => {
  expectFail(t, (dir) => {
    writeFileSync(join(dir, "domains", "docs.toml"), "[sources\n", "utf8");
  }, /invalid TOML in domains\/docs\.toml/);
});

test("a docs.toml without urlAllowlist is reported, not thrown", (t) => {
  expectFail(t, (dir) => {
    writeFileSync(join(dir, "domains", "docs.toml"), "[sources]\n", "utf8");
  }, /cannot read sources\.urlAllowlist from domains\/docs\.toml/);
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

test("--new rejects a badcase missing its classification fields", (t) => {
  for (const field of ["intent", "questionLang", "dimensions"]) {
    expectFail(t, (dir) => {
      editJson(join(dir, "eval-badcases.json"), (b) => { delete b.badcases[0][field]; });
    }, new RegExp("lacks '" + field + "'"));
  }
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

test("a null eval-looks.coverage.json root is reported, not a TypeError", (t) => {
  expectFail(t, (dir) => {
    writeJson(join(dir, "eval-looks.coverage.json"), null);
  }, /eval-looks\.coverage\.json root must be an object/);
});

test("an --id naming no badcase reports it", (t) => {
  expectFail(t, () => {}, /badcase not found: docs-bc9999/, ["--id", "docs-bc9999", "--new"]);
});

test("an --into naming no golden target reports it", (t) => {
  expectFail(t, () => {}, /golden target not found: docs-g0099/, ["--id", "docs-bc0001", "--into", "docs-g0099"]);
});

test("neither --into nor --new is a usage error", (t) => {
  expectFail(t, () => {}, /usage: --id/, ["--id", "docs-bc0001"]);
});

test("a missing eval-golden.json reports cannot read", (t) => {
  expectFail(t, (dir) => {
    rmSync(join(dir, "eval-golden.json"));
  }, /cannot read eval-golden\.json/);
});

test("a null eval-golden.json root is reported as a root problem", (t) => {
  expectFail(t, (dir) => {
    writeJson(join(dir, "eval-golden.json"), null);
  }, /eval-golden\.json root must be an object/);
});
