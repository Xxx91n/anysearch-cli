// macOS exit-teardown SPILLOVER PROBE — experiment, non-blocking.
// Minimal reproduction of the F1/ exit-time crash family on macos-latest.
// The workflow runs `node -v` and `new Database(":memory:")` BEFORE this script,
// separating the two signature families:
// - better-sqlite3 registration segfault (SIGSEGV / exit 139 at require/load)
// - exit-time libc++abi mutex abort ( / onnxruntime issue family)
// This script drives the abstain-path repro through the real bundled ans bin
// (store+observation handles opened then closed at exit — the crash fired at
// libuv/native teardown), classifies each run's signature into
// $GITHUB_STEP_SUMMARY, and exits non-zero when a crash signature is seen.
// NOTE (#183): this minimal repro drives the CLI wiring only — the
// path fd249d41 fixed — so its greens have never been allowed to promote the
// lane (the PR #174 promotion trusted 7 consecutive greens and crashed 5/76
// store test files on its first full-gate run). Store-side teardown is now
// fixed (packages/store/src/teardown.ts + tracked opener + eval-runner exit
// path + test-process preload) and macOS runs the real 9-step gate as a
// blocking leg; the promotion evidence was full-gate trials, never this script
// (docs/limitations.md).
// Role since the promotion: non-blocking crash-signature reporter. A red run
// with a green full-gate macOS leg = CLI-path regression report; a red
// full-gate leg = the gate's own signal (re-prune per #16/#183).

import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";

const BIN = "apps/cli/dist/index.js";
const RUNS = 3; // intermittent family — repeat for signal without paying full gate

function classify(code, out) {
  if (code === 139 || /SIGSEGV|Segmentation fault/i.test(out)) return "registration-segfault (better-sqlite3 family)";
  if (/libc\+\+abi|mutex|abort|Abort trap/i.test(out) || code === 134 || code === null) return "exit-time libc++abi abort (F-16/onnxruntime family)";
  if (code === 0 || code === 1) return "clean";
  return "unexpected exit " + code;
}

const lines = [];
let crashes = 0;
lines.push("## macOS spillover probe (experiment — non-blocking)","");
lines.push("| run | command | exit | signature |","|---|---|---|---|");

for (let i = 1; i <= RUNS; i++) {
  // Abstain/no-results path exercises createPersistentEngine handles + teardown.
  const s = spawnSync(process.execPath, [BIN, "search", "macos exit probe query"], { encoding: "utf8" });
  const out = (s.stdout ?? "") + (s.stderr ?? "");
  const sig = classify(s.status, out + (s.signal ?? ""));
  if (!sig.startsWith("clean")) crashes++;
  lines.push("| " + i + " | search | " + String(s.status) + (s.signal ? " (" + s.signal + ")" : "") + " | " + sig + " |");
}
// pin the abstain leg — ANS_DOMAIN=docs makes the out-of-domain
// ghost query (bc0001's tokio question) exercise the real abstain write path
// (domain filter -> abstain marker -> exit 0), then teardown.
{
  const a = spawnSync(process.execPath, [BIN, "search", "tokio JoinSet rust scheduler internals"], {
    encoding: "utf8", env: { ...process.env, ANS_DOMAIN: "docs" },
  });
  const out = (a.stdout ?? "") + (a.stderr ?? "");
  const sig = classify(a.status, out + (a.signal ?? ""));
  const marker = /abstain/i.test(out) ? "abstain-marker" : "NO-ABSTAIN-MARKER";
  if (!sig.startsWith("clean")) crashes++;
  lines.push("| - | search --domain docs (abstain leg) | " + String(a.status) + (a.signal ? " (" + a.signal + ")" : "") + " | " + sig + "; " + marker + " |");
}

{
  const d = spawnSync(process.execPath, [BIN, "doctor"], { encoding: "utf8" });
  const out = (d.stdout ?? "") + (d.stderr ?? "");
  const sig = classify(d.status, out + (d.signal ?? ""));
  if (!sig.startsWith("clean")) crashes++;
  lines.push("| - | doctor | " + String(d.status) + (d.signal ? " (" + d.signal + ")" : "") + " | " + sig + " |");
}

lines.push("");
if (crashes === 0) {
  lines.push("**verdict: GREEN** — no crash signature on the CLI path this run. Early-warning confirmation only: the blocking macOS full-gate leg (matrix) is the authority, and greens here are never promotion/prune evidence (docs/limitations.md).");
} else {
  lines.push("**verdict: CRASH SIGNATURE** — " + crashes + " run(s) crashed on the CLI path. Report it: if the blocking macOS full-gate leg is green, this is a CLI-path regression (extend #183 / open a ticket); if the full gate is also red, re-prune the macOS lane per the #16/#183 rule (ubuntu/windows stay blocking) and keep this probe reporting.");
}

const summary = lines.join("\n") + "\n";
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
process.stdout.write(summary);
process.exit(crashes > 0 ? 1 : 0);
