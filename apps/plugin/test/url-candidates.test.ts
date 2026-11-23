// Which bits of free text we treat as URLs, and which we refuse to guess at.
//
// The URL policy used to see only strings that already had `http(s)://` in them,
// so `query: "查一下 example.com/a"` slipped past allow/deny entirely. Widening
// that eye has one hard constraint: never mistake a file name, a version, an IP
// or an email for a domain, or every search starts looking at hosts the user
// never named.
//
// Run: npx tsx apps/plugin/test/url-candidates.test.ts

import assert from "node:assert/strict";
import { hostCandidates, toolInputCandidates } from "../src/hooks/url-candidates.js";
import { TLD_SNAPSHOT, TLD_SNAPSHOT_VERSION } from "../src/hooks/tlds.generated.js";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log("  PASS " + name); } catch (e) {
    failed++;
    console.error("  FAIL " + name + ": " + (e instanceof Error ? e.message : String(e)));
  }
}

/** Hosts only, in order — most assertions here care about which hosts, not the raw text. */
function hosts(text: string): string[] {
  return hostCandidates(text).map((c) => c.host);
}

test("a bare domain with a path is a host", () => {
  assert.deepEqual(hostCandidates("查一下 example.com/a"), [{ host: "example.com", raw: "example.com/a" }]);
});

test("port, uppercase, trailing dot and punycode all resolve to the same host", () => {
  // `www.` stays: a policy entry for `www.example.com` must keep matching, and
  // `example.com` still matches it through the suffix rule.
  assert.deepEqual(hosts("www.example.com"), ["www.example.com"]);
  assert.deepEqual(hosts("example.com:8080"), ["example.com"]);
  assert.deepEqual(hosts("EXAMPLE.COM"), ["example.com"]);
  assert.deepEqual(hosts("example.com."), ["example.com"]);
  assert.deepEqual(hosts("xn--r8jz45g.xn--fiqs8s"), ["xn--r8jz45g.xn--fiqs8s"]);
});

test("an explicit http(s) URL is a host, path and query stripped", () => {
  assert.deepEqual(hostCandidates("看 https://Example.COM/a?b=1#c 这个"), [{ host: "example.com", raw: "https://Example.COM/a?b=1#c" }]);
  assert.deepEqual(hosts("http://example.com"), ["example.com"]);
});

test("a unicode host with a scheme is punycoded by URL, not dropped", () => {
  assert.deepEqual(hosts("https://例え.中国/a"), ["xn--r8jz45g.xn--fiqs8s"]);
});

test("an explicit URL is a host however odd the hostname is", () => {
  // These were judged before this module existed; the inference rules below must
  // not take that away.
  assert.deepEqual(hosts("http://localhost:3000/x"), ["localhost"]);
  assert.deepEqual(hosts("http://intranet/"), ["intranet"]);
  assert.deepEqual(hosts("http://[::1]/logs"), ["[::1]"]);
  assert.deepEqual(hosts("http://my_host.example/x"), ["my_host.example"]);
  assert.deepEqual(hosts("http://example.com./a"), ["example.com"]);
  assert.deepEqual(hosts("http://example.com../a"), ["example.com"]);
});

test("a double slash is not a scheme, so the host after it is still read", () => {
  assert.deepEqual(hosts("查 //denied.com/x"), ["denied.com"]);
});

test("a URL the parser rejects keeps its host", () => {
  // Bad port and stray characters make `new URL()` throw; the authority is still
  // a host the policy has to see.
  assert.deepEqual(hosts("http://denied.com:999999/x"), ["denied.com"]);
  assert.deepEqual(hosts("https://denied.com/%zz"), ["denied.com"]);
});

test("a search operator is not a scheme, so its host is judged", () => {
  // `site:` is how people narrow a search; skipping it would hide the host.
  assert.deepEqual(hosts("site:denied.com 财报"), ["denied.com"]);
});

test("a non-http scheme does not smuggle its host in through the bare pass", () => {
  assert.deepEqual(hosts("ftp://example.com/a"), []);
  assert.deepEqual(hosts("mailto:example.com"), []);
  assert.deepEqual(hosts("mailto:someone@example.com"), []);
  assert.deepEqual(hosts("ssh:example.com/a"), []);
});

test("a bare unicode domain is deliberately not handled", () => {
  assert.deepEqual(hosts("例え.中国/a"), []);
});

test("file names, versions, IPs, emails, localhost and placeholders are not hosts", () => {
  for (const text of [
    "main.py", "README.md", "config.toml", "src/main.py",
    "main.tf", "model.ml", "app.pm", "deploy.ps", "Makefile.mk", "schema.tf",
    "Makefile.in", "configure.ac", "Makefile.am", "foo.mo", "libfoo.la", "main.mm", "app.as",
    "Hello.java", "crystal.cr", "top.sv", "config.inc", "header.inc",
    "bundle.js.map", "build.ninja", "Safari.app",
    "v1.2", "1.2.3", "1.2.3.4", "1.2.3.4:8080",
    "foo@bar.com", "user:pass@example.com",
    "localhost", "localhost:3000",
    "foo.bar", "some.thing.bar",
  ]) {
    assert.deepEqual(hosts(text), [], text + " must not be read as a host");
  }
});

test("a path or a port is a strong signal, so those forms are still read", () => {
  assert.deepEqual(hosts("main.py/a"), ["main.py"]);
  assert.deepEqual(hosts("main.py:8080"), ["main.py"]);
});

test("trailing punctuation is trimmed, paired brackets inside the path are kept", () => {
  assert.deepEqual(hosts("(example.com/a)."), ["example.com"]);
  assert.deepEqual(hosts("example.com/a,"), ["example.com"]);
  assert.deepEqual(hosts("see example.com/wiki/Foo_(bar)"), ["example.com"]);
});

test("CJK glued to the URL is not swallowed", () => {
  assert.deepEqual(hostCandidates("看example.com/a这个"), [{ host: "example.com", raw: "example.com/a" }]);
});

test("the same host twice is reported once", () => {
  assert.deepEqual(hosts("example.com/a 和 https://example.com/b"), ["example.com"]);
});

test("only the fields that leave the machine are scanned", () => {
  const hostsOf = (toolName: string, toolInput: Record<string, unknown>) =>
    toolInputCandidates(toolName, toolInput).map((c) => c.host);

  assert.deepEqual(hostsOf("mcp__anysearch__search_web", { query: "example.com/a" }), ["example.com"]);
  assert.deepEqual(hostsOf("mcp__anysearch__research_web", { question: "example.com/a 怎么样" }), ["example.com"]);
  assert.deepEqual(hostsOf("mcp__anysearch__ans_chat", { message: "看看 example.com/a" }), ["example.com"]);
  // Hosts prefix tool names in their own ways; any of these reaches the fields.
  assert.deepEqual(hostsOf("ans_search_web", { query: "example.com/a" }), ["example.com"]);
  assert.deepEqual(hostsOf("x_search_web", { query: "example.com/a" }), ["example.com"]);
  assert.deepEqual(
    hostsOf("mcp__anysearch__search_web", { query: "x", verticalParams: { site: "example.com/a", n: 3 } }),
    ["example.com"],
  );
  assert.deepEqual(
    hostsOf("mcp__anysearch__search_web", { query: "x", verticalParams: { filters: { site: "example.com/a" } } }),
    ["example.com"],
    "nested parameters are still text that leaves the machine",
  );
});

test("local-index tools are not scanned: their text never leaves the machine", () => {
  for (const toolName of ["mcp__anysearch__recall_memory", "mcp__anysearch__query_knowledge"]) {
    assert.deepEqual(toolInputCandidates(toolName, { query: "https://example.com/a" }), [], toolName);
    assert.deepEqual(toolInputCandidates(toolName, { query: "example.com/a" }), [], toolName);
  }
});

test("non-text fields and opaque handles are not scanned", () => {
  assert.deepEqual(
    toolInputCandidates("mcp__anysearch__recall_memory", { projectPaths: ["/home/x/example.com/a"], limit: 3 }),
    [],
  );
  assert.deepEqual(toolInputCandidates("mcp__anysearch__ans_chat", { sessionId: "example.com/a" }), []);
});

test("the committed TLD snapshot is well formed", () => {
  const tlds = [...TLD_SNAPSHOT];
  assert.ok(tlds.length > 1000, "snapshot looks truncated: " + tlds.length);
  assert.equal(new Set(tlds).size, tlds.length, "entries must be unique");
  assert.deepEqual(tlds, [...tlds].sort(), "entries must be sorted, so a refresh diffs cleanly");
  for (const tld of tlds) assert.match(tld, /^[a-z0-9-]+$/, "not a lowercased label: " + tld);
  assert.ok(TLD_SNAPSHOT.has("com") && TLD_SNAPSHOT.has("xn--fiqs8s"), "punycode TLDs must survive the lowercasing");
  assert.match(TLD_SNAPSHOT_VERSION, /^\d{10}$/, "version comes from the IANA header");
});

process.on("exit", () => {
  console.log("  url-candidates: " + passed + " passed, " + failed + " failed");
  if (failed > 0) process.exitCode = 1;
});
