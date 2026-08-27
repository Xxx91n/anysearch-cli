// ADR-0029 D1: judge-vs-human calibration holdout, physically separate from GOLDEN_CASES.
// Schema anysearch/calibration-set@1. 30 cases, stratified across the six golden failure-mode
// groups, negative-biased for kappa/AC1 prevalence stability.
// humanRelevant starts null — labels are filled from accumulated real query samples
// (ADR-0029 "explicitly not done": annotation depends on real usage stream). eval-calibrate.mjs
// exits 2 until >= 30 labels exist. NEVER merged into the golden gate (D3).
import { createHash } from "node:crypto";

export const CALIBRATION_GROUPS = ["supersession", "temporal", "secret", "cprime", "quarantine", "stale_topk"] as const;
export type CalibrationGroup = (typeof CALIBRATION_GROUPS)[number];

export interface CalibrationCase {
  id: string;
  group: CalibrationGroup;
  query: string;
  resultTitle: string;
  resultSnippet: string;
  // ponytail: null = unlabeled; labeling flow fills 0/1 from real usage (ADR-0029 D1).
  humanRelevant: 0 | 1 | null;
}

// Human-facing annotation rubric (the JUDGE rubric whose hash is snapshotted lives in
// scripts/eval-judge.mjs as RUBRIC; both belong to the ADR-0029 D4 sixtuple story).
export const CALIBRATION_RUBRIC =
  "Relevant (1): the title+snippet plausibly answers or supports the query within the session-memory domain. " +
  "Irrelevant (0): off-topic, contradicted/stale presented as current, or only tangential topic overlap. Judge strictly.";

const cc = (group: CalibrationGroup, n: number, query: string, resultTitle: string, resultSnippet: string, humanRelevant: 0 | 1 | null = null): CalibrationCase =>
  ({ id: "cal_" + group + "_" + n, group, query, resultTitle, resultSnippet, humanRelevant });

// 6 groups x 5 cases = 30; ~18 designed-off-topic (negative-biased) by content.
// Labels intentionally null this round; intent is encoded in snippet wording.
export const CALIBRATION_CASES: CalibrationCase[] = [
  cc("supersession", 1, "pnpm frozen lockfile flag", "pnpm install --frozen-lockfile reference", "disables lockfile writes and fails on mismatch; the flag for CI reproducibility"),
  cc("supersession", 2, "pnpm frozen lockfile flag", "npm ci clean install", "npm ci installs from package-lock.json reproducibly without modifying it"),
  cc("supersession", 3, "user prefers darkmode theme", "prefer lightmode theme", "user prefers lightmode ui theme (supersedes earlier darkmode preference)"),
  cc("supersession", 4, "user prefers darkmode theme", "history of dark mode ui", "survey of dark mode adoption in operating systems 2019-2024"),
  cc("supersession", 5, "apidocs current reference", "apidocs v2 reference", "apidocs v2 is the current reference; v1 closed"),
  cc("temporal", 1, "holiday schedule 2026", "company holiday schedule 2026", "official 2026 holiday schedule published jan 2026"),
  cc("temporal", 2, "holiday schedule 2026", "company holiday schedule 2024", "official 2024 holiday schedule archive page"),
  cc("temporal", 3, "latest pnpm release notes", "pnpm 11.24.0 release notes", "release notes for pnpm 11.24.0, current pinned version"),
  cc("temporal", 4, "latest pnpm release notes", "pnpm 9.12.0 release notes", "release notes for the older pnpm 9.12.0 line"),
  cc("temporal", 5, "q2 revenue figures", "q2 2026 revenue report", "q2 2026 revenue with segment breakdown"),
  cc("secret", 1, "judge api endpoint url", "JUDGE_BASE_URL configuration", "local judge runs at JUDGE_BASE_URL http://127.0.0.1:20128/v1"),
  cc("secret", 2, "api key value for judge", "sample api key sk-EXAMPLE-0000", "the literal api key is sk-EXAMPLE... (real secret material)"),
  cc("secret", 3, "rotate service credentials", "credential rotation runbook", "how to rotate service credentials quarterly without downtime"),
  cc("secret", 4, "database password", "postgres password best practices", "guidelines for choosing strong database passwords"),
  cc("secret", 5, "openai api key leak check", "gitleaks secret scanning setup", "scan repos for leaked keys such as sk- prefixed tokens"),
  cc("cprime", 1, "user said prefer pnpm twice", "promoted preference: pnpm over npm", "c-prime promote: explicit repeated preference promoted to durable tier"),
  cc("cprime", 2, "user said prefer pnpm", "pnpm vs npm benchmark", "benchmark comparison of install speed between pnpm and npm"),
  cc("cprime", 3, "stash timeout preference", "stash operation timeout config", "stash operation should use 600s timeout per user statement"),
  cc("cprime", 4, "override merge semantics", "key-level override merge docs", "project config wins over user config on identical keys"),
  cc("cprime", 5, "promote threshold value", "c-prime promote gate", "promotion requires explicit or repeated correction evidence"),
  cc("quarantine", 1, "t0 preference cap overflow", "preference list cap exceeded", "when preference list exceeds cap, overflow entries go to quarantine for review"),
  cc("quarantine", 2, "deepseek hallucination rating", "deepseek model card", "model capabilities and known hallucination behavior of deepseekpro"),
  cc("quarantine", 3, "repair corrupted config json", "json schema validation errors", "common causes of corrupted config files and repair steps"),
  cc("quarantine", 4, "security update kb50426", "windows update history", "list of security updates and known issues"),
  cc("quarantine", 5, "resolve quarantine keep or drop", "quarantine review cli", "ansctl review lets the operator keep or drop quarantined entries"),
  cc("stale_topk", 1, "bundled sqlite prebuild download", "better-sqlite3 prebuilds on github", "prebuilt binaries per platform including win32-x64 are attached to github releases"),
  cc("stale_topk", 2, "bundled sqlite prebuild", "build sqlite from source tutorial", "how to compile sqlite3 from source with custom flags"),
  cc("stale_topk", 3, "fts5 snippet function columns", "sqlite fts5 snippet() reference", "snippet() auxiliary function selects best matching column for display"),
  cc("stale_topk", 4, "eval baseline fingerprint", "golden dataset fingerprint sha1", "eval-baseline.json pins dataset fingerprint; drift requires calibrate"),
  cc("stale_topk", 5, "turbo check workspace graph", "turborepo pipeline config", "turbo.json defines check/test tasks across workspace packages"),
];

export function calibrationHash(cases: CalibrationCase[]): string {
  const canon = cases.map((c) => [c.id, c.query, c.resultTitle, c.resultSnippet, c.humanRelevant ?? ""].join(" ")).join("\n");
  return createHash("sha1").update(canon).digest("hex").slice(0, 16);
}

export const CALIBRATION_SET = {
  schema: "anysearch/calibration-set@1" as const,
  rubric: CALIBRATION_RUBRIC,
  fingerprint: calibrationHash(CALIBRATION_CASES), // hash of the frozen case content (labels null); labeled runs re-hash on the fly
  annotators: [] as string[], // ADR-0029 D4 snapshot "annotator"; filled by the labeling flow
  annotatedAt: null as string | null, // ADR-0029 D4 snapshot "annotatedAt"
  cases: CALIBRATION_CASES,
};
