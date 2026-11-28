// The plain-node corpus checks (scripts/golden-shape.mjs) mirror vocabularies
// this package declares. The gate used to compare them by reading both files as
// text: a quote or layout change red it with no behaviour change, and it could
// only see the shapes it parsed. Compare the values instead — one import, one
// sorted comparison, layout-independent — and let the failure name the
// vocabulary that drifted. Order carries no meaning here (both sides are
// membership lists) so the comparison sorts.
import * as shape from "../../../scripts/golden-shape.mjs";
import { GOLDEN_FILE } from "../src/eval/corpus-files";
import {
  DOCS_GOLDEN_COVERAGE_SCHEMA,
  DOCS_GOLDEN_DIMENSION_VALUES,
  DOCS_GOLDEN_INTENTS,
  DOCS_GOLDEN_SCHEMA,
  DOCS_GOLDEN_STABILITY_CLASSES,
  DOCS_GOLDEN_TOLERATED_SEGMENTS,
  GOLDEN_SCOPE_VALUES,
} from "../src/eval/docs-golden";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const list = (values: readonly string[]): string => JSON.stringify([...values].sort());

const table = (values: Record<string, readonly string[]>): string =>
  JSON.stringify(
    Object.keys(values)
      .sort()
      .map((key) => [key, [...values[key]].sort()]),
  );

assert(
  shape.GOLDEN_FILE === GOLDEN_FILE,
  "GOLDEN_FILE mirror drifted: golden-shape.mjs has " + shape.GOLDEN_FILE + ", corpus-files.ts has " + GOLDEN_FILE,
);
assert(shape.GOLDEN_SCHEMA === DOCS_GOLDEN_SCHEMA, "schema literal mirror drifted");
// The coverage schema has no reader on this side: the backfill imports it to build
// fixtures and ship-gate never checks a manifest, so only this comparison keeps
// the two literals from drifting apart.
assert(
  shape.GOLDEN_COVERAGE_SCHEMA === DOCS_GOLDEN_COVERAGE_SCHEMA,
  "coverage schema mirror drifted: golden-shape.mjs has " + shape.GOLDEN_COVERAGE_SCHEMA + ", docs-golden.ts has " + DOCS_GOLDEN_COVERAGE_SCHEMA,
);
assert(list(shape.GOLDEN_SCOPE_VALUES) === list(GOLDEN_SCOPE_VALUES), "scope vocabulary mirror drifted");
assert(
  list(shape.GOLDEN_STABILITY_CLASSES) === list(DOCS_GOLDEN_STABILITY_CLASSES),
  "stability_class vocabulary mirror drifted",
);
assert(
  list(shape.GOLDEN_TOLERATED_SEGMENTS) === list(DOCS_GOLDEN_TOLERATED_SEGMENTS),
  "tolerate vocabulary mirror drifted",
);
assert(
  table(shape.GOLDEN_DIMENSION_VALUES) === table(DOCS_GOLDEN_DIMENSION_VALUES),
  "dimension vocabulary mirror drifted",
);
// DOCS_GOLDEN_INTENTS is a second list beside the dimension table; the
// validator judges entry.intent against it, so it gets its own comparison.
assert(
  list(shape.GOLDEN_DIMENSION_VALUES.intent) === list(DOCS_GOLDEN_INTENTS),
  "intent vocabulary mirror drifted",
);

// scripts/golden-shape.d.mts is a hand-written second copy of these types and
// nothing else reads it, so pin the export list and each export's kind here: a
// name added, dropped or reshaped in the .mjs without the .d.mts following fails
// this test instead of leaving a lying type behind.
const kindOf = (value: unknown): string => {
  if (typeof value === "function") return "function";
  if (Array.isArray(value)) return value.every((v) => typeof v === "string") ? "string[]" : "array";
  return typeof value;
};
const shapeKinds = Object.entries(shape)
  .map(([name, value]) => name + "=" + kindOf(value))
  .sort()
  .join(",");
const declaredKinds = [
  "GOLDEN_COVERAGE_SCHEMA=string",
  "GOLDEN_DIMENSION_VALUES=object",
  "GOLDEN_FILE=string",
  "GOLDEN_SCHEMA=string",
  "GOLDEN_SCOPE_VALUES=string[]",
  "GOLDEN_STABILITY_CLASSES=string[]",
  "GOLDEN_TOLERATED_SEGMENTS=string[]",
  "goldenShapeProblems=function",
  "isLiveScope=function",
]
  .sort()
  .join(",");
assert(shapeKinds === declaredKinds, "golden-shape.mjs exports drifted from golden-shape.d.mts: " + shapeKinds);
