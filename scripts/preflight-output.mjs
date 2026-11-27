// The label on the run's output file, and the line that names it.
//
// Three states, three labels: a run that ended and whose file made it to disk is
// "full output"; a run cut by its budget or a signal is a prefix, and says so; a
// file whose writes failed or whose flush timed out is not the run at all. The
// label lives here so a test can ask for each state without a real failed write,
// the way preflight-flush.mjs takes the streams it flushes.
//
// Design: a prefix read as the whole run would pass a partial test count off as
// the total and lose the failure the recap exists to show, so the two labels
// never collapse into one.
import { writeStderr } from "./preflight-stderr.mjs";

/** Which of the three states the output file is in. */
export function outputLabel({ failed = false, finished = true } = {}) {
  if (failed) return "incomplete output file";
  if (!finished) return "partial output (the run did not finish)";
  return "full output";
}

/** Name the run's output file, unless the run never opened one. */
export function reportRunOutput(handle, { write = writeStderr, finished = true } = {}) {
  if (!handle?.file) return;
  write(`[preflight] ${outputLabel({ failed: handle.failed, finished })}: ${handle.file}`);
}
