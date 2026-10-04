// packages/store/test/handoff-lint-e2e.test.mjs
// ADR-0097 (R96 T2 / D-004): E2E smoke that locks the handoff-lint WIRING.
//
// The unit test proves the core decides correctly; this file proves the shell
// is wired correctly - the snapshot shape, the collect -> transmit -> report
// path, and the verdict -> exit mapping. Every case drives the REAL shell entry
// point (runHandoffLint) through the REAL collection code; only the process
// boundary is stubbed, so a shape drift between shell and core goes red here.
// The same fixture set (fixtures/handoff-lint) is shared with the unit test.
// Exit non-zero on any failure.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  runHandoffLint,
  parseButStatusIds,
  parseWorkflowTriggers,
  deriveWorkflowName,
  collectWorkflowTriggers,
  newestCloseoutTargets,
  buildReportOnlyScan,
  resolveReuse,
  collectDeferred,
  collectSnapshot,
  evaluateHandoffLintDocuments,
} from "../../../scripts/handoff-lint-shell.mjs";
import { runEnforcementAnchors, ANCHOR_RED_CODES } from "../../../scripts/enforcement-anchors.mjs";
import { CODE_GROUPS, parseStackLine } from "../../../scripts/handoff-lint-verdict.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..", "..", "..");
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

// A process-boundary stub that answers git / gh / but from a fixture snapshot.
// This is the only faked layer: everything above it (collectSnapshot, the pure
// core, buildHandoffLintReport) runs for real.
function makeSpawnSync(env) {
  const out = (stdout) => ({ status: 0, stdout: String(stdout ?? ""), stderr: "", error: null });
  const err = (status) => ({ status: status === undefined ? 1 : status, stdout: "", stderr: "", error: null });
  const g = env.git || {};
  const b = env.but || {};
  const h = env.gh || {};
  return (cmd, args) => {
    if (cmd === "git") {
      if (args[0] === "rev-parse" && args[1] === "--git-dir") return g.ok === false ? err() : out(".git");
      if (args[0] === "rev-parse" && args[1] === "--is-shallow-repository") return out(g.shallow ? "true" : "false");
      if (args[0] === "rev-parse" && args[1] === "--verify") {
        const target = args[args.length - 1];
        const m = /^refs\/remotes\/origin\/(.+)$/.exec(target);
        if (m) {
          const sha = (g.branchRefs || {})[m[1]];
          return sha ? out(sha) : err();
        }
        const full = (g.resolveSha || {})[target];
        return full ? out(full) : err();
      }
      if (args[0] === "rev-list") {
        const m = /^origin\/main\.\.origin\/(.+)$/.exec(args[1]);
        const members = m ? (g.stackBranchMembers || {})[m[1]] : null;
        return Array.isArray(members) ? out(members.join("\n")) : err();
      }
      if (args[0] === "cat-file" && args[1] === "-t") {
        const t = (g.commitObjects || {})[args[2]];
        return t ? out(t) : err();
      }
      if (args[0] === "remote" && args[1] === "get-url") return env.repo ? out("git@github.com:" + env.repo + ".git") : err();
      return err();
    }
    if (cmd === "but") {
      if (b.ok === false) return err();
      const ids = b.ids || [];
      return out(["\u256D\u2504 zz [uncommitted] (no changes)", "\u250A", "\u250A\u256D\u2504 r9 [r96-handoff-lint]"].concat(ids.map((id) => "\u250A\u25CF " + id + " ChgId1 2026-10-02 00:00:00 +0800 (sha deadbeef)")).join("\n"));
    }
    if (cmd === "gh") {
      if (args[0] === "--version") return h.ok === false ? err() : out("gh version 2.0.0");
      if (args[0] === "api") {
        const m = /actions\/runs\/(\d+)$/.exec(args[1]);
        const run = m ? (h.runs || {})[m[1]] : null;
        if (!run || run === "api-failed") return err();
        return out(JSON.stringify({ head_sha: run.head_sha, conclusion: run.conclusion, name: run.workflow, path: ".github/workflows/" + run.workflow + ".yml", repo: run.repo }));
      }
      return err();
    }
    return err();
  };
}

// --- A. every shared fixture drives the full shell path -----------------------
const fixtureFiles = fs.readdirSync(FIXDIR).filter((f) => f.endsWith(".json")).sort();
assert(fixtureFiles.length >= 20, "the shared fixture set is present (" + fixtureFiles.length + " files)");
for (const f of fixtureFiles) {
  const fx = JSON.parse(fs.readFileSync(path.join(FIXDIR, f), "utf8"));
  const rel = "round-" + fx.round + "-closeout.md";
  // `expectE2E` overrides `expect` where the honest through-shell outcome
  // differs: the shell collects every branch a document names, so an
  // "uncollected" fact only exists in the unit env (the report-sweep reuse
  // path exercises it end-to-end instead - see section K).
  const e2eExpect = fx.expectE2E ?? fx.expect;
  const result = runHandoffLint({
    root,
    documents: [{ rel, name: rel, text: fx.doc }],
    deps: {
      spawnSync: makeSpawnSync(fx.env),
      workflows: fx.env.workflows,
      now: fx.env.now,
      maxCaptureAgeDays: fx.env.maxCaptureAgeDays,
      registry: fx.env.registry,
      deferred: fx.env.deferred,
    },
  });
  eq(result.perDoc.length, 1, "E2E " + f + " evaluates exactly one document");
  eq(result.perDoc[0].verdict.verdict, e2eExpect.verdict, "E2E " + f + " verdict matches through the shell");
  if (e2eExpect.runUrlVerifiedPending !== undefined) {
    eq(result.perDoc[0].verdict.runUrl.verifiedPending, e2eExpect.runUrlVerifiedPending, "E2E " + f + " verifiedPending matches through the shell (R1/R2)");
  }
  const wantFail = e2eExpect.verdict === "RED";
  eq(result.exitKind, wantFail ? "fail" : "pass", "E2E " + f + " maps to exitKind " + (wantFail ? "fail" : "pass"));
  const kinds = result.lines.map((l) => l.kind);
  if (wantFail) {
    assert(kinds.includes("fail"), "E2E " + f + " emits a fail report line");
    const msg = result.lines.filter((l) => l.kind === "fail").map((l) => l.msg).join("\n");
    for (const c of e2eExpect.redCodes) assert(msg.includes(c), "E2E " + f + " fail line names the RED code " + c);
  } else if (e2eExpect.verdict === "PENDING") {
    assert(kinds.includes("skip"), "E2E " + f + " emits a skip (PENDING) report line");
    const msg = result.lines.filter((l) => l.kind === "skip").map((l) => l.msg).join("\n");
    for (const a of e2eExpect.annotations) {
      assert(msg.includes(a.replace(/^(run-url|stack|clearing|state):/, "")), "E2E " + f + " PENDING line names " + a);
    }
    assert(result.counts.pending === 1 && result.counts.red === 0, "E2E " + f + " counts one PENDING and no RED");
  } else {
    assert(kinds.includes("pass"), "E2E " + f + " emits a pass report line");
    assert(result.counts.green === 1 && result.counts.red === 0 && result.counts.pending === 0, "E2E " + f + " counts exactly one GREEN");
  }
}

// --- B. mixed batch: one RED anywhere fails the whole run ---------------------
const green = JSON.parse(fs.readFileSync(path.join(FIXDIR, "green-verified.json"), "utf8"));
const red = JSON.parse(fs.readFileSync(path.join(FIXDIR, "green-ancestor-run-rejected.json"), "utf8"));
const mixed = runHandoffLint({
  root,
  documents: [
    { rel: "round-96-closeout.md", name: "round-96-closeout.md", text: green.doc },
    { rel: "round-97-closeout.md", name: "round-97-closeout.md", text: red.doc },
  ],
  // one snapshot, two documents: the red fixture env carries BOTH cited runs
  deps: { spawnSync: makeSpawnSync(red.env), workflows: red.env.workflows, now: red.env.now, deferred: red.env.deferred, registry: red.env.registry },
});
eq(mixed.exitKind, "fail", "a mixed batch with one RED fails the whole run");
eq(mixed.counts, { red: 1, pending: 0, green: 1 }, "a mixed batch reports both verdicts");

// --- C. ship-gate wiring ------------------------------------------------------
const sg = fs.readFileSync(path.join(root, "scripts", "ship-gate.mjs"), "utf8");
assert(sg.includes("handoff-lint-shell.mjs"), "ship-gate imports the handoff-lint shell");
assert(sg.includes("runHandoffLint({ root: ROOT, documents })"), "ship-gate calls the shell entry point with the frozen argument shape");
assert(!sg.includes("is-ancestor"), "the ancestor-as-identity liveness hack is gone from ship-gate");
assert(!sg.includes("rev-parse\", \"HEAD\""), "the bare workspace HEAD identity target is gone from ship-gate");
const iCov = sg.indexOf('report("fail", "closeout-coverage:');
const iLint = sg.indexOf('fail("handoff-lint: closeout required fields');
const iDefer = sg.indexOf("exitIfCoverageRed();\n}");
assert(iCov > 0 && iLint > iCov && iDefer > iLint, "mixed red stays diagnosable: coverage reports, then lint, then the deferred exit");

// --- D. real repo facts: the F8-c topology is machine-visible -----------------
const wf = collectWorkflowTriggers(root);
assert(wf.ok, "workflow trigger collection reads .github/workflows");
assert(wf.pushBranches.includes("main"), "the real workflow set covers a push to main");
assert(!wf.pushBranches.includes("r96-handoff-lint") && wf.pushAllBranches === false, "F8-c: no workflow covers a push to a feature branch (the required field is unreachable there)");
const release = parseWorkflowTriggers(fs.readFileSync(path.join(root, ".github", "workflows", "release.yml"), "utf8"));
assert(release.pushBranches.length === 0 && release.pushAllBranches === false, "a tags-only push trigger does not count as branch coverage");

// --- E. but status parsing contract (frozen real-format excerpts) -------------
const verbose = [
  "\u256D\u2504 zz [uncommitted] (no changes)",
  "\u250A",
  "\u250A\u256D\u2504 r9 [r95-audit-loop2]",
  "\u250A\u25CF nvu Euiop1 2026-10-02 00:12:33 +0800 (sha 9e406ee7)",
  "\u250A\u2502     docs(x): y",
  "\u250A\u25CF ktq Euiop1 2026-10-01 22:43:04 +0800 (sha f5f9d30a)",
  "\u250A",
  "\u250A\u256D\u2504 au [r95-audit]",
  "\u250A\u25CF kqq Euiop1 2026-10-01 13:39:56 +0800 (sha e9190d9a)",
].join("\n");
eq(parseButStatusIds(verbose).ids, ["nvu", "ktq", "kqq"], "verbose but status yields the CLI id column");
eq(parseButStatusIds(verbose).degraded, false, "verbose sample carries no unknown marker");
const compact = [
  "\u256D\u2504 zz [uncommitted] (no changes)",
  "\u250A",
  "\u250A\u256D\u2504 r9 [r96-handoff-lint]",
  "\u250A\u25CF   mwp docs(r96-t0): x",
].join("\n");
eq(parseButStatusIds(compact).ids, ["mwp"], "compact but status yields the CLI id column too");
eq(parseButStatusIds("").ids, [], "an empty but status yields no ids");
eq(parseButStatusIds("\u256D\u2504 zz [uncommitted] (no changes)").ids, [], "a header-only but status yields no ids");
// N5 systematic glyph sweep: every observed but marker parses, unknown shapes degrade whole (never swallow)
const glyphs = [
  "\u256D\u2504 zz [uncommitted] (no changes)",
  "\u250A",
  "\u250A\u256D\u2504 r9 [r97-probe]",
  "\u250A\u25CF aaa Euiop1 2026-10-03 00:00:00 +0800 (sha 11111111)",
  "\u250A\u25C9 bbb Euiop1 2026-10-03 00:00:00 +0800 (sha 22222222)",
  "\u250A\u25D0 ccc Euiop1 2026-10-03 00:00:00 +0800 (sha 33333333)",
  "\u250A\u2502     docs(x): y",
].join("\n");
eq(parseButStatusIds(glyphs).ids, ["aaa", "bbb", "ccc"], "all three observed glyphs parse and detail lines yield no phantom ids");
eq(parseButStatusIds(glyphs).degraded, false, "the full glyph set does not degrade");
eq(parseButStatusIds("\u250A\u25CF\n").degraded, true, "a bullet with no id degrades the whole parse");

// --- F. workflow identity ----------------------------------------------------
eq(deriveWorkflowName({ path: ".github/workflows/ci.yml", name: "CI" }), "ci", "workflow identity prefers the file stem");
eq(deriveWorkflowName({ path: "", name: "ship-gate" }), "ship-gate", "workflow identity falls back to the run name");

// --- G. every governed RED code is exercised by a shared fixture (R4) ----------
const REQUIRED_RED_COVERAGE = [
  "run-url-section-missing",
  "run-url-state-line-missing",
  "run-url-state-ambiguous",
  "run-url-unparseable",
  "pending-reason-out-of-vocabulary",
  "declaration-fact-conflict",
  "green-claim-falsified",
  "stack-line-missing",
  "stack-chain-empty",
  "but-id-not-resolved",
  "sha-not-commit",
  "chain-tail-not-in-branch",
  "state-marker-unparseable",
  "state-predicate-out-of-vocabulary",
  "bare-word-violation",
  "clearing-residual-unregistered",
];
const exercisedRedCodes = new Set();
for (const f of fixtureFiles) {
  const fx = JSON.parse(fs.readFileSync(path.join(FIXDIR, f), "utf8"));
  for (const c of fx.expect.redCodes) exercisedRedCodes.add(c);
}
for (const c of REQUIRED_RED_COVERAGE) {
  assert(exercisedRedCodes.has(c), "RED code " + c + " is exercised by at least one shared fixture (R4: no dead rejection branch)");
}

// --- H. real repo data: the newest closeout Stack line still parses -----------
const r95Doc = fs.readFileSync(path.join(root, ".scratch", "grill-round-95", "handoffs", "round-95-closeout.md"), "utf8");
const r95Stack = parseStackLine(r95Doc);
assert(r95Stack.present && r95Stack.branch === "r95-exec", "the real r95 closeout Stack line parses (branch r95-exec)");
eq(r95Stack.entries.length, 18, "the real r95 closeout Stack chain yields 18 entries");

// --- I. template <-> core vocabulary lock (R5: bidirectional set equality) ----
const GROUP_MAP = {
  "run-url-red": "runUrlRed",
  "stack-red": "stackRed",
  "stack-structural-red": "stackStructuralRed",
  "stack-env": "stackEnv",
  "stack-advisory": "stackAdvisory",
  "verification-unavailable": "verificationUnavailable",
  "pending-reason": "pendingReason",
  "state-red": "stateRed",
  "state-pending": "statePending",
  "clearing-red": "clearingRed",
  "clearing-env": "clearingEnv",
};
const tplText = fs.readFileSync(path.join(root, "docs", "agents", "handoff-template.md"), "utf8");
const vocabLines = tplText.split("\n").filter((l) => /^(run-url-red|stack-red|stack-structural-red|stack-env|stack-advisory|verification-unavailable|pending-reason|state-red|state-pending|clearing-red|clearing-env):/.test(l));
eq(vocabLines.length, Object.keys(GROUP_MAP).length, "the template declares every governed vocabulary group");
for (const line of vocabLines) {
  const idx = line.indexOf(":");
  const group = line.slice(0, idx);
  const codes = line.slice(idx + 1).split("|").map((x) => x.trim()).filter(Boolean).sort();
  const key = GROUP_MAP[group];
  assert(!!key, "template vocabulary group " + group + " maps to a CODE_GROUPS key");
  eq(codes, CODE_GROUPS[key].slice().sort(), "template group " + group + " is set-equal to CODE_GROUPS." + key);
}
for (const k of Object.keys(CODE_GROUPS)) {
  assert(Object.keys(GROUP_MAP).map((g) => GROUP_MAP[g]).includes(k), "CODE_GROUPS." + k + " is declared in the template (no core-only vocabulary)");
}

// --- J. deps.repo is a live seam (N7: it had no consumer before) --------------
const repoOverride = runHandoffLint({
  root,
  documents: [{ rel: "round-96-closeout.md", name: "round-96-closeout.md", text: green.doc }],
  deps: { spawnSync: makeSpawnSync(green.env), workflows: green.env.workflows, now: green.env.now, repo: "someone/else" },
});
eq(repoOverride.perDoc[0].verdict.runUrl.state, "RED", "a deps.repo override reaches the core and fails the repo conjunct");
eq(repoOverride.exitKind, "fail", "the deps.repo override also flips the exit kind");
// --- K. self-moving target + report-only split (ADR-0098 D3) -------------------
eq(newestCloseoutTargets([]), [], "no round dirs is an explicit empty pick");
eq(newestCloseoutTargets([{ name: "grill-round-97", n: 97, hasCloseout: false, closeouts: [] }]), [], "a round without closeouts is skipped");
eq(newestCloseoutTargets([
  { name: "grill-round-97", n: 97, hasCloseout: false, closeouts: [] },
  { name: "grill-round-96", n: 96, hasCloseout: true, closeouts: ["round-96-closeout.md"] },
]), [".scratch/grill-round-96/handoffs/round-96-closeout.md"], "the newest dir WITH closeouts wins (self-moving target)");
{
  const red = JSON.parse(fs.readFileSync(path.join(FIXDIR, "stack-line-missing.json"), "utf8"));
  const ro = buildReportOnlyScan({ documents: [{ rel: "round-96-closeout.md", name: "round-96-closeout.md", text: red.doc }], snapshot: red.env });
  assert(ro.lines.length > 0 && ro.lines.every((l) => l.kind === "info"), "the report-only sweep never fails, even on a RED doc");
  eq(ro.counts.red, 1, "the report-only sweep still counts the RED doc");
}
{
  // S-1/R1: a closeout naming a branch the snapshot never collected must not
  // verify - the report sweep hands every doc the gate snapshot, so an
  // unattempted branch must degrade, never read as "absent".
  const greenFx = JSON.parse(fs.readFileSync(path.join(FIXDIR, "green-verified.json"), "utf8"));
  const gateRun = runHandoffLint({
    root,
    documents: [{ rel: "round-96-closeout.md", name: "round-96-closeout.md", text: greenFx.doc }],
    deps: { spawnSync: makeSpawnSync(greenFx.env), workflows: greenFx.env.workflows, now: greenFx.env.now, deferred: greenFx.env.deferred },
  });
  const foreign = JSON.parse(fs.readFileSync(path.join(FIXDIR, "pending-stack-unpushed-uncollected.json"), "utf8"));
  // The gate snapshot only ever collected r96-handoff-lint; retarget the
  // foreign doc to a branch the snapshot never saw (the true S-1 shape: a
  // report-swept closeout whose branch was never attempted).
  const ro = evaluateHandoffLintDocuments({
    documents: [{ rel: "round-97-closeout.md", name: "round-97-closeout.md", text: foreign.doc.replace(/r96-handoff-lint/g, "r99-uncollected") }],
    snapshot: gateRun.snapshot,
  });
  eq(ro.perDoc[0].verdict.verdict, "PENDING", "report-only sweep: an uncollected branch degrades to env-PENDING, never a silent GREEN");
  eq(ro.perDoc[0].verdict.runUrl.verifiedPending, false, "an uncollected branch is not a verified PENDING either");
  assert(ro.perDoc[0].verdict.annotations.includes("run-url:verification-unavailable:ref-unavailable"), "the uncollected degradation carries the ref-unavailable annotation");
}

// --- L. P-7: but-status detail rows are content, never commit rows ------------
{
  const detail = parseButStatusIds(
    [
      "\u250A\u2502     \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500",
      "\u250A\u2502     \u25CF file.md",
      "\u250A\u2502     \uFF08\u4e2d\u6587\uFF09",
      "\u250A\u25CF abc x",
      "\u250A\u25D0 def y",
    ].join("\n")
  );
  eq(detail, { ids: ["abc", "def"], degraded: false }, "P-7: symbol-leading detail rows are skipped, not ids and not degradation");
  eq(parseButStatusIds("\u25CF ?? garbage").degraded, true, "P-7: commit-column non-parse still degrades the whole parse (N5 fail-closed)");
  eq(parseButStatusIds("\u250A\u2502     \u25CF ?z").degraded, false, "P-7: a non-parse deeper in the detail gutter stays content");
}

// --- M. R4/P-9: reuse pointers are the wiring, not comments --------------------
{
  const resolved = resolveReuse("parseWorkflowTriggers/collectWorkflowTriggers");
  assert(resolved && resolved.names.length === 2 && typeof resolved.fns.collectWorkflowTriggers === "function", "the production reuse spec resolves both names from the module exports");
  eq(resolveReuse("notAFunction/collectWorkflowTriggers"), null, "an unresolvable reuse pointer fails closed");
  eq(resolveReuse(null), null, "a null reuse spec resolves nothing");
  const snap = collectSnapshot({
    root,
    branches: [],
    deps: {
      spawnSync: makeSpawnSync({ git: { ok: false }, but: { ok: false }, gh: { ok: false } }),
      workflows: { ok: false, pushBranches: [], pushAllBranches: false },
      registry: { unpushed: { verify: "x", invalidate: "x", env: "git", reuse: null } },
      deferred: { ok: true, covers: [], pendingPredicates: [] },
    },
  });
  eq(snap.workflows.ok, false, "a registry missing the no-branch-runs entry degrades the workflows source (reuse-pointer consumption proven)");
  assert(snap.registry && typeof snap.registry === "object", "the registry rides the snapshot into the core");
  const def = collectDeferred(root);
  eq(def.ok, true, "the real deferred registry parses");
  assert(def.pendingPredicates.includes("no-pr") && def.pendingPredicates.includes("unpublished"), "R7: the real registry seats no-pr/unpublished as pending predicates");
}

// --- N. enforcement anchors: the detector itself must fail closed -------------
{
  const r = runEnforcementAnchors({ root });
  assert(r.exitKind === "pass" && r.counts.anchors === 5 && r.counts.killed === 5, "the real anchor table is 5/5 consumer-verified");
  // nail ①: an anchor without a runnable fixture is unkillable, never admitted
  const regless = runEnforcementAnchors({ root, deps: { registry: { ok: true, anchors: [{ id: "anchor:ghost", probe: "probeDoesNotExist" }] } } });
  eq(regless.exitKind, "fail", "an anchor with an unresolvable probe is RED (unkillable mutant)");
  assert(regless.lines.some((l) => l.kind === "fail" && l.msg.includes("anchor-unresolvable")), "the unkillable anchor is reported by name");
  assert(regless.lines[regless.lines.length - 1].msg.includes("anchor-not-consumed"), "the summary line carries the fail-closed count");
  // a probe that does not kill = decorative declaration = RED (nail ②: the
  // expected kill is the only mechanical boundary - a probe starved of its
  // fixture facts must not silently pass)
  const dead = runEnforcementAnchors({
    root: path.join(root, "nonexistent-root-dir"),
    deps: { registry: { ok: true, anchors: [{ id: "anchor:dead", probe: "probeRatchetRecount" }] } },
  });
  eq(dead.exitKind, "fail", "a probe that cannot kill on the distorted surface is anchor-not-consumed RED");
  assert(dead.lines.some((l) => l.kind === "fail" && l.msg.includes("anchor-not-consumed")), "the decorative declaration is named anchor-not-consumed");
  // seated anchor: observed, never blocking
  const seated = runEnforcementAnchors({
    root,
    deps: {
      registry: { ok: true, anchors: [{ id: "anchor:ratchet-recount", probe: "probeRatchetRecount" }] },
      deferred: { ok: true, pendingAnchors: ["anchor:ratchet-recount"], covers: [], pendingPredicates: [] },
    },
  });
  eq(seated.exitKind, "pass", "a seated anchor never blocks");
  assert(seated.lines.some((l) => l.msg.includes("pending-anchor")), "the seat is surfaced in the report");
  // an unreadable registry file is fail-closed
  const broken = runEnforcementAnchors({ root, deps: { registry: { ok: false, anchors: [] } } });
  eq(broken.exitKind, "fail", "an unreadable anchor registry is fail-closed");
  // fifth cell (audit F-2): an empty or shape-missing registry is fail-closed —
  // a detector retired by emptying its table would be vacuous-pass decorative
  const emptyArr = runEnforcementAnchors({ root, deps: { registry: { ok: true, anchors: [] } } });
  eq(emptyArr.exitKind, "fail", "an empty anchors list is anchor-registry-empty RED, never vacuous pass");
  const noKey = runEnforcementAnchors({ root, deps: { registry: { ok: true, anchors: null } } });
  eq(noKey.exitKind, "fail", "a registry with no anchors array is fail-closed too");
  assert(emptyArr.lines.some((l) => l.msg.includes("anchor-registry-empty")), "the vacuous-table red carries the governed code");
  // N6 closure (audit R-1): every RED line the leg emits must carry a code
  // registered in ANCHOR_RED_CODES — an ungoverned failure mode is a defect.
  for (const run of [regless, dead, broken, emptyArr, noKey]) {
    assert(
      run.lines.every((l) => l.kind !== "fail" || ANCHOR_RED_CODES.some((c) => l.msg.includes(c))),
      "every RED line carries a governed ANCHOR_RED_CODES token"
    );
  }
}

// --- fail-on-empty red line ---------------------------------------------------
assert(passed > 350, "fail-on-empty: the E2E smoke actually executed (" + passed + " assertions)");

console.log("handoff-lint-e2e.test: " + passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
