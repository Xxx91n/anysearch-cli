// R64 T3: apply promote rulings via the ledger API (never hand-edits — the
// ratchet requires flag/record consistency), and mark watch:true on the golden
// entries that showed a flip this round (post-promote observation per D-004/D-005).
// Run: node --import tsx .scratch/grill-round-64/evidence/promote.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readQuarantine, writeQuarantine, promoteEntry } from "../../../packages/store/src/eval/quarantine-ledger.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..");
const NOW = new Date().toISOString();
const EV = ".scratch/grill-round-64/evidence/evidence.log (runs 02-09, post-migration)";

const qPath = join(root, "packages", "store", "eval-quarantine.json");
const looksPath = join(root, "eval-looks.json");

const notes = {
  "docs-g0001": "promote: stable tier, 3/3 green post leg re-anchor (2026-07-28 streamable-http frozen snapshot); earlier 2025-06-18 leg rotated out — watch:true armed",
  "docs-g0002": "promote: stable tier, 8/8 green post-migration; mustHitPaths /settings tolerate locale+version verified live",
  "docs-g0003": "promote: stable tier, 8/8 green post-migration",
  "docs-g0004": "promote: flaky tier, 8 runs flip=0 (bar: >=5 runs flip<0.2); watch:true armed per D-004",
  "docs-g0005": "promote: stable tier, 7/8 green; one transient abstain flip (run-07) — watch:true armed",
  "docs-g0006": "promote: flaky tier, 8 runs flip=0; watch:true armed per D-004",
  "docs-g0008": "promote: host-downgrade, 8/8 green after mustHitHosts->[pnpm.io] (failure_class locale-clustering-suppressed-cross-host)",
  "docs-g0009": "promote: flaky tier, 8 runs flip=0; watch:true armed per D-004",
  "docs-g0010": "promote: re-spec fallback path taken — live answers resumed (8/8 green on /deprecated family + frozen 2024-11-05 leg); merged into mustHitPaths cluster per D-003; watch:true armed post-audit (F4: leg flipped in audit window)",
  "docs-g0011": "promote: stable tier, 8/8 green post-migration",
};
// docs-g0010 watch added post-audit (F4 rework): its frozen-spec leg
// flipped fail,fail,pass inside the audit window — same rotation-risk
// class that motivated watch on the flaky three.
const WATCH = new Set(["docs-g0001", "docs-g0004", "docs-g0005", "docs-g0006", "docs-g0009", "docs-g0010"]);

let q = readQuarantine(qPath);
const before = q.entries.length;
for (const [id, note] of Object.entries(notes)) {
  q = promoteEntry(q, id, NOW, note + " | evidence: " + EV);
}
writeQuarantine(qPath, q);

const looks = JSON.parse(readFileSync(looksPath, "utf8"));
for (const e of looks.golden.entries) if (WATCH.has(e.id)) e.watch = true;
writeFileSync(looksPath, JSON.stringify(looks, null, 2) + "\n", "utf8");

const after = readQuarantine(qPath);
console.log("promoted", before - after.entries.length, "entries; ledger now", after.entries.length);
console.log("watch marked:", looks.golden.entries.filter(e => e.watch === true).map(e => e.id).join(", "));
