/**
 * Redact key-shaped runs: a known prefix with an 8+ character body, or any bare
 * run of 20+ characters.
 *
 * File paths are kept by default, so a credential warning can say which file
 * failed. Reply text passes `keepPaths: false`: it has no file to name, and its
 * long runs are redacted like everything else.
 *
 * `keepEnvNames` protects `ANS_*` names from the 20+ rule. They are settings a
 * reader has to act on, not secrets, and the caller is asking for operator text.
 * Without it, `ANS_LLM_CONTEXT_WINDOW` reads as `[redacted]`.
 */
export function redactSecrets(
  text: string,
  options: { keepPaths?: boolean; keepEnvNames?: boolean } = {},
): string {
  const envNames: string[] = [];
  const source = options.keepEnvNames
    ? text.replace(/\bANS_[A-Z0-9_]+\b/g, (name) => {
        envNames.push(name);
        return "ZZENV" + (envNames.length - 1) + "ZZ";
      })
    : text;
  const restoreEnv = (s: string) =>
    envNames.reduce((out, name, i) => out.split("ZZENV" + i + "ZZ").join(name), s);
  const redact = (s: string) => s
    .replace(/(?:sk|pk|rk|tvly|exa|key|api|tok)[-_][A-Za-z0-9_\-+=/.!]{8,}/gi, "[redacted]")
    .replace(/[A-Za-z0-9_\-+=]{20,}/g, "[redacted]");
  if (options.keepPaths === false) return restoreEnv(redact(source));
  const paths: string[] = [];
  // Placeholders are letters and digits only: a path contains backslashes, and a
  // backslash inside a replacement string is an escape, not a character.
  const token = (i: number) => "ZZPATH" + i + "ZZ";
  const body = source.replace(PATH_RE, (match, offset: number) => {
    // A key can look exactly like a relative path (`sk-proj-ab12/cd34`). When
    // the match continues a known key prefix, it is a key, not a path - leaving
    // it unprotected is what lets the prefix rule below remove it whole.
    if (KEY_PREFIX_AT_END.test(source.slice(0, offset))) return match;
    const kept = paths.length;
    paths.push(match);
    return token(kept);
  });
  return restoreEnv(paths.reduce((out, path, i) => out.split(token(i)).join(path), redact(body)));
}

const KEY_PREFIX_AT_END = /(?:sk|pk|rk|tvly|exa|key|api|tok)[-_]$/i;

/**
 * Replace absolute paths with `[path]`.
 *
 * Reply text that leaves this process for a host must not name a file on this
 * machine (a home directory leaks who ran the call). Relative names stay: they
 * name the file without naming the machine. Only the three absolute shapes
 * match — a leading slash, a drive letter, a UNC prefix — and nothing after a
 * URL's scheme colon, so `https://host/v1` keeps its path.
 *
 * A path may contain spaces (`C:\Users\J. Smith\…`, `Program Files (x86)`), so
 * the match runs to the punctuation that ends it instead of stopping at the
 * first space. Only a known file extension followed by a space is a real end
 * (`.toml `, `.json `): the rest of the line is prose again and is rescanned,
 * because it may hold a second path. Erring wide is deliberate — a swallowed
 * word is noise, a surviving path fragment is the leak this function exists to
 * prevent.
 */
export function redactPaths(text: string): string {
  let out = text;
  for (;;) {
    const next = out.replace(ABSOLUTE_PATH_RE, (match) => {
      const extension = KNOWN_EXTENSION_AT_SPACE.exec(match);
      if (extension) {
        return "[path]" + match.slice(extension.index + extension[0].length);
      }
      // A sentence's full stop is not part of the file name.
      return "[path]" + match.slice(match.replace(/\.+$/, "").length);
    });
    // The cut leaves prose behind, and that prose may name a second path; a
    // pass replaces at least one path, so this settles.
    if (next === out) return out;
    out = next;
  }
}

const ABSOLUTE_PATH_RE =
  /(?<![\w:/\\.-])(?:[A-Za-z]:[\\/]|\\\\|\/)[^ \t\n"`<>|,;:][^\n"`<>|,;:。，；：！？、）]*/g;

/** A file extension this repo's messages actually print, followed by prose. */
const KNOWN_EXTENSION_AT_SPACE =
  /\.(?:jsonl|json|toml|lock|log|txt|ya?ml|env|pem|crt|gz|db|sqlite|acl|tmp|md|js|ts|mjs|cjs)(?=[ \t])/;

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
