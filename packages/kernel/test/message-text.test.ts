// Message-shape helpers for the inject seam (#104).
// Contract provenance: pi-agent-core 0.84.2 normalizes `agent.prompt("…")` into
// { role: "user", content: [{ type: "text", text: "…" }] } (verified against the
// published package). String-only inject code therefore never matched the real
// runtime shape — this file pins both shapes.
// Run: node --import tsx --test test/message-text.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { readMessageText, appendMessageText, prependMessageText } from "../src/message-text";

// === read ===

test("string content reads as a string target", () => {
  assert.deepEqual(readMessageText({ role: "user", content: "hello" }), { text: "hello", kind: "string" });
});

test("content-block array reads as a blocks target, text blocks joined in order", () => {
  const t = readMessageText({ role: "user", content: [{ type: "text", text: "a" }, { type: "image", data: "x" }, { type: "text", text: "b" }] });
  assert.deepEqual(t, { text: "a\nb", kind: "blocks" });
});

test("a non-empty string stays distinguishable from empty", () => {
  assert.deepEqual(readMessageText({ role: "user", content: "" }), { text: "", kind: "string" });
});

test("no text channel reads as null (not as empty text)", () => {
  assert.equal(readMessageText({ role: "user", content: [{ type: "image", data: "x" }] }), null);
  assert.equal(readMessageText({ role: "user", content: [] }), null);
  assert.equal(readMessageText({ role: "user", content: 42 }), null);
  assert.equal(readMessageText({ role: "user" }), null);
  assert.equal(readMessageText(null), null);
  assert.equal(readMessageText(undefined), null);
});

test("malformed blocks are ignored, not fatal", () => {
  assert.equal(readMessageText({ role: "user", content: [null, 7, { type: "text" }, { text: "no type" }] }), null);
  assert.deepEqual(
    readMessageText({ role: "user", content: [null, { type: "text", text: "ok" }] }),
    { text: "ok", kind: "blocks" },
  );
});

// === append ===

test("append to a string keeps the string shape", () => {
  const out: any = appendMessageText({ role: "user", content: "q" }, "\n\nX", { kind: "string", text: "q" });
  assert.equal(out.content, "q\n\nX");
  assert.equal(out.role, "user");
});

test("append to blocks edits the text block in place and preserves block count", () => {
  const input = { role: "user", content: [{ type: "text", text: "q" }] };
  const out: any = appendMessageText(input, "\n\nX", { kind: "blocks", text: "q" });
  assert.equal(out.content.length, 1, "no extra block");
  assert.equal(out.content[0].text, "q\n\nX");
});

test("append to blocks targets the LAST text block (trailing text wins)", () => {
  const out: any = appendMessageText({ role: "user", content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] }, "!", { kind: "blocks", text: "a\nb" });
  assert.equal(out.content[0].text, "a", "earlier text block untouched");
  assert.equal(out.content[1].text, "b!", "last text block appended");
});

test("append preserves non-text blocks verbatim and does not mutate the input", () => {
  const image = { type: "image", data: "b64" };
  const input = { role: "user", content: [image, { type: "text", text: "q" }] };
  const out: any = appendMessageText(input, "!", { kind: "blocks", text: "q" });
  assert.deepEqual(out.content[0], image);
  assert.equal(out.content[1].text, "q!");
  assert.deepEqual(input, { role: "user", content: [image, { type: "text", text: "q" }] }, "input untouched");
  assert.notEqual(out.content[0], image, "block object is copied, not aliased");
});

test("append adds a trailing text block when the array has no text block", () => {
  const out: any = appendMessageText({ role: "user", content: [{ type: "image" }] }, "X", { kind: "blocks", text: "" });
  assert.equal(out.content.length, 2);
  assert.deepEqual(out.content[1], { type: "text", text: "X" });
});

test("append refuses a shape mismatch instead of guessing (returns null)", () => {
  assert.equal(appendMessageText({ role: "user", content: 42 }, "X", { kind: "string", text: "" }), null);
  assert.equal(appendMessageText({ role: "user", content: "s" }, "X", { kind: "blocks", text: "" }), null);
  assert.equal(appendMessageText({ role: "user", content: null }, "X", { kind: "blocks", text: "" }), null);
});

test("append with an empty suffix is a no-op passthrough", () => {
  const input = { role: "user", content: "q" };
  assert.deepEqual(appendMessageText(input, "", { kind: "string", text: "q" }), input);
});

// === prepend ===

test("prepend to blocks puts the prefix on the first text block only", () => {
  const out: any = prependMessageText({ role: "user", content: [{ type: "image" }, { type: "text", text: "q" }, { type: "text", text: "r" }] }, "<p>\n\n", { kind: "blocks", text: "q\nr" });
  assert.equal(out.content.length, 3, "block count preserved");
  assert.equal(out.content[1].text, "<p>\n\nq", "first text block prefixed");
  assert.equal(out.content[2].text, "r", "later text block untouched");
});

test("prepend to a string keeps the string shape", () => {
  const out: any = prependMessageText({ role: "user", content: "q" }, "<p>\n\n", { kind: "string", text: "q" });
  assert.equal(out.content, "<p>\n\nq");
});

test("prepend adds a leading text block when there is none", () => {
  const out: any = prependMessageText({ role: "user", content: [{ type: "image" }] }, "P", { kind: "blocks", text: "" });
  assert.deepEqual(out.content[0], { type: "text", text: "P" });
  assert.deepEqual(out.content[1], { type: "image" });
});

// === round trip on the real pi shape ===

test("real pi shape round-trips: read -> append -> read", () => {
  const piUserTurn = { role: "user", content: [{ type: "text", text: "how do I reach the wiki?" }], timestamp: 1 };
  const target = readMessageText(piUserTurn)!;
  const injected: any = appendMessageText(piUserTurn, "\n\n[RAG Context] block", target);
  assert.equal(readMessageText(injected)!.text, "how do I reach the wiki?\n\n[RAG Context] block");
  assert.equal(injected.timestamp, 1, "other message fields survive");
});
