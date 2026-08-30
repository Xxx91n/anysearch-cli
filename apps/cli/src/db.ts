// Shared helper: engine backed by the durable anysearch DB (ADR-0037 D6).
// ANS_DB_PATH overrides; default ~/.anysearch/anysearch.db via kernel resolveDbPath.
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createEngine, resolveDbPath, type CompositionResult } from "@anysearch/kernel";

export function createPersistentEngine(domain?: string): CompositionResult {
  const dbPath = resolveDbPath();
  mkdirSync(dirname(dbPath), { recursive: true });
  return createEngine(domain, { dbPath });
}
