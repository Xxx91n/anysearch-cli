// ADR-0055 golden cases: five-state truth table, canonicalVersion byte-equality,
// deny channel, atomic write, mtime reloader, strict-enum switch.
// Run: npx tsx packages/store/test/url-policy.test.ts

import { mkdirSync, writeFileSync, readFileSync, existsSync, utimesSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  ENV_URL_ALLOWLIST,
  ENV_ALLOW_OVERRIDE,
  parseEnvOverrideSwitch,
  parseEnvHosts,
  canonicalizeHosts,
  mergeAllowlist,
  canonicalVersion,
  resolveUrlPolicy,
  resolvePolicyFromSchema,
  loadPolicyFromToml,
  atomicWriteFile,
  createDomainReloader,
} from "../src/url-policy";

let passed = 0;
let failed = 0;
function assert(label: string, cond: boolean) {
  if (cond) { passed++; } else { failed++; console.error("FAIL: " + label); }
}

// --- canonical basics (D6) ---
assert("canonicalize trims/lowercases/sorts/dedupes",
  canonicalizeHosts(["B.com", " a.com", "A.COM", ""]).join(",") === "a.com,b.com");
assert("mergeAllowlist is a canonical union (append-only)",
  mergeAllowlist(["a.com"], ["B.com", "a.com"]).join(",") === "a.com,b.com");
assert("canonicalVersion stable regardless of input order/case",
  canonicalVersion(["B.com", "a.com"], ["x.com"]) === canonicalVersion(["A.COM", " b.com "], [" X.com"]));

// --- strict-enum switch (D7 state 5) ---
assert("switch accepts 1/true/0/false",
  parseEnvOverrideSwitch("1") && parseEnvOverrideSwitch("TRUE") &&
  !parseEnvOverrideSwitch("0") && !parseEnvOverrideSwitch(undefined));
{
  let threw = "";
  try { parseEnvOverrideSwitch("yes"); } catch (e) { threw = (e as Error).message; }
  assert("misset switch throws naming variable + value",
    threw.includes(ENV_ALLOW_OVERRIDE) && threw.includes("yes"));
}

// --- five-state truth table (D7) ---
const toml = ["ok.example.com"];
const s1 = resolveUrlPolicy({ tomlHosts: toml, env: {} as NodeJS.ProcessEnv });
assert("state1: TOML authoritative", s1.allow.join(",") === "ok.example.com" && s1.policyVersion.length === 64);

const s2 = resolveUrlPolicy({ tomlHosts: toml, env: { [ENV_URL_ALLOWLIST]: "evil.com" } as NodeJS.ProcessEnv });
assert("state2: env set, switch off -> env IGNORED", s2.envHostsIgnored && s2.allow.join(",") === "ok.example.com");
assert("state2: policy_version == state1", s2.policyVersion === s1.policyVersion);

const s3 = resolveUrlPolicy({ tomlHosts: toml, env: { [ENV_URL_ALLOWLIST]: "dev.example.org", [ENV_ALLOW_OVERRIDE]: "true" } as NodeJS.ProcessEnv });
assert("state3: switch on -> TOML union env",
  s3.allow.join(",") === "dev.example.org,ok.example.com" && s3.envHostsApplied === 1);
assert("state3: env participates in hash (drift visible)", s3.policyVersion !== s1.policyVersion);

const s4 = resolveUrlPolicy({ tomlHosts: toml, env: { [ENV_URL_ALLOWLIST]: "  ", [ENV_ALLOW_OVERRIDE]: "1" } as NodeJS.ProcessEnv });
assert("state4: empty env with switch on == state1", s4.allow.join(",") === s1.allow.join(","));
assert("state4 GOLDEN: policy_version byte-equal to state1 (no cache thrash)", s4.policyVersion === s1.policyVersion);

{
  let threw = "";
  try { resolveUrlPolicy({ tomlHosts: toml, env: { [ENV_ALLOW_OVERRIDE]: "maybe" } as NodeJS.ProcessEnv }); } catch (e) { threw = (e as Error).message; }
  assert("state5: unrecognized switch value -> fail-closed refuse", threw.includes(ENV_ALLOW_OVERRIDE) && threw.includes("maybe"));
}

// --- deny channel (D2) via schema ---
{
  const p = resolvePolicyFromSchema({ sources: { enabled: [], urlAllowlist: ["a.com"], urlDenylist: ["evil.com"] } }, {} as NodeJS.ProcessEnv);
  assert("deny channel resolved from schema", p.deny.join(",") === "evil.com");
  assert("deny participates in policy_version", p.policyVersion !== resolvePolicyFromSchema({ sources: { enabled: [], urlAllowlist: ["a.com"] } }, {} as NodeJS.ProcessEnv).policyVersion);
}

// --- TOML round-trip + urlDenylist through the loader ---
const tmpDir = join(process.cwd(), ".codex-tmp", "url-policy-test");
mkdirSync(tmpDir, { recursive: true });
const tomlPath = join(tmpDir, "dom.toml");
writeFileSync(tomlPath, [
  'name = "poltest"',
  "[skills]",
  'active = ["search"]',
  "[sources]",
  'enabled = ["tavily"]',
  'urlAllowlist = ["ok.example.com"]',
  'urlDenylist = ["evil.com"]',
  "[rag]",
  'adapter = "none"',
  "[hooks]",
  'toolWhitelist = ["ctx_execute"]',
  "",
].join("\n"), "utf8");
const lp = loadPolicyFromToml(tomlPath, {} as NodeJS.ProcessEnv);
assert("TOML round-trip: allow + deny both resolved",
  lp.allow.join(",") === "ok.example.com" && lp.deny.join(",") === "evil.com");

// --- atomic write (D4/D5) ---
const atomicPath = join(tmpDir, "policy.json");
atomicWriteFile(atomicPath, "{\"allow\":[]}");
assert("atomicWriteFile materializes content, no .tmp left",
  readFileSync(atomicPath, "utf8") === "{\"allow\":[]}" && !existsSync(atomicPath + ".tmp"));

// --- mtime reloader (D5) ---
const rel = createDomainReloader(tomlPath);
assert("reloader: unchanged mtime -> null", rel() === null);
writeFileSync(tomlPath, readFileSync(tomlPath, "utf8").replace("ok.example.com", "ok2.example.com"), "utf8");
const future = Date.now() / 1000 + 2;
utimesSync(tomlPath, future, future);
const reloaded = rel();
assert("reloader: changed mtime -> reloaded schema", reloaded === null ? false : (reloaded.sources.urlAllowlist ?? []).join(",") === "ok2.example.com");
rmSync(tmpDir, { recursive: true, force: true });

console.log("url-policy tests: " + passed + " passed, " + failed + " failed");
if (failed > 0) process.exit(1);
