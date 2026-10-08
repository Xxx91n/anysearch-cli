// scripts/vocab-scan.mjs
// ADR-0100 D3/D4 (R99): the thin shell that enumerates the governed scan
// surface and drives the pure per-module vocabulary guard.
// ADR-0101 D6 (R100): the surface recurses (scripts/**/*.mjs — scripts/tau/
// subdir now in domain) and the closed exclusion list gains a static front
// gate: scripts/top-level-effects.mjs classifies each file WITHOUT executing
// it, adjudicating the three classes below.
//
// Enumeration is TWO-PHASE so the enumerator never executes a CLI:
//   1. STATIC pre-filter - read each file's text and collect its exported
//      `*_CODES` names. A module with zero such exports is never loaded.
//   2. NAMESPACE INJECTION - only the vocabulary-bearing modules (library
//      modules by nature) are loaded and handed to the pure guard.
// This is the "top-level zero-effect surface" discipline made mechanical: the
// enumerator executes a module ONLY when it actually carries a vocabulary. A
// blind `import()` of every scripts/*.mjs would run the CLIs (empirically:
// importing ship-gate.mjs runs the whole gate).
//
// The AST front gate classes (ADR-0101 D6):
//   ① codes ∧ top-level effects   -> `ast-top-level-effect` (RED): a governed
//      vocabulary module doing import-time work can never be namespace-
//      injected safely; it is also never injected here.
//   ② *_CODES export, non-literal initializer -> `ast-codes-unverifiable`
//      (RED): the vocabulary's existence cannot be statically proven.
//   ③ effects ∧ no codes          -> `ast-side-effect-candidate` (info): an
//      exclusion candidate, named in the result for the closed list to admit.
// An excluded path that grows `*_CODES` -> `ast-excluded-codes` (RED): an
// exclusion legitimizes side effects, never an unguarded vocabulary.
//
// Fail-closed (audit R99-1): an unreadable scripts/ dir is a FATAL finding, not
// an empty scan - a scan that cannot enumerate must never report ok:true.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { CODE_GROUPS, GOVERNED_MODULES } from "./vocab-registry.mjs";
import { unregisteredCodeExports } from "./handoff-lint-verdict.mjs";
import { classifyTopLevel } from "./top-level-effects.mjs";

const require = createRequire(import.meta.url);

// The closed exclusion list (ADR-0100 D3): file kinds that CANNOT be namespace-
// injected (no ESM namespace for .ts/.py here). Membership is by the criterion
// "cannot be namespace-injected", never by "is a fixture".
export const EXCLUDED_EXTENSIONS = Object.freeze([".ts", ".py"]);

// Named path exclusions (ADR-0101 D6): specific .mjs files that must never be
// namespace-injected. Membership is by the same criterion, evidence carried on
// the entry; the AST front gate is the admission adjudicator for new entries.
// Premiere entry: scripts/tau/tau-scan.mjs is a spawn launcher - importing it
// executes a child process (top-level `const child = spawn(...)` + `child.on`).
export const EXCLUDED_PATHS = Object.freeze([
  {
    path: "tau/tau-scan.mjs",
    reason: "cannot be namespace-injected: top-level `child = spawn(...)` and `child.on(\"close\")` mean importing it executes a child process at load time",
    since: "2026-10-08",
  },
]);

// Closed vocabulary of the AST front-gate finding names (ADR-0101 D6). Emitted
// as findings[].name, not as governed *_CODES exports, so they live here — a
// frozen set the e2e R4 coverage leg can lock against (no free-form drift).
// Named without a _CODES suffix: this is a code-name MAP, not a governed
// vocabulary, so the scan's own `export const X_CODES` detector must not match it.
export const AST_FINDING_NAMES = Object.freeze({
  topLevelEffect: "ast-top-level-effect",
  codesUnverifiable: "ast-codes-unverifiable",
  excludedCodes: "ast-excluded-codes",
});

// The one error-text formatter (audit R99-2 dedup): scan and probe share it so a
// failure-detail shape can never drift between the two call sites.
export function errText(e) {
  return String(e && e.message ? e.message : e);
}

// FAIL-CLOSED: a readdir failure throws (the caller turns it into a fatal
// finding). Never swallow it into an empty list - an empty scan is a green.
// R100: the walk RECURSES into subdirs (scripts/tau/ is now in the scan domain)
// and returns posix-style relative paths so exclusion entries stay portable.
export function enumerateScriptFiles(root) {
  const dir = path.join(root, "scripts");
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) out.push(path.relative(dir, p).replace(/\\/g, "/"));
    }
  };
  walk(dir);
  return out.sort();
}

// Static export-name extraction: `export const X_CODES = ...` (top-level).
export function staticCodeExports(text) {
  const names = [];
  const re = /^export\s+const\s+([A-Za-z0-9_]*_CODES)\b/gm;
  let m;
  while ((m = re.exec(text)) !== null) names.push(m[1]);
  return names;
}

export function registeredNamesFor(stem) {
  const key = GOVERNED_MODULES[stem];
  const group = key ? CODE_GROUPS[key] : undefined;
  return group ? Object.values(group) : [];
}

// The ONE module-loading path (audit R99-2 dedup): both the production scan and
// the falsification probe use it, so a load-failure shape can never drift.
export function loadScriptModule(root, stem) {
  return require(path.join(root, "scripts", stem + ".mjs"));
}

// Resolve the registry's declared export names for a module into the module's
// OWN array objects (identity), so the guard compares identity, not content.
export function resolveRegistryArrays(stem, ns) {
  return registeredNamesFor(stem)
    .map((n) => (ns ? ns[n] : undefined))
    .filter((a) => Array.isArray(a));
}

export function scanVocabGuards({ root, load } = {}) {
  const loader = load ?? ((stem) => loadScriptModule(root, stem));
  let files;
  try {
    files = enumerateScriptFiles(root);
  } catch (e) {
    // Fail-closed: an unreadable scan surface is a fatal finding, never ok:true.
    return {
      ok: false,
      scanned: [],
      findings: [{ stem: "<scripts-dir>", name: "scan-surface-unreadable", detail: errText(e) }],
      excludedDrift: [],
      candidates: [],
    };
  }
  const findings = [];
  const scanned = [];
  const excludedDrift = [];
  const candidates = [];
  for (const f of files) {
    const full = path.join(root, "scripts", f);
    const ext = path.extname(f);
    let text = "";
    try {
      text = fs.readFileSync(full, "utf8");
    } catch {
      continue;
    }
    if (EXCLUDED_EXTENSIONS.includes(ext)) {
      // excluded by "cannot be namespace-injected": cross-check for drift (info only)
      for (const n of staticCodeExports(text)) excludedDrift.push({ file: f, name: n });
      continue;
    }
    if (ext !== ".mjs") continue;
    const cls = classifyTopLevel(text);
    const stem = f.replace(/\.mjs$/, "");
    if (EXCLUDED_PATHS.some((x) => x.path === f)) {
      scanned.push({ stem, codes: 0, excluded: true });
      // An exclusion legitimizes the side effects, never a vocabulary: an
      // excluded .mjs CAN still be imported - a *_CODES here is an unguarded
      // vocabulary bypass and goes RED (drift for .ts/.py stays info because
      // those files can never be injected at all).
      for (const c of cls.codes) findings.push({ stem, name: AST_FINDING_NAMES.excludedCodes, detail: "excluded path carries `" + c.name + "` - an un-injectable vocabulary can never be guarded" });
      continue;
    }
    if (cls.codes.length > 0 && cls.effects.length > 0) {
      // ① codes ∧ effects: never inject (that would execute the side effect);
      // the RED names the structural violation instead.
      scanned.push({ stem, codes: cls.codes.length });
      findings.push({ stem, name: AST_FINDING_NAMES.topLevelEffect, detail: "vocabulary-bearing module executes top-level work {" + cls.effects.map((e) => e.kind).join(", ") + "} - it cannot be namespace-injected; move the vocabulary to a pure data module" });
      continue;
    }
    for (const c of cls.codes) {
      if (!c.verifiable) findings.push({ stem, name: AST_FINDING_NAMES.codesUnverifiable, detail: "export `" + c.name + "` initializer is not a literal vocabulary (dynamic assembly cannot be statically proven)" });
    }
    if (cls.codes.length === 0 && cls.effects.length > 0) {
      // ③ effects ∧ no codes: exclusion candidate, named for the closed list.
      candidates.push({ stem, effects: cls.effects.map((e) => e.kind) });
    }
    if (cls.codes.length === 0) {
      scanned.push({ stem, codes: 0 });
      continue;
    }
    let ns;
    try {
      ns = loader(stem);
    } catch (e) {
      findings.push({ stem, name: "<module-load-error>", detail: errText(e) });
      continue;
    }
    const unreg = unregisteredCodeExports(ns, resolveRegistryArrays(stem, ns));
    scanned.push({ stem, codes: cls.codes.length });
    for (const n of unreg) findings.push({ stem, name: n });
  }
  return { ok: findings.length === 0, scanned, findings, excludedDrift, candidates };
}
