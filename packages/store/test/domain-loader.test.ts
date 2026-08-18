// Domain Loader test (G005). smol-toml parse + domain-schema resolve/validate.
// Self-check via assert-based demo (ponytail: no test framework).

import { parseDomainToml, loadDomainFromString } from "../src/domain-loader";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return false; }
  passed++; return true;
}

function main() {
  // 1. parseDomainToml - basic parsing
  const toml = `
name = "code"
description = "Code development domain"

[settings]
language = "TypeScript"

[skills]
active = ["code-review", "testing"]

[sources]
enabled = ["exa", "tavily"]

[rag]
adapter = "none"

[hooks]
toolWhitelist = ["ctx_execute", "shell_command"]
`;
  const raw = parseDomainToml(toml);
  assert(raw.name === "code", "parseDomainToml: name = code");
  assert(raw.description === "Code development domain", "parseDomainToml: description");
  assert(raw.settings?.language === "TypeScript", "parseDomainToml: settings.language");
  assert(Array.isArray(raw.skills?.active), "parseDomainToml: skills.active is array");
  assert(raw.skills?.active?.[0] === "code-review", "parseDomainToml: skills.active[0]");
  assert(Array.isArray(raw.sources?.enabled), "parseDomainToml: sources.enabled is array");
  assert(raw.rag?.adapter === "none", "parseDomainToml: rag.adapter");
  assert(Array.isArray(raw.hooks?.toolWhitelist), "parseDomainToml: hooks.toolWhitelist is array");

  // 2. loadDomainFromString - resolve + validate (no inheritance)
  const schema = loadDomainFromString(toml);
  assert(schema.name === "code", "loadDomainFromString: name = code");
  assert(schema.settings.language === "TypeScript", "loadDomainFromString: settings preserved");
  assert(schema.skills.active.length === 2, "loadDomainFromString: skills.active length = 2");
  assert(schema.sources.enabled.length === 2, "loadDomainFromString: sources.enabled length = 2");
  assert(schema.rag.adapter === "none", "loadDomainFromString: rag.adapter = none");
  assert(schema.hooks.toolWhitelist.length === 2, "loadDomainFromString: toolWhitelist length = 2");

  // 3. loadDomainFromString - inheritance with deep-merge
  const baseToml = `
name = "base"
description = "Base domain"

[settings]
language = "TypeScript"
timeout = 5000

[skills]
active = ["base-skill"]

[sources]
enabled = ["exa"]

[rag]
adapter = "none"

[hooks]
toolWhitelist = ["shell_command"]
`;
  const derivedToml = `
name = "code"
base = "base"

[settings]
language = "Python"

[skills]
active = ["code-review"]

[sources]
enabled = ["exa", "tavily"]

[rag]
adapter = "none"

[hooks]
toolWhitelist = ["ctx_execute", "shell_command"]
`;
  const lookup = (name: string) => name === "base" ? parseDomainToml(baseToml) : undefined;
  const merged = loadDomainFromString(derivedToml, lookup);
  // settings: deep-merge (language overridden, timeout inherited)
  assert(merged.settings.language === "Python", "deep-merge: settings.language overridden by derived");
  assert((merged.settings as any).timeout === 5000, "deep-merge: settings.timeout inherited from base");
  // lists: entire replace (skills.active replaced, not merged)
  assert(merged.skills.active.length === 1, "replace lists: skills.active replaced by derived (length=1)");
  assert(merged.skills.active[0] === "code-review", "replace lists: skills.active[0] = code-review");
  assert(merged.sources.enabled.length === 2, "replace lists: sources.enabled replaced (length=2)");
  assert(merged.hooks.toolWhitelist.length === 2, "replace lists: toolWhitelist replaced (length=2)");

  // 4. validate - missing required fields should throw
  let threw = false;
  try {
    loadDomainFromString("description = \"missing name\"");
  } catch (e) {
    threw = true;
  }
  assert(threw, "loadDomainFromString throws on missing name");

  // 5. validate - missing rag.adapter should throw
  threw = false;
  try {
    loadDomainFromString(`
name = "test"

[skills]
active = []

[sources]
enabled = []

[hooks]
toolWhitelist = []
`);
  } catch (e) {
    threw = true;
  }
  assert(threw, "loadDomainFromString throws on missing rag.adapter");

  console.log("--- Domain Loader tests: " + passed + " passed, " + failed + " failed ---");
  if (failed > 0) process.exit(1);
}

main();
