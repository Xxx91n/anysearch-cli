// The output file's three labels: the whole run, a prefix of one cut by its budget
// or a signal, a file whose writes never finished. Kept out of the gate so a test
// can ask for each state without staging a disk-full.
import { writeStderr } from "./preflight-stderr.mjs";

/** Which of the three states the output file is in. */
export function outputLabel({ failed, finished } = {}) {
  if (failed) return "incomplete output file";
  return finished ? "full output" : "partial output (the run did not finish)";
}

/** Name the run's output file, unless the run never opened one. */
export function reportRunOutput(handle, { write = writeStderr, finished } = {}) {
  if (!handle?.file) return;
  write(`[preflight] ${outputLabel({ failed: handle.failed, finished })}: ${handle.file}`);
}
