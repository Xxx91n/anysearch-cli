// child_process wrapper injected by acg-hooks.mjs. execFileSync returns scripted
// check-run snapshots from env ACG_FIXTURE (JSON: array of polls; each poll is
// an array of {name,status,conclusion,started_at}). Once the array is exhausted
// the LAST poll repeats forever. Non-gh commands pass through to the real impl.
import * as real from "node:child_process";
export * from "node:child_process";
const polls = JSON.parse(process.env.ACG_FIXTURE || "[[]]");
let idx = 0;
export function execFileSync(cmd, args, opts) {
  const argv = Array.isArray(args) ? args.join(" ") : String(args || "");
  if (cmd === "gh" && argv.includes("check-runs")) {
    const snap = polls[Math.min(idx, polls.length - 1)];
    idx++;
    return snap.length ? snap.map((r) => JSON.stringify(r)).join("\n") + "\n" : "";
  }
  return real.execFileSync(cmd, args, opts);
}
