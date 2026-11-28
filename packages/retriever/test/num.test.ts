// The one positive-whole-int rule the request deadline, archive row ids, lock
// pids and anchor ids all read. It is a leaf with no imports, so the store and
// kernel can share it without pulling a graph in; these cases pin the boundary
// here rather than borrowing another package's test.
import assert from "node:assert/strict";
import test from "node:test";
import { isPositiveWholeInt } from "../src/num";

test("whole numbers above zero pass", () => {
  for (const good of [1, 2, 1234, Number.MAX_SAFE_INTEGER]) {
    assert.equal(isPositiveWholeInt(good), true, good + " is a positive whole int");
  }
});

test("everything else is refused", () => {
  for (const bad of [0, -0, -1, 0.5, 1.5, -2.5, NaN, Infinity, -Infinity, "1", null, undefined, {}, [], true]) {
    assert.equal(isPositiveWholeInt(bad), false, JSON.stringify(bad) + " must be refused");
  }
});

test("the guard narrows the type", () => {
  const raw: unknown = 7;
  // Compiles only because the predicate is `n is number`; a plain boolean would
  // not narrow `raw` for the arithmetic below.
  assert.equal(isPositiveWholeInt(raw) ? raw + 1 : null, 8);
});
