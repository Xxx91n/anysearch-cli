// golden: hook readPolicy pull-through semantics (+ cache integrity, failing-server fallback).
// Run: npx tsx apps/plugin/test/policy.test.ts
import { mkdtempSync, mkdirSync, realpathSync, statSync, writeFileSync, rmSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalVersion } from "@anysearch-cli/store";
import { readPolicy, makePreToolUseDecision } from "../src/hooks/preheat.js";

let passed = 0;
let failed = 0;
function assert(label: string, cond: boolean) {
  if (cond) { passed++; } else { failed++; console.error("FAIL: " + label); }
}

const DEAD = "http://127.0.0.1:1"; // nothing listens; connection refused fast
const dir = mkdtempSync(join(tmpdir(), "ans-policy-test-"));
const prevCwd = process.cwd();
const prevEnv = {
  HOME: process.env.HOME,
  USERPROFILE: process.env.USERPROFILE,
  ANS_SERVER_URL: process.env.ANS_SERVER_URL,
  ANS_SERVER_TOKEN: process.env.ANS_SERVER_TOKEN,
  ANS_SERVER_REGISTRY: process.env.ANS_SERVER_REGISTRY,
};
process.chdir(dir);
// The hook resolves the project before it reads any policy: without a project
// marker every URL question is "project identity unknown" (ask). This fixture
// is the project under test.
mkdirSync(join(dir, ".ans"), { recursive: true });
writeFileSync(join(dir, ".ans", "config.toml"), "", "utf8");
// Keep the installation token/address out of the operator's home and
// pin the endpoint at a dead port so a real local server cannot answer. The home
// is its own directory: pointing it at the project would make the project the
// user root, which is not a project identity the product recognizes.
const fakeHome = join(dir, "home");
mkdirSync(fakeHome, { recursive: true });
process.env.HOME = fakeHome;
process.env.USERPROFILE = fakeHome;
process.env.ANS_SERVER_URL = DEAD;
process.env.ANS_SERVER_TOKEN = "policy-test-token";
delete process.env.ANS_SERVER_REGISTRY;

// #306: the project's declaration the cache is materialized from. Its version
// is what makes the cache provably still applicable, so the fixture has to have
// one — a cache with no source cannot be confirmed and is rejected.
const domainToml = join(realpathSync(dir), "domains", "default.toml");
mkdirSync(join(realpathSync(dir), "domains"), { recursive: true });
writeFileSync(domainToml, [
  'name = "default"',
  '[rag]',
  'adapter = "none"',
  '',
].join("\n"), "utf8");
function tomlVersion(): string {
  const s = statSync(domainToml);
  return s.mtimeMs + ":" + s.ctimeMs;
}

const GOOD = { allow: ["good.example"], deny: ["denied.example"] };
const goodPolicy = { ...GOOD, policy_version: canonicalVersion(GOOD.allow, GOOD.deny) };
const cacheFile = join(realpathSync(dir), ".ans", "policy.json");
function writeCache(p: unknown) {
  mkdirSync(join(realpathSync(dir), ".ans"), { recursive: true });
  writeFileSync(cacheFile, JSON.stringify(p), "utf8");
}
// The envelope the server writes: policy body + where it came from.
function envelope(body: { allow: string[]; deny: string[]; policy_version: string }, overrides: Record<string, unknown> = {}) {
  return {
    ...body,
    materialized_at: new Date().toISOString(),
    project_root: realpathSync(dir),
    domain_name: "default",
    sources: [{ path: domainToml, version: tomlVersion() }],
    ...overrides,
  };
}

const input = (url: string) => ({
  event: "PreToolUse" as const,
  toolName: "ans_search_web",
  toolInput: { query: "see " + url },
  projectPath: dir,
  sessionId: "s1",
});

async function withServer(status: number, body: unknown, fn: (url: string) => Promise<void>) {
  const srv = createServer((req: IncomingMessage, res: ServerResponse) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const addr = srv.address();
  const url = "http://127.0.0.1:" + (typeof addr === "object" && addr ? addr.port : 0);
  try { await fn(url); } finally { await new Promise((r) => srv.close(() => r(undefined))); }
}

async function main() {
  // 1. no cache + server unreachable -> null (D4 fail-closed on the caller side)
  const p1 = await readPolicy(DEAD, "", dir);
  assert("no cache + server down -> null", p1 === null);

  const d1 = await makePreToolUseDecision(input("https://unknown-site.example/path"));
  assert("no policy + URL -> ask (fail-closed)", d1.permission === "ask");

  // 2. good cache (integrity-verifiable, still applicable): consumed when server is down
  writeCache(envelope(goodPolicy));
  const p2 = await readPolicy(DEAD, "", dir);
  assert("good cache consumed when server down", p2 !== null && p2.policy_version === goodPolicy.policy_version);
  assert("cache answer says it came from the cache", p2?.from === "cache");
  assert("cache answer carries its materialized_at", typeof p2?.materialized_at === "string");

  const dAllow = await makePreToolUseDecision(input("https://good.example/x"));
  assert("allowed host -> no ask/deny", dAllow.permission === undefined);

  // 3. deny channel overrides even an allow match (D2)
  const dDeny = await makePreToolUseDecision(input("https://denied.example/x"));
  assert("deny overrides allow -> deny", dDeny.permission === "deny");

  const dAsk = await makePreToolUseDecision(input("https://other.example/x"));
  assert("unallowed host -> ask", dAsk.permission === "ask");

  // 4. tampered cache: content replaced but self-declared version kept -> rejected
  writeCache(envelope({ allow: [], deny: [], policy_version: goodPolicy.policy_version }));
  const p4 = await readPolicy(DEAD, "", dir);
  assert("tampered cache (hash mismatch) -> null, fail-closed", p4 === null);

  // 4b. #306: a cache written for another project is not this project's answer.
  writeCache(envelope(goodPolicy, { project_root: join(tmpdir(), "some-other-project") }));
  assert("cache from another project -> null", (await readPolicy(DEAD, "", dir)) === null);

  // 4c. #306: a TOML edited after materialization makes the cache unconfirmable.
  writeCache(envelope(goodPolicy, { sources: [{ path: domainToml, version: "0:0" }] }));
  assert("cache whose declaration changed -> null", (await readPolicy(DEAD, "", dir)) === null);

  // 4c2. #306: same project, same untouched files, a different Active Domain —
  // the cached allowlist belongs to the declaration the project no longer uses.
  writeCache(envelope(goodPolicy, { domain_name: "other" }));
  assert("cache from another Active Domain -> null", (await readPolicy(DEAD, "", dir)) === null);

  // 4d. #306: an envelope with no provenance cannot be confirmed for anyone.
  writeCache(goodPolicy);
  assert("cache without provenance -> null", (await readPolicy(DEAD, "", dir)) === null);

  // 4e2. #306: when the cache ALLOWS a host there is no ask and no deny, so the
  // notice has to ride additionalContext — otherwise the user never learns that
  // a snapshot, not the current declaration, let it through.
  writeCache(envelope(goodPolicy));
  const dAllowedFromCache = await makePreToolUseDecision(input("https://good.example/x"));
  assert("allowed-from-cache carries a notice",
    dAllowedFromCache.permission === undefined &&
    String(dAllowedFromCache.additionalContext ?? "").includes("缓存"));

  // 4e. the ask reason names the cache when a cached rule is what asked.
  writeCache(envelope(goodPolicy));
  const dCached = await makePreToolUseDecision(input("https://other.example/x"));
  assert("cached-policy ask mentions the cache",
    dCached.permission === "ask" && String(dCached.permissionReason).includes("缓存"));

  // restore the good cache for the remaining steps
  writeCache(envelope(goodPolicy));

  // 5. server reachable: fresh response is authoritative even when versions match
  const fresh = { allow: ["fresh.example"], deny: [], policy_version: canonicalVersion(["fresh.example"], []) };
  await withServer(200, fresh, async (url) => {
    // poison the cache
    writeCache(envelope({ allow: ["stale.example"], deny: ["stale.example"], policy_version: canonicalVersion(["stale.example"], ["stale.example"]) }));
    const p = await readPolicy(url, "", dir);
    assert("server reachable -> fresh wins (no version-equal early return)", p !== null && p.allow.join() === "fresh.example");
  });

  // 6. server reachable but failing (5xx): falls back to good cache, not null
  await withServer(500, { error: "policy parse failed" }, async (url) => {
    writeCache(envelope(goodPolicy));
    const p = await readPolicy(url, "", dir);
    assert("5xx + good cache -> cache fallback", p !== null && p.policy_version === goodPolicy.policy_version);
  });

  // 7. a project without its own cache does not borrow this project's cache
  const other = mkdtempSync(join(tmpdir(), "ans-policy-other-"));
  try {
    const pOther = await readPolicy(DEAD, "", other);
    assert("other project + server down -> no borrowed cache", pOther === null);
  } finally { rmSync(other, { recursive: true, force: true }); }

  process.chdir(prevCwd);
  for (const [key, value] of Object.entries(prevEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(dir, { recursive: true, force: true });

  console.log("plugin policy tests: " + passed + " passed, " + failed + " failed");
  if (failed > 0) process.exit(1);
}
main();
