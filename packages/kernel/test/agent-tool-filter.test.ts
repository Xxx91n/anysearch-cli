// Regression (r19 T1, 2026-10-22): every shipped domain's hooks.toolWhitelist listed
// only host-side names (ctx_*), so the security filter dropped the kernel's built-in
// `search` tool and ans_chat ran its agent loop with ZERO tools — the model answered
// from parametric memory or printed tool calls as text, never retrieving.
// Contract kept: hooks.toolWhitelist stays the security filter; the fix
// is that every shipped domain whitelists the built-in search tool.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadDomainFromString } from "@anysearch-cli/store";
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

test("every shipped domain TOML keeps the built-in search tool active", () => {
  const dir = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "apps", "mcp", "domains");
  const files = readdirSync(dir).filter((f) => f.endsWith(".toml"));
  assert.ok(files.length >= 3, "expected shipped domains under apps/mcp/domains");
  for (const f of files) {
    const d = loadDomainFromString(readFileSync(join(dir, f), "utf8")) as unknown as DomainConfigPort;
    assert.ok(names(filterAgentTools([search], d)).includes(BUILTIN_SEARCH_TOOL), f + ": search tool filtered out");
  }
});
