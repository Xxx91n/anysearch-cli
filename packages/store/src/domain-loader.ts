// Domain Loader: thin parser adapter bridging smol-toml to domain-schema resolve/validate.
// decision 2: smol-toml parses TOML to JS object; resolve/validate handled by domain-schema.ts.
// atomcode research: smol-toml parse() returns JS object; deep-merge is NOT parser job (domain-schema.resolve does it).

import { parse as tomlParse } from "smol-toml";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, validate, type DomainSchema, type RawDomain } from "./domain-schema";
import { join, relative } from "node:path";
import { ANS_DOMAINS_DIR_NAME, ansProjectDomainsDir, findRepoCheckoutRoot, isPathInside } from "./ans-paths.js";

// Parse a TOML string into a RawDomain object.
export function parseDomainToml(toml: string): RawDomain {
  const obj = tomlParse(toml) as Partial<RawDomain>;
  return {
    name: obj.name,
    description: obj.description,
    base: obj.base,
    settings: obj.settings,
    prompts: obj.prompts,
    skills: obj.skills,
    sources: obj.sources,
    rag: obj.rag,
    hooks: obj.hooks,
    compaction: obj.compaction,
    budget: obj.budget,
  };
}

// Load a domain from a TOML file. No inheritance chain (base = undefined or not found).
// ponytail: thinnest loader - read, parse, return RawDomain. resolve/validate is caller job.
// #167: file exists but parse fails is a configuration error (fail-fast), same
// family as `Domain schema:` validation faults. readFileSync IO errors
// (ENOENT/EACCES) and `Domain not found` keep the availability fallback —
// absent ≠ broken — so only the TOML parse fault is wrapped with the
// fail-fast marker and file-path context.
export function loadRawDomain(tomlPath: string): RawDomain {
  const content = readFileSync(tomlPath, "utf8");
  try {
    return parseDomainToml(content);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.startsWith("Domain schema:")) throw e as Error;
    throw new Error("Domain schema: " + msg + " (" + tomlPath + ")");
  }
}

// Helper for parent lookup: missing file -> undefined (try next dir), any other fault (parse / EACCES) -> throw.
// Centralizes the ENOENT-vs-other distinction so callers do not match on error.message.
export function tryLoadRawDomain(path: string): RawDomain | undefined {
  try {
    return loadRawDomain(path);
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code === "ENOENT") return undefined;
    throw e;
  }
}

// Load a domain from TOML with optional inheritance chain resolution.
// lookup: base domain name -> RawDomain or undefined (caller provides file-based lookup).
export function loadDomain(
  tomlPath: string,
  lookup?: (name: string) => RawDomain | undefined,
): DomainSchema {
  const raw = loadRawDomain(tomlPath);
  const lookupFn = lookup ?? (() => undefined);
  const schema = resolve(raw, lookupFn);
  validate(schema);
  return schema;
}

// Load a domain TOML string (for testing or in-memory configs).
export function loadDomainFromString(
  toml: string,
  lookup?: (name: string) => RawDomain | undefined,
): DomainSchema {
  const raw = parseDomainToml(toml);
  const lookupFn = lookup ?? (() => undefined);
  const schema = resolve(raw, lookupFn);
  validate(schema);
  return schema;
}

// decision 4A: load domain from convention directory domains/<name>.toml.
// Returns DomainSchema; callers treat it as DomainConfigPort (structurally compatible).

export function loadDomainByName(
  name: string,
  baseDir: string = process.cwd(),
  lookup?: (name: string) => RawDomain | undefined,
): DomainSchema {
  const tomlPath = join(baseDir, ANS_DOMAINS_DIR_NAME, name + ".toml");
  if (!existsSync(tomlPath)) {
    const dir = join(baseDir, ANS_DOMAINS_DIR_NAME);
    let available = "";
    try {
      available = readdirSync(dir)
        .filter((f: string) => f.endsWith(".toml"))
        .map((f: string) => f.replace(/\.toml$/, ""))
        .join(", ");
    } catch { /* dir not found */ }
    throw new Error("Domain not found: " + name + (available ? " (available: " + available + ")" : ""));
  }
  // #167/CodeRabbit: file-based parent lookup so a valid child with an existing
  // base resolves via the same convention dir instead of being treated as
  // "Base domain not found". Caller-provided lookup wins; file fallback preserves
  // the missing-base error when no parent file exists.
  const effectiveLookup = (parent: string): RawDomain | undefined => {
    if (lookup) {
      const fromCaller = lookup(parent);
      if (fromCaller !== undefined) return fromCaller;
    }
    const parentPath = join(baseDir, ANS_DOMAINS_DIR_NAME, parent + ".toml");
    return tryLoadRawDomain(parentPath);
  };
  return loadDomain(tomlPath, effectiveLookup);
}

// B1: domains-dir resolution chain. Each entry IS a domains directory
// (contains <name>.toml directly). Lets an installed CLI find the builtin
// domains shipped inside the package while CWD stays the first-class override.
export function loadDomainByNameIn(
  name: string,
  domainsDirs: string[],
  lookup?: (name: string) => RawDomain | undefined,
): DomainSchema {
  const seen = new Set<string>();
  for (const dir of domainsDirs) {
    const tomlPath = join(dir, name + ".toml");
    if (seen.has(tomlPath)) continue;
    seen.add(tomlPath);
    if (existsSync(tomlPath)) {
      // #167/CodeRabbit: wire file-based parent lookup through the same
      // domains-dir chain so createEngine can resolve inheritance from disk.
      // Preserve the existing "Base domain not found" error when the file
      // lookup confirms no parent exists.
      const effectiveLookup = (parent: string): RawDomain | undefined => {
        if (lookup) {
          const fromCaller = lookup(parent);
          if (fromCaller !== undefined) return fromCaller;
        }
        for (const d of domainsDirs) {
          const candidate = join(d, parent + ".toml");
          const raw = tryLoadRawDomain(candidate);
          if (raw) return raw;
        }
        return undefined;
      };
      return loadDomain(tomlPath, effectiveLookup);
    }
  }
  const all = domainsDirs.flatMap((dir) => {
    try {
      return readdirSync(dir).filter((x: string) => x.endsWith(".toml"));
    } catch {
      return [] as string[];
    }
  });
  const available = [...new Set(all.map((x) => x.replace(/\.toml$/, "")))].join(", ");
  throw new Error("Domain not found: " + name + (available ? " (available: " + available + ")" : ""));
}

// Default domains-dir chain head: ANS_DOMAINS_DIR (a directory containing tomls
// directly), then the CWD convention dir. Callers with package-shipped or
// repo-root fallback dirs append them after this list (see hostDomainsDirs) —
// the env → cwd head order is the single shared contract.
export function defaultDomainsDirs(env: NodeJS.ProcessEnv = process.env): string[] {
  const dirs: string[] = [];
  if (env.ANS_DOMAINS_DIR?.trim()) dirs.push(env.ANS_DOMAINS_DIR.trim());
  dirs.push(ansProjectDomainsDir());
  return dirs;
}

// The tail shared by every package host (CLI and MCP). In a source checkout the
// committed repo-root domains/ is the source of truth and comes before the
// build-generated package copy, so editing a root TOML is visible without a
// rebuild. An installed package has no repo markers and uses its own copy.
// The walk-up handles the bundled `ans mcp` entry (<repo>/apps/cli/mcp/dist) as
// well as apps/*/src and apps/*/dist.
export function hostDomainsDirs(self: string, env: NodeJS.ProcessEnv = process.env): string[] {
  const dirs = defaultDomainsDirs(env);
  const repoRoot = findRepoCheckoutRoot(self);
  if (repoRoot) {
    // Only the two package build copies are generated. A user project created
    // inside the checkout keeps its own <cwd>/domains; remove just apps/cli or
    // apps/mcp. Leave <cwd>/.ans/domains alone either way.
    const cwd = process.cwd();
    const cwdDomains = ansProjectDomainsDir(cwd);
    const rel = isPathInside(cwd, repoRoot) ? relative(repoRoot, cwd) : undefined;
    const isBuildCopyCwd = rel === join("apps", "cli") || rel === join("apps", "mcp");
    if (isBuildCopyCwd && cwdDomains === join(cwd, ANS_DOMAINS_DIR_NAME)) {
      // lastIndexOf skips an identical ANS_DOMAINS_DIR entry at the chain head.
      const at = dirs.lastIndexOf(cwdDomains);
      if (at >= 0) dirs.splice(at, 1);
    }
    if (existsSync(join(repoRoot, ANS_DOMAINS_DIR_NAME))) dirs.push(join(repoRoot, ANS_DOMAINS_DIR_NAME));
  }
  dirs.push(join(self, "..", ANS_DOMAINS_DIR_NAME));
  return dirs;
}

// List <name>.toml files discoverable on a domains-dir chain, first dir wins.
// Shared by `ans domain` and `doctor [5]` so listing semantics can't drift.
export function listDomainTomls(domainsDirs: string[]): Map<string, string> {
  const found = new Map<string, string>();
  for (const dir of domainsDirs) {
    try {
      for (const f of readdirSync(dir)) {
        if (f.endsWith(".toml") && !found.has(f)) found.set(f, dir);
      }
    } catch { /* dir absent on this chain link */ }
  }
  return found;
}
