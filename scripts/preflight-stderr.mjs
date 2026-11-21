// The gate's last words. Written synchronously, because a signal handler may
// exit right after and a piped stderr drops unsent lines. A full pipe makes fd
// 2 throw EAGAIN: retry briefly (about 100 ms), then give up instead of
// hanging the gate.

import fs from "node:fs";

const RETRY_LIMIT = 20;
const RETRY_PAUSE_MS = 5;

export function writeStderr(line, { write = writeOnce, pause = pauseSync } = {}) {
  const bytes = Buffer.from(`${line}\n`);
  let written = 0;
  let retries = 0;
  while (written < bytes.length) {
    try {
      const count = write(2, bytes, written);
      if (count <= 0) break;
      written += count;
    } catch (error) {
      if (error.code !== "EAGAIN" || retries >= RETRY_LIMIT) break;
      retries += 1;
      pause(RETRY_PAUSE_MS);
    }
  }
  if (written > 0 && written < bytes.length) {
    // A half line would glue onto whatever gets printed next.
    try {
      write(2, Buffer.from("\n"), 0);
    } catch {}
  }
}

function writeOnce(fd, bytes, offset) {
  return fs.writeSync(fd, bytes, offset);
}

function pauseSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
