// stderr writing for the MCP tools.
//
// stdout carries the protocol; diagnostics go to stderr. A parent that closes
// the pipe reports the failure as an asynchronous 'error' event, which a
// try/catch around `write` cannot see — without a listener it takes the whole
// MCP process down. This module is the shared sink for the diagnostics it owns;
// a few older call sites still write directly and have not been moved yet.

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

/** A deduped warning sink: repeated keys are said once, and the set is bounded. */
export interface WarnOnce {
  (key: string, detail: string): void;
  reset(): void;
}

export function createWarnOnce(prefix: string, max: number): WarnOnce {
  const warned = new Set<string>();
  const warn = ((key: string, detail: string): void => {
    if (warned.has(key)) return;
    if (warned.size >= max) warned.clear();
    warned.add(key);
    writeStderr(prefix + detail);
  }) as WarnOnce;
  warn.reset = () => warned.clear();
  return warn;
}
