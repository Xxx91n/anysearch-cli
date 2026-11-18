// Secret input for `ans auth set` (#301).
//
// Spec S2: the secret must never appear in terminal echo, logs, error details,
// config previews or command arguments. So the key is never a command-line
// argument - it is read from stdin:
//
//   - terminal: characters are read in raw mode and nothing is echoed, so even
//     the length is hidden.
//   - pipe / here-string: the whole stream is read, so scripted use works
//     (`printf '%s' "$KEY" | ans auth set openai`) without the key showing up
//     in the process list, which is exactly what an argument would do.
//
// Escape sequences are swallowed whole. Two ways this matters, and both used to
// corrupt the stored key silently:
//   - a bracketed paste arrives as `ESC [ 200 ~ <payload> ESC [ 201 ~`; dropping
//     only the ESC bytes leaves the literal marker glued to the key;
//   - any other CSI sequence (arrow key = `ESC [ A`, Home = `ESC [ 1 ~`) has
//     parameter and final bytes after the ESC; only dropping the ESC lets `A`
//     or `1~` flow into the key.
// `cleanSecret` only rejects control bytes, so neither would be caught later.

import type { Readable, Writable } from "node:stream";

export class SecretInputCancelled extends Error {
  constructor() {
    super("cancelled");
    this.name = "SecretInputCancelled";
  }
}

/**
 * Seams for the tests: they hand in a readable stream (a pipe, as a scripted
 * run gives) and a sink, so nothing has to replace process.stdin globally.
 * Production calls readSecret with no options and gets the real terminal.
 */
export interface SecretInputIO {
  input?: Readable & { isTTY?: boolean; isRaw?: boolean; setRawMode?: (raw: boolean) => void };
  output?: Writable;
}

/** Read a secret from stdin without echoing it. */
export async function readSecret(prompt: string, io: SecretInputIO = {}): Promise<string> {
  // Resolved at call time, not at import time: a caller (or a test) may have
  // swapped console I/O, and raw-mode detection has to look at the real stdin.
  const input = io.input ?? process.stdin;
  const output = io.output ?? process.stderr;

  if (!input.isTTY || typeof input.setRawMode !== "function") {
    return readPipedSecret(input, output, prompt);
  }

  output.write(prompt);
  return readFromTerminal(input, output);
}

async function readFromTerminal(
  input: NonNullable<SecretInputIO["input"]>,
  output: Writable,
): Promise<string> {
  const setRawMode = input.setRawMode!;
  let value = "";
  // Escape bookkeeping. `escape` is the CSI parameter/final byte accumulator;
  // `inPaste` tracks whether a bracketed paste is open (so a newline inside it
  // does not end the read).
  let escape = "";
  let inEscape = false;
  let inPaste = false;

  // Raw mode is entered INSIDE the try: if the terminal refuses it, the finally
  // still runs and the caller never receives a half-configured stdin.
  const wasRaw = input.isRaw ?? false;
  setRawMode(true);
  input.resume();
  try {
    for await (const chunk of input) {
      for (const ch of String(chunk)) {
        // Ctrl+C: raw mode turns off the terminal's own handler.
        if (ch === "\u0003") throw new SecretInputCancelled();
        if (ch === "\u001b") {
          inEscape = true;
          escape = "";
          continue;
        }
        if (inEscape) {
          escape += ch;
          // Text editors' paste markers are sequences we must recognize rather
          // than skip: their payload is what the user pasted.
          if (PASTE_MARKERS.includes(escape)) {
            inPaste = escape === PASTE_OPEN;
            inEscape = false;
            continue;
          }
          // Keep collecting while this still looks like the prefix of a marker.
          if (PASTE_MARKERS.some((m) => m.startsWith(escape))) continue;
          // Any other CSI sequence ends at its final byte and is dropped whole.
          // Note `[` itself is in the 0x40-0x7E range, so the marker check above
          // has to run first - otherwise "[200~" would end at the "[".
          if (isCsiFinal(ch)) inEscape = false;
          continue;
        }
        if (ch === "\r" || ch === "\n") {
          if (inPaste) continue; // a newline inside a paste is not "done"
          output.write("\n");
          return value;
        }
        if (ch === "\u007f" || ch === "\b") {
          value = value.slice(0, -1);
          continue;
        }
        if (ch >= " ") value += ch;
      }
    }
    throw new Error("stdin closed before a key was entered");
  } finally {
    setRawMode(wasRaw);
    input.pause();
  }
}

/**
 * True for the byte that ends a CSI sequence: the first character in the
 * 0x40-0x7E range. Arrow keys end at a letter, Home/End at `~`.
 */
function isCsiFinal(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return code >= 0x40 && code <= 0x7e;
}

/** Bracketed-paste markers; their payload must be kept, the markers themselves not. */
const PASTE_OPEN = "[200~";
const PASTE_CLOSE = "[201~";
const PASTE_MARKERS = [PASTE_OPEN, PASTE_CLOSE];

async function readPipedSecret(
  input: Readable,
  output: Writable,
  prompt: string,
): Promise<string> {
  output.write(prompt);
  let value = "";
  for await (const chunk of input) value += String(chunk);
  output.write("\n");
  return value;
}

/**
 * Post-process whatever was entered: trim the surrounding whitespace a copy
 * leaves behind, and reject the obvious paste accidents instead of storing
 * them. A key with an interior newline is always an accident (two lines
 * pasted), and a key with control characters would break the HTTP header it
 * ends up in.
 */
export function cleanSecret(raw: string): string {
  const value = raw.trim();
  if (value === "") throw new Error("the API key is empty");
  if (/[\r\n]/.test(value)) {
    throw new Error("that looks like more than one line; paste only the key itself");
  }
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error("the key contains control characters; paste the key itself, not terminal escape codes");
  }
  return value;
}
