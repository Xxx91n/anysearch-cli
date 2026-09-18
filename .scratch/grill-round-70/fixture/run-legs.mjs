// R70 T0 — assert-checks-green ESM fixture driver (same harness shape as
// R68/R69 audits: ESM loader intercepts node:child_process, scripted check-run
// snapshots injected via ACG_FIXTURE env). Usage:
//   node .scratch/grill-round-70/fixture/run-legs.mjs <transcript-out-path>
// Exit 0 iff every leg's assertions pass; transcript (full output) written to argv[2].
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const REPO = "D:/Aworker/anysearch-cli";
const SCRIPT = REPO + "/scripts/assert-checks-green.mjs";
const REGISTER = "./.scratch/grill-round-70/fixture/acg-register.mjs";

const F5 = ["check-build", "install-smoke", "test:online", "ship-gate", "memory-eval"];
const ok = (n) => ({ name: n, status: "completed", conclusion: "success", started_at: "2026-09-18T00:00:00Z" });
const pend = (n) => ({ name: n, status: "in_progress", conclusion: null, started_at: "2026-09-18T00:00:00Z" });
const concl = (n, c) => ({ name: n, status: "completed", conclusion: c, started_at: "2026-09-18T00:00:00Z" });
// rep(runs, n): n polls each returning the same runs array.
const rep = (runs, n) => Array.from({ length: n }, () => runs);

// flags: discovery-sec small so discovery-expiry legs stay fast; interval 0.1s
// keeps poll transcripts bounded; timeout-min 0.05 = 3s absolute deadline.
const D = { discovery: "1", interval: "0.1", timeout: "0.05" };

const legs = [
  {
    id: "L1 all-ok (kept)",
    polls: [F5.map(ok)],
    expect: { code: 0, re: [/GREEN/, /phase=completion/] },
  },
  {
    id: "L2 stale-in-completion (kept leg, phase assertion)",
    polls: rep([ok(F5[0]), ok(F5[1]), ok(F5[2]), ok(F5[3]), concl(F5[4], "stale")], 3),
    flags: { ...D, timeout: "0.02" },
    expect: { code: 2, re: [/FAIL-CLOSED \(phase=completion\)/, /memory-eval/] },
  },
  {
    id: "L3 empty (kept leg, strict discovery)",
    polls: rep([], 3),
    expect: { code: 2, re: [/FAIL-CLOSED \(phase=discovery\)/, /missing-families=check-build,install-smoke,test:online,ship-gate,memory-eval/, /present-families=none/] },
  },
  {
    id: "L4 partial-to-all (new leg)",
    polls: [
      [pend(F5[0]), pend(F5[1]), pend(F5[2])],
      [pend(F5[0]), pend(F5[1]), pend(F5[2]), pend(F5[3]), pend(F5[4])],
      F5.map(ok),
    ],
    expect: { code: 0, re: [/phase=discovery/, /phase=completion/, /GREEN/] },
  },
  {
    id: "L5 never-appears (new leg)",
    polls: rep([pend(F5[0]), ok(F5[1]), pend(F5[2]), ok(F5[3])], 3),
    expect: { code: 2, re: [/FAIL-CLOSED \(phase=discovery\)/, /missing-families=memory-eval/, /present-families=check-build,install-smoke,test:online,ship-gate/] },
  },
  {
    id: "L6 red-in-discovery (new leg)",
    polls: [[concl(F5[0], "failure"), pend(F5[1]), pend(F5[2])]],
    expect: { code: 1, re: [/RED/] },
  },
  {
    id: "L7 red-in-completion (new leg)",
    polls: [[concl(F5[0], "failure"), ok(F5[1]), ok(F5[2]), ok(F5[3]), ok(F5[4])]],
    expect: { code: 1, re: [/RED/] },
  },
];

const outPath = process.argv[2];
const chunks = [];
let pass = 0, fail = 0;
for (const leg of legs) {
  const f = leg.flags || D;
  const env = { ...process.env, ACG_FIXTURE: JSON.stringify(leg.polls) };
  const args = ["--import", REGISTER, SCRIPT, "--sha", "0123456789abcdef", "--repo", "fixture/repo",
    "--discovery-sec", f.discovery, "--interval-sec", f.interval, "--timeout-min", f.timeout];
  const r = spawnSync("node", args, { env, encoding: "utf8", timeout: 60000, cwd: REPO });
  const text = (r.stdout || "") + (r.stderr || "");
  const lines = text.split("\n");
  const results = [];
  const codeOk = r.status === leg.expect.code;
  results.push((codeOk ? "PASS" : "FAIL") + " exit " + r.status + " (want " + leg.expect.code + ")");
  let legOk = codeOk;
  for (const re of leg.expect.re) {
    const m = re.test(text);
    if (!m) legOk = false;
    results.push((m ? "PASS" : "FAIL") + " " + re);
  }
  if (legOk) pass++; else fail++;
  chunks.push("===== " + leg.id + " =====");
  chunks.push("args: " + args.join(" "));
  chunks.push("poll-lines: " + lines.filter((l) => l.includes("[assert-checks poll")).length);
  chunks.push(results.join("\n"));
  chunks.push("--- output ---");
  chunks.push(lines.slice(0, 4).join("\n"));
  if (lines.length > 8) chunks.push("... (" + (lines.length - 8) + " lines elided) ...");
  chunks.push(lines.slice(-4).join("\n"));
  chunks.push("");
}
const summary = "RESULT: " + pass + " leg(s) pass, " + fail + " fail";
chunks.push(summary);
const transcript = chunks.join("\n");
if (outPath) { mkdirSync(dirname(outPath), { recursive: true }); writeFileSync(outPath, transcript + "\n", "utf8"); }
console.log(transcript);
console.log("transcript -> " + (outPath || "(none)"));
process.exit(fail ? 1 : 0);
