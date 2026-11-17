// golden: hook readPolicy pull-through semantics (+ cache integrity, failing-server fallback).
// Run: npx tsx apps/plugin/test/policy.test.ts
import { mkdtempSync, mkdirSync, realpathSync, writeFileSync, rmSync } from "node:fs";
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
mkdirSync(join(dir, ".anysearch"), { recursive: true });
writeFileSync(join(dir, ".anysearch", "config.toml"), "", "utf8");
// Keep the installation token/address out of the operator's home and
// pin the endpoint at a dead port so a real local server cannot answer.
process.env.HOME = dir;
process.env.USERPROFILE = dir;
process.env.ANS_SERVER_URL = DEAD;
process.env.ANS_SERVER_TOKEN = "policy-test-token";
delete process.env.ANS_SERVER_REGISTRY;

const GOOD = { allow: ["good.example"], deny: ["denied.example"] };
const goodPolicy = { ...GOOD, policy_version: canonicalVersion(GOOD.allow, GOOD.deny) };
const cacheFile = join(realpathSync(dir), ".anysearch-cli", "policy.json");
function writeCache(p: unknown) {
  mkdirSync(join(realpathSync(dir), ".anysearch-cli"), { recursive: true });
  writeFileSync(cacheFile, JSON.stringify(p), "utf8");
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

  // 2. good cache (integrity-verifiable): consumed when server is down
  writeCache(goodPolicy);
  const p2 = await readPolicy(DEAD, "", dir);
  assert("good cache consumed when server down", p2 !== null && p2.policy_version === goodPolicy.policy_version);

  const dAllow = await makePreToolUseDecision(input("https://good.example/x"));
  assert("allowed host -> no ask/deny", dAllow.permission === undefined);

  // 3. deny channel overrides even an allow match (D2)
  const dDeny = await makePreToolUseDecision(input("https://denied.example/x"));
  assert("deny overrides allow -> deny", dDeny.permission === "deny");

  const dAsk = await makePreToolUseDecision(input("https://other.example/x"));
  assert("unallowed host -> ask", dAsk.permission === "ask");

  // 4. tampered cache: content replaced but self-declared version kept -> rejected
  writeCache({ allow: [], deny: [], policy_version: goodPolicy.policy_version });
  const p4 = await readPolicy(DEAD, "", dir);
  assert("tampered cache (hash mismatch) -> null, fail-closed", p4 === null);

  // restore the good cache for the remaining steps
  writeCache(goodPolicy);

  // 5. server reachable: fresh response is authoritative even when versions match
  const fresh = { allow: ["fresh.example"], deny: [], policy_version: canonicalVersion(["fresh.example"], []) };
  await withServer(200, fresh, async (url) => {
    // poison the cache
    writeCache({ allow: ["stale.example"], deny: ["stale.example"], policy_version: canonicalVersion(["stale.example"], ["stale.example"]) });
    const p = await readPolicy(url, "", dir);
    assert("server reachable -> fresh wins (no version-equal early return)", p !== null && p.allow.join() === "fresh.example");
  });

  // 6. server reachable but failing (5xx): falls back to good cache, not null
  await withServer(500, { error: "policy parse failed" }, async (url) => {
    writeCache(goodPolicy);
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
