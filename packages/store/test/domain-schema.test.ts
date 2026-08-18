// Self-check for domain-schema deep-merge + resolve + validate.
// Run: npx tsx packages/store/test/domain-schema.test.ts

import { resolve, validate, type RawDomain } from "../src/domain-schema";

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
assert("settings.ui.theme is dark", result.settings.ui?.theme === "dark");
assert("settings.ui.font preserved", result.settings.ui?.font === "mono");
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

console.log(`Domain schema tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);