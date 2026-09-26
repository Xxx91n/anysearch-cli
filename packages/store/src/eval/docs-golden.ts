// ADR-0061 D2/D5: the docs-domain golden batch lives as a `golden` top-level
// collection inside eval-looks.json — the same file as the OF look ledger.
// This module owns the entry schema, the eight-dimension slice vocabulary
// (first committed definition site), and the eval-looks.coverage.json contract.

export const DOCS_GOLDEN_SCHEMA = "anysearch/docs-golden@1";
export const DOCS_GOLDEN_COVERAGE_SCHEMA = "anysearch/eval-looks-coverage@1";

export const DOCS_GOLDEN_INTENTS = ["factoid", "howto", "troubleshoot", "comparison", "reference"] as const;
export type DocsGoldenIntent = (typeof DOCS_GOLDEN_INTENTS)[number];

// Eight slice dimensions (ADR-0061 D2): intent classes / source tier / freshness /
// chinese-query / claim-level attribution / multi-hop / abstention negative / injection.
export const DOCS_GOLDEN_DIMENSION_VALUES: Record<string, readonly string[]> = {
  intent: ["factoid", "howto", "troubleshoot", "comparison", "reference"],
  "source-tier": ["spec", "reference", "settings"],
  freshness: ["stable", "active", "supersede-event"],
  lang: ["zh", "en"],
  attribution: ["claim", "domain"],
  hops: ["single", "multi"],
  negative: ["abstain"],
  adversarial: ["injection"],
};
export const DOCS_GOLDEN_DIMENSIONS = Object.keys(DOCS_GOLDEN_DIMENSION_VALUES);
export const DOCS_GOLDEN_PROVENANCE_TYPES = ["internal-dogfood", "external-community", "constructed", "llm-assisted"] as const;
export const DOCS_GOLDEN_VERDICTS = ["answer", "abstain"] as const;

// R84 T1 / ADR-0085 draft: vertical-eval strata vocabulary. Kept in a SEPARATE
// map from DOCS_GOLDEN_DIMENSION_VALUES — the coverage manifest asserts exact
// tag-count equality for the eight docs dimensions, so vertical entries must
// never carry docs-dimension tags; their slice accounting rides on these two.
export const VERTICAL_DIMENSION_VALUES: Record<string, readonly string[]> = {
  stratum: ["parameterized", "semantic", "control"],
  vdomain: ["finance", "academic", "code", "health", "cross"],
};
export const VERTICAL_DIMENSIONS = Object.keys(VERTICAL_DIMENSION_VALUES);

// R84 T1 / ADR-0085 draft: expected.vertical assertion keys — legislated in
// .scratch/grill-round-84/evidence/t1-semantics-legislation.md (A-02/A-04)
// before any assertion consumed them (Pact Golden Rule).
//   role "subject"  — the entry is a vertical query under test; domain required.
//   role "control"  — off-domain/ambiguous/upstream-reject surface; existence is
//                     a first-class assertion, pass/fail is soft (live leg
//                     records control failures to the degraded list, never the
//                     red gate — D-004 iii).
//   hit             — subject: >=1 fused result carries extra.vertical marker
//                     with domain === asserted domain; control:false asserts
//                     NO result carries the marker (silent-fallback surface).
//   paramsKeys      — expected Object.keys() of the canonicalized params sent
//                     on the wire (post A-04 canonicalization truth source).
//   paramsSent      — false pins wire-absence of sub_domain_params (A-04).
//   degraded        — subject: exact degraded-arm id list from the
//                     retrieval.vertical.pre event; control: the string
//                     "general-fallback" asserts the vertical arm degraded to
//                     the general fanout surface.
export interface DocsGoldenVerticalExpectation {
  role: "subject" | "control";
  domain?: string;
  sub_domain?: string;
  paramsKeys?: string[];
  paramsSent?: boolean;
  hit?: boolean;
  degraded?: string[] | "general-fallback";
  // R84 T2 / D-004(iv): measurement pool — ANY-of candidate hosts the delta
  // runner scores against (host-hit / host+path strong-hit rates). This is a
  // measurement surface, NOT a hard gate: the live leg never fails an entry on
  // hitHosts (small-n drift on upstream host mix is evidence, not breakage).
  hitHosts?: string[];
  // Same shape for page-family strong hits: path prefixes to match under any
  // pool host (e.g. "/r/", "/en/latest/"). Feeds the two-tier rate's second leg.
  hitPaths?: string[];
}

// Query-level vertical spec the executors inject (CLI --vertical-* flags in the
// live leg; engine.search({vertical}) in the stub leg). Internal camelCase
// naming mirrors SearchRequest.vertical — the wire mapping happens in the
// anysearch adapter, not here.
export interface DocsGoldenVerticalSpec {
  domain: string;
  subDomain?: string;
  params?: Record<string, unknown>;
}

// R64 D-005: four optional fixture fields + eval-looks root schema_version
// sentinel (additive — no breaking change, hence no schema v2 migration).
export const DOCS_GOLDEN_TOLERATED_SEGMENTS = ["locale", "version", "dated"] as const;
export type DocsGoldenToleratedSegment = (typeof DOCS_GOLDEN_TOLERATED_SEGMENTS)[number];
export const DOCS_GOLDEN_STABILITY_CLASSES = ["controlled", "frozen-spec", "external"] as const;
export type DocsGoldenStabilityClass = (typeof DOCS_GOLDEN_STABILITY_CLASSES)[number];
export const EVAL_LOOKS_SCHEMA_VERSION = 1;

// R64 D-002: page-family pattern — pathname substring match on the result set.
// tolerate is a REQUIRED (possibly empty) explicit declaration of which
// wrapper-segment classes the pattern forgives: locale (/zh/), version (/10.x/),
// dated (/specification/2025-06-18/ -> /latest/).
export interface DocsGoldenPathPattern {
  path: string;
  tolerate: DocsGoldenToleratedSegment[];
}
export interface DocsGoldenExpected {
  verdict: "answer" | "abstain";
  mustHitHosts?: string[];
  mustHitUrls?: string[];
  mustHitPaths?: DocsGoldenPathPattern[];
  mustNotHitPaths?: string[];
  minResults?: number;
  // R84 T1 / ADR-0085 draft: vertical assertion block. Present only on entries
  // in the vertical-eval family (vert-* / ctrl-* ids); absent on docs-g* rows.
  vertical?: DocsGoldenVerticalExpectation;
}
export interface DocsGoldenProvenance {
  type: "internal-dogfood" | "external-community" | "constructed" | "llm-assisted";
  ref: string;         // repo path / .scratch path / external URL — always revisitable
  harvestedAt: string; // ISO date (YYYY-MM-DD)
  // R84 T1 / D-003(vi): constructed/llm-assisted entries carry the reviewer and
  // audit trail — LLM-assisted drafts are cross-family models only (never the
  // family under test or its upstream) and human-reviewed to gold bar.
  reviewer?: string;
  audit?: string;
}
// R64 D-005: promote physically deletes the ledger entry, so the provenance
// record of an assertion migration can only live on the golden entry itself.
// Named "migration" (not tombstone — that word is taken by Case Tombstone ADR).
export interface DocsGoldenMigration {
  from: string;      // original assertion shape (e.g. mustHitUrls:[...])
  to: string;        // new assertion shape
  drift: string;     // provider drift evidence observed live
  decidedAt: string; // ISO date of the ruling
}
export interface DocsGoldenEntry {
  id: string;
  domain: string;
  // docs-g* rows: verbatim real question text — never synthetic (D-005).
  // vert-*/ctrl-* rows: constructed or llm-assisted-and-reviewed text — the
  // honesty marker lives in provenance.type, not in the question field (R84).
  question: string;
  questionLang: "zh" | "en";
  intent: DocsGoldenIntent;
  expected: DocsGoldenExpected;
  dimensions: string[]; // "<dimension>:<value>" pairs — docs-g* rows use DOCS_GOLDEN_DIMENSION_VALUES, vert-*/ctrl-* rows use VERTICAL_DIMENSION_VALUES
  provenance: DocsGoldenProvenance;
  // R84 T1 / ADR-0085 draft: query-level vertical spec injected by the
  // executors (live leg -> --vertical-* CLI flags; stub leg -> engine search
  // request). Subject entries carry it; control entries may carry a bogus or
  // domain-only spec to pin the silent-fallback / reject surface.
  vertical?: DocsGoldenVerticalSpec;
  stability_class?: DocsGoldenStabilityClass; // upstream controllability of the asserted target
  failure_class?: string;                     // drift attribution (drives disposition path)
  migration?: DocsGoldenMigration;
  watch?: boolean;                            // post-promote observation mark (CI flip -> ratchet re-entry)
  notes?: string;
}
export interface DocsGoldenSet {
  schema: string;
  entries: DocsGoldenEntry[];
}
export interface CoverageDimension {
  dimension: string;
  status: "covered" | "deferred";
  count?: number;
  classes?: Record<string, number>;
  entryTrigger?: string;
  owner?: string;
}
export interface CoverageManifest {
  schema: string;
  domain: string;
  recordedAt: string;
  dimensions: CoverageDimension[];
}

// R84 T1 / ADR-0085 draft: id families — docs-gNNNN (docs batch),
// vert-<d>NNNN (vertical subject entries, <d> = vdomain letter),
// ctrl-NNNN (control-class entries asserting the silent-fallback surface).
export const DOCS_GOLDEN_ID_RE = /^(docs-g\d{4}|vert-[a-z]\d{4}|ctrl-[a-z]?\d{3,4})$/;

export function validateDocsGoldenEntry(raw: unknown): string[] {
  const p: string[] = [];
  const e = raw as Partial<DocsGoldenEntry> | undefined;
  if (!e || typeof e !== "object") return ["entry is not an object"];
  if (typeof e.id !== "string" || !DOCS_GOLDEN_ID_RE.test(e.id)) p.push("id must match docs-gNNNN|vert-<d>NNNN|ctrl-NNNN");
  const isVerticalEntry = e.vertical !== undefined || (e.expected as { vertical?: unknown } | undefined)?.vertical !== undefined;
  // ADR-0062 (T4): the collection is still the docs-golden batch (docs-gNNNN
  // ids), but ADR-0062 criterion 4 needs a cold-domain abstain entry — a
  // narrow-allowlist fixture domain where zero results can ever survive.
  // Non-docs domains are allowed only as abstain-only records: they may
  // assert "the gate blocks everything", never mustHit hits.
  // R84 T1: vertical-eval entries (vert-*/ctrl-*) run under non-docs TOML
  // domains (e.g. "default") and may assert verdict=answer — the abstain-only
  // cold-domain rule applies to non-vertical entries only.
  if (typeof e.domain !== "string" || !/^[a-z][a-z0-9-]{0,63}$/.test(e.domain)) p.push("domain must be a lowercase domain slug");
  if (typeof e.domain === "string" && e.domain !== "docs" && !isVerticalEntry && (e.expected as { verdict?: string } | undefined)?.verdict !== "abstain") {
    p.push("non-docs (cold-domain) entries may only assert verdict=abstain");
  }
  if (typeof e.question !== "string" || e.question.trim().length < 8) p.push("question must be verbatim text (>=8 chars)");
  if (e.questionLang !== "zh" && e.questionLang !== "en") p.push("questionLang must be zh|en");
  if (!DOCS_GOLDEN_INTENTS.includes(e.intent as DocsGoldenIntent)) p.push("intent outside five-class enum");
  const exp = e.expected as Partial<DocsGoldenExpected> | undefined;
  if (!exp || typeof exp !== "object") {
    p.push("expected block required");
  } else {
    if (!DOCS_GOLDEN_VERDICTS.includes(exp.verdict as "answer")) p.push("expected.verdict must be answer|abstain");
    if (exp.mustHitHosts !== undefined && (!Array.isArray(exp.mustHitHosts) || exp.mustHitHosts.some((h) => typeof h !== "string"))) p.push("mustHitHosts must be string[]");
    if (exp.mustHitUrls !== undefined && (!Array.isArray(exp.mustHitUrls) || exp.mustHitUrls.some((u) => typeof u !== "string" || !/^https?:\/\//.test(u)))) p.push("mustHitUrls must be http(s) string[]");
    if (exp.mustHitPaths !== undefined) {
      if (!Array.isArray(exp.mustHitPaths)) {
        p.push("mustHitPaths must be {path,tolerate}[]");
      } else {
        for (const m of exp.mustHitPaths) {
          const pm = m as Partial<DocsGoldenPathPattern> | undefined;
          if (!pm || typeof pm !== "object" || typeof pm.path !== "string" || pm.path.length === 0) {
            p.push("mustHitPaths pattern requires a non-empty path");
            continue;
          }
          if (!pm.path.startsWith("/")) p.push("mustHitPaths pattern must be a pathname fragment starting with /: " + pm.path);
          if (!Array.isArray(pm.tolerate)) {
            p.push("mustHitPaths pattern requires explicit tolerate[] (empty allowed — silence is not a declaration): " + pm.path);
          } else if (pm.tolerate.some((t) => !DOCS_GOLDEN_TOLERATED_SEGMENTS.includes(t as DocsGoldenToleratedSegment))) {
            p.push("mustHitPaths tolerate outside locale|version|dated: " + pm.path);
          }
        }
        // R64 D-002 negative-pin: page-family positives REQUIRE written-down
        // negatives — a bare substring pattern can silently over-hit.
        if (exp.mustHitPaths.length > 0 && (exp.mustNotHitPaths?.length ?? 0) === 0)
          p.push("mustHitPaths requires mustNotHitPaths negative pins on the entry");
      }
    }
    if (exp.mustNotHitPaths !== undefined && (!Array.isArray(exp.mustNotHitPaths) || exp.mustNotHitPaths.some((u) => typeof u !== "string" || u.length === 0))) p.push("mustNotHitPaths must be non-empty string[]");
    if (exp.verdict === "abstain" && ((exp.mustHitUrls?.length ?? 0) > 0 || (exp.mustHitPaths?.length ?? 0) > 0 || (exp.mustNotHitPaths?.length ?? 0) > 0)) p.push("abstain entry must not assert must-hit url/path assertions");
    // R84 T1 / ADR-0085 draft: expected.vertical assertion block validation.
    const vexp = exp.vertical as Partial<DocsGoldenVerticalExpectation> | undefined;
    if (vexp !== undefined) {
      if (typeof vexp !== "object" || vexp === null || Array.isArray(vexp)) {
        p.push("expected.vertical must be an object");
      } else {
        if (vexp.role !== "subject" && vexp.role !== "control") p.push("expected.vertical.role must be subject|control");
        if (vexp.role === "subject") {
          if (typeof vexp.domain !== "string" || vexp.domain.trim().length === 0) p.push("expected.vertical.subject requires domain (the asserted wire route)");
          if (e.vertical === undefined) p.push("subject entry requires the entry-level vertical spec (executors inject it)");
        }
        if (vexp.role === "control") {
          // Controls pin the silent-fallback surface: never a positive hit.
          if (vexp.hit === true) p.push("control entries may not assert hit:true (existence is the assertion, passing is not)");
          if (vexp.domain !== undefined) p.push("control entries do not assert a routed domain");
        }
        if (vexp.sub_domain !== undefined && (typeof vexp.sub_domain !== "string" || vexp.sub_domain.length === 0)) p.push("expected.vertical.sub_domain must be a non-empty string");
        if (vexp.paramsKeys !== undefined && (!Array.isArray(vexp.paramsKeys) || vexp.paramsKeys.some((k) => typeof k !== "string"))) p.push("expected.vertical.paramsKeys must be string[]");
        if (vexp.paramsSent !== undefined && typeof vexp.paramsSent !== "boolean") p.push("expected.vertical.paramsSent must be boolean");
        if (vexp.hit !== undefined && typeof vexp.hit !== "boolean") p.push("expected.vertical.hit must be boolean");
        if (vexp.degraded !== undefined && !(vexp.degraded === "general-fallback" || (Array.isArray(vexp.degraded) && vexp.degraded.every((d) => typeof d === "string")))) p.push("expected.vertical.degraded must be string[] | \"general-fallback\"");
        // Consistency: asserted paramsKeys must equal the injected spec's keys.
        if (vexp.role === "subject" && vexp.paramsKeys !== undefined && e.vertical !== undefined) {
          const actual = Object.keys(e.vertical.params ?? {}).sort();
          const want = [...vexp.paramsKeys].sort();
          if (JSON.stringify(actual) !== JSON.stringify(want)) p.push("expected.vertical.paramsKeys " + JSON.stringify(want) + " != injected spec keys " + JSON.stringify(actual));
        }
        if (vexp.paramsSent === true && vexp.paramsKeys !== undefined && vexp.paramsKeys.length === 0) p.push("paramsSent:true contradicts paramsKeys:[]");
        if (vexp.hitHosts !== undefined && (!Array.isArray(vexp.hitHosts) || vexp.hitHosts.length === 0 || vexp.hitHosts.some((h) => typeof h !== "string" || !/^[a-z0-9.-]+$/.test(h)))) p.push("expected.vertical.hitHosts must be a non-empty hostname string[]");
        if (vexp.hitPaths !== undefined && (!Array.isArray(vexp.hitPaths) || vexp.hitPaths.some((x) => typeof x !== "string" || !x.startsWith("/")))) p.push("expected.vertical.hitPaths must be absolute-path string[]");
      }
    }
  }
  // R84 T1 / ADR-0085 draft: entry-level vertical spec (executor injection).
  const vspec = e.vertical as Partial<DocsGoldenVerticalSpec> | undefined;
  if (vspec !== undefined) {
    if (typeof vspec !== "object" || vspec === null || Array.isArray(vspec)) {
      p.push("vertical spec must be an object");
    } else {
      if (typeof vspec.domain !== "string" || vspec.domain.trim().length === 0) p.push("vertical.domain must be a non-empty string");
      if (vspec.subDomain !== undefined && (typeof vspec.subDomain !== "string" || vspec.subDomain.trim().length === 0)) p.push("vertical.subDomain must be a non-empty string when present");
      if (vspec.params !== undefined && (typeof vspec.params !== "object" || vspec.params === null || Array.isArray(vspec.params))) p.push("vertical.params must be a Record (empty {} allowed — A-04 canonicalizes it to absent)");
    }
  }
  const tags = Array.isArray(e.dimensions) ? e.dimensions : [];
  if (tags.length === 0) {
    p.push("dimensions must be a non-empty string[]");
  } else if (isVerticalEntry) {
    // R84: vertical-family entries use the vertical slice vocabulary ONLY —
    // the coverage manifest asserts exact tag-count equality on the eight
    // docs dimensions, so vertical entries must not carry docs-dim tags.
    for (const d of tags) {
      const [dim, val] = String(d).split(":");
      const allowed = VERTICAL_DIMENSION_VALUES[dim ?? ""];
      if (!allowed || !allowed.includes(val ?? "")) p.push("vertical entry dimension tag outside stratum|vdomain vocabulary: " + d);
    }
    if (!tags.some((d) => String(d).startsWith("stratum:"))) p.push("vertical entry missing stratum: tag");
    if (!tags.some((d) => String(d).startsWith("vdomain:"))) p.push("vertical entry missing vdomain: tag");
    const vexp = e.expected?.vertical;
    if (vexp?.role === "control" && !tags.includes("stratum:control")) p.push("control entry must carry stratum:control tag");
    if (vexp?.role === "subject" && tags.includes("stratum:control")) p.push("subject entry may not carry stratum:control tag");
  } else {
    for (const d of tags) {
      const [dim, val] = String(d).split(":");
      const allowed = DOCS_GOLDEN_DIMENSION_VALUES[dim ?? ""];
      if (!allowed || !allowed.includes(val ?? "")) p.push("dimension tag outside vocabulary: " + d);
    }
    if (!tags.includes("intent:" + e.intent)) p.push("missing intent tag consistent with intent field");
    if (!tags.includes("lang:" + e.questionLang)) p.push("missing lang tag consistent with questionLang");
  }
  if (e.stability_class !== undefined && !DOCS_GOLDEN_STABILITY_CLASSES.includes(e.stability_class as DocsGoldenStabilityClass)) p.push("stability_class outside controlled|frozen-spec|external");
  if (e.failure_class !== undefined && (typeof e.failure_class !== "string" || e.failure_class.length === 0)) p.push("failure_class must be a non-empty string");
  if (e.watch !== undefined && e.watch !== true) p.push("watch must be true when present");
  if (e.migration !== undefined) {
    const m = e.migration as Partial<DocsGoldenMigration> | undefined;
    if (!m || typeof m !== "object") {
      p.push("migration must be an object");
    } else {
      for (const k of ["from", "to", "drift"] as const) {
        if (typeof m[k] !== "string" || (m[k] as string).length === 0) p.push("migration." + k + " required");
      }
      if (typeof m.decidedAt !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(m.decidedAt)) p.push("migration.decidedAt ISO date required");
    }
  }
  const prov = e.provenance as Partial<DocsGoldenProvenance> | undefined;
  if (!prov || typeof prov !== "object") {
    p.push("provenance block required");
  } else {
    if (!DOCS_GOLDEN_PROVENANCE_TYPES.includes(prov.type as "internal-dogfood")) p.push("provenance.type must be internal-dogfood|external-community|constructed|llm-assisted");
    if (typeof prov.ref !== "string" || prov.ref.length < 4) p.push("provenance.ref required");
    if (prov.type === "external-community" && !/^https?:\/\//.test(prov.ref ?? "")) p.push("external-community ref must be a URL");
    // R84 T1 / D-003(vi): built corpus carries reviewer + audit trail.
    // constructed  = human-authored -> reviewer required (reviewer = author id).
    // llm-assisted = cross-family LLM draft, human-reviewed -> reviewer AND
    //                audit trail ref both required (the draft session/model
    //                must be revisitable).
    if (prov.type === "constructed" || prov.type === "llm-assisted") {
      if (typeof prov.reviewer !== "string" || prov.reviewer.length === 0) p.push("provenance.reviewer required for " + prov.type + " entries");
    }
    if (prov.type === "llm-assisted" && (typeof prov.audit !== "string" || prov.audit.length < 4)) p.push("provenance.audit (trail ref) required for llm-assisted entries");
    if (typeof prov.harvestedAt !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(prov.harvestedAt)) p.push("provenance.harvestedAt ISO date required");
  }
  return p;
}

export function validateDocsGoldenSet(raw: unknown): string[] {
  if (!raw || typeof raw !== "object") return ["golden must be an object"];
  const g = raw as Partial<DocsGoldenSet>;
  const p: string[] = [];
  if (g.schema !== DOCS_GOLDEN_SCHEMA) p.push("golden.schema must be " + DOCS_GOLDEN_SCHEMA);
  if (!Array.isArray(g.entries)) return [...p, "golden.entries must be an array"];
  const ids = new Set<string>();
  for (const e of g.entries) {
    const id = (e as DocsGoldenEntry | undefined)?.id;
    for (const prob of validateDocsGoldenEntry(e)) p.push((typeof id === "string" ? id : "?") + ": " + prob);
    if (typeof id === "string") {
      if (ids.has(id)) p.push(id + ": duplicate id");
      ids.add(id);
    }
  }
  return p;
}

export function validateCoverageManifest(raw: unknown): string[] {
  const p: string[] = [];
  const m = raw as Partial<CoverageManifest> | undefined;
  if (!m || typeof m !== "object") return ["manifest is not an object"];
  if (m.schema !== DOCS_GOLDEN_COVERAGE_SCHEMA) p.push("schema must be " + DOCS_GOLDEN_COVERAGE_SCHEMA);
  if (m.domain !== "docs") p.push('domain must be "docs"');
  if (typeof m.recordedAt !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(m.recordedAt)) p.push("recordedAt ISO date required");
  if (!Array.isArray(m.dimensions)) return [...p, "dimensions must be an array"];
  const seen = new Set<string>();
  for (const d of m.dimensions) {
    const dim = d?.dimension;
    if (typeof dim !== "string" || !(dim in DOCS_GOLDEN_DIMENSION_VALUES)) p.push("unknown dimension: " + String(dim));
    if (typeof dim === "string") {
      if (seen.has(dim)) p.push("duplicate dimension: " + dim);
      seen.add(dim);
      if (d.status !== "covered" && d.status !== "deferred") p.push(dim + ": status must be covered|deferred");
      if (d.status === "deferred" && (!d.entryTrigger || !d.owner)) p.push(dim + ": deferred requires entryTrigger + owner");
      if (d.status === "covered" && typeof d.count !== "number") p.push(dim + ": covered requires count");
    }
  }
  for (const dim of DOCS_GOLDEN_DIMENSIONS) if (!seen.has(dim)) p.push("manifest missing dimension: " + dim);
  return p;
}

// Honesty contract: entries vs manifest vs the domain urlAllowlist.
export function crossCheckDocsGolden(set: DocsGoldenSet, manifest: CoverageManifest, allowlist: string[]): string[] {
  const p: string[] = [];
  const allow = new Set(allowlist);
  for (const e of set.entries) {
    // ADR-0062 (T4): the allowlist argument is the docs-domain one — cold-domain
    // entries own their allowlist via the fixture TOML in provenance.ref, so
    // the docs-allowlist subset check must not run against them.
    if (e.domain !== "docs") continue;
    for (const h of e.expected.mustHitHosts ?? []) {
      if (!allow.has(h)) p.push(e.id + ": mustHitHost " + h + " outside docs urlAllowlist");
    }
    for (const u of e.expected.mustHitUrls ?? []) {
      try {
        const host = new URL(u).hostname;
        if (!allow.has(host)) p.push(e.id + ": mustHitUrl host " + host + " outside allowlist");
      } catch {
        p.push(e.id + ": mustHitUrl unparseable: " + u);
      }
    }
  }
  const counts = new Map<string, number>();
  const classHist = new Map<string, Map<string, number>>();
  for (const e of set.entries) {
    for (const t of e.dimensions) {
      const sep = t.indexOf(":");
      const dim = t.slice(0, sep);
      const cls = t.slice(sep + 1);
      counts.set(dim, (counts.get(dim) ?? 0) + 1);
      const h = classHist.get(dim) ?? new Map<string, number>();
      h.set(cls, (h.get(cls) ?? 0) + 1);
      classHist.set(dim, h);
    }
  }
  for (const d of manifest.dimensions) {
    const n = counts.get(d.dimension) ?? 0;
    if (d.status === "covered" && n === 0) p.push(d.dimension + ": declared covered but no golden entry carries the tag");
    if (d.status === "covered" && d.count !== n) p.push(d.dimension + ": manifest count " + d.count + " != actual " + n);
    if (d.status === "deferred" && n > 0) p.push(d.dimension + ": declared deferred but " + n + " golden entries carry the tag");
    // R60-audit F3: declared class breakdown must match the actual tag histogram —
    // count alone staying right is not enough for an honesty artifact.
    if (d.status === "covered" && d.classes) {
      const h = classHist.get(d.dimension) ?? new Map<string, number>();
      for (const k of new Set([...Object.keys(d.classes), ...h.keys()])) {
        const declared = d.classes[k] ?? 0;
        const actual = h.get(k) ?? 0;
        if (declared !== actual) p.push(d.dimension + ": class '" + k + "' manifest " + declared + " != actual " + actual);
      }
    }
  }
  return p;
}
