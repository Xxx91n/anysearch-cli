// provider-error-class taxonomy — eval artifacts record an
// error CATEGORY beside the failed flag, never the flag alone. Table-driven
// over the String(err) seam form ("Name: message").
import { classifyProviderError, providerErrorText, retryAfterSeconds } from "../src/contract";
import { keylessLimitErrorFromEnvelope } from "@tavily/core";

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
  // #455: the free quota ending is its own class, not an auth fault. Two shapes:
  // the reply text AnySearch sends, and Tavily's keyless cap whose kind lives on
  // the error object (the bare text still names the SDK's error class).
  ["Error: AnySearch MCP tools/call isError: Your account and API key have been automatically generated. api_key=[redacted]", "free-quota-exhausted"],
  ["Error: AnySearch MCP tools/call free quota exhausted: upstream returned a sign-up/issued-key reply instead of results [provider-error-class:free-quota-exhausted] [upstream text: sign up to get a key]", "free-quota-exhausted"],
  ["TavilyKeylessLimitError: Daily cap reached", "free-quota-exhausted"],
  ["TavilyKeylessLimitError: Daily cap reached (capType=daily_cap_reached, retry-after=3600)", "free-quota-exhausted"],
  // The free quota wins over a 429 that carries it: waiting for the window is
  // part of the remedy, so this is not the ordinary throttle shape.
  ["Error: HTTP 429 Too Many Requests: TavilyKeylessLimitError: daily_cap_reached", "free-quota-exhausted"],
  // ... and the shapes that must NOT become it: an ordinary throttle, a paid
  // plan running out, and a reply that merely mentions a key.
  ["Error: AnySearch MCP tools/call rate limited: upstream returned a rate-limit notice instead of results [provider-error-class:transient] [upstream text: too many requests]", "transient"],
  ["Error: set ANYSEARCH_API_KEY to continue", "unknown"],
  ["Error: AnySearch MCP tools/call quota exhausted: upstream says the account's quota is used up — top up or use a fresh key (retrying will not help) [provider-error-class:quota-exhausted] [upstream text: 今日额度已用完，请明天再试]", "quota-exhausted"],
  // The marker wins over the words echoed after it: a quota wall that also says
  // "rate limit", and a throttle whose text mentions a bad key, keep their real
  // class.
  ["Error: AnySearch MCP tools/call quota exhausted: upstream says the account's quota is used up — top up or use a fresh key (retrying will not help) [provider-error-class:quota-exhausted] [upstream text: daily quota reached, rate limit exceeded]", "quota-exhausted"],
  ["Error: AnySearch MCP tools/call rate limited: upstream returned a rate-limit/quota notice instead of results (retry later) [provider-error-class:transient] [upstream text: invalid_api_key]", "transient"],
  // #440 Exa: exa-js keeps the status on ExaError.statusCode and rethrows only
  // the envelope text, so a bad key arrives as the spaced sentence.
  ["ExaError: Invalid API key. Provide a valid key using 'Authorization: Bearer <key>' or 'x-api-key: <key>' (https://dashboard.exa.ai/api-keys)", "permanent-auth"],
  // 402 has two meanings. Only the structured x402 marks say "no key was sent";
  // the plain quota text is a keyed request out of credits/budget.
  ["ExaError: {\"error\":\"Payment required to access this resource\",\"tag\":\"X402_PAYMENT_REQUIRED\",\"accepts\":[{\"maxTimeoutSeconds\":300}]}", "permanent-auth"],
  ["ExaError: {\"x402Version\":1,\"accepts\":[{\"scheme\":\"exact\"}]}", "permanent-auth"],
  ["ExaError: Payment required to access this resource.", "quota-exhausted"],
  ["Error: Exa API HTTP 402 Payment Required", "quota-exhausted"],
  ["ExaError: Request failed with status 402.", "quota-exhausted"],
  // An explicit auth fault outranks cap wording that happens to share its
  // words: this 403 is a wrong or badly scoped key, not a used-up allowance.
  ["Error: AnySearch MCP tools/call HTTP 403 Forbidden: this API key was issued for a different project", "permanent-auth"],
  // The same fault when the SDK kept the status on the error object: the
  // body never says "HTTP 403", only the capture seam's status field does.
  ["ExaError: your API key was issued for a different project (status=403)", "permanent-auth"],
  ["Error: upstream refused the call (statusCode: 429)", "transient"],
  // Exa's short-window 429 stays transient (#449): a throttle, not a used-up
  // allowance, and #455 deliberately left that classification alone.
  ["Error: Exa MCP tools/call JSON-RPC error -32000: rate limit exceeded (retry-after=1)", "transient"],
  // r19 T2 (STOP-20 regression): a rate-limit/quota notice in the reply body is
  // transient — the key is valid; retry later.
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

// #455: the capture seam. @tavily/core keeps the cap kind and the wait on the
// error object, so String(err) alone loses both; providerErrorText is the form
// the engine stores, and the classifier plus the wait hint read only that text.
function expectValue<T>(got: T, want: T, label: string) {
  if (got !== want) { failed++; console.error("FAIL " + label + ": got " + JSON.stringify(got) + ", want " + JSON.stringify(want)); }
  else passed++;
}
{
  const capped = keylessLimitErrorFromEnvelope({
    error: { code: "daily_cap_reached", message: "Daily cap reached", retry_after_seconds: 3600 },
  });
  const text = providerErrorText(capped);
  expectValue(classifyProviderError(text), "free-quota-exhausted", "real SDK keyless cap classifies free-quota-exhausted");
  expectValue(retryAfterSeconds(text), 3600, "real SDK keyless cap keeps its retry-after");
  expectValue(providerErrorText(capped).includes("capType=daily_cap_reached"), true, "capture seam keeps capType");

  // No wait in the payload: the class still reads right and the hint says
  // "a moment" instead of inventing a number.
  const noWait = keylessLimitErrorFromEnvelope({ error: { code: "daily_cap_reached" } });
  const noWaitText = providerErrorText(noWait);
  expectValue(classifyProviderError(noWaitText), "free-quota-exhausted", "cap without a wait still classifies free-quota-exhausted");
  expectValue(retryAfterSeconds(noWaitText), null, "cap without a wait has no retry-after");

  // The SDK's status is a structured field too: a 403 whose body only says
  // "your API key was issued for a different project" must still read auth.
  const badKey = Object.assign(new Error("your API key was issued for a different project"), { statusCode: 403 });
  const badKeyText = providerErrorText(badKey);
  expectValue(badKeyText.includes("status=403"), true, "capture seam keeps statusCode");
  expectValue(classifyProviderError(badKeyText), "permanent-auth", "a status-only 403 reads permanent-auth");

  // An ordinary Error carries nothing extra, and an ordinary throttle has no
  // wait to hand a free-quota hint.
  expectValue(providerErrorText(new Error("boom")), "Error: boom", "plain Error text stays untouched");
  expectValue(retryAfterSeconds("Error: HTTP 429 Too Many Requests: usage limit exceeded, retry after 30s"), 30, "retry-after parsed from plain text");
}

console.log("--- provider-error-class: " + passed + " passed, " + failed + " failed ---");
if (failed > 0) process.exit(1);
