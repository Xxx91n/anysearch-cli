// stderr writing for the MCP tools.
//
// stdout carries the protocol; diagnostics go to stderr. A parent that closes
// the pipe reports the failure as an asynchronous 'error' event, which a
// try/catch around `write` cannot see — without a listener it takes the whole
// MCP process down. This is the one implementation for the package.

import { redactSecrets } from "@anysearch-cli/retriever";

/** The part of a writable stream this module needs; `process.stderr` fits. */
export interface DiagnosticSink {
  once(event: "error", listener: (error: Error) => void): unknown;
  off(event: "error", listener: (error: Error) => void): unknown;
  write(chunk: string, callback?: (error?: Error | null) => void): unknown;
}

export function writeStderr(line: string, sink: DiagnosticSink = process.stderr): void {
  const swallow = () => {};
  // The listener is removed once the write succeeds, so it cannot pile up.
  sink.once("error", swallow);
  try {
    sink.write(line + "\n", (error) => {
      if (!error) sink.off("error", swallow);
    });
  } catch {
    sink.off("error", swallow);
  }
}

/**
 * Design: only strings that can carry config or provider text are redacted.
 * Task ids and ledger ids use `writeStderr` directly: `redactSecrets` would
 * turn them into `[redacted]`, and the log could no longer be tied to its row.
 */
export function writeRedactedDiagnostic(message: string): void {
  writeStderr(redactSecrets(message));
}
