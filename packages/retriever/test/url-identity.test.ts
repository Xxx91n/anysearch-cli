// One URL identity for search dedup and archive writes.
import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeUrlIdentity, pickUnseenUrlResults } from "../src/url-identity";

test("scheme, www, trailing dot, standard port, tracking and fragment fold to one identity", () => {
  const spellings = [
    "https://example.com/x",
    "example.com/x",
    "example.com.:443/x?utm_source=a#frag",
  ];
  assert.deepEqual(spellings.map(normalizeUrlIdentity), [
    "example.com/x",
    "example.com/x",
    "example.com/x",
  ]);
});

test("the two standard web ports are not part of the identity", () => {
  assert.equal(normalizeUrlIdentity("http://example.com:80/x"), "example.com/x");
  assert.equal(normalizeUrlIdentity("https://example.com:443/x"), "example.com/x");
  assert.equal(normalizeUrlIdentity("http://example.com:443/x"), "example.com/x");
  assert.equal(normalizeUrlIdentity("https://example.com:80/x"), "example.com/x");
  assert.equal(normalizeUrlIdentity("https://example.com/x"), "example.com/x");
});

test("a non-standard port and the path/query bytes are kept", () => {
  assert.equal(normalizeUrlIdentity("https://example.com:8080/Case?b=2&a=1"), "example.com:8080/Case?b=2&a=1");
  assert.equal(
    normalizeUrlIdentity("https://example.com/x?a=1&utm_source=news&b=2"),
    "example.com/x?a=1&b=2",
  );
});

test("removing a tracking parameter does not re-encode the rest of the query", () => {
  assert.equal(normalizeUrlIdentity("https://example.com/x?q=a%20b&utm_source=news"), "example.com/x?q=a%20b");
  assert.equal(normalizeUrlIdentity("https://example.com/x?q=a+b&utm_source=news"), "example.com/x?q=a+b");
  assert.equal(normalizeUrlIdentity("https://example.com/x?q=a%20b"), "example.com/x?q=a%20b");
});

test("the identity is idempotent", () => {
  const cases = [
    "http://example.com:443/x?utm_source=a#frag",
    "https://example.com.:80/x",
    "example.com:8080/x?q=a%20b",
  ];
  for (const raw of cases) {
    const once = normalizeUrlIdentity(raw);
    assert.equal(normalizeUrlIdentity(once), once, "second pass changed " + raw);
  }
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

test("pickUnseenUrlResults folds spellings and records only what it returns", () => {
  const seen = new Set([normalizeUrlIdentity("https://example.com/x")]);
  const first = { url: "example.com/x" };
  const second = { url: "https://example.com/y?utm_source=a" };
  const fresh = pickUnseenUrlResults(seen, [first, second]);
  assert.deepEqual(fresh, [second]);
  assert.equal(seen.has(normalizeUrlIdentity(second.url)), true);
});
