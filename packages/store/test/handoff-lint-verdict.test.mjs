// packages/store/test/handoff-lint-verdict.test.mjs
// ADR-0097 (R96 T1 / D-002, D-003, D-004; reworked under audit R1~R10): the
// handoff-lint verdict core truth table.
//
// The core is pure (no fs / child_process / Date.now / process.env) and this
// file is repo-free (R10): every input is either synthetic or a frozen fixture
// literal. Structure follows the OPA principle - every judgement gets an ALLOW
// and a DENY case, every degradation cause appears at least once, the Stack
// three-element grid is enumerated in full, the vocabularies are asserted to be
// the ONLY codes the core can emit (R3), and every RED branch has a rejection
// case (R4). A test count of zero is a failure (fail-on-empty red line).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  EFFECTIVE_SCOPE_FLOOR,
  STACK_CAPTURE_MAX_AGE_DAYS,
  REQUIRED_WORKFLOWS,
  PENDING_REASON_CODES,
  VERIFICATION_UNAVAILABLE_CODES,
  STACK_RED_CODES,
  STACK_STRUCTURAL_RED_CODES,
  STACK_ENV_CODES,
  STACK_ADVISORY_CODES,
  RUN_URL_RED_CODES,
  CODE_GROUPS,
  emitCode,
  isKnownCode,
  parseRunUrlSection,
  parseStackLine,
  parseRoundFromName,
  assessRunUrlLeg,
  assessStackLeg,
  assessHandoffLint,
} from "../../../scripts/handoff-lint-verdict.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXDIR = path.join(__dirname, "fixtures", "handoff-lint");

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return false; }
  passed++;
  return true;
}
function eq(actual, expected, msg) {
  return assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    msg + " -- got " + JSON.stringify(actual) + ", want " + JSON.stringify(expected)
  );
}

// --- shared synthetic inputs -------------------------------------------------
const SHA = { inStack1: "a1".repeat(20), inStack2: "b2".repeat(20), outside: "c3".repeat(20) };
const REPO = "Xxx91n/anysearch-cli";
const BRANCH = "r96-handoff-lint";
const RUN = (id) => "https://github.com/" + REPO + "/actions/runs/" + id;

function baseEnv() {
  return {
    now: "2026-10-02",
    repo: REPO,
    git: {
      ok: true,
      shallow: false,
      branchRefs: { [BRANCH]: "f0".repeat(20) },
      stackBranchMembers: { [BRANCH]: [SHA.inStack1, SHA.inStack2] },
      commitObjects: { aaaaaaa1: "commit", bbbbbbb2: "commit" },
      resolveSha: { aaaaaaa1: SHA.inStack1, bbbbbbb2: SHA.inStack2 },
    },
    gh: { ok: true, runs: { 1001: { head_sha: SHA.inStack1, conclusion: "success", workflow: "ci", repo: REPO } } },
    but: { ok: true, ids: ["aaa", "bbb"] },
    workflows: { ok: true, pushBranches: ["main"], pushAllBranches: false },
  };
}
function cloneEnv(over) { return Object.assign(JSON.parse(JSON.stringify(baseEnv())), over || {}); }
function stackOf(entries) {
  return "Stack（primary key = GitButler change-ids）：\n  " + BRANCH + " → " + entries.join(" → ");
}
const STACK_OK = stackOf(["aaa (aaaaaaa1 @ 2026-10-02)", "bbb (bbbbbbb2 @ 2026-10-02)"]);
function docOf(runUrlBody, stack) {
  return [
    "# Handoff — Grill Round 96 → R97",
    "",
    stack === undefined ? STACK_OK : stack,
    "",
    "## 绿色 run URL（必填）",
    "",
    runUrlBody,
    "",
    "## 下一轮候选",
    "",
    "- n/a",
    "",
  ].join("\n");
}
function docWithoutSection() {
  return ["# Handoff — Grill Round 96 → R97", "", STACK_OK, "", "## 下一轮候选", "", "- n/a", ""].join("\n");
}
// Frozen excerpt of a real closeout Stack line (R10: no repo artifact is read).
const R95_STACK_EXCERPT = "Stack（primary key = GitButler change-ids；SHA 为 capture 时值，time-lagged）：\n  r95-exec → trx (`4a73758b` @ 2026-10-01) → pnw (`a9f2088e` @ 2026-10-01) → rsk (`04cdce5e` @ 2026-10-01) → lyz (`aee54914` @ 2026-10-01) → xut (`0ae0c92b` @ 2026-10-01) → znn (`4b9a1824` @ 2026-10-01) → oql (`3063f957` @ 2026-10-01) → umy (`bb4ec7e1` @ 2026-10-01) → ouz (`f20fe391` @ 2026-10-01) → zpv → szw (`9454a182` @ 2026-10-01) → xlu (`729e3c36` @ 2026-10-01) → wzw (`7a540900` @ 2026-10-01) → `qyv` (`a24684de` @ 2026-10-01) → `lxn` (`199f3e72` @ 2026-10-01) → `umt` (`1b7bc809` @ 2026-10-01) → `ulo` (`9cac80c1` @ 2026-10-01) → `xtv`（自引用收尾 commit；SHA time-lagged 故不写入，以 `but log` 为准）—— 即 `r95-exec` tip；已 push 至 `origin/r95-exec`（tip 以 `git rev-parse origin/r95-exec` 为准；本行 capture 时值 `a5af1140` @ 2026-10-01），未 land、未 tag、未 publish";

// --- A. the vocabularies are closed, registered and GUARDED (R3) -------------
assert(EFFECTIVE_SCOPE_FLOOR === 96, "effective-scope floor is 96 (the rule birthday)");
assert(STACK_CAPTURE_MAX_AGE_DAYS === 45, "stack capture freshness bound is the loose 45d default");
eq(PENDING_REASON_CODES, ["stack-unpushed", "pushed-no-branch-runs"], "PENDING vocabulary is exactly the closed pair");
eq(VERIFICATION_UNAVAILABLE_CODES, ["gh-missing", "repo-parse", "api-failed", "ref-unavailable"], "verification-unavailable codes are exactly four (N1 cause split)");
eq(STACK_RED_CODES, ["but-id-not-resolved", "sha-not-commit", "chain-tail-not-in-branch"], "Stack RED codes are exactly three");
eq(STACK_STRUCTURAL_RED_CODES, ["stack-line-missing", "stack-chain-empty"], "Stack structural RED codes are exactly two");
eq(STACK_ENV_CODES, ["stack-unavailable", "ref-unavailable", "shallow-clone"], "Stack env-degradation codes are exactly three");
eq(STACK_ADVISORY_CODES, ["stale-capture"], "the advisory vocabulary is exactly stale-capture");
assert(REQUIRED_WORKFLOWS.includes("ci") && REQUIRED_WORKFLOWS.includes("ship-gate"), "required workflow set carries the blocking gates");
assert(!REQUIRED_WORKFLOWS.includes("native-smoke"), "native-smoke is not a required gate (load-only matrix)");
eq(Object.keys(CODE_GROUPS).sort(), ["pendingReason", "runUrlRed", "stackAdvisory", "stackEnv", "stackRed", "stackStructuralRed", "verificationUnavailable"], "every governed vocabulary is registered in CODE_GROUPS (no orphan constant)");
for (const k of Object.keys(CODE_GROUPS)) {
  assert(Array.isArray(CODE_GROUPS[k]) && CODE_GROUPS[k].length > 0, "CODE_GROUPS." + k + " is a non-empty array");
  for (const c of CODE_GROUPS[k]) assert(isKnownCode(c), "isKnownCode(" + c + ") is true");
}
assert(isKnownCode("ref-unavailable") && isKnownCode("stale-capture") && !isKnownCode("made-up-code"), "isKnownCode distinguishes governed codes from invented ones");
// The guard itself: an out-of-vocabulary code cannot be emitted (R3 negative case).
let guardThrew = false;
try { emitCode(RUN_URL_RED_CODES, "made-up-code"); } catch (e) { guardThrew = /not in its vocabulary/.test(String(e.message)); }
assert(guardThrew, "emitCode throws on an out-of-vocabulary code (fail-closed guard)");
eq(emitCode(RUN_URL_RED_CODES, "run-url-section-missing"), "run-url-section-missing", "emitCode returns a governed code unchanged");
let guardThrew2 = false;
try { emitCode(STACK_ENV_CODES, "api-failed"); } catch (e) { guardThrew2 = true; }
assert(guardThrew2, "emitCode refuses a code that belongs to a DIFFERENT vocabulary");

// --- B. round extraction ------------------------------------------------------
eq(parseRoundFromName("round-96-closeout.md"), 96, "round-96 filename yields 96");
eq(parseRoundFromName("round-95-closeout.md"), 95, "round-95 filename yields 95");
eq(parseRoundFromName("next-round.md"), null, "a task book with no digits yields null");
eq(parseRoundFromName(""), null, "empty name yields null");

// --- C. Stack line parsing (frozen excerpt, no repo read - R10) ---------------
const realStack = parseStackLine(R95_STACK_EXCERPT);
assert(realStack.present, "the frozen excerpt Stack line is found");
assert(realStack.branch === "r95-exec", "the frozen excerpt branch parses as r95-exec");
assert(realStack.entries.length === 18, "the frozen excerpt chain yields 18 entries (got " + realStack.entries.length + ")");
eq(realStack.entries[0], { butId: "trx", sha: "4a73758b", date: "2026-10-01" }, "first chain element carries but-id + capture sha + date");
eq(realStack.entries[realStack.entries.length - 1], { butId: "xtv", sha: null, date: null }, "the self-referential tail may omit its sha");
const noStack = parseStackLine(docOf("GREEN: " + RUN(1001), null));
assert(!noStack.present, "a doc with no Stack header is reported absent");
const emptyChain = parseStackLine("Stack (x):\n");
assert(emptyChain.present && emptyChain.entries.length === 0, "a Stack header with no chain yields zero entries");
const trailingJunk = parseStackLine("Stack (x):\n  b1 → aaa (aaaaaaa1 @ 2026-10-02) —— 即 b1 tip；已 push（capture 时值 deadbeef @ 2026-10-02）");
eq(trailingJunk.entries.length, 1, "prose after the chain does not create phantom entries");
eq(trailingJunk.entries[0].sha, "aaaaaaa1", "a full-width-paren capture in prose is not mistaken for a chain sha");

// --- D. run-URL section parsing -----------------------------------------------
eq(parseRunUrlSection(docOf("GREEN: " + RUN(1001))).kinds, ["GREEN"], "GREEN state line is parsed");
eq(parseRunUrlSection(docOf("PENDING: stack-unpushed — note")).pendingCodes, ["stack-unpushed"], "PENDING code is parsed");
eq(parseRunUrlSection(docOf("PENDING: stack-unpushed")).kinds, ["PENDING"], "PENDING state line is parsed");
eq(parseRunUrlSection(docOf("**PENDING — prose only。** " + RUN(1001))).kinds, [], "a prose PENDING with a URL yields no state line (F8-b)");
assert(parseRunUrlSection(docOf("GREEN: https://github.com/o/r/actions/runs/")).malformedUrl, "a GREEN line with an id-less run path is flagged malformed");
eq(parseRunUrlSection(docOf("GREEN: " + RUN(1001) + "\nPENDING: stack-unpushed")).kinds, ["GREEN", "PENDING"], "both state lines are collected (the caller must red an ambiguous doc)");
assert(!parseRunUrlSection("# Handoff\n\n## 下一轮候选\n\n- n/a\n").present, "a doc without the section is reported absent");

// --- E. fixture-driven truth table (shared with the E2E smoke) ----------------
const fixtureFiles = fs.readdirSync(FIXDIR).filter((f) => f.endsWith(".json")).sort();
assert(fixtureFiles.length >= 26, "the shared fixture set is present (" + fixtureFiles.length + " files)");
const fixtureResults = [];
for (const f of fixtureFiles) {
  const fx = JSON.parse(fs.readFileSync(path.join(FIXDIR, f), "utf8"));
  const r = assessHandoffLint({ text: fx.doc, round: fx.round, env: fx.env });
  fixtureResults.push({ f: f, r: r });
  const got = {
    verdict: r.verdict,
    scope: r.scope,
    runUrlState: r.runUrl ? r.runUrl.state : null,
    stackState: r.stack ? r.stack.state : null,
    redCodes: r.redCodes.slice().sort(),
    annotations: r.annotations.slice().sort(),
  };
  const want = {
    verdict: fx.expect.verdict,
    scope: fx.expect.scope,
    runUrlState: fx.expect.runUrlState,
    stackState: fx.expect.stackState,
    redCodes: fx.expect.redCodes.slice().sort(),
    annotations: fx.expect.annotations.slice().sort(),
  };
  eq(got, want, "fixture " + f + " matches its declared expectation");
  if (fx.expect.runUrlVerifiedPending !== undefined) {
    eq(r.runUrl.verifiedPending, fx.expect.runUrlVerifiedPending, "fixture " + f + " verifiedPending matches (R1/R2)");
  }
}

// --- F. Stack three-element grid: all 8 combinations --------------------------
for (const butOk of [true, false]) {
  for (const shaOk of [true, false]) {
    for (const tailOk of [true, false]) {
      const env = baseEnv();
      if (!butOk) env.but.ids = ["aaa"];
      if (!shaOk) env.git.commitObjects.bbbbbbb2 = "blob";
      if (!tailOk) env.git.resolveSha.bbbbbbb2 = SHA.outside;
      const leg = assessStackLeg(parseStackLine(STACK_OK), env);
      const label = "stack grid i=" + butOk + " ii=" + shaOk + " iii=" + tailOk;
      const wantRed = !butOk || !shaOk || !tailOk;
      assert(leg.state === (wantRed ? "RED" : "GREEN"), label + " -> " + leg.state);
      eq(leg.redCodes.includes("but-id-not-resolved"), !butOk, label + " but-id-not-resolved iff element i fails");
      eq(leg.redCodes.includes("sha-not-commit"), !shaOk, label + " sha-not-commit iff element ii fails");
      eq(leg.redCodes.includes("chain-tail-not-in-branch"), !tailOk, label + " chain-tail-not-in-branch iff element iii fails");
    }
  }
}

// --- G. OPA: every judgement has an allow case AND a deny case ---------------
const unpushedEnv = () => { const e = baseEnv(); e.git.branchRefs = {}; e.git.stackBranchMembers = { [BRANCH]: null }; return e; };
const coveredEnv = () => { const e = baseEnv(); e.workflows.pushBranches = ["main", BRANCH]; return e; };
const allowDeny = [
  ["GREEN run",
    () => assessRunUrlLeg(parseRunUrlSection(docOf("GREEN: " + RUN(1001))), parseStackLine(STACK_OK), baseEnv()).state === "GREEN",
    () => { const e = baseEnv(); e.gh.runs[1002] = { head_sha: SHA.outside, conclusion: "success", workflow: "ci", repo: REPO }; return assessRunUrlLeg(parseRunUrlSection(docOf("GREEN: " + RUN(1002))), parseStackLine(STACK_OK), e).state === "RED"; }],
  ["PENDING stack-unpushed",
    () => assessRunUrlLeg(parseRunUrlSection(docOf("PENDING: stack-unpushed")), parseStackLine(STACK_OK), unpushedEnv()).state === "PENDING",
    () => assessRunUrlLeg(parseRunUrlSection(docOf("PENDING: stack-unpushed")), parseStackLine(STACK_OK), baseEnv()).state === "RED"],
  ["PENDING pushed-no-branch-runs",
    () => assessRunUrlLeg(parseRunUrlSection(docOf("PENDING: pushed-no-branch-runs")), parseStackLine(STACK_OK), baseEnv()).state === "PENDING",
    () => assessRunUrlLeg(parseRunUrlSection(docOf("PENDING: pushed-no-branch-runs")), parseStackLine(STACK_OK), coveredEnv()).state === "RED"],
  ["but-id resolution",
    () => assessStackLeg(parseStackLine(STACK_OK), baseEnv()).state === "GREEN",
    () => assessStackLeg(parseStackLine(stackOf(["aaa (aaaaaaa1 @ 2026-10-02)", "zzz (bbbbbbb2 @ 2026-10-02)"])), baseEnv()).redCodes.includes("but-id-not-resolved")],
  ["capture sha is a commit",
    () => assessStackLeg(parseStackLine(STACK_OK), baseEnv()).state === "GREEN",
    () => { const e = baseEnv(); e.git.commitObjects.aaaaaaa1 = "tag"; return assessStackLeg(parseStackLine(STACK_OK), e).redCodes.includes("sha-not-commit"); }],
  ["chain tail membership",
    () => assessStackLeg(parseStackLine(STACK_OK), baseEnv()).state === "GREEN",
    () => { const e = baseEnv(); e.git.resolveSha.bbbbbbb2 = SHA.outside; return assessStackLeg(parseStackLine(STACK_OK), e).redCodes.includes("chain-tail-not-in-branch"); }],
  ["state line presence",
    () => parseRunUrlSection(docOf("GREEN: " + RUN(1001))).kinds.length === 1,
    () => parseRunUrlSection(docOf("**PENDING — prose。** " + RUN(1001))).kinds.length === 0],
  ["closed vocabulary",
    () => assessRunUrlLeg(parseRunUrlSection(docOf("PENDING: stack-unpushed")), parseStackLine(STACK_OK), unpushedEnv()).state !== "RED",
    () => assessRunUrlLeg(parseRunUrlSection(docOf("PENDING: waived")), parseStackLine(STACK_OK), baseEnv()).redCodes.includes("pending-reason-out-of-vocabulary")],
  ["verified PENDING needs readable facts (R1)",
    () => assessRunUrlLeg(parseRunUrlSection(docOf("PENDING: stack-unpushed")), parseStackLine(STACK_OK), unpushedEnv()).verifiedPending === true,
    () => { const e = unpushedEnv(); e.git.ok = false; return assessRunUrlLeg(parseRunUrlSection(docOf("PENDING: stack-unpushed")), parseStackLine(STACK_OK), e).verifiedPending === false; }],
  ["verified PENDING needs readable workflows (R2)",
    () => assessRunUrlLeg(parseRunUrlSection(docOf("PENDING: pushed-no-branch-runs")), parseStackLine(STACK_OK), baseEnv()).verifiedPending === true,
    () => { const e = baseEnv(); e.workflows.ok = false; return assessRunUrlLeg(parseRunUrlSection(docOf("PENDING: pushed-no-branch-runs")), parseStackLine(STACK_OK), e).verifiedPending === false; }],
  ["repo conjunct (N4)",
    () => assessRunUrlLeg(parseRunUrlSection(docOf("GREEN: " + RUN(1001))), parseStackLine(STACK_OK), baseEnv()).state === "GREEN",
    () => { const e = baseEnv(); e.gh.runs[1001].repo = "someone/fork"; return assessRunUrlLeg(parseRunUrlSection(docOf("GREEN: " + RUN(1001))), parseStackLine(STACK_OK), e).state === "RED"; }],
  ["repo conjunct fails closed when the run has no repo (N4)",
    () => assessRunUrlLeg(parseRunUrlSection(docOf("GREEN: " + RUN(1001))), parseStackLine(STACK_OK), baseEnv()).state === "GREEN",
    () => { const e = baseEnv(); delete e.gh.runs[1001].repo; return assessRunUrlLeg(parseRunUrlSection(docOf("GREEN: " + RUN(1001))), parseStackLine(STACK_OK), e).state === "RED"; }],
];
for (const [label, allow, deny] of allowDeny) {
  assert(allow(), "OPA allow case passes: " + label);
  assert(deny(), "OPA deny case is caught: " + label);
}

// --- H. every degradation cause is exercised at least once --------------------
const GREEN_DOC = () => docOf("GREEN: " + RUN(1001));
const PUSHED_PENDING_DOC = () => docOf("PENDING: pushed-no-branch-runs");
const degradeCases = [
  ["gh-missing", GREEN_DOC, () => { const e = baseEnv(); e.gh.ok = false; return e; }, "run-url:verification-unavailable:gh-missing"],
  ["repo-parse", GREEN_DOC, () => { const e = baseEnv(); e.repo = ""; return e; }, "run-url:verification-unavailable:repo-parse"],
  ["api-failed", GREEN_DOC, () => { const e = baseEnv(); e.gh.runs[1001] = "api-failed"; return e; }, "run-url:verification-unavailable:api-failed"],
  ["ref-unavailable", GREEN_DOC, () => { const e = baseEnv(); e.git.stackBranchMembers = { [BRANCH]: null }; return e; }, "run-url:verification-unavailable:ref-unavailable"],
  ["git-down", GREEN_DOC, () => { const e = baseEnv(); e.git.ok = false; e.git.stackBranchMembers = {}; e.git.branchRefs = {}; return e; }, "run-url:verification-unavailable:ref-unavailable"],
  ["workflows-down", PUSHED_PENDING_DOC, () => { const e = baseEnv(); e.workflows.ok = false; return e; }, "run-url:verification-unavailable:ref-unavailable"],
  ["stack-unavailable", GREEN_DOC, () => { const e = baseEnv(); e.but.ok = false; return e; }, "stack:stack-unavailable"],
  ["but-ids-shape-gap", GREEN_DOC, () => { const e = baseEnv(); delete e.but.ids; return e; }, "stack:stack-unavailable"],
  ["stack-ref-unavailable", GREEN_DOC, () => { const e = baseEnv(); e.git.stackBranchMembers = { [BRANCH]: null }; return e; }, "stack:ref-unavailable"],
  ["shallow-clone", GREEN_DOC, () => { const e = baseEnv(); e.git.shallow = true; return e; }, "stack:shallow-clone"],
];
for (const [label, doc, mk, want] of degradeCases) {
  const r = assessHandoffLint({ text: doc(), round: 96, env: mk() });
  assert(r.verdict === "PENDING", "degradation " + label + " is a non-blocking PENDING (got " + r.verdict + ")");
  assert(r.annotations.includes(want), "degradation " + label + " carries the annotation " + want + " (got " + JSON.stringify(r.annotations) + ")");
  if (/git-down|workflows-down/.test(label)) {
    assert(r.runUrl.verifiedPending === false, "degradation " + label + " is NOT reported as a verified PENDING (R1/R2)");
  }
}

// --- I. boundaries: empty / missing / oversized / garbage ---------------------
const empty = assessHandoffLint({ text: "", round: 96, env: baseEnv() });
assert(empty.verdict === "RED", "an empty document is RED, not a vacuous pass");
assert(empty.problems.length >= 2, "an empty document names both missing fields");
const missing = assessHandoffLint({ text: docOf("GREEN: " + RUN(1001)), round: 96, env: {} });
assert(missing.verdict === "PENDING" || missing.verdict === "RED", "a missing env snapshot never throws and never passes vacuously");
assert(assessHandoffLint({}).verdict === "RED", "a call with no arguments is RED");
assert(assessHandoffLint(undefined).verdict === "RED", "an undefined input is RED, not a crash");
const huge = docOf("GREEN: " + RUN(1001), STACK_OK + " " + "x".repeat(200000));
assert(assessHandoffLint({ text: huge, round: 96, env: baseEnv() }).verdict === "GREEN", "a 200k-char document is handled without throwing");
assert(assessHandoffLint({ text: docOf("GREEN: " + RUN(1001)), round: 96, env: { git: null, gh: null, but: null, workflows: null } }).verdict === "PENDING", "a null-shaped env degrades to PENDING rather than throwing");
assert(assessHandoffLint({ text: docOf("GREEN: " + RUN(1001)), round: 96, env: { gh: { ok: true, runs: {} } } }).verdict === "PENDING", "an unresolvable run id degrades, it does not throw");
assert(assessHandoffLint({ text: docOf("GREEN: " + RUN(1001)), round: 96, env: { git: { ok: true }, gh: { ok: true }, but: { ok: true }, workflows: { ok: true } } }).verdict === "PENDING", "a shape-incomplete env degrades rather than throwing");

// --- J. effective-scope boundary (no content grandfathering) ------------------
assert(assessHandoffLint({ text: docOf("**PENDING — prose。** " + RUN(1001)), round: 95, env: baseEnv() }).scope === "legacy", "round 95 is judged by the legacy presence-only rule");
assert(assessHandoffLint({ text: docOf("**PENDING — prose。** " + RUN(1001)), round: 95, env: baseEnv() }).verdict === "GREEN", "legacy round 95 passes presence-only even without a state line");
assert(assessHandoffLint({ text: docOf("**PENDING — prose。** " + RUN(1001)), round: 96, env: baseEnv() }).verdict === "RED", "round 96 is judged by the three-state grammar");
assert(assessHandoffLint({ text: docOf("GREEN: " + RUN(1001)), round: null, env: baseEnv() }).scope === "three-state", "an unparseable round defaults to the strict grammar (fail-closed)");

// --- K. freshness annotation is advisory, never a red -------------------------
const stale = baseEnv();
stale.now = "2026-12-31";
const staleLeg = assessStackLeg(parseStackLine(STACK_OK), stale);
assert(staleLeg.state !== "RED", "an over-age capture never reddens the leg (the RED vocabulary stays closed)");
assert(staleLeg.annotations.some((a) => a.startsWith("stale-capture:")), "an over-age capture is surfaced as an annotation");
assert(assessStackLeg(parseStackLine(STACK_OK), baseEnv()).annotations.every((a) => !a.startsWith("stale-capture:")), "a fresh capture carries no staleness annotation");
const tight = baseEnv();
tight.now = "2026-12-31";
tight.maxCaptureAgeDays = 1;
assert(assessStackLeg(parseStackLine(STACK_OK), tight).state !== "RED", "a tight freshness bound still cannot produce RED (the vocabulary is closed)");
const wide = baseEnv();
wide.now = "2026-12-31";
wide.maxCaptureAgeDays = 3650;
assert(!assessStackLeg(parseStackLine(STACK_OK), wide).annotations.some((a) => a.startsWith("stale-capture:")), "the freshness bound is configurable (a wide bound silences the annotation)");

// --- L. the core stays pure (D-004 red line) ----------------------------------
const coreSrc = fs.readFileSync(path.join(__dirname, "..", "..", "..", "scripts", "handoff-lint-verdict.mjs"), "utf8");
const coreCode = coreSrc.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
for (const token of ["require(", "from \"node:", "from \u0027node:", "spawnSync", "Date.now(", "process.env", "fs."]) {
  assert(!coreCode.includes(token), "core purity: no " + token + " in executable code");
}
assert(!/^import\s/m.test(coreCode), "core purity: no module imports at all");

// --- M. vocabulary closure: every emitted code is governed (R3/R4) ------------
function annotationCode(a) {
  const m1 = /^run-url:verification-unavailable:(.+)$/.exec(a);
  if (m1) return m1[1];
  const m3 = /^stack:(stale-capture):/.exec(a);
  if (m3) return m3[1];
  const m2 = /^stack:([a-z-]+)$/.exec(a);
  if (m2) return m2[1];
  return null;
}
let emittedChecked = 0;
for (const entry of fixtureResults) {
  for (const c of entry.r.redCodes) {
    emittedChecked++;
    assert(isKnownCode(c), "emitted RED code " + c + " (" + entry.f + ") is governed by a vocabulary constant");
  }
  for (const a of entry.r.annotations) {
    emittedChecked++;
    const c = annotationCode(a);
    assert(c !== null, "annotation " + a + " (" + entry.f + ") has a governed shape");
    assert(c !== null && isKnownCode(c), "annotation code " + String(c) + " (" + entry.f + ") is governed by a vocabulary constant");
  }
}
assert(emittedChecked > 20, "the closure sweep actually inspected emitted codes (" + emittedChecked + ")");
// Every RED code constant must be reachable from at least one fixture (R4: a
// zero-coverage rejection branch is indistinguishable from a dead one).
const fixtureRedCodes = new Set(fixtureResults.flatMap((e) => e.r.redCodes));
for (const c of [...RUN_URL_RED_CODES, ...STACK_RED_CODES, ...STACK_STRUCTURAL_RED_CODES]) {
  assert(fixtureRedCodes.has(c), "RED code " + c + " is exercised by at least one fixture");
}

// --- N. explicit rejection cases for every previously-uncovered RED code (R4) -
const rejectionCases = [
  ["run-url-section-missing", () => assessHandoffLint({ text: docWithoutSection(), round: 96, env: baseEnv() })],
  ["run-url-state-ambiguous", () => assessHandoffLint({ text: docOf("GREEN: " + RUN(1001) + "\nPENDING: stack-unpushed"), round: 96, env: baseEnv() })],
  ["run-url-unparseable", () => assessHandoffLint({ text: docOf("GREEN: https://github.com/" + REPO + "/actions/runs/"), round: 96, env: baseEnv() })],
  ["run-url-unparseable", () => assessHandoffLint({ text: docOf("GREEN: see the CI tab"), round: 96, env: baseEnv() })],
  ["run-url-state-line-missing", () => assessHandoffLint({ text: docOf("**PENDING — prose。** " + RUN(1001)), round: 96, env: baseEnv() })],
  ["declaration-fact-conflict", () => assessHandoffLint({ text: docOf("PENDING: stack-unpushed"), round: 96, env: baseEnv() })],
  ["declaration-fact-conflict", () => assessHandoffLint({ text: docOf("PENDING: pushed-no-branch-runs"), round: 96, env: coveredEnv() })],
  ["stack-chain-empty", () => assessHandoffLint({ text: docOf("GREEN: " + RUN(1001), "Stack（primary key = GitButler change-ids）："), round: 96, env: baseEnv() })],
  ["stack-line-missing", () => assessHandoffLint({ text: docOf("GREEN: " + RUN(1001), null), round: 96, env: baseEnv() })],
  ["green-claim-falsified", () => { const e = baseEnv(); e.gh.runs[1001].conclusion = "failure"; return assessHandoffLint({ text: docOf("GREEN: " + RUN(1001)), round: 96, env: e }); }],
  ["green-claim-falsified", () => { const e = baseEnv(); e.gh.runs[1001].workflow = "native-smoke"; return assessHandoffLint({ text: docOf("GREEN: " + RUN(1001)), round: 96, env: e }); }],
  ["pending-reason-out-of-vocabulary", () => assessHandoffLint({ text: docOf("PENDING: waived"), round: 96, env: baseEnv() })],
  ["pending-reason-out-of-vocabulary", () => assessHandoffLint({ text: docOf("PENDING: time-boxed"), round: 96, env: baseEnv() })],
  ["but-id-not-resolved", () => assessHandoffLint({ text: docOf("GREEN: " + RUN(1001), stackOf(["aaa (aaaaaaa1 @ 2026-10-02)", "zzz (bbbbbbb2 @ 2026-10-02)"])), round: 96, env: baseEnv() })],
  ["sha-not-commit", () => { const e = baseEnv(); e.git.commitObjects.aaaaaaa1 = "tree"; return assessHandoffLint({ text: docOf("GREEN: " + RUN(1001)), round: 96, env: e }); }],
  ["chain-tail-not-in-branch", () => { const e = baseEnv(); e.git.resolveSha.bbbbbbb2 = SHA.outside; return assessHandoffLint({ text: docOf("GREEN: " + RUN(1001)), round: 96, env: e }); }],
];
for (const [code, run] of rejectionCases) {
  const r = run();
  assert(r.verdict === "RED", "rejection case for " + code + " yields RED (got " + r.verdict + ")");
  assert(r.redCodes.includes(code), "rejection case names the RED code " + code + " (got " + JSON.stringify(r.redCodes) + ")");
  for (const c of r.redCodes) assert(isKnownCode(c), "rejection case " + code + " emits a governed code " + c);
  for (const a of r.annotations) {
    const ac = annotationCode(a);
    assert(ac !== null && isKnownCode(ac), "rejection case " + code + " annotation " + a + " is governed");
  }
}

// --- O. report summaries are produced once, by the core (N7) -----------------
const summary = assessHandoffLint({ text: docOf("PENDING: stack-unpushed"), round: 96, env: unpushedEnv() });
eq(summary.pendingSummary, ["run-url:stack-unpushed", "stack:ref-unavailable"], "pendingSummary carries the run-url and stack PENDING codes");
eq(assessHandoffLint({ text: docOf("GREEN: " + RUN(1001)), round: 96, env: baseEnv() }).pendingSummary, [], "a GREEN doc has an empty pendingSummary");
eq(assessHandoffLint({ text: docOf("GREEN: " + RUN(1002)), round: 96, env: baseEnv() }).redCodes, [], "a PENDING (unresolved run id) doc emits no RED code");

// --- fail-on-empty red line ---------------------------------------------------
assert(passed > 180, "fail-on-empty: the truth table actually executed (" + passed + " assertions)");

console.log("handoff-lint-verdict.test: " + passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
