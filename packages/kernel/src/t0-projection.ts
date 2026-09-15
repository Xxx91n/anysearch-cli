// ADR-0024 D2/D6/D7: T0 MEMORY.md projection writer.
// Single source of truth is t0_preferences table; MEMORY.md is a regenerated
// materialized projection (temp+fsync+rename). Never reverse-syncs.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { SessionStorePort } from "./ports";
import type { T0PreferenceRow } from "@anysearch-cli/store";

const MAX_CHARS = 1500;
const MAX_LINES = 200;

// Key-level override merge (ADR-0024 D6): project wins same-key; distinct keys merge.
// Deterministic order: alphabetical by key after merge.
export function keyOverrideMerge(
  rows: T0PreferenceRow[],
  projectScope?: string,
): T0PreferenceRow[] {
  const merged = new Map<string, T0PreferenceRow>();
  // Lower-precedence scope first, higher-precedence later.
  const sorted = [...rows].sort((a, b) => {
    const aIsGlobal = a.scope === "global";
    const bIsGlobal = b.scope === "global";
    if (aIsGlobal === bIsGlobal) return a.key.localeCompare(b.key);
    return aIsGlobal ? -1 : 1; // global before project
  });
  for (const r of sorted) merged.set(r.key, r);
  return Array.from(merged.values()).sort((a, b) => a.key.localeCompare(b.key));
}

// Render merged projection text. Caps enforced: MAX_CHARS chars AND MAX_LINES lines,
// whichever hits first. Overflow -> explicit warn: true (never silent truncate).
export function renderMerged(
  rows: T0PreferenceRow[],
  projectScope?: string,
): { text: string; warned: boolean } {
  const merged = keyOverrideMerge(rows, projectScope);
  const scopeLabel = projectScope ? "project" : "global";
  const lines: string[] = [
    "<!-- ADR-0024: regenerated materialized projection; do not edit manually. Scope: " + scopeLabel + " -->",
  ];
  let totalChars = 0;
  let totalLines = 1;
  let warned = false;
  for (const r of merged) {
    const line = "- **" + r.key + "**: " + r.value;
    if (totalLines + 1 > MAX_LINES || totalChars + line.length > MAX_CHARS) {
      warned = true;
      break;
    }
    lines.push(line);
    totalChars += line.length;
    totalLines++;
  }
  if (warned) {
    lines.push(
      "<!-- WARNING: cap reached (" + MAX_CHARS + " chars / " + MAX_LINES + " lines). " +
      "Overflow entries remain in t0_preferences table. -->",
    );
  }
  return { text: lines.join("\n"), warned };
}

// Write single merged MEMORY.md (FSync + rename). Fail-open on FS errors.
export async function writeProjection(
  store: SessionStorePort,
  projectScope?: string,
): Promise<{ path: string; warned: boolean }[]> {
  const globalDir = path.join(os.homedir(), ".anysearch");
  const projectDir = path.join(process.cwd(), ".anysearch");
  const results: { path: string; warned: boolean }[] = [];

  let rows: T0PreferenceRow[];
  try {
    rows = await store.listPreferences(projectScope);
  } catch {
    return results; // DB failure: fail-open, return empty
  }

  const merged = renderMerged(rows, projectScope);
  const hasProject = rows.some((r) => r.scope !== "global");

  // Project scope file (only when project rows exist — no auto-creation per ADR-0024 D6).
  if (projectScope && hasProject) {
    try {
      const projPath = path.join(projectDir, "MEMORY.md");
      atomicWrite(projPath, merged.text);
      results.push({ path: projPath, warned: merged.warned });
    } catch (e) {
      // Fail-open: log to stderr, continue.
      process.stderr.write("[anysearch] project MEMORY.md write failed: " + String(e instanceof Error ? e.message : e) + "\n");
    }
  }

  // Global file (always written when any rows exist).
  try {
    const globalPath = path.join(globalDir, "MEMORY.md");
    atomicWrite(globalPath, merged.text);
    results.push({ path: globalPath, warned: merged.warned });
  } catch (e) {
    process.stderr.write("[anysearch] global MEMORY.md write failed: " + String(e instanceof Error ? e.message : e) + "\n");
  }

  return results;
}

// atomicWrite: temp -> fsync -> rename. Prevents partial-write crash from leaving truncated file.
function atomicWrite(filePath: string, content: string): void {
  const tmp = filePath + ".tmp";
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const fd = fs.openSync(tmp, "w");
  try {
    fs.writeSync(fd, Buffer.from(content, "utf8"));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, filePath);
}
