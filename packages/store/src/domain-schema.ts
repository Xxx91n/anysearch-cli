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
}

export interface PromptEntry {
  name: string;
  content: string;
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
}