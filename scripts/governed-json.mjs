// scripts/governed-json.mjs
// ADR-0077 (R76 T0 / D-003): governed-JSON canonical form — the byte-level lock
// for files whose on-disk shape is governed (docs/deferred-registry.json first;
// external tools twice rewrote it wholesale — 1-space -> 8-space -> 4-space —
// and every round someone restored the minimum diff by hand).
//
// Canonical form: JSON.stringify(JSON.parse(src), null, 1) + "\n", asserted
// BYTE-IDENTICAL. A semantic/deep compare misses key reordering and reindent,
// which is exactly the drift this leg exists to catch. V8 key order (insertion
// order) is the canonical order: no replacer, no sorted serialization.
//
// No autofix — a gate that rewrites the file it checks makes "committed !=
// reviewed"; the failure instead prints a paste-able normalize command.
// Node stdlib only (ADR-0020 D5).

// Canonical bytes for a JSON source (string or Buffer). Throws on invalid JSON.
export function canonicalJsonBytes(src) {
  return Buffer.from(JSON.stringify(JSON.parse(String(src)), null, 1) + "\n");
}

// 1-based line number of the first differing byte — the alint-style
// "first differs at line N" UX. Counts '\n' occurrences before the divergence.
export function firstDifferingLine(a, b) {
  const ab = Buffer.isBuffer(a) ? a : Buffer.from(a);
  const bb = Buffer.isBuffer(b) ? b : Buffer.from(b);
  const n = Math.min(ab.length, bb.length);
  let i = 0;
  while (i < n && ab[i] === bb[i]) i++;
  let line = 1;
  for (let k = 0; k < i; k++) if (ab[k] === 0x0a) line++;
  return line;
}

// Paste-able normalize command (double-quoted -e so it works on cmd.exe and
// POSIX shells alike). Printed verbatim in the failure message.
export function normalizeCommand(rel) {
  return "node -e \"const f='" + rel + "';const fs=require('fs');fs.writeFileSync(f,JSON.stringify(JSON.parse(fs.readFileSync(f,'utf8')),null,1)+'\\n')\"";
}

// null when src is already canonical; otherwise a fail-ready message.
// Invalid JSON reports on its own — the normalize pointer only appears for
// parseable-but-non-canonical bytes (normalize cannot fix a syntax error).
export function governedJsonViolation(rel, src) {
  let canon;
  try {
    canon = canonicalJsonBytes(src);
  } catch (e) {
    return rel + " is not valid JSON (" + (e && e.message) + ") — fix the syntax first; canonical normalization only applies to parseable JSON";
  }
  const bytes = Buffer.isBuffer(src) ? src : Buffer.from(src);
  if (bytes.equals(canon)) return null;
  return rel + " is not in canonical form (first differs at line " + firstDifferingLine(bytes, canon) + ") — normalize: " + normalizeCommand(rel) + " — governed list: CANONICAL_JSON_FILES in scripts/ship-gate.mjs (ADR-0077)";
}
