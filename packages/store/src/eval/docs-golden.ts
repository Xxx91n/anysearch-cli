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
export const DOCS_GOLDEN_PROVENANCE_TYPES = ["internal-dogfood", "external-community"] as const;
export const DOCS_GOLDEN_VERDICTS = ["answer", "abstain"] as const;

export interface DocsGoldenExpected {
  verdict: "answer" | "abstain";
  mustHitHosts?: string[];
  mustHitUrls?: string[];
  minResults?: number;
}
export interface DocsGoldenProvenance {
  type: "internal-dogfood" | "external-community";
  ref: string;         // repo path / .scratch path / external URL — always revisitable
  harvestedAt: string; // ISO date (YYYY-MM-DD)
}
export interface DocsGoldenEntry {
  id: string;
  domain: string;
  question: string;     // verbatim real question text — never synthetic (D-005)
  questionLang: "zh" | "en";
  intent: DocsGoldenIntent;
  expected: DocsGoldenExpected;
  dimensions: string[]; // "<dimension>:<value>" pairs from DOCS_GOLDEN_DIMENSION_VALUES
  provenance: DocsGoldenProvenance;
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

export function validateDocsGoldenEntry(raw: unknown): string[] {
  const p: string[] = [];
  const e = raw as Partial<DocsGoldenEntry> | undefined;
  if (!e || typeof e !== "object") return ["entry is not an object"];
  if (typeof e.id !== "string" || !/^docs-g\d{4}$/.test(e.id)) p.push("id must match docs-gNNNN");
  if (e.domain !== "docs") p.push('domain must be "docs"');
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
    if (exp.verdict === "abstain" && (exp.mustHitUrls?.length ?? 0) > 0) p.push("abstain entry must not assert mustHitUrls");
  }
  const tags = Array.isArray(e.dimensions) ? e.dimensions : [];
  if (tags.length === 0) {
    p.push("dimensions must be a non-empty string[]");
  } else {
    for (const d of tags) {
      const [dim, val] = String(d).split(":");
      const allowed = DOCS_GOLDEN_DIMENSION_VALUES[dim ?? ""];
      if (!allowed || !allowed.includes(val ?? "")) p.push("dimension tag outside vocabulary: " + d);
    }
    if (!tags.includes("intent:" + e.intent)) p.push("missing intent tag consistent with intent field");
    if (!tags.includes("lang:" + e.questionLang)) p.push("missing lang tag consistent with questionLang");
  }
  const prov = e.provenance as Partial<DocsGoldenProvenance> | undefined;
  if (!prov || typeof prov !== "object") {
    p.push("provenance block required");
  } else {
    if (!DOCS_GOLDEN_PROVENANCE_TYPES.includes(prov.type as "internal-dogfood")) p.push("provenance.type must be internal-dogfood|external-community");
    if (typeof prov.ref !== "string" || prov.ref.length < 4) p.push("provenance.ref required");
    if (prov.type === "external-community" && !/^https?:\/\//.test(prov.ref ?? "")) p.push("external-community ref must be a URL");
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
