// Self-check for domain-schema deep-merge + resolve + validate.
// Run: npx tsx packages/store/test/domain-schema.test.ts

import { resolve, validate, isDomainSchemaError, type RawDomain } from "../src/domain-schema";
import { loadRawDomain } from "../src/domain-loader";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let passed = 0;
let failed = 0;

function assert(label: string, cond: boolean) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error("FAIL: " + label);
  }
}

// Test 1: settings deep-merge (object keys merge, scalars replace)
const base: RawDomain = {
  name: "base",
  settings: { ui: { theme: "light", font: "mono" }, tools: ["bash"] },
  skills: { active: ["base-skill"] },
  rag: { adapter: "default" },
};
const derived: RawDomain = {
  name: "derived",
  base: "base",
  settings: { ui: { theme: "dark" }, tools: ["bash", "edit"] },
  skills: { active: ["alpha"] },
};

const lookup = (n: string) => n === "base" ? base : undefined;
const result = resolve(derived, lookup);

// settings: deep-merge -> theme replaced, font preserved, tools array replaced
assert("settings.ui.theme is dark", (result.settings.ui as any)?.theme === "dark");
assert("settings.ui.font preserved", (result.settings.ui as any)?.font === "mono");
assert("settings.tools array replaced", JSON.stringify(result.settings.tools) === '["bash","edit"]');

// skills: entire replace -> base-skill gone
assert("skills.active replaced", JSON.stringify(result.skills.active) === '["alpha"]');

// rag: derived has no rag, base rag.adapter preserved
assert("rag.adapter from base", result.rag.adapter === "default");

// name from derived
assert("name is derived", result.name === "derived");

// Test 2: circular inheritance detection
const a: RawDomain = { name: "a", base: "b", rag: { adapter: "x" } };
const b: RawDomain = { name: "b", base: "a", rag: { adapter: "y" } };
const cycleLookup = (n: string) => n === "a" ? a : n === "b" ? b : undefined;
let threw = false;
try { resolve(a, cycleLookup); } catch (e) { threw = true; }
assert("circular inheritance throws", threw);

// Test 3: validate catches missing rag.adapter
const invalid: RawDomain = { name: "invalid" };
const validLookup = (n: string) => n === "invalid" ? invalid : undefined;
let validateThrew = false;
try {
  const r = resolve(invalid, validLookup);
  validate(r);
} catch (e) { validateThrew = true; }
assert("validate catches missing rag.adapter", validateThrew);

// Test 4: validate passes for valid schema
const valid: RawDomain = { name: "valid", rag: { adapter: "test" }, skills: { active: [] }, sources: { enabled: [] }, hooks: { toolWhitelist: [] } };
const validLookup2 = (n: string) => n === "valid" ? valid : undefined;
let validatePassed = true;
try {
  const r = resolve(valid, validLookup2);
  validate(r);
} catch (e) { validatePassed = false; }
assert("validate passes for valid schema", validatePassed);

// Audit M2: policy host lists reject non-hostname entries (fail-closed at load).
// A malformed entry could never match a real host and would silently deaden the policy.
const badAllow = resolve({ name: "h", rag: { adapter: "x" }, sources: { urlAllowlist: ["https://evil.com"] } } as unknown as RawDomain, () => undefined);
let schemeThrew = "";
try { validate(badAllow); } catch (e) { schemeThrew = (e as Error).message; }
assert("urlAllowlist rejects scheme entries, naming field + entry",
  schemeThrew.includes("urlAllowlist") && schemeThrew.includes("https://evil.com"));

const badDeny = resolve({ name: "h2", rag: { adapter: "x" }, sources: { urlDenylist: ["*.evil.com"] } } as unknown as RawDomain, () => undefined);
let wildThrew = "";
try { validate(badDeny); } catch (e) { wildThrew = (e as Error).message; }
assert("urlDenylist rejects wildcard entries", wildThrew.includes("urlDenylist") && wildThrew.includes("*.evil.com"));

const goodHosts = resolve({ name: "ok", rag: { adapter: "x" }, sources: { urlAllowlist: ["Example.COM", "a-b.example.org"] } } as unknown as RawDomain, () => undefined);
let goodOk = true;
try { validate(goodHosts); } catch { goodOk = false; }
assert("valid hostnames pass (case tolerated, canonicalized downstream)", goodOk);

// sources.vertical — parse + resolve chain
// + shape-only validation (no vocabulary enum; unknown values NOT rejected).

// Inheritance: derived restates the whole vertical (section-replace semantics).
const vBase: RawDomain = { name: "vb", rag: { adapter: "x" }, sources: { enabled: [], vertical: { domain: "finance", sub_domain: "calendar" } } };
const vDerived: RawDomain = { name: "vd", base: "vb", rag: { adapter: "x" }, sources: { enabled: [], vertical: { domain: "it_tech" } } };
const vResult = resolve(vDerived, (n) => n === "vb" ? vBase : undefined);
assert("vertical resolved from derived (whole-object replace — base sub_domain does NOT merge)",
  vResult.sources.vertical?.domain === "it_tech" && vResult.sources.vertical?.sub_domain === undefined);
const vInherit = resolve({ name: "vi", base: "vb", rag: { adapter: "x" }, sources: { enabled: [] } } as RawDomain, (n) => n === "vb" ? vBase : undefined);
assert("vertical inherits from base when derived omits it",
  vInherit.sources.vertical?.domain === "finance" && vInherit.sources.vertical?.sub_domain === "calendar");

// Shape checks: empty domain / empty sub_domain rejected; unknown vocab allowed.
const vEmpty = resolve({ name: "ve", rag: { adapter: "x" }, sources: { enabled: [], vertical: { domain: "" } } } as unknown as RawDomain, () => undefined);
let vEmptyThrew = "";
try { validate(vEmpty); } catch (e) { vEmptyThrew = (e as Error).message; }
assert("vertical.domain empty string rejected at load", vEmptyThrew.includes("vertical.domain"));

const vBadSub = resolve({ name: "vs", rag: { adapter: "x" }, sources: { enabled: [], vertical: { domain: "finance", sub_domain: "" } } } as unknown as RawDomain, () => undefined);
let vSubThrew = "";
try { validate(vBadSub); } catch (e) { vSubThrew = (e as Error).message; }
assert("vertical.sub_domain empty string rejected", vSubThrew.includes("vertical.sub_domain"));

const vUnknown = resolve({ name: "vu", rag: { adapter: "x" }, sources: { enabled: [], vertical: { domain: "not_a_real_vocab_word" } } } as unknown as RawDomain, () => undefined);
let vUnknownOk = true;
try { validate(vUnknown); } catch { vUnknownOk = false; }
assert("unknown vocabulary NOT rejected locally (upstream is the wordlist authority)", vUnknownOk);

// unknown keys inside sources.vertical are fail-fast at load —
// a silently dropped key (e.g. a params subtable the TOML surface does not
// carry) is the malformed-silence class the legislation exists to kill.
const vExtraKey = resolve({ name: "vk", rag: { adapter: "x" }, sources: { enabled: [], vertical: { domain: "finance", params: { type: "earnings" } } } } as unknown as RawDomain, () => undefined);
let vKeyThrew = "";
try { validate(vExtraKey); } catch (e) { vKeyThrew = (e as Error).message; }
assert("unknown key in sources.vertical rejected naming the key", vKeyThrew.includes("unknown key") && vKeyThrew.includes("params"));

// skills.toolRequires (decision #90 / issue #102) — resolve section-replace +
// fail-fast shape validation.

// Section-replace along the inheritance chain.
const trBase: RawDomain = { name: "tb", rag: { adapter: "x" }, skills: { active: ["a"], toolRequires: { a: ["old-tool"] } } };
const trDerived: RawDomain = { name: "td", base: "tb", rag: { adapter: "x" }, skills: { active: ["b"], toolRequires: { b: ["new-tool"] } } };
const trResult = resolve(trDerived, (n) => n === "tb" ? trBase : undefined);
assert("toolRequires whole-map replace along chain (base keys do NOT merge)",
  JSON.stringify(trResult.skills.toolRequires) === '{"b":["new-tool"]}');
const trInherit = resolve({ name: "ti", base: "tb", rag: { adapter: "x" } } as RawDomain, (n) => n === "tb" ? trBase : undefined);
assert("toolRequires inherits from base when derived omits it",
  JSON.stringify(trInherit.skills.toolRequires) === '{"a":["old-tool"]}');

// Absent field stays absent on the resolved schema (backward-compat marker).
const trAbsent = resolve({ name: "ta", rag: { adapter: "x" }, skills: { active: ["a"] } } as RawDomain, () => undefined);
assert("toolRequires absent when not declared", trAbsent.skills.toolRequires === undefined);

// Shape validation: non-Record, non-array values, non-string entries rejected.
const trBad = resolve({ name: "h3", rag: { adapter: "x" }, skills: { active: [], toolRequires: ["a"] } } as unknown as RawDomain, () => undefined);
let trArrThrew = "";
try { validate(trBad); } catch (e) { trArrThrew = (e as Error).message; }
assert("toolRequires non-Record rejected", trArrThrew.includes("skills.toolRequires"));

const trBadValue = resolve({ name: "h4", rag: { adapter: "x" }, skills: { active: [], toolRequires: { a: "atomcode" } } } as unknown as RawDomain, () => undefined);
let trValThrew = "";
try { validate(trBadValue); } catch (e) { trValThrew = (e as Error).message; }
assert("toolRequires non-array value rejected naming the skill", trValThrew.includes("skills.toolRequires.a"));

const trBadEntry = resolve({ name: "h5", rag: { adapter: "x" }, skills: { active: [], toolRequires: { a: ["ok", 42] } } } as unknown as RawDomain, () => undefined);
let trEntryThrew = "";
try { validate(trBadEntry); } catch (e) { trEntryThrew = (e as Error).message; }
assert("toolRequires non-string entry rejected", trEntryThrew.includes("skills.toolRequires.a"));

const trGood = resolve({ name: "ok2", rag: { adapter: "x" }, skills: { active: ["r"], toolRequires: { r: ["atomcode", "ctx_search"] } } } as unknown as RawDomain, () => undefined);
let trGoodOk = true;
try { validate(trGood); } catch { trGoodOk = false; }
assert("valid toolRequires passes", trGoodOk);

// compaction.lowWatermark — #113/CodeRabbit #161: the absolute shape must be a
// finite number; NaN/Infinity previously slipped through `value < 50000` and
// only failed later inside the fail-open consolidate path (silently disabling L0).
{
  for (const bad of [NaN, Infinity, -Infinity, 49999]) {
    const s = resolve({ name: "lw", rag: { adapter: "x" }, compaction: { lowWatermark: bad } } as RawDomain, () => undefined);
    let msg = "";
    try { validate(s); } catch (e) { msg = (e as Error).message; }
    assert("lowWatermark rejects " + String(bad), msg.includes("lowWatermark"));
  }
  const okAbs = resolve({ name: "lwok", rag: { adapter: "x" }, compaction: { lowWatermark: 50000 } } as RawDomain, () => undefined);
  let okAbsPassed = true;
  try { validate(okAbs); } catch { okAbsPassed = false; }
  assert("lowWatermark 50000 passes", okAbsPassed);
  for (const badF of [NaN, Infinity, 0, 1, -0.1]) {
    const s = resolve({ name: "lwf", rag: { adapter: "x" }, compaction: { lowWatermark: { fraction: badF } } } as RawDomain, () => undefined);
    let threwF = false;
    try { validate(s); } catch { threwF = true; }
    assert("fraction rejects " + String(badF), threwF);
  }
}

// #162: error classification. A "Domain schema:" fault is a configured-but-
// broken domain and must fail closed; an IO fault (unreadable file, DB) keeps
// the caller's availability fallback.
const invalidCompaction = resolve(
  { name: "bad-low", rag: { adapter: "x" }, compaction: { lowWatermark: 49999 } },
  () => undefined,
);
let schemaFault: unknown;
try { validate(invalidCompaction); } catch (e) { schemaFault = e; }
assert("isDomainSchemaError recognises validator faults", isDomainSchemaError(schemaFault));
assert("classification fixture hit the lowWatermark branch",
  String(schemaFault).includes("compaction.lowWatermark must be >= 50000"));

const ioFault = Object.assign(new Error("EACCES: permission denied, open '/tmp/x.toml'"), { code: "EACCES" });
assert("isDomainSchemaError leaves IO faults to the fallback", !isDomainSchemaError(ioFault));
assert("marker inside an IO path is not a schema error",
  !isDomainSchemaError(new Error("EACCES: permission denied, open '/tmp/Domain schema: x.toml'")));
assert("isDomainSchemaError ignores missing-domain errors", !isDomainSchemaError(new Error("Domain not found: nope")));
assert("isDomainSchemaError is false for non-Error throws", !isDomainSchemaError("Domain schema: not an Error"));

// #167: parse + inheritance faults are the same fail-fast family (file exists
// but broken), while absent domain and IO stay on the fallback.
{
  // Inheritance: base not found
  let baseMissing: unknown;
  try {
    resolve({ name: "child", base: "missingbase", rag: { adapter: "x" } } as RawDomain, () => undefined);
  } catch (e) { baseMissing = e; }
  assert("isDomainSchemaError recognises base-not-found", isDomainSchemaError(baseMissing));
  assert("base-not-found message is Domain schema: family", String(baseMissing).startsWith("Domain schema: Base domain not found:"));
  assert("Domain not found (absent domain) stays fallback", !isDomainSchemaError(new Error("Domain not found: missingbase")));

  // Inheritance: circular
  const ca: RawDomain = { name: "a", base: "b", rag: { adapter: "x" } };
  const cb: RawDomain = { name: "b", base: "a", rag: { adapter: "x" } };
  let circular: unknown;
  try { resolve(ca, (n) => n === "a" ? ca : n === "b" ? cb : undefined); } catch (e) { circular = e; }
  assert("isDomainSchemaError recognises circular inheritance", isDomainSchemaError(circular));
  assert("circular message is Domain schema: family", String(circular).startsWith("Domain schema: Circular inheritance detected:"));

  // TOML parse: file exists but malformed -> Domain schema with path context
  // (uses loadRawDomain wrapper; readFileSync IO stays fallback).
  const dir = mkdtempSync(join(tmpdir(), "ans-schema-parse-"));
  try {
    const badPath = join(dir, "badsyntax.toml");
    writeFileSync(badPath, 'name = "oops\n[rag]\nadapter = "none"\n', "utf8");
    let parseFault: unknown;
    try { loadRawDomain(badPath); } catch (e) { parseFault = e; }
    assert("isDomainSchemaError recognises TOML parse fault", isDomainSchemaError(parseFault));
    assert("parse fault message includes file path", String(parseFault).includes("badsyntax.toml"));
    assert("parse fault message is Domain schema: family", String(parseFault).startsWith("Domain schema:"));

    // IO: readFileSync ENOENT must stay fallback (not wrapped)
    let ioRead: unknown;
    try { loadRawDomain(join(dir, "no-such-file.toml")); } catch (e) { ioRead = e; }
    assert("isDomainSchemaError leaves readFileSync ENOENT to fallback", !isDomainSchemaError(ioRead));
    assert("ENOENT is not Domain schema", !String(ioRead).startsWith("Domain schema:"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log(`Domain schema tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);