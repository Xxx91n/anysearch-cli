// Domain Loader: thin parser adapter bridging smol-toml to domain-schema resolve/validate.
// ADR-0005 decision 2: smol-toml parses TOML to JS object; resolve/validate handled by domain-schema.ts.
// atomcode research: smol-toml parse() returns JS object; deep-merge is NOT parser job (domain-schema.resolve does it).

import { parse as tomlParse } from "smol-toml";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, validate, type DomainSchema, type RawDomain } from "./domain-schema";
import { join } from "node:path";

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
  };
}

// Load a domain from a TOML file. No inheritance chain (base = undefined or not found).
// ponytail: thinnest loader - read, parse, return RawDomain. resolve/validate is caller job.
export function loadRawDomain(tomlPath: string): RawDomain {
  const content = readFileSync(tomlPath, "utf8");
  return parseDomainToml(content);
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

// ADR-0006 decision 4A: load domain from convention directory domains/<name>.toml.
// Returns DomainSchema; callers treat it as DomainConfigPort (structurally compatible).
const DOMAINS_DIR = "domains";

export function loadDomainByName(
  name: string,
  baseDir: string = process.cwd(),
  lookup?: (name: string) => RawDomain | undefined,
): DomainSchema {
  const tomlPath = join(baseDir, DOMAINS_DIR, name + ".toml");
  if (!existsSync(tomlPath)) {
    const dir = join(baseDir, DOMAINS_DIR);
    let available = "";
    try {
      available = readdirSync(dir)
        .filter((f: string) => f.endsWith(".toml"))
        .map((f: string) => f.replace(/\.toml$/, ""))
        .join(", ");
    } catch { /* dir not found */ }
    throw new Error("Domain not found: " + name + (available ? " (available: " + available + ")" : ""));
  }
  return loadDomain(tomlPath, lookup);
}

// ADR-0061 B1: domains-dir resolution chain. Each entry IS a domains directory
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
    if (existsSync(tomlPath)) return loadDomain(tomlPath, lookup);
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

// Default domains-dir chain: ANS_DOMAINS_DIR (a directory containing tomls
// directly), then the CWD convention dir.
export function defaultDomainsDirs(env: NodeJS.ProcessEnv = process.env): string[] {
  const dirs: string[] = [];
  if (env.ANS_DOMAINS_DIR?.trim()) dirs.push(env.ANS_DOMAINS_DIR.trim());
  dirs.push(join(process.cwd(), DOMAINS_DIR));
  return dirs;
}
