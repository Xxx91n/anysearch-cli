// B1/D5: docs-domain golden corpus + coverage manifest contract.
// The corpus lives in eval-golden.json, its own file, so a broken write to the
// look ledger (eval-looks.json) can no longer take it down. This test is the
// mechanical honesty loop: entry schema, provenance anchor honesty, allowlist
// subset, manifest covered|deferred consistency, the fail-closed reader, and
// ledger writer round-trip preservation of unknown fields.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  appendLook,
  readLooksLedger,
  writeLooksLedger,
  type LooksLedgerEntry,
} from "../src/eval/looks-ledger";
import { GOLDEN_FILE, isLiveScope, isStubScope, readGoldenFile } from "../src/eval/golden-file";
import {
  DOCS_GOLDEN_DIMENSIONS,
  GOLDEN_SCOPE_VALUES,
  TOMBSTONE_REASON_CODES,
  validateCoverageManifest,
  validateDocsGoldenEntry,
  validateDocsGoldenSet,
  crossCheckDocsGolden,
  isScratchRef,
  isWellFormedScratchRef,
  type CoverageManifest,
} from "../src/eval/docs-golden";
import { loadDomain, loadDomainByNameIn } from "../src/domain-loader";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..", "..", "..");

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) {
    failed++;
    console.error("FAIL: " + msg);
    return;
  }
  passed++;
}

// --- 1. the ledger keeps its shape; the corpus lives in its own file --------
const raw = JSON.parse(fs.readFileSync(path.join(root, "eval-looks.json"), "utf8"));
assert(raw.schema === "anysearch/eval-looks@2", "eval-looks.json keeps schema anysearch/eval-looks@2");
assert(Array.isArray(raw.looks), "looks[] ledger rows intact");
assert(!Object.hasOwn(raw, "golden"), "eval-looks.json carries no golden key (the corpus moved out)");
const golden = readGoldenFile(path.join(root, GOLDEN_FILE));
const docsBatch = golden.entries.filter((e) => e.id.startsWith("docs-g"));
const vertBatch = golden.entries.filter((e) => e.id.startsWith("vert-"));
const ctrlBatch = golden.entries.filter((e) => e.id.startsWith("ctrl-"));
assert(docsBatch.length >= 8, "docs first-batch has at least 8 shelf-gate rows (got " + docsBatch.length + ")");
// vertical-eval contract pins landed (subject + control); T2 grows the
// live-scoped corpus — bound asserts the contract pins exist, not the corpus size.
assert(vertBatch.length >= 3, "vertical subject contract pins exist (got " + vertBatch.length + ")");
assert(ctrlBatch.length >= 2, "control-class pins exist (got " + ctrlBatch.length + ")");

// --- 1b. readGoldenFile throws on bad input and never returns an empty set ---
// An empty corpus would make the executors SKIP every entry and the gate pass
// while measuring nothing, so a bad file must fail the run.
{
  const good = readGoldenFile(path.join(root, GOLDEN_FILE));
  assert(good.entries.length === golden.entries.length, "readGoldenFile returns the corpus from a good file");
  assert(Object.keys(good.scopes).length > 0, "readGoldenFile returns the scopes sidecar");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ans-golden-reader-"));
  const write = (name: string, body: string): string => {
    const p = path.join(dir, name);
    fs.writeFileSync(p, body, "utf8");
    return p;
  };
  const throws = (fn: () => unknown): boolean => {
    try {
      fn();
      return false;
    } catch {
      return true;
    }
  };
  const base = { schema: good.schema, scopes: good.scopes, entries: good.entries };
  assert(throws(() => readGoldenFile(path.join(dir, "absent.json"))), "missing file throws");
  assert(throws(() => readGoldenFile(write("bad-json.json", "{ not json"))), "invalid JSON throws");
  assert(throws(() => readGoldenFile(write("bad-root.json", "null"))), "non-object root throws");
  assert(throws(() => readGoldenFile(write("bad-root-array.json", "[]"))), "array root throws");
  assert(throws(() => readGoldenFile(write("bad-schema.json", JSON.stringify({ ...base, schema: "anysearch/docs-golden@9" })))), "wrong schema throws");
  assert(throws(() => readGoldenFile(write("bad-entries.json", JSON.stringify({ ...base, entries: {} })))), "entries not an array throws");
  assert(throws(() => readGoldenFile(write("bad-scopes.json", JSON.stringify({ ...base, scopes: [] })))), "scopes not an object throws");
  assert(throws(() => readGoldenFile(write("empty-entries.json", JSON.stringify({ ...base, entries: [] })))), "empty entries throws");
  assert(
    throws(() => readGoldenFile(write("bad-entry.json", JSON.stringify({ ...base, entries: [{ ...base.entries[0], intent: "bogus" }] })))),
    "invalid entry throws (same validator as the test)"
  );
  // A null entry must come back as a problem list, not a TypeError from reading
  // `.id` on null.
  let nullEntryMessage = "";
  try {
    readGoldenFile(write("null-entry.json", JSON.stringify({ ...base, entries: [null] })));
  } catch (err) {
    nullEntryMessage = (err as Error).message;
  }
  assert(
    nullEntryMessage.includes("entry is not an object") && !(nullEntryMessage.startsWith("TypeError")),
    "null entry throws the reader's own message (got: " + nullEntryMessage + ")"
  );
  assert(throws(() => readGoldenFile(write("empty-scopes.json", JSON.stringify({ ...base, scopes: {} })))), "empty scopes throws");
  assert(
    throws(() => readGoldenFile(write("bad-scope-value.json", JSON.stringify({ ...base, scopes: { "docs-g0001": "Live" } })))),
    "unknown scope value throws"
  );
  const first = base.entries[0]!;
  const withoutFirst = Object.fromEntries(Object.entries(base.scopes).filter(([k]) => k !== first.id));
  assert(
    throws(() => readGoldenFile(write("missing-scope.json", JSON.stringify({ ...base, scopes: withoutFirst })))),
    "non-tombstone entry without a scope throws"
  );
  const tomb = base.entries.find((e) => e.tombstone !== undefined);
  if (!tomb) throw new Error("fixture: corpus has a tombstone entry");
  assert(
    throws(() => readGoldenFile(write("tombstone-scope.json", JSON.stringify({ ...base, scopes: { ...base.scopes, [tomb.id]: "live" } })))),
    "tombstone entry with a scope throws"
  );
  assert(
    throws(() => readGoldenFile(write("orphan-scope.json", JSON.stringify({ ...base, scopes: { ...base.scopes, "docs-g9999": "live" } })))),
    "scope for an entry that is not in entries throws"
  );
  fs.rmSync(dir, { recursive: true, force: true });
}

// --- 1c. each scope value is claimed by exactly the predicates that serve it --
// corpus-files.ts spells the two predicates out instead of importing the value
// constant (that import would pull the validator in), so pin the ownership here:
// a swapped or over-broad predicate has to fail this, not just an unclaimed value.
const scopeClaims: Array<[string, boolean, boolean]> = [
  ["live", true, false],
  ["stub", false, true],
  ["both", true, true],
];
for (const value of GOLDEN_SCOPE_VALUES) {
  const claim = scopeClaims.find(([scope]) => scope === value);
  assert(claim !== undefined, "the store test knows which predicates claim " + value);
  if (!claim) continue;
  assert(isLiveScope(value) === claim[1], value + ": isLiveScope claim");
  assert(isStubScope(value) === claim[2], value + ": isStubScope claim");
}
assert(
  !isLiveScope("sometimes") && !isStubScope("sometimes"),
  "a value outside the scope vocabulary is claimed by neither predicate"
);

// --- 1d. the closed vocabularies reject a value outside them ----------------
// The governance comment on DOCS_GOLDEN_STABILITY_CLASSES points here: without
// these two, either check could be deleted with every test still green.
const entryProblemsAfter = (mutate: (entry: Record<string, unknown>) => void): string[] => {
  const copy = JSON.parse(JSON.stringify(golden.entries[0])) as Record<string, unknown>;
  mutate(copy);
  return validateDocsGoldenEntry(copy);
};
assert(
  entryProblemsAfter((e) => {
    (e.expected as Record<string, unknown>).mustHitPaths = [{ path: "/install", tolerate: ["draft"] }];
  }).some((problem) => problem.includes("tolerate outside")),
  "a tolerate class outside locale|version|dated is rejected"
);
assert(
  entryProblemsAfter((e) => { e.stability_class = "whatever"; }).some((problem) => problem.includes("stability_class outside")),
  "a stability_class outside controlled|frozen-spec|external is rejected"
);

// --- 2. every entry validates against the entry schema ----------------------
const entryProblems = validateDocsGoldenSet(golden);
assert(entryProblems.length === 0, "all entries valid: " + entryProblems.join(" | "));

// --- 3. every provenance anchor is honest: live refs resolve on disk, external
// are URLs, .scratch refs are declared history, not promised as live ---------
for (const e of golden.entries) {
  if (e.provenance.type === "external-community") {
    assert(/^https?:\/\//.test(e.provenance.ref), e.id + ": external provenance is a URL");
  } else if (isScratchRef(e.provenance.ref)) {
    // .scratch/ is untracked since 3f85fee8 (.gitignore:53 — never AGENTS.md):
    // a clean checkout (CI) cannot resolve it, so the entry must mark it
    // historical-local instead of pretending the anchor is revisitable.
    assert(e.provenance.refStatus === "historical-local", e.id + ": .scratch provenance declares historical-local");
    assert(
      isWellFormedScratchRef(e.provenance.ref),
      e.id + ": historical-local provenance ref is a well-formed .scratch path: " + e.provenance.ref
    );
  } else {
    assert(e.provenance.refStatus === undefined, e.id + ": live provenance carries no historical-local marker");
    assert(
      fs.existsSync(path.join(root, e.provenance.ref)),
      e.id + ": internal provenance ref resolves: " + e.provenance.ref
    );
  }
}
// --- 3b. the marker is a guard, not an escape hatch: the validator must
// REJECT both directions (prior art: the tombstone negative case in 5b). ---
{
  const historical = golden.entries.find((e) => e.provenance.refStatus === "historical-local");
  assert(!!historical, "a historical-local sample exists to be de-marked (the marker is exercised, not decorative)");
  if (historical) {
    const unmarked = JSON.parse(JSON.stringify(historical));
    delete unmarked.provenance.refStatus;
    const problems = validateDocsGoldenEntry(unmarked);
    assert(
      problems.some((x) => x.includes("for a .scratch/ ref")),
      "validator rejects an unmarked .scratch ref (" + problems.join(" | ") + ")"
    );
  }
  const live = golden.entries.find((e) => e.provenance.refStatus === undefined && !isScratchRef(e.provenance.ref));
  assert(!!live, "a live sample exists to smuggle the marker onto (both classes are represented)");
  if (live) {
    const smuggled = JSON.parse(JSON.stringify(live));
    smuggled.provenance.refStatus = "historical-local";
    const problems = validateDocsGoldenEntry(smuggled);
    assert(
      problems.some((x) => x.includes("well-formed")),
      "validator rejects a historical-local marker on a non-.scratch ref (" + problems.join(" | ") + ")"
    );
  }
}

// --- 3c. the trigger is local-only, separator-agnostic, case-insensitive,
// segment-bounded, and covers the bare .scratch directory ---------------------
// CodeRabbit #80 rounds 1–3 (every finding reproduced against the code first): these
// spellings have no corpus row, so 3b's validator-level negatives can't reach them —
// 3c pins the classification they must land in, and the validator consequences
// ride on the marker rule and the shape rule that 3b already pins on real entries.
assert(
  !isScratchRef("https://example.com/.scratch/guide"),
  "an external URL containing /.scratch/ is not classified as a local scratch ref"
);
assert(
  isScratchRef(".scratch\\grill-round-99\\handoffs\\next-round.md"),
  "a backslash spelling of .scratch is still classified as a scratch ref"
);
assert(
  isScratchRef(".scratch"),
  "the bare .scratch directory is classified as a scratch ref (it exists on the author's host, never in CI)"
);
assert(
  isScratchRef(".SCRATCH/notes.md"),
  "a case variant of .scratch is classified as a scratch ref (on a core.ignorecase host it IS the ignored directory)"
);
assert(
  !isScratchRef(".scratchpad"),
  "the trigger is segment-bounded, so .scratchpad stays a live path"
);

// --- 4. both provenance classes are exercised --------------------------------
const provTypes = new Set(golden.entries.map((e) => e.provenance.type));
assert(provTypes.has("internal-dogfood"), "at least one internal-dogfood entry");
assert(provTypes.has("external-community"), "at least one external-community entry");

// --- 5. the manifest declares every dimension and stays consistent ----------
const manifest = JSON.parse(fs.readFileSync(path.join(root, "eval-looks.coverage.json"), "utf8")) as CoverageManifest;
const manifestProblems = validateCoverageManifest(manifest);
assert(manifestProblems.length === 0, "coverage manifest valid: " + manifestProblems.join(" | "));

const docs = loadDomain(path.join(root, "domains", "docs.toml"));
const allowlist = docs.sources.urlAllowlist ?? [];
assert(allowlist.length >= 3, "docs.toml urlAllowlist has the first-party hosts");
const crossProblems = crossCheckDocsGolden(golden, manifest, allowlist);
assert(crossProblems.length === 0, "entries vs manifest vs allowlist consistent: " + crossProblems.join(" | "));

// --- 5b. /: cell tombstones are explicit + machine-checked ---
// A demoted cell leaves the measurable set by design: it holds no scope, no
// expected.vertical and no injected spec, and its reason code must come from
// the closed vocabulary. The negative direction (a free-text code) must be
// REJECTED — the closed list is a guard, not a convention.
{
  const tombstoned = golden.entries.filter((e) => e.tombstone !== undefined);
  assert(tombstoned.length >= 1, "at least one tombstoned cell exists (demotion is an explicit declaration)");
  for (const t of tombstoned) {
    assert(!Object.hasOwn(golden.scopes, t.id), t.id + ": tombstoned entry holds no scope (out of the measurable set by design)");
    assert(
      TOMBSTONE_REASON_CODES.includes(t.tombstone!.reason_code),
      t.id + ": tombstone reason_code inside the controlled vocabulary (got " + String(t.tombstone!.reason_code) + ")"
    );
  }
  const sample = tombstoned[0];
  if (sample) {
    const bad = JSON.parse(JSON.stringify(sample));
    bad.tombstone.reason_code = "free-text-drift-typo";
    const problems = validateDocsGoldenEntry(bad);
    assert(
      problems.some((x) => x.includes("tombstone.reason_code")),
      "validator rejects a free-text tombstone reason code (" + problems.join(" | ") + ")"
    );
  }
}

// --- 6. deferred dimensions carry named entry triggers -----------------------
const deferred = manifest.dimensions.filter((d) => d.status === "deferred");
for (const d of deferred) {
  assert(!!d.entryTrigger && !!d.owner, "deferred dimension " + d.dimension + " names trigger + owner");
}
assert(
  manifest.dimensions.some((d) => d.status === "deferred") || golden.entries.length >= 8,
  "manifest declares deferred dims honestly or the batch stands alone"
);

// --- 7. the ledger no longer carries the corpus; unknown fields survive ------
const ledger = readLooksLedger(path.join(root, "eval-looks.json"));
assert(!Object.hasOwn(ledger, "golden"), "readLooksLedger does not surface a corpus (it lives in eval-golden.json)");
const staleDir = fs.mkdtempSync(path.join(os.tmpdir(), "ans-stale-"));
const staleTmp = path.join(staleDir, "eval-looks.json");
const staleCorpus = path.join(staleDir, "eval-golden.json");
fs.writeFileSync(staleTmp, JSON.stringify({ schema: "anysearch/eval-looks@2", schema_version: 1, golden: { scopes: {}, entries: [] }, looks: [] }), "utf8");
const readStale = () => {
  const lines: string[] = [];
  const realWrite = process.stderr.write;
  process.stderr.write = ((chunk: unknown) => { lines.push(String(chunk)); return true; }) as unknown as typeof process.stderr.write;
  try {
    return { ledger: readLooksLedger(staleTmp), lines };
  } finally {
    process.stderr.write = realWrite;
  }
};
// No corpus beside the ledger: the block is the only copy left, so it stays.
{
  const { ledger: kept, lines: keptErr } = readStale();
  assert(
    JSON.stringify((kept as Record<string, unknown>).golden) === JSON.stringify({ scopes: {}, entries: [] }),
    "a golden block stays when no corpus sits beside the ledger",
  );
  assert(keptErr.some((line) => line.includes(staleTmp) && line.includes("keeping")), "keeping it is reported on stderr, naming the file");
  assert((kept as Record<string, unknown>).schema_version === 1, "keeping golden keeps schema_version");
}
// A corpus that exists but is torn (no entries) cannot replace the block either.
fs.writeFileSync(staleCorpus, JSON.stringify({ schema: "anysearch/docs-golden@1", scopes: { probe: "stub" }, entries: [] }), "utf8");
{
  const { ledger: kept, lines: keptErr } = readStale();
  assert(Object.hasOwn(kept, "golden"), "a golden block stays when the corpus beside it is unreadable");
  assert(keptErr.some((line) => line.includes(staleTmp) && line.includes("keeping")), "keeping it is reported for an unusable corpus too");
}
// Right shape, wrong schema: readGoldenFile rejects it, so the block stays. A
// shallow "looks like a corpus" check dropped the block here and left the next
// reader throwing with the only copy already gone.
const realCorpus = JSON.parse(fs.readFileSync(path.join(root, "eval-golden.json"), "utf8")) as Record<string, unknown>;
fs.writeFileSync(staleCorpus, JSON.stringify({ ...realCorpus, schema: "anysearch/docs-golden@2" }), "utf8");
{
  const { ledger: kept, lines: keptErr } = readStale();
  assert(Object.hasOwn(kept, "golden"), "a golden block stays when the corpus beside it fails the reader");
  assert(keptErr.some((line) => line.includes(staleTmp) && line.includes("keeping")), "keeping it is reported for a corpus the reader rejects");
}
// A corpus the reader accepts makes the block a stale copy: dropped and reported.
fs.copyFileSync(path.join(root, "eval-golden.json"), staleCorpus);
const { ledger: stale, lines: staleErr } = readStale();
assert(!Object.hasOwn(stale, "golden"), "a stale golden block is dropped when the corpus is on disk");
assert(staleErr.some((line) => line.includes(staleTmp)), "dropping a stale golden block is reported on stderr, naming the file");
assert((stale as Record<string, unknown>).schema_version === 1, "dropping golden keeps schema_version");
fs.rmSync(staleDir, { recursive: true, force: true });
const appended = appendLook(
  ledger,
  { key: "t:t", at: "2026-09-14T00:00:00.000Z", look: 1, verdict: "pass", exitCode: 0, reviewerNote: "keep-me" } as LooksLedgerEntry,
  "2026-09-14T00:00:00.000Z",
);
assert(!Object.hasOwn(appended, "golden"), "appendLook does not reintroduce a corpus key");
const tmp = path.join(os.tmpdir(), "ans-b1-looks-" + process.pid + ".json");
writeLooksLedger(tmp, appended);
const re = readLooksLedger(tmp);
assert(!Object.hasOwn(re, "golden"), "writeLooksLedger round-trips a ledger without a corpus");
const reRow = re.looks[re.looks.length - 1] as LooksLedgerEntry & { reviewerNote?: string };
assert(reRow.reviewerNote === "keep-me", "unknown ROW field survives read->append->write");
assert(reRow.verdict === "pass" && reRow.look === 1, "managed row fields survive read->append->write");
fs.rmSync(tmp, { force: true });

// --- 7b.: Tolerant Reader — unknown ROOT fields survive a
// read->append->write cycle byte-for-byte, not merely "readable". The
// schema_version:1 sentinel was stripped once by a field-by-field rebuild.
{
  const KNOWN_ROOT = new Set(["schema", "looks", "compaction"]);
  const unknownKeys = Object.keys(raw).filter((k) => !KNOWN_ROOT.has(k));
  assert(unknownKeys.length >= 1, "eval-looks.json carries unmanaged root fields (schema_version)");
  const tmp2 = path.join(os.tmpdir(), "ans-f17-looks-" + process.pid + ".json");
  writeLooksLedger(tmp2, appended);
  const outText = fs.readFileSync(tmp2, "utf8");
  const out = JSON.parse(outText);
  for (const k of unknownKeys) {
    assert(k in out, "unknown root field " + k + " is still present after append+write");
    assert(JSON.stringify(out[k]) === JSON.stringify(raw[k]), "unknown root field " + k + " round-trips byte-for-byte");
  }
  assert(/"schema_version":\s*1/.test(outText), "written file literally carries the schema_version:1 sentinel");
  assert(Object.keys(out).indexOf("schema_version") === Object.keys(raw).indexOf("schema_version"), "schema_version keeps its original key position (no reordering)");
  fs.rmSync(tmp2, { force: true });
}

// --- 8. loadDomainByNameIn resolution chain ----------------------------------
const viaChain = loadDomainByNameIn("docs", [path.join(root, "domains")]);
assert(viaChain.name === "docs", "loadDomainByNameIn resolves docs from an explicit dir");
let threw = false;
try {
  loadDomainByNameIn("nope", [path.join(root, "domains")]);
} catch (e: any) {
  threw = e.message.includes("not found");
}
assert(threw, "loadDomainByNameIn throws Domain not found after exhausting dirs");


// --- 8b. criteria 1-4 anchors: the golden set must carry ---------
// an out-of-domain must-abstain (c1), a paired in-domain must-hit guard
// against over-refusal (c2), a stub-provider degradation arm (c3), and a
// cold-domain zero-result entry (c4).
{
  const docsAbstain = golden.entries.filter((e) => e.domain === "docs" && e.expected.verdict === "abstain");
  assert(docsAbstain.length >= 1, "c1: docs-domain out-of-domain must-abstain entry exists");
  const pairedHit = golden.entries.find((e) =>
    e.domain === "docs" && e.expected.verdict === "answer" && (e.expected.mustHitHosts?.length ?? 0) > 0);
  assert(!!pairedHit, "c2: paired in-domain must-hit entry exists (over-refusal guard)");
  const stubArm = docsAbstain.find((e) => /domain-filter\.test\.ts|stub-provider/i.test(e.notes ?? "") || e.provenance.ref.includes("domain-filter"));
  assert(!!stubArm, "c3: stub-provider degradation arm is anchored by an abstain entry");
  const coldEntry = golden.entries.find((e) => e.domain !== "docs");
  assert(!!coldEntry, "c4: cold-domain entry exists");
  if (coldEntry) {
    assert(coldEntry.expected.verdict === "abstain", "c4: cold-domain entry asserts abstain");
    assert(!coldEntry.expected.mustHitHosts && !coldEntry.expected.mustHitUrls, "c4: cold-domain entry asserts no mustHit");
  }
}

// --- 9. B4: badcase -> golden regression loop ----------------------
const badcasesRaw = JSON.parse(fs.readFileSync(path.join(root, "eval-badcases.json"), "utf8"));
assert(badcasesRaw.schema === "anysearch/eval-badcases@1", "eval-badcases.json schema");
const badcases = Array.isArray(badcasesRaw.badcases) ? badcasesRaw.badcases : [];
const goldenIds = new Set(golden.entries.map((e) => e.id));
for (const b of badcases) {
  assert(/^docs-bc\d{4}$/.test(b.id), "badcase id shape: " + b.id);
  // 禁合成: every badcase must carry a real observation + a rerunnable command.
  assert(b.observed && typeof b.observed === "object", b.id + " carries an observed block");
  assert(typeof b.evidence?.command === "string" && b.evidence.command.length > 0, b.id + " carries a rerunnable evidence.command");
  if (b.status === "promoted") {
    assert(typeof b.promotedTo === "string" && goldenIds.has(b.promotedTo), b.id + " promotedTo resolves to a golden entry");
    const target = golden.entries.find((e) => e.id === b.promotedTo);
    assert(target!.question.trim() === b.question.trim(), b.id + " promoted question matches " + b.promotedTo + " verbatim");
  }
  if (b.status === "open") {
    assert(
      !golden.entries.some((e) => e.provenance.ref === "eval-badcases.json" && typeof e.notes === "string" && e.notes.includes("from badcase " + b.id)),
      b.id + " open badcase must not already be backfilled"
    );
  }
}
assert(badcases.length >= 1, "at least one real badcase is captured (the loop is seeded, not synthetic)");

console.log("eval-docs-golden.test.ts: " + passed + " passed, " + failed + " failed");
if (failed > 0) process.exit(1);
