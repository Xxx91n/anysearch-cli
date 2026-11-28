// Structural corpus checks for eval-golden.json, shared by ship-gate and the
// badcase backfill. The vocabularies' TS originals live in the store package:
// eval/docs-golden.ts, plus GOLDEN_FILE in eval/corpus-files.ts.
// packages/store/test/eval-golden-vocab-parity.test.ts compares the two by value.
// This is the outermost layer only: schema, entries/scopes shape (ids present and
// unique), scope vocabulary and the tombstone-vs-scope pairing. The per-entry
// rules — id format, intent, expected — live in the store validator, which the
// backfill runs itself and ship-gate only runs through step 3's test suite
// (--quick skips that step).
export const GOLDEN_FILE = "eval-golden.json";
export const GOLDEN_SCHEMA = "anysearch/docs-golden@1";
export const GOLDEN_COVERAGE_SCHEMA = "anysearch/eval-looks-coverage@1";
export const GOLDEN_SCOPE_VALUES = ["stub", "live", "both"];
export const GOLDEN_STABILITY_CLASSES = ["controlled", "frozen-spec", "external"];
export const GOLDEN_TOLERATED_SEGMENTS = ["locale", "version", "dated"];
// Mirrors DOCS_GOLDEN_DIMENSION_VALUES: the eight slices a golden row may tag.
export const GOLDEN_DIMENSION_VALUES = {
  intent: ["factoid", "howto", "troubleshoot", "comparison", "reference"],
  "source-tier": ["spec", "reference", "settings"],
  freshness: ["stable", "active", "supersede-event"],
  lang: ["zh", "en"],
  attribution: ["claim", "domain"],
  hops: ["single", "multi"],
  negative: ["abstain"],
  adversarial: ["injection"],
};

// The problems that make a parsed corpus unusable, in file order. The caller
// names the file and decides how to exit.
export function goldenShapeProblems(doc) {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return ["root must be an object"];
  const problems = [];
  if (doc.schema !== GOLDEN_SCHEMA) problems.push("schema must be " + GOLDEN_SCHEMA);
  if (!Array.isArray(doc.entries)) {
    problems.push("entries must be an array");
  } else if (doc.entries.length === 0) {
    problems.push("has no entries");
  } else if (!doc.entries.every((e) => e && typeof e === "object" && !Array.isArray(e))) {
    problems.push("entries must contain objects");
  } else {
    // readGoldenFile rejects a non-string or repeated id; without the same two
    // checks a duplicated row passes this gate and throws when the executor
    // opens the file, and ship-gate's anchor lookup silently takes the first.
    const seen = new Set();
    for (const e of doc.entries) {
      if (typeof e.id !== "string" || e.id.length === 0) {
        problems.push("entry id must be a non-empty string");
        continue;
      }
      if (seen.has(e.id)) problems.push("duplicate id: " + e.id);
      seen.add(e.id);
    }
  }
  if (!doc.scopes || typeof doc.scopes !== "object" || Array.isArray(doc.scopes)) {
    problems.push("scopes must be an object");
  } else if (Object.keys(doc.scopes).length === 0) {
    problems.push("scopes must not be empty");
  } else {
    for (const [id, scope] of Object.entries(doc.scopes)) {
      if (!GOLDEN_SCOPE_VALUES.includes(scope)) {
        problems.push("scope for " + id + " must be " + GOLDEN_SCOPE_VALUES.join("|") + " (got " + JSON.stringify(scope) + ")");
      }
    }
  }
  // Same pairing readGoldenFile makes: a tombstoned row has no scope, every
  // other row has exactly one. Gated on ids and scopes being readable rather
  // than on "no problems at all": a bad schema or one wrong scope value must
  // not hide every pairing and anchor error behind a second run.
  const idsReadable = Array.isArray(doc.entries) && doc.entries.length > 0 &&
    doc.entries.every((e) => e && typeof e === "object" && !Array.isArray(e) && typeof e.id === "string" && e.id.length > 0);
  const scopesReadable = !!doc.scopes && typeof doc.scopes === "object" && !Array.isArray(doc.scopes);
  if (idsReadable && scopesReadable) {
    const scopes = doc.scopes;
    const ids = new Set(doc.entries.map((e) => e.id));
    for (const e of doc.entries) {
      const scoped = Object.prototype.hasOwnProperty.call(scopes, e.id);
      if (e.tombstone !== undefined) {
        if (scoped) problems.push("tombstoned entry " + e.id + " must not carry a scope");
        continue;
      }
      if (!scoped) problems.push("entry " + e.id + " has no scope");
      // The anchor checks read these two fields; without them a row missing one
      // gets reported as a missing anchor instead of as the row that broke.
      if (typeof e.domain !== "string" || e.domain.length === 0) problems.push("entry " + e.id + " has no domain");
      const verdict = e.expected && typeof e.expected === "object" ? e.expected.verdict : undefined;
      if (verdict !== "answer" && verdict !== "abstain") problems.push("entry " + e.id + " expected.verdict must be answer|abstain");
    }
    for (const id of Object.keys(scopes)) {
      if (!ids.has(id)) problems.push("scope for unknown entry " + id);
    }
  }
  return problems;
}
