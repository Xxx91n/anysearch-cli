// R62 D-007 (T4): macOS exit-teardown SPILLOVER PROBE — experiment, non-blocking.
// Minimal reproduction of the F1/F-16 exit-time crash family on macos-latest.
// The workflow runs `node -v` and `new Database(":memory:")` BEFORE this script,
// separating the two signature families:
//   - better-sqlite3 registration segfault (SIGSEGV / exit 139 at require/load)
//   - exit-time libc++abi mutex abort (F-16 / onnxruntime issue family)
// This script drives the abstain-path repro through the real bundled ans bin
// (store+observation handles opened then closed at exit — the crash fired at
// libuv/native teardown), classifies each run's signature into
// $GITHUB_STEP_SUMMARY, and exits non-zero when a crash signature is seen.
// TTL / promotion-removal (ADR-0063 D-007): after >=5 consecutive green runs,
// evaluate restoring macos-latest to the blocking matrix; if crashes persist,
// prune at round close and extend ledger defer-f16-macos-native-crash.

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
lines.push("## macOS spillover probe (R62 D-007, experiment — non-blocking)","");
lines.push("| run | command | exit | signature |","|---|---|---|---|");

for (let i = 1; i <= RUNS; i++) {
  // Abstain/no-results path exercises createPersistentEngine handles + teardown.
  const s = spawnSync(process.execPath, [BIN, "search", "macos exit probe query"], { encoding: "utf8" });
  const out = (s.stdout ?? "") + (s.stderr ?? "");
  const sig = classify(s.status, out + (s.signal ?? ""));
  if (!sig.startsWith("clean")) crashes++;
  lines.push("| " + i + " | search | " + String(s.status) + (s.signal ? " (" + s.signal + ")" : "") + " | " + sig + " |");
}
// R63 T4/F-5: pin the abstain leg — ANS_DOMAIN=docs makes the out-of-domain
// ghost query (bc0001's tokio question) exercise the real abstain write path
// (dual-gate filter -> first-class abstain marker -> exit 0), then teardown.
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
  lines.push("**verdict: GREEN** — teardown fix holds on this run. Promotion rule: >=5 consecutive green runs => evaluate restoring macos-latest to the blocking matrix (ADR-0063 D-007).");
} else {
  lines.push("**verdict: CRASH SIGNATURE** — " + crashes + " run(s) crashed. If crashes persist: prune the macOS blocking lane (ubuntu/windows stay blocking), extend ledger defer-f16-macos-native-crash, and keep this probe reporting.");
}

const summary = lines.join("\n") + "\n";
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
process.stdout.write(summary);
process.exit(crashes > 0 ? 1 : 0);
