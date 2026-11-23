/**
 * Redact key-shaped runs: a known prefix with an 8+ character body, or any bare
 * run of 20+ characters.
 *
 * File paths are kept by default, so a credential warning can say which file
 * failed. Reply text passes `keepPaths: false`: it has no file to name, and its
 * long runs are redacted like everything else.
 */
export function redactSecrets(text: string, options: { keepPaths?: boolean } = {}): string {
  const redact = (s: string) => s
    .replace(/(?:sk|pk|rk|tvly|exa|key|api|tok)[-_][A-Za-z0-9_\-+=/.!]{8,}/gi, "[redacted]")
    .replace(/[A-Za-z0-9_\-+=]{20,}/g, "[redacted]");
  if (options.keepPaths === false) return redact(text);
  const paths: string[] = [];
  // Placeholders are letters and digits only: a path contains backslashes, and a
  // backslash inside a replacement string is an escape, not a character.
  const token = (i: number) => "ZZPATH" + i + "ZZ";
  const body = text.replace(PATH_RE, (match, offset: number) => {
    // A key can look exactly like a relative path (`sk-proj-ab12/cd34`). When
    // the match continues a known key prefix, it is a key, not a path - leaving
    // it unprotected is what lets the prefix rule below remove it whole.
    if (KEY_PREFIX_AT_END.test(text.slice(0, offset))) return match;
    const kept = paths.length;
    paths.push(match);
    return token(kept);
  });
  return paths.reduce((out, path, i) => out.split(token(i)).join(path), redact(body));
}

const KEY_PREFIX_AT_END = /(?:sk|pk|rk|tvly|exa|key|api|tok)[-_]$/i;

/**
 * Real paths only. The relative branch needs a dot in the name or a known file
 * extension, because a bare `a/b` is also the shape of a base64 key body - and
 * protecting a key from redaction is the one failure this function cannot make.
 * The match stops at whitespace or punctuation that ends a path in these
 * messages, so `.../credentials.json: EACCES` keeps the errno outside the span.
 */
const PATH_RE = new RegExp(
  [
    // absolute POSIX or drive-letter path, any segments
    "(?:[A-Za-z]:)?[\\\\/][A-Za-z0-9._~\\-\\\\/]*",
    // relative path that is clearly a file: it carries an extension
    "|\\b[A-Za-z0-9._\\-]+(?:[\\\\/][A-Za-z0-9._\\-]+)*[\\\\/][A-Za-z0-9._\\-]+\\.[A-Za-z0-9]{1,10}\\b",
    // dotted file name with no directory part
    "|\\b[A-Za-z0-9._\\-]+\\.(?:json|toml|lock|log|txt|ya?ml|db|sqlite|acl|tmp)\\b",
  ].join(""),
  "g",
);
