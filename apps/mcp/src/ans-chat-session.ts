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
// Design: the resolver returns no wiring for malformed or unregisterable
// handles — a failed mint is not cached, so a later call retries. The tool
// stops when a known conversation cannot be wired (#299); otherwise the
// original fail-open behavior remains available for new and unknown handles.
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
  CredentialFileNotice,
  RunUsage,
  BudgetStopReason,
  SessionStorePort,
  SummaryUsage,
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

// The chat handle rule is enforced here, not on the wire (tool-schemas.ts leaves
// sessionId unconstrained so a malformed handle fails open): visible ASCII,
// 1..128 chars, and the value becomes a SQLite key, so control characters and
// unbounded lengths are refused. Consolidation is the exception — there the same
// field names a scope and a bad value fails CLOSED (ConsolidateScopeError).
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

/**
 * 这次调用算不算「续一段已有的对话」。
 *
 * 「手上没有记录」和「看不出有什么」是两件事。把后者当成前者，会让一个还没登记到库里的
 * 句柄在空内存里跑起来，而磁盘上其实有它的记录——新对话假装接着旧对话。
 * 只有明确说没有记录，才允许新起一段。
 *
 * 返回 `block` 时调用方不能发问题，要把原因说给用户。
 */
export function classifyContinuation(
  lookup: { path?: string; verdict: { ok: boolean; problem?: string; message?: string } } | undefined,
  chatTracked: boolean,
): { mustResume: boolean; block?: string } {
  const hasRecord = !!lookup?.path;
  if (lookup && !lookup.verdict.ok && lookup.verdict.problem !== "missing" && !lookup.path) {
    // Damaged records keep their path: the runtime re-judges them under its lock
    // and refuses with the exact reason. No path means the identity could not be
    // settled at all, and that is the case that must stop here.
    return {
      mustResume: chatTracked || hasRecord,
      block: "ans_chat: " + (lookup.verdict.message || "会话记录无法确认") + "。本次没有发送问题。",
    };
  }
  return { mustResume: chatTracked || hasRecord };
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
 *
 * #303: `ans_chat` no longer calls this on the normal path — its runs bill the
 * call's own task (`wireTaskBudget`). What remains here is the degraded path
 * (a store with no task registry, so the run has no task to bill) and the
 * direct callers/tests of `resolveAnsChatSession` that read the session form.
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
 * @param opts.sessionBudget - false when this call already has its own task
 *   budget: the handle then only restores context, and the session's [budget]
 *   row is neither initialized nor released. Defaults to true (the session
 *   form every unmigrated caller still runs).
 * @returns the store and handle when they are usable. On the session form the
 *   engine ledger travels with them (#178); on the context form the ledger is
 *   undefined and the run bills its own task instead. With no usable handle,
 *   store and sessionId are absent, which closes the runtime's
 *   store-and-sessionId gate (single-shot / no memory).
 */
export async function resolveAnsChatSession(
  eng: CompositionResult,
  requested?: unknown,
  opts: { sessionBudget?: boolean } = {},
): Promise<AnsChatSessionWiring> {
  const store = eng.store;
  const sessionBudget = opts.sessionBudget !== false;
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
      if (!sessionBudget) return { store, sessionId: requested };
      const budgetReady = registerSessionBudget(store, requested, eng.config?.budget);
      return { store, sessionId: requested, ledger: budgetReady ? eng.ledger : undefined };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      warnOnce("register:" + msg, "session row registration failed (" + msg + ") — memory wiring unavailable");
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
    if (!sessionBudget) return { store, sessionId: id };
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
 * see structuredContent. A recovery notice goes before the answer.
 */
export function buildAnsChatResult(
  output: string,
  sessionId?: string,
  extra?: Record<string, unknown>,
  recoveryNotice?: string,
): AnsChatToolResult {
  // Usage and context are facts about this call, not properties of the handle.
  // A store-less run has no handle but still spent a model call, so the
  // metadata must survive without one. The handle is authoritative: spread
  // `extra` first so a caller-supplied key can never overwrite it.
  const metadata = { ...(extra ?? {}), ...(sessionId ? { sessionId } : {}), ...(recoveryNotice ? { recoveryNotice } : {}) };
  const answer = output || "ans_chat: no response";
  return {
    content: [
      { type: "text", text: recoveryNotice ? recoveryNotice + "\n\n" + answer : answer },
      ...(sessionId
        ? [{ type: "text" as const, text: JSON.stringify({ sessionId }) }]
        : []),
    ],
    ...(Object.keys(metadata).length > 0 ? { structuredContent: metadata } : {}),
  };
}

/**
 * Design: #538 — put the `CredentialFileNotice` in both halves. A success
 * answer leads with the sentence; an error or a cancellation keeps its own
 * first line, so the sentence follows the reason. A result with no
 * `structuredContent` stays text-only (#204).
 */
export function withCredentialFileFault(
  result: AnsChatToolResult,
  fault?: CredentialFileNotice,
): AnsChatToolResult {
  if (!fault) return result;
  // The SDK types the handler result as an open object, and the tool casts it
  // in; a result without a text array must not become a TypeError here.
  const blocks = Array.isArray(result.content) ? result.content : [];
  const head = blocks[0];
  // `ans_chat: cancelled — no answer was produced` is the whole point of that
  // result: it must stay first for a content-only host. It carries no
  // `isError`, so `interrupted` is what identifies it.
  const followsReason = result.isError === true || result.structuredContent?.["interrupted"] === true;
  const content = head
    ? [{
        ...head,
        text: followsReason
          ? head.text + "\n\n" + fault.notice
          : fault.notice + "\n\n" + head.text,
      }, ...blocks.slice(1)]
    : [{ type: "text" as const, text: fault.notice }];
  return {
    ...result,
    content,
    // Merge, never replace: the caller's own facts (`usage`, `budget`, …) must
    // survive. Absent stays absent.
    ...(result.structuredContent
      ? { structuredContent: { ...result.structuredContent, credentialFileFault: fault } }
      : {}),
  };
}

/**
 * #264: the failure result for a run that ended with an error.
 *
 * The rebuild report is attached HERE rather than at each call site, and for a
 * reason worth stating: the summary work runs in the background and is drained
 * before this point, so a rebuilt summary really exists even though the turn
 * failed. Returning a bare error discarded that fact, and the caller could not
 * tell whether the old version was still suspended.
 *
 * The error text stays FIRST and keeps its stable "<tool> error: " prefix — it is
 * the reason the call failed, and burying it under a summary note would be worse
 * than the silence this fixes.
 *
 * Exported so the shape is testable without orchestrating a real provider failure.
 */
export function buildAnsChatErrorResult(
  detail: string,
  rebuilds: Array<{ anchorId: number; outcome: string; reasons: string[]; newAnchorId: number | null; cleared: boolean }>,
  formatLine: (r: any) => string,
  recoveryNotice?: string,
): AnsChatToolResult {
  const metadata = {
    ...(rebuilds.length > 0 ? { summaryRebuilds: rebuilds } : {}),
    ...(recoveryNotice ? { recoveryNotice } : {}),
  };
  return {
    isError: true,
    content: [
      { type: "text", text: "ans_chat error: " + detail },
      ...rebuilds.map((r) => ({ type: "text" as const, text: formatLine(r) })),
      ...(recoveryNotice ? [{ type: "text" as const, text: recoveryNotice }] : []),
    ],
    ...(Object.keys(metadata).length > 0 ? { structuredContent: metadata } : {}),
  };
}

// ---- #303: a run stopped by its own task budget ----

export interface AnsChatBudgetStopExtra {
  taskId?: string;
  /** What this run spent. A stop before the first provider call spends nothing, and the report says why it has no figure. */
  usage?: { run: RunUsage; memorySummary: SummaryUsage | null };
  /**
   * Which operation was stopped. The same builder serves both, and saying
   * "chat" about a consolidate call would send a caller down the wrong branch.
   */
  operation?: "chat" | "consolidate";
}

/**
 * The result for a run the task budget stopped.
 *
 * Why this is not a plain `toolError`: #303 requires a budget refusal (and a
 * budget that could not be established) to be distinguishable from an upstream
 * failure without string matching. So the classification rides in
 * `structuredContent.errorKind`, the stop reason is named in the text, and the
 * result stays a normal MCP execution result (isError + content). A classified
 * stop is not an output-schema result: the block says why the run stopped, not
 * what work happened. #204 still keeps unclassified errors bare.
 *
 * Both stops mean "nothing was called for this run": the runtime refuses before
 * the first controlled call and says so in the text. The work that already
 * happened (a resumed conversation, earlier tasks) is untouched.
 */
export function buildAnsChatBudgetResult(
  // #306: narrowed from RuntimeErrorReason. A domain stop is a different answer
  // (tools/task-budget.ts `toolDomainStop`) and must not be reported as a cap to
  // raise.
  kind: BudgetStopReason,
  detail: string,
  extra: AnsChatBudgetStopExtra = {},
): AnsChatToolResult {
  const label = kind === "budget-not-established"
    ? "this run's task budget could not be established"
    : "this run was stopped by its task budget";
  const operation = extra.operation ?? "chat";
  // The prose prefix follows the operation: a consolidate stop that announces
  // itself as "ans_chat: ..." while structuredContent says consolidate is a
  // contradiction for anyone reading logs.
  const toolLabel = operation === "consolidate" ? "ans_chat consolidate" : "ans_chat";
  // Say what the stop cost the caller without claiming more than is known: an
  // unbuildable budget stops before anything runs; a refusal stops at the call
  // it could not reserve, so earlier spend stays on the task's row.
  const tail = kind === "budget-not-established"
    ? "\nNo model request was sent for this run."
    : "\nThe run stopped at the call its budget refused; anything already spent stays on the task's row.";
  const unchanged = operation === "consolidate"
    ? tail + " No knowledge was written."
    : tail + " The conversation itself is unchanged.";
  return {
    isError: true,
    content: [{
      type: "text",
      text: toolLabel + ": " + label + " — " + detail + unchanged,
    }],
    structuredContent: {
      operation,
      errorKind: kind,
      budget: {
        stopped: true,
        // A refusal and an unbuildable budget are different things to fix:
        // raise the caps vs. repair registration/store; the caller must not
        // have to read prose to tell them apart.
        reason: kind === "budget-not-established" ? "not-established" : "rejected",
        detail,
      },
      ...(extra.taskId ? { taskId: extra.taskId } : {}),
      ...(extra.usage !== undefined ? { usage: extra.usage } : {}),
    },
  };
}

// ---- #303: a request that was cancelled before its run started ----

/**
 * The answer for a call the caller cancelled before (or while) the run was
 * being set up.
 *
 * The text says plainly that nothing was answered, and
 * `structuredContent.interrupted` is what the task wrapper reads to end the task
 * as unfinished. Without that marker a cancelled request would be written as a
 * clean exit-0 completion, which is the "cancelled equals finished" reading this
 * ticket removes. The SDK drops the response for a cancelled request, so no
 * caller sees this payload — the task row is what says what happened.
 */
export function buildAnsChatCancelledResult(): AnsChatToolResult {
  // Built directly, not through buildAnsChatResult: a content-only host would
  // otherwise read that builder's empty-result fallback ("ans_chat: no
  // response") as a successful empty answer.
  return {
    content: [{ type: "text", text: "ans_chat: cancelled — no answer was produced for this request." }],
    structuredContent: { interrupted: true },
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
        " (merge, re-judge, or final check failed — those corrections were NOT replaced" +
        (report.update > 0 ? (report.dryRun ? "; " + report.update + " other correction(s) would land" : "; " + report.update + " other correction(s) did land") : "; nothing was replaced") +
        "; details in incompleteDetails)"
      : "") +
    (report.summariesSuspended > 0
      ? "\nsummaries suspended: " + report.summariesSuspended +
        " (built from a fact this run replaced, so they are no longer injected as current research;" +
        " their text and sources are kept until a rebuild replaces them" +
        (report.dryRun ? "; the dry-run rolled that back" : "") + ")"
      : "") +
    // #262 (D11): collisions must not read as success. The counts line stays
    // one glance long; the per-conflict block below carries both sides.
    (report.conflicts > 0
      ? "\nunresolved conflicts: " + report.conflicts +
        " (a concurrent write replaced the same knowledge first; this run did NOT replace it — both sides' evidence is in conflictDetails, nothing was deleted)"
      : "") +
    ((report.resolvedCollisions ?? []).length > 0
      ? "\ncollisions resolved after re-read: " + (report.resolvedCollisions ?? []).length +
        " (duplicate or re-merged against the latest version, at most one re-judge each; details in resolvedCollisions)"
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
  // #263 (D9): one line per suspended summary, naming the session and the anchor
  // it lives in. A text-only client reads this block and nothing else, and the
  // count alone leaves it unable to find the summary it should rebuild. The
  // wording tracks the dry-run: in a preview the suspension was rolled back, so
  // "would be suspended" is the honest phrasing — the same rule the correction
  // lines above follow.
  // A summary can depend ONLY on retired materials and never have read the
  // knowledge row whose correction triggered this, so "built from knowledge X"
  // would name a source it never had. What the id honestly is: the correction
  // that caused the suspension.
  const suspendedText = (report.suspendedSummaries ?? []).length === 0
    ? ""
    : "\n" + report.suspendedSummaries.map((s) =>
        (report.dryRun ? "summary that would be suspended: " : "summary suspended: ") +
        "session " + s.sessionId + " anchor " + s.anchorId +
        " (suspended by the correction of knowledge " + s.triggerKnowledgeId + ")",
      ).join("\n");
  // Design: #262 (D11) — a content-only proxy still sees BOTH sides of an
  // unresolved collision — the plan-era target, this run's candidate and
  // sources, the current live content and the other side's sources, the
  // reason and what to check next. Neither side is deleted; write order is
  // not a verdict.
  const conflictText = (report.conflictDetails ?? []).length === 0
    ? ""
    : "\n" + report.conflictDetails.map((d) =>
        "concurrent correction conflict (planned knowledge " + d.plannedTargetId +
        ", current knowledge " + (d.currentTargetId ?? "none") +
        ", retries=" + d.retries + ")" +
        "\n  we planned to replace: " + d.plannedContent +
        "\n  our candidate: " + d.candidate +
        "\n  our sources: " + d.evidence.map((e) => e.url).join(", ") +
        "\n  current live content: " + d.currentContent +
        "\n  current sources: " + d.currentEvidence.map((e) => e.url).join(", ") +
        "\n  reason: " + d.reason +
        "\n  next: " + d.followUp,
      ).join("\n");
  const resolvedText = (report.resolvedCollisions ?? []).length === 0
    ? ""
    : "\n" + report.resolvedCollisions.map((d) =>
        "collision resolved (" + d.resolution + (d.resolution === "re-merged"
          ? " knowledge " + d.targetId + " -> " + d.newId
          : " no new version, knowledge " + d.targetId + " keeps the correction") +
        "; re-judge retries=" + d.retries + ", sameFact=" + d.sameFact + ", reliable=" + d.reliable +
        (d.reason ? "; " + d.reason : "") + ")",
      ).join("\n");
  return {
    content: [{ type: "text", text: line + refusedText + incompleteText + suspendedText + conflictText + resolvedText }],
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
        summariesSuspended: report.summariesSuspended,
        // Design: #262 — real cross-session conflicts, kept DISTINCT from the
        // gate counter above (that one counts claim-gate rejections);
        // renaming either into the other would silently change what a host
        // reads today.
        unresolvedConflicts: report.conflicts,
        resolvedCollisions: (report.resolvedCollisions ?? []).length,
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
