// scripts/handoff-reanchor.mjs
// ADR-0101 (R100 T2-C): the mechanical post-land re-anchor. One-shot rewrite of
// a closeout's LIVE Stack declaration into the landed `Stack（dissolved @
// <date>）` variant — the exact transform the R99 closeout needed and the R98
// precedent established (capture values stay as historical prose; the land
// main SHA + a re-anchor comment are recorded).
//
// Usage:
//   node scripts/handoff-reanchor.mjs <closeout-path> [--date YYYY-MM-DD] [--main-sha <sha>]
//
// Defaults: --main-sha = `git rev-parse origin/main` (the landed tip);
// --date = committer date of that tip (the land date).
// The script refuses a doc with no live Stack line or an already-dissolved
// one, warns (never blocks) when the named branch still has an origin ref —
// the gate's own three-state lint verifies the dissolved claim at gate time.
//
// Node stdlib only (ADR-0020 D5). CLI module — an AST class-③ candidate by
// design; it is never namespace-injected.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseStackLine } from "./handoff-lint-verdict.mjs";

const args = process.argv.slice(2);
const rel = args[0];
function opt(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
}
if (!rel || args.includes("--help")) {
  console.log("usage: node scripts/handoff-reanchor.mjs <closeout-path> [--date YYYY-MM-DD] [--main-sha <sha>]");
  process.exit(rel ? 0 : 2);
}
const ROOT = process.cwd();
const file = path.resolve(ROOT, rel);
if (!fs.existsSync(file)) {
  console.error("handoff-reanchor: file missing: " + rel);
  process.exit(2);
}
const text = fs.readFileSync(file, "utf8");
const parsed = parseStackLine(text);
if (!parsed.present) {
  console.error("handoff-reanchor: no Stack line found in " + rel);
  process.exit(2);
}
if (parsed.dissolved) {
  console.log("handoff-reanchor: already dissolved @ " + parsed.dissolvedDate + " — nothing to do (" + rel + ")");
  process.exit(0);
}
const branch = parsed.branch;
if (!branch) {
  console.error("handoff-reanchor: Stack line names no branch — cannot derive the dissolved form");
  process.exit(2);
}
const mainSha = opt("--main-sha") ?? (spawnSync("git", ["rev-parse", "origin/main"], { cwd: ROOT, encoding: "utf8" }).stdout ?? "").trim() ?? "unresolved";
const landDate = opt("--date") ?? ((spawnSync("git", ["log", "-1", "--format=%cs", "origin/main"], { cwd: ROOT, encoding: "utf8" }).stdout ?? "").trim() || new Date().toISOString().slice(0, 10));
if (!/^\d{4}-\d{2}-\d{2}$/.test(landDate)) {
  console.error("handoff-reanchor: land date unresolved (use --date YYYY-MM-DD)");
  process.exit(2);
}
// Honesty probe (warn, never block): the dissolved claim asserts the named
// branch's origin ref is gone. If it still exists the rewrite would assert
// falsely — surface it loudly.
const refCheck = spawnSync("git", ["rev-parse", "--verify", "--quiet", "refs/remotes/origin/" + branch], { cwd: ROOT, encoding: "utf8" });
if (refCheck.status === 0) {
  console.error("handoff-reanchor: WARNING — origin/" + branch + " still resolves (" + String(refCheck.stdout).trim().slice(0, 12) + "); the dissolved claim will verify only after the ref is gone (land deletes it, or delete deliberately)");
}

const lines = text.split("\n");
const idx = lines.findIndex((l) => /^Stack（/.test(l));
const head = lines[idx];
const indent = head.match(/^\s*/)[0];
lines[idx] =
  indent +
  "Stack（dissolved @ " + landDate + "）—— 交付栈已 ff-land 上 origin/main（land @ " + String(mainSha).slice(0, 12) +
  "），但 ID/ref 随 land 注销，链留作历史定位：";
// The re-anchor comment must go AFTER the chain block — parseStackLine reads
// the first non-empty line after the header as the chain, so a comment in
// between would poison the parse (empirically: stack-line-missing).
let insertAt = idx + 1;
while (insertAt < lines.length && /^\s+\S/.test(lines[insertAt])) insertAt++;
lines.splice(insertAt, 0, indent + "<!-- re-anchor: " + landDate + " by scripts/handoff-reanchor.mjs — Stack 行改述为 dissolved 形态（land @ " + String(mainSha).slice(0, 12) + "）；capture 时值留作历史史料，dissolve claim 由 handoff-lint 门验 -->");
fs.writeFileSync(file, lines.join("\n"), "utf8");
console.log("handoff-reanchor: " + rel + " — Stack rewritten to dissolved @ " + landDate + " (land @ " + String(mainSha).slice(0, 12) + ", branch " + branch + ")");
