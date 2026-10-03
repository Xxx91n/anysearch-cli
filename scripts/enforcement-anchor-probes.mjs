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
} from "./handoff-lint-verdict.mjs";
import {
  resolveReuse,
  collectSnapshot,
} from "./handoff-lint-shell.mjs";
import { checkVerbatimClaim } from "./claims-verbatim.mjs";
import * as verdictModule from "./handoff-lint-verdict.mjs";

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

// anchor:vocab-guards — every exported `*_CODES` vocabulary must be registered
// in CODE_GROUPS. The distortion is a namespace carrying an unregistered
// export; the guard must report exactly it and nothing else.
export function probeVocabGuards() {
  const unregistered = (ns) =>
    Object.keys(ns).filter(
      (k) => /_CODES$/.test(k) && Array.isArray(ns[k]) && !Object.values(ns.CODE_GROUPS ?? {}).includes(ns[k])
    );
  const real = unregistered(verdictModule);
  const distorted = unregistered({ ...verdictModule, FAKE_CODES: Object.freeze(["x-fake-vocab"]) });
  const killed = real.length === 0 && distorted.length === 1 && distorted[0] === "FAKE_CODES";
  return { killed, detail: "real exports unregistered=" + JSON.stringify(real) + "; injected FAKE_CODES detected=" + JSON.stringify(distorted) };
}

// anchor:ratchet-recount — the verbatim recount must reject a declared
// reauthored count that does not match reanchor_log length, and accept a
// matching one. Consumption = the gate's own checkVerbatimClaim (single code
// path, extracted for exactly this).
export function probeRatchetRecount({ root }) {
  const base = { id: "anchor-probe", kind: "verbatim", file: "docs/deferred-registry.json", text: '"version"', reason: "probe", reauthored: 0, reanchor_log: [] };
  const good = checkVerbatimClaim(base, { root });
  const bad = checkVerbatimClaim({ ...base, reauthored: 1 }, { root });
  const badRitual = checkVerbatimClaim({ ...base, reauthored: 1, reanchor_log: [{}] }, { root });
  const killed = good.length === 0 && bad.length > 0 && badRitual.length > 0;
  return { killed, detail: "matching recount problems=" + good.length + "; declared 1 vs log 0 -> " + bad.length + " problem(s); entry missing ritual pair -> " + badRitual.length + " problem(s)" };
}

// The runner resolves registry `probe` names from this module's exports.
// PROBE_TABLE is only a human-facing index for the registry file - the runner
// resolves by name (a table it never consults, so it cannot go stale).
export const PROBE_TABLE = Object.freeze({
  "anchor:predicate-registry": "probePredicateRegistry",
  "anchor:reuse-pointer": "probeReusePointer",
  "anchor:bare-word-single-source": "probeBareWordSingleSource",
  "anchor:vocab-guards": "probeVocabGuards",
  "anchor:ratchet-recount": "probeRatchetRecount",
});
