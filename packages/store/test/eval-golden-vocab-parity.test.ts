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
