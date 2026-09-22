// scripts/closeout-coverage.mjs
// ADR-0077 (R76 T1 / D-002): closeout-coverage derivation for ship-gate step 1g
// leg-b. The "round is complete" signal is an ADR index registration — a
// `Grill Round N` row in docs/adr/index.md — not directory existence. The old
// fallback walked back to the newest dir WITH a closeout and silently masked a
// missing one (R70 F1: four rounds green on the previous round's doc).
//
// Fail-closed assertions (a checker that finds nothing to check is a failure):
//   (a) a registered round N >= floor without a closeout on disk -> red;
//   (b) the registered set and the completed-on-disk set drifting in either
//       direction -> red;
//   (c) an empty or unparseable derivation -> red.
// The single explicit exemption: the newest round dir may still be in flight
// (its ADR not yet registered) — that prints a structured line, never an
// implicit break. The field-lint surface is unchanged: only the newest dir
// WITH closeouts gets linted (bounds the gh-liveness cost).
// Node stdlib only (ADR-0020 D5).

import fs from "node:fs";
import path from "node:path";
import { BEGIN, END } from "./gen-adr-index.mjs";

// Rule birthday: the round this leg's ADR lands. Rounds < floor are
// grandfathered — an existence assertion does not reach back before the rule
// existed. The floor is an ADR-recorded constant; changing it takes an explicit
// review, not an edit here (ratchet-corruption guard).
export const CLOSEOUT_COVERAGE_FLOOR = 76;

// Closeout-shaped doc: the round-closeout naming convention `round-NN-*closeout*.md`
// under handoffs/; audit-only docs and next-round task books excluded (R69 T0
// shape tightened R76 rework F-2 — "closure"-suffixed docs like
// `2026-09-16-release-closure.md` must NOT count: a release-closure file
// masquerading as a round closeout is exactly the silent-mask path this leg
// exists to kill). Non-conventional names fail closed: registered round whose
// closeout is named off-convention reads as "no closeout" -> red.
export function isCloseoutName(name) {
  return /^round-\d+-.*closeout/i.test(name) && !/audit/i.test(name) && !/^next/i.test(name) && name.endsWith(".md");
}

const ROUND_DIR_RE = /^grill-round-(\d+)/i;

// Parse Grill Round N registrations out of the generated index block.
// Fail-loud on unknown line shapes — a parser that skips what it does not
// recognize degenerates into "everything is in flight" = permanent silence.
// Returns { rounds: Set<number>, problems: string[] }.
export function parseRegisteredRounds(indexText) {
  const problems = [];
  const rounds = new Set();
  const i = indexText.indexOf(BEGIN);
  const j = indexText.indexOf(END);
  if (i < 0 || j < 0 || j < i) {
    problems.push("docs/adr/index.md is missing the ADR-INDEX markers");
    return { rounds, problems };
  }
  const block = indexText.slice(i + BEGIN.length, j);
  for (const raw of block.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("The complete numbered record lives in")) continue;
    if (line === "| ADR | Title |") continue; // table header
    if (/^\|[\s-|]+\|$/.test(line)) continue; // separator row
    const row = line.match(/^\|\s*\[(\d{3,4})\]\(([^)\s]+)\)\s*\|(.*)\|\s*$/);
    if (!row) {
      problems.push("unparseable line in ADR index block: " + JSON.stringify(line.slice(0, 120)));
      continue;
    }
    const fileRound = (row[2].match(/grill-round-(\d+)/i) ?? [])[1];
    const titleRound = (row[3].match(/grill\s*round\s*(\d+)/i) ?? [])[1];
    if (fileRound && titleRound && Number(fileRound) !== Number(titleRound)) {
      problems.push("ADR " + row[1] + " registers conflicting round numbers (file=round " + fileRound + ", title=round " + titleRound + ")");
      continue;
    }
    const n = fileRound ?? titleRound;
    if (n === undefined) continue; // non-round ADR — known shape, contributes nothing
    const num = Number(n);
    if (rounds.has(num)) problems.push("Grill Round " + num + " is registered twice in the ADR index");
    rounds.add(num);
  }
  return { rounds, problems };
}

// Scan .scratch/grill-round-*/handoffs/ once; callers reuse the result for both
// the coverage assertions and the (unchanged) field-lint target selection.
export function scanRoundDirs(scratchDir) {
  if (!fs.existsSync(scratchDir)) return [];
  return fs.readdirSync(scratchDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && ROUND_DIR_RE.test(d.name))
    .map((d) => {
      const n = Number(d.name.match(ROUND_DIR_RE)[1]);
      const hd = path.join(scratchDir, d.name, "handoffs");
      const closeouts = fs.existsSync(hd) ? fs.readdirSync(hd).filter(isCloseoutName) : [];
      return { name: d.name, n, hasCloseout: closeouts.length > 0, closeouts };
    })
    .sort((a, b) => b.n - a.n);
}

// Cross-check the registered set against the on-disk dirs at or above floor.
// dirs = scanRoundDirs() output (sorted desc). Returns
// { problems, awaiting, registeredCount, completedCount }.
export function assessCloseoutCoverage({ dirs, indexText, floor = CLOSEOUT_COVERAGE_FLOOR }) {
  const problems = [];
  const parsed = parseRegisteredRounds(indexText);
  problems.push(...parsed.problems);
  if (parsed.problems.length === 0 && parsed.rounds.size === 0) {
    problems.push("derived zero Grill Round registrations from docs/adr/index.md — a gate with nothing to check is a failure (ADR-0077)");
  }
  const scoped = new Set([...parsed.rounds].filter((n) => n >= floor));
  const scopedDirs = dirs.filter((d) => d.n >= floor).sort((a, b) => b.n - a.n);
  // F-4 (R76 rework): a scoped-empty derivation — nothing registered and no
  // round dirs at or above floor — is a vacuous green; per this leg's own
  // doctrine ("nothing to check" = failure) it is red, not pass.
  if (parsed.problems.length === 0 && scoped.size === 0 && scopedDirs.length === 0) {
    problems.push("zero rounds in scope at floor " + floor + " (no registrations, no round dirs) — a coverage leg with nothing to check is a failure (ADR-0077)");
  }
  const latest = scopedDirs.length ? scopedDirs[0].n : null; // dirs sorted desc
  let awaiting = null;
  for (const d of scopedDirs) {
    const registered = scoped.has(d.n);
    if (registered && !d.hasCloseout) {
      problems.push("round " + d.n + ": registered in docs/adr/index.md but .scratch/" + d.name + "/handoffs/ has no closeout doc — write the closeout or remove the registration (registration means complete; ADR-0077)");
    } else if (!registered && d.hasCloseout) {
      problems.push("round " + d.n + ": closeout doc(s) on disk but no Grill Round " + d.n + " registration in docs/adr/index.md — index<->.scratch drift (ADR-0077)");
    } else if (!registered && d.n === latest) {
      awaiting = d.n; // in-flight exemption — printed by the caller, never silent
    } else if (!registered) {
      problems.push("round " + d.n + ": dir on disk is neither registered nor the in-flight latest — index<->.scratch drift (ADR-0077)");
    }
  }
  for (const n of scoped) {
    if (!scopedDirs.some((d) => d.n === n)) {
      problems.push("round " + n + ": registered in docs/adr/index.md but .scratch/grill-round-" + n + "/ does not exist — index<->.scratch drift (ADR-0077)");
    }
  }
  return { problems, awaiting, registeredCount: scoped.size, completedCount: scopedDirs.filter((d) => d.hasCloseout).length };
}
