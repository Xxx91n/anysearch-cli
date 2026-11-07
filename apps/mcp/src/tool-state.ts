// Process-wide MCP tool state (#210).
//
// The stateless HTTP transport builds a fresh McpServer per request (the
// protocol requires it), so state living in a tool registration closure is
// rebuilt on every request. This module is the transport entry's ONE process
// scope: the entry creates it once and injects it into every buildServer() call,
// which hands it to the tools that need process-level laziness.
//
// It holds process-shared dependencies only — currently the ans_chat LLM client
// cache. Conversation, session handles, anchors and budget state stay per
// call/per session and never enter this object (#203 user story 10).
//
// Direct tool-registration callers (tests, one-off embedders) get a fresh state
// by default, so suites stay isolated.
import {
  createLlmSession as createKernelLlmSession,
  type LlmSession,
  type LlmSessionOptions,
} from "@anysearch-cli/kernel";

/** One ans_chat LLM client slot plus its credential-rotation tiebreaker. */
export interface AnsChatCacheEntry {
  // The in-flight construction promise is cached synchronously, before it
  // settles, so concurrent identical requests share one build. Once resolved
  // it also serves as the cached client.
  session: Promise<LlmSession>;
  // F-A4: keyHash detects ANS_LLM_API_KEY rotation on a long-lived process. It
  // is NOT part of the cache key: a rotation overwrites the same slot value.
  keyHash: string;
}

/**
 * Session factory seam. Production builds through the kernel deep module; tests
 * inject a counter instead of counting #113 warnings on stderr (#210).
 */
export type AnsChatSessionFactory = (opts: LlmSessionOptions) => Promise<LlmSession>;

export interface McpToolState {
  /** Lazy LLM client cache keyed by wire-affecting config; clients only. */
  readonly ansChatSessionCache: Map<string, AnsChatCacheEntry>;
  readonly createAnsChatSession: AnsChatSessionFactory;
}

export interface McpToolStateOverrides {
  createAnsChatSession?: AnsChatSessionFactory;
}

/** Build one process-level tool state; omit overrides in production. */
export function createMcpToolState(overrides: McpToolStateOverrides = {}): McpToolState {
  return {
    ansChatSessionCache: new Map(),
    createAnsChatSession: overrides.createAnsChatSession ?? createKernelLlmSession,
  };
}
