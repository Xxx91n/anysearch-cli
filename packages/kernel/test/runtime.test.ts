// Self-check for kernel runtime: tool filtering by domain whitelist.
// Run: pnpm --filter @anysearch/kernel run test

import { filterTools, type ToolPort, type DomainConfigPort } from "../src/runtime";

let passed = 0;
let failed = 0;

function assert(label: string, cond: boolean) {
  if (cond) { passed++; } else { failed++; console.error("FAIL: " + label); }
}

const tools: ToolPort[] = [
  { name: "search", description: "search web", execute: async () => "ok" },
  { name: "fetch", description: "fetch url", execute: async () => "ok" },
  { name: "bash", description: "run shell", execute: async () => "ok" },
];

// Test 1: whitelist allows only listed tools
const domain1: DomainConfigPort = { toolWhitelist: ["search", "fetch"], ragAdapter: "default" };
const filtered1 = filterTools(tools, domain1);
assert("filter keeps search+fetch", filtered1.length === 2);
assert("filter removes bash", !filtered1.some((t) => t.name === "bash"));

// Test 2: empty whitelist = no tools
const domain2: DomainConfigPort = { toolWhitelist: [], ragAdapter: "default" };
const filtered2 = filterTools(tools, domain2);
assert("empty whitelist = no tools", filtered2.length === 0);

// Test 3: whitelist with unknown tools = still filters correctly
const domain3: DomainConfigPort = { toolWhitelist: ["search", "nonexistent"], ragAdapter: "default" };
const filtered3 = filterTools(tools, domain3);
assert("unknown whitelist entry ignored", filtered3.length === 1);
assert("only search survives", filtered3[0].name === "search");

console.log(`Kernel runtime tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);