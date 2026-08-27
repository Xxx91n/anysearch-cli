import { Buffer } from "node:buffer";

// ADR-0028 D3: shared secret guard for ALL write entries and BOTH search exits.
// Upgrades over the ADR-0027 inline SECRET_RE (write-path adjudicateMemory only):
//  - case-insensitive flag (PEM lowercase / mixed-case AKIA variants)
//  - JSON-escape restore (e.g. \"-----BEGIN\" embedded in a JSON string)
//  - whitespace collapse + full squash (secrets split across spaces/newlines)
//  - NFKC fold (fullwidth Latin ＡＫＩＡ -> AKIA)
//  - bounded base64 candidate decode (length <= 2048 chars; printable-only accept)
// Known blind spots — honesty class "Some", mirrors GitHub push protection docs:
//  - truncated secrets shorter than the pattern minimum are unrecoverable by regex
//  - novel encodings (rot13, chunked base64 across rows, unicode-private use) not covered
// ponytail: regex+normalize heuristic shared across 4 writes + 2 search exits;
// ceiling = novel encodings above; upgrade path = import gitleaks/trufflehog rule pack.
const SECRET_RE = /(sk-[A-Za-z0-9][A-Za-z0-9-]{14,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/i;

const BASE64_CANDIDATE_RE = /[A-Za-z0-9+/]{24,}={0,2}/g;
const PRINTABLE_RE = /^[\t\n\r\x20-\x7e]{8,}$/;
const JSON_ESCAPE_RE = /\\(["\\/bfnrt])/g;

export function containsSecret(input: unknown): boolean {
  const raw = typeof input === "string" ? input : JSON.stringify(input) ?? "";
  const nfkc = raw.normalize("NFKC");
  const unescaped = nfkc.replace(JSON_ESCAPE_RE, "$1");
  const collapsed = unescaped.replace(/\s+/g, " ");
  const squashed = collapsed.replace(/\s+/g, "");
  const candidates: string[] = [unescaped, collapsed, squashed];
  for (const m of collapsed.match(BASE64_CANDIDATE_RE) ?? []) {
    if (m.length > 2048) continue; // bounded decode: pathological-input guard
    try {
      const decoded = Buffer.from(m, "base64").toString("utf8");
      if (PRINTABLE_RE.test(decoded)) candidates.push(decoded);
    } catch { /* not valid standalone base64 — ignore */ }
  }
  return candidates.some((c) => SECRET_RE.test(c));
}

// Test seam: the raw pattern, exported read-only for the eval mutation self-test.
export const SECRET_PATTERNS = SECRET_RE.source;
