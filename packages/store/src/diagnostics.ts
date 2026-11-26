// stderr writes that cannot take the process down.
//
// A long-lived process (MCP) can see stderr's pipe break; the resulting
// asynchronous 'error' event is not caught by try/catch. Attach the listener
// once per stream, then write. The caller supplies any trailing newline; this
// module does not add one (apps/mcp/src/stderr.ts is the newline-adding variant).

const stderrErrorListeners = new WeakSet<NodeJS.WriteStream>();

export function writeStderrSafe(message: string): void {
  const stderr = process.stderr;
  if (!stderrErrorListeners.has(stderr)) {
    stderr.on("error", () => {});
    stderrErrorListeners.add(stderr);
  }
  try {
    stderr.write(message);
  } catch {
    // A closed stream is not worth crashing a fail-open path over.
  }
}
