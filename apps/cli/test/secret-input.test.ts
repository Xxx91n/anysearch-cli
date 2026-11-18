// #301 — the raw-mode key reader, driven through a fake terminal.
//
// This is the path a user actually takes (`ans auth set` at a terminal), and it
// has two failure modes a pipe-based test cannot see:
//   1. a bracketed paste must not leak its "[200~" / "[201~" markers into the key;
//   2. a stray escape sequence (arrow key) must not corrupt what was typed.
// Both leave the STORED key subtly wrong, and the failure only shows up later as
// an auth error with no hint - so they are pinned here.

import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";

import { cleanSecret, readSecret, SecretInputCancelled, type SecretInputIO } from "../src/secret-input";

/** A fake TTY stdin: `isTTY` true so the raw path runs, and raw mode is recorded. */
function fakeTty(chunks: string[]): { input: SecretInputIO["input"]; rawModes: boolean[] } {
  const stream = new PassThrough() as PassThrough & {
    isTTY: boolean; isRaw: boolean; setRawMode: (raw: boolean) => void;
  };
  stream.isTTY = true;
  stream.isRaw = false;
  const rawModes: boolean[] = [];
  stream.setRawMode = (raw: boolean) => { stream.isRaw = raw; rawModes.push(raw); };
  for (const chunk of chunks) stream.write(chunk);
  stream.end();
  return { input: stream as unknown as SecretInputIO["input"], rawModes };
}

function sink(): { output: SecretInputIO["output"]; text: () => string } {
  const stream = new PassThrough();
  let text = "";
  stream.on("data", (d) => { text += d.toString(); });
  return { output: stream as unknown as SecretInputIO["output"], text: () => text };
}

test("typing a key without echo returns exactly what was typed", async () => {
  const { input, rawModes } = fakeTty(["sk-abc", "123", "\r"]);
  const out = sink();
  const value = await readSecret("key: ", { input, output: out.output });
  assert.equal(value, "sk-abc123");
  // Raw mode was entered and given back.
  assert.deepEqual(rawModes, [true, false]);
  // Only the prompt reached the terminal; the key itself never did.
  assert.equal(out.text(), "key: \n");
});

test("a bracketed paste does not leak its markers into the key", async () => {
  // The exact byte sequence a terminal sends for a paste.
  const { input } = fakeTty(["\u001b[200~sk-pasted-key-0123\u001b[201~", "\r"]);
  const out = sink();
  const value = await readSecret("key: ", { input, output: out.output });
  assert.equal(value, "sk-pasted-key-0123");
  assert.ok(!value.includes("200~"), "the opening marker is not part of the key");
  assert.ok(!value.includes("201~"), "the closing marker is not part of the key");
});

test("a newline inside a paste does not end the read half-way", async () => {
  const { input } = fakeTty(["\u001b[200~sk-line-one\nsk-line-two\u001b[201~", "\r"]);
  const out = sink();
  const value = await readSecret("key: ", { input, output: out.output });
  // The paste is taken whole; cleanSecret later rejects the embedded newline
  // rather than silently storing half a key.
  assert.equal(value, "sk-line-onesk-line-two");
});

test("an arrow key does not corrupt what was already typed", async () => {
  const { input } = fakeTty(["sk-abc", "\u001b[A", "def", "\r"]);
  const out = sink();
  const value = await readSecret("key: ", { input, output: out.output });
  assert.equal(value, "sk-abcdef");
});

test("backspace removes one character", async () => {
  const { input } = fakeTty(["sk-abx", "\u007f", "\r"]);
  const out = sink();
  assert.equal(await readSecret("key: ", { input, output: out.output }), "sk-ab");
});

test("Ctrl+C cancels without returning a value", async () => {
  const { input } = fakeTty(["sk-half", "\u0003"]);
  const out = sink();
  await assert.rejects(
    () => readSecret("key: ", { input, output: out.output }),
    (e: Error) => e instanceof SecretInputCancelled,
  );
});

test("a pipe (no TTY) still reads the whole stream", async () => {
  const stream = new PassThrough();
  stream.end("sk-piped\n");
  const out = sink();
  const value = await readSecret("key: ", { input: stream as never, output: out.output });
  assert.equal(value.trim(), "sk-piped");
});

test("cleanSecret rejects what a paste accident produces", () => {
  assert.equal(cleanSecret("  sk-ok  "), "sk-ok");
  assert.throws(() => cleanSecret(""), /empty/);
  assert.throws(() => cleanSecret("sk-one\nsk-two"), /more than one line/);
  assert.throws(() => cleanSecret("sk-\u001b[31mred"), /control characters/);
});
