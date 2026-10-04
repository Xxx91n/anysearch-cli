// scripts/enforcement-anchors.mjs
// ADR-0099 (R98 D-002/D-003): the fifth-morphology detector — the thin shell
// that runs docs/enforcement-anchors.json against the anchor probes.
//
// Judgment contract (fail-closed):
//   killed        -> pass   (the declared constraint has a live consumer)
//   not killed    -> fail   (decorative declaration: no consumer survives the
//                  distortion — `anchor-not-consumed`)
//   probe missing -> fail   (a registry entry without a runnable falsification
//                  fixture is an unkillable mutant — `anchor-unresolvable`)
//   seated anchor -> skip   (pending-seat via deferred registry
//                  `pending_anchors`; observed, never blocking — ratchet class
//                  seats before it reddens)
//   static precheck: an anchor subject with zero repo references is flagged
//   `info` only (routing signal, never a RED on its own — D-002 negative
//   requirement ①).
//
// Node stdlib only. The module carries no verdict logic beyond the
// kill/no-kill mapping the legislation defines.
import fs from "node:fs";
import path from "node:path";
import * as probesModule from "./enforcement-anchor-probes.mjs";
import { collectDeferred } from "./handoff-lint-shell.mjs";

// Closed failure vocabulary (N6 rework): the only RED codes this leg may emit.
// Every fail line carries one of these tokens; a new failure mode must be
// registered here (same discipline as the verdict core's *_CODES tables).
export const ANCHOR_RED_CODES = Object.freeze([
  "anchor-registry-unreadable",
  "anchor-registry-empty",
  "anchor-unresolvable",
  "anchor-not-consumed",
]);
export const ANCHOR_SKIP_CODES = Object.freeze(["pending-anchor"]);

export function loadAnchorRegistry(root) {
  try {
    const reg = JSON.parse(fs.readFileSync(path.join(root, "docs", "enforcement-anchors.json"), "utf8"));
    return { ok: true, anchors: Array.isArray(reg.anchors) ? reg.anchors : null };
  } catch {
    return { ok: false, anchors: null };
  }
}

// Static reference-count precheck (routing only): count literal occurrences of
// the anchor subject across scripts/, docs/ and packages/. Zero hits is a
// smoke signal worth an info line — never a verdict.
// N1 (audit loop-1): the registry file itself is EXCLUDED — the subject string
// appears there BY DECLARATION, and counting the declaration as a reference
// made the zero-hit info line structurally unreachable.
function countReferences(root, subject) {
  if (!subject) return null;
  const registryFile = path.join(root, "docs", "enforcement-anchors.json");
  let hits = 0;
  const dirs = ["scripts", "packages", "docs", "apps"];
  const scan = (dir) => {
    let ents;
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === "dist") continue;
        scan(p);
      } else if (/\.(mjs|js|ts|json|md)$/.test(e.name)) {
        if (path.resolve(p) === path.resolve(registryFile)) continue;
        try {
          const t = fs.readFileSync(p, "utf8");
          for (let i = t.indexOf(subject); i >= 0; i = t.indexOf(subject, i + 1)) hits++;
        } catch { }
      }
    }
  };
  for (const d of dirs) scan(path.join(root, d));
  return hits;
}

export function runEnforcementAnchors({ root, deps = {} }) {
  const lines = [];
  const reg = deps.registry ?? loadAnchorRegistry(root);
  const deferred = deps.deferred ?? collectDeferred(root);
  const seats = new Set(deferred.ok === true && Array.isArray(deferred.pendingAnchors) ? deferred.pendingAnchors : []);

  if (!reg.ok) {
    return {
      lines: [{ kind: "fail", msg: "enforcement-anchors: anchor-registry-unreadable — docs/enforcement-anchors.json unreadable (the anchor registry is itself fail-closed)" }],
      exitKind: "fail",
      counts: { anchors: 0, killed: 0, seated: 0, unkillable: 0 },
    };
  }
  // F-2 (audit loop-1): non-vacuous registry — an empty or missing `anchors`
  // array would vacuously pass "0/0 verified", retiring the detector by
  // deleting its table (the closeout-claims zero-entry fail precedent).
  if (!Array.isArray(reg.anchors) || reg.anchors.length === 0) {
    return {
      lines: [
        {
          kind: "fail",
          msg:
            "enforcement-anchors: anchor-registry-empty — docs/enforcement-anchors.json carries " +
            (Array.isArray(reg.anchors) ? "an empty `anchors` list" : "no `anchors` array") +
            " — the closed table must be non-vacuous; a detector with zero anchors is a decorative declaration",
        },
      ],
      exitKind: "fail",
      counts: { anchors: 0, killed: 0, seated: 0, unkillable: 0 },
    };
  }

  let killed = 0;
  let seated = 0;
  let unkillable = 0;
  let fails = 0;
  for (const a of reg.anchors) {
    const tag = "enforcement-anchor " + String(a && a.id);
    // Self-referencing nail ①: an anchor without a runnable falsification
    // fixture is an unkillable mutant — it is never admitted to the table.
    const probeName = a && typeof a.probe === "string" ? a.probe : null;
    const probe = probeName && typeof probesModule[probeName] === "function" ? probesModule[probeName] : null;
    if (!probe) {
      unkillable++;
      fails++;
      lines.push({ kind: "fail", msg: tag + ": anchor-unresolvable — probe `" + String(probeName) + "` unresolvable in enforcement-anchor-probes.mjs (no falsification fixture, not admitted)" });
      continue;
    }
    const refs = countReferences(root, a.subject);
    if (refs === 0) {
      lines.push({ kind: "info", msg: tag + ": precheck — subject `" + a.subject + "` has zero references in repo (routing signal only, not a verdict)" });
    }
    let res;
    try {
      res = probe({ root });
    } catch (e) {
      res = { killed: false, detail: "probe threw: " + String(e && e.message ? e.message : e) };
    }
    const killedNow = !!(res && res.killed === true);
    const seat = seats.has(a.id);
    if (killedNow) {
      killed++;
      lines.push({ kind: seat ? "info" : "pass", msg: tag + (seat ? " [pending-anchor]: constraint verified early" : ": consumer survives falsification") + " — " + String(res.detail ?? "") });
    } else if (seat) {
      seated++;
      lines.push({ kind: "skip", msg: tag + " [pending-anchor]: falsification not yet killing (seated via deferred registry) — " + String(res.detail ?? "") });
    } else {
      fails++;
      lines.push({ kind: "fail", msg: tag + ": anchor-not-consumed — declared constraint survives no falsification probe — " + String(res.detail ?? "") });
    }
  }
  lines.push({
    kind: fails > 0 ? "fail" : "pass",
    msg:
      "enforcement-anchors: " +
      killed +
      "/" +
      reg.anchors.length +
      " anchors consumer-verified" +
      (seated > 0 ? ", " + seated + " seated" : "") +
      (unkillable > 0 ? ", " + unkillable + " unkillable" : "") +
      (fails > 0 ? " — anchor-not-consumed" : " (ADR-0099 fifth morphology)"),
  });
  return { lines, exitKind: fails > 0 ? "fail" : "pass", counts: { anchors: reg.anchors.length, killed, seated, unkillable } };
}
