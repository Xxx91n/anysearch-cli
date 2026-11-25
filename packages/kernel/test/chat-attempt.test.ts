// One chat attempt (#299): the lease that covers both chat_projects writes.
//
//   A1 the two writes happen inside the lease, in order: "began" before the
//      body runs, the result after it returns;
//   A2 a fresh attempt leaves the OTHER session's row alone (the lease is per
//      session, not global);
//   A3 a body that fails records "unfinished" and still releases the lease;
//   A4 a body that never starts (cancelled before any provider work) records
//      nothing at all — the row of a finished conversation is not reordered or
//      marked incomplete by a request nobody ran;
//   A5 a second attempt on a session that is already leased fails AT ONCE with
//      ChatAttemptBusyError, not after a wait;
//   A6 an in-memory chat (no handle, or no record directory) still runs;
//   A7 a lease left by an owner the probe cannot classify is reclaimed once its
//      heartbeat goes stale — the lease follows the same reclaim rule as the
//      run lock (#576).
//
// Run: pnpm --filter @anysearch-cli/kernel run test

import { mkdirSync, mkdtempSync, rmSync, existsSync, utimesSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { runChatAttempt, ChatAttemptBusyError, chatAttemptBusyText, sessionLeasePath } from "../src/chat-attempt";
import { SqliteSessionStore } from "@anysearch-cli/store";

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error("FAIL: " + msg); return; }
  passed++;
}

async function main() {
  const workDir = mkdtempSync(join(tmpdir(), "ans-299-attempt-"));

  try {
    // ---------- A1: both writes happen inside the lease, in order ----------
    {
      mkdirSync(join(workDir, "a1"), { recursive: true });
      const store = new SqliteSessionStore(join(workDir, "a1", "data.db"));
      await store.ensureSession("s1", "default");
      const piDir = join(workDir, "a1", "pi");
      const seen: Array<{ at: string; leased: boolean }> = [];
      // A wrapper, not a spread: spreading an instance copies own fields only
      // and every method would vanish.
      const recording = Object.create(store) as typeof store;
      recording.recordChatProject = (id: string, root: string | null, completed?: boolean) => {
        // "leased" is observed through the lease directory existing at write
        // time — the point of this module is that it does.
        seen.push({ at: completed ? "result" : "begin", leased: existsSync(sessionLeasePath(piDir, id)) });
        store.recordChatProject(id, root, completed);
      };

      const outcome = await runChatAttempt({
        store: recording,
        sessionId: "s1",
        projectRoot: "/p",
        piSessionDir: piDir,
      }, async (attempt) => {
        attempt.markStarted();
        return { completed: true };
      });

      assert(outcome.completed === true, "A1: the outcome is passed through");
      assert(seen.length === 2, "A1: exactly two writes (got " + seen.length + ")");
      assert(seen[0]?.at === "begin" && seen[1]?.at === "result",
        "A1: the start is written before the result (got " + JSON.stringify(seen.map((s) => s.at)) + ")");
      assert(seen.every((s) => s.leased),
        "A1: both writes happen while the lease is held (got " + JSON.stringify(seen) + ")");
      assert(store.getChatSession("s1")?.isCompleted === 1, "A1: a completed attempt leaves is_complete=1");
      assert(!existsSync(sessionLeasePath(piDir, "s1")), "A1: the lease is handed back");
      store.close();
    }

    // ---------- A2: another session's row is untouched ----------
    {
      mkdirSync(join(workDir, "a2"), { recursive: true });
      const store = new SqliteSessionStore(join(workDir, "a2", "data.db"));
      await store.ensureSession("mine", "default");
      await store.ensureSession("theirs", "default");
      store.recordChatProject("theirs", "/p", true);
      const before = store.getChatSession("theirs");
      const piDir = join(workDir, "a2", "pi");

      await runChatAttempt({ store, sessionId: "mine", projectRoot: "/p", piSessionDir: piDir }, async (attempt) => {
        attempt.markStarted();
        return { completed: true };
      });

      const after = store.getChatSession("theirs");
      assert(before?.isCompleted === after?.isCompleted && before?.updatedAt === after?.updatedAt,
        "A2: the other session's row is unchanged");
      store.close();
    }

    // ---------- A3: a failed body records unfinished and releases ----------
    {
      mkdirSync(join(workDir, "a3"), { recursive: true });
      const store = new SqliteSessionStore(join(workDir, "a3", "data.db"));
      await store.ensureSession("s3", "default");
      const piDir = join(workDir, "a3", "pi");
      let threw = false;
      try {
        await runChatAttempt({ store, sessionId: "s3", projectRoot: "/p", piSessionDir: piDir }, async (attempt) => {
          attempt.markStarted();
          throw new Error("provider exploded");
        });
      } catch (e: any) {
        threw = /provider exploded/.test(e?.message);
      }
      assert(threw, "A3: the body's error reaches the caller");
      assert(store.getChatSession("s3")?.isCompleted === 0,
        "A3: a body that threw leaves the attempt recorded as unfinished");
      assert(!existsSync(sessionLeasePath(piDir, "s3")), "A3: the lease is released on the error path");
      store.close();
    }

    // ---------- A4: an attempt that never starts records nothing ----------
    {
      mkdirSync(join(workDir, "a4"), { recursive: true });
      const store = new SqliteSessionStore(join(workDir, "a4", "data.db"));
      await store.ensureSession("s4", "default");
      // A finished conversation, already the most recent in its project.
      store.recordChatProject("s4", "/p", true);
      const before = store.getChatSession("s4");
      const piDir = join(workDir, "a4", "pi");

      const outcome = await runChatAttempt({ store, sessionId: "s4", projectRoot: "/p", piSessionDir: piDir }, async () => {
        // Cancelled before any provider or tool work: nothing to record.
        return { completed: false };
      });

      const after = store.getChatSession("s4");
      assert(outcome.completed === false, "A4: the cancelled outcome is reported");
      assert(before?.isCompleted === after?.isCompleted && before?.updatedAt === after?.updatedAt,
        "A4: a request that never started leaves the finished row alone");
      store.close();
    }

    // ---------- A5: a second attempt on a leased session fails at once ----------
    {
      mkdirSync(join(workDir, "a5"), { recursive: true });
      const store = new SqliteSessionStore(join(workDir, "a5", "data.db"));
      await store.ensureSession("s5", "default");
      const piDir = join(workDir, "a5", "pi");

      let release!: () => void;
      const held = new Promise<void>((resolve) => { release = resolve; });
      let entered!: () => void;
      const inside = new Promise<void>((resolve) => { entered = resolve; });

      const first = runChatAttempt({ store, sessionId: "s5", projectRoot: "/p", piSessionDir: piDir }, async (attempt) => {
        attempt.markStarted();
        entered();
        await held;
        return { completed: true };
      });
      await inside;

      const startedAt = Date.now();
      let busy: unknown;
      try {
        await runChatAttempt({ store, sessionId: "s5", projectRoot: "/p", piSessionDir: piDir }, async (attempt) => {
          attempt.markStarted();
          return { completed: true };
        });
      } catch (e) { busy = e; }
      const waitedMs = Date.now() - startedAt;

      assert(busy instanceof ChatAttemptBusyError, "A5: the second attempt fails with ChatAttemptBusyError");
      assert((busy as ChatAttemptBusyError)?.sessionId === "s5", "A5: the error names the session");
      assert((busy as ChatAttemptBusyError)?.leasePath === sessionLeasePath(piDir, "s5"),
        "A5: the error names the lease a person can clear by hand (#576)");
      const busyError = busy as ChatAttemptBusyError;
      assert(busyError?.facts?.liveness === "alive" && busyError?.facts?.holder?.pid === process.pid,
        "A5: the collision reports the holder as this live process (got " + JSON.stringify(busyError?.facts) + ")");
      // #587 review: the manual clear belongs only to an owner this machine
      // cannot confirm alive — offering it while the holder is running invites
      // the double writer the lease exists to prevent.
      const busyText = chatAttemptBusyText(busyError);
      assert(!busyText.includes("删掉"),
        "A5: a live holder is not offered a manual clear (got " + JSON.stringify(busyText) + ")");
      assert(busyText.includes(busyError.leasePath),
        "A5: the lease path is shown even for a live holder — a recycled pid leaves it the only thing to act on");
      assert(chatAttemptBusyText(busyError, "ans_chat: ").startsWith("ans_chat: "),
        "A5: the host prefix goes in front of the shared sentence");
      // The point of #299: no queue. A poll-based wait would be at least one
      // sleep tick; the production window is 120 s, so anything near that is a
      // failure of the ticket, not a slow test.
      assert(waitedMs < 1_000, "A5: the refusal is immediate, not a wait (took " + waitedMs + " ms)");

      release();
      const firstOutcome = await first;
      assert(firstOutcome.completed === true, "A5: the holder finishes normally");
      assert(store.getChatSession("s5")?.isCompleted === 1, "A5: the holder's completion is what the row says");
      store.close();
    }

    // ---------- A6: no handle or no directory still runs ----------
    {
      const noHandle = await runChatAttempt({ projectRoot: "/p" }, async () => ({ completed: true }));
      assert(noHandle.completed === true, "A6: an attempt with no handle still runs (in-memory chat)");

      mkdirSync(join(workDir, "a6"), { recursive: true });
      const store = new SqliteSessionStore(join(workDir, "a6", "data.db"));
      await store.ensureSession("s6", "default");
      const noDir = await runChatAttempt({ store, sessionId: "s6", projectRoot: "/p" }, async (attempt) => {
        attempt.markStarted();
        return { completed: true };
      });
      assert(noDir.completed === true, "A6: an attempt with no record directory still runs");
      assert(store.getChatSession("s6")?.isCompleted === 1,
        "A6: without a directory the bookkeeping still happens (nothing to serialize)");
      store.close();
    }
    // ---------- A7: the lease reclaims like the run lock ----------
    {
      // #576: the lease and the run lock share one reclaim decision, so the
      // case the run lock's L10 covers has to hold here too: an owner this
      // machine cannot classify is judged on the heartbeat, not kept forever.
      const piDir = join(workDir, "a7", "pi");
      const leasePath = sessionLeasePath(piDir, "s7");
      const unknownPid = 777777777;
      mkdirSync(leasePath, { recursive: true });
      writeFileSync(join(leasePath, "owner.json"),
        JSON.stringify({ pid: unknownPid, host: hostname(), startedAt: Date.now() }));
      const heartbeat = join(leasePath, "heartbeat");
      writeFileSync(heartbeat, String(Date.now()));
      const old = new Date(Date.now() - 60_000);
      utimesSync(heartbeat, old, old);

      const realKill = process.kill;
      const unconfirmable: typeof process.kill = (pid, signal) => {
        if (pid === unknownPid && signal === 0) {
          throw Object.assign(new Error("probe could not classify this pid"), { code: "ERR_INVALID_ARG_TYPE" });
        }
        return realKill(pid, signal);
      };
      process.kill = unconfirmable;
      try {
        // Without this the test would pass on a patch that never took effect:
        // 777777777 would then read as dead and the lease would be reclaimed
        // for the wrong reason.
        let probeCode: string | undefined;
        try { process.kill(unknownPid, 0); } catch (e) { probeCode = (e as NodeJS.ErrnoException)?.code; }
        assert(probeCode === "ERR_INVALID_ARG_TYPE",
          "A7: the probe really cannot classify this pid (got " + JSON.stringify(probeCode) + ")");

        const outcome = await runChatAttempt({
          sessionId: "s7", projectRoot: "/p", piSessionDir: piDir,
          sessionLock: { staleMs: 1_000 },
        }, async (attempt) => {
          attempt.markStarted();
          return { completed: true };
        });
        assert(outcome.completed === true,
          "A7: an unconfirmable lease past the stale window is reclaimed and the attempt runs");
      } finally {
        process.kill = realKill;
      }
    }

  } finally {
    try { rmSync(workDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* OS temp */ }
  }

  console.log("chat-attempt: " + passed + " passed, " + failed + " failed");
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
