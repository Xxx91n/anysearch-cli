// ADR-0061 B1/D5: docs-domain golden batch + coverage manifest contract.
// The golden set lives as eval-looks.json's top-level `golden` collection — the
// same file as the OF look ledger. This test is the mechanical honesty loop:
// entry schema, provenance revisitability, allowlist subset, manifest
// covered|deferred consistency, and ledger writer round-trip preservation.
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
import {
  DOCS_GOLDEN_DIMENSIONS,
  validateCoverageManifest,
  validateDocsGoldenSet,
  crossCheckDocsGolden,
  type DocsGoldenSet,
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

// --- 1. the file keeps its ledger shape and carries a golden set ------------
const raw = JSON.parse(fs.readFileSync(path.join(root, "eval-looks.json"), "utf8"));
assert(raw.schema === "anysearch/eval-looks@2", "eval-looks.json keeps schema anysearch/eval-looks@2");
assert(Array.isArray(raw.looks), "looks[] ledger rows intact");
assert(raw.golden && typeof raw.golden === "object", "golden top-level collection present");
const golden = raw.golden as DocsGoldenSet;
assert(golden.entries.length >= 8 && golden.entries.length <= 14, "first batch size in the 8-14 shelf gate (got " + golden.entries.length + ")");

// --- 2. every entry validates against the entry schema ----------------------
const entryProblems = validateDocsGoldenSet(golden);
assert(entryProblems.length === 0, "all entries valid: " + entryProblems.join(" | "));

// --- 3. provenance is revisitable: internal refs exist, external are URLs ---
for (const e of golden.entries) {
  if (e.provenance.type === "external-community") {
    assert(/^https?:\/\//.test(e.provenance.ref), e.id + ": external provenance is a URL");
  } else {
    assert(
      fs.existsSync(path.join(root, e.provenance.ref)),
      e.id + ": internal provenance ref resolves: " + e.provenance.ref
    );
  }
}

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
assert(allowlist.length >= 3, "docs.toml urlAllowlist has the D-004 first-party hosts");
const crossProblems = crossCheckDocsGolden(golden, manifest, allowlist);
assert(crossProblems.length === 0, "entries vs manifest vs allowlist consistent: " + crossProblems.join(" | "));

// --- 6. deferred dimensions carry named entry triggers -----------------------
const deferred = manifest.dimensions.filter((d) => d.status === "deferred");
for (const d of deferred) {
  assert(!!d.entryTrigger && !!d.owner, "deferred dimension " + d.dimension + " names trigger + owner");
}
assert(
  manifest.dimensions.some((d) => d.status === "deferred") || golden.entries.length >= 8,
  "manifest declares deferred dims honestly or the batch stands alone"
);

// --- 7. ledger writers must not destroy the golden collection ----------------
const ledger = readLooksLedger(path.join(root, "eval-looks.json"));
assert(ledger.golden !== undefined && ledger.golden.entries.length === golden.entries.length, "readLooksLedger surfaces golden");
const tmp = path.join(os.tmpdir(), "ans-b1-looks-" + process.pid + ".json");
writeLooksLedger(tmp, ledger);
const re = readLooksLedger(tmp);
assert(re.golden !== undefined && re.golden.entries.length === golden.entries.length, "writeLooksLedger round-trips golden");
const appended = appendLook(ledger, { key: "t:t", at: "2026-09-14T00:00:00.000Z", look: 1, verdict: "pass", exitCode: 0 } as LooksLedgerEntry, "2026-09-14T00:00:00.000Z");
assert(appended.golden !== undefined, "appendLook preserves golden through the look append");
fs.rmSync(tmp, { force: true });

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


// --- 8b. ADR-0062 criteria 1-4 anchors: the golden set must carry ---------
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

// --- 9. ADR-0061 B4: badcase -> golden regression loop ----------------------
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
    assert(!golden.entries.some((e) => e.provenance.ref === "eval-badcases.json#" + b.id), b.id + " open badcase must not already be backfilled");
  }
}
assert(badcases.length >= 1, "at least one real badcase is captured (the loop is seeded, not synthetic)");

console.log("eval-docs-golden.test.ts: " + passed + " passed, " + failed + " failed");
if (failed > 0) process.exit(1);
