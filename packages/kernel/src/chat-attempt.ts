// One chat attempt (#299): lease -> record start -> run -> record result ->
// hand the lease back.
//
// Why this module exists. The session lock in ./session-lock guards the JSONL
// append, and the runtime takes it for its own run. The two chat_projects
// writes — "this attempt began" and "this attempt finished" — sat outside that
// lock, one on each side of the run. A slow older attempt could therefore
// overwrite a newer attempt's unfinished state: B records "incomplete", waits
// its turn, A finishes and records "complete" for the same row, and the list
// says complete while B is still running. What was wrong was not the column,
// it was the boundary: two writes about one attempt with no serialization
// covering both.
//
// So the boundary moves out here, and it covers the whole attempt: acquire the
// lease, write "began", run, write the result, release. Two attempts on one
// session can no longer interleave at the database, because the second cannot
// even record that it began.
//
// The lease is separate from the run lock on purpose. Same session, two
// different questions — "may this attempt own the recorded state?" and "may
// this run append to the record?" — and one directory each keeps them from
// blocking each other by accident.
//
// A collision is answered at once unless the host obtains an explicit choice
// to wait or fork (#317). The host asks; this module keeps both paths inside
// the same lease boundary as the ordinary attempt.

import { join } from "node:path";
import type { SessionManager } from "@earendil-works/pi-coding-agent";
import { piSessionKey } from "./pi-runtime";
import { forkChatSession } from "./fork-session";
import { recoverPiSessionRecord } from "./pi-session-recovery";
import type { SessionStorePort } from "./ports";
import {
  SESSION_LEASE_DIRNAME,
  acquireSessionLease,
  acquireSessionLock,
  isSessionBusy,
  resolveSessionLockWindows,
  sessionBusyHolder,
  type SessionLockWindows,
} from "./session-lock";

/**
 * Another attempt holds this session's lease right now.
 *
 * A distinct type rather than a message: each host words the collision its own
 * way (the CLI exits non-zero, the MCP tool returns an error result), and both
 * must be able to tell contention from a filesystem fault without matching
 * English text.
 */
export class ChatAttemptBusyError extends Error {
  constructor(
    readonly sessionId: string,
    /**
     * The lease directory that is still held. A host that words this collision
     * itself needs it: a lease whose owner is gone is the one busy state a
     * person can clear by hand, and they cannot clear a path nobody showed them.
     */
    readonly leasePath: string,
    /**
     * The holder's pid and host, when the lease named them. Without this the
     * message asks a person to confirm "that process" without saying which.
     */
    readonly holder?: { pid: number; host: string },
  ) {
    super("Session is busy: another chat attempt holds it; this attempt was not started.");
    this.name = "ChatAttemptBusyError";
  }
}

export type ChatCollisionChoice = "stop" | "wait" | { fork: string };

export interface ChatAttemptOptions {
  /** Store holding the session row and its chat_projects state. */
  store?: SessionStorePort;
  /** The handle this attempt belongs to. No handle = nothing to record. */
  sessionId?: string;
  /**
   * Project to keep on the row. The caller passes the session's ORIGINAL
   * project when it already had one, so resuming from another directory does
   * not move the conversation into the directory it was resumed from.
   */
  projectRoot: string | null;
  /** Directory holding the PI records; leases live in its `leases/` child. */
  piSessionDir?: string;
  /** Lease windows. Waiting is enabled only by an explicit onBusy choice. */
  sessionLock?: SessionLockWindows;
  onBusy?: (sessionId: string) => Promise<ChatCollisionChoice>;
}

export interface ChatAttemptContext {
  /** The selected handle, including the new handle after a fork. */
  sessionId?: string;
  /** Append recovery facts after validating the record and before replaying it. */
  recoverRecord?(record: SessionManager): string | undefined;
  recoverInterruptedTurn?(record: SessionManager): ReturnType<typeof recoverPiSessionRecord>;
  /**
   * Say that the run really started. Call it once the attempt has done
   * something — a provider call, a tool call, a written record.
   *
   * An attempt that is cancelled or refused before that point records nothing,
   * so a request nobody ran cannot reorder the recent-session list or mark a
   * finished conversation unfinished. Throwing here stops the run: continuing
   * would spend a paid turn whose state can never be recorded.
   */
  markStarted(): void;
}

export interface ChatAttemptOutcome {
  /** The run reached its own end (a `done` event), not merely "did not throw". */
  completed: boolean;
}

/**
 * Run one chat attempt under this session's lease.
 *
 * The body runs the model turn and returns whether that turn completed. The
 * body is called only once the lease is ours, so its database work and
 * completion bookkeeping cannot interleave with another attempt on the same
 * session.
 *
 * Throws ChatAttemptBusyError when another attempt holds the lease right now.
 * Without an onBusy choice the attempt never waits.
 */
export async function runChatAttempt(
  options: ChatAttemptOptions,
  body: (ctx: ChatAttemptContext) => Promise<ChatAttemptOutcome>,
): Promise<ChatAttemptOutcome> {
  const { store, sessionId, projectRoot, piSessionDir } = options;
  // Design: no record directory means nothing can be shared with another
  // process, so there is nothing to serialize. The bookkeeping still happens —
  // the row is real, only the cross-process guard is unnecessary.
  if (!piSessionDir || !sessionId) return runBody(body, store, sessionId, projectRoot);

  const windows = resolveSessionLockWindows(options.sessionLock);
  // One path for every answer about this lease: the acquisition, the wait, and
  // the collision error all name the same directory, so the host can show it.
  const leasePath = sessionLeasePath(piSessionDir, sessionId);
  let release: (() => void) | undefined;
  try {
    release = await acquireSessionLease(leasePath, windows);
  } catch (error) {
    if (!isSessionBusy(error)) throw error;
    const choice = await options.onBusy?.(sessionId) ?? "stop";
    if (choice === "stop") throw new ChatAttemptBusyError(sessionId, leasePath, sessionBusyHolder(error));
    if (choice === "wait") {
      // Design: #315/#317 replace #266's automatic two-minute queue — an
      // unattended caller must not hang without an explanation. Only a caller
      // who explicitly chooses wait gets a bounded wait on the lease.
      try {
        release = await acquireSessionLock(leasePath, {
          ...windows, waitMs: windows.waitMs || 120_000,
        });
      } catch (waitError) {
        if (isSessionBusy(waitError)) throw new ChatAttemptBusyError(sessionId, leasePath, sessionBusyHolder(waitError));
        throw waitError;
      }
    } else {
      return runChatAttempt({ ...options, sessionId: choice.fork, onBusy: undefined }, async ctx => {
        forkChatSession(piSessionDir, sessionId, choice.fork);
        return body(ctx);
      });
    }
  }
  try {
    return await runBody(body, store, sessionId, projectRoot, (record) =>
      recoverPiSessionRecord(record, () => store?.getChatSession?.(sessionId)?.isCompleted === 1));
  } finally {
    release();
  }
}

/**
 * The attempt itself, with the completion bookkeeping the lease protects.
 *
 * "Began" is written the moment the body says it started, and the result is
 * written only after the body returns. A body that throws leaves the "began"
 * row in place, which is the truth: the attempt really started and did not
 * finish.
 */
async function runBody(
  body: (ctx: ChatAttemptContext) => Promise<ChatAttemptOutcome>,
  store: SessionStorePort | undefined,
  sessionId: string | undefined,
  projectRoot: string | null,
  recoverInterruptedTurn?: ChatAttemptContext["recoverInterruptedTurn"],
): Promise<ChatAttemptOutcome> {
  const record = store?.recordChatProject;
  const writable = !!(record && sessionId);
  let started = false;
  const ctx: ChatAttemptContext = {
    sessionId,
    recoverRecord: recoverInterruptedTurn && (record => recoverInterruptedTurn(record)?.notice),
    recoverInterruptedTurn,
    markStarted() {
      if (started || !writable) return;
      started = true;
      record!.call(store, sessionId!, projectRoot, false);
    },
  };
  const outcome = await body(ctx);
  // Only an attempt that began gets a result. A body that never called
  // markStarted did nothing worth recording, and writing here would be the
  // over-registration this module exists to prevent.
  if (started) record!.call(store, sessionId!, projectRoot, outcome.completed);
  return outcome;
}

/** Where this session's lease lives, for diagnostics and tests. */
export function sessionLeasePath(piSessionDir: string, sessionId: string): string {
  return join(piSessionDir, SESSION_LEASE_DIRNAME, piSessionKey(sessionId) + ".lock");
}
