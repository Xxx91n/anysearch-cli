// #100 acceptance — SDK v2 schema path (closes #39 + #46, empirically settles #94).
//
//   #46  tools/list input schemas carry type `description`s (no zod 4.0-4.1
//        fallback downgrade).
//   #39  TypeBox schemas reach registerTool via the official fromJsonSchema()
//        wrapper — no zod double-write.
//   #94  named unverified point: does a bare TypeBox TSchema natively satisfy
//        `~standard.jsonSchema`? Empirical answer (pinned here): NO. The kernel
//        TypeBox schemas have no `~standard`; fromJsonSchema() is required and
//        adds a Standard Schema with vendor "mcp".
//
// Seam: real buildServer() + registered tools, driven over InMemoryTransport,
// plus the registerTool config captured directly. No test framework (repo
// convention: assert-based, run via `node --import tsx --test`).

import { buildServer } from "../src/server.js";
import { TOOL_REGISTRY } from "../src/tools/index.js";
import { fromJsonSchema } from "@modelcontextprotocol/server";
import {
  KernelJsonSchemas,
  KernelToolDescriptions,
  KernelToolSchemas,
  type KernelToolName,
} from "@anysearch-cli/kernel";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createMockEngine } from "./helpers/mock-engine.js";
import { inMemoryRpc, canonical } from "./helpers/mcp-harness.js";

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error("FAIL: " + msg);
  }
}

const TOOL_NAMES: KernelToolName[] = [
  "search_web",
  "research_web",
  "recall_memory",
  "query_knowledge",
  "ans_chat",
];

async function main() {
  // ---- Part A: tools/list on the wire (real server + InMemoryTransport) ----
  const server = buildServer(createMockEngine());
  const { rpc, notify } = await inMemoryRpc(server);
  const init = await rpc("initialize", {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "schema-test", version: "0" },
  });
  assert(init.result?.protocolVersion === "2025-11-25", "initialize negotiates 2025-11-25");
  notify("notifications/initialized");
  const list = await rpc("tools/list", {});
  const tools: any[] = list.result?.tools ?? [];
  assert(tools.length === TOOL_NAMES.length, "tools/list returns exactly 5 tools");
  for (const name of TOOL_NAMES) {
    const wire = tools.find((t) => t.name === name);
    assert(wire !== undefined, "tools/list contains " + name);
    if (!wire) continue;
    assert(wire.description === KernelToolDescriptions[name], name + " tool description matches kernel copy");
    // Full-fidelity round-trip: the wire inputSchema equals the kernel JSON
    // schema (descriptions + all keywords intact) — the #46 no-downgrade proof.
    assert(
      canonical(wire.inputSchema) === canonical(KernelJsonSchemas[name]),
      name + " inputSchema round-trips unchanged from kernel (descriptions intact, #46)"
    );
    const req = (KernelJsonSchemas[name] as any).required?.[0];
    const propDesc = wire.inputSchema?.properties?.[req]?.description;
    assert(typeof propDesc === "string" && propDesc.length > 0, name + "." + req + " carries a type description on the wire (#46)");
    assert(wire.inputSchema?.additionalProperties === false, name + " inputSchema is closed (additionalProperties:false)");
  }
  await server.close();

  // ---- Part B: registerTool config — TypeBox via fromJsonSchema, no zod ----
  for (const tool of TOOL_REGISTRY) {
    let config: any = null;
    const fakeServer = { registerTool: (_n: string, c: any, _h: any) => { config = c; } };
    tool.register(fakeServer as any, createMockEngine());
    assert(config !== null, tool.name + " registered via registerTool");
    const std = config?.inputSchema?.["~standard"];
    assert(std !== undefined, tool.name + " inputSchema is a Standard Schema");
    assert(std?.vendor === "mcp", tool.name + " inputSchema vendor is \"mcp\" (fromJsonSchema), not zod (#39)");
    assert(std?.version === 1, tool.name + " Standard Schema version 1");
    assert(typeof std?.validate === "function", tool.name + " Standard Schema has validate (AJV)");
    assert(
      canonical(std?.jsonSchema?.input()) === canonical(KernelJsonSchemas[tool.name as KernelToolName]),
      tool.name + " ~standard.jsonSchema.input() returns the kernel JSON schema verbatim"
    );
    assert(config?.description === KernelToolDescriptions[tool.name as KernelToolName], tool.name + " description sourced from kernel copy");
  }

  // ---- Part C: #94 empirical — bare TypeBox TSchema has no ~standard ----
  for (const name of TOOL_NAMES) {
    const bare = KernelToolSchemas[name] as object;
    assert(!("~standard" in bare), "#94: kernel " + name + " (bare TypeBox TSchema) has NO ~standard → fromJsonSchema required");
    const wrapped = fromJsonSchema(KernelJsonSchemas[name]) as any;
    assert("~standard" in wrapped, "#94: fromJsonSchema(" + name + ") adds ~standard");
    assert(wrapped["~standard"].vendor === "mcp", "#94: fromJsonSchema(" + name + ") ~standard vendor is mcp");
    assert(typeof wrapped["~standard"].jsonSchema?.input === "function", "#94: fromJsonSchema(" + name + ") exposes ~standard.jsonSchema.input");
  }

  // ---- Part D: no zod double-write in the tool sources (TypeBox-only path) ----
  const toolsDir = fileURLToPath(new URL("../src/tools/", import.meta.url));
  for (const f of readdirSync(toolsDir)) {
    if (!f.endsWith(".tool.ts")) continue;
    const src = readFileSync(join(toolsDir, f), "utf8");
    assert(
      !/from\s+["']zod["']/.test(src) && !/require\(\s*["']zod["']\s*\)/.test(src),
      f + " has no zod import (TypeBox-only schema path, #39)"
    );
  }

  console.log("--- mcp sdk-v2 schema tests: " + passed + " passed, " + failed + " failed ---");
  if (failed > 0) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
