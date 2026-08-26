// ADR-0027 impl plan step 7: judge client self-check (path 2/3).
// Judge unreachable -> score 0, no crash, exit 0. Missing key -> exit 3. Missing report -> exit 2.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "scripts", "eval-judge.mjs");
let passed = 0, failed = 0;
function assert(cond, msg) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return; }
  passed++;
}
function run(env, args) {
  return spawn(process.execPath, [SCRIPT, ...args], { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
}
function wait(p) { return new Promise((r) => p.on("close", r)); }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ans-judge-"));
const fakeReport = path.join(tmp, "eval-report.json");
fs.writeFileSync(fakeReport, JSON.stringify({
  cases: [{ id: "c1", group: "g", ops: [{ kind: "search", op: 0, samples: [{ title: "t", snippet: "s" }] }] }],
}));

// 1. missing API key -> exit 3
const p1 = run({ JUDGE_API_KEY: "" }, ["--report", fakeReport]);
assert((await wait(p1)) === 3, "missing key exits 3");

// 2. dead endpoint -> score 0, exit 0, report written
const outPath = path.join(tmp, "judge-report.json");
const p2 = run({ JUDGE_API_KEY: "sk-test-dummy", JUDGE_BASE_URL: "http://127.0.0.1:9" }, ["--report", fakeReport, "--out", outPath]);
const code2 = await wait(p2);
assert(code2 === 0, "dead endpoint still exits 0 (fail-open), got " + code2);
assert(fs.existsSync(outPath), "judge-report.json written despite dead endpoint");
const jr = JSON.parse(fs.readFileSync(outPath, "utf8"));
assert(jr.entries.length === 1 && jr.entries[0].score === 0 && typeof jr.entries[0].error === "string", "dead endpoint recorded score 0 with error string");

// 3. missing report -> exit 2
const p3 = run({ JUDGE_API_KEY: "sk-test-dummy" }, ["--report", path.join(tmp, "nope.json")]);
assert((await wait(p3)) === 2, "missing report exits 2");

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
console.log("eval-judge.test.mjs: " + passed + " passed, " + failed + " failed");
if (failed > 0) process.exit(1);
