// scripts/vocab-scan.mjs
// ADR-0100 D3/D4 (R99): the thin shell that enumerates the governed scan
// surface (scripts/*.mjs, top level only, no recursion) and drives the pure
// per-module vocabulary guard.
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
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { CODE_GROUPS, GOVERNED_MODULES } from "./vocab-registry.mjs";
import { unregisteredCodeExports } from "./handoff-lint-verdict.mjs";

const require = createRequire(import.meta.url);

// The closed exclusion list (ADR-0100 D3): file kinds that CANNOT be namespace-
// injected (no ESM namespace for .ts/.py here). Membership is by the criterion
// "cannot be namespace-injected", never by "is a fixture".
export const EXCLUDED_EXTENSIONS = Object.freeze([".ts", ".py"]);

export function enumerateScriptFiles(root) {
  const dir = path.join(root, "scripts");
  let ents;
  try {
    ents = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return ents.filter((e) => e.isFile()).map((e) => e.name).sort();
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

// Resolve the registry's declared export names for a module into the module's
// OWN array objects (identity), so the guard compares identity, not content.
export function resolveRegistryArrays(stem, ns) {
  return registeredNamesFor(stem)
    .map((n) => (ns ? ns[n] : undefined))
    .filter((a) => Array.isArray(a));
}

export function scanVocabGuards({ root, load } = {}) {
  const loader = load ?? ((p) => require(p));
  const files = enumerateScriptFiles(root);
  const findings = [];
  const scanned = [];
  const excludedDrift = [];
  for (const f of files) {
    const full = path.join(root, "scripts", f);
    const ext = path.extname(f);
    let text = "";
    try { text = fs.readFileSync(full, "utf8"); } catch { continue; }
    if (EXCLUDED_EXTENSIONS.includes(ext)) {
      // excluded by "cannot be namespace-injected": cross-check for drift (info only)
      for (const n of staticCodeExports(text)) excludedDrift.push({ file: f, name: n });
      continue;
    }
    if (ext !== ".mjs") continue;
    const names = staticCodeExports(text);
    const stem = f.replace(/\.mjs$/, "");
    if (names.length === 0) { scanned.push({ stem, codes: 0 }); continue; }
    let ns;
    try {
      ns = loader(full);
    } catch (e) {
      findings.push({ stem, name: "<module-load-error>", detail: String(e && e.message ? e.message : e) });
      continue;
    }
    const unreg = unregisteredCodeExports(ns, resolveRegistryArrays(stem, ns));
    scanned.push({ stem, codes: names.length });
    for (const n of unreg) findings.push({ stem, name: n });
  }
  return { ok: findings.length === 0, scanned, findings, excludedDrift };
}
