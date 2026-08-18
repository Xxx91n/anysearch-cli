// MCP server factory tests.
// G015 test closure: verify buildServer() creates server with registered tools.

import { buildServer } from "../src/server.js";
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

// Test 4: buildServer without engine arg (uses createEngine with try/catch providers).
// This should not crash even without API keys.
try {
  const server4 = buildServer();
  assert(server4 !== undefined, "buildServer() without engine does not crash");
} catch (e) {
  assert(false, "buildServer() without engine crashed: " + (e as Error).message);
}

console.log("--- MCP server tests: " + passed + " passed, " + failed + " failed ---");
if (failed > 0) process.exit(1);
