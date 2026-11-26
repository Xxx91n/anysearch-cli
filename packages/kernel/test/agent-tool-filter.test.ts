// Regression (r19 T1, 2026-10-22): every shipped domain's hooks.toolWhitelist listed
// only host-side names (ctx_*), so the security filter dropped the kernel's built-in
// `search` tool and ans_chat ran its agent loop with ZERO tools — the model answered
// from parametric memory or printed tool calls as text, never retrieving.
// Contract kept: hooks.toolWhitelist stays the security filter.
// #605: the shipped domains now name the two tools the internal agent really has —
// search and fetch — and nothing else. The repo-root domains/ is the only committed
// copy; apps/mcp/domains is generated at build time.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadDomainFromString } from "@anysearch-cli/store";
import { fallbackAgentDomain } from "../src/fallback-domain";
import { BUILTIN_SEARCH_TOOL, filterAgentTools, createSearchTool } from "../src/pi-runtime";
import type { DomainConfigPort, RetrieverPort } from "../src/ports";

const retriever: RetrieverPort = { search: async () => ({ query: "", mode: "fast", results: [] }) as any };
const search = createSearchTool(retriever);
const extra = (name: string) => ({ ...search, name, label: name }) as typeof search;
const domain = (toolWhitelist: string[], skills?: Partial<DomainConfigPort["skills"]>): DomainConfigPort => ({
  sources: { enabled: [] }, prompts: [], skills: { active: ["search"], ...skills }, hooks: { toolWhitelist }, rag: { adapter: "none" },
});
const names = (ts: { name: string }[]) => ts.map((t) => t.name);

test("the built-in search tool is named search", () => {
  assert.equal(search.name, BUILTIN_SEARCH_TOOL);
});

test("whitelist remains the security filter (search not listed -> dropped)", () => {
  assert.deepEqual(names(filterAgentTools([search, extra("atomcode")], domain(["ctx_execute", "atomcode"]))), ["atomcode"]);
});

test("empty whitelist keeps every tool", () => {
  assert.deepEqual(names(filterAgentTools([search, extra("fetch")], domain([]))), ["search", "fetch"]);
});

// Regression for issue #102: without toolRequires the filter must behave
// exactly as before — whitelist membership alone decides (a whitelisted tool
// no active skill requires is still kept).
test("no toolRequires field: behavior byte-identical to whitelist-only", () => {
  const tools = [search, extra("atomcode"), extra("ctx_execute"), extra("fetch")];
  assert.deepEqual(
    names(filterAgentTools(tools, domain(["search", "atomcode", "fetch"], { active: ["research"] }))),
    ["search", "atomcode", "fetch"],
  );
  assert.deepEqual(
    names(filterAgentTools(tools, domain(["search", "atomcode", "fetch"], { active: ["research"], toolRequires: {} }))),
    ["search", "atomcode", "fetch"],
  );
});

test("toolRequires declared: only whitelist ∩ active-skill union (∪ search) survives", () => {
  const tools = [search, extra("atomcode"), extra("ctx_execute"), extra("fetch")];
  const d = domain(["search", "atomcode", "ctx_execute", "fetch"], {
    active: ["atomcode-research"],
    toolRequires: { "atomcode-research": ["atomcode"] },
  });
  assert.deepEqual(names(filterAgentTools(tools, d)), ["search", "atomcode"]);
});

test("toolRequires: inactive skill's required tools are filtered", () => {
  const tools = [search, extra("atomcode"), extra("ctx_execute")];
  const d = domain(["search", "atomcode", "ctx_execute"], {
    active: ["research"],
    toolRequires: { "atomcode-research": ["atomcode"], research: ["ctx_execute"] },
  });
  assert.deepEqual(names(filterAgentTools(tools, d)), ["search", "ctx_execute"]);
});

test("toolRequires: built-in search survives even when no active skill requires it", () => {
  const tools = [search, extra("atomcode")];
  const d = domain(["search", "atomcode"], {
    active: ["research"],
    toolRequires: { research: ["atomcode"] },
  });
  assert.deepEqual(names(filterAgentTools(tools, d)), ["search", "atomcode"]);
});

test("toolRequires: whitelist stays the upper bound (union ∖ whitelist dropped)", () => {
  const tools = [search, extra("atomcode"), extra("fetch")];
  const d = domain(["search", "fetch"], {
    active: ["research", "atomcode-research"],
    toolRequires: { research: ["fetch"], "atomcode-research": ["atomcode"] },
  });
  assert.deepEqual(names(filterAgentTools(tools, d)), ["search", "fetch"]);
});

test("toolRequires declared: empty whitelist still applies the active-skill filter", () => {
  const tools = [search, extra("atomcode"), extra("ctx_execute")];
  const d = domain([], {
    active: ["research"],
    toolRequires: { research: ["ctx_execute"] },
  });
  assert.deepEqual(names(filterAgentTools(tools, d)), ["search", "ctx_execute"]);
});

test("toolRequires: active skill named like an Object prototype member contributes nothing", () => {
  const tools = [search, extra("atomcode")];
  const d = domain(["search", "atomcode"], {
    active: ["constructor", "research"],
    toolRequires: { research: ["atomcode"] },
  });
  assert.deepEqual(names(filterAgentTools(tools, d)), ["search", "atomcode"]);
});

test("empty whitelist with no toolRequires keeps every tool (unchanged)", () => {
  assert.deepEqual(names(filterAgentTools([search, extra("fetch")], domain([], { active: ["research"] }))), ["search", "fetch"]);
});

test("fallbackAgentDomain gives each caller a fresh search + fetch domain", () => {
  const a = fallbackAgentDomain();
  const b = fallbackAgentDomain();
  assert.deepEqual(a.hooks.toolWhitelist, ["search", "fetch"]);
  assert.deepEqual(names(filterAgentTools([search, extra("fetch")], a)), ["search", "fetch"]);
  assert.notEqual(a, b, "each call gets its own object");
  assert.notEqual(a.hooks.toolWhitelist, b.hooks.toolWhitelist, "the whitelist is not shared");
  assert.deepEqual(a.skills.active, ["search"], "skills.active stays inert without toolRequires");
});

test("every shipped domain whitelists exactly search and fetch", () => {
  const dir = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "domains");
  const files = readdirSync(dir).filter((f) => f.endsWith(".toml"));
  assert.ok(files.length >= 3, "expected shipped domains under the repo-root domains/");
  const tools = [search, extra("fetch")];
  for (const f of files) {
    const d = loadDomainFromString(readFileSync(join(dir, f), "utf8")) as unknown as DomainConfigPort;
    assert.deepEqual(d.hooks.toolWhitelist, ["search", "fetch"], f + ": whitelist is search + fetch");
    assert.deepEqual(names(filterAgentTools(tools, d)), ["search", "fetch"], f + ": both agent tools survive the filter");
    assert.equal(d.skills.active.includes("atomcode-research"), false, f + ": no removed skill name stays active");
  }
});
