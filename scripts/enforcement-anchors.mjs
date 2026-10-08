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
// ADR-0101 (R100 D2/D5): the anchor registry is schema-migrated —
//   `fails`     required non-empty; every member must name a class in the
//               registry's closed `failure_classes` vocabulary (Kill Oracle —
//               the anchor must name the user-visible product failure it
//               prevents; no free text)
//   `tier`      "red" | "info" (default red); info anchors still run their
//               probe — observation is not absence — but their no-kill is
//               reported as info, never a verdict
//   seats       pending_anchors entries may be structured
//               {anchor,reason,seated_at,review_by} or legacy bare strings;
//               legacy entries get a migration-day deadline
//               (LEGACY_SEAT_REVIEW_BY) — stock does not exempt from expiry
//   exclusions  anchor id in pending_anchors AND tier:"info" is RED
//               (`anchor-seat-info-conflict`); an expired or malformed seat is
//               RED; an open seat over a no-kill probe surfaces a named
//               masking info line (Masking-Surfaced)
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
  "anchor-fails-empty",
  "anchor-fails-unregistered",
  "anchor-tier-invalid",
  "anchor-seat-info-conflict",
  "anchor-seat-expired",
  "anchor-seat-malformed",
]);
export const ANCHOR_SKIP_CODES = Object.freeze(["pending-anchor"]);

// ADR-0101 D5: legacy bare-string seats get their deadline set at migration
// day — a seat is a temporary exemption with a clock, never a perpetual
// exemption. The date is a named constant so the forcing function is auditable.
export const LEGACY_SEAT_REVIEW_BY = "2026-10-22";

// Emitted code tokens below are SOURCED from the tables (N6 closure): a RED
// or skip line cannot carry an unregistered code without bypassing them.
const [CODE_UNREADABLE, CODE_EMPTY, CODE_UNRESOLVABLE, CODE_NOT_CONSUMED, CODE_FAILS_EMPTY, CODE_FAILS_UNREG, CODE_TIER_INVALID, CODE_SEAT_INFO, CODE_SEAT_EXPIRED, CODE_SEAT_MALFORMED] = ANCHOR_RED_CODES;
const [CODE_PENDING_ANCHOR] = ANCHOR_SKIP_CODES;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function loadAnchorRegistry(root) {
  try {
    const reg = JSON.parse(fs.readFileSync(path.join(root, "docs", "enforcement-anchors.json"), "utf8"));
    return { ok: true, anchors: Array.isArray(reg.anchors) ? reg.anchors : null, failureClasses: Array.isArray(reg.failure_classes) ? reg.failure_classes : null };
  } catch {
    return { ok: false, anchors: null, failureClasses: null };
  }
}

// Seat normalization (ADR-0101 D5 dual-read): accepts legacy bare strings,
// structured {anchor,reason,seated_at,review_by}, and already-normalized
// objects (collectDeferred attaches `entry`). Every seat carries the entry id
// that seats it, so the masking surface can name the seat, not just the state.
export function normalizeSeat(x, entryId) {
  if (typeof x === "string") {
    return { anchor: x, reason: null, seated_at: null, review_by: LEGACY_SEAT_REVIEW_BY, legacy: true, entry: entryId ?? null };
  }
  if (x && typeof x === "object") {
    const legacy = x.legacy === true;
    const reviewBy = typeof x.review_by === "string" && x.review_by ? x.review_by : legacy ? LEGACY_SEAT_REVIEW_BY : null;
    return {
      anchor: typeof x.anchor === "string" && x.anchor ? x.anchor : null,
      reason: typeof x.reason === "string" && x.reason ? x.reason : null,
      seated_at: typeof x.seated_at === "string" ? x.seated_at : null,
      review_by: reviewBy,
      legacy,
      entry: typeof x.entry === "string" ? x.entry : entryId ?? null,
    };
  }
  return { anchor: null, reason: null, seated_at: null, review_by: null, legacy: false, entry: entryId ?? null, malformed: true };
}

function seatMalformed(seat) {
  return seat.malformed === true || !seat.anchor || !ISO_DATE_RE.test(seat.review_by ?? "");
}

function seatExpired(seat, nowDay) {
  // A review_by that cannot be compared is already flagged malformed; here a
  // parse failure is fail-loud (expired), never a silent valid seat.
  const by = Date.parse(seat.review_by);
  if (!Number.isFinite(by)) return true;
  return nowDay !== null && Date.parse(nowDay) > by;
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
  const seats = deferred.ok === true && Array.isArray(deferred.pendingAnchors) ? deferred.pendingAnchors.map((x) => normalizeSeat(x)) : [];
  const nowDay = typeof deps.now === "string" ? deps.now.slice(0, 10) : new Date().toISOString().slice(0, 10);
  const failureVocab = new Set(Array.isArray(reg.failureClasses) ? reg.failureClasses : []);

  if (!reg.ok) {
    return {
      lines: [{ kind: "fail", msg: "enforcement-anchors: " + CODE_UNREADABLE + " — docs/enforcement-anchors.json unreadable (the anchor registry is itself fail-closed)" }],
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
            "enforcement-anchors: " + CODE_EMPTY + " — docs/enforcement-anchors.json carries " +
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
  // Seats that name no anchor — or an anchor absent from the registry — can
  // never be claimed by the per-anchor loop below; dead seats are surfaced
  // here, fail-closed (a seat referencing nothing masks intent).
  const anchorIds = new Set(reg.anchors.map((a) => (a && typeof a.id === "string" ? a.id : null)).filter(Boolean));
  for (const s of seats) {
    if (!s.anchor || !anchorIds.has(s.anchor)) {
      fails++;
      lines.push({ kind: "fail", msg: "enforcement-anchors: " + CODE_SEAT_MALFORMED + " — pending_anchors entry names " + (s.anchor ? "anchor `" + s.anchor + "` which is not in the registry" : "no anchor") + " (seat entry id: " + String(s.entry ?? "<unknown>") + ") — a dead seat masks intent" });
    }
  }
  for (const a of reg.anchors) {
    const tag = "enforcement-anchor " + String(a && a.id);
    // Self-referencing nail ①: an anchor without a runnable falsification
    // fixture is an unkillable mutant — it is never admitted to the table.
    const probeName = a && typeof a.probe === "string" ? a.probe : null;
    const probe = probeName && typeof probesModule[probeName] === "function" ? probesModule[probeName] : null;
    if (!probe) {
      unkillable++;
      fails++;
      lines.push({ kind: "fail", msg: tag + ": " + CODE_UNRESOLVABLE + " — probe `" + String(probeName) + "` unresolvable in enforcement-anchor-probes.mjs (no falsification fixture, not admitted)" });
      continue;
    }
    const id = a && typeof a.id === "string" ? a.id : null;
    const tier = a.tier === undefined || a.tier === null ? "red" : a.tier;
    if (tier !== "red" && tier !== "info") {
      fails++;
      lines.push({ kind: "fail", msg: tag + ": " + CODE_TIER_INVALID + " — tier `" + String(a.tier) + "` is not \"red\"|\"info\" (audit tier is a closed two-value vocabulary)" });
    }
    // Kill Oracle (ADR-0101 D2①): every anchor must name the user-visible
    // product failure class it prevents — non-empty `fails` ⊆ failure_classes.
    if (!Array.isArray(a.fails) || a.fails.length === 0) {
      fails++;
      lines.push({ kind: "fail", msg: tag + ": " + CODE_FAILS_EMPTY + " — `fails` is missing or empty (Kill Oracle: an anchor must name the user-visible product failure it prevents)" });
    } else {
      const unreg = a.fails.filter((f) => !failureVocab.has(f));
      if (unreg.length > 0) {
        fails++;
        lines.push({ kind: "fail", msg: tag + ": " + CODE_FAILS_UNREG + " — `fails` name(s) outside the closed failure_classes vocabulary: {" + unreg.join(", ") + "} (no free-text failure classes)" });
      }
    }
    const seat = id ? seats.find((s) => s.anchor === id) : null;
    let seatValid = false;
    if (seat) {
      let seatBad = false;
      if (seatMalformed(seat)) {
        seatBad = true;
        fails++;
        lines.push({ kind: "fail", msg: tag + ": " + CODE_SEAT_MALFORMED + " — pending_anchors entry for this anchor lacks {anchor, review_by(YYYY-MM-DD)} (seat entry id: " + String(seat.entry ?? "<unknown>") + ")" });
      }
      if (tier === "info") {
        seatBad = true;
        fails++;
        lines.push({ kind: "fail", msg: tag + ": " + CODE_SEAT_INFO + " — anchor id sits in pending_anchors AND carries tier:\"info\" (the exclusion is mutual: a sunsetted anchor may not hold an exemption seat)" });
      }
      if (!seatMalformed(seat) && seatExpired(seat, nowDay)) {
        seatBad = true;
        fails++;
        lines.push({ kind: "fail", msg: tag + ": " + CODE_SEAT_EXPIRED + " — seat past review_by " + seat.review_by + " (entry: " + String(seat.entry ?? "<unknown>") + "; Seat Deadline: expire loudly, never a silent perpetual exemption)" });
      }
      seatValid = !seatBad;
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
    if (killedNow) {
      killed++;
      lines.push({ kind: seatValid ? "info" : "pass", msg: tag + (seatValid ? " [" + CODE_PENDING_ANCHOR + "]: constraint verified early" : ": consumer survives falsification") + " — " + String(res.detail ?? "") });
    } else if (seatValid) {
      seated++;
      lines.push({ kind: "skip", msg: tag + " [" + CODE_PENDING_ANCHOR + "]: falsification not yet killing (seated via deferred registry " + String(seat.entry ?? "") + ", review_by " + seat.review_by + ") — " + String(res.detail ?? "") });
      // Masking-Surfaced (ADR-0101 D5): an open seat over a no-kill probe is a
      // live exemption holding a possibly-decorative anchor — name the seat
      // every run so the loophole is never invisible.
      lines.push({ kind: "info", msg: "masking-surfaced: seat `" + String(seat.entry ?? "<unknown>") + "` masks " + tag + " (probe no-kill under open seat; review_by " + seat.review_by + ", legacy=" + (seat.legacy ? "string-entry" : "structured") + ")" });
    } else if (tier === "info") {
      lines.push({ kind: "info", msg: tag + ": " + CODE_NOT_CONSUMED + " (info tier) — declared constraint survives no falsification probe; observed, never a verdict — " + String(res.detail ?? "") });
    } else {
      fails++;
      lines.push({ kind: "fail", msg: tag + ": " + CODE_NOT_CONSUMED + " — declared constraint survives no falsification probe — " + String(res.detail ?? "") });
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
      (fails > 0 ? " — " + CODE_NOT_CONSUMED : " (ADR-0099 fifth morphology)"),
  });
  return { lines, exitKind: fails > 0 ? "fail" : "pass", counts: { anchors: reg.anchors.length, killed, seated, unkillable } };
}
