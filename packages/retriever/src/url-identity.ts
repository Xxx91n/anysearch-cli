// The one ruler for "is this the same page".
//
// Identity is what search dedup, archive writes, ticket matching and the fetch
// path compare. It is deliberately NOT a display URL: the scheme is dropped,
// a leading `www.` and a trailing host dot are folded, default ports (80/443)
// are dropped, tracking parameters and the fragment are removed. Everything
// else — path case, query order, non-tracking parameters — stays as it came in.
//
// Display surfaces keep the link they already show; this module never feeds a
// user-visible URL.
//
// #606: there used to be a private copy in the engine that handled only
// scheme/www/tracking and choked on a host with a trailing dot or a scheme-less
// `host:port`. That copy is retired; this is the only implementation.

// Tracking parameters the old engine copy stripped by name. Everything with a
// `utm_` prefix is matched by prefix, so it is not repeated here.
const NAMED_TRACKING_PARAMS: Record<string, true> = {
  fbclid: true,
  gclid: true,
  ref: true,
};

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
 * dot, no default port, no tracking parameters, no fragment.
 *
 * Unparseable or non-http(s) input is returned trimmed and otherwise untouched,
 * so a caller that passes a non-URL string still gets a stable key.
 */
export function normalizeUrlIdentity(raw: string): string {
  const text = raw.trim();
  const url = parseWebUrl(text);
  if (!url) return text;
  if (url.protocol !== "http:" && url.protocol !== "https:") return text;

  const host = url.hostname.replace(/\.$/, "").replace(/^www\./, "");
  const port = url.port === "80" || url.port === "443" ? "" : url.port;

  for (const name of [...url.searchParams.keys()]) {
    if (name.startsWith("utm_") || Object.hasOwn(NAMED_TRACKING_PARAMS, name)) {
      url.searchParams.delete(name);
    }
  }

  return host + (port ? ":" + port : "") + url.pathname + url.search;
}
