// Synchronous writer for fd 2: the gate may exit right after a line, and a
// piped stderr drops unsent async lines. A full pipe makes fd 2 throw EAGAIN:
// retry for about 100 ms on the line and as much again on its newline, then
// give up instead of hanging.
import fs from "node:fs";

export const RETRY_LIMIT = 20;
const RETRY_PAUSE_MS = 5;

export function writeStderr(line, { write = writeOnce, pause = pauseSync } = {}) {
  const bytes = Buffer.from(`${line}\n`);
  const written = writeAll(bytes, 0, { write, pause });
  // A half line would glue onto whatever gets printed next. The newline gets
  // its own retries: the loop above may have left the pipe blocked.
  if (written > 0 && written < bytes.length) {
    writeAll(Buffer.from("\n"), 0, { write, pause });
  }
}

function writeAll(bytes, written, { write, pause }) {
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
  return written;
}

function writeOnce(fd, bytes, offset) {
  return fs.writeSync(fd, bytes, offset);
}

function pauseSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
