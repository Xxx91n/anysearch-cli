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
  return { present: true, headerIndex: headerIdx, branch: branch || null, entries, raw: chainLine };
}

// Round number from a closeout filename, e.g. `round-96-closeout.md` -> 96.
export function parseRoundFromName(name) {
  const m = /(?:^|[^0-9])(?:round[-_]?)?(\d{1,4})(?:[^0-9]|$)/i.exec(String(name ?? ""));
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

// --- legs -------------------------------------------------------------------

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
      if (refs === null) {
        annotations.push("verification-unavailable:" + emitCode(VERIFICATION_UNAVAILABLE_CODES, "ref-unavailable"));
        return { ...base, state: "PENDING", pendingCode: code, annotations, problems: ["PENDING{" + code + "} left unverified: origin-ref facts unavailable"] };
      }
      if (Object.prototype.hasOwnProperty.call(refs, branch)) {
        return { ...base, redCodes: [emitCode(RUN_URL_RED_CODES, "declaration-fact-conflict")], pendingCode: code, problems: ["PENDING{" + code + "} contradicted: origin/" + branch + " exists"] };
      }
      return { ...base, state: "PENDING", pendingCode: code, verifiedPending: true, problems: [] };
    }
    // pushed-no-branch-runs
    if (refs === null || wf === null) {
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
    };
  }

  const stack = assessStackLeg(stackParsed, env);
  const runUrl = assessRunUrlLeg(runSection, stackParsed, env);
  const problems = [...runUrl.problems, ...stack.problems];
  // N7: the leg annotations are prefixed ONCE here; the report layer consumes
  // these summaries instead of re-projecting the legs (one source of truth).
  const annotations = [
    ...runUrl.annotations.map((a) => "run-url:" + a),
    ...stack.annotations.map((a) => "stack:" + a),
  ];
  const redCodes = uniq([...runUrl.redCodes, ...stack.redCodes]);
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
  const verdict =
    runUrl.state === "RED" || stack.state === "RED"
      ? "RED"
      : runUrl.state === "PENDING" || stack.state === "PENDING"
        ? "PENDING"
        : "GREEN";
  return { scope: "three-state", round, verdict, problems, annotations, redCodes, pendingSummary, runUrl, stack };
}
