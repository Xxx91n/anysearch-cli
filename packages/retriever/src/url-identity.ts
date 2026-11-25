// The identity of a web page: the key two spellings must share to count as
// "same page".
//
// Search dedup and archive writes call this. It produces an identity key, NOT
// a link: the scheme is dropped, `www.` and a trailing host dot are folded,
// the two standard web ports (80 and 443) are dropped, tracking parameters and
// the fragment are removed. Path case, query order and every other byte stay
// as given, so the result is safe to pass in again (idempotent).
//
// A surface that shows a URL must keep the link it already carries (for search
// results that is `sourceUrl`); this key is not display text.

// Tracking parameters the old engine copy stripped by name. Everything with a
// `utm_` prefix is matched by prefix, so it is not repeated here.
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
 * Returns null for anything that is not a web URL: an unparseable string or an
 * opaque scheme such as `mailto:`.
 */
function parseWebUrl(raw: string): URL | null {
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
    // A bare host:port also looks like a scheme (`example.com:443`). An opaque
    // URI (`mailto:a@b.com`) does not start its path with a digit.
    const afterColon = text.slice(text.indexOf(":") + 1);
    if (!/^\d/.test(afterColon)) return null;
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
