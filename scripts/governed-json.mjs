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

const LF = 0x0a; // '\n' byte — canonical form's line ending and terminator

// 1-based line number of the first differing byte — the alint-style
// "first differs at line N" UX. Counts LF occurrences before the divergence.
export function firstDifferingLine(a, b) {
  const ab = Buffer.isBuffer(a) ? a : Buffer.from(a);
  const bb = Buffer.isBuffer(b) ? b : Buffer.from(b);
  const n = Math.min(ab.length, bb.length);
  let i = 0;
  while (i < n && ab[i] === bb[i]) i++;
  let line = 1;
  for (let k = 0; k < i; k++) if (ab[k] === LF) line++;
  return line;
}

// Paste-able normalize command (double-quoted -e so it works on cmd.exe and
// POSIX shells alike). Printed verbatim in the failure message.
export function normalizeCommand(rel) {
  return "node -e \"const f='" + rel + "';const fs=require('fs');fs.writeFileSync(f,JSON.stringify(JSON.parse(fs.readFileSync(f,'utf8')),null,1)+'\\n')\"";
}

// Paste-able BOM-strip command. A UTF-8 BOM breaks JSON.parse AND survives
// normalization (fs.readFileSync utf8 keeps the BOM codepoint) — normalize
// cannot fix it, so the failure message must hand a strip command instead.
export function stripBomCommand(rel) {
  return "node -e \"const f='" + rel + "';const fs=require('fs');const b=fs.readFileSync(f);if(b[0]===0xEF&&b[1]===0xBB&&b[2]===0xBF)fs.writeFileSync(f,b.subarray(3))\"";
}

// The governed list itself is a checked invariant: an empty list would iterate
// zero files and report green — a byte-lock with nothing to check is a failure
// (same vacuous-pass class as the empty scope set banned in closeout-coverage).
export function governedListViolation(files) {
  if (!Array.isArray(files) || files.length === 0) {
    return "CANONICAL_JSON_FILES is empty — a canonical-lock leg with nothing to check is a failure (ADR-0077); restore the governed list in scripts/ship-gate.mjs";
  }
  return null;
}

// null when src is already canonical; otherwise a fail-ready message.
// Invalid JSON reports on its own — the normalize pointer only appears for
// parseable-but-non-canonical bytes (normalize cannot fix a syntax error).
export function governedJsonViolation(rel, src) {
  const bytes = Buffer.isBuffer(src) ? src : Buffer.from(src);
  // R77 T1 (F-6): a UTF-8 BOM is a dedicated failure class — it breaks
  // JSON.parse (so the file is not even parseable) and normalization cannot
  // repair it (the BOM round-trips through utf8 read+write). The message names
  // the byte signature and hands a strip command, never the normalize pointer.
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return rel + " starts with a UTF-8 BOM (EF BB BF) — JSON.parse rejects BOM'd input and canonical normalization cannot repair it; strip the BOM first: " + stripBomCommand(rel);
  }
  let canon;
  try {
    canon = canonicalJsonBytes(bytes);
  } catch (e) {
    return rel + " is not valid JSON (" + (e && e.message) + ") — fix the syntax first; canonical normalization only applies to parseable JSON";
  }
  if (bytes.equals(canon)) return null;
  return rel + " is not in canonical form (first differs at line " + firstDifferingLine(bytes, canon) + ") — normalize: " + normalizeCommand(rel) + " — governed list: CANONICAL_JSON_FILES in scripts/ship-gate.mjs (ADR-0077)";
}
