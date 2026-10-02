// scripts/handoff-lint-shell.mjs
// ADR-0097 (R96 T2 / D-002, D-003, D-004): the handoff-lint shell.
//
// The shell owns exactly three things and nothing else (D-004):
//   1. collect   - observation only: git / gh / but / workflow triggers -> snapshot
//   2. transmit  - hand the snapshot to the pure verdict core
//   3. report    - map the core's verdicts to gate report lines + an exit kind
// It carries no `if` on the verdict itself; every decision lives in
// scripts/handoff-lint-verdict.mjs. The snapshot shape below is frozen (ADR-0097
// SN3) - the E2E smoke feeds fixtures through this exact shape, so a shape
// drift cannot silently defang the tests.
//
// Node stdlib only (ADR-0020 D5).

import { spawnSync as nodeSpawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { assessHandoffLint, parseStackLine, parseRoundFromName, parseRunUrlSection, uniq } from "./handoff-lint-verdict.mjs";

// One observational command. Returns trimmed stdout, or null when the command
// could not run / exited non-zero (both mean "no fact", never "false").
function observe(spawnSync, cmd, args, cwd) {
  let r;
  try {
    r = spawnSync(cmd, args, { cwd, encoding: "utf8" });
  } catch {
    return null;
  }
  if (!r || r.error || r.status !== 0) return null;
  return String(r.stdout ?? "").trim();
}

// `but status -fv` parsing contract (D-003 item 4): a commit line carries a
// bullet, and the first token after it is the CLI id. The change-id column may
// be absent (upstream-only commits lead with a sha prefix) - that absence is
// informational, never RED by itself. The `(sha ...)` suffix is informational.
export function parseButStatusIds(stdout) {
  const ids = [];
  for (const raw of String(stdout ?? "").split(/\r?\n/)) {
    const m = /^[\s\u2502\u250a\u251c\u256f\u256d\u2504\u25cf\u25c9|]*[\u25cf\u25c9]\s+([A-Za-z0-9][A-Za-z0-9_-]{0,9})\b/.exec(raw);
    if (m) ids.push(m[1]);
  }
  return uniq(ids);
}

// Structural parse of a workflow's `on:` triggers. Node stdlib only: this is
// the same structural-subset discipline scripts/check-workflows.mjs uses, not a
// general YAML parse. Only what the `pushed-no-branch-runs` predicate needs is
// extracted: does any workflow run on a *push to a branch*?
export function parseWorkflowTriggers(text) {
  const lines = String(text ?? "").split(/\r?\n/);
  const out = { pushBranches: [], pushAllBranches: false };
  let onIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^on\s*:/.test(lines[i])) { onIdx = i; break; }
  }
  if (onIdx < 0) return out;
  const inline = lines[onIdx].replace(/^on\s*:\s*/, "").replace(/\s+#.*$/, "").trim();
  if (inline) {
    const names = inline.replace(/^\[|\]$/g, "").split(",").map((s) => s.trim()).filter(Boolean);
    if (names.includes("push")) out.pushAllBranches = true;
    return out;
  }
  let end = lines.length;
  for (let i = onIdx + 1; i < lines.length; i++) {
    const l = lines[i];
    if (!l.trim() || /^\s*#/.test(l)) continue;
    if (/^\S/.test(l)) { end = i; break; }
  }
  const block = lines.slice(onIdx + 1, end);
  let pushIdx = -1;
  for (let i = 0; i < block.length; i++) {
    if (/^\s{1,4}push\s*:/.test(block[i])) { pushIdx = i; break; }
  }
  if (pushIdx < 0) return out;
  const pushLine = block[pushIdx];
  const pushIndent = pushLine.length - pushLine.trimStart().length;
  const afterPush = pushLine.replace(/^\s*push\s*:\s*/, "").replace(/\s+#.*$/, "").trim();
  // push: <something> on one line
  if (afterPush) {
    const inlineBranches = /branches\s*:\s*\[([^\]]*)\]/.exec(afterPush);
    if (inlineBranches) {
      out.pushBranches.push(...inlineBranches[1].split(",").map((s) => s.replace(/['"]/g, "").trim()).filter(Boolean));
    } else if (/branches(-ignore)?\s*:/.test(afterPush)) {
      out.pushAllBranches = true; // branches-ignore: a feature branch is covered
    } else if (!/tags(-ignore)?\s*:/.test(afterPush) && !/paths(-ignore)?\s*:/.test(afterPush)) {
      out.pushAllBranches = true;
    }
    return out;
  }
  // nested block under push:
  const inner = [];
  for (let i = pushIdx + 1; i < block.length; i++) {
    const l = block[i];
    if (!l.trim() || /^\s*#/.test(l)) continue;
    if (l.length - l.trimStart().length <= pushIndent) break;
    inner.push(l);
  }
  const hasBranches = inner.some((l) => /^\s*branches\s*:/.test(l));
  const hasBranchesIgnore = inner.some((l) => /^\s*branches-ignore\s*:/.test(l));
  const hasTags = inner.some((l) => /^\s*tags(-ignore)?\s*:/.test(l));
  const hasPaths = inner.some((l) => /^\s*paths(-ignore)?\s*:/.test(l));
  if (hasBranchesIgnore) { out.pushAllBranches = true; return out; }
  if (!hasBranches) {
    // `tags:`-only push does not cover branch pushes (GitHub ref-filter rule)
    if (!hasTags) out.pushAllBranches = true;
    return out;
  }
  const bIdx = inner.findIndex((l) => /^\s*branches\s*:/.test(l));
  const bLine = inner[bIdx];
  const bAfter = bLine.replace(/^\s*branches\s*:\s*/, "").replace(/\s+#.*$/, "").trim();
  if (bAfter) {
    out.pushBranches.push(...bAfter.replace(/^\[|\]$/g, "").split(",").map((s) => s.replace(/['"]/g, "").trim()).filter(Boolean));
    return out;
  }
  const bIndent = bLine.length - bLine.trimStart().length;
  for (let i = bIdx + 1; i < inner.length; i++) {
    const l = inner[i];
    if (!l.trim()) continue;
    if (l.length - l.trimStart().length <= bIndent) break;
    const m = /^\s*-\s*['"]?([^'"\s]+)['"]?\s*$/.exec(l);
    if (m) out.pushBranches.push(m[1]);
  }
  void hasPaths;
  return out;
}

// Read .github/workflows/*.ya?ml and aggregate branch-push coverage.
export function collectWorkflowTriggers(root) {
  const dir = path.join(root, ".github", "workflows");
  const pushBranches = [];
  let pushAllBranches = false;
  let ok = false;
  try {
    const files = fs.readdirSync(dir).filter((f) => /\.ya?ml$/i.test(f));
    ok = files.length > 0;
    for (const f of files) {
      const t = parseWorkflowTriggers(fs.readFileSync(path.join(dir, f), "utf8"));
      if (t.pushAllBranches) pushAllBranches = true;
      pushBranches.push(...t.pushBranches);
    }
  } catch {
    ok = false;
  }
  return { ok, pushBranches: uniq(pushBranches), pushAllBranches };
}

// Workflow identity for the required-name check: prefer the file stem of the
// run's path (stable across a display-name edit), fall back to the run name.
export function deriveWorkflowName(run) {
  const p = typeof run?.path === "string" ? run.path : "";
  const base = p.split("/").pop() ?? "";
  const stem = base.replace(/\.ya?ml$/i, "");
  if (stem) return stem;
  return typeof run?.name === "string" ? run.name : "";
}

// --- 1. collect -------------------------------------------------------------

// Collect the environment snapshot. Pure observation - no verdicts here.
export function collectSnapshot({ root, branches = [], shas = [], runIds = [], deps = {} }) {
  const spawnSync = deps.spawnSync ?? nodeSpawnSync;
  const now = deps.now ?? new Date().toISOString();

  const gitOk = observe(spawnSync, "git", ["rev-parse", "--git-dir"], root) !== null;
  const shallow = gitOk && observe(spawnSync, "git", ["rev-parse", "--is-shallow-repository"], root) === "true";

  const branchRefs = {};
  const stackBranchMembers = {};
  if (gitOk) {
    for (const b of branches) {
      const sha = observe(spawnSync, "git", ["rev-parse", "--verify", "--quiet", "refs/remotes/origin/" + b], root);
      if (sha && /^[0-9a-f]{40}$/.test(sha)) {
        branchRefs[b] = sha;
        const out = observe(spawnSync, "git", ["rev-list", "origin/main..origin/" + b], root);
        stackBranchMembers[b] = out === null ? null : out.split(/\r?\n/).filter(Boolean);
      } else {
        stackBranchMembers[b] = null;
      }
    }
  }

  const commitObjects = {};
  const resolveSha = {};
  if (gitOk) {
    for (const sha of shas) {
      commitObjects[sha] = observe(spawnSync, "git", ["cat-file", "-t", sha], root);
      resolveSha[sha] = observe(spawnSync, "git", ["rev-parse", "--verify", "--quiet", sha], root);
    }
  }

  const butOut = observe(spawnSync, "but", ["status", "-fv"], root);
  let butOk = butOut !== null;
  let butIds = butOk ? parseButStatusIds(butOut) : [];
  if (butOk && branches.length > 0 && !branches.some((b) => butOut.includes(b))) {
    // but answered, but its workspace names none of this document's branches ->
    // the but workspace is not this repo's. Degrade, never red.
    butOk = false;
    butIds = [];
  }

  let repo = typeof deps.repo === "string" ? deps.repo : "";
  if (!repo && gitOk) {
    const remote = observe(spawnSync, "git", ["remote", "get-url", "origin"], root);
    const m = remote ? remote.match(/github\.com[/:]([\w.-]+\/[\w.-]+?)(\.git)?$/) : null;
    if (m) repo = m[1];
  }

  const ghOk = observe(spawnSync, "gh", ["--version"], root) !== null;
  const runs = {};
  if (ghOk && repo) {
    for (const id of runIds) {
      const out = observe(
        spawnSync,
        "gh",
        ["api", "repos/" + repo + "/actions/runs/" + id, "--jq", "{head_sha, conclusion, name, path, repo: .repository.full_name}"],
        root
      );
      if (out === null) { runs[id] = "api-failed"; continue; }
      try {
        const j = JSON.parse(out);
        runs[id] = {
          head_sha: j.head_sha,
          conclusion: j.conclusion,
          workflow: deriveWorkflowName(j),
          repo: j.repo,
        };
      } catch {
        runs[id] = "api-failed";
      }
    }
  }

  // deps.workflows is the injection seam the E2E smoke uses; production reads disk.
  const workflows = deps.workflows ?? collectWorkflowTriggers(root);

  return {
    now,
    repo,
    maxCaptureAgeDays: Number.isFinite(deps.maxCaptureAgeDays) ? deps.maxCaptureAgeDays : undefined,
    git: { ok: gitOk, shallow, branchRefs, stackBranchMembers, commitObjects, resolveSha },
    gh: { ok: ghOk, runs },
    but: { ok: butOk, ids: butIds },
    workflows,
  };
}

// --- 2. transmit ------------------------------------------------------------

// Hand every document to the pure core. No verdict logic here.
export function evaluateHandoffLintDocuments({ documents, snapshot }) {
  const perDoc = documents.map((d) => {
    const round = Number.isFinite(d.round) ? d.round : parseRoundFromName(d.name ?? d.rel ?? "");
    return { rel: d.rel ?? d.name ?? "<unnamed>", round, verdict: assessHandoffLint({ text: d.text, round, env: snapshot }) };
  });
  return { perDoc, snapshot };
}

// --- 3. report --------------------------------------------------------------

// Mechanical mapping: verdict -> report lines + an exit kind. No verdict ifs.
export function buildHandoffLintReport({ perDoc }) {
  const lines = [];
  let red = 0;
  let pending = 0;
  let green = 0;
  for (const p of perDoc) {
    const v = p.verdict;
    if (v.verdict === "RED") {
      red++;
      lines.push({ kind: "fail", msg: "handoff-lint: " + p.rel + " [" + v.scope + "] RED {" + v.redCodes.join(", ") + "}:\n    " + v.problems.join("\n    ") });
    } else if (v.verdict === "PENDING") {
      pending++;
      lines.push({ kind: "skip", msg: "handoff-lint: " + p.rel + " [" + v.scope + "] PENDING {" + v.pendingSummary.join(" | ") + "}" });
    } else {
      green++;
      lines.push({ kind: "pass", msg: "handoff-lint: " + p.rel + " [" + v.scope + "] GREEN" });
    }
  }
  return { lines, exitKind: red > 0 ? "fail" : "pass", counts: { red, pending, green } };
}

// The full shell path: collect -> transmit -> report.
export function runHandoffLint({ root, documents, deps = {} }) {
  const stacks = documents.map((d) => parseStackLine(d.text));
  const branches = uniq(stacks.map((s) => s.branch).filter(Boolean));
  const shas = uniq(stacks.flatMap((s) => s.entries.map((e) => e.sha).filter(Boolean)));
  const runIds = uniq(
    documents.flatMap((d) => {
      const sec = parseRunUrlSection(d.text);
      return sec.urls.map((u) => u.id);
    })
  );
  const snapshot = collectSnapshot({ root, branches, shas, runIds, deps });
  const evaluated = evaluateHandoffLintDocuments({ documents, snapshot });
  return { ...evaluated, ...buildHandoffLintReport(evaluated) };
}
