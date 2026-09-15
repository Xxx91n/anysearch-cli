// T0 projection caps + warning assertion (ADR-0024 D7).
// renderMerged enforces 1500 chars AND 200 lines hard caps; when exceeded, an
// explicit <!-- WARNING --> block must appear and `warned` flag must be true —
// silent truncation is a fail.

import { strict as assert } from "node:assert";
import { renderMerged, keyOverrideMerge } from "../src/t0-projection";
import type { T0PreferenceRow } from "@anysearch-cli/store";

let passed = 0;
let failed = 0;

function ok(label: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log(`  [ok] ${label}`); return; }
  failed++; console.error(`  [FAIL] ${label}${detail ? ` :: ${detail}` : ""}`);
}

const now = "2026-08-26T00:00:00.000Z";

function row(key: string, value: string, scope = "global"): T0PreferenceRow {
  return {
    key, value, scope,
    modified: now, lastAccessed: now,
    source: "explicit",
    invalidAt: null, demoteReason: null,
    correctionCount: 0, provenance: null,
  } as T0PreferenceRow;
}

// --- Scope merge: project wins on same key ---
{
  const rows = [row("color", "red", "global"), row("color", "blue", "proj-1")];
  const merged = keyOverrideMerge(rows, "proj-1");
  ok("keyOverrideMerge: project wins on same key",
    merged.length === 1 && merged[0]?.value === "blue",
    `got ${JSON.stringify(merged)}`);
}

// --- No cap pressure: warned=false, no WARNING marker ---
{
  const rows = [row("a", "1"), row("b", "2")];
  const r = renderMerged(rows, undefined);
  ok("under cap: warned=false", r.warned === false);
  ok("under cap: no WARNING marker", !r.text.includes("WARNING"));
  ok("under cap: contains both keys",
    r.text.includes("- **a**: 1") && r.text.includes("- **b**: 2"));
}

// --- 1500 char cap: explicit warning, no silent truncation ---
{
  // 30 keys * ~50 chars each ≈ 1500+.
  const rows = [];
  for (let i = 0; i < 30; i++) {
    rows.push(row(`k${i}`, "v".repeat(50)));
  }
  const r = renderMerged(rows, undefined);
  ok("char cap: warned=true", r.warned === true);
  ok("char cap: WARNING marker present", r.text.includes("WARNING"));
  ok("char cap: output does not silently drop content (marker cites cap)",
    r.text.includes("1500"));
}

// --- 200 line cap: explicit warning, no silent truncation ---
{
  const rows = [];
  for (let i = 0; i < 250; i++) rows.push(row(`k${i}`, "v"));
  const r = renderMerged(rows, undefined);
  ok("line cap: warned=true", r.warned === true);
  ok("line cap: WARNING marker present", r.text.includes("WARNING"));
  ok("line cap: marker cites 200", r.text.includes("200"));
}

console.log(`\npassed=${passed} failed=${failed}`);
if (failed > 0) process.exit(1);
