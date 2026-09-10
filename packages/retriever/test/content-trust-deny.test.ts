// ADR-0055 D2 golden: deny is a first-class channel, evaluated LAST, unbypassable.
// Run: npx tsx packages/retriever/test/content-trust-deny.test.ts
import { shouldAllowUrl } from "../src/content-trust";

let passed = 0;
let failed = 0;
function assert(label: string, cond: boolean) {
  if (cond) { passed++; } else { failed++; console.error("FAIL: " + label); }
}
const retrieved = { source: "retrieved", traceId: "t" } as const;
const user = { source: "user", traceId: "t" } as const;

assert("allow match still allows (no deny)", shouldAllowUrl("https://a.com/x", retrieved, ["a.com"]).allowed === true);
assert("deny overrides allow match", shouldAllowUrl("https://a.com/x", retrieved, ["a.com"], ["a.com"]).allowed === false);
assert("deny overrides allow on subdomain suffix match", shouldAllowUrl("https://deep.a.com/", retrieved, ["a.com"], ["deep.a.com"]).allowed === false);
assert("deny overrides even a user-source label", shouldAllowUrl("https://evil.com/", user, ["evil.com"], ["evil.com"]).allowed === false);
assert("deny verdict is terminal (no HITL escalation)", shouldAllowUrl("https://evil.com/", retrieved, [], ["evil.com"]).requiresHitl === false);
assert("unrelated deny entry does not leak: allow still wins", shouldAllowUrl("https://good.com/", retrieved, ["good.com"], ["evil.com"]).allowed === true);
assert("no allow match still requiresHitl", shouldAllowUrl("https://unknown.com/", retrieved, ["good.com"], ["evil.com"]).requiresHitl === true);
assert("unparseable URL denied without deny match", shouldAllowUrl("not-a-url", retrieved, ["x.com"], ["x.com"]).allowed === false);

console.log("content-trust deny tests: " + passed + " passed, " + failed + " failed");
if (failed > 0) process.exit(1);
