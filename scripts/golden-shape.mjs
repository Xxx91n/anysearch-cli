// Structural corpus checks shared by ship-gate and the badcase backfill, so the
// two plain-node consumers cannot drift on the vocabularies the corpus uses.
// The TS originals live in packages/store: GOLDEN_FILE in eval/corpus-files.ts,
// the schema, scope, dimension, stability and tolerate vocabularies in
// eval/docs-golden.ts. ship-gate pins every string below back to that file.
// This module deliberately has no imports.
export const GOLDEN_FILE = "eval-golden.json";
export const GOLDEN_SCHEMA = "anysearch/docs-golden@1";
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
  if (!Array.isArray(doc.entries) || doc.entries.length === 0) {
    problems.push("has no entries");
  } else if (!doc.entries.every((e) => e && typeof e === "object" && !Array.isArray(e))) {
    problems.push("entries must contain objects");
  }
  if (!doc.scopes || typeof doc.scopes !== "object" || Array.isArray(doc.scopes)) {
    problems.push("scopes must be an object");
  } else if (Object.keys(doc.scopes).length === 0) {
    problems.push("scopes must not be empty");
  } else {
    for (const [id, scope] of Object.entries(doc.scopes)) {
      if (!GOLDEN_SCOPE_VALUES.includes(scope)) problems.push("scope for " + id + " must be " + GOLDEN_SCOPE_VALUES.join("|"));
    }
  }
  return problems;
}
