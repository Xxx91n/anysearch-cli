// The docs golden corpus lives in eval-golden.json. Bad input throws instead
// of returning an empty set, so a broken file fails the run instead of SKIPping.
import { readFileSync } from "node:fs";
import {
  GOLDEN_SCOPE_VALUES,
  validateDocsGoldenSet,
  type DocsGoldenSet,
  type GoldenScope,
} from "./docs-golden";

// Forwarded from the leaf for readers already on this module; the kernel stub
// test goes to eval/corpus-files on purpose, so it does not pull the reader in.
export { GOLDEN_FILE, isLiveScope, isStubScope } from "./corpus-files";

// GoldenFile is DocsGoldenSet plus the entry-id -> stub|live|both sidecar map;
// the executors read scopes and entries from the same document in one pass.
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
  // Read scopes as unknown: the type says GoldenScope, but the file is JSON a
  // person can edit, so the vocabulary check has to run on a widened value.
  const scopes: unknown = f.scopes;
  if (!scopes || typeof scopes !== "object" || Array.isArray(scopes)) {
    throw new Error("eval-golden: scopes must be an object in " + file);
  }
  if (Object.keys(scopes).length === 0) throw new Error("eval-golden: scopes must not be empty in " + file);
  const entryIds = new Set(f.entries.map((entry) => entry.id));
  for (const [id, scope] of Object.entries(scopes)) {
    if (!(GOLDEN_SCOPE_VALUES as readonly unknown[]).includes(scope)) {
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
