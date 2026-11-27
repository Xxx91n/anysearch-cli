// The docs golden corpus lives in eval-golden.json. Bad input throws instead
// of returning an empty set, so a broken file fails the run instead of SKIPping.
import { readFileSync } from "node:fs";
import {
  GOLDEN_SCOPE_VALUES,
  validateDocsGoldenSet,
  type DocsGoldenSet,
  type GoldenScope,
} from "./docs-golden";

export const GOLDEN_FILE = "eval-golden.json";

export function isLiveScope(scope: unknown): scope is GoldenScope {
  return scope === "live" || scope === "both";
}

export function isStubScope(scope: unknown): scope is GoldenScope {
  return scope === "stub" || scope === "both";
}

// scopes is the entry-id -> stub|live|both sidecar map; it travels with the
// corpus because the executors read both in one pass.
export type GoldenFile = DocsGoldenSet & { scopes: Record<string, GoldenScope> };

export function readGoldenFile(file: string): GoldenFile {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    throw new Error("eval-golden: cannot read " + file + ": " + (e.code ?? e.message));
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error("eval-golden: invalid JSON in " + file + ": " + (err as Error).message);
  }
  const problems = validateDocsGoldenSet(parsed);
  if (problems.length > 0) {
    throw new Error("eval-golden: " + problems.join("; ") + " in " + file);
  }
  const f = parsed as GoldenFile;
  if (f.entries.length === 0) throw new Error("eval-golden: entries must not be empty in " + file);
  if (!f.scopes || typeof f.scopes !== "object" || Array.isArray(f.scopes)) {
    throw new Error("eval-golden: scopes must be an object in " + file);
  }
  if (Object.keys(f.scopes).length === 0) throw new Error("eval-golden: scopes must not be empty in " + file);
  const entryIds = new Set(f.entries.map((entry) => entry.id));
  for (const [id, scope] of Object.entries(f.scopes)) {
    if (!GOLDEN_SCOPE_VALUES.includes(scope)) {
      throw new Error("eval-golden: scope for " + id + " must be one of " + GOLDEN_SCOPE_VALUES.join("/") + " in " + file + " (got " + String(scope) + ")");
    }
  }
  for (const entry of f.entries) {
    const hasScope = Object.prototype.hasOwnProperty.call(f.scopes, entry.id);
    if (entry.tombstone !== undefined) {
      if (hasScope) throw new Error("eval-golden: tombstoned entry " + entry.id + " must not carry a scope in " + file);
    } else if (!hasScope) {
      throw new Error("eval-golden: entry " + entry.id + " has no scope in " + file);
    }
  }
  for (const id of Object.keys(f.scopes)) {
    if (!entryIds.has(id)) throw new Error("eval-golden: scope for unknown entry " + id + " in " + file);
  }
  return f;
}
