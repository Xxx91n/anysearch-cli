// ADR-0055 D4 golden: hook readPolicy pull-through semantics.
// Run: npx tsx apps/plugin/test/policy.test.ts
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readPolicy, makePreToolUseDecision } from "../src/hooks/preheat.js";

let passed = 0;
let failed = 0;
function assert(label: string, cond: boolean) {
  if (cond) { passed++; } else { failed++; console.error("FAIL: " + label); }
}

const DEAD = "http://127.0.0.1:1"; // nothing listens; connection refused fast
const dir = mkdtempSync(join(tmpdir(), "ans-policy-test-"));
const prevCwd = process.cwd();
process.chdir(dir);

const input = (url: string) => ({
  event: "PreToolUse" as const,
  toolName: "ans_search_web",
  toolInput: { query: "see " + url },
  projectPath: dir,
  sessionId: "s1",
});

async function main() {
  // 1. no cache + server unreachable -> null (D4 fail-closed on the caller side)
  const p1 = await readPolicy(DEAD, "");
  assert("no cache + server down -> null", p1 === null);

  const d1 = await makePreToolUseDecision(input("https://unknown-site.example/path"));
  assert("no policy + URL -> ask (fail-closed)", d1.permission === "ask");

  // 2. cache written: consumed when server is down
  mkdirSync(join(dir, ".anysearch-cli"), { recursive: true });
  writeFileSync(
    join(dir, ".anysearch-cli", "policy.json"),
    JSON.stringify({ allow: ["good.example"], deny: ["denied.example"], policy_version: "v1" }),
    "utf8",
  );
  const p2 = await readPolicy(DEAD, "");
  assert("cache consumed when server down", p2 !== null && p2.policy_version === "v1");

  const dAllow = await makePreToolUseDecision(input("https://good.example/x"));
  assert("allowed host -> no ask/deny", dAllow.permission === undefined);

  // 3. deny channel overrides even an allow match (D2)
  const dDeny = await makePreToolUseDecision(input("https://denied.example/x"));
  assert("deny overrides allow -> deny", dDeny.permission === "deny");

  const dAsk = await makePreToolUseDecision(input("https://other.example/x"));
  assert("unallowed host -> ask", dAsk.permission === "ask");

  process.chdir(prevCwd);
  rmSync(dir, { recursive: true, force: true });

  console.log("plugin policy tests: " + passed + " passed, " + failed + " failed");
  if (failed > 0) process.exit(1);
}
main();
