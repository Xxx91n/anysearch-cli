// The arm lists are the host boundary for the envelope contract: a list that is
// absent, or that holds something other than a provider id, is refused by name.
// Without the element check a host writing `providersCancelled: [null]` clears
// `partial`, the CLI prints "Providers cancelled: null" and `--json` carries a
// null id — a silent success built on a malformed envelope.
import assert from "node:assert/strict";
import test from "node:test";
import { envelopeArmLists } from "../src/envelope-arms";

const full = { providersQueried: ["tavily"], providersCancelled: ["exa"], providersFailed: ["brave"] };

test("the three lists come back under their short names", () => {
  assert.deepEqual(envelopeArmLists(full), { queried: ["tavily"], cancelled: ["exa"], failed: ["brave"] });
});

test("a missing list is named on its own", () => {
  assert.throws(() => envelopeArmLists({ ...full, providersFailed: undefined }), /missing providersFailed$/);
  assert.throws(() => envelopeArmLists({ ...full, providersQueried: "tavily" }), /missing providersQueried$/);
});

test("a list holding a non-string or empty id is refused as missing", () => {
  for (const bad of [[null], [{ id: "exa" }], [""], [7]]) {
    assert.throws(
      () => envelopeArmLists({ ...full, providersCancelled: bad }),
      /retriever envelope metadata missing providersCancelled$/,
      JSON.stringify(bad) + " must be refused",
    );
  }
});
