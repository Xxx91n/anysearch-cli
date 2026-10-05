// scripts/enforcement-anchor-probes.mjs
// ADR-0099 (R98 D-002/D-003): the falsification fixtures for the fifth
// morphology - 「ADR 宣称机器约束 ∧ 实现零消费 → RED」.
//
// Each probe is the CONSUMER-SIDE FALSIFICATION of one anchor: it injects a
// distortion into the real implementation surface and asserts the expected
// kill. If the declared constraint were decorative (no consumer), the
// distortion would pass unnoticed and the probe returns killed=false - which
// is itself the RED the detector reports. Probes import the production code
// they falsify (never copies - a copied core would be a second source).
//
// Every probe returns { killed: boolean, detail: string }.

import {
  assessStateLeg,
  parseStackLine,
  unregisteredCodeExports,
} from "./handoff-lint-verdict.mjs";
import {
  resolveReuse,
  collectSnapshot,
} from "./handoff-lint-shell.mjs";
import { checkVerbatimClaim } from "./claims-verbatim.mjs";
import { createRequire } from "node:module";
import path from "node:path";
import { GOVERNED_MODULES } from "./vocab-registry.mjs";
import { scanVocabGuards, resolveRegistryArrays } from "./vocab-scan.mjs";

const requireScript = createRequire(import.meta.url);

// A minimal live env: every leg-greenable, so only the injected distortion
// decides the outcome.
function probeEnv() {
  return {
    now: "2026-10-02",
    git: { ok: true, shallow: false, branchRefs: { "r-x": "f".repeat(40) }, stackBranchMembers: { "r-x": ["a".repeat(40)] }, commitObjects: {}, resolveSha: {} },
    gh: { ok: true, runs: {} },
    but: { ok: true, ids: [] },
    workflows: { ok: true, pushBranches: ["main"], pushAllBranches: false },
    deferred: { ok: true, covers: [], pendingPredicates: [] },
  };
}
const MARKER_DOC = "Stack（primary key = GitButler change-ids）：\n  r-x → aaa (`" + "a".repeat(7) + "` @ 2026-10-02)\n\n## 绿色 run URL（必填）\n\nGREEN: https://github.com/x/y/actions/runs/1\n";

// anchor:predicate-registry — inject a registry missing `unlanded`; the state
// leg must OOV-RED its marker. No RED => the registry is decorative.
export function probePredicateRegistry() {
  const env = probeEnv();
  env.registry = { unpushed: { verify: "x", invalidate: "x", env: "git", reuse: null }, "no-branch-runs": { verify: "x", invalidate: "x", env: "workflows", reuse: null } };
  const doc = MARKER_DOC + "<!-- state: unlanded ghost @ 2026-10-02 -->\n";
  const leg = assessStateLeg(doc, parseStackLine(doc), env);
  const killed = leg.state === "RED" && leg.redCodes.includes("state-predicate-out-of-vocabulary");
  return { killed, detail: "struck `unlanded` from the injected registry; state leg -> " + leg.state + " {" + leg.redCodes.join(",") + "}" };
}

// anchor:reuse-pointer — inject a registry whose no-branch-runs reuse spec is
// unresolvable; the workflows env source must degrade (ok:false). A degrade
// proves the pointer is parsed and consumed, not decorative.
export function probeReusePointer({ root }) {
  const control = resolveReuse("parseWorkflowTriggers/collectWorkflowTriggers") !== null;
  const snap = collectSnapshot({
    root,
    branches: [],
    deps: {
      spawnSync: () => ({ status: 1, stdout: "", stderr: "", error: null }),
      registry: { "no-branch-runs": { verify: "x", invalidate: "x", env: "workflows", reuse: "notARealFn/alsoFake" } },
      deferred: { ok: true, covers: [], pendingPredicates: [] },
    },
  });
  const degraded = !!(snap.workflows && snap.workflows.ok === false);
  return { killed: control && degraded, detail: "bad reuse spec -> workflows.ok=" + String(snap.workflows && snap.workflows.ok) + " (control resolves: " + control + ")" };
}

// anchor:bare-word-single-source — inject a registry missing `unlanded`; bare
// `unlanded` / `未合流` prose must escape the scan (the scan derives from the
// same struck set). If the word still flags, the scan is a second hard-coded
// list — the double-source the anchor forbids.
export function probeBareWordSingleSource() {
  const doc = MARKER_DOC + "该分支 unlanded 未合流 prose only\n";
  const struck = probeEnv();
  struck.registry = { unpushed: { verify: "x", invalidate: "x", env: "git", reuse: null }, "no-branch-runs": { verify: "x", invalidate: "x", env: "workflows", reuse: null } };
  const legStruck = assessStateLeg(doc, parseStackLine(doc), struck);
  const live = probeEnv();
  const legLive = assessStateLeg(doc, parseStackLine(doc), live);
  const escaped = legStruck.state === "GREEN";
  const control = legLive.state === "RED" && legLive.redCodes.includes("bare-word-violation");
  return { killed: escaped && control, detail: "struck registry -> " + legStruck.state + " (escape), live registry -> " + legLive.state + " {" + legLive.redCodes.join(",") + "}" };
}

// anchor:vocab-guards (ADR-0100 D4): the PRODUCTION scan (scripts/vocab-scan.mjs)
// must find zero unregistered `*_CODES` exports across the governed surface AND
// name every injected per-module distortion. The kill is produced by the
// production check of record (unregisteredCodeExports) driven through the
// production shell - never a probe-local copy. Per-module: every governed
// module's namespace is injected independently (no representative sampling).
export function probeVocabGuards({ root } = {}) {
  const scan = scanVocabGuards({ root });
  const inject = [];
  let allNamed = true;
  const stems = Object.keys(GOVERNED_MODULES);
  for (const stem of stems) {
    let ns;
    try {
      ns = requireScript(path.join(root, "scripts", stem + ".mjs"));
    } catch (e) {
      allNamed = false;
      inject.push(stem + ":<load-error:" + String(e && e.message ? e.message : e) + ">");
      continue;
    }
    const reg = resolveRegistryArrays(stem, ns);
    const found = unregisteredCodeExports({ ...ns, FAKE_CODES: Object.freeze(["x-fake-vocab"]) }, reg);
    const named = found.length === 1 && found[0] === "FAKE_CODES";
    if (!named) allNamed = false;
    inject.push(stem + ":" + JSON.stringify(found));
  }
  const killed = scan.ok === true && allNamed === true && inject.length === stems.length && stems.length > 0;
  return {
    killed,
    detail:
      "scan findings=" + JSON.stringify(scan.findings) +
      "; excluded-drift=" + JSON.stringify(scan.excludedDrift) +
      "; per-module injections={" + inject.join(", ") + "}",
  };
}

// anchor:ratchet-recount — the verbatim recount must reject a declared
// reauthored count that does not match reanchor_log length, and accept a
// matching one. Consumption = the gate's own checkVerbatimClaim (single code
// path, extracted for exactly this).
export function probeRatchetRecount({ root }) {
  // The good-case anchors on the ADR-INDEX marker — a surface the gate itself
  // guarantees (stepAdrIndex fail-closes if it ever disappears), so the probe
  // is coupled to a contract, not to a data field that may be renamed.
  const base = { id: "anchor-probe", kind: "verbatim", file: "docs/adr/index.md", text: "<!-- BEGIN ADR-INDEX", reason: "probe", reauthored: 0, reanchor_log: [] };
  const good = checkVerbatimClaim(base, { root });
  const bad = checkVerbatimClaim({ ...base, reauthored: 1 }, { root });
  const badRitual = checkVerbatimClaim({ ...base, reauthored: 1, reanchor_log: [{}] }, { root });
  const killed = good.length === 0 && bad.length > 0 && badRitual.length > 0;
  return { killed, detail: "matching recount problems=" + good.length + "; declared 1 vs log 0 -> " + bad.length + " problem(s); entry missing ritual pair -> " + badRitual.length + " problem(s)" };
}

// The runner resolves registry `probe` names from this module's exports
// directly - no shadow table (a second list the runner never reads would be
// the decorative double-source this morphology exists to kill).
