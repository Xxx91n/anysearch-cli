// Which strings in a tool input are URLs, and which hosts they point at.
//
// Design: read hosts out of the fields that leave the machine, and leave the
// input alone — the gate only needs to know which hosts are being talked to, so
// nothing here rewrites what the model sent.
//
// The hard part is telling a domain from a file name. `.py`, `.md`, `.cc` and
// `.so` are real TLDs, so a plain "looks like a domain" test turns `main.py` and
// `README.md` into hosts. The rule below therefore asks for three things at once:
// labels that are structurally valid, a last label that exists in the committed
// IANA snapshot, and — when nothing else marks the text as a URL — a last label
// that is not a common file extension or a code placeholder. A path, a port or a
// `www.` prefix is that "something else": `main.py/a` is a URL, `main.py` is not.
// Explicit `http(s)://` URLs get none of that scrutiny: whatever `new URL()` can
// parse is a host the policy already judged before this module existed.

import { TLD_SNAPSHOT } from "./tlds.generated.js";

export interface UrlCandidate {
  /** Host as the policy compares it: lowercased, punycoded, no port. */
  host: string;
  /** The text this came from, for the user-facing reason — never rewritten in place. */
  raw: string;
}

const FILE_EXT_TLDS: Record<string, true> = {
  py: true, md: true, sh: true, pl: true, rs: true, so: true, cc: true, zip: true, mov: true, toml: true,
};
const PLACEHOLDER_TLDS: Record<string, true> = { bar: true, foo: true };

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
    if (last === ")" || last === "]" || last === "}") {
      const open = last === ")" ? "(" : last === "]" ? "[" : "{";
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

/** Hosts mentioned in one piece of text, in order, one entry per host. */
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
    schemeRanges.push([match.index, match.index + match[0].length]);
    const raw = trimPunctuation(match[0]);
    let parsed: URL;
    try { parsed = new URL(raw); } catch { continue; }
    const host = normalizeHost(parsed.hostname);
    // `new URL("https://../")` parses with a hostname of `..`, which is not a host.
    add(host.length > 0 && host !== "." ? { host, raw } : null);
  }
  for (const match of text.matchAll(BARE_DOMAIN)) {
    const start = match.index;
    const end = start + match[0].length;
    if (schemeRanges.some(([from, to]) => start < to && end > from)) continue;
    // `ftp://example.com`, `mailto:example.com` and friends are out of scope: the
    // gate is about http(s) hosts, so the bare pass must not pick their host up
    // either. A scheme or a `//` right before the match is what says so.
    if (/(?:[A-Za-z][A-Za-z0-9+.-]*:|\/\/)$/.test(text.slice(0, start))) continue;
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
  // Hosts prefix our tools differently (`ans_search_web`, `mcp__anysearch__search_web`),
  // so the name is reduced to the bare tool name before the field lookup.
  const name = toolName.includes("__") ? toolName.slice(toolName.lastIndexOf("__") + 2) : toolName;
  // `ans_chat` is itself a tool name, so the `ans_` prefix is only stripped when
  // the whole name is not one of ours.
  const base = SCANNED_FIELDS[name] ? name : name.replace(/^ans_/, "");
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
