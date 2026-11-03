// #129 — the memory-wiring decision behind `ans chat`.
//
// Lives in its own module so the composition root can be tested: `chat.ts`
// imports the kernel, whose pi-agent-core dependency is ESM-only, while this
// CLI package is CommonJS — importing chat.ts from a test breaks module
// resolution before any assertion runs.
import { readSessionId } from "@anysearch-cli/store";
import type { SessionStorePort } from "@anysearch-cli/kernel";

export interface ChatMemoryWiring {
  store?: SessionStorePort;
  sessionId?: string;
}

/**
 * Decide what `ans chat` hands to PiAgentRuntime for memory.
 *
 * Design: the durable session anchor (~/.anysearch-cli/session, ANS_SESSION_ID
 * overrides) is used as the chat session id, not a per-run createSession() —
 * the anchor is what lets a later `ans chat` resume the same L1/L2 state, and
 * it is the id the observation layer already records. Because it is minted
 * outside createSession(), the row its FK targets need
 * (messages / resume_anchors -> sessions(id)) is registered here first.
 *
 * Returns both halves only when registration succeeded; an empty object leaves
 * the runtime's `store && sessionId` gate closed, and the runtime then names
 * the gap itself.
 */
export async function wireChatMemory(store: SessionStorePort, domain: string): Promise<ChatMemoryWiring> {
  const sessionId = readSessionId();
  // readSessionId is fail-open by contract; an empty id must never reach the
  // store (it would create a bogus sessions row and disable resume).
  if (!sessionId) {
    process.stderr.write("[warn] session anchor produced an empty id — continuing without memory anchors\n");
    return {};
  }
  try {
    await store.ensureSession(sessionId, domain);
    return { store, sessionId };
  } catch (e: any) {
    process.stderr.write(
      "[warn] session row registration failed for " + sessionId + ": " +
      (e?.message || String(e)) + " — continuing without memory anchors\n",
    );
    return {};
  }
}
