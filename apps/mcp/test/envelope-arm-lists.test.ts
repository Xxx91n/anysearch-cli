// envelopeArmLists guards the three arm lists both web tools read off the
// engine envelope. An absent list has to fail the call by name rather than
// become an empty one: `failed: []` reports a total outage as a success that
// names no failed provider, and `cancelled: []` clears `partial`. This pins
// which field the message names, so a host that misses one is told which.
//
// No test framework (repo convention: assert-based, run via `node --import tsx
// --test`).

import assert from "node:assert/strict";
import test from "node:test";
import { envelopeArmLists } from "../src/tools/failure.js";

const full = { providersQueried: ["tavily"], providersCancelled: ["exa"], providersFailed: ["brave"] };
const FIELDS = ["providersQueried", "providersCancelled", "providersFailed"] as const;

test("all three lists pass through under their short names", () => {
  assert.deepEqual(envelopeArmLists(full), { queried: ["tavily"], cancelled: ["exa"], failed: ["brave"] });
});

test("a missing list is named on its own, not all three", () => {
  for (const field of FIELDS) {
    const partial: Record<string, unknown> = { ...full };
    delete partial[field];
    assert.throws(
      () => envelopeArmLists(partial),
      new RegExp("retriever envelope metadata missing " + field + "$"),
      field + " must be the only field named",
    );
  }
});

test("a non-array list counts as missing", () => {
  assert.throws(() => envelopeArmLists({ ...full, providersFailed: "brave" }), /missing providersFailed$/);
  assert.throws(() => envelopeArmLists({ ...full, providersQueried: null }), /missing providersQueried$/);
});

test("absent metadata names all three", () => {
  assert.throws(() => envelopeArmLists(undefined), /missing providersQueried, providersCancelled, providersFailed$/);
  assert.throws(() => envelopeArmLists(null), /missing providersQueried, providersCancelled, providersFailed$/);
});
