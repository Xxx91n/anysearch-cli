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
import type {
  BudgetLedgerPort,
  CompositionResult,
  ConsolidationUsage,
  SessionStorePort,
} from "@anysearch-cli/kernel";
import {
  formatConsolidateScope,
  toBudgetCaps,
  type BudgetConfig,
  type ConsolidateReport,
} from "@anysearch-cli/store";

export interface AnsChatSessionWiring {
  store?: SessionStorePort;
  sessionId?: string;
  // Design: the ledger travels only with a registered session row whose budget
  // setup succeeded — the runtime budgets on `store && sessionId && ledger`, so
  // neither a fail-open registration nor a failed budget setup may leave a
  // ledger that could settle against an absent row or abort `agent.prompt`
  // (#178, CodeRabbit #200).
  ledger?: BudgetLedgerPort;
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
 * Returns false when setup failed; the caller then omits the ledger so an
 * unusable ledger cannot abort `agent.prompt` (CodeRabbit #200).
 * Known limitation: the Active Domain is sampled at registration only, so a
 * mid-session domain switch (or a long-lived MCP process whose config snapshot
 * predates the TOML edit) does not re-initialize caps until the next process
 * start.
 */
function registerSessionBudget(store: SessionStorePort, sessionId: string, budget?: BudgetConfig): boolean {
  if (budget) {
    const init = store.initBudget;
    if (!init) {
      warnOnce("budget", "session store lacks initBudget — continuing unmetered");
      return false;
    }
    try {
      init.call(store, sessionId, toBudgetCaps(budget));
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      warnOnce("budget:" + msg, "budget initialization failed (" + msg + ") — continuing unmetered");
      return false;
    }
  }
  // No [budget]: release a pre-existing row (a fresh session has no row, so
  // this is a no-op). Stores without the seam simply have nothing to release.
  const clear = store.clearBudgetCaps;
  if (!clear) return true;
  try {
    clear.call(store, sessionId);
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    warnOnce("budget-clear:" + msg, "budget release failed (" + msg + ") — continuing unmetered");
    return false;
  }
}

/**
 * Resolve the store/sessionId pair handed to PiAgentRuntime.
 *
 * @param eng - Composition result carrying the session store.
 * @param requested - `AnsChatInput.sessionId`, already type-checked by AJV; the
 *   runtime guard here also covers direct callers and non-string test input.
 * @returns store + sessionId (and the engine's ledger, #178) only when the
 *   handle is usable; an empty object leaves the runtime's `store && sessionId`
 *   gate closed (single-shot / memory disabled).
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
      const budgetReady = registerSessionBudget(store, requested, eng.config?.budget);
      return { store, sessionId: requested, ledger: budgetReady ? eng.ledger : undefined };
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
    const budgetReady = registerSessionBudget(store, id, eng.config?.budget);
    return { store, sessionId: id, ledger: budgetReady ? eng.ledger : undefined };
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
  structuredContent?: Record<string, unknown>;
}

/**
 * Shape the MCP call result.
 *
 * Design: the handle is returned in model-visible content (a trailing text
 * block) as well as structuredContent — the next call threads it as an ordinary
 * tool argument, and content-only proxies (e.g. the dsh native tool plane) never
 * see structuredContent. The answer text itself stays untouched.
 */
export function buildAnsChatResult(output: string, sessionId?: string, extra?: Record<string, unknown>): AnsChatToolResult {
  // Usage and context are facts about this call, not properties of the handle.
  // A store-less run has no handle but still spent a model call, so the
  // metadata must survive without one. The handle is authoritative: spread
  // `extra` first so a caller-supplied key can never overwrite it.
  const metadata = { ...(extra ?? {}), ...(sessionId ? { sessionId } : {}) };
  return {
    content: [
      { type: "text", text: output || "ans_chat: no response" },
      ...(sessionId
        ? [{ type: "text" as const, text: JSON.stringify({ sessionId }) }]
        : []),
    ],
    ...(Object.keys(metadata).length > 0 ? { structuredContent: metadata } : {}),
  };
}

// ---- consolidation result (D5 / Q18 / Q19) ----

// The report and usage shapes are imported, not re-declared: a second copy of
// the store's report would drift the moment a field is added on one side, and
// the MCP tool already depends on @anysearch-cli/store.

/**
 * Consolidation result.
 *
 * The report lands in `structuredContent` (the host reads categories there)
 * and one readable line stays in `content` for content-only proxies. The scope
 * is always echoed: a caller must be able to see which materials were read
 * instead of inferring it from the flags it thinks it sent.
 *
 * Design: `skip` and `conflict` are the categories the caller acts on, and
 * `gateRejected` feeds exactly one of them (conflict). Counting it in both
 * would report one event twice and make the tallies not add up.
 */
export function buildAnsChatConsolidateResult(
  report: ConsolidateReport,
  usage: ConsolidationUsage,
  extra: { budgetUnmetered?: boolean; budgetUnmeteredReason?: string },
): AnsChatToolResult {
  const s = report.scope;
  // Knowledge built from materials outside the selected scope can still be
  // replaced by a reliable correction (shared knowledge, D5/D6). The result
  // names those rows so "only the selected materials moved" is never assumed.
  const outside = (report.updates ?? []).filter((u) => !u.withinScope);
  const outsideText = outside.length === 0
    ? ""
    : "\noutside scope: " + outside
      .map((u) => {
        // The knowledge ids alone are not enough for a text-only client: it
        // needs to see which materials it did not select were carried by the
        // replaced row.
        const materials = u.outsideScopeMaterialIds.length > 0
          ? u.outsideScopeMaterialIds.join(", ")
          : "none listed";
        return "knowledge " + u.oldId + " -> " + u.newId + " (materials outside this scope: " + materials + ")";
      })
      .join("; ");
  const line =
    "ans_chat consolidate" + (report.dryRun ? " (dry-run)" : "") +
    ": add " + report.add + ", update " + report.update +
    ", skip " + report.noop + ", conflict " + report.gateRejected +
    ", failure " + report.llmUnavailable +
    " (scanned " + report.clustersScanned + ", triggered " + report.clustersTriggered + ")" +
    "\nscope: " + formatConsolidateScope(s) +
    outsideText +
    (report.supersededClusterSkipped > 0
      ? "\nskipped superseded clusters: " + report.supersededClusterSkipped +
        " (all their materials were replaced by an earlier correction, so no new knowledge was created from them)"
      : "") +
    (report.verifyRejected > 0
      ? "\nrefused corrections: " + report.verifyRejected + " (different fact, unreliable evidence, or unclear — old knowledge kept; details in verifyDetails)"
      : "") +
    (report.correctionsIncomplete > 0
      ? "\nincomplete corrections: " + report.correctionsIncomplete +
        " (merge or final check failed — those corrections were NOT replaced" +
        (report.update > 0 ? (report.dryRun ? "; " + report.update + " other correction(s) would land" : "; " + report.update + " other correction(s) did land") : "; nothing was replaced") +
        "; details in incompleteDetails)"
      : "") +
    (report.dryRun
      ? "\ndry-run: nothing saved. The counts describe the state read now; a concurrent write " +
        "before an apply can make the apply differ."
      : "") +
    (extra.budgetUnmetered
      ? "\nbudget: unmetered — " + (extra.budgetUnmeteredReason ?? "no budget row was registered") + "."
      : "") +
    (report.budgetRejected > 0 ? "\nbudget: " + report.budgetRejected + " model call(s) refused by the session cap" : "");
  // #261 (D6): one readable line per refused correction, so a content-only
  // proxy still sees the old knowledge, the candidate, the sources, the
  // verdict and what to check next. The structured block carries the same
  // detail in full.
  const refusedText = (report.verifyDetails ?? []).length === 0
    ? ""
    : "\n" + report.verifyDetails.map((d) =>
        "correction refused (knowledge " + d.oldId +
        ", sameFact=" + d.sameFact + ", reliable=" + d.reliable +
        (d.relation ? ", relation=" + d.relation : "") + ")" +
        "\n  old: " + d.oldContent +
        "\n  candidate: " + d.candidate +
        "\n  sources: " + d.evidence.map((e) => e.url).join(", ") +
        (d.reason ? "\n  reason: " + d.reason : "") +
        "\n  next: " + d.followUp,
      ).join("\n");
  const incompleteText = (report.incompleteDetails ?? []).length === 0
    ? ""
    : "\n" + report.incompleteDetails.map((d) =>
        "correction incomplete (" + d.stage + ", knowledge " + d.oldId + " NOT replaced" +
        (d.reason ? "; " + d.reason : "") + ")" +
        "\n  old: " + d.oldContent +
        "\n  candidate: " + d.candidate +
        "\n  sources: " + d.evidence.map((e) => e.url).join(", "),
      ).join("\n");
  return {
    content: [{ type: "text", text: line + refusedText + incompleteText }],
    structuredContent: {
      operation: "consolidate",
      scope: s,
      report,
      counts: {
        add: report.add,
        update: report.update,
        skip: report.noop,
        conflict: report.gateRejected,
        failure: report.llmUnavailable,
        budgetRejected: report.budgetRejected,
        verifyRejected: report.verifyRejected,
        correctionsIncomplete: report.correctionsIncomplete,
        supersededClusterSkipped: report.supersededClusterSkipped,
      },
      usage,
      ...(extra.budgetUnmetered
        ? {
          budgetUnmetered: true,
          ...(extra.budgetUnmeteredReason ? { budgetUnmeteredReason: extra.budgetUnmeteredReason } : {}),
        }
        : {}),
    },
  };
}
