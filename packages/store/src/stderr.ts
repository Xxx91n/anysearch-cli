// stderr writes that survive a closed pipe. A stream 'error' event is asynchronous
// and cannot be caught by try/catch, so install one listener per stream.
const stderrErrorListeners = new WeakSet<NodeJS.WriteStream>();

export function writeStderr(message: string): void {
  const stderr = process.stderr;
  if (!stderrErrorListeners.has(stderr)) {
    stderr.on("error", () => {});
    stderrErrorListeners.add(stderr);
  }
  try {
    stderr.write(message);
  } catch {
    // Synchronous write throws (e.g. stream destroyed); the listener above
    // absorbs the asynchronous event.
  }
}
