// Hosts named in text that a tool would send off this machine.
//
// Design: detect only — nothing here edits what the model sent. A bare domain is
// a host when its labels are valid, its last label is a real TLD (IANA snapshot),
// and — with no path, port or `www.` marking it as a URL — it is not a file
// extension or code placeholder. Explicit `http(s)://` URLs count as hosts
// whatever `new URL()` produced.

import { TLD_SNAPSHOT } from "./tlds.generated.js";

export interface UrlCandidate {
  /** Host as the policy compares it: lowercased, punycoded, no port. */
  host: string;
  /** The text this came from, for the user-facing reason — never rewritten in place. */
  raw: string;
}

// TLDs that are also common file extensions or code placeholders. `toml` is not
// a TLD at all, so it never reaches this gate — the snapshot check rejects it first.
// Real TLDs that are also common source or build artifacts. Adding one here costs
// detection of a bare domain under that TLD; leaving it out costs an ask prompt on
// every mention of the file. `.org` is deliberately absent: org-mode files are
// rarer than real `.org` sites. `main.tf`, `model.ml` and `bundle.js.map` are the
// kind of text this list keeps out of the gate.
const FILE_EXT_TLDS: Record<string, true> = {
  ac: true, am: true, app: true, as: true, cc: true, cr: true, in: true, inc: true, java: true,
  la: true, map: true, md: true, mk: true, ml: true, mm: true, mov: true, mo: true, ninja: true,
  pl: true, pm: true, ps: true, py: true, rs: true, sh: true, so: true, sv: true, tf: true,
  zip: true,
};
const PLACEHOLDER_TLDS: Record<string, true> = { bar: true, foo: true };
const BRACKET_OPEN: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
// Schemes the gate does not cover. `site:` is deliberately absent: it is a search
// operator, and its host must be judged like any other.
const NON_HTTP_SCHEMES: Record<string, true> = {
  mailto: true, ftp: true, ftps: true, ssh: true, git: true, file: true, javascript: true,
  data: true, tel: true, urn: true, ws: true, wss: true, magnet: true, news: true, irc: true,
  xmpp: true, sms: true, mms: true,
};

// Explicit http(s) URLs. The lookbehind keeps `xhttps://` out and the character
// class stops at whitespace, quotes and angle brackets.
const SCHEME_URL = /(?<![\w+.-])https?:\/\/[^\s<>"'`]+/gi;
// Bare candidates: at least two dot-separated runs, ASCII only, optional port and
// path. The path stops at any non-ASCII byte, so `看example.com/a这个` yields
// `example.com/a` rather than swallowing the CJK that follows it. The lookbehinds
// are load-bearing: they keep the match from starting mid-host and from reading
// the domain half of an email address. Labels are only shape-matched here;
// `bareHost` is what decides whether the shape is a host.
const BARE_DOMAIN =
  /(?<![A-Za-z0-9@._-])[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+(?::\d+)?(?:\/[^\s<>"'`\u0080-\uffff]*)?/g;

/** Drops sentence punctuation a URL picked up by sitting in prose (GFM autolink rules). */
function trimPunctuation(candidate: string): string {
  let text = candidate;
  for (;;) {
    const last = text.slice(-1);
    if (/[.,;:!?'"]/.test(last)) { text = text.slice(0, -1); continue; }
    const open = BRACKET_OPEN[last];
    if (open !== undefined) {
      const closes = text.split(last).length - 1;
      const opens = text.split(open).length - 1;
      if (closes > opens) { text = text.slice(0, -1); continue; }
    }
    return text;
  }
}

/** Lowercases and drops the trailing dots an FQDN may carry, so `example.com.` matches `example.com`. */
function normalizeHost(hostname: string): string {
  return hostname.toLowerCase().replace(/\.+$/, "");
}

/** Structural check for a host we inferred ourselves: LDH labels, no empties, sane lengths. */
function validHost(host: string): boolean {
  if (host.length === 0 || host.length > 253) return false;
  const labels = host.split(".");
  if (labels.length < 2) return false;
  return labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
}

function bareHost(candidate: string): UrlCandidate | null {
  const raw = trimPunctuation(candidate);
  const [authority] = raw.split(/[/?#]/);
  // An `@` means email or userinfo; neither is a host we gate here.
  if (authority.includes("@")) return null;
  const withoutPort = authority.replace(/:\d+$/, "");
  // A port, a path or a `www.` prefix is the text saying "this is a URL", which
  // is what lets `main.py/a` through while `main.py` stays a file.
  const urlMarked = withoutPort !== authority || raw.length > authority.length || withoutPort.toLowerCase().startsWith("www.");
  const host = normalizeHost(withoutPort);
  if (!validHost(host)) return null;
  // Bare IPs are only gated when they carry a scheme: `1.2.3.4` on its own is
  // far more often a version than an address.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return null;
  const tld = host.slice(host.lastIndexOf(".") + 1);
  if (!TLD_SNAPSHOT.has(tld)) return null;
  if (!urlMarked && (FILE_EXT_TLDS[tld] === true || PLACEHOLDER_TLDS[tld] === true)) return null;
  return { host, raw };
}

/** Hosts mentioned in one piece of text, one entry per host. Explicit URLs are read
 *  first, then bare domains; the first host the policy refuses is the one the
 *  reason names. */
export function hostCandidates(text: string): UrlCandidate[] {
  const seen = new Set<string>();
  const out: UrlCandidate[] = [];
  const add = (candidate: UrlCandidate | null) => {
    if (!candidate || seen.has(candidate.host)) return;
    seen.add(candidate.host);
    out.push(candidate);
  };
  const schemeRanges: Array<[number, number]> = [];
  for (const match of text.matchAll(SCHEME_URL)) {
    const raw = trimPunctuation(match[0]);
    let candidate: UrlCandidate | null = null;
    try {
      const host = normalizeHost(new URL(raw).hostname);
      // `new URL("https://../")` parses with a hostname of `..`, which is not a host.
      if (host.length > 0 && host !== ".") candidate = { host, raw };
    } catch {
      // A URL the parser rejects (bad port, stray characters) still names a host.
      // Read the authority straight out of the text so it is judged, not dropped.
      const authority = /^https?:\/\/([^/?#\s]+)/i.exec(raw)?.[1] ?? "";
      const host = normalizeHost(authority.replace(/^[^@]*@/, "").replace(/:\d+$/, ""));
      if (host.length > 0) candidate = { host, raw };
    }
    add(candidate);
    // Only a range that produced a host counts as covered; a failed parse must not
    // hide the text from the bare pass as well.
    if (candidate) schemeRanges.push([match.index, match.index + match[0].length]);
  }
  for (const match of text.matchAll(BARE_DOMAIN)) {
    const start = match.index;
    const end = start + match[0].length;
    if (schemeRanges.some(([from, to]) => start < to && end > from)) continue;
    // `ftp://example.com`, `mailto:example.com` and friends are out of scope: the
    // gate is about http(s) hosts, so the bare pass must not pick their host up
    // either. A `//` or a known non-http scheme before the match is what says so;
    // a bare `//` or a search operator like `site:` must not skip the host.
    const scheme = /([A-Za-z][A-Za-z0-9+.-]*):(?:\/\/)?$/.exec(text.slice(0, start));
    if (scheme && (scheme[0].endsWith("//") || NON_HTTP_SCHEMES[scheme[1].toLowerCase()] === true)) continue;
    add(bareHost(match[0]));
  }
  return out;
}

// Design: only fields whose text leaves the machine toward a provider or an agent
// are scanned — `recall_memory` and `query_knowledge` read the local index, so no
// host is contacted for them, and their queries match token by token, which any
// added text would change.
const SCANNED_FIELDS: Record<string, readonly string[]> = {
  search_web: ["query"],
  research_web: ["question"],
  ans_chat: ["message"],
};
const VERTICAL_PARAM_TOOLS: Record<string, true> = { search_web: true, research_web: true };

/** Every string inside a value, however deeply nested. */
function collectStrings(value: unknown, out: string[]): void {
  if (typeof value === "string") { out.push(value); return; }
  if (Array.isArray(value)) { for (const item of value) collectStrings(item, out); return; }
  if (value && typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) collectStrings(item, out);
  }
}

/** Hosts mentioned anywhere the given ans_* tool would send text out, one entry per host. */
export function toolInputCandidates(toolName: string, toolInput: Record<string, unknown>): UrlCandidate[] {
  // Hosts prefix our tools differently (`ans_search_web`, `x_search_web`,
  // `mcp__anysearch__search_web`), so a name matches exactly or after one or two
  // underscores — the same shapes `isAnsTool` accepts. Matching by suffix keeps
  // `ans_chat` working as a tool name in its own right.
  const base = Object.keys(SCANNED_FIELDS).find((name) => toolName === name || toolName.endsWith("_" + name)) ?? "";
  const fields = SCANNED_FIELDS[base];
  if (!fields) return [];
  const texts: string[] = [];
  for (const field of fields) {
    const value = toolInput[field];
    if (typeof value === "string") texts.push(value);
  }
  if (VERTICAL_PARAM_TOOLS[base] === true) collectStrings(toolInput.verticalParams, texts);
  const seen = new Set<string>();
  const out: UrlCandidate[] = [];
  for (const text of texts) {
    for (const candidate of hostCandidates(text)) {
      if (seen.has(candidate.host)) continue;
      seen.add(candidate.host);
      out.push(candidate);
    }
  }
  return out;
}
