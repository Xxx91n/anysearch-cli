// Domain Schema: typed Active Domain TOML model.
// Deep-merge semantics transplanted from cc-persona (persona.rs):
//   [settings] = recursive deep-merge (object keys逐键递归, scalars/arrays replaced)
//   [prompts], [skills], [sources], [rag], [hooks] = entire section replace
// ref: atomcode-cc-persona-toml research, ADR-0002.

export interface DomainSchema {
  name: string;
  description?: string;
  base?: string; // inheritance chain, null = root
  settings: Record<string, unknown>;
  prompts: PromptEntry[];
  skills: { active: string[] };
  sources: { enabled: string[] };
  rag: { adapter: string; config?: Record<string, unknown> };
  hooks: { toolWhitelist: string[] };
  compaction?: CompactionConfig;
}

export interface PromptEntry {
  name: string;
  content: string;
}

// ADR-0012 D7: compaction config for independent summary model.
// ADR-0021 D1: threshold injection — lowWatermark + reuseCap optional, defaults hard-pinned.
//   lowWatermark: absolute token count (>= 50000) OR {fraction: number} in (0,1) of model window.
//   reuseCap: consecutive REUSE cap before forcing COMPRESS.
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
  skills?: { active?: string[] };
  sources?: { enabled?: string[] };
  rag?: { adapter?: string; config?: Record<string, unknown> };
  hooks?: { toolWhitelist?: string[] };
  compaction?: CompactionConfig;
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
      throw new Error("Circular inheritance detected: " + current.base);
    }
    visited.add(current.base);
    const parent = lookup(current.base);
    if (!parent) {
      throw new Error("Base domain not found: " + current.base);
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
  let sourcesEnabled: string[] = [];
  let ragAdapter = "";
  let ragConfig: Record<string, unknown> | undefined;
  let hooksWhitelist: string[] = [];
  let compaction: CompactionConfig | undefined;
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
    if (d.sources?.enabled) sourcesEnabled = d.sources.enabled;
    if (d.rag?.adapter) { ragAdapter = d.rag.adapter; ragConfig = d.rag.config; }
    if (d.hooks?.toolWhitelist) hooksWhitelist = d.hooks.toolWhitelist;
    if (d.compaction) compaction = d.compaction;
    if (d.name) name = d.name;
    if (d.description) description = d.description;
  }

  return {
    name,
    description,
    settings,
    prompts,
    skills: { active: skillsActive },
    sources: { enabled: sourcesEnabled },
    rag: { adapter: ragAdapter, config: ragConfig },
    hooks: { toolWhitelist: hooksWhitelist },
    compaction,
  };
}

// Validate a resolved schema. Throws on invalid.
export function validate(schema: DomainSchema): void {
  if (!schema.name) throw new Error("Domain schema: name is required");
  if (!schema.rag.adapter) throw new Error("Domain schema: rag.adapter is required");
  if (!Array.isArray(schema.skills.active))
    throw new Error("Domain schema: skills.active must be an array");
  if (!Array.isArray(schema.sources.enabled))
    throw new Error("Domain schema: sources.enabled must be an array");
  if (!Array.isArray(schema.hooks.toolWhitelist))
    throw new Error("Domain schema: hooks.toolWhitelist must be an array");
  // ADR-0021 D1: compaction guards — fail-fast on out-of-range.
  const c = schema.compaction;
  if (c) {
    if (c.lowWatermark !== undefined) {
      if (typeof c.lowWatermark === "number") {
        if (c.lowWatermark < 50000)
          throw new Error("Domain schema: compaction.lowWatermark must be >= 50000");
      } else {
        const f = c.lowWatermark.fraction;
        if (typeof f !== "number" || !(f > 0 && f < 1))
          throw new Error("Domain schema: compaction.lowWatermark.fraction must be in (0,1)");
      }
    }
    if (c.reuseCap !== undefined && (typeof c.reuseCap !== "number" || c.reuseCap < 1))
      throw new Error("Domain schema: compaction.reuseCap must be >= 1");
  }
}