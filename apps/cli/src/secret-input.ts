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
// What the terminal path accepts and what it drops:
//   - printable bytes are kept, DEL and BS delete the last byte;
//   - Enter finishes the read;
//   - Ctrl+C cancels;
//   - a bracketed paste keeps its payload whole, including newlines and escape
//     bytes inside it, and drops only the `ESC [ 200 ~` / `ESC [ 201 ~` markers;
//   - any other escape sequence (arrow keys, Home, End) is dropped whole - its
//     parameter and final bytes never reach the key.
// `cleanSecret` then rejects what a paste accident still produces: an empty
// value, an embedded newline, or control characters.

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
  // Escape bookkeeping. `escape` is the CSI parameter/final byte accumulator,
  // `inEscape` says a sequence is open, `inPaste` says a bracketed paste is
  // open, and `pasteBuffer` holds the paste payload until its closing marker
  // arrives (the marker can be split across chunks).
  let escape = "";
  let inEscape = false;
  let inPaste = false;
  let pasteBuffer = "";

  // Raw mode is entered INSIDE the try: if the terminal refuses it, the finally
  // still runs and the caller never receives a half-configured stdin.
  const wasRaw = input.isRaw ?? false;
  try {
    setRawMode(true);
    input.resume();
    for await (const chunk of input) {
      for (const ch of String(chunk)) {
        // Ctrl+C: raw mode turns off the terminal's own handler.
        if (ch === "\u0003") throw new SecretInputCancelled();

        // Inside a paste the payload is data, not terminal commands: the only
        // sequence that means anything is the closing marker, and it arrives
        // with its own ESC byte. Interpreting other escapes here would delete
        // part of a pasted key.
        if (inPaste) {
          pasteBuffer += ch;
          if (pasteBuffer.endsWith(PASTE_CLOSE_SEQUENCE)) {
            value += pasteBuffer.slice(0, -PASTE_CLOSE_SEQUENCE.length);
            pasteBuffer = "";
            inPaste = false;
          }
          continue;
        }

        if (ch === "\u001b") {
          inEscape = true;
          escape = "";
          continue;
        }
        if (inEscape) {
          // Enter while a truncated escape is pending: drop the fragment and
          // treat the keystroke as "done" instead of losing the whole read.
          if (ch === "\r" || ch === "\n") {
            inEscape = false;
            escape = "";
            output.write("\n");
            return value;
          }
          // A sequence only starts with an introducer: "[" (CSI) or "O" (SS3,
          // which some terminals use for arrow keys). Any other character right
          // after ESC means the ESC was stray (Alt+key, a paste artifact) - drop
          // the ESC and keep the character as ordinary input.
          if (escape === "") {
            if (ch !== "[" && ch !== "O") {
              inEscape = false;
              if (ch >= " ") value += ch;
              continue;
            }
            escape = ch;
            continue;
          }
          escape += ch;
          // A complete bracketed-paste marker: its payload follows, and the
          // markers themselves are not part of the key.
          if (PASTE_MARKERS.includes(escape)) {
            inPaste = escape === PASTE_OPEN;
            pasteBuffer = "";
            inEscape = false;
            continue;
          }
          // Still possible to become a marker - keep collecting.
          if (PASTE_MARKERS.some((m) => m.startsWith(escape))) continue;
          // SS3 carries exactly one character after "O"; anything else is a CSI
          // sequence, which ends at its final byte. Everything after the
          // introducer counts, so a digit parameter never ends it early.
          if (escape.startsWith("O")) {
            inEscape = false;
            continue;
          }
          if (isCsiFinal(ch)) inEscape = false;
          continue;
        }
        if (ch === "\r" || ch === "\n") {
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
    try { setRawMode(wasRaw); } catch { /* the terminal may already be gone */ }
    try { input.pause(); } catch { /* already paused */ }
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

/**
 * Bracketed-paste markers as they arrive on the wire. The payload between them
 * is kept; the markers themselves are not part of the key. `PASTE_*` are the
 * forms the accumulator holds after the leading ESC was consumed, which is what
 * the in-escape branch matches against.
 */
const PASTE_OPEN = "[200~";
const PASTE_CLOSE = "[201~";
const PASTE_MARKERS = [PASTE_OPEN, PASTE_CLOSE];
/** The raw form the payload buffer has to see to know a paste ended. */
const PASTE_CLOSE_SEQUENCE = "\u001b" + PASTE_CLOSE;

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
