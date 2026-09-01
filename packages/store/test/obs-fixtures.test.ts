// ADR-0042 D3/D6 (r108 impl): four-fixture falsification matrix, end-to-end chain
// fixture -> histogram -> PSI -> AND-gate -> tier/skip. Gate-passing fixtures stop at
// gate ok (ready-to-spawn); the real Python spawn path stays covered by the bgnbd-spawn
// stub matrix (D6.5). The loader enforces sha256 pinning + track marker before any row
// is trusted (D1), so every happy-path assert below also proves the pin chain.
import { evaluateTauFitGate, runBgnbdFit } from "../src/eval/bgnbd";
import { isSkip } from "../src/eval/explicit-skip";
import { feedFromFixture, feedToGateInput, fixtureDefinitionHash, loadObsFixture, validateFixtureDoc, type ObsFixture } from "../src/eval/obs-fixtures";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return; }
  passed++;
}

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "obs-feed");
const manifest = JSON.parse(readFileSync(join(fixtureDir, "MANIFEST.json"), "utf8")) as { definitionHash: string; files: Record<string, string> };

// manifest <-> definition hash consistency (the drift tripwire itself lives in the
// regenerate-and-diff CI guard; here we only pin plumbing, not the hash value).
assert(fixtureDefinitionHash() === manifest.definitionHash, "fixtureDefinitionHash == MANIFEST.definitionHash");
assert(Object.keys(manifest.files).sort().join(",") === "pass-stable.json,t1-fail.json,t2-fail.json,t3-fail.json", "manifest covers exactly the four fixtures");

const feeds = Object.fromEntries(
  ["pass-stable", "t1-fail", "t2-fail", "t3-fail"].map((n) => [n, feedFromFixture(loadObsFixture(n))]),
);

// track separation (D1): every loaded feed is synthetic and any miswired doc is rejected.
for (const f of Object.values(feeds)) assert(f.track === "synthetic", "loaded feed carries synthetic track");
assertThrowsOnMiswire();
function assertThrowsOnMiswire() {
  const fake = JSON.parse(readFileSync(join(fixtureDir, "pass-stable.json"), "utf8")) as ObsFixture;
  (fake as { track: string }).track = "consumed";
  let threw = false;
  try { validateFixtureDoc(fake); } catch { threw = true; }
  assert(threw, "miswired track=consumed fixture doc is rejected");
}

// chain: fixture -> feed -> gate input -> AND-gate.
const gates = Object.fromEntries(Object.entries(feeds).map(([n, f]) => [n, evaluateTauFitGate(feedToGateInput(f))]));

// D3.1 pass-stable satisfies the whole chain.
assert(gates["pass-stable"]!.ok, "pass-stable reaches gate ok (" + gates["pass-stable"]!.failures.join("; ") + ")");
assert(feeds["pass-stable"]!.activeRows >= 300 && feeds["pass-stable"]!.fittableUnits >= 100, "pass-stable T1 quantities");
assert(feeds["pass-stable"]!.psi < 0.25, "pass-stable PSI " + feeds["pass-stable"]!.psi.toFixed(4) + " < 0.25");
assert(feeds["pass-stable"]!.windowDays >= 90, "pass-stable windowDays >= 90");

// D3.2/3/4 each fail fixture trips exactly its own clause — nothing else.
function onlyFailure(name: string, prefix: string) {
  const g = gates[name]!;
  assert(!g.ok, name + " gate not ok");
  assert(g.failures.length === 1 && g.failures[0]!.startsWith(prefix), name + " fails ONLY " + prefix + " (got: " + g.failures.join("; ") + ")");
}
onlyFailure("t1-fail", "T1:");
onlyFailure("t2-fail", "T2:");
onlyFailure("t3-fail", "T3:");
assert(feeds["t1-fail"]!.activeRows === 299, "t1-fail activeRows exactly 299 (just under the 300 threshold)");
assert(feeds["t2-fail"]!.psi >= 0.25, "t2-fail PSI " + feeds["t2-fail"]!.psi.toFixed(4) + " >= 0.25");
assert(feeds["t3-fail"]!.windowDays === 89, "t3-fail window 89d (simulated clock, D5)");

// D6.5: the pass fixture goes one step further — gate ok means the ready-to-spawn path
// runs through the same spawn wrapper (node stub keeps dev machines python-free; the real
// python contract is covered by bgnbd-spawn.test.ts stubs).
const okRes = await runBgnbdFit(feeds["pass-stable"]!.rows, {
  gate: feedToGateInput(feeds["pass-stable"]!),
  python: process.execPath,
  scriptPath: join(dirname(fileURLToPath(import.meta.url)), "stubs", "bgnbd-ok.mjs"),
  timeoutMs: 10000,
});
assert(!isSkip(okRes) && okRes.status === "ok", "pass-stable end-to-end: gate ok -> spawn returns converged envelope (ready-to-spawn)");

// each fail fixture feeds the same spawn wrapper and comes out as its specific gate-not-met skip.
for (const [n, prefix] of [["t1-fail", "T1:"], ["t2-fail", "T2:"], ["t3-fail", "T3:"]] as const) {
  const r = await runBgnbdFit(feeds[n].rows, { gate: feedToGateInput(feeds[n]), python: process.execPath, scriptPath: "never-spawned.mjs", timeoutMs: 5000 });
  assert(isSkip(r) && r.tier === "gate-not-met" && r.reason.includes(prefix), n + " -> single explicit skip quoting " + prefix + " (spawn never attempted)");
}

console.log("obs-fixtures chain: " + passed + " passed, " + failed + " failed");
if (failed > 0) process.exit(1);
