// R86 T2 / D-003: provider-error-class taxonomy — eval artifacts record an
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
