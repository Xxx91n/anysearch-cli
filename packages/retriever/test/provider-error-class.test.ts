// provider-error-class taxonomy — eval artifacts record an
// error CATEGORY beside the failed flag, never the flag alone. Table-driven
// over the String(err) seam form ("Name: message").
import { classifyProviderError } from "../src/contract";

let passed = 0, failed = 0;
function expect(got: string, want: string, input: string) {
  if (got !== want) { failed++; console.error("FAIL classify(" + JSON.stringify(input) + "): got " + got + ", want " + want); }
  else passed++;
}

const cases: Array<[string, string]> = [
  ["Error: AnySearch MCP tools/call HTTP 500 Internal Server Error", "transient"],
  ["Error: AnySearch MCP tools/call HTTP 503 Service Unavailable", "transient"],
  ["Error: AnySearch MCP initialize HTTP 429 Too Many Requests", "transient"],
  ["TypeError: fetch failed", "transient"],
  ["Error: connect ETIMEDOUT 203.0.113.7:443", "transient"],
  ["Error: AnySearch MCP initialize HTTP 401 Unauthorized", "permanent-auth"],
  ["Error: AnySearch MCP tools/call HTTP 403 Forbidden", "permanent-auth"],
  ["Error: AnySearch MCP tools/call isError: invalid_api_key", "permanent-auth"],
  ["Error: AnySearch MCP tools/call quota/auth nudge: upstream issued a provisioning reply instead of results (anonymous quota boundary — set ANYSEARCH_API_KEY)", "permanent-auth"],
  // r19 T2 (STOP-20 regression): a rate-limit/quota notice in the reply body is
  // transient — the key is valid; retry later. Only the provisioning reply is auth.
  ["Error: AnySearch MCP tools/call rate limited: upstream returned a rate-limit/quota notice instead of results (retry later)", "transient"],
  ["Error: AnySearch MCP tools/call isError: rate limit exceeded, please slow down", "transient"],
  // #294: Tavily answers an exhausted plan with HTTP 432 and a plain-text
  // body; @tavily/core rethrows it with no status, so only the text is left.
  // The key is valid — top up or upgrade, do not rotate the key or retry.
  ["Error: This request exceeds your plan's set usage limit. Please upgrade your plan or contact support@tavily.com", "quota-exhausted"],
  ["Error: Tavily API HTTP 432: quota exceeded for this billing period", "quota-exhausted"],
  ["Error: insufficient credits remaining on this account", "quota-exhausted"],
  ["Error: you are out of credits", "quota-exhausted"],
  // Retryable shapes win over the quota word list: a throttle that also says
  // "usage limit" is still transient, not an exhausted plan.
  ["Error: HTTP 429 Too Many Requests: usage limit exceeded, retry after 30s", "transient"],
  ["Error: HTTP 503 Service Unavailable: usage limit temporarily exceeded", "transient"],
  ["SessionExpiredError: AnySearch MCP tools/call HTTP 404 (session terminated)", "session-expired"],
  ["Error: AnySearch MCP tools/call malformed text (no '## Search Results' header)", "permanent-protocol"],
  ["Error: AnySearch MCP initialize malformed reply (no result object)", "permanent-protocol"],
  ["Error: AnySearch MCP tools/call reply id mismatch (expected 3, got 7)", "permanent-protocol"],
  ["Error: AnySearch MCP search unexpected Content-Type: text/html", "permanent-protocol"],
  ["Error: AnySearch MCP search HTTP 404 Not Found", "permanent-protocol"],
  ["Error: AnySearch MCP tools/call returned no text content", "permanent-protocol"],
  ["Error: fail1 failed", "unknown"],
  ["Error: something exotic happened", "unknown"],
];
for (const [input, want] of cases) expect(classifyProviderError(input), want, input);
console.log("--- provider-error-class: " + passed + " passed, " + failed + " failed ---");
if (failed > 0) process.exit(1);
