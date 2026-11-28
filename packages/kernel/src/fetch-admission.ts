// What the fetch tool admits, and why it refuses.
//
// Address -> domain -> credential, in that order. The source ticket is checked
// in the tool because it reads the store; these three are pure.

import { isIP } from "node:net";
import { FETCH_MAX_URLS_PER_CALL, hostMatchesEntry, normalizeUrlIdentity, parseWebUrl } from "@anysearch-cli/retriever";
import { containsSecret, HTTP_TICKET_PREFIX, type FetchTicketKind } from "@anysearch-cli/store";

export const FETCH_LIMITS = {
  maxPages: 10,
  maxUrlsPerCall: FETCH_MAX_URLS_PER_CALL,
  maxEmptyBatches: 2,
  maxRejectedBatches: 2,
  maxCharacters: 4000,
} as const;

export interface FetchPolicy {
  allow: readonly string[];
  deny: readonly string[];
}

export type FetchRejectReason =
  | "no_ticket"
  | "stale_handle"
  | "invalid_handle"
  | "bad_address"
  | "denied"
  | "not_allowlisted"
  | "credential"
  | "trust_unavailable"
  | "trust_declined"
  | "trust_write_failed";

/** Extra facts a refusal sentence may use, so the model gets a concrete next move. */
export interface FetchRejectContext {
  host?: string;
  /** True when an interactive CLI can ask the user to trust a site this session. */
  trustAvailable?: boolean;
}

export type FetchTicketSource = FetchTicketKind;

/** The sentence the model reads for a refusal. Each one names the next move. */
export function fetchRejectMessage(reason: FetchRejectReason, context: FetchRejectContext = {}): string {
  switch (reason) {
    case "no_ticket": {
      const site = context.host
        ? "先做站点限定搜索：在 search 的查询里写 `site:" + context.host + " 关键词`，"
        : "先按标题或站点搜索，";
      const trust = context.trustAvailable
        ? "还搜不到的话，带 requestTrustFor: \"" + (context.host ?? "域名") + "\" 再调一次，用户会看清网址后决定信不信任这个网站；"
        : "当前是非交互模式，不能弹确认；让用户把链接贴进对话，";
      return "这个网址不在本会话的搜索结果或用户消息里，抓不了。" + site + "搜到了用 m: 句柄读。" + trust + "不要换 URL 写法重试。";
    }
    case "stale_handle":
      return "这个 m: 句柄对应的搜索结果不在本会话里，抓不了。重新搜一次，拿新的 m: 句柄。";
    case "invalid_handle":
      return "这个句柄既不是 m:<行号>，也不是一个网址，抓不了。只能用搜索结果里的 m: 句柄，或用户贴过的网址。";
    case "bad_address":
      return "这个地址不能抓：只接受公网 http/https 网页；本机、内网 IP、无点主机名和带用户名密码的链接都不行。域名不做 DNS 解析，只按字面量判断。";
    case "denied":
      return "这个域名在禁止列表里，抓不了。用已有材料回答，或者先做站点搜索。";
    case "not_allowlisted":
      return "这个域名不在当前领域白名单里，抓不了。先做 site: 搜索，或者让用户贴链接。";
    case "credential":
      return "这个网址里带着疑似密钥或令牌，不能发给上游。让用户确认链接，不要重试。";
    case "trust_unavailable":
      return "这个网址不在本会话的搜索结果或用户消息里，抓不了。当前是非交互模式（headless/MCP），不能弹「信任这个网站」的确认；先做站点限定搜索，还搜不到就让用户把链接贴进对话。";
    case "trust_declined":
      return "用户没有同意信任" + (context.host ? " " + context.host : "这个网站") + "，这次先不读它。先用已有材料回答；要读的话让用户把网页正文贴进来。";
    case "trust_write_failed":
      return "用户同意了，但" + (context.host ? " " + context.host + " 的" : "这个主机的") +
        "信任票没写进本会话，别再问了。这次没读页；先用已有材料回答，或者让用户把网页正文贴进来。";
    default:
      return assertNever(reason);
  }
}

function assertNever(value: never): never {
  throw new Error("unhandled fetch reject reason: " + String(value));
}

function blockedIpv4(host: string): boolean {
  const octets = host.split(".").map(Number);
  if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = octets as [number, number, number, number];
  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || a >= 224;
}

function blockedIpv6(rawHost: string): boolean {
  const host = rawHost.toLowerCase();
  // Every `::`-prefixed form (loopback, IPv4-mapped, IPv4-compatible) is
  // rejected; this gate does not try to recover the embedded v4 address.
  if (host.startsWith("::")) return true;
  const groups = host.split(":");
  if (/^\d+\.\d+\.\d+\.\d+$/.test(groups[groups.length - 1] ?? "")) return true;
  if (groups.slice(0, -1).every((part) => part === "" || part === "0")) return true;
  const first = Number.parseInt(groups[0] || "", 16);
  if (!Number.isFinite(first)) return true;
  return (first & 0xfe00) === 0xfc00       // fc00::/7 unique local
    || (first & 0xffc0) === 0xfe80         // fe80::/10 link local
    || (first & 0xff00) === 0xff00;        // ff00::/8 multicast
}

function blockedHost(host: string): boolean {
  const family = isIP(host);
  if (family === 4) return blockedIpv4(host);
  if (family === 6) return blockedIpv6(host);
  return !host.includes(".");
}

/** Address gate: public web only, no credentials in the authority. */
export function checkFetchAddress(rawHandle: string, identity: string): { ok: true; host: string; port?: string } | { ok: false; reason: "bad_address" } {
  const parsed = parseWebUrl(rawHandle) ?? parseWebUrl(identity);
  if (!parsed) return { ok: false, reason: "bad_address" };
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return { ok: false, reason: "bad_address" };
  if (parsed.username || parsed.password) return { ok: false, reason: "bad_address" };
  let host = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase().replace(/\.$/, "");
  if (!host) return { ok: false, reason: "bad_address" };
  if (host === "localhost" || host.endsWith(".localhost")) return { ok: false, reason: "bad_address" };
  if (blockedHost(host)) return { ok: false, reason: "bad_address" };
  return { ok: true, host, ...(parsed.port ? { port: parsed.port } : {}) };
}

/**
 * Domain gate: deny first and for every source; then an allowlist that is a
 * hard cap. An empty allowlist means no domain cap (deny still applies).
 */
export function checkFetchDomain(host: string, policy: FetchPolicy): { ok: true } | { ok: false; reason: "denied" | "not_allowlisted" } {
  if (policy.deny.some((entry) => hostMatchesEntry(entry, host))) return { ok: false, reason: "denied" };
  if (policy.allow.length > 0 && !policy.allow.some((entry) => hostMatchesEntry(entry, host))) {
    return { ok: false, reason: "not_allowlisted" };
  }
  return { ok: true };
}

const CREDENTIAL_PARAMS: Record<string, true> = {
  key: true,
  token: true,
  secret: true,
  password: true,
  passwd: true,
  api_key: true,
  apikey: true,
  access_token: true,
  accesstoken: true,
  auth_token: true,
  authtoken: true,
  session_id: true,
  sessionid: true,
  phpsessid: true,
  x_amz_security_token: true,
  clientsecret: true,
  idtoken: true,
  privatekey: true,
  xamzsignature: true,
  refreshtoken: true,
  refresh_token: true,
  client_secret: true,
  id_token: true,
  private_key: true,
  x_api_key: true,
  x_amz_credential: true,
  x_amz_signature: true,
  awsaccesskeyid: true,
  jsessionid: true,
  sig: true,
  signature: true,
  auth: true,
  authorization: true,
};

function looksHighEntropy(value: string): boolean {
  if (value.length < 32 || value.length > 2048) return false;
  // Commit SHAs, content hashes and UUIDs are common in public paths.
  if (/^[0-9a-f]+$/i.test(value)) return false;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) return false;
  // A value with a word separator or slug is a title, not a token. Base64
  // symbols mark a token; an unpadded key of only letters/digits can still
  // slip through.
  if (value.includes("_") || value.includes("-") || value.includes("++")) return false;
  if (!/[+=]/.test(value)) return false;
  return /^[A-Za-z0-9+/=]+$/.test(value);
}

function normalizeParamName(name: string): string {
  return name.toLowerCase().replace(/-/g, "_").replace(/\[\]$/, "");
}

/**
 * Credential gate: a URL with a known credential parameter name, a known
 * secret shape, or a high-entropy `+`/`=` value is never sent upstream. Other
 * shapes rely on heuristics; this is not a complete secret detector.
 */
export function fetchCredentialHit(rawHandle: string, identity: string): boolean {
  for (const text of [rawHandle, identity]) {
    const parsed = parseWebUrl(text);
    if (!parsed) continue;
    for (const [name, value] of parsed.searchParams) {
      if (Object.hasOwn(CREDENTIAL_PARAMS, normalizeParamName(name))) return true;
      if (looksHighEntropy(value) || containsSecret(value)) return true;
    }
    for (const segment of parsed.pathname.split("/")) {
      // Secret-shape segments with <=2 `-`/`_` parts; 3+ parts is a title slug.
      if (containsSecret(segment) && segment.split(/[-_]/).filter(Boolean).length <= 2) return true;
      // High-entropy values need a `+` or `=` symbol; `-`/`_` are not judged.
      if (/^(?:sk-(?:proj|ant)-|ghp_|gho_|xox[baprs]-|glpat-)/i.test(segment)) return true;
      if (looksHighEntropy(segment)) return true;
    }
    const inline = /(?:^|[?&;/])([A-Za-z0-9_.\-]+)=/g;
    for (const match of text.matchAll(inline)) {
      if (Object.hasOwn(CREDENTIAL_PARAMS, normalizeParamName(match[1]!))) return true;
    }
    if (/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./.test(text)) return true;
  }
  return false;
}

const URL_STOP = `\\s<>"'\`\\]\\[{}，。；：、！？（）【】《》“”‘’`;
const SCHEME_URL = new RegExp("https?://[^" + URL_STOP + "]+", "gi");
// A bare URL ends at non-ASCII too: prose like `看example.com/a这个` must not
// swallow the Chinese into the path.
const BARE_STOP = URL_STOP + "\\u0080-\\uffff";
const BARE_URL = new RegExp(
  "(?<![@\\w./-])((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z]{2,63}(?::\\d{1,5})?(?:/[^" + BARE_STOP + "]*)?)",
  "gi",
);
const TRAILING_PUNCTUATION = /[,.;:!?，。；：、）】》”’]+$/;

/** Remove trailing sentence punctuation, keeping a balanced `)`. */
function trimUrlCandidate(raw: string): string {
  let value = raw.replace(TRAILING_PUNCTUATION, "");
  while (value.endsWith(")")) {
    const opens = (value.match(/\(/g) ?? []).length;
    const closes = (value.match(/\)/g) ?? []).length;
    if (closes <= opens) break;
    value = value.slice(0, -1);
  }
  return value;
}
function bareLooksLikePage(candidate: string): boolean {
  // A scheme-less ticket is `host/path`, not a bare hostname in prose. The last
  // path segment is not checked for a file extension: `.md`, `.sh`, `.py` and
  // `.zip` are also real TLDs, so `foo.md/docs` is a page, not a filename.
  if (!candidate.includes("/") && !/^[^/]+:\d+/.test(candidate)) return false;
  const parsed = parseWebUrl(candidate);
  return parsed !== null && parsed.hostname.includes(".");
}

/** Mark a user ticket as "the user explicitly pasted http", not https. */
export function httpTicketValue(identity: string): string {
  return HTTP_TICKET_PREFIX + identity;
}

/**
 * The user-message ticket corpus: every web URL the user typed, as normalized
 * identities. A scheme URL is taken as typed; a bare `host/path` is read as
 * https when it has a path or port and a dotted host. A file/module name
 * shaped like `word.word/path` can therefore become a ticket too.
 */
export function extractUserUrlTickets(text: string): string[] {
  const out = new Set<string>();
  for (const match of text.matchAll(SCHEME_URL)) {
    const candidate = trimUrlCandidate(match[0]);
    try {
      const parsed = new URL(candidate);
      const identity = normalizeUrlIdentity(candidate);
      if (fetchCredentialHit(candidate, identity)) continue;
      out.add(identity);
      if (parsed.protocol === "http:") out.add(httpTicketValue(identity));
    } catch { /* not a URL after all */ }
  }
  for (const match of text.matchAll(BARE_URL)) {
    const candidate = trimUrlCandidate(match[1]!);
    if (!bareLooksLikePage(candidate)) continue;
    const identity = normalizeUrlIdentity(candidate);
    if (!fetchCredentialHit(candidate, identity)) out.add(identity);
  }
  return [...out];
}

/**
 * The wire URL for a stored identity. The identity is scheme-less; callers pass
 * `http` only when a matching user ticket recorded that scheme, otherwise
 * https.
 */
export function makeRequestUrl(identity: string, scheme: "http" | "https" = "https"): string {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(identity)) return identity;
  return scheme + "://" + identity;
}

/**
 * The URL a handle will really request. An explicit https URL keeps its
 * spelling; an http URL keeps http only when a user ticket recorded that
 * scheme; anything else is rebuilt on https from the identity.
 */
export function requestUrlFor(raw: string, identity: string, hasHttpTicket: boolean): string {
  const rawUserUrl = raw.trim();
  if (/^http:\/\//i.test(rawUserUrl) && hasHttpTicket) return rawUserUrl;
  if (/^https:\/\//i.test(rawUserUrl)) return rawUserUrl;
  return makeRequestUrl(identity, "https");
}

/** The canonical search-result handle. */
export function searchHandle(rowId: number): string {
  return "m:" + rowId;
}

export function parseSearchHandle(raw: string): number | undefined {
  const match = /^m:(\d+)$/.exec(raw.trim());
  return match ? Number(match[1]) : undefined;
}
