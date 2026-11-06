// #132 — explicit session handle for ans_chat (MCP).
//
// Design: a session id is a resumable checkpoint key inside the store, not an
// MCP transport session — the 2026-07-28 revision removed protocol-level
// sessions and directs servers that need cross-call state to explicit,
// server-minted handles passed as ordinary tool arguments (SEP-2567:
// "Stateful workflows use create_*() -> handle + threaded parameters").
//
// Design: no handle means a fresh single-shot session; a threaded handle is
// ensureSession()-ed and reused — that is the only path to L1/L2 continuity.
//
// Design: memory wiring fails open — a malformed or unregisterable handle
// returns no wiring (the call still answers, no fake handle) and a failed mint
// is not cached, so a later call retries. Memory is an enhancement, not a
// precondition for chat.
//
// Design: callers that deliberately thread one handle share its anchors; the
// last write wins. Isolation is a different handle, and the store (not the
// handle) is the principal boundary (#130).
//
// Design: every ans_chat call builds a fresh runtime with no carried message
// history, so a threaded handle is a new recovery each call. The recovery
// digest (#189) is injected once per call; that is the resume unit here, not
// the handle's lifetime.
import type { CompositionResult, SessionStorePort } from "@anysearch-cli/kernel";
import { toBudgetCaps, type BudgetConfig } from "@anysearch-cli/store";

export interface AnsChatSessionWiring {
  store?: SessionStorePort;
  sessionId?: string;
}

// Wire contract mirrors AnsChatInput.sessionId (tool-schemas.ts): visible ASCII,
// 1..128 chars. MCP's own session-id rule uses visible ASCII too, and the value
// becomes a SQLite key, so control characters and unbounded lengths are refused.
const HANDLE_MAX_CHARS = 128;
const HANDLE_PATTERN = /^[\x21-\x7E]+$/;

export function isValidSessionHandle(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= HANDLE_MAX_CHARS &&
    HANDLE_PATTERN.test(value)
  );
}

// Dedupe per failure reason: a stateless MCP host can call ans_chat repeatedly and
// a broken store must not produce one line per call. Mirrors the warning discipline
// in pi-runtime.ts (module scope, test hook resets it).
// Design: the set is bounded — keys include error messages, so a long-lived
// server with rotating failure text must not grow this without limit.
const WARNED_MAX = 64;
const warned = new Set<string>();

/** Test hook: forget which ans_chat wiring failures were already announced. */
export function resetAnsChatSessionWarnings(): void {
  warned.clear();
}

function warnOnce(key: string, detail: string): void {
  if (warned.has(key)) return;
  if (warned.size >= WARNED_MAX) warned.clear();
  warned.add(key);
  // stdout stays protocol-pure for MCP; a dead stderr must not break the call.
  try {
    process.stderr.write("[anysearch] ans_chat memory wiring: " + detail + "\n");
  } catch {
    /* fail-open */
  }
}

/**
 * #187: synchronize the Active Domain's optional [budget] at the same point the
 * session row is registered. A declared section initializes/refreshes caps; its
 * later absence releases an existing row to unlimited (spend history kept).
 * A session that never had [budget] gets no row -> unmetered (pass). Budget
 * setup is fail-open: a broken ledger must not turn a usable chat session into
 * a failed call (no row / unlimited caps is the safe unmetered state).
 * Known limitation: the Active Domain is sampled at registration only, so a
 * mid-session domain switch (or a long-lived MCP process whose config snapshot
 * predates the TOML edit) does not re-initialize caps until the next process
 * start.
 */
function registerSessionBudget(store: SessionStorePort, sessionId: string, budget?: BudgetConfig): void {
  if (budget) {
    const init = store.initBudget;
    if (!init) {
      warnOnce("budget", "session store lacks initBudget — continuing unmetered");
      return;
    }
    try {
      init.call(store, sessionId, toBudgetCaps(budget));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      warnOnce("budget:" + msg, "budget initialization failed (" + msg + ") — continuing unmetered");
    }
    return;
  }
  // No [budget]: release a pre-existing row (a fresh session has no row, so
  // this is a no-op). Stores without the seam simply have nothing to release.
  const clear = store.clearBudgetCaps;
  if (!clear) return;
  try {
    clear.call(store, sessionId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    warnOnce("budget-clear:" + msg, "budget release failed (" + msg + ") — continuing unmetered");
  }
}

/**
 * Resolve the store/sessionId pair handed to PiAgentRuntime.
 *
 * @param eng - Composition result carrying the session store.
 * @param requested - `AnsChatInput.sessionId`, already type-checked by AJV; the
 *   runtime guard here also covers direct callers and non-string test input.
 * @returns both halves only when the handle is usable; an empty object leaves the
 *   runtime's `store && sessionId` gate closed (single-shot / memory disabled).
 */
export async function resolveAnsChatSession(
  eng: CompositionResult,
  requested?: unknown,
): Promise<AnsChatSessionWiring> {
  const store = eng.store;
  // SessionStorePort guarantees these, but a hand-built mock engine may not; a
  // loud fallback beats a TypeError in the tool handler.
  if (!store || typeof store.createSession !== "function" || typeof store.ensureSession !== "function") {
    warnOnce("store", "session store lacks createSession/ensureSession — continuing without memory");
    return {};
  }

  if (requested !== undefined) {
    if (!isValidSessionHandle(requested)) {
      warnOnce("invalid-handle", "sessionId must be 1..128 visible ASCII characters — continuing without memory");
      return {};
    }
    try {
      // FK safety: resume_anchors.session_id and messages.session_id reference
      // sessions(id), and the store runs foreign_keys = ON. A handle minted by a
      // previous process is not in this store's sessions table yet.
      await store.ensureSession(requested, "mcp");
      registerSessionBudget(store, requested, eng.config?.budget);
      return { store, sessionId: requested };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      warnOnce("register:" + msg, "session row registration failed (" + msg + ") — continuing without memory");
      return {};
    }
  }

  try {
    const session = await store.createSession("mcp");
    const id = session?.id;
    if (!isValidSessionHandle(id)) {
      warnOnce("mint", "createSession returned an empty/malformed id — continuing without memory");
      return {};
    }
    registerSessionBudget(store, id, eng.config?.budget);
    return { store, sessionId: id };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    warnOnce("mint:" + msg, "createSession failed (" + msg + ") — continuing without memory");
    return {};
  }
}

export interface AnsChatToolResult {
  // MCP's callback result is an open object ([x: string]: unknown). The index
  // signature keeps this named type assignable without importing the SDK into
  // this module (the tool layer already owns that dependency).
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: { sessionId: string };
}

/**
 * Shape the MCP call result.
 *
 * Design: the handle is returned in model-visible content (a trailing text
 * block) as well as structuredContent — the next call threads it as an ordinary
 * tool argument, and content-only proxies (e.g. the dsh native tool plane) never
 * see structuredContent. The answer text itself stays untouched.
 */
export function buildAnsChatResult(output: string, sessionId?: string): AnsChatToolResult {
  return {
    content: [
      { type: "text", text: output || "ans_chat: no response" },
      ...(sessionId
        ? [{ type: "text" as const, text: JSON.stringify({ sessionId }) }]
        : []),
    ],
    ...(sessionId ? { structuredContent: { sessionId } } : {}),
  };
}