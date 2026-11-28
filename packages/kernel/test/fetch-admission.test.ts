// The pure half of fetch admission: address, domain and credential gates,
// user-URL ticket extraction, and trust refusal text.

import {
  FETCH_LIMITS,
  checkFetchAddress,
  checkFetchDomain,
  extractUserUrlTickets,
  fetchCredentialHit,
  fetchRejectMessage,
  makeRequestUrl,
  requestUrlFor,
} from "../src/fetch-admission";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return false; }
  passed++; return true;
}

function addressRejects(raw: string): boolean {
  const identity = raw.replace(/^https?:\/\//i, "").replace(/\/$/, "");
  return !checkFetchAddress(raw, identity).ok;
}

// ---- address gate --------------------------------------------------------
assert(checkFetchAddress("https://example.com/page", "example.com/page").ok, "a public host is accepted");
assert(checkFetchAddress("http://8.8.8.8/", "8.8.8.8").ok, "a public IPv4 literal is accepted");
assert(checkFetchAddress("https://sub.example.co.uk/a", "sub.example.co.uk/a").ok, "a multi-label public host is accepted");
assert(checkFetchAddress("//example.com/a", "example.com/a").ok, "a protocol-relative URL parses like the identity helper");

assert(addressRejects("http://localhost:3000/"), "localhost is rejected");
assert(addressRejects("http://foo.localhost/"), "*.localhost is rejected");
assert(addressRejects("http://intranet/"), "a dotless host is rejected");
assert(addressRejects("http://127.0.0.1/"), "loopback IPv4 is rejected");
assert(addressRejects("http://127.1/"), "shortened loopback IPv4 is rejected");
assert(addressRejects("http://0177.0.0.1/"), "octal loopback IPv4 is rejected");
assert(addressRejects("http://0x7f.1/"), "hex loopback IPv4 is rejected");
assert(addressRejects("http://10.1.2.3/"), "private 10/8 is rejected");
assert(addressRejects("http://172.20.0.1/"), "private 172.16/12 is rejected");
assert(addressRejects("http://192.168.1.1/"), "private 192.168/16 is rejected");
assert(addressRejects("http://169.254.1.1/"), "link-local IPv4 is rejected");
assert(addressRejects("http://100.64.0.1/"), "CGNAT space is rejected");
assert(addressRejects("http://224.0.0.1/"), "multicast IPv4 is rejected");
assert(addressRejects("http://[::1]/"), "IPv6 loopback is rejected");
assert(addressRejects("http://[fe80::1]/"), "IPv6 link-local is rejected");
assert(addressRejects("http://[fd00::1]/"), "IPv6 unique-local is rejected");
assert(addressRejects("http://[ff02::1]/"), "IPv6 multicast is rejected");
assert(addressRejects("http://[0:0:0:0:0:ffff:127.0.0.1]/"), "IPv4-mapped IPv6 is rejected");
assert(addressRejects("http://[0:0:0:0:0:0:7f00:1]/"), "zero-prefixed IPv6 is rejected");
assert(addressRejects("ftp://example.com/file"), "a non-http scheme is rejected");
assert(addressRejects("https://user:pass@example.com/"), "credentials in the authority are rejected");
{
  const address = checkFetchAddress("https://example.com/page", "example.com/page");
  assert(address.ok && address.port === undefined, "a default port is not recorded");
}

// ---- domain gate: deny first, allowlist is a hard cap --------------------
assert(checkFetchDomain("bad.example.com", { allow: ["example.com"], deny: ["bad.example.com"] }).ok === false,
  "deny wins even when the allowlist matches");
assert(
  checkFetchDomain("other.com", { allow: ["example.com"], deny: [] }).ok === false,
  "a host outside a non-empty allowlist is rejected",
);
assert(checkFetchDomain("sub.example.com", { allow: ["example.com"], deny: [] }).ok === true,
  "a subdomain of an allowlisted host is accepted");
assert(checkFetchDomain("anything.com", { allow: [], deny: [] }).ok === true,
  "an empty allowlist means no domain cap");
assert(checkFetchDomain("bad.com", { allow: [], deny: ["bad.com"] }).ok === false,
  "deny still applies when the allowlist is empty");

// ---- credential gate -----------------------------------------------------
assert(fetchCredentialHit("https://example.com/?token=abc", "example.com/?token=abc"),
  "a token query parameter is rejected");
assert(fetchCredentialHit("https://example.com/?api-key=abc", "example.com/?api-key=abc"),
  "api-key is rejected in either spelling");
assert(fetchCredentialHit("https://example.com/?access_token=abc", "example.com/?access_token=abc"),
  "access_token is rejected");
assert(fetchCredentialHit("https://example.com/?auth-token=abc", "example.com/?auth-token=abc"),
  "auth-token is rejected after name normalization");
assert(fetchCredentialHit("https://example.com/?PHPSESSID=abc", "example.com/?PHPSESSID=abc"),
  "PHPSESSID is rejected");
assert(fetchCredentialHit("https://example.com/?clientSecret=abc123", "example.com/?clientSecret=abc123"),
  "camelCase clientSecret is rejected");
assert(fetchCredentialHit("https://example.com/callback?sig=abc", "example.com/callback?sig=abc"),
  "sig is rejected");
assert(fetchCredentialHit("https://example.com/A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6+abc=", "example.com/A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6+abc="),
  "a base64-shaped path segment is rejected");
assert(fetchCredentialHit("https://example.com/?key=sk-abcdefghijklmnop", "example.com/?key=sk-abcdefghijklmnop"),
  "a key-shaped value is rejected");
assert(fetchCredentialHit("https://example.com/sk-abcdefghijklmnop/x", "example.com/sk-abcdefghijklmnop/x"),
  "a short key-shaped path segment is rejected");
assert(fetchCredentialHit("https://example.com/AbCdEfGhIjKlMnOpQrStUvWxYz012345+abc",
  "example.com/AbCdEfGhIjKlMnOpQrStUvWxYz012345+abc"),
  "an unpadded base64-shaped path with a symbol is rejected");
assert(fetchCredentialHit("https://example.com/ghp_AbCdEfGhIjKlMnOpQrStUvWxYz012345",
  "example.com/ghp_AbCdEfGhIjKlMnOpQrStUvWxYz012345"),
  "a GitHub-token-shaped path is rejected");
assert(fetchCredentialHit("https://example.com/?x-api-key=550e8400-e29b-41d4-a716-446655440000",
  "example.com/?x-api-key=550e8400-e29b-41d4-a716-446655440000"), "x-api-key is rejected");
assert(!fetchCredentialHit("https://example.com/posts/2026/05/hello-world", "example.com/posts/2026/05/hello-world"),
  "a normal path is not a credential");
assert(!fetchCredentialHit("https://example.com/?q=hello", "example.com/?q=hello"),
  "a normal query is not a credential");
assert(!fetchCredentialHit("https://example.com/?next=posts/2024/LongCamelTitleNoSeparator",
  "example.com/?next=posts/2024/LongCamelTitleNoSeparator"),
  "a long query value with slashes but no token symbol is not a credential");
assert(!fetchCredentialHit("https://github.com/o/r/blob/0123456789abcdef0123456789abcdef01234567/file.ts",
  "github.com/o/r/blob/0123456789abcdef0123456789abcdef01234567/file.ts"),
  "a 40-character commit SHA is not a credential");
assert(!fetchCredentialHit("https://example.com/550e8400-e29b-41d4-a716-446655440000",
  "example.com/550e8400-e29b-41d4-a716-446655440000"), "a UUID is not a credential");
assert(!fetchCredentialHit("https://en.wikipedia.org/wiki/List_of_countries_by_population",
  "en.wikipedia.org/wiki/List_of_countries_by_population"),
  "a long underscored article title is not a credential");
assert(!fetchCredentialHit("https://en.wikipedia.org/wiki/List_of_countries_by_population_2024",
  "en.wikipedia.org/wiki/List_of_countries_by_population_2024"),
  "an underscored article title with a year suffix is not a credential");
assert(!fetchCredentialHit("https://example.com/AbCdEfGhIj-KlMnOpQr_StUvWxYz012345",
  "example.com/AbCdEfGhIj-KlMnOpQr_StUvWxYz012345"),
  "a slug-like base64url path is not treated as a secret");
assert(!fetchCredentialHit("https://en.wikipedia.org/wiki/ListOfCountriesByPopulation",
  "en.wikipedia.org/wiki/ListOfCountriesByPopulation"),
  "a long camel-case title is not a credential");
assert(!fetchCredentialHit("https://example.com/GettingStartedWithReact19AndVite2024",
  "example.com/GettingStartedWithReact19AndVite2024"), "a long camel-case slug is not a credential");
assert(!fetchCredentialHit("https://example.com/C++ProgrammingForBeginnersWithCmake",
  "example.com/C++ProgrammingForBeginnersWithCmake"), "a C++ path is not a credential");
assert(!fetchCredentialHit("https://example.com/sk-learn-python-in-30-days",
  "example.com/sk-learn-python-in-30-days"), "a sk- word in a path is not a credential");

// ---- user-message tickets ------------------------------------------------
{
  const tickets = extractUserUrlTickets(
    "看这个 https://Example.com/a?utm_source=x 和 example.com/b，还有一句 example.com 只是提一下。" +
    "不要碰 README.md、main.ts 或 foo@bar.com，也别碰 mailto:x@y.com。",
  );
  assert(tickets.includes("example.com/a"), "a scheme URL becomes a ticket with tracking removed");
  assert(tickets.includes("example.com/b"), "a bare host/path becomes a ticket");
  assert(!tickets.some((value) => value.includes("README")), "a markdown file name is not a ticket");
  assert(!tickets.some((value) => value.includes("main.ts")), "a source file name is not a ticket");
  assert(!tickets.includes("example.com"), "a bare hostname mention is not a host/path ticket");
  assert(!tickets.some((value) => value.includes("bar.com")), "an email host is not a ticket");
  assert(!tickets.some((value) => value.includes("y.com")), "mailto is not a ticket");
  const more = extractUserUrlTickets("看 foo.md/docs 和 https://example.com/page?access_token=secret-value");
  assert(more.includes("foo.md/docs"), "a real .md TLD is not mistaken for a file name");
  assert(!more.some((value) => value.includes("access_token")), "a URL carrying a secret is not written as a ticket");
  const chinese = extractUserUrlTickets("读 https://zh.wikipedia.org/wiki/中文条目");
  assert(chinese.includes("zh.wikipedia.org/wiki/%E4%B8%AD%E6%96%87%E6%9D%A1%E7%9B%AE"),
    "a Chinese path survives URL extraction");
  const httpTicket = extractUserUrlTickets("打开 http://example.com/http-only");
  assert(httpTicket.includes("example.com/http-only") && httpTicket.includes("http:example.com/http-only"),
    "an http user URL stores its identity and its scheme marker");
  const parenthesized = extractUserUrlTickets("看 https://en.wikipedia.org/wiki/Mercury_(planet)");
  assert(parenthesized.includes("en.wikipedia.org/wiki/Mercury_(planet)"),
    "a balanced closing parenthesis stays in the URL");
  const adjacent = extractUserUrlTickets("看example.com/a这个");
  assert(adjacent.includes("example.com/a") && !adjacent.some((v) => v.includes("%E8")),
    "Chinese prose immediately after a bare URL is not swallowed");
}

// ---- trust refusal messages ---------------------------------------------
assert(fetchRejectMessage("no_ticket", { host: "docs.example.com", trustAvailable: true }).includes("site:docs.example.com"),
  "an interactive no-ticket refusal teaches a site: query");
assert(fetchRejectMessage("no_ticket", { host: "docs.example.com", trustAvailable: true }).includes("requestTrustFor"),
  "an interactive no-ticket refusal names the trust parameter");
assert(fetchRejectMessage("no_ticket", { host: "docs.example.com", trustAvailable: false }).includes("非交互模式"),
  "a headless no-ticket refusal says it cannot prompt");
assert(!fetchRejectMessage("no_ticket", { host: "docs.example.com", trustAvailable: false }).includes("requestTrustFor"),
  "a headless refusal does not suggest a parameter that cannot work");
assert(fetchRejectMessage("no_ticket", { host: "docs.example.com", trustAvailable: true, trustRefused: true })
  .includes("信任这条路已经用完了"),
  "an answered host or an exhausted allowance is not invited to ask again");
assert(!fetchRejectMessage("no_ticket", { host: "docs.example.com", trustAvailable: true, trustRefused: true })
  .includes("还搜不到的话"),
  "an answered host drops the requestTrustFor suggestion entirely");
assert(fetchRejectMessage("trust_declined", { host: "docs.example.com" }).includes("docs.example.com"),
  "a declined trust refusal names the domain");
assert(fetchRejectMessage("trust_write_failed", { host: "docs.example.com" }).includes("docs.example.com")
  && fetchRejectMessage("trust_write_failed", { host: "docs.example.com" }).includes("别再问了"),
  "a failed ticket write tells the model not to ask again");
assert(fetchRejectMessage("trust_prompt_limit").includes("不再弹确认"),
  "a trust prompt over the run allowance says no more prompts");
assert(fetchRejectMessage("trust_prompt_limit").includes(String(FETCH_LIMITS.maxTrustPrompts)),
  "the prompt-limit refusal names how many questions the run allowed");

assert(makeRequestUrl("example.com/a") === "https://example.com/a", "a stored identity gains https on the wire");
assert(makeRequestUrl("https://example.com/a") === "https://example.com/a", "an explicit scheme is left alone");
assert(makeRequestUrl("example.com/a", "http") === "http://example.com/a",
  "a user-typed http URL keeps its scheme");
assert(makeRequestUrl("example.com/a") === "https://example.com/a",
  "a bare user URL still becomes https");

assert(requestUrlFor("http://www.example.com/x", "example.com/x", false) === "https://example.com/x",
  "an http URL without an http ticket is read on https from the normalized identity");
assert(requestUrlFor("http://www.example.com/x", "example.com/x", true) === "http://www.example.com/x",
  "an http user ticket keeps the raw http URL");
assert(requestUrlFor("https://www.example.com/x", "example.com/x", false) === "https://www.example.com/x",
  "an explicit https URL keeps its host spelling");
assert(requestUrlFor("www.example.com/x", "example.com/x", false) === "https://example.com/x",
  "a bare URL uses the normalized identity");

console.log("fetch-admission.test.ts: " + passed + " passed, " + failed + " failed");
if (failed > 0) process.exit(1);
