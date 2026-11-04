// Shared mock CompositionResult for the SDK-v2 acceptance tests (#100).
// No real providers / no network / no LLM: every tool handler runs to a
// successful (non-error) result against this engine, so a full 5-tool
// tools/call smoke is safe offline. Mirrors the mock in abstain.test.ts.
//
// Not a *.test.ts file — imported by the acceptance tests, never run directly.

import type { CompositionResult, Query } from "@anysearch-cli/kernel";
import type { FusedEnvelope } from "@anysearch-cli/retriever";
import type { SessionStore } from "@anysearch-cli/store";

const emptyEnvelope: FusedEnvelope = {
  results: [],
  answers: [],
  metadata: { providersQueried: [], providersFailed: [], providersCancelled: [], elapsedMs: 0 },
};

// Minimal observation span: recordOperation just invokes the callback with it.
const fakeSpan: any = {
  traceId: "mock-trace",
  spanId: "mock-span",
  addEvent: () => {},
  setAttributes: () => {},
  startSpan: async (_o: any, cb: any) => cb(fakeSpan),
  finish: () => {},
};

export function createMockEngine(): CompositionResult {
  const retriever = {
    search: async (_q: Query): Promise<FusedEnvelope> => emptyEnvelope,
  };
  const store = {
    createSession: async (d: string) => ({ id: "mock-session", domain: d, createdAt: new Date().toISOString() }),
    // #132: ans_chat registers a threaded handle before reuse.
    ensureSession: async () => {},
    append: async () => {},
    searchFts5: async () => [],
    searchMemory: async () => [],
    saveResults: async () => {},
    saveAnchor: async () => {},
    getAnchors: async () => [],
  } as unknown as SessionStore;
  const observation = {
    recordOperation: async (_o: any, cb: any) => cb(fakeSpan),
  };
  // config intentionally omitted: query_knowledge falls back to adapter "none",
  // ans_chat reads env (unset in the smoke) and returns the not-configured copy.
  return { retriever, store, observation } as unknown as CompositionResult;
}
