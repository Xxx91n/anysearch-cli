import assert from "node:assert/strict";
import { rankKnowledge } from "../src/knowledge-ranking";

const zh = { rowid: -1, content: "客服邮箱为 help@sample.example。" };
const en = { rowid: -2, content: "Support email is help@sample.example." };
const both = { rowid: -3, content: "客服邮箱 support email" };

// Language only breaks equal relevance: even a tiny rank difference wins.
assert.deepEqual(rankKnowledge("客服邮箱", [[en, zh]]), [en, zh]);
assert.deepEqual(rankKnowledge("客服邮箱", [[en], [zh]]), [zh, en]);
assert.deepEqual(rankKnowledge("support email", [[zh], [en]]), [en, zh]);
assert.deepEqual(rankKnowledge("Acme 邮箱", [[en], [zh]]), [zh, en]);
assert.deepEqual(rankKnowledge("почта", [[en], [{ rowid: -4, content: "Почта поддержки" }]])
  .map((h) => h.rowid), [-4, -2]);
// More evidence outranks language; no language filters or within-lane double votes.
assert.deepEqual(rankKnowledge("客服邮箱", [[zh, en], [en]]), [en, zh]);
assert.deepEqual(rankKnowledge("客服邮箱 email", [[zh, both], [en, both]]), [both, zh, en]);
assert.deepEqual(rankKnowledge("客服邮箱", [[en, en], [zh]]), [zh, en]);
assert.deepEqual(rankKnowledge("123", [[en], [zh]]), [en, zh]);
assert.deepEqual(rankKnowledge("客服邮箱", []), []);
console.log("knowledge ranking: relevance, language ties, cross-language retention and dedup passed");
