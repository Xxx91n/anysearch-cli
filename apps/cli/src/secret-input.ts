// Secret input for `ans auth set` (#301).
//
// Spec S2: the secret must never appear in terminal echo, logs, error details,
// config previews or command arguments. So the key is never a command-line
// argument - it is read from stdin:
//
//   - terminal: characters are read in raw mode and nothing is echoed; the
//     prompt shows a fixed placeholder instead, so even the length is hidden.
//   - pipe / here-string: the whole stream is read, so scripted use works
//     (`printf '%s' "$KEY" | ans auth set openai`) without the key showing up
//     in the process list, which is exactly what an argument would do.
//
// Ctrl+C in raw mode is handled here because raw mode turns off the terminal's
// own handler: it cancels the read and reports "cancelled" rather than
// swallowing the interrupt.

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

  // Raw mode: keystrokes arrive one at a time and the terminal does not echo.
  output.write(prompt);
  const wasRaw = input.isRaw;
  input.setRawMode(true);
  input.resume();
  let value = "";
  // A terminal paste arrives wrapped in bracketed-paste markers:
  //   ESC [ 200 ~ <payload> ESC [ 201 ~
  // Dropping only the ESC bytes leaves the literal "[200~" glued to the key, and
  // `cleanSecret` would accept it - the stored key is then silently wrong and
  // auth fails later with no hint. Track the markers and drop them whole.
  //
  // The marker match starts ONLY at an ESC (`marker` non-null). Payload
  // characters inside a paste must flow straight into `value`; matching them
  // against the closing marker would swallow ordinary characters.
  let marker: { wanted: string; seen: string; onMatch: () => void } | null = null;
  let inPaste = false;
  try {
    for await (const chunk of input) {
      const text = String(chunk);
      for (const ch of text) {
        if (ch === "\u0003") throw new SecretInputCancelled(); // Ctrl+C
        if (marker) {
          marker.seen += ch;
          if (marker.wanted.startsWith(marker.seen)) {
            if (marker.seen === marker.wanted) {
              const done = marker;
              marker = null;
              done.onMatch();
            }
            continue;
          }
          // Not this marker after all: it was some other escape sequence (arrow
          // key, function key). Drop what was collected for it.
          marker = null;
          continue;
        }
        if (ch === "\u001b") {
          marker = inPaste
            ? { wanted: "[201~", seen: "", onMatch: () => { inPaste = false; } }
            : { wanted: "[200~", seen: "", onMatch: () => { inPaste = true; } };
          continue;
        }
        if (ch === "\r" || ch === "\n") {
          if (inPaste) {
            // A newline inside a paste must not end the read half-way.
            continue;
          }
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
    input.setRawMode(wasRaw ?? false);
    input.pause();
  }
}

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
