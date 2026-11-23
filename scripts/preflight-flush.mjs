// Flush the gate's output before it exits.
//
// A write to a pipe is queued, so process.exit drops whatever has not left yet —
// on a red self-test, that is the failing group's own output. An empty write
// queued behind everything else tells us when the buffer is gone; a stream that
// throws or has already gone away counts as flushed, because the gate's answer is
// its exit code, not its output.
//
// Design: the streams and the wait are parameters so a test can hand in a fake
// stream instead of betting on a real pipe, the way preflight-stderr.mjs takes
// the sink it writes to.

/** Empty-write every stream and wait for the flush, but never longer than timeoutMs. */
export async function flushStreams(streams, timeoutMs = 1000) {
  const flushed = streams.map(
    (stream) =>
      new Promise((resolve) => {
        try {
          stream.write("", () => resolve());
        } catch {
          resolve();
        }
      }),
  );
  // Design: the cap is cleared once the race is decided — left pending it would
  // hold the event loop open for its whole length after the flush is done, which
  // a caller without a follow-up process.exit would sit through. It is not
  // unref'd: a flush that never answers has to keep the loop alive long enough to
  // report the code the gate meant to exit with.
  let cap;
  const timedOut = new Promise((resolve) => {
    cap = setTimeout(resolve, timeoutMs);
  });
  try {
    await Promise.race([Promise.all(flushed), timedOut]);
  } finally {
    clearTimeout(cap);
  }
}
