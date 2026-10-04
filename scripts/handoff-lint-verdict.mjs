// scripts/handoff-lint-verdict.mjs
// ADR-0097 (R96 T1 / D-002, D-003, D-004): handoff-lint verdict core.
//
// PURE MODULE - no filesystem, process, child-process or wall-clock access.
// The shell (scripts/handoff-lint-shell.mjs) collects an environment snapshot
// and hands it in; this core only decides. That split is what makes the truth
// table testable without a repo, a network, or a clock (D-004).
//
// Three-state exit semantics (ADR-0097 D1):
//   GREEN   - every leg verified against the injected facts
//   PENDING - a closed-vocabulary reason code: either author-declared and
//             gate-verified (verified-PENDING) or an environment degradation
//             the gate can prove but not resolve (env-PENDING, annotated)
//   RED     - a declaration contradicted by facts, an out-of-vocabulary
//             reason, or an unparseable / absent required field
//
// Effective scope (D-005): round >= EFFECTIVE_SCOPE_FLOOR is judged by the
// three-state grammar; earlier rounds keep the legacy presence-only rule.
// This is a scope boundary, not a content exemption (No-Grandfathering).

// Rule birthday for the three-state grammar. Rounds below it are judged by the
// pre-R96 presence-only rule. Changing this constant takes an ADR, not an edit.
export const EFFECTIVE_SCOPE_FLOOR = 96;

// Freshness bound for Stack capture dates. Deliberately loose and advisory: it
// never reddens a leg (a tight bound would redden lint across rounds as a stack
// sits unlanded), an over-age capture is surfaced as an annotation only
// (Observable Fail-Open). Configurable via the injected env.maxCaptureAgeDays.
export const STACK_CAPTURE_MAX_AGE_DAYS = 45;

// Blocking merge gates whose runs count as evidence (D-002). native-smoke is
// deliberately excluded: it is a load-only prebuild matrix, not a product gate.
export const REQUIRED_WORKFLOWS = Object.freeze(["ci", "ship-gate"]);

// Closed PENDING vocabulary for the run-URL leg (D-002). Extension requires a
// code change to this gate - no waived / time-boxed / doc-only escape hatches.
export const PENDING_REASON_CODES = Object.freeze(["stack-unpushed", "pushed-no-branch-runs"]);

// R97 (ADR-0098 D1/D2): self-checkable declaration vocabulary. Three offline
// predicates only; live predicates (no-pr/unpublished) are deferred to the
// first registry-extension ticket. Each entry carries {verify, invalidate,
// env, reuse}: extension requires touching this constant AND ADR-0098, and
// the extension PR itself is subject to the three-state gate (self-reference
// convergence). Bare-word Chinese equivalents are closed here, not NLP.
export const STATE_PREDICATES = Object.freeze(["unpushed", "unlanded", "no-branch-runs"]);
export const STATE_PREDICATE_REGISTRY = Object.freeze({
  unpushed: Object.freeze({ verify: "origin/<branch> ref absent", invalidate: "origin ref appears", env: "git", reuse: null }),
  unlanded: Object.freeze({ verify: "git rev-list origin/main..origin/<branch> non-empty", invalidate: "member set becomes empty", env: "git", reuse: null }),
  "no-branch-runs": Object.freeze({ verify: "no workflow on.push covers the branch", invalidate: "pushBranches covers the branch", env: "workflows", reuse: "parseWorkflowTriggers/collectWorkflowTriggers" }),
});
export const STATE_BARE_WORD_PHRASES = Object.freeze({
  unpushed: Object.freeze(["\u672a\u63a8\u9001"]),
  unlanded: Object.freeze(["\u672a\u5408\u6d41"]),
  "no-branch-runs": Object.freeze(["\u65e0\u5206\u652f\u8986\u76d6"]),
});
export const STATE_RED_CODES = Object.freeze([
  "state-marker-unparseable",
  "state-predicate-out-of-vocabulary",
  "bare-word-violation",
]);

// R7 (P-3 rework, ADR-0098 D5): the PENDING seat for registered-but-
// unevaluated predicates. The seat list is NOT a second constant - it lives
// in docs/deferred-registry.json (open entries' `pending_predicates`), so a
// defer entry closing automatically re-reddens its predicate (the registered
// ratchet path). `pending-predicate` is the closed annotation code.
export const STATE_PENDING_CODES = Object.freeze(["pending-predicate"]);

// R6 (P-2 rework, R97 D-002 legislation): the closeout clearing obligation
// 「轮收口时栈须空，否则残留分支须在 docs/deferred-registry.json 在册」.
// Machine-checkable as: residual branches empty (members array empty or the
// origin ref gone) OR every residual branch covered by an OPEN defer entry's
// `covers` field. An uncovered residual is RED; unreadable registry facts
// degrade to env-PENDING.
export const CLEARING_RED_CODES = Object.freeze(["clearing-residual-unregistered"]);
export const CLEARING_ENV_CODES = Object.freeze(["deferred-registry-unavailable"]);

// Environment-degradation codes for the run-URL leg (D-002; `ref-unavailable`
// added by ADR-0097 Addendum A so each degradation cause keeps its own code
// instead of being folded into `api-failed` - D-002 item 5 forbids one shared
// skip wording). gh-missing = no gh binary; repo-parse = repo unresolvable;
// ref-unavailable = the origin-ref facts could not be read; api-failed = the
// live API calls failed.
export const VERIFICATION_UNAVAILABLE_CODES = Object.freeze(["gh-missing", "repo-parse", "api-failed", "ref-unavailable"]);

// Closed RED vocabulary for the Stack leg's three elements (D-003).
export const STACK_RED_CODES = Object.freeze([
  "but-id-not-resolved",
  "sha-not-commit",
  "chain-tail-not-in-branch",
]);

// Structural RED codes for the Stack leg (absent / unusable chain).
export const STACK_STRUCTURAL_RED_CODES = Object.freeze(["stack-line-missing", "stack-chain-empty"]);

// Environment-degradation codes for the Stack leg (D-003).
export const STACK_ENV_CODES = Object.freeze(["stack-unavailable", "ref-unavailable", "shallow-clone"]);

// Closed RED vocabulary for the run-URL leg (D-002).
export const RUN_URL_RED_CODES = Object.freeze([
  "run-url-section-missing",
  "run-url-state-line-missing",
  "run-url-state-ambiguous",
  "run-url-unparseable",
  "pending-reason-out-of-vocabulary",
  "declaration-fact-conflict",
  "green-claim-falsified",
]);

// Advisory (never reddening, never blocking) Stack annotations. Kept apart
// from STACK_ENV_CODES because freshness is hygiene, not unverifiability.
export const STACK_ADVISORY_CODES = Object.freeze(["stale-capture"]);

// Every vocabulary the core can emit a code from. A code is ONLY ever emitted
// through emitCode(), which consults the governing constant - so a new literal
// cannot become a vocabulary entry without touching the constant (and the ADR).
// This is what turns ADR-0097 D1's "extending the vocabulary requires a gate
// code change" into an executable invariant instead of a comment.
export const CODE_GROUPS = Object.freeze({
  runUrlRed: RUN_URL_RED_CODES,
  stackRed: STACK_RED_CODES,
  stackStructuralRed: STACK_STRUCTURAL_RED_CODES,
  stackEnv: STACK_ENV_CODES,
  stackAdvisory: STACK_ADVISORY_CODES,
  verificationUnavailable: VERIFICATION_UNAVAILABLE_CODES,
  pendingReason: PENDING_REASON_CODES,
  stateRed: STATE_RED_CODES,
  statePending: STATE_PENDING_CODES,
  clearingRed: CLEARING_RED_CODES,
  clearingEnv: CLEARING_ENV_CODES,
});

// The single emission gate. An out-of-vocabulary code is a programming error
// (fail-closed): it throws rather than shipping a new undocumented code.
export function emitCode(vocabulary, code) {
  if (!vocabulary.includes(code)) {
    throw new Error(
      "handoff-lint-verdict: `" + code + "` is not in its vocabulary - add it to the constant AND to ADR-0097/0098 before emitting it"
    );
  }
  return code;
}

// True when `code` belongs to any governed vocabulary (bare codes only; a
// compound annotation like `verification-unavailable:x` is decomposed first).
export function isKnownCode(code) {
  return Object.keys(CODE_GROUPS).some((k) => CODE_GROUPS[k].includes(code));
}

// Vocabulary guard (anchor:vocab-guards): the production check of record for
// 「every exported `*_CODES` array is registered in CODE_GROUPS」. The unit
// truth-table asserts this on the real module namespace; the enforcement-
// anchor probe consumes the SAME function on a distorted namespace — one
// implementation, two callers, never a self-defensive copy.
export function unregisteredCodeExports(ns) {
  const registered = new Set(Object.values(CODE_GROUPS));
  return Object.keys(ns ?? {}).filter(
    (k) => /_CODES$/.test(k) && Array.isArray(ns[k]) && !registered.has(ns[k])
  );
}

// --- pure helpers -----------------------------------------------------------

// Days since 1970-01-01 for a YYYY-MM-DD string, computed with integer
// arithmetic only - no Date, so the core stays deterministic under test.
function toEpochDay(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd ?? ""));
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const a = Math.floor((14 - mo) / 12);
  const yy = y + 4800 - a;
  const mm = mo + 12 * a - 3;
  return (
    d +
    Math.floor((153 * mm + 2) / 5) +
    365 * yy +
    Math.floor(yy / 4) -
    Math.floor(yy / 100) +
    Math.floor(yy / 400) -
    32045 -
    2440588
  );
}

export function uniq(list) {
  return [...new Set(list)];
}

// --- parsers ----------------------------------------------------------------

const RUN_URL_SECTION_RE = /^##\s+.*?绿色\s*run\s*URL/;
const RUN_URL_RE = /https?:\/\/github\.com\/([^/\s]+\/[^/\s]+?)\/actions\/runs\/(\d+)/g;
const RUN_PATH_RE = /actions\/runs\//;
const STATE_LINE_RE = /^(?:\*\*|__)?\s*(GREEN|PENDING)\s*(?:\*\*|__)?\s*[:：]\s*(.*)$/i;
const PENDING_CODE_RE = /^`?([A-Za-z][A-Za-z0-9_-]*)`?/;

function findSection(text, headerRe) {
  const lines = String(text ?? "").split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (headerRe.test(lines[i])) {
      start = i;
      break;
    }
  }
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return { start, end, lines: lines.slice(start + 1, end) };
}

// Parse the run-URL section. Only lines whose first token is the state keyword
// (GREEN: / PENDING:) are authoritative; any actions/runs URL sitting in prose
// or an annotation is NOT counted - that is the F8-b silent-fold fix.
export function parseRunUrlSection(text) {
  const sec = findSection(text, RUN_URL_SECTION_RE);
  if (!sec) {
    return { present: false, body: "", kinds: [], urls: [], pendingCodes: [], malformedUrl: false };
  }
  const kinds = [];
  const urls = [];
  const pendingCodes = [];
  let malformedUrl = false;
  for (const raw of sec.lines) {
    const line = raw.replace(/^\s*(?:[-*+]\s+)?/, "").trim();
    const m = STATE_LINE_RE.exec(line);
    if (!m) continue;
    const kind = m[1].toUpperCase();
    const rest = m[2] ?? "";
    kinds.push(kind);
    if (kind === "GREEN") {
      let found = false;
      const re = new RegExp(RUN_URL_RE.source, "g");
      let u;
      while ((u = re.exec(rest)) !== null) {
        urls.push({ id: u[2], repo: u[1], raw: u[0] });
        found = true;
      }
      if (!found && RUN_PATH_RE.test(rest)) malformedUrl = true;
    } else {
      const c = PENDING_CODE_RE.exec(rest);
      pendingCodes.push(c ? c[1].toLowerCase() : null);
    }
  }
  return { present: true, body: sec.lines.join("\n"), kinds, urls, pendingCodes, malformedUrl };
}

// Parse the Stack line: `Stack (...) :` followed by `<branch> → <but-id> (<sha> @ <date>) → ...`.
// The chain tail sha is the sha of the last element that carries one; an element
// may legitimately omit its sha (self-referential tail, time-lagged capture).
export function parseStackLine(text) {
  const lines = String(text ?? "").split(/\r?\n/);
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*Stack\b/.test(lines[i])) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) return { present: false, headerIndex: -1, branch: null, entries: [], raw: "" };
  let chainLine = "";
  if (lines[headerIdx].includes("→")) {
    chainLine = lines[headerIdx];
  } else {
    for (let i = headerIdx + 1; i < lines.length; i++) {
      if (lines[i].trim()) {
        chainLine = lines[i];
        break;
      }
    }
  }
  const segs = chainLine.split("→");
  const branch = (segs[0] ?? "").trim().replace(/^[`'"]+|[`'"]+$/g, "");
  const entries = [];
  for (let k = 1; k < segs.length; k++) {
    const seg = segs[k];
    const idM = /^\s*`?([A-Za-z0-9_-]+)`?/.exec(seg);
    if (!idM) continue;
    const shaM = /\(\s*`?([0-9a-f]{7,40})`?\s*@\s*(\d{4}-\d{2}-\d{2})\s*\)/.exec(seg);
    entries.push({ butId: idM[1], sha: shaM ? shaM[1] : null, date: shaM ? shaM[2] : null });
  }
  // Landed-stack variant (R98 D-002 aftermath): `Stack（dissolved @ <date>）`
  // declares the workspace stack dissolved (landed-and-deleted). The but-id /
  // sha captures in the chain are historical and no longer resolvable BY
  // DESIGN - the leg switches to the dissolve check (the named branch's origin
  // ref must be absent). An unparseable date simply isn't recognized, so the
  // line falls through to the strict live-stack path and fails on its own.
  const dissolvedM = /(?:（|\()\s*dissolved\s*@\s*(\d{4}-\d{2}-\d{2})\s*(?:）|\))/.exec(lines[headerIdx]);
  const dissolved = !!(dissolvedM && isCalendarDate(dissolvedM[1]));
  return { present: true, headerIndex: headerIdx, branch: branch || null, entries, raw: chainLine, dissolved, dissolvedDate: dissolved ? dissolvedM[1] : null };
}

// Round number from a closeout filename, e.g. `round-96-closeout.md` -> 96.
export function parseRoundFromName(name) {
  const m = /(?:^|[^0-9])(?:round[-_]?)?(\d{1,4})(?:[^0-9]|$)/i.exec(String(name ?? ""));
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

// --- state markers (ADR-0098 D3: morphology one) ----------------------------
//
// A `<!-- state: <predicate> <args> @ <iso-date> -->` marker is a machine-
// checkable declaration. One overall regex parses predicate + args + date
// together; a `state:` opener that fails it is a syntax violation
// (fail-closed), never silently skipped. Fenced blocks are not HTML comments
// and inline spans are code, not prose: both are invisible here and to the
// bare-word scan (this round's artifacts necessarily quote predicate
// vocabulary, so quotations must not become declarations).
export const STATE_MARKER_RE = /^[ \t]*<!--[ \t]*state:[ \t]*([A-Za-z][A-Za-z0-9_-]*)[ \t]+([^\n]*?)[ \t]*@[ \t]*(\d{4}-\d{2}-\d{2})[ \t]*-->[ \t]*$/;
const STATE_OPENER_RE = /<!--[ \t]*state:/i;
const STATE_BRANCH_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

function stripCodeSpansAndFences(text) {
  const lines = String(text ?? "").split(/\r?\n/);
  const out = [];
  let inFence = false;
  for (const raw of lines) {
    if (/^[ \t]*(`{3,}|~{3,})/.test(raw)) { inFence = !inFence; out.push(""); continue; }
    if (inFence) { out.push(""); continue; }
    out.push(String(raw).replace(/`[^`]*`/g, ""));
  }
  return out;
}

export function parseStateMarkers(text) {
  const lines = stripCodeSpansAndFences(text);
  const markers = [];
  const malformed = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!STATE_OPENER_RE.test(line)) continue;
    const m = STATE_MARKER_RE.exec(line);
    if (!m) { malformed.push({ line: i + 1, raw: line.trim().slice(0, 120) }); continue; }
    markers.push({ predicate: m[1], args: m[2].trim(), date: m[3], line: i + 1 });
  }
  return { markers, malformed };
}

function isCalendarDate(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd ?? ""));
  if (!m) return false;
  const y = Number(m[1]); const mo = Number(m[2]); const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1) return false;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  return d <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1];
}

// Hyphen-aware boundaries: `stack-unpushed` / `pushed-no-branch-runs` are the
// older run-URL vocabulary, not bare state words. A hyphen-adjacent hit is a
// compound code, never a bare word. R3 (P-8 rework): the English enum is
// DERIVED from STATE_PREDICATES - a second hand-maintained list is exactly
// the double-source the audit named (extension edits one constant, not two).
export const STATE_BARE_RES = Object.freeze(
  STATE_PREDICATES.map((p) =>
    Object.freeze({
      predicate: p,
      re: new RegExp("(?<![A-Za-z-])" + p.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&") + "(?![A-Za-z-])"),
    })
  )
);

function collectBareWords(text, skipLines, livePreds) {
  const active = livePreds ?? STATE_PREDICATES;
  const lines = stripCodeSpansAndFences(text);
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    if (skipLines.has(i + 1)) continue;
    const listStripped = lines[i].replace(/^\s*(?:[-*+]\s+)?/, "").trim();
    if (STATE_LINE_RE.test(listStripped)) continue; // run-URL state lines are not prose
    for (const e of STATE_BARE_RES) {
      if (!active.includes(e.predicate)) continue;
      if (e.re.test(lines[i])) { hits.push({ predicate: e.predicate, line: i + 1 }); break; }
    }
    if (hits.length > 0 && hits[hits.length - 1].line === i + 1) continue;
    for (const pred of active) {
      for (const phrase of STATE_BARE_WORD_PHRASES[pred] || []) {
        if (lines[i].includes(phrase)) { hits.push({ predicate: pred, line: i + 1 }); break; }
      }
      if (hits.length > 0 && hits[hits.length - 1].line === i + 1) break;
    }
  }
  return hits;
}

// --- legs -------------------------------------------------------------------

// R1 (S-1 rework): the collected branch set is the keys of stackBranchMembers
// - the collector writes one key per ATTEMPTED branch (member array, or null
// for ref-absent). A branch that was never collected is not "absent"; it is
// unread, and reading an unread branch as absent is the report-level
// false-GREEN direction the audit named. branchRefs keys are unioned in so
// hand-built snapshots that only set branchRefs still count as collected.
function branchCollected(git, branch) {
  if (!git || git.ok !== true) return false;
  return (
    (git.stackBranchMembers && Object.prototype.hasOwnProperty.call(git.stackBranchMembers, branch)) ||
    (git.branchRefs && Object.prototype.hasOwnProperty.call(git.branchRefs, branch))
  );
}

// env.registry injects the predicate registry (the anchor:predicate-registry
// falsification surface). Absent → the production constant; present but
// malformed → an empty registry so every marker falls to out-of-vocabulary
// (fail-closed, never silently satisfied). The LIVE predicate set is the
// closed STATE_PREDICATES intersected with registry keys: a registry entry
// the core cannot evaluate is RED, and a predicate struck from the registry
// is OOV.
function effectiveRegistry(env) {
  if (!env || env.registry === undefined || env.registry === null) return STATE_PREDICATE_REGISTRY;
  return typeof env.registry === "object" ? env.registry : {};
}
function livePredicates(env) {
  const registry = effectiveRegistry(env);
  return STATE_PREDICATES.filter((p) => Object.prototype.hasOwnProperty.call(registry, p));
}
// The deferred-registry surface (env.deferred, collected by the shell):
//   ok                 - the registry file parsed
//   covers             - branches registered as residual in OPEN entries
//   pendingPredicates  - predicates seated PENDING by OPEN entries (R7)
function deferredFacts(env) {
  const d = env && env.deferred;
  const ok = !!(d && d.ok === true);
  return {
    ok,
    covers: ok && Array.isArray(d.covers) ? d.covers : [],
    pendingPredicates: ok && Array.isArray(d.pendingPredicates) ? d.pendingPredicates : [],
  };
}

export function assessRunUrlLeg(section, stack, env) {
  const problems = [];
  const annotations = [];
  const citations = [];
  const base = { state: "RED", redCodes: [], annotations, citations, problems, pendingCode: null, verifiedPending: false };

  if (!section.present) {
    return { ...base, redCodes: [emitCode(RUN_URL_RED_CODES, "run-url-section-missing")], problems: ["missing the required 「绿色 run URL」 section"] };
  }
  const kinds = uniq(section.kinds);
  if (kinds.length === 0) {
    return { ...base, redCodes: [emitCode(RUN_URL_RED_CODES, "run-url-state-line-missing")], problems: ["run-URL section carries no `GREEN:` / `PENDING:` state line (prose/annotation URLs no longer satisfy the field)"] };
  }
  if (kinds.length > 1) {
    return { ...base, redCodes: [emitCode(RUN_URL_RED_CODES, "run-url-state-ambiguous")], problems: ["run-URL section declares both " + kinds.join(" and ") + " - exactly one state is allowed"] };
  }

  const kind = kinds[0];
  const branch = stack && stack.present ? stack.branch : null;

  if (kind === "PENDING") {
    const code = section.pendingCodes[0] ?? null;
    if (!code || !PENDING_REASON_CODES.includes(code)) {
      return {
        ...base,
        redCodes: [emitCode(RUN_URL_RED_CODES, "pending-reason-out-of-vocabulary")],
        pendingCode: code,
        problems: ["PENDING reason `" + String(code) + "` is outside the closed vocabulary {" + PENDING_REASON_CODES.join(", ") + "}"],
      };
    }
    if (!branch) {
      return {
        ...base,
        redCodes: [emitCode(RUN_URL_RED_CODES, "declaration-fact-conflict")],
        pendingCode: code,
        problems: ["PENDING{" + code + "} cannot be verified: the Stack line names no branch"],
      };
    }
    // B1/B2 (ADR-0097 Addendum A): the predicate is only "verified offline" when
    // the facts were actually OBTAINED. `env.git.ok` / `env.workflows.ok` are
    // consulted here for the same reason the Stack leg consults `env.git.ok`: an
    // environment that could not be read proves nothing, and reporting it as
    // verified is the F8-b silent fold one layer down.
    const refsOk = !!(env && env.git && env.git.ok === true);
    const refs = refsOk && env.git.branchRefs ? env.git.branchRefs : null;
    const wfOk = !!(env && env.workflows && env.workflows.ok === true);
    const wf = wfOk ? env.workflows : null;
    if (code === "stack-unpushed") {
      // R1 (S-1): an UNCOLLECTED branch is unread, not absent - degrade to
      // env-PENDING instead of verifying the predicate on a missing key.
      if (refs === null || !branchCollected(env && env.git, branch)) {
        annotations.push("verification-unavailable:" + emitCode(VERIFICATION_UNAVAILABLE_CODES, "ref-unavailable"));
        return { ...base, state: "PENDING", pendingCode: code, annotations, problems: ["PENDING{" + code + "} left unverified: origin-ref facts unavailable"] };
      }
      if (Object.prototype.hasOwnProperty.call(refs, branch)) {
        return { ...base, redCodes: [emitCode(RUN_URL_RED_CODES, "declaration-fact-conflict")], pendingCode: code, problems: ["PENDING{" + code + "} contradicted: origin/" + branch + " exists"] };
      }
      return { ...base, state: "PENDING", pendingCode: code, verifiedPending: true, problems: [] };
    }
    // pushed-no-branch-runs
    if (refs === null || wf === null || !branchCollected(env && env.git, branch)) {
      annotations.push("verification-unavailable:" + emitCode(VERIFICATION_UNAVAILABLE_CODES, "ref-unavailable"));
      return { ...base, state: "PENDING", pendingCode: code, annotations, problems: ["PENDING{" + code + "} left unverified: origin-ref / workflow-trigger facts unavailable"] };
    }
    if (!Object.prototype.hasOwnProperty.call(refs, branch)) {
      return { ...base, redCodes: [emitCode(RUN_URL_RED_CODES, "declaration-fact-conflict")], pendingCode: code, problems: ["PENDING{" + code + "} contradicted: origin/" + branch + " does not exist (that is stack-unpushed)"] };
    }
    const covered = wf.pushAllBranches === true || (Array.isArray(wf.pushBranches) && wf.pushBranches.includes(branch));
    if (covered) {
      return { ...base, redCodes: [emitCode(RUN_URL_RED_CODES, "declaration-fact-conflict")], pendingCode: code, problems: ["PENDING{" + code + "} contradicted: a workflow push trigger covers " + branch] };
    }
    return { ...base, state: "PENDING", pendingCode: code, verifiedPending: true, problems: [] };
  }

  // GREEN declared
  if (section.malformedUrl) {
    return { ...base, redCodes: [emitCode(RUN_URL_RED_CODES, "run-url-unparseable")], problems: ["GREEN line cites an actions/runs/ path but no `actions/runs/<id>` id can be extracted"] };
  }
  if (section.urls.length === 0) {
    return { ...base, redCodes: [emitCode(RUN_URL_RED_CODES, "run-url-unparseable")], problems: ["GREEN declared but no `actions/runs/<id>` URL is cited on the state line"] };
  }
  if (!env || !env.gh || env.gh.ok !== true) {
    annotations.push("verification-unavailable:" + emitCode(VERIFICATION_UNAVAILABLE_CODES, "gh-missing"));
    return { ...base, state: "PENDING", annotations, problems: [] };
  }
  if (!env.repo) {
    annotations.push("verification-unavailable:" + emitCode(VERIFICATION_UNAVAILABLE_CODES, "repo-parse"));
    return { ...base, state: "PENDING", annotations, problems: [] };
  }
  // `env.git.ok` is required here too: a membership set that was never read is
  // not an empty membership set (B1 - the same silent fold, GREEN path).
  const members = stack && stack.present && env.git && env.git.ok === true && env.git.stackBranchMembers ? env.git.stackBranchMembers[stack.branch] ?? null : null;
  if (members === null) {
    annotations.push("verification-unavailable:" + emitCode(VERIFICATION_UNAVAILABLE_CODES, "ref-unavailable"));
    return { ...base, state: "PENDING", annotations, problems: ["GREEN claim left unverified: no stack membership set for " + String(branch)] };
  }
  const memberSet = new Set(members);
  const runs = env.gh.runs ?? {};
  let resolved = 0;
  const mismatches = [];
  for (const u of section.urls) {
    const run = runs[u.id];
    if (!run || run === "api-failed") continue;
    resolved++;
    // N4: strict equality - a run whose repo cannot be read must not silently
    // satisfy the repo conjunct by absence.
    if (run.repo !== env.repo) { mismatches.push("run " + u.id + ": repo " + String(run.repo) + " != " + env.repo); continue; }
    if (run.conclusion !== "success") { mismatches.push("run " + u.id + ": conclusion " + String(run.conclusion) + " != success"); continue; }
    if (!REQUIRED_WORKFLOWS.includes(run.workflow)) { mismatches.push("run " + u.id + ": workflow " + String(run.workflow) + " not in required set {" + REQUIRED_WORKFLOWS.join(", ") + "}"); continue; }
    if (!memberSet.has(run.head_sha)) { mismatches.push("run " + u.id + ": head_sha " + String(run.head_sha) + " is not on origin/main..origin/" + String(branch)); continue; }
    citations.push({ id: u.id, head_sha: run.head_sha, workflow: run.workflow, conclusion: run.conclusion });
    return { ...base, state: "GREEN", citations, problems: [] };
  }
  if (resolved === 0) {
    annotations.push("verification-unavailable:" + emitCode(VERIFICATION_UNAVAILABLE_CODES, "api-failed"));
    return { ...base, state: "PENDING", annotations, problems: ["GREEN claim left unverified: every cited run id failed to resolve"] };
  }
  return {
    ...base,
    redCodes: [emitCode(RUN_URL_RED_CODES, "green-claim-falsified")],
    problems: ["GREEN declared but no cited run satisfies stack-membership + success + required-workflow + repo:", ...mismatches],
  };
}

export function assessStackLeg(parsed, env) {
  const redCodes = [];
  const problems = [];
  const annotations = [];
  const links = [];

  if (!parsed.present) {
    return { state: "RED", redCodes: [emitCode(STACK_STRUCTURAL_RED_CODES, "stack-line-missing")], problems: ["missing the required Stack header line"], annotations, links };
  }
  // Landed-stack variant: `Stack（dissolved @ <date>）` replaces the live-stack
  // three elements with the dissolve check - the workspace stack and its
  // but-ids are gone by design, so the only verifiable residual is that the
  // named branch's origin ref is really absent. A still-present branch (empty
  // or membered) contradicts the claim; unreadable ref facts degrade.
  if (parsed.dissolved) {
    const day = toEpochDay(parsed.dissolvedDate);
    const nowDay = toEpochDay(String((env && env.now) ?? "").slice(0, 10));
    if (nowDay !== null && day !== null && day > nowDay) {
      return { state: "RED", redCodes: [emitCode(STATE_RED_CODES, "state-marker-unparseable")], problems: ["state-marker-unparseable: dissolved date " + parsed.dissolvedDate + " is in the future (a declaration cannot be true when written yet)"], annotations, links };
    }
    if (!parsed.branch || !STATE_BRANCH_RE.test(parsed.branch)) {
      return { state: "RED", redCodes: [emitCode(STACK_STRUCTURAL_RED_CODES, "stack-line-missing")], problems: ["dissolved Stack line names no branch"], annotations, links };
    }
    if (!branchCollected(env && env.git, parsed.branch)) {
      annotations.push(emitCode(STACK_ENV_CODES, "ref-unavailable"));
      return { state: "PENDING", redCodes, problems: [], annotations, links };
    }
    const members = env.git.stackBranchMembers[parsed.branch] ?? null;
    // Cross-check the ref map before trusting a null member set: a present
    // origin ref contradicts "dissolved" even when the member collection is
    // absent (audit N4 - hand-built envs can split the pair; reading the ref
    // as absent would be the S-1 false-GREEN direction).
    const refSha = env.git.branchRefs && Object.prototype.hasOwnProperty.call(env.git.branchRefs, parsed.branch) ? env.git.branchRefs[parsed.branch] : null;
    if (members === null && (refSha === null || refSha === undefined || refSha === "")) {
      links.push({ butId: null, sha: null, branch: parsed.branch });
      return { state: "GREEN", redCodes, problems: [], annotations, links };
    }
    if (members === null) {
      return {
        state: "RED",
        redCodes: [emitCode(RUN_URL_RED_CODES, "declaration-fact-conflict")],
        problems: [
          "declaration-fact-conflict: `Stack（dissolved` claimed but origin/" +
          parsed.branch +
          " still exists (ref " + String(refSha).slice(0, 12) + " present; member set uncollected - an empty ref is not a dissolve)",
        ],
        annotations,
        links,
      };
    }
    return {
      state: "RED",
      redCodes: [emitCode(RUN_URL_RED_CODES, "declaration-fact-conflict")],
      problems: [
        "declaration-fact-conflict: `Stack（dissolved` claimed but origin/" +
        parsed.branch +
        (members.length > 0
          ? " still carries " + members.length + " unmerged member(s)"
          : " still exists (an empty ref is not a dissolve)"),
      ],
      annotations,
      links,
    };
  }

  if (parsed.entries.length === 0) {
    return { state: "RED", redCodes: [emitCode(STACK_STRUCTURAL_RED_CODES, "stack-chain-empty")], problems: ["Stack line carries no branch → but-id chain"], annotations, links };
  }

  // Element (i): every but-id resolves in `but status`.
  if (!env || !env.but || env.but.ok !== true || !Array.isArray(env.but.ids)) {
    annotations.push(emitCode(STACK_ENV_CODES, "stack-unavailable"));
  } else {
    const ids = new Set(env.but.ids ?? []);
    for (const e of parsed.entries) {
      if (!ids.has(e.butId)) {
        redCodes.push(emitCode(STACK_RED_CODES, "but-id-not-resolved"));
        problems.push("but-id-not-resolved: `" + e.butId + "` is not in the but status id set");
      }
    }
  }

  // Element (ii): every capture sha resolves to a commit object.
  const withSha = parsed.entries.filter((e) => e.sha);
  if (withSha.length > 0) {
    if (!env || !env.git || env.git.ok !== true || !env.git.commitObjects) {
      // An absent object map is a shape gap, not an empty map: a fact that was
      // never read must not become a RED (the mirror of B1).
      annotations.push(emitCode(STACK_ENV_CODES, "ref-unavailable"));
    } else {
      const objs = env.git.commitObjects;
      for (const e of withSha) {
        if (objs[e.sha] !== "commit") {
          redCodes.push(emitCode(STACK_RED_CODES, "sha-not-commit"));
          problems.push("sha-not-commit: `" + e.sha + "` (" + e.butId + ") is not a commit object");
        }
      }
    }
  }

  // Element (iii): the chain-tail sha is a member of the named branch history
  // (membership, not tip equality - a late gate run adds commits and must not
  // redden the line).
  const tail = withSha.length > 0 ? withSha[withSha.length - 1] : null;
  if (tail) {
    if (env && env.git && env.git.shallow === true) {
      annotations.push(emitCode(STACK_ENV_CODES, "shallow-clone"));
    } else {
      const members = env && env.git && env.git.stackBranchMembers ? env.git.stackBranchMembers[parsed.branch] ?? null : null;
      // Capture shas are written short in the doc; membership is checked against
      // the full sha the shell resolved (a short sha is never a git-rev-list key).
      const tailFull = ((env && env.git && env.git.resolveSha ? env.git.resolveSha[tail.sha] : null) ?? null) || tail.sha;
      if (members === null) {
        annotations.push(emitCode(STACK_ENV_CODES, "ref-unavailable"));
      } else if (!members.includes(tailFull)) {
        redCodes.push(emitCode(STACK_RED_CODES, "chain-tail-not-in-branch"));
        problems.push("chain-tail-not-in-branch: `" + tail.sha + "` (" + tail.butId + ") is not in origin/main..origin/" + String(parsed.branch));
      } else {
        links.push({ butId: tail.butId, sha: tail.sha, branch: parsed.branch });
      }
    }
  }

  // Freshness annotation (advisory, never reddening - Observable Fail-Open).
  const maxAge = Number.isFinite(env && env.maxCaptureAgeDays) ? Number(env.maxCaptureAgeDays) : STACK_CAPTURE_MAX_AGE_DAYS;
  const nowDay = toEpochDay(String((env && env.now) ?? "").slice(0, 10));
  if (nowDay !== null) {
    for (const e of parsed.entries) {
      const day = toEpochDay(e.date);
      if (day === null) continue;
      const age = nowDay - day;
      if (age > maxAge) annotations.push(emitCode(STACK_ADVISORY_CODES, "stale-capture") + ":" + e.butId + ":" + age + "d");
    }
  }

  const state = redCodes.length > 0 ? "RED" : annotations.length > 0 ? "PENDING" : "GREEN";
  // deduped: elements (ii) and (iii) can both report ref-unavailable
  return { state, redCodes: uniq(redCodes), problems, annotations: uniq(annotations), links };
}

// Offline predicate check for one resolved marker. Returns true when the
// declaration still holds at gate time, a contradiction detail when its
// invalidation trigger has fired, or null when the facts could not be read
// (env-PENDING, never a silent verified).
function checkStatePredicate(predicate, branch, env) {
  if (predicate === "no-branch-runs") {
    const wfOk = !!(env && env.workflows && env.workflows.ok === true);
    const wf = wfOk ? env.workflows : null;
    if (wf === null || !Array.isArray(wf.pushBranches)) return null;
    if (wf.pushAllBranches === true || wf.pushBranches.includes(branch)) {
      return "a workflow push trigger covers origin/" + branch;
    }
    return true;
  }
  const refsOk = !!(env && env.git && env.git.ok === true);
  if (predicate === "unpushed") {
    const refs = refsOk && env.git.branchRefs ? env.git.branchRefs : null;
    // R1 (S-1): uncollected is unread, not absent. A branch the collector never
    // attempted (report-only sweep, foreign closeout) degrades to env-PENDING.
    if (refs === null || !branchCollected(env.git, branch)) return null;
    if (Object.prototype.hasOwnProperty.call(refs, branch)) {
      return "origin/" + branch + " exists";
    }
    return true;
  }
  if (predicate === "unlanded") {
    const members = refsOk && env.git.stackBranchMembers ? (env.git.stackBranchMembers[branch] ?? null) : null;
    if (members === null) return null;
    if (members.length > 0) return true;
    return "origin/main..origin/" + branch + " is empty";
  }
  // Fail-closed: a registered predicate with no evaluator is a contradiction
  // detail, never a pass and never an accidental fall-through to `unlanded`.
  return "no evaluator for predicate `" + String(predicate) + "`";
}

export function assessStateLeg(text, stackParsed, env) {
  const redCodes = [];
  const problems = [];
  const annotations = [];
  const parsed = parseStateMarkers(text);
  for (const m of parsed.malformed) {
    redCodes.push(emitCode(STATE_RED_CODES, "state-marker-unparseable"));
    problems.push("state-marker-unparseable: line " + m.line + " opens a state marker but does not parse as `<!-- state: <predicate> <args> @ <date> -->`: " + m.raw);
  }
  const skip = new Set([...parsed.markers.map((m) => m.line), ...parsed.malformed.map((m) => m.line)]);
  let legal = 0;
  const nowDay = toEpochDay(String((env && env.now) ?? "").slice(0, 10));
  const livePreds = livePredicates(env);
  const pendingPreds = deferredFacts(env).pendingPredicates;
  for (const m of parsed.markers) {
    if (m.args.includes("--")) {
      redCodes.push(emitCode(STATE_RED_CODES, "state-marker-unparseable"));
      problems.push("state-marker-unparseable: line " + m.line + " args carries `--` (CommonMark comment strictness)");
      continue;
    }
    if (!livePreds.includes(m.predicate)) {
      // R7 (P-3): a predicate seated in docs/deferred-registry.json
      // (`pending_predicates` on an OPEN entry) is surfaced, never blocking -
      // the seat list being registry data means a closed defer entry
      // automatically re-reddens its predicate (ratchet path).
      if (pendingPreds.includes(m.predicate)) {
        annotations.push(emitCode(STATE_PENDING_CODES, "pending-predicate") + ":" + m.predicate);
        continue;
      }
      redCodes.push(emitCode(STATE_RED_CODES, "state-predicate-out-of-vocabulary"));
      problems.push("state-predicate-out-of-vocabulary: `" + m.predicate + "` is outside {" + STATE_PREDICATES.join(", ") + "} (live predicates ride the extension ticket, never the prose)");
      continue;
    }
    legal++;
    let branch = m.args;
    if (branch === "stack") {
      branch = stackParsed && stackParsed.present ? stackParsed.branch : null;
      if (!branch) {
        redCodes.push(emitCode(STATE_RED_CODES, "state-marker-unparseable"));
        problems.push("state-marker-unparseable: line " + m.line + " `stack` placeholder names no Stack line branch");
        continue;
      }
    }
    if (!STATE_BRANCH_RE.test(branch)) {
      redCodes.push(emitCode(STATE_RED_CODES, "state-marker-unparseable"));
      problems.push("state-marker-unparseable: line " + m.line + " args is not a branch name: `" + m.args + "`");
      continue;
    }
    if (!isCalendarDate(m.date)) {
      redCodes.push(emitCode(STATE_RED_CODES, "state-marker-unparseable"));
      problems.push("state-marker-unparseable: line " + m.line + " date is not a calendar date: `" + m.date + "`");
      continue;
    }
    const day = toEpochDay(m.date);
    if (nowDay !== null && day > nowDay) {
      redCodes.push(emitCode(STATE_RED_CODES, "state-marker-unparseable"));
      problems.push("state-marker-unparseable: line " + m.line + " date " + m.date + " is in the future (a declaration cannot be true when written yet)");
      continue;
    }
    const checked = checkStatePredicate(m.predicate, branch, env);
    if (checked === null) {
      annotations.push(emitCode(STACK_ENV_CODES, "ref-unavailable"));
    } else if (checked !== true) {
      redCodes.push(emitCode(RUN_URL_RED_CODES, "declaration-fact-conflict"));
      problems.push("declaration-fact-conflict: `<!-- state: " + m.predicate + " " + m.args + " -->` contradicted: " + checked);
    }
  }
  // R3/P-8 + registry parameterization: the bare-word scan rides the SAME
  // effective predicate set the markers are judged against (a struck registry
  // entry silences both - the anchor:bare-word-single-source falsification
  // surface).
  const bare = collectBareWords(text, skip, livePredicates(env));
  if (bare.length > 0 && legal === 0) {
    redCodes.push(emitCode(STATE_RED_CODES, "bare-word-violation"));
    const shown = bare.slice(0, 3).map((b) => "`" + b.predicate + "` (line " + b.line + ")").join(", ");
    problems.push("bare-word-violation: predicate word(s) in prose with no legal state marker in the file: " + shown + " - prose is subordinate to markers, never the reverse");
  }
  const state = redCodes.length > 0 ? "RED" : annotations.length > 0 ? "PENDING" : "GREEN";
  return { state, redCodes: uniq(redCodes), problems, annotations: uniq(annotations), markers: parsed.markers.length };
}

// R6 (P-2 rework, R97 D-002 legislation, machine surface = R98 first dogfood):
// the closeout clearing obligation 「轮收口时栈须空，否则残留分支须在
// docs/deferred-registry.json 在册」.
//
// Residual = the Stack-line branch whose origin member set is non-empty
// (members === null means the ref itself is gone - the stack was landed and
// deleted, which IS cleared), plus every branch an unlanded/unpushed marker
// verifies live at gate time. Satisfied two ways:
//   栈空      - no live residual (empty member set or absent ref)
//   deferred  - every residual branch named in `covers` of an OPEN entry
// Unreadable facts degrade to env-PENDING (never a silent pass); an uncovered
// residual is RED.
export function assessClearingLeg(text, stackParsed, env) {
  const annotations = [];
  const redCodes = [];
  const problems = [];
  const residual = new Set();
  let unreadable = false;

  if (stackParsed && stackParsed.present && stackParsed.branch) {
    const branch = stackParsed.branch;
    if (!branchCollected(env && env.git, branch)) {
      unreadable = true;
    } else {
      const members = env.git.stackBranchMembers[branch] ?? null;
      if (members !== null && members.length > 0) residual.add(branch);
    }
  }

  const livePreds = livePredicates(env);
  const parsed = parseStateMarkers(text);
  for (const m of parsed.markers) {
    if (!livePreds.includes(m.predicate)) continue;   // judged by the state leg
    if (m.predicate === "no-branch-runs") continue;   // topology, not residual
    const branch =
      m.args === "stack" ? (stackParsed && stackParsed.present ? stackParsed.branch : null) : m.args;
    if (!branch || !STATE_BRANCH_RE.test(branch)) continue;
    const checked = checkStatePredicate(m.predicate, branch, env);
    if (checked === null) unreadable = true;
    else if (checked === true) residual.add(branch);
  }

  if (unreadable) annotations.push(emitCode(STACK_ENV_CODES, "ref-unavailable"));

  if (residual.size > 0) {
    const def = deferredFacts(env);
    if (!def.ok) {
      annotations.push(emitCode(CLEARING_ENV_CODES, "deferred-registry-unavailable"));
    } else {
      const covers = new Set(def.covers);
      const uncovered = [...residual].filter((b) => !covers.has(b));
      if (uncovered.length > 0) {
        redCodes.push(emitCode(CLEARING_RED_CODES, "clearing-residual-unregistered"));
        problems.push(
          "clearing-residual-unregistered: residual stack branch(es) {" +
          uncovered.join(", ") +
          "} are neither empty on origin nor covered by an OPEN deferred-registry entry (`covers` field) - the clearing obligation is stack-empty OR deferred-registered, never a third state"
        );
      }
    }
  }

  const state = redCodes.length > 0 ? "RED" : annotations.length > 0 ? "PENDING" : "GREEN";
  return { state, redCodes: uniq(redCodes), problems, annotations: uniq(annotations), residual: [...residual] };
}

// --- top level --------------------------------------------------------------

// Assess one handoff document. `input` = { text, round, env }.
export function assessHandoffLint(input) {
  const text = String((input && input.text) ?? "");
  const round = input && Number.isFinite(input.round) ? Number(input.round) : null;
  const env = (input && input.env) ?? {};
  const stackParsed = parseStackLine(text);
  const runSection = parseRunUrlSection(text);

  const legacy = round !== null && round < EFFECTIVE_SCOPE_FLOOR;
  if (legacy) {
    const problems = [];
    if (!runSection.present) problems.push("missing the required 「绿色 run URL」 section");
    if (!stackParsed.present) problems.push("missing the required Stack header line");
    if (!/actions\/runs\/\d+/.test(text)) problems.push("no actions/runs/<id> URL cited");
    // Same shape as the three-state return (redCodes / pendingSummary included):
    // the report layer consumes those fields unconditionally, so a legacy RED
    // must not hand it `undefined`.
    return {
      scope: "legacy",
      round,
      verdict: problems.length > 0 ? "RED" : "GREEN",
      problems,
      annotations: [],
      redCodes: [],
      pendingSummary: [],
      runUrl: null,
      stack: null,
      state: null,
      clearing: null,
    };
  }

  const stack = assessStackLeg(stackParsed, env);
  const runUrl = assessRunUrlLeg(runSection, stackParsed, env);
  const state = assessStateLeg(text, stackParsed, env);
  const clearing = assessClearingLeg(text, stackParsed, env);
  const problems = [...runUrl.problems, ...stack.problems, ...state.problems, ...clearing.problems];
  // N7: the leg annotations are prefixed ONCE here; the report layer consumes
  // these summaries instead of re-projecting the legs (one source of truth).
  const annotations = [
    ...runUrl.annotations.map((a) => "run-url:" + a),
    ...stack.annotations.map((a) => "stack:" + a),
    ...state.annotations.map((a) => "state:" + a),
    ...clearing.annotations.map((a) => "clearing:" + a),
  ];
  const redCodes = uniq([...runUrl.redCodes, ...stack.redCodes, ...state.redCodes, ...clearing.redCodes]);
  // The declared code AND any degradation annotation: when a declared PENDING
  // could not be verified, the report line must say so (R1/R2 - the degradation
  // is the whole signal; folding it away would re-create the silent fold).
  const pendingSummary = [];
  if (runUrl.state === "PENDING") {
    const parts = [];
    if (runUrl.pendingCode) parts.push(runUrl.pendingCode);
    for (const a of runUrl.annotations) parts.push(a);
    pendingSummary.push("run-url:" + (parts.length > 0 ? parts.join(",") : "unverified"));
  }
  if (stack.state === "PENDING") pendingSummary.push("stack:" + (stack.annotations.join(",") || "unverified"));
  if (state.state === "PENDING") pendingSummary.push("state:" + (state.annotations.join(",") || "unverified"));
  if (clearing.state === "PENDING") pendingSummary.push("clearing:" + (clearing.annotations.join(",") || "unverified"));
  const verdict =
    runUrl.state === "RED" || stack.state === "RED" || state.state === "RED" || clearing.state === "RED"
      ? "RED"
      : runUrl.state === "PENDING" || stack.state === "PENDING" || state.state === "PENDING" || clearing.state === "PENDING"
        ? "PENDING"
        : "GREEN";
  return { scope: "three-state", round, verdict, problems, annotations, redCodes, pendingSummary, runUrl, stack, state, clearing };
}
