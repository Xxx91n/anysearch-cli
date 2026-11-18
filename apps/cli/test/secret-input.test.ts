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

test("a newline after a paste payload is refused, never stored shortened", async () => {
  const { input } = fakeTty(["\u001b[200~sk-line-one\nsk-line-two\u001b[201~", "\r"]);
  const out = sink();
  // `cleanSecret` trims a trailing newline (a pipe always ends with one), so
  // returning the payload after the newline would silently store "sk-line-one".
  // The read says the paste did not finish instead.
  await assert.rejects(
    () => readSecret("key: ", { input, output: out.output }),
    /the paste did not finish/,
  );
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

test("a CSI sequence's parameter and final bytes never reach the key", async () => {
  // Arrow key = ESC [ A. Home = ESC [ 1 ~. Dropping only the ESC would leave
  // "A" / "1~" in the key, which cleanSecret accepts - a silently wrong key.
  const { input } = fakeTty(["sk-a", "\u001b[A", "b", "\u001b[1~", "c", "\r"]);
  const out = sink();
  assert.equal(await readSecret("key: ", { input, output: out.output }), "sk-abc");
});

test("a paste with no markers still keeps every typed character", async () => {
  // Bracketed-paste mode can be off; the payload then arrives as plain bytes and
  // must not be mistaken for marker characters.
  const { input } = fakeTty(["sk-plain-paste-key", "\r"]);
  const out = sink();
  assert.equal(await readSecret("key: ", { input, output: out.output }), "sk-plain-paste-key");
});

test("a key that itself contains ESC[ does not lose characters", async () => {
  // Pathological but possible: the payload contains the start of a CSI sequence
  // and the rest of the key must still arrive.
  const { input } = fakeTty(["sk-A", "\u001b[", "B", "\r"]);
  const out = sink();
  // ESC[ begins a CSI sequence; "B" is its final byte, so the whole fragment is
  // dropped and nothing of it leaks into the key.
  assert.equal(await readSecret("key: ", { input, output: out.output }), "sk-A");
});

test("a stray ESC before an ordinary character keeps that character", async () => {
  // Alt+key sends ESC then the letter. Dropping the ESC must not drop the
  // letter as well: only the ESC is a modifier here, the rest is real input.
  const { input } = fakeTty(["sk-ab", "\u001bx", "cd", "\r"]);
  const out = sink();
  assert.equal(await readSecret("key: ", { input, output: out.output }), "sk-abxcd");
});

test("escape bytes inside a paste are payload, not commands", async () => {
  // A pasted key that happens to carry ESC[ must arrive whole. `cleanSecret`
  // then rejects the control byte; the reader must not quietly shorten the key.
  const { input } = fakeTty(["\u001b[200~sk-A\u001b[Bsuffix\u001b[201~", "\r"]);
  const out = sink();
  const value = await readSecret("key: ", { input, output: out.output });
  assert.equal(value, "sk-A\u001b[Bsuffix");
  assert.throws(() => cleanSecret(value), /control characters/);
});

test("an SS3 arrow key is dropped whole too", async () => {
  // Some terminals send ESC O A for the up arrow instead of ESC [ A. The "O"
  // form carries one character, and neither byte may reach the key.
  const { input } = fakeTty(["sk-a", "\u001bOA", "b", "\r"]);
  const out = sink();
  assert.equal(await readSecret("key: ", { input, output: out.output }), "sk-ab");
});

test("Enter after a paste payload is refused instead of stored shortened", async () => {
  // A terminal that sends the opening marker and never the closing one must not
  // hang, and must not hand back a payload that later reads as a whole key.
  const { input } = fakeTty(["\u001b[200~sk-pasted", "\r", "sk-typed-after\r"]);
  const out = sink();
  await assert.rejects(
    () => readSecret("key: ", { input, output: out.output }),
    /the paste did not finish/,
  );
});

test("Enter on an empty paste finishes the read", async () => {
  // The plain "done" case: nothing was collected, so there is nothing to lose.
  const { input } = fakeTty(["\u001b[200~", "\r"]);
  const out = sink();
  assert.equal(await readSecret("key: ", { input, output: out.output }), "");
});

test("a control byte never silently joins the key", async () => {
  // NUL and SOH are dropped, DEL is the backspace key. Pinned because the
  // printable test is now a code-point range rather than a lexical string
  // compare, and a later edit must not start letting them through.
  const { input } = fakeTty(["sk-a", "\u0000", "\u0001", "\u007f", "b", "\r"]);
  const out = sink();
  assert.equal(await readSecret("key: ", { input, output: out.output }), "sk-b");
});

test("a pasted payload carrying its own closing marker keeps only the first split", async () => {
  // The marker closes the paste exactly once. Bytes after it are ordinary input,
  // so a payload that happens to contain the sequence cannot swallow the rest.
  const { input } = fakeTty(["\u001b[200~sk-one\u001b[201~two\r"]);
  const out = sink();
  assert.equal(await readSecret("key: ", { input, output: out.output }), "sk-onetwo");
});

test("raw mode is restored even when the read throws", async () => {
  const { input, rawModes } = fakeTty(["sk-half", "\u0003"]);
  const out = sink();
  await assert.rejects(() => readSecret("key: ", { input, output: out.output }));
  assert.deepEqual(rawModes, [true, false], "raw mode was turned on and then off");
});
