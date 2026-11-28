// Structural corpus checks shared by ship-gate and the badcase backfill, so the
// two plain-node consumers cannot drift on the file name, schema literal or
// scope vocabulary. packages/store/src/eval/docs-golden.ts holds the TS
// originals these strings mirror; this module has no imports on purpose.
export const GOLDEN_FILE = "eval-golden.json";
export const GOLDEN_SCHEMA = "anysearch/docs-golden@1";
export const GOLDEN_SCOPE_VALUES = ["stub", "live", "both"];

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
