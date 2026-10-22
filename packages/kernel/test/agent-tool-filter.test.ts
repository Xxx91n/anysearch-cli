// Regression (r19 T1, 2026-10-22): every shipped domain's hooks.toolWhitelist listed
// only host-side names (ctx_*), so the security filter dropped the kernel's built-in
// `search` tool and ans_chat ran its agent loop with ZERO tools — the model answered
// from parametric memory or printed tool calls as text, never retrieving.
// Contract kept: hooks.toolWhitelist stays the security filter (ADR-0007 D4); the fix
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
const domain = (toolWhitelist: string[]): DomainConfigPort => ({
  sources: { enabled: [] }, prompts: [], skills: { active: ["search"] }, hooks: { toolWhitelist }, rag: { adapter: "none" },
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

test("every shipped domain TOML keeps the built-in search tool active", () => {
  const dir = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "apps", "mcp", "domains");
  const files = readdirSync(dir).filter((f) => f.endsWith(".toml"));
  assert.ok(files.length >= 3, "expected shipped domains under apps/mcp/domains");
  for (const f of files) {
    const d = loadDomainFromString(readFileSync(join(dir, f), "utf8")) as unknown as DomainConfigPort;
    assert.ok(names(filterAgentTools([search], d)).includes(BUILTIN_SEARCH_TOOL), f + ": search tool filtered out");
  }
});
