// #606: one URL identity for search dedup, archive writes and the fetch path.
import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeUrlIdentity } from "../src/url-identity";

test("scheme, www, trailing dot, default port, tracking and fragment fold to one identity", () => {
  const spellings = [
    "https://example.com/x",
    "example.com/x",
    "example.com.:443/x?utm_source=a#frag",
  ];
  const identities = spellings.map(normalizeUrlIdentity);
  assert.deepEqual(identities, ["example.com/x", "example.com/x", "example.com/x"]);
});

test("http and https with their default ports have the same identity", () => {
  assert.equal(normalizeUrlIdentity("http://example.com:80/x"), "example.com/x");
  assert.equal(normalizeUrlIdentity("https://example.com:443/x"), "example.com/x");
  assert.equal(normalizeUrlIdentity("https://example.com/x"), "example.com/x");
});

test("a non-default port and the path/query bytes are kept", () => {
  assert.equal(normalizeUrlIdentity("https://example.com:8080/Case?b=2&a=1"), "example.com:8080/Case?b=2&a=1");
  assert.equal(
    normalizeUrlIdentity("https://example.com/x?a=1&utm_source=news&b=2"),
    "example.com/x?a=1&b=2",
  );
});

test("a fragment is dropped even when nothing else changes", () => {
  assert.equal(normalizeUrlIdentity("https://example.com/x#section"), "example.com/x");
});

test("a bare host keeps the empty path", () => {
  assert.equal(normalizeUrlIdentity("example.com"), "example.com/");
  assert.equal(normalizeUrlIdentity("www.example.com."), "example.com/");
});

test("non-web and unparseable input keep their trimmed spelling", () => {
  assert.equal(normalizeUrlIdentity("  mailto:a@b.com  "), "mailto:a@b.com");
  assert.equal(normalizeUrlIdentity("ftp://example.com/x"), "ftp://example.com/x");
  assert.equal(normalizeUrlIdentity("   "), "");
});
