// MCP server factory tests.
// G015 test closure: verify buildServer() creates server with registered tools.

import { buildServer } from "../src/server.js";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fromJsonSchema } from "@modelcontextprotocol/server";
import { KernelJsonSchemas } from "@anysearch/kernel";
import type { CompositionResult } from "@anysearch/kernel";
import type { RetrieverPort, Query } from "@anysearch/kernel";
import type { SessionStore, MemoryHit } from "@anysearch/store";
import type { FusedEnvelope } from "@anysearch/retriever";

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

// Mock engine: no real providers, avoids API key requirement.
const mockRetriever: RetrieverPort = {
  search: async (_q: Query): Promise<FusedEnvelope> => ({
    results: [],
    answers: [],
    metadata: { providersQueried: [], providersFailed: [], providersCancelled: [], elapsedMs: 0 },
  }),
};
const mockStore: SessionStore = {
  createSession: async (_d: string) => ({ id: "test-session", domain: _d, createdAt: new Date().toISOString() }),
  append: async () => {},
  searchFts5: async (_s: string | null, _q: string, _l?: number): Promise<MemoryHit[]> => [],
  searchMemory: async (_q: string, _l?: number): Promise<MemoryHit[]> => [],
  saveResults: async () => {},
  saveAnchor: async () => {},
  getAnchors: async () => [],
};
const mockEngine: CompositionResult = { retriever: mockRetriever, store: mockStore };

// Test 1: buildServer returns an McpServer instance.
const server = buildServer(mockEngine);
assert(server !== undefined && server !== null, "buildServer() returns non-null server");

// Test 2: server is an object.
assert(typeof server === "object", "server is an object");

// Test 3: buildServer can be called multiple times (factory pattern).
const server2 = buildServer(mockEngine);
const server3 = buildServer(mockEngine);
assert(server2 !== server3, "buildServer() returns new instance each call (factory pattern)");

// Test 4 (ADR-0057 D3 / D-004 regression): buildServer() without an engine must
// boot from a COLD HOME - a temp dir with no ~/.anysearch parent - proving the
// resolveDbPath mkdir guard exists. Removing the guard turns this red.
{
  const coldHome = mkdtempSync(join(tmpdir(), "ans-mcp-cold-"));
  const coldDb = join(coldHome, "nested", "missing", "anysearch.db"); // parents absent
  const prevDb = process.env.ANS_DB_PATH;
  const prevProfile = process.env.USERPROFILE;
  const prevHome = process.env.HOME;
  process.env.ANS_DB_PATH = coldDb;
  process.env.USERPROFILE = coldHome;
  process.env.HOME = coldHome;
  try {
    const server4 = buildServer();
    assert(server4 !== undefined, "buildServer() boots with cold HOME (no ~/.anysearch)");
    assert(existsSync(dirname(coldDb)), "cold boot created the DB parent directory");
  } catch (e) {
    assert(false, "buildServer() cold-HOME boot crashed: " + (e as Error).message);
  } finally {
    if (prevDb === undefined) delete process.env.ANS_DB_PATH; else process.env.ANS_DB_PATH = prevDb;
    if (prevProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = prevProfile;
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
    // best-effort: the store keeps the sqlite handle open (Windows file lock)
    try { rmSync(coldHome, { recursive: true, force: true }); } catch { /* OS temp */ }
  }
}

// ADR-0019 D4 (layer-2): input validation is enforced by AJV via fromJsonSchema.
// Structural assertion: fromJsonSchema(KernelJsonSchemas.X) produces a Standard Schema
// that the SDK will validate against. We verify the underlying JSON schemas still carry
// the expected keyword signatures (minLength / enum-anyOf / required) so a regression
// dropping them from KernelJsonSchemas is caught here.
const searchSchema = KernelJsonSchemas.search_web as {
  required?: string[];
  properties?: Record<string, { minLength?: number; anyOf?: Array<{ const?: string }> }>;
};
assert(searchSchema.required?.includes("query") ?? false, "plain search_web requires query");
const searchQuery = searchSchema.properties?.query;
assert(searchQuery?.minLength === 1, "plain search_web query has minLength=1 (AJV rejects empty)");

const researchSchema = KernelJsonSchemas.research_web as {
  required?: string[];
  properties?: Record<string, { anyOf?: Array<{ const?: string }> }>;
};
assert(researchSchema.required?.includes("question") ?? false, "plain research_web requires question");
const researchDepth = researchSchema.properties?.depth?.anyOf ?? [];
const depthValues = researchDepth.map((v) => v.const).sort();
assert(
  JSON.stringify(depthValues) === JSON.stringify(["brief", "deep", "standard"]),
  "plain research_web depth enum=brief/standard/deep (got " + JSON.stringify(depthValues) + ")"
);

// Also confirm fromJsonSchema produces a plain object (not undefined / thrown).
const wrapped = fromJsonSchema(KernelJsonSchemas.search_web);
assert(wrapped !== undefined && typeof wrapped === "object", "fromJsonSchema returns non-null Standard Schema");

console.log("--- MCP server tests: " + passed + " passed, " + failed + " failed ---");
if (failed > 0) process.exit(1);
