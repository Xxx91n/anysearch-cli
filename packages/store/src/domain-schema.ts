// Domain Schema: typed Active Domain TOML model.
// Deep-merge semantics transplanted from cc-persona (persona.rs):
// [settings] = recursive deep-merge (object keys逐键递归, scalars/arrays replaced)
// [prompts], [skills], [sources], [rag], [hooks] = entire section replace
// ref: atomcode-cc-persona-toml research,.

import { FUSION_REGISTRY } from "@anysearch-cli/retriever";

export interface DomainSchema {
  name: string;
  description?: string;
  base?: string; // inheritance chain, null = root
  settings: Record<string, unknown>;
  prompts: PromptEntry[];
  skills: { active: string[]; toolRequires?: Record<string, string[]> };
  sources: { enabled: string[]; weights?: Record<string, number>; urlAllowlist?: string[]; urlDenylist?: string[]; vertical?: { domain: string; sub_domain?: string } };
  rag: { adapter: string; config?: Record<string, unknown> };
  hooks: { toolWhitelist: string[] };
  compaction?: CompactionConfig;
  // #187: optional budget declaration. Absent section = no budget row =
  // unmetered (pass). Within a declared section, an absent cap means "no cap"
  // for that dimension — only an explicit 0 closes the dimension completely.
  budget?: BudgetConfig;
}

// #187: output-side static reserve default, measured against 43 real runs
// (output p95=9,309 / max=9,600). Re-measure when the per-call maxTokens grows
// to roughly 1.5x the window this default was calibrated on (R≈1.5×).
export const DEFAULT_OUTPUT_RESERVE_TOKENS = 12288;

// #187: [budget] TOML section. Caps are optional and independent; a missing
// field is "no cap" (the ledger row stores an unlimited sentinel), while an
// explicit 0 rejects every reserve. The output reserve is a runtime planning
// knob (consumed by the token-reserve ticket), not a ledger column, so it can
// override the code default without changing persisted caps.
export interface BudgetConfig {
  tokenCap?: number;
  usdCap?: number;
  callCap?: number;
  outputReserveTokens?: number;
}

export interface PromptEntry {
  name: string;
  content: string;
}

// compaction config for independent summary model.
// threshold injection — lowWatermark + reuseCap optional, defaults hard-pinned.
// lowWatermark: absolute token count (>= 50000) OR {fraction: number} in (0,1) of model window.
// reuseCap: consecutive REUSE cap before forcing COMPRESS.
export interface CompactionConfig {
  model?: string; // summary model id (default: cheap model e.g. deepseek-v4-fast)
  lowWatermark?: number | { fraction: number };
  reuseCap?: number;
}

// Raw TOML shape (before resolution/inheritance)
export interface RawDomain {
  name?: string;
  description?: string;
  base?: string;
  settings?: Record<string, unknown>;
  prompts?: PromptEntry[];
  skills?: { active?: string[]; toolRequires?: Record<string, string[]> };
  sources?: { enabled?: string[]; weights?: Record<string, number>; urlAllowlist?: string[]; urlDenylist?: string[]; vertical?: { domain: string; sub_domain?: string } };
  rag?: { adapter?: string; config?: Record<string, unknown> };
  hooks?: { toolWhitelist?: string[] };
  compaction?: CompactionConfig;
  budget?: BudgetConfig;
}

// Deep-merge two values. Objects merge recursively; everything else replaces.
function deepMerge<T>(base: T, override: T): T {
  if (
    base !== null &&
    override !== null &&
    typeof base === "object" &&
    typeof override === "object" &&
    !Array.isArray(base) &&
    !Array.isArray(override)
  ) {
    const result: Record<string, unknown> = { ...base as Record<string, unknown> };
    for (const key of Object.keys(override as Record<string, unknown>)) {
      const b = (base as Record<string, unknown>)[key];
      const o = (override as Record<string, unknown>)[key];
      if (b !== undefined) {
        result[key] = deepMerge(b, o);
      } else {
        result[key] = o;
      }
    }
    return result as T;
  }
  return override;
}

// Resolve a chain: derived -> base (cc-persona resolve() order).
// Walks the base chain, collects all ancestors (cycle detection),
// reverses to base-first, then merges eachDerived onto the accumulated result.
export function resolve(
  derived: RawDomain,
  lookup: (name: string) => RawDomain | undefined,
): DomainSchema {
  // Collect chain
  const chain: RawDomain[] = [derived];
  const visited = new Set<string>();
  let current: RawDomain | undefined = derived;
  while (current.base) {
    if (visited.has(current.base)) {
      throw new Error("Domain schema: Circular inheritance detected: " + current.base);
    }
    visited.add(current.base);
    const parent = lookup(current.base);
    if (!parent) {
      throw new Error("Domain schema: Base domain not found: " + current.base);
    }
    chain.push(parent);
    current = parent;
  }

  // Reverse: base first
  chain.reverse();

  // Merge settings recursively, replace sections for the rest.
  let settings: Record<string, unknown> = {};
  let prompts: PromptEntry[] = [];
  let skillsActive: string[] = [];
  let skillsToolRequires: Record<string, string[]> | undefined;
  let sourcesEnabled: string[] = [];
  let sourcesWeights: Record<string, number> | undefined;
  let sourcesUrlAllowlist: string[] | undefined;
  let sourcesUrlDenylist: string[] | undefined;
  let sourcesVertical: { domain: string; sub_domain?: string } | undefined;
  let ragAdapter = "";
  let ragConfig: Record<string, unknown> | undefined;
  let hooksWhitelist: string[] = [];
  let compaction: CompactionConfig | undefined;
  let budget: BudgetConfig | undefined;
  let name = "";
  let description: string | undefined;

  for (const d of chain) {
    // settings: recursive deep-merge
    if (d.settings) {
      settings = deepMerge(settings, d.settings);
    }
    // sections: entire replace (if declared)
    if (d.prompts) prompts = d.prompts;
    if (d.skills?.active) skillsActive = d.skills.active;
    // skills.toolRequires — section-replace like active (per-chain override).
    if (d.skills?.toolRequires) skillsToolRequires = d.skills.toolRequires;
    if (d.sources?.enabled) sourcesEnabled = d.sources.enabled;
    // sources.weights — section-replace semantics like enabled (per-chain override).
    if (d.sources?.weights) sourcesWeights = d.sources.weights;
    if (d.sources?.urlAllowlist) sourcesUrlAllowlist = d.sources.urlAllowlist;
    if (d.sources?.urlDenylist) sourcesUrlDenylist = d.sources.urlDenylist;
    // sources.vertical — section-replace like the other
    // sources fields (a derived TOML restates the whole vertical declaration).
    if (d.sources?.vertical) sourcesVertical = d.sources.vertical;
    if (d.rag?.adapter) { ragAdapter = d.rag.adapter; ragConfig = d.rag.config; }
    if (d.hooks?.toolWhitelist) hooksWhitelist = d.hooks.toolWhitelist;
    if (d.compaction) compaction = d.compaction;
    // budget — whole-section replace like compaction: a derived domain that
    // declares [budget] restates the full policy rather than inheriting caps
    // field-by-field (a partial child must not silently loosen a parent cap).
    if (d.budget) budget = d.budget;
    if (d.name) name = d.name;
    if (d.description) description = d.description;
  }

  return {
    name,
    description,
    settings,
    prompts,
    skills: { active: skillsActive, ...(skillsToolRequires ? { toolRequires: skillsToolRequires } : {}) },
    sources: { enabled: sourcesEnabled, ...(sourcesWeights ? { weights: sourcesWeights } : {}), ...(sourcesUrlAllowlist ? { urlAllowlist: sourcesUrlAllowlist } : {}), ...(sourcesUrlDenylist ? { urlDenylist: sourcesUrlDenylist } : {}), ...(sourcesVertical ? { vertical: sourcesVertical } : {}) },
    rag: { adapter: ragAdapter, config: ragConfig },
    hooks: { toolWhitelist: hooksWhitelist },
    compaction,
    budget,
  };
}

// entries are hostnames only — no scheme/port/wildcard. A malformed
// entry could never match a real host and would silently deaden allow/deny.
export const HOSTNAME_RE = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;

function assertHostnameList(list: unknown, field: string): void {
  if (!Array.isArray(list)) throw new Error("Domain schema: sources." + field + " must be an array of hostnames");
  const bad = list.filter((v) => typeof v !== "string" || !HOSTNAME_RE.test(v.trim().toLowerCase()));
  if (bad.length > 0) throw new Error("Domain schema: sources." + field + " entries must be hostnames (no scheme/port/wildcard); invalid: " + JSON.stringify(bad));
}

// #162/#167: single classifier for "the domain was found but its configuration is
// invalid". Callers use it to fail closed on a configured-but-broken domain
// while keeping the availability fallback for absent domains and IO faults.
// The "Domain schema:" marker is the fail-fast family raised by validate(),
// TOML parse (loadRawDomain wrapper), and inheritance (resolve) faults.
// Anchored at the start: an IO message that merely contains the text (e.g. in
// a file path) must stay on the availability fallback, not fail closed.
export function isDomainSchemaError(e: unknown): boolean {
  return e instanceof Error && e.message.startsWith("Domain schema:");
}

// Validate a resolved schema. Throws on invalid.

export function validate(schema: DomainSchema): void {
  if (!schema.name) throw new Error("Domain schema: name is required");
  if (!schema.rag.adapter) throw new Error("Domain schema: rag.adapter is required");
  if (!Array.isArray(schema.skills.active))
    throw new Error("Domain schema: skills.active must be an array");
  if (!Array.isArray(schema.sources.enabled))
    throw new Error("Domain schema: sources.enabled must be an array");
  // sources.weights — Record keyed by registered provider id; config errors
  // fail fast at load (provider runtime failures stay fail-open).
  const w = schema.sources.weights;
  if (w !== undefined) {
    if (typeof w !== "object" || w === null || Array.isArray(w))
      throw new Error("Domain schema: sources.weights must be a Record keyed by provider id");
    for (const [key, value] of Object.entries(w)) {
      if (!(key in FUSION_REGISTRY.weights.web))
        throw new Error("Domain schema: sources.weights unknown provider id " + JSON.stringify(key) + " (registered: " + Object.keys(FUSION_REGISTRY.weights.web).join(", ") + ")");
      if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
        throw new Error("Domain schema: sources.weights." + key + " must be a finite number > 0");
    }
  }
  if (schema.sources.urlAllowlist !== undefined) assertHostnameList(schema.sources.urlAllowlist, "urlAllowlist");
  // deny channel — first-class, evaluated last, never merged into allow.
  if (schema.sources.urlDenylist !== undefined) assertHostnameList(schema.sources.urlDenylist, "urlDenylist");
  // sources.vertical — shape check only. domain must be a
  // non-empty string; sub_domain when present must be a non-empty string. The
  // domain vocabulary itself stays upstream-owned (unknown values are NOT
  // rejected here — the provider isError + fail-first degrade handles them).
  // (draft): unknown keys inside sources.vertical are
  // fail-fast at load (aligned with the MCP schema rejection direction) — a
  // silently dropped key (e.g. a `params` subtable the TOML surface does not
  // carry) is exactly the malformed-silence class this rule exists to kill.
  const v = schema.sources.vertical;
  if (v !== undefined) {
    if (typeof v !== "object" || v === null || Array.isArray(v))
      throw new Error("Domain schema: sources.vertical must be a Record { domain, sub_domain? }");
    const unknownKeys = Object.keys(v as Record<string, unknown>).filter((k) => k !== "domain" && k !== "sub_domain");
    if (unknownKeys.length > 0)
      throw new Error("Domain schema: sources.vertical unknown key(s) " + unknownKeys.map((k) => JSON.stringify(k)).join(", ") + " — supported keys: domain, sub_domain (params live on query-level channels, not TOML)");
    if (typeof v.domain !== "string" || v.domain.trim().length === 0)
      throw new Error("Domain schema: sources.vertical.domain must be a non-empty string");
    if (v.sub_domain !== undefined && (typeof v.sub_domain !== "string" || v.sub_domain.trim().length === 0))
      throw new Error("Domain schema: sources.vertical.sub_domain must be a non-empty string when present");
  }
  if (!Array.isArray(schema.hooks.toolWhitelist))
    throw new Error("Domain schema: hooks.toolWhitelist must be an array");
  // skills.toolRequires — shape check: Record keyed by skill name, values are
  // tool-name arrays.
  // Design: the skill→tool mapping is declarative, not derived — pi-agent-core
  // Skill is a pure prompt carrier and carries no tool binding (#90).
  const tr = schema.skills.toolRequires;
  if (tr !== undefined) {
    if (typeof tr !== "object" || tr === null || Array.isArray(tr))
      throw new Error("Domain schema: skills.toolRequires must be a Record keyed by skill name");
    for (const [key, tools] of Object.entries(tr)) {
      if (key.trim().length === 0)
        throw new Error("Domain schema: skills.toolRequires keys must be non-empty skill names");
      if (!Array.isArray(tools))
        throw new Error("Domain schema: skills.toolRequires." + key + " must be an array of tool names");
      if (tools.some((t) => typeof t !== "string" || t.trim().length === 0))
        throw new Error("Domain schema: skills.toolRequires." + key + " entries must be non-empty tool names");
    }
  }
  // compaction guards — fail-fast on out-of-range.
  const c = schema.compaction;
  if (c) {
    if (c.lowWatermark !== undefined) {
      if (typeof c.lowWatermark === "number") {
        // #113/CodeRabbit #161: NaN/Infinity slipped through `< 50000` and were
        // only rejected inside the fail-open consolidate path, silently
        // disabling L0. Reject them here, matching scripts/validate-domains.mjs.
        if (!Number.isFinite(c.lowWatermark) || c.lowWatermark < 50000)
          throw new Error("Domain schema: compaction.lowWatermark must be >= 50000");
      } else if (c.lowWatermark === null || typeof c.lowWatermark !== "object") {
        throw new Error("Domain schema: compaction.lowWatermark must be a number or {fraction}");
      } else {
        const f = c.lowWatermark.fraction;
        if (typeof f !== "number" || !Number.isFinite(f) || !(f > 0 && f < 1))
          throw new Error("Domain schema: compaction.lowWatermark.fraction must be in (0,1)");
      }
    }
    if (c.reuseCap !== undefined && (typeof c.reuseCap !== "number" || c.reuseCap < 1))
      throw new Error("Domain schema: compaction.reuseCap must be >= 1");
  }
  // #187: [budget] shape. Unknown keys are fail-fast for the same reason as
  // sources.vertical: a silently dropped cap is a policy that never takes
  // effect. Missing caps are legal ("no cap"); explicit 0 is legal and means
  // "reject every reserve" — the two states must stay distinguishable.
  const b = schema.budget;
  if (b !== undefined) {
    if (typeof b !== "object" || b === null || Array.isArray(b))
      throw new Error("Domain schema: budget must be a table");
    const budgetKeys = ["tokenCap", "usdCap", "callCap", "outputReserveTokens"];
    const unknownBudgetKeys = Object.keys(b as Record<string, unknown>).filter((k) => !budgetKeys.includes(k));
    if (unknownBudgetKeys.length > 0)
      throw new Error("Domain schema: budget unknown key(s) " + unknownBudgetKeys.map((k) => JSON.stringify(k)).join(", ") + " — supported keys: " + budgetKeys.join(", "));
    for (const key of budgetKeys) {
      const value = (b as Record<string, unknown>)[key];
      if (value === undefined) continue;
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
        throw new Error("Domain schema: budget." + key + " must be a finite number >= 0");
      // token/call counts and the output reserve are integer quantities; a
      // fractional token cap would be silently truncated by SQLite and hide a
      // config mistake.
      if (key !== "usdCap" && !Number.isInteger(value))
        throw new Error("Domain schema: budget." + key + " must be an integer >= 0");
    }
  }
}