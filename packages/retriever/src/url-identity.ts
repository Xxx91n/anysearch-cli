// The identity of a web page: the key two spellings must share to count as
// "same page".
//
// Search dedup and archive writes call this. It produces an identity key, NOT
// a link: the scheme is dropped, `www.` and a trailing host dot are folded,
// the two standard web ports (80 and 443) are dropped, tracking parameters and
// the fragment are removed. Path case, query order and every other byte stay
// as given, so the result is safe to pass in again (idempotent).
//
// The archive stores this key in `retrieval_results.url`; surfaces that render
// that column (entity review, preference review, rebuilt summaries and
// consolidation evidence) show it without a scheme. Chat answer sources keep
// their own display link (`sourceUrl`) when one is present.

// Explicit query parameters treated as tracking. Everything with a `utm_`
// prefix is matched by the prefix and is not repeated here.
const NAMED_TRACKING_PARAMS: Record<string, true> = {
  fbclid: true,
  gclid: true,
  ref: true,
};

/**
 * Drop tracking parameters without re-encoding the rest of the query. The
 * URLSearchParams path rewrites the whole query (`%20` becomes `+`), which
 * gives one page two identities depending on whether a tracking parameter
 * happened to be present.
 */
function stripTrackingParams(search: string): string {
  if (!search.startsWith("?")) return "";
  const kept = search.slice(1).split("&").filter((part) => {
    const eq = part.indexOf("=");
    const rawName = eq === -1 ? part : part.slice(0, eq);
    let name = rawName;
    try {
      name = decodeURIComponent(rawName.replace(/\+/g, " "));
    } catch {
      // A malformed escape is not a tracking name; keep the parameter as-is.
    }
    return !(name.startsWith("utm_") || Object.hasOwn(NAMED_TRACKING_PARAMS, name));
  });
  return kept.length > 0 ? "?" + kept.join("&") : "";
}

/**
 * Parse an http(s) URL, adding `https://` when the caller left the scheme off.
 * A scheme-less `word.word` is treated as a host even if it is really a file
 * name (`README.md`); deciding page-versus-file stays with the caller. Returns
 * null for an unparseable string or an opaque scheme such as `mailto:`.
 */
export function parseWebUrl(raw: string): URL | null {
  const text = raw.trim();
  if (!text) return null;
  if (/^https?:\/\//i.test(text)) {
    try {
      return new URL(text);
    } catch {
      return null;
    }
  }
  if (text.startsWith("//")) {
    try {
      return new URL("https:" + text);
    } catch {
      return null;
    }
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) return null; // another scheme with an authority
  if (/^[a-z][a-z0-9+.-]*:/i.test(text)) {
    // A bare host:port also looks like a scheme (`example.com:443`). Treat it
    // as host:port only when the value after the colon starts with a digit and
    // the part before the colon contains a dot or is `localhost`; otherwise
    // return the input unchanged, so `tel:1234` is not rewritten as a URL.
    const colon = text.indexOf(":");
    const before = text.slice(0, colon);
    const after = text.slice(colon + 1);
    if (!/^\d/.test(after)) return null;
    if (!before.includes(".") && before.toLowerCase() !== "localhost") return null;
  }
  try {
    return new URL("https://" + text);
  } catch {
    return null;
  }
}

/**
 * The identity of a web URL: scheme-insensitive, no `www.`, no trailing host
 * dot, no standard web port, no tracking parameters, no fragment.
 *
 * Unparseable or non-http(s) input is returned trimmed and otherwise untouched,
 * so a caller that passes a non-URL string still gets a stable key.
 */
export function normalizeUrlIdentity(raw: string): string {
  const text = raw.trim();
  const url = parseWebUrl(text);
  if (!url) return text;

  const host = url.hostname.replace(/\.$/, "").replace(/^www\./, "");
  // The identity drops the scheme, so it cannot tell "default for https" from
  // "default for http". Both standard web ports are therefore not part of the
  // key, and feeding the key back in gives the same key.
  const port = url.port === "80" || url.port === "443" ? "" : url.port;
  const search = stripTrackingParams(url.search);

  return host + (port ? ":" + port : "") + url.pathname + search;
}

/**
 * Return only the results whose URL identity is not in `seen`, adding each
 * returned identity to `seen` as it goes. The round and reround merge sites
 * share this so they cannot drift into two different "new result" rules.
 */
export function pickUnseenUrlResults<T extends { url: string }>(
  seen: Set<string>,
  results: readonly T[],
): T[] {
  const fresh: T[] = [];
  for (const result of results) {
    const key = normalizeUrlIdentity(result.url);
    if (seen.has(key)) continue;
    seen.add(key);
    fresh.push(result);
  }
  return fresh;
}
